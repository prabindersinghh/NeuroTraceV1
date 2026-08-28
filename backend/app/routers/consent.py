"""/consents — six independent, versioned, withdrawable consents. Part 4.

Replaces the blanket "consent_version"/"consent_lang" flag `Patient` still carries from
before Part 4 (kept, unused by this module, for whatever historical reporting reads it) with
six separately grantable and withdrawable records. Only the owning caregiver may set them —
consent, like linking a clinician, is decided by the person able to consent on the patient's
behalf, not by the patient (who may be aphasic or otherwise unable to read a consent screen)
and not by a clinician (who has an interest in C3 being granted).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..models import ConsentType, Patient
from ..schemas import ConsentSet
from ..services.consent import client_ip, consent_status, set_consent

router = APIRouter(prefix="/consents", tags=["consents"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


def _require_owning_caregiver(patient: Patient, user) -> None:
    if patient.caregiver_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the owning caregiver can change this patient's consent",
        )


@router.get("/{patient_id}")
async def read_consents(patient: AuthorisedPatient, user: CurrentUser, db: Session) -> dict:
    """The current state of all six. Owning caregiver or the patient account only — a
    linked clinician does not need to see C4/C5 to do their job, and if C3 is withdrawn
    they will find out the honest way, by losing access, not by reading this."""
    _require_owning_caregiver(patient, user)
    return await consent_status(db, patient)


@router.put("/{patient_id}/{consent_type}")
async def set_one_consent(
    consent_type: str,
    payload: ConsentSet,
    patient: AuthorisedPatient,
    user: CurrentUser,
    db: Session,
    request: Request,
) -> dict:
    try:
        parsed_type = ConsentType(consent_type)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Unknown consent type: {consent_type}") from exc
    _require_owning_caregiver(patient, user)

    await set_consent(
        db, patient, parsed_type, payload.granted, user.id,
        version=payload.version, ip_address=client_ip(request),
        device_context=payload.device_context,
    )
    await db.commit()
    return await consent_status(db, patient)
