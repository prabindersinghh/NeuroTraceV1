"""Demo seeding — 21 days of Ramesh, ending in one alert. TRD build plan P7.

Idempotent: reseeding wipes the demo patient and rebuilds the story, so the pitch demo can
be reset between runs without touching any other account.

The decline is deliberately confined to two domains — speech (M4) and motor (M7) — plus
the facial module. That is the honest clinical picture for a left MCA infarct, and it also
demonstrates the thing worth demonstrating: two independent domains agreeing is what
produces an ALERT, and it takes two consecutive sessions to get there.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.password import hash_password
from ..exam.registry import DAILY_MODULES, MODULES, WEEKLY_MODULES
from .baseline_review import record_review
from ..exam.scheduler import session_type_due_today
from ..models import (
    BaselineReviewAction,
    BaselineState,
    Adherence,
    AuditLog,
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
from .consent import set_consent
from .session_pipeline import compute_session
from .synthetic import DEMO_PLAN, make_rng, synthetic_session

logger = logging.getLogger("neurotrace.seed")

DEMO_CAREGIVER_EMAIL = "demo@neurotrace.app"
DEMO_CLINICIAN_EMAIL = "clinician@neurotrace.app"
DEMO_PATIENT_EMAIL = "ramesh@neurotrace.app"
DEMO_ADMIN_EMAIL = "admin@neurotrace.app"
#: Credentials for the seeded demo accounts.
#:
#: Overridable from the environment, and it must be overridden on any deployed instance.
#: This value ships in a public repository, so on a host where DEMO_MODE is true it is a
#: publicly known password — harmless against seeded fixture data, not harmless the moment
#: a real patient is enrolled on the same instance. `DEMO_MODE=false` is the real control;
#: this is the second line of defence.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "neurotrace-demo")
DEMO_PATIENT_NAME = "Ramesh"

# The domains that decline in the story. Speech and motor are independent, which is what
# Gate 2 requires; the facial module rides along because it shares the lesion.
DECLINING_MODULES = ["M4", "M7", "M1"]


async def _get_or_create_user(db: AsyncSession, email: str, role: Role,
                              name: str, lang: str = "en") -> User:
    user = await db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, pw_hash=hash_password(DEMO_PASSWORD),
                    role=role, full_name=name, lang=lang)
        db.add(user)
        await db.flush()
    return user


async def seed_demo(db: AsyncSession) -> dict:
    caregiver = await _get_or_create_user(db, DEMO_CAREGIVER_EMAIL, Role.caregiver,
                                          "Demo Caregiver")
    clinician = await _get_or_create_user(db, DEMO_CLINICIAN_EMAIL, Role.clinician,
                                          "Dr Demo")
    patient_user = await _get_or_create_user(db, DEMO_PATIENT_EMAIL, Role.patient,
                                             DEMO_PATIENT_NAME, lang="pa")
    # The operator account. It has no patient of its own and no clinical read path — the
    # admin endpoints return counts and audit events only.
    await _get_or_create_user(db, DEMO_ADMIN_EMAIL, Role.admin, "Demo Admin")

    # Wipe any previous demo patient so the story always starts clean.
    for old in list(await db.scalars(
        select(Patient).where(Patient.caregiver_id == caregiver.id,
                              Patient.name == DEMO_PATIENT_NAME)
    )):
        await db.delete(old)
    await db.flush()

    now = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
    patient = Patient(
        caregiver_id=caregiver.id, clinician_id=clinician.id, user_id=patient_user.id,
        name=DEMO_PATIENT_NAME, age=67, sex="male",
        # PRD §3: five months post-discharge, comfortably past the 3-month gate.
        stroke_date=now - timedelta(days=152),
        stroke_side=StrokeSide.left,
        languages=["pa", "hi", "en"],
        preferred_hour=9.0,
        education_band="primary",
    )
    db.add(patient)
    await db.flush()

    # Link the demo clinician to the demo patient, and grant C3 — WITHOUT THIS THE DEMO
    # DOCTOR SEES AN EMPTY ROSTER.
    #
    # `patients.clinician_id` above is the legacy column that Part 3.2 superseded; nothing
    # reads it for authorisation any more. Access needs a row here AND current
    # CLINICIAN_SHARING consent (Part 4, D-049). The seed was written before either
    # existed, so when link-scoping landed the demo clinician silently lost every patient
    # — the account still worked, the roster was just empty, and the whole
    # doctor-in-the-loop story became undemonstrable from the demo login.
    #
    # Written the same way `POST /clinician/links` writes it, consent_ref included, so the
    # demo exercises the real path rather than a shortcut around it.
    link = PatientClinicianLink(
        patient_id=patient.id,
        clinician_id=clinician.id,
        clinician_role=ClinicianRole.TREATING_PHYSICIAN,
        linked_by=caregiver.id,
    )
    db.add(link)
    await db.flush()
    consent = await set_consent(
        db, patient, ConsentType.CLINICIAN_SHARING, True, caregiver.id,
        device_context="demo seed",
    )
    link.consent_ref = str(consent.id) if consent is not None else None
    await db.commit()

    first_day = now - timedelta(days=len(DEMO_PLAN) - 1)
    rng = make_rng(42)
    bands: list[str] = []
    #: Counted and returned so the demo's SHAPE is assertable, not just its ending band.
    #: A seed anchored on the wrong reference date produced 21 Comprehensive sessions and
    #: still ended in ALERT — the story looked right while the mechanism was wrong.
    session_type_counts: dict[str, int] = {}
    #: Which day the clinician confirmed. Returned so the demo's SHAPE is assertable —
    #: a seed that silently skipped the doctor gate must be a test failure, not a
    #: surprise in a pitch.
    baseline_confirmed_on_day: int | None = None

    for index, (label, drift) in enumerate(DEMO_PLAN):
        ts = first_day + timedelta(days=index)
        # The two-layer schedule (Part 2.5): most days are a Daily Pulse, and roughly
        # twice a week the patient runs the deeper Comprehensive battery. The alert story
        # is unaffected because it rests entirely on DECLINING_MODULES (M4/M7/M1), all
        # three of which are DAILY-schedule modules present in BOTH session types — so
        # every day still contributes to the drift the demo is built to show.
        # Anchor on `first_day`, NOT `patient.enrolment_date`. The demo backdates its 21
        # sessions but the patient row is created now, so enrolment_date is AFTER every
        # session — which made every day clamp to day 0 and come out COMPREHENSIVE, the
        # opposite of the twice-weekly schedule this is meant to demonstrate. Caught by
        # counting the seeded session types rather than trusting the story still ended in
        # ALERT (it did, which is exactly why this would have shipped unnoticed).
        session_type = session_type_due_today(
            first_day, patient.comprehensive_days_per_week, ts,
        )
        exam = ExamSession(patient_id=patient.id, ts=ts, type=session_type,
                           quality_score=1.0, identity_verified=True)
        db.add(exam)
        await db.flush()

        codes = list(DAILY_MODULES)
        if session_type is SessionType.comprehensive:
            codes += list(WEEKLY_MODULES)
        features = synthetic_session(
            rng, codes, drift,
            drift_modules=DECLINING_MODULES if drift else None,
        )
        for code, feats in features.items():
            db.add(ModuleResult(session_id=exam.id, module_code=code,
                                domain=MODULES[code].domain, features_json=feats,
                                quality_flag=True, extracted_on_device=True))
        db.add(Adherence(patient_id=patient.id, taken=True, ts=ts))
        await db.flush()

        session_type_counts[session_type.value] = (
            session_type_counts.get(session_type.value, 0) + 1
        )
        result = await compute_session(db, exam.id, commit=False)
        bands.append(result["band"])
        logger.info("seed day %2d (%-8s) -> %s", index + 1, label, result["band"])

        # THE DOCTOR GATE (Part 3.3). Once the criteria are met the patient sits at
        # DOCTOR_REVIEW_PENDING and every band stays suppressed until a clinician
        # CONFIRMs — so without this the demo would never leave STABLE and the 21-day
        # story would silently disappear. The demo doctor reviews promptly, which is what
        # a real one is expected to do; the point is that the confirmation EXISTS and is
        # recorded, not that it is instantaneous.
        if patient.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING:
            await record_review(
                db, patient, clinician.id, BaselineReviewAction.CONFIRM,
                note="Demo baseline reviewed and confirmed.",
            )
            baseline_confirmed_on_day = index + 1
            logger.info("seed day %2d -> baseline CONFIRMED by clinician", index + 1)

    db.add(AuditLog(actor_id=caregiver.id, action="demo.seed", patient_id=patient.id,
                    meta_json={"days": len(DEMO_PLAN)}))
    await db.commit()

    return {
        "email": DEMO_CAREGIVER_EMAIL,
        "password": DEMO_PASSWORD,
        "clinician_email": DEMO_CLINICIAN_EMAIL,
        "patient_email": DEMO_PATIENT_EMAIL,
        "admin_email": DEMO_ADMIN_EMAIL,
        "patient_id": str(patient.id),
        "days": len(DEMO_PLAN),
        "bands": bands,
        "session_type_counts": session_type_counts,
        "baseline_confirmed_on_day": baseline_confirmed_on_day,
        "detail": (f"Seeded {len(DEMO_PLAN)} days for {DEMO_PATIENT_NAME}, "
                   f"ending {bands[-1]}"),
    }
