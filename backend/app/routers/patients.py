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
from ..models import AuditLog, ConsentType, Patient, PatientClinicianLink, Role, User
from ..services.consent import consent_currently_granted
from ..services.erasure import erase_patient_data
from ..schemas import (
    IdentitySignatureSave,
    MessageResponse,
    PatientCreate,
    PatientRead,
    PatientUpdate,
)

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
        check_enrolment(
            stroke_date,
            datetime.now(timezone.utc),
            pd_diagnosis=payload.pd_diagnosis,
            other_movement_disorder=payload.other_movement_disorder,
        )
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
        pd_diagnosis=payload.pd_diagnosis,
        other_movement_disorder=payload.other_movement_disorder,
    )
    db.add(patient)
    await db.flush()
    db.add(AuditLog(actor_id=caregiver.id, action="patient.create", patient_id=patient.id))
    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.get("", response_model=list[PatientRead])
async def list_patients(user: CurrentUser, db: Session) -> list[PatientRead]:
    """Scoped per role. Until this fix, any role OTHER than caregiver/patient fell through
    the if/elif with no `WHERE` applied at all — a clinician or admin account calling this
    route received every patient in the deployment (name, age, sex, stroke details).
    Clinicians have a proper roster at `/clinic/patients`, scoped to active links; admin
    must never see clinical rows here at all (INV-11); asha_worker's household view is
    `/asha/households`. Found in the Part 5.1 endpoint data audit.
    """
    stmt = select(Patient).order_by(Patient.created_at.asc())
    if user.role is Role.caregiver:
        stmt = stmt.where(Patient.caregiver_id == user.id)
    elif user.role is Role.patient:
        stmt = stmt.where(Patient.user_id == user.id)
    elif user.role is Role.clinician:
        stmt = stmt.join(
            PatientClinicianLink, PatientClinicianLink.patient_id == Patient.id,
        ).where(
            PatientClinicianLink.clinician_id == user.id,
            PatientClinicianLink.unlinked_at.is_(None),
        )
        rows = list(await db.scalars(stmt))
        # Part 4: a link is not enough — C3 (CLINICIAN_SHARING) must also be in force.
        rows = [p for p in rows
               if await consent_currently_granted(db, p.id, ConsentType.CLINICIAN_SHARING)]
        return [PatientRead.model_validate(p) for p in rows]
    else:
        return []
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
    updates = payload.model_dump(exclude_unset=True)
    # `clinician_id` is the legacy column `patient_clinician_links` superseded (Part 3.2) —
    # nothing reads it for authorisation any more, but until this fix it could still be set
    # to ANY user id with no check it names a clinician at all, unlike `POST /patients`
    # which validates this. Found alongside the Part 5.1 endpoint data audit's wearable.py
    # gap, which is what made this column's staleness actually exploitable.
    if updates.get("clinician_id") is not None:
        target = await db.get(User, updates["clinician_id"])
        if target is None or target.role is not Role.clinician:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "clinician_id must reference a clinician account")
    # `calibration_json` REPLACES the stored dict, which is the right semantics for the
    # device calibration a caller owns — but the enrolment vector lives in the same column
    # under `identity` and is written by a different endpoint. Without this, a routine
    # calibration PATCH silently wipes enrolment, and the same-person check quietly stops
    # running with nothing anywhere reporting that it had. Carry that one key across.
    if "calibration_json" in updates:
        existing_identity = (patient.calibration_json or {}).get("identity")
        merged = dict(updates["calibration_json"] or {})
        if existing_identity is not None and "identity" not in merged:
            merged["identity"] = existing_identity
        updates["calibration_json"] = merged
    for field, value in updates.items():
        setattr(patient, field, value)
    db.add(AuditLog(actor_id=user.id, action="patient.update", patient_id=patient.id))
    await db.commit()
    await db.refresh(patient)
    return PatientRead.model_validate(patient)


@router.delete("/{patient_id}", response_model=MessageResponse)
async def delete_patient(
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    user: CurrentUser, db: Session, reason: str | None = None,
) -> MessageResponse:
    """Erase this patient's clinical data — Part 5.4.

    Every measurement is really deleted. The audit trail is retained (INV-8), and the
    patient row survives as a stripped tombstone carrying no identifying field, because
    `audit_log.patient_id` cascades on delete and removing the row would destroy the record
    of who accessed this person's data before the erasure. See `services/erasure.py` and
    `docs/DATA_INVENTORY.md` for the full retained/deleted split.
    """
    if patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Only the owning caregiver can delete this patient")
    if patient.erased:
        raise HTTPException(status.HTTP_409_CONFLICT, "This patient's data is already erased")
    removed = await erase_patient_data(db, patient, user.id, reason)
    await db.commit()
    return MessageResponse(
        detail="Patient data erased. Audit records are retained: "
               + ", ".join(f"{k}={v}" for k, v in sorted(removed.items()) if v)
    )


@router.post("/{patient_id}/identity", response_model=MessageResponse)
async def save_identity_signature(
    payload: IdentitySignatureSave,
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    db: Session,
) -> MessageResponse:
    """Store the on-device enrolment vector.

    What lands here is six ratios between bone-structure landmarks plus their spreads —
    not an image, not an embedding, and not something that can be inverted back into a
    face or matched against anyone outside this account. It rides in `calibration_json`
    alongside the other per-patient calibration rather than earning a table of its own.
    """
    calibration = dict(patient.calibration_json or {})
    calibration["identity"] = payload.signature
    patient.calibration_json = calibration
    await db.commit()
    return MessageResponse(detail="Identity signature saved")


@router.get("/{patient_id}/identity")
async def get_identity_signature(
    patient: Annotated[Patient, Depends(get_patient_for_user)],
) -> dict:
    """Hand the signature back so the device can compare against it.

    A patient who never enrolled returns `null`, and the device treats that as "not
    checked" — never as a failed check.
    """
    return {"signature": (patient.calibration_json or {}).get("identity")}
