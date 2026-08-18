"""/patients — caregiver-owned patient records. TRD §6."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user, require_roles
from ..db import get_session
from ..models import Patient, Role, User
from ..schemas import MessageResponse, PatientCreate, PatientRead, PatientUpdate

router = APIRouter(prefix="/patients", tags=["patients"])

Session = Annotated[AsyncSession, Depends(get_session)]
Caregiver = Annotated[User, Depends(require_roles(Role.caregiver))]


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(payload: PatientCreate, caregiver: Caregiver, session: Session) -> PatientRead:
    """Caregivers create the patient record (PRD §5, onboarding)."""
    if payload.user_id is not None:
        linked = await session.get(User, payload.user_id)
        if linked is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Linked user account not found")
        if linked.role is not Role.patient:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linked account must have the patient role")
        taken = await session.scalar(select(Patient).where(Patient.user_id == payload.user_id))
        if taken is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "That account is already linked to a patient")

    patient = Patient(
        caregiver_id=caregiver.id,
        user_id=payload.user_id,
        name=payload.name,
        age=payload.age,
        sex=payload.sex,
        language=payload.language,
    )
    session.add(patient)
    await session.commit()
    await session.refresh(patient)
    return PatientRead.model_validate(patient)


@router.get("", response_model=list[PatientRead])
async def list_patients(user: CurrentUser, session: Session) -> list[PatientRead]:
    """Caregivers see the patients they own, patients see their own record,
    clinicians see everyone (read-only secondary user, PRD §4)."""
    stmt = select(Patient).order_by(Patient.created_at.asc())
    if user.role is Role.caregiver:
        stmt = stmt.where(Patient.caregiver_id == user.id)
    elif user.role is Role.patient:
        stmt = stmt.where(Patient.user_id == user.id)
    rows = await session.scalars(stmt)
    return [PatientRead.model_validate(p) for p in rows]


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(patient: Annotated[Patient, Depends(get_patient_for_user)]) -> PatientRead:
    return PatientRead.model_validate(patient)


@router.patch("/{patient_id}", response_model=PatientRead)
async def update_patient(
    payload: PatientUpdate,
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    user: CurrentUser,
    session: Session,
) -> PatientRead:
    if user.role is Role.clinician or patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owning caregiver can edit this patient")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(patient, field, value)
    await session.commit()
    await session.refresh(patient)
    return PatientRead.model_validate(patient)


@router.delete("/{patient_id}", response_model=MessageResponse)
async def delete_patient(
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    user: CurrentUser,
    session: Session,
) -> MessageResponse:
    """Cascades to samples, features, baselines, scores and alerts."""
    if patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owning caregiver can delete this patient")
    await session.delete(patient)
    await session.commit()
    return MessageResponse(detail="Patient deleted")
