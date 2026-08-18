"""/patients — caregiver-owned patient records, with the enrolment gate. TRD §9."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user, require_roles
from ..db import get_session
from ..engine.baseline import EnrolmentError, check_enrolment
from ..models import AuditLog, Patient, Role, User
from ..schemas import MessageResponse, PatientCreate, PatientRead, PatientUpdate

router = APIRouter(prefix="/patients", tags=["patients"])

Session = Annotated[AsyncSession, Depends(get_session)]
Caregiver = Annotated[User, Depends(require_roles(Role.caregiver))]


@router.post("", response_model=PatientRead, status_code=status.HTTP_201_CREATED)
async def create_patient(payload: PatientCreate, caregiver: Caregiver,
                         db: Session) -> PatientRead:
    """Enrol a patient.

    The enrolment gate is enforced here and nowhere else, so it cannot be bypassed by any
    other route. PRD §3 restricts this product to patients >= 3 months post-stroke: our
    logic reasons over days, and an acute or subacute patient would be enrolled into a
    system that structurally cannot watch for what threatens them.
    """
    stroke_date = payload.stroke_date
    if stroke_date.tzinfo is None:
        stroke_date = stroke_date.replace(tzinfo=timezone.utc)
    try:
        check_enrolment(stroke_date, datetime.now(timezone.utc))
    except EnrolmentError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    if payload.user_id is not None:
        linked = await db.get(User, payload.user_id)
        if linked is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Linked user account not found")
        if linked.role is not Role.patient:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "Linked account must have the patient role")
        taken = await db.scalar(select(Patient).where(Patient.user_id == payload.user_id))
        if taken is not None:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "That account is already linked to a patient")

    if payload.clinician_id is not None:
        clinician = await db.get(User, payload.clinician_id)
        if clinician is None or clinician.role is not Role.clinician:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "clinician_id must reference a clinician account")

    patient = Patient(
        caregiver_id=caregiver.id, user_id=payload.user_id,
        clinician_id=payload.clinician_id,
        name=payload.name, age=payload.age, sex=payload.sex,
        stroke_date=stroke_date, stroke_side=payload.stroke_side,
        languages=payload.languages or ["en"],
        preferred_hour=payload.preferred_hour,
        education_band=payload.education_band,
    )
    db.add(patient)
    await db.flush()
    db.add(AuditLog(actor_id=caregiver.id, action="patient.create", patient_id=patient.id))
    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.get("", response_model=list[PatientRead])
async def list_patients(user: CurrentUser, db: Session) -> list[PatientRead]:
    stmt = select(Patient).order_by(Patient.created_at.asc())
    if user.role is Role.caregiver:
        stmt = stmt.where(Patient.caregiver_id == user.id)
    elif user.role is Role.patient:
        stmt = stmt.where(Patient.user_id == user.id)
    rows = await db.scalars(stmt)
    return [PatientRead.model_validate(p) for p in rows]


@router.get("/{patient_id}", response_model=PatientRead)
async def get_patient(patient: Annotated[Patient, Depends(get_patient_for_user)]) -> PatientRead:
    return PatientRead.model_validate(patient)


@router.patch("/{patient_id}", response_model=PatientRead)
async def update_patient(
    payload: PatientUpdate, patient: Annotated[Patient, Depends(get_patient_for_user)],
    user: CurrentUser, db: Session,
) -> PatientRead:
    if user.role is Role.clinician or patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only the owning caregiver can edit this patient")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(patient, field, value)
    db.add(AuditLog(actor_id=user.id, action="patient.update", patient_id=patient.id))
    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.delete("/{patient_id}", response_model=MessageResponse)
async def delete_patient(
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    user: CurrentUser, db: Session,
) -> MessageResponse:
    if patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only the owning caregiver can delete this patient")
    await db.delete(patient)
    await db.commit()
    return MessageResponse(detail="Patient deleted")
