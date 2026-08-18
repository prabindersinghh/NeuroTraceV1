"""/safety — the unconditional path. TRD §8.

`POST /safety/acute/{pid}` does not touch the engine. It writes the report and returns an
escalation. There is intentionally no code path from this endpoint into `compute_session`,
because the one thing a person reporting sudden weakness does not need is for us to spend
time computing a z-score first.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..models import AuditLog, Patient, SafetyEvent
from ..safety.acute import ACUTE_SYMPTOMS, build_escalation
from ..safety.fast import fast_card
from ..schemas import AcuteReport, AcuteResponse

router = APIRouter(prefix="/safety", tags=["safety"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


@router.get("/fast")
async def get_fast_card(lang: str = "en") -> dict:
    """Public and unauthenticated on purpose — emergency guidance must never 401."""
    return fast_card(lang)


@router.get("/symptoms")
async def acute_symptom_list(lang: str = "en") -> dict:
    lang = lang if lang in ("en", "hi", "pa") else "en"
    return {
        "symptoms": [
            {"code": code, "label": labels[lang]} for code, labels in ACUTE_SYMPTOMS.items()
        ]
    }


@router.post("/acute/{patient_id}", response_model=AcuteResponse,
             status_code=status.HTTP_200_OK)
async def report_acute(
    payload: AcuteReport, patient: AuthorisedPatient, user: CurrentUser, db: Session,
) -> AcuteResponse:
    """Record an acute symptom report and escalate immediately.

    Scoring is bypassed entirely. The response is built before anything else happens so
    that a database problem cannot delay the escalation reaching the caller.
    """
    escalation = build_escalation(payload.symptoms, payload.lang)

    db.add(SafetyEvent(
        patient_id=patient.id, reported_by=user.id,
        symptoms_json=payload.symptoms, note=payload.note, escalated=True,
    ))
    db.add(AuditLog(actor_id=user.id, action="safety.acute", patient_id=patient.id,
                    meta_json={"symptoms": payload.symptoms}))
    await db.commit()

    return AcuteResponse(**escalation.to_json())
