"""/clinician — doctor onboarding, patient links, and the baseline gate. Part 3.

Access here is narrower than "has the clinician role". Every patient-scoped route resolves
through `get_patient_for_user`, which since Part 3.2 requires an ACTIVE row in
`patient_clinician_links` — a provisioned clinician with no link to this patient gets 403.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user, require_roles
from ..db import get_session
from ..models import (
    AuditLog,
    BaselineReview,
    BaselineReviewAction,
    ClinicianProfile,
    ClinicianRole,
    ConsentType,
    Patient,
    PatientClinicianLink,
    Role,
    User,
    VerificationStatus,
)
from ..schemas import (
    BaselineReviewSubmit,
    ClinicianProfileRead,
    ClinicianProfileUpsert,
    LinkCreate,
    MessageResponse,
)
from ..services.baseline_review import (
    BaselineGateError,
    build_review,
    completion_status,
    invalidate_baseline,
    record_review,
)
from ..services.consent import set_consent

router = APIRouter(prefix="/clinician", tags=["clinician"])

Session = Annotated[AsyncSession, Depends(get_session)]
Clinician = Annotated[User, Depends(require_roles(Role.clinician))]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


# ------------------------------------------------------------------ 3.1 profile
@router.put("/profile", response_model=ClinicianProfileRead)
async def upsert_profile(
    payload: ClinicianProfileUpsert, clinician: Clinician, db: Session,
) -> ClinicianProfileRead:
    """Create or update this clinician's registration details.

    `verification_status` is NEVER taken from the request. It is always SELF_DECLARED,
    because nothing here is checked against any medical register — and a client that could
    set it could claim a verification we have not performed.
    """
    profile = await db.scalar(
        select(ClinicianProfile).where(ClinicianProfile.user_id == clinician.id)
    )
    created = profile is None
    if profile is None:
        profile = ClinicianProfile(user_id=clinician.id)
        db.add(profile)

    profile.full_name = payload.full_name
    profile.qualification = payload.qualification
    profile.registration_number = payload.registration_number
    profile.registering_authority = payload.registering_authority
    profile.specialty = payload.specialty
    profile.affiliation = payload.affiliation
    profile.contact = payload.contact
    profile.verification_status = VerificationStatus.SELF_DECLARED

    db.add(AuditLog(
        actor_id=clinician.id,
        action="clinician.profile.created" if created else "clinician.profile.updated",
    ))
    await db.commit()
    await db.refresh(profile)
    return ClinicianProfileRead.model_validate(profile)


@router.get("/profile", response_model=ClinicianProfileRead)
async def read_profile(clinician: Clinician, db: Session) -> ClinicianProfileRead:
    profile = await db.scalar(
        select(ClinicianProfile).where(ClinicianProfile.user_id == clinician.id)
    )
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No clinician profile yet")
    return ClinicianProfileRead.model_validate(profile)


# --------------------------------------------------------------------- 3.2 links
@router.post("/links", status_code=status.HTTP_201_CREATED)
async def create_link(payload: LinkCreate, user: CurrentUser, db: Session) -> dict:
    """Link a clinician to a patient. Caregiver-initiated and consented.

    The OWNING CAREGIVER creates the link, not the clinician — a clinician who could add
    themselves to a patient would make the link meaningless as an access control. They are
    the person able to consent on the patient's behalf.

    CONSENT (Part 4): creating a link IS granting C3 (CLINICIAN_SHARING) — the two happen
    in the same transaction, so `consent_ref` is populated immediately and no new
    consented-but-unreferenced link is ever created going forward (D-046's backfill only
    had to cover the Part-3-era links that predated this table).
    """
    patient = await db.scalar(select(Patient).where(Patient.id == payload.patient_id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    if patient.caregiver_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the owning caregiver can link a clinician to this patient",
        )

    clinician = await db.scalar(select(User).where(User.id == payload.clinician_id))
    if clinician is None or clinician.role is not Role.clinician:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a clinician account")

    existing = await db.scalar(
        select(PatientClinicianLink).where(
            PatientClinicianLink.patient_id == payload.patient_id,
            PatientClinicianLink.clinician_id == payload.clinician_id,
            PatientClinicianLink.unlinked_at.is_(None),
        )
    )
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This link already exists")

    link = PatientClinicianLink(
        patient_id=payload.patient_id,
        clinician_id=payload.clinician_id,
        clinician_role=ClinicianRole(payload.clinician_role),
        linked_by=user.id,
    )
    db.add(link)
    await db.flush()

    consent = await set_consent(
        db, patient, ConsentType.CLINICIAN_SHARING, True, user.id,
        device_context="via clinician.links",
    )
    link.consent_ref = str(consent.id) if consent is not None else None

    db.add(AuditLog(
        actor_id=user.id,
        action="clinician.link.granted",
        patient_id=payload.patient_id,
        meta_json={
            "clinician_id": str(payload.clinician_id),
            "clinician_role": payload.clinician_role,
            "consent": "caregiver_granted",
            "consent_ref": link.consent_ref,
        },
    ))
    await db.commit()
    return {"id": str(link.id), "detail": "Clinician linked"}


@router.delete("/links/{link_id}", response_model=MessageResponse)
async def revoke_link(
    link_id: uuid.UUID, reason: str, user: CurrentUser, db: Session,
) -> MessageResponse:
    """Revoke a link. The row is retained with `unlinked_at` set, never deleted, so who
    could see this patient and when stays recoverable (INV-8)."""
    link = await db.scalar(select(PatientClinicianLink).where(PatientClinicianLink.id == link_id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")

    patient = await db.scalar(select(Patient).where(Patient.id == link.patient_id))
    # Either the owning caregiver or the clinician themselves may end the relationship.
    if patient is None or (patient.caregiver_id != user.id and link.clinician_id != user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to revoke this link")
    if link.unlinked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link is already revoked")

    link.unlinked_at = datetime.now(timezone.utc)
    link.unlinked_by = user.id
    link.unlink_reason = (reason or "").strip()[:400] or None
    db.add(AuditLog(
        actor_id=user.id, action="clinician.link.revoked", patient_id=link.patient_id,
        meta_json={"clinician_id": str(link.clinician_id), "reason": link.unlink_reason},
    ))
    await db.commit()
    return MessageResponse(detail="Clinician unlinked")


# ------------------------------------------------------- 3.3/3.4 the baseline gate
@router.get("/baseline-review/{patient_id}")
async def baseline_review_view(
    patient: AuthorisedPatient, clinician: Clinician, db: Session,
) -> dict:
    """Everything the doctor sees before deciding — Part 3.4.

    Reading the review is itself auditable: who looked at a patient's baseline, and when,
    is part of the record (INV-8).
    """
    view = await build_review(db, patient)
    db.add(AuditLog(
        actor_id=clinician.id, action="baseline.review.viewed", patient_id=patient.id,
    ))
    await db.commit()
    return view


@router.get("/baseline/{patient_id}")
async def baseline_status(patient: AuthorisedPatient, db: Session) -> dict:
    """Completion criteria and what, if anything, is still missing."""
    return await completion_status(db, patient)


@router.post("/baseline/{patient_id}/review", status_code=status.HTTP_201_CREATED)
async def submit_review(
    payload: BaselineReviewSubmit,
    patient: AuthorisedPatient,
    clinician: Clinician,
    db: Session,
) -> dict:
    """CONFIRM / EXTEND / FLAG_CONCERN — Part 3.4.

    CONFIRM is the only thing that locks the baseline and the only thing that writes the
    frozen reference (INV-4, D-048).
    """
    snapshot = await build_review(db, patient)
    try:
        review = await record_review(
            db, patient, clinician.id,
            BaselineReviewAction(payload.action), payload.note, snapshot,
        )
    except BaselineGateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return {
        "id": str(review.id),
        "action": review.action.value,
        "baseline_state": patient.baseline_state.value,
        "reviewed_at": review.reviewed_at.isoformat(),
    }


@router.post("/baseline/{patient_id}/invalidate", response_model=MessageResponse)
async def invalidate(
    reason: str, patient: AuthorisedPatient, user: CurrentUser, db: Session,
) -> MessageResponse:
    """A new clinical event during the window invalidates the baseline — Part 3.6."""
    try:
        await invalidate_baseline(db, patient, user.id, reason)
    except BaselineGateError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await db.commit()
    return MessageResponse(detail="Baseline invalidated; a new one will be collected")


@router.get("/reviews/{patient_id}")
async def review_history(patient: AuthorisedPatient, db: Session) -> dict:
    """The append-only sequence of decisions on this patient's baseline (INV-8)."""
    rows = list(await db.scalars(
        select(BaselineReview).where(BaselineReview.patient_id == patient.id)
        .order_by(BaselineReview.reviewed_at.asc())
    ))
    return {
        "patient_id": str(patient.id),
        "baseline_state": patient.baseline_state.value,
        "reviews": [
            {
                "id": str(r.id),
                "action": r.action.value,
                "note": r.note,
                "clinician_id": str(r.clinician_id) if r.clinician_id else None,
                "sessions_in_window": r.sessions_in_window,
                "reviewed_at": r.reviewed_at.isoformat(),
            }
            for r in rows
        ],
    }
