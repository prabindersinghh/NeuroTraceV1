"""Gate 3 — laterality, PD exclusion, and the atypical-pattern band.

The hole this closes: Parkinson's degrades face, movement and voice simultaneously and
symmetrically. Under persistence + cross-modality alone, a PD patient trips three domains
at once and produces this system's *highest-confidence* ALERT — for a condition it does not
monitor and cannot help with.

Three domains agreeing looks like overwhelming evidence. It would be overwhelming evidence
of the wrong thing.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.auth.password import hash_password
from app.engine.baseline import ENROLMENT_MIN_DAYS_POST_STROKE, EnrolmentError, check_enrolment
from app.engine.deviation import LATERAL_THRESHOLD, ModuleDeviation, compute_module_deviation
from app.engine.baseline import LOCK_AT_N_SESSIONS, Baseline
from app.engine.gates import (
    BAND_ALERT,
    BAND_ATYPICAL,
    BAND_STABLE,
    BAND_WATCH,
    DEV_THRESHOLD,
    PARKINSONIAN_TRIAD,
    SessionDeviations,
    detect_symmetric_pattern,
    evaluate_gates,
    is_lateralised,
)
from app.exam.registry import MODULES
from app.models import (
    Alert,
    Band,
    BaselineReviewAction,
    ClinicianRole,
    ConsentType,
    ExamSession,
    ModuleResult,
    Patient,
    PatientClinicianLink,
    Role,
    SessionType,
    StrokeSide,
    User,
)
from app.services.baseline_review import record_review
from app.services.session_pipeline import compute_session
from app.services.synthetic import make_rng, synthetic_session

START = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
HIGH, LOW = DEV_THRESHOLD + 1.5, 0.5

# The daily modules that carry laterality, and the one that does not.
FOCAL_MODULES = ["M1", "M7"]          # face + hand: both have asymmetry features
SPEECH_MODULE = "M4"                  # no left/right axis at all
PD_MODULES = ["M1", "M7", "M4"]       # the parkinsonian triad's daily modules


# --------------------------------------------------------------------------- registry
def test_speech_declares_no_laterality():
    """Speech has no left/right axis, so it can never establish a focal deficit."""
    assert MODULES["M4"].lateral_keys == ()
    assert MODULES["M10"].lateral_keys == ()


def test_face_and_hand_declare_asymmetry_features():
    assert "mouth_corner_symmetry" in MODULES["M1"].lateral_keys
    assert "forehead_movement_symmetry" in MODULES["M1"].lateral_keys
    assert "tap_asymmetry_ratio" in MODULES["M7"].lateral_keys
    # ...and absolute levels are NOT laterality features: bradykinesia moves those.
    assert "tap_rate_mean" not in MODULES["M7"].lateral_keys
    assert "tap_rate_L" not in MODULES["M7"].lateral_keys


# --------------------------------------------------------------------------- deviation
def _baseline(keys, median=10.0, mad=1.0) -> Baseline:
    return Baseline(
        module_code="M7",
        median={k: median for k in keys},
        mad={k: mad for k in keys},
        locked=True, n_sessions=LOCK_AT_N_SESSIONS,
    )


def test_symmetric_change_raises_deviation_but_not_laterality():
    """The core mechanic: both sides degrade, the ratio between them does not."""
    keys = ["tap_rate_L", "tap_rate_R", "tap_rate_mean", "tap_asymmetry_ratio"]
    features = {
        "tap_rate_L": 2.0, "tap_rate_R": 2.0, "tap_rate_mean": 2.0,  # both hands slowed
        "tap_asymmetry_ratio": 10.0,                                  # ...equally
    }
    dev = compute_module_deviation(
        "M7", "motor", features, _baseline(keys), keys,
        lateral_keys=("tap_asymmetry_ratio",),
    )
    assert dev.mean_abs_z > DEV_THRESHOLD      # the module clearly deviates
    assert dev.lateral_abs_z == pytest.approx(0.0, abs=1e-9)
    assert dev.lateralised is False
    assert is_lateralised(dev) is False


def test_one_sided_change_raises_laterality():
    keys = ["tap_rate_L", "tap_rate_R", "tap_rate_mean", "tap_asymmetry_ratio"]
    features = {
        "tap_rate_L": 2.0, "tap_rate_R": 10.0, "tap_rate_mean": 6.0,  # one hand only
        "tap_asymmetry_ratio": 20.0,
    }
    dev = compute_module_deviation(
        "M7", "motor", features, _baseline(keys), keys,
        lateral_keys=("tap_asymmetry_ratio",),
    )
    assert dev.lateral_abs_z > LATERAL_THRESHOLD
    assert dev.lateralised is True
    assert is_lateralised(dev) is True


def test_a_module_with_no_asymmetry_features_is_never_lateralised():
    keys = ["jitter_local", "hnr", "pause_ratio"]
    features = {k: 1e6 for k in keys}       # absurdly deviant speech
    dev = compute_module_deviation(
        "M4", "motor_speech", features, _baseline(keys), keys, lateral_keys=(),
    )
    assert dev.mean_abs_z > DEV_THRESHOLD
    assert dev.has_laterality is False
    assert is_lateralised(dev) is False


# --------------------------------------------------------------------------- gate logic
def _session(devs: dict[str, float], lateral: dict[str, float] | None = None,
             valid: bool = True) -> SessionDeviations:
    """Build a session where each domain has a deviation and an asymmetry deviation."""
    lateral = lateral or {}
    container = SessionDeviations(session_id="s", valid=valid)
    for i, (domain, value) in enumerate(devs.items()):
        lat = lateral.get(domain, 0.0)
        container.modules[f"M{i}"] = ModuleDeviation(
            module_code=f"M{i}", domain=domain, mean_abs_z=value, computed=True,
            has_laterality=domain in lateral,
            lateral_abs_z=lat, lateralised=lat > LATERAL_THRESHOLD,
        )
    return container


def test_two_domains_with_a_lateralised_finding_alert():
    """The stroke case: one-sided face plus one-sided hand. This must still fire."""
    session = _session(
        {"cranial_nerves": HIGH, "motor": HIGH},
        lateral={"cranial_nerves": HIGH, "motor": HIGH},
    )
    result = evaluate_gates([session] * 3)
    assert result.band == BAND_ALERT
    assert result.gate1_passed and result.gate2_passed and result.gate3_passed
    assert set(result.lateralised_domains) == {"cranial_nerves", "motor"}
    assert "one-sided" in result.reason


def test_two_domains_with_no_lateralised_finding_do_not_alert():
    """Gate 3. Two domains agree, but the change is symmetric — not our pattern."""
    session = _session(
        {"cranial_nerves": HIGH, "cognition": HIGH},
        lateral={"cranial_nerves": 0.2},      # face has laterality, but it is flat
    )
    result = evaluate_gates([session] * 3)
    assert result.band == BAND_WATCH
    assert result.gate2_passed is True
    assert result.gate3_passed is False
    assert result.lateralised_domains == []
    assert "not one-sided" in result.reason


def test_speech_plus_a_symmetric_face_does_not_satisfy_gate_two():
    """Explicitly required by the amendment: speech can corroborate, never establish."""
    session = _session(
        {"motor_speech": HIGH, "cranial_nerves": HIGH},
        lateral={"cranial_nerves": 0.3},      # symmetric facial change
    )
    result = evaluate_gates([session] * 3)
    assert result.band != BAND_ALERT
    assert result.gate3_passed is False


def test_speech_alongside_a_lateralised_face_does_alert():
    """The corroborating role speech IS allowed to play."""
    session = _session(
        {"motor_speech": HIGH, "cranial_nerves": HIGH},
        lateral={"cranial_nerves": HIGH},
    )
    result = evaluate_gates([session] * 3)
    assert result.band == BAND_ALERT
    assert result.lateralised_domains == ["cranial_nerves"]


def test_laterality_must_be_sustained_not_just_present_today():
    """A single session's asymmetry can be head tilt or an awkward grip on the phone."""
    lateral_today = _session({"cranial_nerves": HIGH, "motor": HIGH},
                             lateral={"cranial_nerves": HIGH, "motor": HIGH})
    symmetric_before = _session({"cranial_nerves": HIGH, "motor": HIGH},
                                lateral={"cranial_nerves": 0.2, "motor": 0.2})
    result = evaluate_gates([symmetric_before, lateral_today])
    assert result.gate3_passed is False
    assert result.band != BAND_ALERT


# --------------------------------------------------------------------------- PD pattern
def test_the_parkinsonian_triad_is_detected_and_does_not_alert():
    """Face + movement + voice, symmetric, progressive. The whole point of this work."""
    window = [
        _session({"cranial_nerves": HIGH, "motor": HIGH, "motor_speech": HIGH},
                 lateral={"cranial_nerves": 0.3, "motor": 0.3})
        for _ in range(3)
    ]
    result = evaluate_gates(window)

    assert result.band == BAND_ATYPICAL
    assert result.band != BAND_ALERT
    assert result.symmetric_pattern is True
    assert result.gate3_passed is False
    assert "symmetrically" in result.reason


def test_detect_symmetric_pattern_requires_all_three_domains():
    window = [
        _session({"cranial_nerves": HIGH, "motor": HIGH},
                 lateral={"cranial_nerves": 0.3, "motor": 0.3})
        for _ in range(3)
    ]
    assert detect_symmetric_pattern(window, ["cranial_nerves", "motor"]) is False


def test_detect_symmetric_pattern_is_ruled_out_by_any_lateralised_finding():
    """If anything is one-sided, this is a focal deficit and must alert instead."""
    window = [
        _session({"cranial_nerves": HIGH, "motor": HIGH, "motor_speech": HIGH},
                 lateral={"cranial_nerves": HIGH, "motor": 0.3})
        for _ in range(3)
    ]
    assert detect_symmetric_pattern(window, list(PARKINSONIAN_TRIAD)) is False
    assert evaluate_gates(window).band == BAND_ALERT


def test_a_resolving_symmetric_dip_is_not_the_pattern():
    """Progressive, not transient. A dip already recovering is not a degenerative course."""
    window = [
        _session({"cranial_nerves": 6.0, "motor": 6.0, "motor_speech": 6.0},
                 lateral={"cranial_nerves": 0.3, "motor": 0.3}),
        _session({"cranial_nerves": 2.2, "motor": 2.2, "motor_speech": 2.2},
                 lateral={"cranial_nerves": 0.3, "motor": 0.3}),
    ]
    assert detect_symmetric_pattern(window, list(PARKINSONIAN_TRIAD)) is False


def test_a_quiet_patient_is_still_stable():
    result = evaluate_gates([_session({"cranial_nerves": LOW, "motor": LOW})] * 3)
    assert result.band == BAND_STABLE
    assert result.symmetric_pattern is False


# --------------------------------------------------------------------------- enrolment
def test_enrolment_is_refused_for_a_parkinsons_diagnosis():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    old_enough = now - timedelta(days=ENROLMENT_MIN_DAYS_POST_STROKE + 60)

    check_enrolment(old_enough, now)          # baseline case still works

    with pytest.raises(EnrolmentError, match="movement disorder"):
        check_enrolment(old_enough, now, pd_diagnosis=True)


def test_enrolment_is_refused_for_another_movement_disorder():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    old_enough = now - timedelta(days=ENROLMENT_MIN_DAYS_POST_STROKE + 60)
    with pytest.raises(EnrolmentError, match="movement disorder"):
        check_enrolment(old_enough, now, other_movement_disorder=True)


def test_the_exclusion_message_explains_itself_and_points_somewhere():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    try:
        check_enrolment(now - timedelta(days=200), now, pd_diagnosis=True)
    except EnrolmentError as exc:
        message = str(exc)
    assert "validated only for post-stroke" in message
    assert "neurologist" in message


async def test_the_api_blocks_enrolment_with_a_movement_disorder(client):
    resp = await client.post("/auth/register", json={
        "email": "asha@example.com", "password": "correct-horse-battery",
        "role": "caregiver"})
    token = resp.json()["tokens"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    stroke_date = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()

    blocked = await client.post("/patients", json={
        "name": "Has PD", "stroke_date": stroke_date, "pd_diagnosis": True,
    }, headers=headers)
    assert blocked.status_code == 422
    assert "movement disorder" in blocked.text

    blocked_other = await client.post("/patients", json={
        "name": "Has another", "stroke_date": stroke_date,
        "other_movement_disorder": True,
    }, headers=headers)
    assert blocked_other.status_code == 422

    allowed = await client.post("/patients", json={
        "name": "Eligible", "stroke_date": stroke_date,
    }, headers=headers)
    assert allowed.status_code == 201
    assert allowed.json()["pd_diagnosis"] is False


# --------------------------------------------------------------------------- end to end
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


async def _confirm_baseline(session, patient) -> None:
    """Drive the Part 3 doctor gate. Without it the patient sits at DOCTOR_REVIEW_PENDING,
    bands stay forced STABLE, and there is no frozen reference to score against."""
    clinician = User(email=f"dr-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.clinician)
    session.add(clinician)
    await session.flush()
    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)
    await session.commit()


async def _run_day(session, patient, day, drift, *, modules, lateralised):
    exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day),
                       type=SessionType.daily_pulse)
    session.add(exam)
    await session.flush()
    feats = synthetic_session(make_rng(2000 + day), modules, drift,
                              lateralised=lateralised)
    for code, f in feats.items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=f))
    await session.commit()
    return await compute_session(session, exam.id)


async def test_a_simulated_parkinsons_course_never_alerts(session):
    """Five sessions of symmetric decline across face, movement and voice."""
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=PD_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)

    bands = []
    for i, drift in enumerate([1.8, 2.2, 2.6, 3.0, 3.4]):
        result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                                modules=PD_MODULES, lateralised=False)
        bands.append(result["band"])

    assert "ALERT" not in bands, bands
    assert BAND_ATYPICAL in bands, bands
    # ...and no alert row was ever written.
    assert await session.scalar(select(func.count()).select_from(Alert)) == 0


async def test_a_simulated_stroke_course_still_alerts(session):
    """The control: the same magnitudes, but one-sided. This must fire."""
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=FOCAL_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)

    bands = []
    for i, drift in enumerate([1.8, 2.2, 2.6, 3.0, 3.4]):
        result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                                modules=FOCAL_MODULES, lateralised=True)
        bands.append(result["band"])

    assert "ALERT" in bands, bands
    assert await session.scalar(select(func.count()).select_from(Alert)) >= 1


async def test_the_atypical_band_is_persisted_and_explained(session):
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=PD_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)

    result = None
    for i, drift in enumerate([2.2, 2.6, 3.0]):
        result = await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                                modules=PD_MODULES, lateralised=False)

    assert result["band"] == BAND_ATYPICAL
    assert result["symmetric_pattern"] is True
    assert result["gate3_passed"] is False
    assert result["alert_id"] is None
    assert "focal (one-sided) deficit" in result["explanation_en"]
    assert "doctor" in result["explanation_en"]
    # The clinician line names the pattern and says what was NOT done.
    assert "not focal" in result["clinician_line"]
    assert "No stroke-monitoring alert raised" in result["clinician_line"]


async def test_the_band_enum_accepts_the_new_value(session):
    """The migration widened the CHECK constraint; make sure a row can actually store it."""
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=PD_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)
    for i, drift in enumerate([2.2, 2.6, 3.0]):
        await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                       modules=PD_MODULES, lateralised=False)

    from app.models import Score

    bands = list(await session.scalars(select(Score.band)))
    assert Band.PATTERN_ATYPICAL in bands


# --------------------------------------------------------------------------- clinic card
async def _clinic_rows(session, patient):
    """Call the clinician roster route directly.

    Building 20 sessions of history over HTTP would be slow and would test the exam
    endpoints rather than the roster. Calling the route function exercises the real
    card-typing logic against DB state built in-process.

    Part 3.2 scopes the roster to active `patient_clinician_links`, so the clinician must
    be explicitly linked here or the roster comes back empty regardless of what the
    patient's cards should look like. Part 4 additionally requires CLINICIAN_SHARING (C3)
    to be in force — the real `/clinician/links` route grants it in the same transaction
    as the link, so this direct-ORM construction must do the same or the roster comes back
    empty for a different reason than the one each test is actually checking.
    """
    from app.routers.dashboard import clinic_patients
    from app.services.consent import set_consent

    clinician = User(email=f"dr-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.clinician)
    session.add(clinician)
    await session.flush()
    session.add(PatientClinicianLink(
        patient_id=patient.id, clinician_id=clinician.id,
        clinician_role=ClinicianRole.TREATING_PHYSICIAN, linked_by=patient.caregiver_id,
    ))
    await set_consent(session, patient, ConsentType.CLINICIAN_SHARING, True,
                      patient.caregiver_id)
    await session.commit()
    return (await clinic_patients(clinician, session)).patients


async def test_the_atypical_pattern_gets_its_own_clinician_card(session):
    """TRD §6: a distinct card, not a deviation alert.

    Rendering it as a deviation would defeat the point of detecting it — the useful action
    is a different diagnostic conversation, not a stroke work-up.
    """
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=PD_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)
    for i, drift in enumerate([2.2, 2.6, 3.0]):
        await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                       modules=PD_MODULES, lateralised=False)

    row = next(r for r in await _clinic_rows(session, patient) if r.patient_id == patient.id)

    assert row.band is Band.PATTERN_ATYPICAL
    assert row.card_type == "atypical_pattern"
    assert row.card_type != "deviation"
    assert row.lateralised_domains == []
    assert "not a focal pattern" in (row.card_note or "").lower()
    assert row.unacknowledged_alerts == 0      # nothing was raised as an alert


async def test_a_focal_finding_still_gets_the_deviation_card(session):
    patient = await _make_patient(session)
    for day in range(LOCK_AT_N_SESSIONS + 3):
        await _run_day(session, patient, day, 0.0, modules=FOCAL_MODULES, lateralised=True)
    await _confirm_baseline(session, patient)
    for i, drift in enumerate([2.2, 2.6, 3.0, 3.4]):
        await _run_day(session, patient, LOCK_AT_N_SESSIONS + 3 + i, drift,
                       modules=FOCAL_MODULES, lateralised=True)

    row = next(r for r in await _clinic_rows(session, patient) if r.patient_id == patient.id)

    assert row.card_type == "deviation"
    assert row.card_note is None
    assert row.lateralised_domains, "a focal alert must name where the change is one-sided"


def test_the_atypical_band_is_not_ranked_below_stable():
    """It is not an emergency, but burying it under STABLE would hide the one finding the
    engine deliberately declined to alert on."""
    from app.routers.dashboard import clinic_patients  # noqa: F401  (import guard)
    import inspect

    source = inspect.getsource(clinic_patients)
    assert '"PATTERN_ATYPICAL": 1' in source


# --------------------------------------------------------------------------- messaging
def test_the_atypical_band_has_its_own_slm_instruction():
    """Without one it fell through to STABLE — calm reassurance for a progressive finding."""
    from app.slm.prompt import _BAND_INSTRUCTION

    assert "PATTERN_ATYPICAL" in _BAND_INSTRUCTION
    instruction = _BAND_INSTRUCTION["PATTERN_ATYPICAL"].lower()
    assert instruction != _BAND_INSTRUCTION["STABLE"].lower()
    assert "one-sided" in instruction
    assert "doctor" in instruction


def test_the_guardrail_rejects_both_ways_of_getting_this_band_wrong():
    from app.slm.guardrail import _BAND_CONTRADICTIONS

    banned = _BAND_CONTRADICTIONS["PATTERN_ATYPICAL"]
    assert "no change" in banned      # cannot reassure: something IS changing
    assert "stroke" in banned         # cannot imply a focal finding: there is none


@pytest.mark.parametrize("lang", ["en", "hi", "pa"])
def test_the_atypical_message_renders_and_passes_its_own_guardrail(lang):
    from app.slm.guardrail import _BAND_CONTRADICTIONS
    from app.slm.templates import render_template

    text = render_template("PATTERN_ATYPICAL", [], [], lang)
    assert text.strip()
    hits = [p for p in _BAND_CONTRADICTIONS["PATTERN_ATYPICAL"] if p in text.lower()]
    assert hits == [], f"our own template trips the guardrail in {lang}: {hits}"


def test_the_atypical_message_says_the_required_thing():
    from app.slm.templates import render_template

    text = render_template("PATTERN_ATYPICAL", [], [], "en")
    assert "not consistent with a focal (one-sided) deficit" in text
    assert "discuss other neurological causes with your doctor" in text
