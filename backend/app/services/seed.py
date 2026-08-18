"""Demo seeding — caregiver + "Ramesh, 67" + ten days ending in an alert.

Idempotent: re-seeding wipes the demo patient and rebuilds the story, so the pitch demo
can be reset between runs without touching any other account.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.password import hash_password
from ..ml.face import FACE_SCORING_KEYS
from ..ml.reaction import REACTION_SCORING_KEYS
from ..ml.speech import SPEECH_SCORING_KEYS
from ..models import DailySample, FeatureVector, Modality, Patient, Role, User
from .checkin import compute_checkin
from .synthetic import DEMO_PLAN, make_rng, synthetic_day

logger = logging.getLogger("neurotrace.seed")

DEMO_EMAIL = "demo@neurotrace.app"
DEMO_PASSWORD = "neurotrace-demo"
DEMO_PATIENT_NAME = "Ramesh"

KEYSETS: tuple[tuple[Modality, list[str]], ...] = (
    (Modality.voice, SPEECH_SCORING_KEYS),
    (Modality.face, FACE_SCORING_KEYS),
    (Modality.reaction, REACTION_SCORING_KEYS),
)


async def seed_demo(session: AsyncSession) -> dict:
    """Build the demo dataset and return the credentials to sign in with."""
    caregiver = await session.scalar(select(User).where(User.email == DEMO_EMAIL))
    if caregiver is None:
        caregiver = User(
            email=DEMO_EMAIL,
            pw_hash=hash_password(DEMO_PASSWORD),
            role=Role.caregiver,
            full_name="Demo Caregiver",
        )
        session.add(caregiver)
        await session.flush()

    # Wipe any previous demo patient so the story always starts clean.
    existing = list(
        await session.scalars(
            select(Patient).where(
                Patient.caregiver_id == caregiver.id, Patient.name == DEMO_PATIENT_NAME
            )
        )
    )
    for old in existing:
        await session.delete(old)
    await session.flush()

    patient = Patient(
        caregiver_id=caregiver.id,
        name=DEMO_PATIENT_NAME,
        age=67,
        sex="male",
        language="hi",
    )
    session.add(patient)
    await session.commit()

    # Days land on consecutive calendar days ending today, so the charts read naturally.
    today = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
    first_day = today - timedelta(days=len(DEMO_PLAN) - 1)

    rng = make_rng(42)
    bands: list[str] = []

    for index, (label, drift) in enumerate(DEMO_PLAN):
        sample = DailySample(patient_id=patient.id, ts=first_day + timedelta(days=index))
        session.add(sample)
        await session.flush()

        for modality, keys in KEYSETS:
            session.add(
                FeatureVector(
                    sample_id=sample.id,
                    modality=modality,
                    features_json=synthetic_day(rng, keys, drift),
                )
            )
        await session.flush()

        result = await compute_checkin(session, patient.id, sample.id, commit=False)
        bands.append(result.band.value)
        logger.info("seed day %d (%s) -> %s", index + 1, label, result.band.value)

    await session.commit()

    return {
        "email": DEMO_EMAIL,
        "password": DEMO_PASSWORD,
        "patient_id": str(patient.id),
        "days": len(DEMO_PLAN),
        "bands": bands,
        "detail": f"Seeded {len(DEMO_PLAN)} days for {DEMO_PATIENT_NAME}, ending {bands[-1]}",
    }
