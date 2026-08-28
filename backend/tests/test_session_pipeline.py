"""The full pipeline through a real database — TRD §10.

The headline test is the 21-day simulation the PRD sets as its acceptance criterion:
14 baseline days, 4 stable days producing **zero** alerts, then 3 declining days producing
**exactly one** alert with a correct, confounder-annotated explanation.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.auth.password import hash_password
from app.engine.baseline import LOCK_AT_N_SESSIONS
from app.exam.registry import DAILY_MODULES, MODULES
from app.models import (
    Alert,
    Band,
    Baseline,
    BaselineReview,
    BaselineReviewAction,
    BaselineState,
    Deviation,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    Score,
    SessionType,
    StrokeSide,
    User,
)
from app.services.baseline_review import record_review
from app.services.session_pipeline import compute_session
from app.services.synthetic import (
    BASELINE_DAYS,
    DECLINE_DRIFTS,
    DEMO_PLAN,
    STABLE_DAYS,
    make_rng,
    synthetic_session,
)

DECLINING = ["M4", "M7", "M1"]     # speech + motor + face: two independent domains and more
START = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)


async def make_patient(session, **kw) -> Patient:
    caregiver = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67, sex="male",
        stroke_date=START - timedelta(days=150), stroke_side=StrokeSide.left,
        languages=["hi", "en"], preferred_hour=9.0, **kw,
    )
    session.add(patient)
    await session.commit()
    return patient


async def _confirm_baseline(session, patient) -> None:
    """Drive the Part 3 doctor gate. Modules locking is now a request for review, not a
    lock — the monitoring phase (bands, alerts, the frozen reference) does not begin until
    a clinician confirms."""
    clinician = User(email=f"dr-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.clinician)
    session.add(clinician)
    await session.flush()
    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)
    await session.commit()


async def run_day(session, patient: Patient, day: int, drift: float,
                  *, drift_modules=None, quality: float = 1.0,
                  identity: bool = True, hour: int = 9) -> dict:
    rng_local = make_rng(1000 + day)
    exam = ExamSession(
        patient_id=patient.id, ts=START + timedelta(days=day, hours=hour - 9),
        type=SessionType.daily_pulse, quality_score=quality, identity_verified=identity,
    )
    session.add(exam)
    await session.flush()

    features = synthetic_session(rng_local, list(DAILY_MODULES), drift,
                                 drift_modules=drift_modules)
    for code, feats in features.items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=feats,
                                 quality_flag=quality >= 0.6))
    await session.commit()
    return await compute_session(session, exam.id)


@pytest.fixture
async def twenty_one_days(session):
    """The PRD acceptance scenario, run once.

    Part 3: modules locking is a request for review, not a lock — so as soon as the doctor
    gate opens (patient reaches DOCTOR_REVIEW_PENDING), a clinician confirms immediately.
    That is the scenario this simulation models: the baseline phase ends, a doctor signs
    off, and the stable/decline days that follow are real monitoring, not still-suppressed
    sessions that would otherwise render every band "STABLE" regardless of the drift fed in.
    """
    patient = await make_patient(session)
    rng = make_rng(42)
    results = []
    confirmed = False
    for day, (_label, drift) in enumerate(DEMO_PLAN):
        exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day),
                           type=SessionType.daily_pulse)
        session.add(exam)
        await session.flush()
        feats = synthetic_session(rng, list(DAILY_MODULES), drift,
                                  drift_modules=DECLINING if drift else None)
        for code, f in feats.items():
            session.add(ModuleResult(session_id=exam.id, module_code=code,
                                     domain=MODULES[code].domain, features_json=f))
        await session.commit()
        results.append(await compute_session(session, exam.id))
        if not confirmed and patient.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING:
            await _confirm_baseline(session, patient)
            confirmed = True
    assert confirmed, "the baseline never reached DOCTOR_REVIEW_PENDING across all 21 days"
    await session.refresh(patient)
    return patient, results


# --------------------------------------------------------------------------- the 21 days
async def test_the_twenty_one_day_simulation(session, twenty_one_days):
    """PRD §8: zero alerts across the stable week, exactly one on sustained decline."""
    patient, results = twenty_one_days
    bands = [r["band"] for r in results]
    assert len(results) == 21

    # --- the baseline phase: recorded, never judged ---
    for result in results[:BASELINE_DAYS]:
        assert result["baseline_phase"] is True
        assert result["band"] == "STABLE"
        assert result["alert_id"] is None
        assert "still learning" in result["explanation_en"].lower()

    # --- the stable days: this is the false-alarm test ---
    stable = results[BASELINE_DAYS:BASELINE_DAYS + STABLE_DAYS]
    assert all(r["band"] == "STABLE" for r in stable), bands
    assert all(r["alert_id"] is None for r in stable)
    assert all(r["baseline_phase"] is False for r in stable)

    # --- the decline escalates through WATCH into ALERT ---
    decline = results[BASELINE_DAYS + STABLE_DAYS:]
    assert len(decline) == len(DECLINE_DRIFTS)
    assert decline[0]["band"] == "WATCH", decline[0]["reason"]
    assert decline[1]["band"] == "ALERT", decline[1]["reason"]
    assert decline[-1]["band"] == "ALERT"

    # --- exactly one alert row for the whole episode ---
    assert await session.scalar(select(func.count()).select_from(Alert)) == 1

    alert = await session.scalar(select(Alert))
    assert alert.band is Band.ALERT
    assert alert.explanation_en and alert.explanation_hi
    assert alert.explanation_en != alert.explanation_hi
    assert alert.clinician_line
    assert "median/MAD baseline" in alert.clinician_line

    # --- and the patient's baseline actually locked, via a recorded doctor CONFIRM ---
    assert patient.baseline_state is BaselineState.LOCKED
    assert await session.scalar(
        select(func.count()).select_from(BaselineReview)
        .where(BaselineReview.patient_id == patient.id,
               BaselineReview.action == BaselineReviewAction.CONFIRM)
    ) == 1


async def test_the_alert_names_the_specific_findings_that_changed(twenty_one_days):
    _, results = twenty_one_days
    final = results[-1]
    assert final["drivers"], "an alert with no named driver is not explainable"
    assert "What changed" in final["explanation_en"]


async def test_the_alert_requires_two_independent_domains(twenty_one_days):
    _, results = twenty_one_days
    final = results[BASELINE_DAYS + STABLE_DAYS + 1]
    assert final["gate1_passed"] is True
    assert final["gate2_passed"] is True
    assert len(final["persistent_domains"]) >= 2


async def test_confounders_are_annotated_on_every_score(twenty_one_days):
    _, results = twenty_one_days
    for result in results:
        assert "active" in result["confounders"]
        assert 0.0 < result["confidence"] <= 1.0


async def test_baselines_lock_per_module_with_the_practice_discard(session, twenty_one_days):
    patient, _ = twenty_one_days
    rows = list(await session.scalars(
        select(Baseline).where(Baseline.patient_id == patient.id)))
    assert {r.module_code for r in rows} == set(DAILY_MODULES)
    for row in rows:
        assert row.locked is True
        assert row.n_sessions >= LOCK_AT_N_SESSIONS
        assert row.n_discarded == 3          # the practice sessions
        assert row.median_json and row.mad_json
        assert all(v > 0 for v in row.mad_json.values())


async def test_deviations_are_persisted_per_module(session, twenty_one_days):
    patient, results = twenty_one_days
    final_session = uuid.UUID(results[-1]["session_id"])
    rows = list(await session.scalars(
        select(Deviation).where(Deviation.session_id == final_session)))
    assert {r.module_code for r in rows} == set(DAILY_MODULES)
    assert any(r.mean_abs_z > 0 for r in rows)
    assert all(r.rci_json for r in rows)


async def test_every_session_produces_exactly_one_score(session, twenty_one_days):
    _, results = twenty_one_days
    assert await session.scalar(select(func.count()).select_from(Score)) == len(results)


async def test_recomputing_a_session_is_idempotent(session, twenty_one_days):
    patient, results = twenty_one_days
    final = uuid.UUID(results[-1]["session_id"])

    before_scores = await session.scalar(select(func.count()).select_from(Score))
    before_alerts = await session.scalar(select(func.count()).select_from(Alert))

    again = await compute_session(session, final)
    assert again["band"] == results[-1]["band"]

    assert await session.scalar(select(func.count()).select_from(Score)) == before_scores
    assert await session.scalar(select(func.count()).select_from(Alert)) == before_alerts


# --------------------------------------------------------------------------- gate behaviour
async def test_a_single_deviating_domain_never_alerts(session):
    """Gate 2 in the real pipeline: speech alone, sustained, must stay WATCH."""
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)
    await _confirm_baseline(session, patient)

    bands = []
    for day in range(LOCK_AT_N_SESSIONS + 3, LOCK_AT_N_SESSIONS + 8):
        result = await run_day(session, patient, day, 2.8, drift_modules=["M4"])
        bands.append(result["band"])

    assert "ALERT" not in bands, bands
    assert "WATCH" in bands
    assert await session.scalar(select(func.count()).select_from(Alert)) == 0


async def test_two_deviating_domains_do_alert(session):
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)
    await _confirm_baseline(session, patient)

    bands = [
        (await run_day(session, patient, day, 2.8, drift_modules=["M4", "M7"]))["band"]
        for day in range(LOCK_AT_N_SESSIONS + 3, LOCK_AT_N_SESSIONS + 8)
    ]
    assert "ALERT" in bands, bands


async def test_a_single_bad_day_does_not_alert(session):
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)
    await _confirm_baseline(session, patient)

    spike = await run_day(session, patient, LOCK_AT_N_SESSIONS + 3, 3.0)
    assert spike["band"] != "ALERT"
    recovered = await run_day(session, patient, LOCK_AT_N_SESSIONS + 4, 0.0)
    assert recovered["band"] == "STABLE"


async def test_improvement_never_alerts(session):
    """A recovering patient deviates hugely from a baseline taken when they were worse."""
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)
    await _confirm_baseline(session, patient)

    bands = [
        (await run_day(session, patient, day, -2.8))["band"]
        for day in range(LOCK_AT_N_SESSIONS + 3, LOCK_AT_N_SESSIONS + 8)
    ]
    assert "ALERT" not in bands, bands
    assert await session.scalar(select(func.count()).select_from(Alert)) == 0


# --------------------------------------------------------------------------- quality gating
async def test_a_poor_quality_session_is_flagged_and_kept_out_of_the_baseline(session):
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)

    bad = await run_day(session, patient, LOCK_AT_N_SESSIONS + 3, 0.0, quality=0.2)
    assert "low_quality_capture" in bad["confounders"]["active"]
    assert bad["confidence"] < 1.0


async def test_an_unverified_identity_is_annotated(session):
    """FR7: proxy testing must not silently become someone else's baseline."""
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)

    result = await run_day(session, patient, LOCK_AT_N_SESSIONS + 3, 0.0, identity=False)
    assert "identity_uncertain" in result["confounders"]["active"]
    assert result["confidence"] < 0.7


async def test_an_off_window_session_is_tagged(session):
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)

    late = await run_day(session, patient, LOCK_AT_N_SESSIONS + 3, 0.0, hour=21)
    assert "off_window_time" in late["confounders"]["active"]


# --------------------------------------------------------------------------- explanation
async def test_the_explanation_is_deterministic_without_a_model(twenty_one_days):
    _, results = twenty_one_days
    assert all(r["explanation_source"] == "template" for r in results)
    assert all(r["guardrail_violations"] == [] for r in results)


async def test_a_misbehaving_model_cannot_change_the_band(session):
    """TRD §7: the rendered band must always equal the engine's band."""
    patient = await make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await run_day(session, patient, day, 0.0)

    exam = ExamSession(patient_id=patient.id,
                       ts=START + timedelta(days=LOCK_AT_N_SESSIONS + 3))
    session.add(exam)
    await session.flush()
    feats = synthetic_session(make_rng(7), list(DAILY_MODULES), 0.0)
    for code, f in feats.items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=f))
    await session.commit()

    def rogue(_system, _user):
        return "You are fine, contact their doctor immediately, risk is 87%."

    result = await compute_session(session, exam.id, generate=rogue)
    assert result["band"] == "STABLE"                      # the engine's verdict stands
    assert result["explanation_source"] == "template"      # the model's output was rejected
    assert result["guardrail_violations"]
    assert "87" not in result["explanation_en"]
    assert "you are fine" not in result["explanation_en"].lower()


async def test_compute_session_rejects_a_session_with_no_modules(session):
    patient = await make_patient(session)
    exam = ExamSession(patient_id=patient.id, ts=START)
    session.add(exam)
    await session.commit()
    with pytest.raises(ValueError, match="no module results"):
        await compute_session(session, exam.id)
