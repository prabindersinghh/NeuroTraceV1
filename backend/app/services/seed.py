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
from ..exam.registry import DAILY_MODULES, MODULES
from ..models import (
    Adherence,
    AuditLog,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    SessionType,
    StrokeSide,
    User,
)
from .session_pipeline import compute_session
from .synthetic import DEMO_PLAN, make_rng, synthetic_session

logger = logging.getLogger("neurotrace.seed")

DEMO_CAREGIVER_EMAIL = "demo@neurotrace.app"
DEMO_CLINICIAN_EMAIL = "clinician@neurotrace.app"
DEMO_PATIENT_EMAIL = "ramesh@neurotrace.app"
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
    await db.commit()

    first_day = now - timedelta(days=len(DEMO_PLAN) - 1)
    rng = make_rng(42)
    bands: list[str] = []

    for index, (label, drift) in enumerate(DEMO_PLAN):
        ts = first_day + timedelta(days=index)
        exam = ExamSession(patient_id=patient.id, ts=ts, type=SessionType.daily,
                           quality_score=1.0, identity_verified=True)
        db.add(exam)
        await db.flush()

        features = synthetic_session(
            rng, list(DAILY_MODULES), drift,
            drift_modules=DECLINING_MODULES if drift else None,
        )
        for code, feats in features.items():
            db.add(ModuleResult(session_id=exam.id, module_code=code,
                                domain=MODULES[code].domain, features_json=feats,
                                quality_flag=True, extracted_on_device=True))
        db.add(Adherence(patient_id=patient.id, taken=True, ts=ts))
        await db.flush()

        result = await compute_session(db, exam.id, commit=False)
        bands.append(result["band"])
        logger.info("seed day %2d (%-8s) -> %s", index + 1, label, result["band"])

    db.add(AuditLog(actor_id=caregiver.id, action="demo.seed", patient_id=patient.id,
                    meta_json={"days": len(DEMO_PLAN)}))
    await db.commit()

    return {
        "email": DEMO_CAREGIVER_EMAIL,
        "password": DEMO_PASSWORD,
        "clinician_email": DEMO_CLINICIAN_EMAIL,
        "patient_email": DEMO_PATIENT_EMAIL,
        "patient_id": str(patient.id),
        "days": len(DEMO_PLAN),
        "bands": bands,
        "detail": (f"Seeded {len(DEMO_PLAN)} days for {DEMO_PATIENT_NAME}, "
                   f"ending {bands[-1]}"),
    }
