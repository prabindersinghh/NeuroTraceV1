"""Domain split (dysarthria vs aphasia) and the frozen reference baseline.

Two independent corrections, tested together because both change what the engine can see.

THE SPLIT. `speech_language` held both M4 (dysarthria — motor, message intact) and M5
(aphasia — the message itself is damaged). Two modules in one domain can never corroborate
each other under Gate 2, so a patient whose speech got slurrier *and* whose word-finding got
worse registered as one domain moving. Split, that is two independent domains agreeing.

THE FROZEN REFERENCE. The adaptive baseline follows the patient. Over a slow decline it
walks down with them and the z-score never moves — the engine tracks them to the floor in
silence. The test that matters here is the 60-day one.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.password import hash_password
from app.engine.baseline import LOCK_AT_N_SESSIONS
from app.engine.deviation import LATERAL_THRESHOLD, ModuleDeviation
from app.engine.gates import (
    BAND_ALERT,
    BAND_WATCH,
    DEV_THRESHOLD,
    DOMAINS,
    NON_LATERALISABLE_DOMAINS,
    PARKINSONIAN_TRIAD,
    SessionDeviations,
    evaluate_gates,
)
from app.exam.registry import MODULES
from app.models import Baseline as BaselineRow
from app.models import ExamSession, ModuleResult, Patient, Role, SessionType, StrokeSide, User
from app.services.session_pipeline import compute_session
from app.services.synthetic import make_rng, synthetic_session

START = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
HIGH = DEV_THRESHOLD + 1.5


# ------------------------------------------------------------------ the split
def test_dysarthria_and_aphasia_are_separate_domains():
    assert MODULES["M4"].domain == "motor_speech"
    assert MODULES["M5"].domain == "language"
    assert MODULES["M4"].domain != MODULES["M5"].domain
    assert "motor_speech" in DOMAINS.values()
    assert "language" in DOMAINS.values()
    assert "speech_language" not in DOMAINS.values()


def test_neither_speech_domain_can_establish_laterality():
    """Splitting the domain must not create a back door through Gate 3."""
    assert "motor_speech" in NON_LATERALISABLE_DOMAINS
    assert "language" in NON_LATERALISABLE_DOMAINS
    assert MODULES["M4"].lateral_keys == ()
    assert MODULES["M5"].lateral_keys == ()


def test_the_parkinsonian_triad_tracks_motor_speech_not_language():
    """Hypophonia is a motor speech problem. Parkinsonian language is typically spared."""
    assert "motor_speech" in PARKINSONIAN_TRIAD
    assert "language" not in PARKINSONIAN_TRIAD


def _session(devs: dict[str, float], lateral: dict[str, float] | None = None):
    lateral = lateral or {}
    container = SessionDeviations(session_id="s")
    for i, (domain, value) in enumerate(devs.items()):
        lat = lateral.get(domain, 0.0)
        container.modules[f"M{i}"] = ModuleDeviation(
            module_code=f"M{i}", domain=domain, mean_abs_z=value, computed=True,
            has_laterality=domain in lateral,
            lateral_abs_z=lat, lateralised=lat > LATERAL_THRESHOLD,
        )
    return container


def test_the_two_speech_domains_are_counted_independently():
    """Before the split this was one domain and Gate 2 could not pass on it alone."""
    result = evaluate_gates(
        [_session({"motor_speech": HIGH, "language": HIGH})] * 3)
    assert set(result.persistent_domains) == {"motor_speech", "language"}
    assert result.gate2_passed is True, "two speech domains must corroborate each other"


def test_dysarthria_plus_aphasia_alone_cannot_alert():
    """The split strengthens Gate 2 without weakening Gate 3.

    Slurred speech and lost words together is real and worth watching — but neither has a
    left/right axis, so nothing here says the change is focal.
    """
    result = evaluate_gates(
        [_session({"motor_speech": HIGH, "language": HIGH})] * 3)
    assert result.gate2_passed is True
    assert result.gate3_passed is False
    assert result.band == BAND_WATCH
    assert result.band != BAND_ALERT


def test_either_speech_domain_alongside_a_lateralised_finding_alerts():
    for speech_domain in ("motor_speech", "language"):
        result = evaluate_gates(
            [_session({speech_domain: HIGH, "cranial_nerves": HIGH},
                      lateral={"cranial_nerves": HIGH})] * 3)
        assert result.band == BAND_ALERT, speech_domain
        assert result.lateralised_domains == ["cranial_nerves"]


@pytest.mark.parametrize("lang", ["en", "hi", "pa"])
def test_the_caregiver_text_distinguishes_the_two(lang):
    """"Speech sounded less clear" and "finding words was harder" are different things to
    tell a family, and lead to different conversations with a doctor."""
    from app.slm.templates import domain_phrase

    motor = domain_phrase("motor_speech", lang)
    language = domain_phrase("language", lang)
    assert motor and language
    assert motor != language


def test_the_english_domain_phrases_say_what_they_mean():
    from app.slm.templates import domain_phrase

    assert "speech" in domain_phrase("motor_speech", "en").lower()
    assert "words" in domain_phrase("language", "en").lower()


# ------------------------------------------------------------------ frozen reference
async def _make_patient(session) -> Patient:
    caregiver = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67,
        stroke_date=START - timedelta(days=150), stroke_side=StrokeSide.left,
        languages=["en"], preferred_hour=9.0,
    )
    session.add(patient)
    await session.commit()
    return patient


async def _run_day(session, patient, day, drift, *, modules, lateralised=True):
    exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day),
                       type=SessionType.daily_pulse)
    session.add(exam)
    await session.flush()
    feats = synthetic_session(make_rng(4000 + day), modules, drift, lateralised=lateralised)
    for code, f in feats.items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=f))
    await session.commit()
    return await compute_session(session, exam.id)


DAILY = ["M1", "M4", "M7"]


async def test_the_reference_is_snapshot_at_lock(session):
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=DAILY)

    rows = list(await session.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)))
    assert rows
    for row in rows:
        assert row.locked is True
        assert row.reference_locked_at is not None, f"{row.module_code} has no snapshot"
        assert row.reference_median_json
        assert row.reference_n_sessions > 0


async def test_the_reference_never_moves_once_taken(session):
    """If this ever became an update, it would inherit the blind spot it exists to cover."""
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=DAILY)

    row = await session.scalar(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id,
                                  BaselineRow.module_code == "M4"))
    frozen = dict(row.reference_median_json)
    frozen_at = row.reference_locked_at
    assert frozen

    # Twenty more sessions, drifting hard.
    for i in range(20):
        await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, 2.0, modules=DAILY)

    await session.refresh(row)
    assert dict(row.reference_median_json) == frozen
    assert row.reference_locked_at == frozen_at


def test_the_frozen_reference_ignores_the_recovery_trajectory():
    """Where the two yardsticks actually diverge.

    The adaptive expectation is `intercept + slope * days` — the fitted recovery trajectory,
    extrapolated forward. That is the adaptive part, and it is what can absorb a decline: if
    the fit says "this feature should keep falling", a patient who keeps falling looks
    exactly as expected forever.

    The frozen reference deliberately carries no trajectory, so its expectation stays flat
    at the normal established at lock, however many days pass.
    """
    from app.engine.baseline import Baseline as EngineBaseline
    from app.engine.baseline import expected_value

    adaptive = EngineBaseline(
        module_code="M4", median={"ddk_rate": 5.0}, mad={"ddk_rate": 0.2},
        trajectory={"ddk_rate": (-0.02, 5.0)},   # fitted to decline 0.02/day
        locked=True, n_sessions=LOCK_AT_N_SESSIONS,
    )
    frozen = EngineBaseline(
        module_code="M4", median={"ddk_rate": 5.0}, mad={"ddk_rate": 0.2},
        trajectory={},                            # frozen: no projection
        locked=True, n_sessions=LOCK_AT_N_SESSIONS,
    )

    # Day 0 they agree; sixty days on, the adaptive expectation has walked down 1.2 units.
    assert expected_value(adaptive, "ddk_rate", 0.0) == pytest.approx(5.0)
    assert expected_value(frozen, "ddk_rate", 0.0) == pytest.approx(5.0)
    assert expected_value(adaptive, "ddk_rate", 60.0) == pytest.approx(3.8)
    assert expected_value(frozen, "ddk_rate", 60.0) == pytest.approx(5.0)

    # A patient who declined exactly along the fitted line is invisible to the adaptive
    # yardstick and six MADs from normal against the frozen one.
    observed = 3.8
    assert observed == pytest.approx(expected_value(adaptive, "ddk_rate", 60.0))
    drift_mads = abs(observed - expected_value(frozen, "ddk_rate", 60.0)) / 0.2
    assert drift_mads > DEV_THRESHOLD


async def test_a_slow_decline_the_adaptive_baseline_absorbs_is_still_caught(session):
    """The failure this whole mechanism exists for.

    Sixty days of decline so gradual that each session sits inside the previous window's
    normal variation. The rolling median walks down with the patient, the adaptive z-score
    stays quiet, and without a fixed yardstick nothing is ever reported.
    """
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=DAILY)

    drift_series: list[float] = []
    result = None
    for i in range(60):
        # Creeps from 0 to ~3 sigma across two months: ~0.05 sigma per day. No single day
        # is remarkable against the one before it.
        result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i,
                                i * 0.05, modules=DAILY)
        drift_series.append(result["cumulative_drift"])

    assert result is not None
    assert drift_series[0] < DEV_THRESHOLD, "day one of the decline should look normal"
    assert drift_series[-1] > drift_series[0], "drift must accumulate"
    assert drift_series[-1] > DEV_THRESHOLD, (
        f"frozen-reference drift only reached {drift_series[-1]:.2f} — a two-month "
        "decline went unmeasured")
    # Monotone enough to read as a trend rather than noise: the last third is all above
    # the threshold, not just the final point.
    tail = drift_series[-20:]
    assert all(d > DEV_THRESHOLD for d in tail), (
        "drift should stay flagged once established, not flicker")


async def test_drift_is_recorded_on_every_score(session):
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=DAILY)
    result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3, 0.0, modules=DAILY)

    assert "cumulative_drift" in result
    assert "cumulative_drift_by_domain" in result
    assert "drift_flagged" in result
    assert set(result["cumulative_drift_by_domain"]) <= {"cranial_nerves", "motor_speech", "motor"}


async def test_a_stable_patient_is_not_drift_flagged(session):
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=DAILY)
    for i in range(5):
        result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, 0.0,
                                modules=DAILY)
        assert result["drift_flagged"] is False
        assert result["cumulative_drift"] < DEV_THRESHOLD
