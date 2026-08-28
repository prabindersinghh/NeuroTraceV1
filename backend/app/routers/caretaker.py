"""/caretakers — family onboarding, linking, and the notification channel.

WHO A CARETAKER IS. Family, ADDITIONAL to the caregiver who enrolled the patient: the second
sibling, the relative abroad. Under Reading A of the plan the first family member to set the
product up is the `caregiver`/owner and keeps consent management, linking and erasure; the
caretaker sees everything clinical about their own linked patient and holds none of the
owner's controls. See `docs/plans/PLAN_caretaker_onboarding.md`.

TWO RULES THIS MODULE EXISTS TO ENFORCE, both owner decisions:

  1. ONLY THE OWNING CAREGIVER CREATES A CARETAKER. Not the patient, not another caretaker.
     A caretaker able to mint caretakers would void the boundary the moment one account is
     compromised — the same reasoning that stops a clinician linking themselves.

  2. THE LINK AND ITS CONSENT ARE WRITTEN IN ONE TRANSACTION. `consent_ref` is populated at
     creation rather than nullable-then-backfilled, because D-046 records what happens
     otherwise: Part 3 shipped links whose consent lived only in an audit event and needed a
     later migration to reference it. The consent table already exists now, so there is no
     reason to repeat that.

AUTH IS DEFERRED, AUTHORISATION IS NOT. The account is created DISABLED — no usable password
hash, so it cannot log in until the auth pass adds an invite flow. The access boundary is
built and tested now regardless (`auth.deps.caretaker_may_access_patient`), because it must
be provably correct *before* the first real caretaker can sign in, not after.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..models import (
    AuditLog,
    CaretakerChannel,
    CaretakerRelationship,
    ConsentType,
    NotificationChannel,
    Patient,
    PatientCaretakerLink,
    Role,
    User,
)
from ..schemas import CaretakerChannelCreate, CaretakerLinkCreate, MessageResponse
from ..services.consent import client_ip, set_consent

router = APIRouter(prefix="/caretakers", tags=["caretakers"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


async def _owning_caregiver_or_403(db: AsyncSession, patient_id: uuid.UUID, user: User) -> Patient:
    """Rule 1, in one place so no route in this module can forget it."""
    patient = await db.scalar(select(Patient).where(Patient.id == patient_id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    if patient.caregiver_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only the owning caregiver can manage this patient's family access",
        )
    return patient


@router.post("/links", status_code=status.HTTP_201_CREATED)
async def create_caretaker(
    payload: CaretakerLinkCreate, user: CurrentUser, db: Session, request: Request,
) -> dict:
    """Create a caretaker account and link it to this patient — the whole flow, atomically.

    Everything happens in one transaction on purpose. A user row without its link, or a link
    without its consent, is exactly the half-created state that produces a cohort nobody can
    reason about later — and one of those halves is an account with a role and no boundary.
    """
    patient = await _owning_caregiver_or_403(db, payload.patient_id, user)

    email = payload.email.lower().strip()
    if await db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "An account with that email already exists")

    # DISABLED until the auth pass. `pw_hash` is a non-empty sentinel rather than a real
    # hash: `verify_password` cannot match it, so there is no password that logs this
    # account in. Storing "" would be a subtler thing to get wrong later.
    caretaker = User(
        email=email,
        pw_hash="!disabled-pending-invite",
        role=Role.caretaker,
        full_name=payload.full_name,
    )
    db.add(caretaker)
    await db.flush()

    link = PatientCaretakerLink(
        patient_id=patient.id,
        caretaker_id=caretaker.id,
        relationship=CaretakerRelationship(payload.relationship),
        linked_by=user.id,
    )
    db.add(link)
    await db.flush()

    # C7 in the same transaction — this is what makes `consent_ref` non-null by construction.
    consent = await set_consent(
        db, patient, ConsentType.CARETAKER_SHARING, True, user.id,
        ip_address=client_ip(request), device_context="via caretakers.links",
    )
    link.consent_ref = str(consent.id) if consent is not None else None

    db.add(AuditLog(
        actor_id=user.id,
        action="caretaker.link.granted",
        patient_id=patient.id,
        meta_json={
            "caretaker_id": str(caretaker.id),
            "relationship": payload.relationship,
            "consent": "caregiver_granted",
            "consent_ref": link.consent_ref,
        },
    ))
    await db.commit()
    return {
        "id": str(link.id),
        "caretaker_id": str(caretaker.id),
        "consent_ref": link.consent_ref,
        "login_enabled": False,
        "detail": (
            "Family member linked. They cannot sign in yet — invite and credential setup "
            "land with the auth pass."
        ),
    }


@router.delete("/links/{link_id}", response_model=MessageResponse)
async def revoke_caretaker(
    link_id: uuid.UUID, reason: str, user: CurrentUser, db: Session,
) -> MessageResponse:
    """Revoke family access. The row is RETAINED with `unlinked_at` set, never deleted, so
    who could see this patient and until when stays recoverable (INV-8)."""
    link = await db.scalar(
        select(PatientCaretakerLink).where(PatientCaretakerLink.id == link_id))
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link not found")

    patient = await _owning_caregiver_or_403(db, link.patient_id, user)
    if link.unlinked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Link is already revoked")

    link.unlinked_at = datetime.now(timezone.utc)
    link.unlinked_by = user.id
    link.unlink_reason = (reason or "").strip()[:400] or None
    db.add(AuditLog(
        actor_id=user.id, action="caretaker.link.revoked", patient_id=patient.id,
        meta_json={"caretaker_id": str(link.caretaker_id), "reason": link.unlink_reason},
    ))
    await db.commit()
    return MessageResponse(detail="Family member unlinked")


@router.get("/links/{patient_id}")
async def list_caretakers(patient: AuthorisedPatient, user: CurrentUser, db: Session) -> dict:
    """Who has family access to this patient. Owning caregiver only — a caretaker does not
    need the roster of other caretakers, and it is not theirs to audit."""
    await _owning_caregiver_or_403(db, patient.id, user)
    rows = list(await db.scalars(
        select(PatientCaretakerLink)
        .where(PatientCaretakerLink.patient_id == patient.id)
        .order_by(PatientCaretakerLink.linked_at.asc())
    ))
    out = []
    for link in rows:
        account = await db.get(User, link.caretaker_id)
        out.append({
            "id": str(link.id),
            "caretaker_id": str(link.caretaker_id),
            "full_name": account.full_name if account else None,
            "relationship": link.relationship.value,
            "active": link.active,
            "linked_at": link.linked_at.isoformat(),
            "unlinked_at": link.unlinked_at.isoformat() if link.unlinked_at else None,
        })
    return {"patient_id": str(patient.id), "caretakers": out}


# --------------------------------------------------------------- notification channel
@router.post("/channels", status_code=status.HTTP_201_CREATED)
async def add_channel(
    payload: CaretakerChannelCreate, user: CurrentUser, db: Session,
) -> dict:
    """Register where a caretaker should be told about their patient.

    THE DESTINATION IS HEALTH-ADJACENT PII. A phone number alone is contact metadata; the
    same number joined to this link says *this person is caring for a stroke survivor*,
    which is a health inference about a named individual. So: it is deleted on erasure, it
    never appears on an admin surface (D-041), and the audit row below records the CHANNEL
    ID and never the destination — `audit_log` is append-only and survives erasure (D-050),
    so a number written there would be un-erasable.
    """
    patient = await _owning_caregiver_or_403(db, payload.patient_id, user)

    linked = await db.scalar(
        select(PatientCaretakerLink.id).where(
            PatientCaretakerLink.caretaker_id == payload.caretaker_id,
            PatientCaretakerLink.patient_id == patient.id,
            PatientCaretakerLink.unlinked_at.is_(None),
        ).limit(1)
    )
    if linked is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "That caretaker is not actively linked to this patient")

    channel = CaretakerChannel(
        caretaker_id=payload.caretaker_id,
        patient_id=patient.id,
        channel=NotificationChannel(payload.channel),
        destination=payload.destination.strip(),
    )
    db.add(channel)
    await db.flush()
    db.add(AuditLog(
        actor_id=user.id, action="caretaker.channel.added", patient_id=patient.id,
        # channel_id, NEVER destination. See the docstring.
        meta_json={"channel_id": str(channel.id), "channel": payload.channel},
    ))
    await db.commit()
    return {"id": str(channel.id), "channel": channel.channel.value, "verified": False}


@router.delete("/channels/{channel_id}", response_model=MessageResponse)
async def revoke_channel(
    channel_id: uuid.UUID, user: CurrentUser, db: Session,
) -> MessageResponse:
    channel = await db.scalar(
        select(CaretakerChannel).where(CaretakerChannel.id == channel_id))
    if channel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Channel not found")
    patient = await _owning_caregiver_or_403(db, channel.patient_id, user)
    if channel.revoked_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Channel is already revoked")

    channel.revoked_at = datetime.now(timezone.utc)
    db.add(AuditLog(
        actor_id=user.id, action="caretaker.channel.revoked", patient_id=patient.id,
        meta_json={"channel_id": str(channel.id)},
    ))
    await db.commit()
    return MessageResponse(detail="Notification channel revoked")
