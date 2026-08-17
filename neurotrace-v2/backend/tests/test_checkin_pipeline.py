"""compute_checkin end to end, against a real database.

Same ten-day story as test_alert_gate_sim.py, but every day goes through the persisted
pipeline: feature_vectors -> baselines -> scores -> alerts. This is the assertion that the
service wiring reproduces the reference behaviour, not just the maths in isolation.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.auth.password import hash_password
from app.ml.face import FACE_SCORING_KEYS
from app.ml.reaction import REACTION_SCORING_KEYS
from app.ml.scoring import DEV_THRESHOLD
from app.ml.speech import SPEECH_SCORING_KEYS
from app.models import Alert, Baseline, DailySample, FeatureVector, Modality, Patient, Role, SampleStatus, Score, User
from app.services.checkin import compute_checkin

from .simulation import BASELINE_DAY_COUNT, PLAN, full_day, make_rng

DAY_ONE = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
KEYSETS = (
    (Modality.voice, SPEECH_SCORING_KEYS),
    (Modality.face, FACE_SCORING_KEYS),
    (Modality.reaction, REACTION_SCORING_KEYS),
)


async def _make_patient(session) -> Patient:
    caregiver = User(
        email="asha@example.com", pw_hash=hash_password("a-real-password"), role=Role.caregiver
    )
    session.add(caregiver)
    await session.flush()
    patient = Patient(caregiver_id=caregiver.id, name="Ramesh", age=67, sex="male", language="hi")
    session.add(patient)
    await session.commit()
    return patient


async def _add_day(session, patient: Patient, day_index: int, features: dict[Modality, dict]) -> DailySample:
    sample = DailySample(
        patient_id=patient.id,
        ts=DAY_ONE + timedelta(days=day_index),
        reaction_json={"latencies_ms": [], "misses": 0, "false_starts": 0},
    )
    session.add(sample)
    await session.flush()
    for modality, feats in features.items():
        session.add(
            FeatureVector(sample_id=sample.id, modality=modality, features_json=feats)
        )
    await session.commit()
    return sample


def _day_features(rng, drift: float) -> dict[Modality, dict]:
    """Voice, face, reaction — generated in that fixed order so the run is reproducible."""
    return {modality: full_day(rng, keys, drift) for modality, keys in KEYSETS}


async def _run_ten_days(session) -> tuple[Patient, list]:
    patient = await _make_patient(session)
    rng = make_rng(42)
    results = []
    drifts = [0.0] * BASELINE_DAY_COUNT + [drift for _, drift in PLAN]
    for day_index, drift in enumerate(drifts):
        sample = await _add_day(session, patient, day_index, _day_features(rng, drift))
        results.append(await compute_checkin(session, patient.id, sample.id))
    await session.refresh(patient)
    return patient, results


@pytest.fixture
async def ten_days(session):
    return await _run_ten_days(session)


# --------------------------------------------------------------------------- baseline phase
async def test_the_first_four_days_build_the_baseline_and_are_not_scored(ten_days):
    _, results = ten_days
    for result in results[:BASELINE_DAY_COUNT]:
        assert result.baseline_day is True
        assert result.deviations == {"voice": 0.0, "face": 0.0, "reaction": 0.0}
        assert result.band.value == "STABLE"
        assert result.alert_id is None


async def test_baseline_rows_are_persisted_per_modality(session, ten_days):
    patient, _ = ten_days
    rows = list(await session.scalars(select(Baseline).where(Baseline.patient_id == patient.id)))
    assert {r.modality for r in rows} == {Modality.voice, Modality.face, Modality.reaction}
    for row in rows:
        assert row.ready is True
        assert row.n_days == BASELINE_DAY_COUNT
        assert row.mean_json and row.std_json
        assert set(row.mean_json) == set(row.std_json)
        assert all(v > 0 for v in row.std_json.values())


async def test_baseline_ready_flips_on_the_fourth_day_not_before(session):
    patient = await _make_patient(session)
    rng = make_rng(42)
    seen = []
    for day_index in range(BASELINE_DAY_COUNT):
        sample = await _add_day(session, patient, day_index, _day_features(rng, 0.0))
        seen.append((await compute_checkin(session, patient.id, sample.id)).baseline_ready)
    assert seen == [False, False, False, True]


async def test_the_frozen_baseline_is_not_updated_by_later_days(session, ten_days):
    patient, _ = ten_days
    rows = list(await session.scalars(select(Baseline).where(Baseline.patient_id == patient.id)))
    assert all(r.n_days == BASELINE_DAY_COUNT for r in rows)  # frozen at N, Tier 1 rule


# --------------------------------------------------------------------------- stable phase
async def test_no_alert_across_the_stable_days(session, ten_days):
    _, results = ten_days
    stable = results[BASELINE_DAY_COUNT:BASELINE_DAY_COUNT + 3]
    assert len(stable) == 3
    for result in stable:
        assert result.baseline_day is False
        assert result.band.value == "STABLE", result.reason
        assert result.alert_id is None
        assert max(result.deviations.values()) < DEV_THRESHOLD
        assert "normal" in result.explanation_en.lower()

    # Across the whole ten-day run exactly one alert exists, and it is not a stable day.
    alerts = list(await session.scalars(select(Alert)))
    assert len(alerts) == 1
    alerted_sample_ids = {
        await session.scalar(select(Score.sample_id).where(Score.id == a.score_id))
        for a in alerts
    }
    assert alerted_sample_ids.isdisjoint({r.sample_id for r in stable})


# --------------------------------------------------------------------------- decline phase
async def test_the_first_two_decline_days_are_watch(ten_days):
    _, results = ten_days
    for result in results[7:9]:
        assert result.band.value == "WATCH", result.reason
        assert result.alert_id is None
        assert result.reason == "single-signal or unsustained deviation"


async def test_alert_fires_on_the_third_sustained_decline_day(session, ten_days):
    patient, results = ten_days
    final = results[-1]
    assert final.band.value == "ALERT", final.reason
    assert len(final.modalities_flagged) >= 2
    assert "3+ days" in final.reason
    assert final.alert_id is not None

    alert = await session.get(Alert, final.alert_id)
    assert alert is not None
    assert alert.patient_id == patient.id
    assert alert.band.value == "ALERT"
    assert alert.explanation.startswith("Please check on them today:")
    assert "आज उनका हाल" in alert.explanation_hi
    assert alert.whatsapp_sent is True


async def test_the_alert_names_its_top_drivers(ten_days):
    _, results = ten_days
    final = results[-1]
    assert 1 <= len(final.top_drivers) <= 3
    assert all(z > 0 for _, z in final.top_drivers)
    # drivers are ordered by magnitude
    magnitudes = [z for _, z in final.top_drivers]
    assert magnitudes == sorted(magnitudes, reverse=True)


# --------------------------------------------------------------------------- persistence
async def test_every_day_persists_exactly_one_score_row(session, ten_days):
    patient, results = ten_days
    rows = list(
        await session.scalars(
            select(Score).where(Score.patient_id == patient.id).order_by(Score.created_at)
        )
    )
    assert len(rows) == len(results) == 10
    by_sample = {r.sample_id: r for r in rows}
    for result in results:
        row = by_sample[result.sample_id]
        assert row.band == result.band
        assert row.stability_score == pytest.approx(result.stability_score)
        assert row.voice_dev == pytest.approx(result.deviations["voice"])
        assert row.face_dev == pytest.approx(result.deviations["face"])
        assert row.reaction_dev == pytest.approx(result.deviations["reaction"])
        assert row.explanation_en and row.explanation_hi


async def test_samples_are_marked_done(session, ten_days):
    patient, _ = ten_days
    statuses = list(
        await session.scalars(
            select(DailySample.status).where(DailySample.patient_id == patient.id)
        )
    )
    assert statuses == [SampleStatus.done] * 10


async def test_recomputing_a_day_is_idempotent(session, ten_days):
    patient, results = ten_days
    final = results[-1]

    again = await compute_checkin(session, patient.id, final.sample_id)
    assert again.band == final.band
    assert again.stability_score == pytest.approx(final.stability_score)
    assert again.deviations == pytest.approx(final.deviations)

    assert await session.scalar(select(func.count()).select_from(Score)) == 10
    assert await session.scalar(select(func.count()).select_from(Alert)) == 1


# --------------------------------------------------------------------------- degraded capture
async def test_a_failed_capture_is_dropped_from_the_score_not_counted_as_perfect(session):
    """If the webcam fails, the day is still scored from voice + reaction."""
    patient = await _make_patient(session)
    rng = make_rng(42)

    for day_index in range(BASELINE_DAY_COUNT):
        await compute_checkin(
            session,
            patient.id,
            (await _add_day(session, patient, day_index, _day_features(rng, 0.0))).id,
        )

    features = _day_features(rng, 2.2)
    features[Modality.face] = {"valid": 0.0, "frames_detected": 2.0}
    sample = await _add_day(session, patient, BASELINE_DAY_COUNT, features)
    result = await compute_checkin(session, patient.id, sample.id)

    assert result.valid_modalities == {"voice": True, "face": False, "reaction": True}
    assert result.deviations["face"] == 0.0
    assert result.deviations["voice"] > DEV_THRESHOLD
    assert result.deviations["reaction"] > DEV_THRESHOLD
    # the failed modality is renormalised away rather than diluting the score toward zero
    assert result.stability_score > 70.0
    assert result.band.value == "WATCH"  # high score, but not yet sustained -> capped


async def test_a_completely_failed_capture_scores_stable_and_never_alerts(session):
    patient = await _make_patient(session)
    rng = make_rng(42)
    for day_index in range(BASELINE_DAY_COUNT):
        await compute_checkin(
            session,
            patient.id,
            (await _add_day(session, patient, day_index, _day_features(rng, 0.0))).id,
        )

    dead = {m: {"valid": 0.0} for m, _ in KEYSETS}
    sample = await _add_day(session, patient, BASELINE_DAY_COUNT, dead)
    result = await compute_checkin(session, patient.id, sample.id)

    assert result.valid_modalities == {"voice": False, "face": False, "reaction": False}
    assert result.band.value == "STABLE"
    assert result.alert_id is None


async def test_compute_checkin_rejects_a_sample_from_another_patient(session):
    a = await _make_patient(session)
    b = User(email="b@example.com", pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(b)
    await session.flush()
    other = Patient(caregiver_id=b.id, name="Other")
    session.add(other)
    await session.commit()

    rng = make_rng(42)
    sample = await _add_day(session, a, 0, _day_features(rng, 0.0))
    with pytest.raises(ValueError):
        await compute_checkin(session, other.id, sample.id)
