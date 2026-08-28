"""/wearable — vendor device readings, and the fall bypass. TRD §9.

THE CLAIM BOUNDARY, which everything in this module is arranged around:

  The device vendor owns the MEASUREMENT claim. Samsung's watch is a regulated product and
  Samsung is answerable for whether its heart-rate reading is a heart rate. We own only the
  TREND — that we recorded what their device reported, and can show how it moved.

That is not legal throat-clearing, it is the difference between a defensible product and an
undefensible one. So nothing here ever restates a device reading as our own finding, and
none of it enters the deviation engine as a scored feature. It is logged, trended, and
displayed with the source attached.

FALLS BYPASS EVERYTHING. A fall is an event, not a trend. Routing it through the deviation
engine would mean waiting for a second corroborating domain across two sessions while
somebody is on the floor. It goes straight to the caregiver, exactly like the acute-symptom
path in `safety/acute.py`.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..models import (
    AuditLog,
    DeploymentTier,
    FallEvent,
    Patient,
    WearableData,
    WearableMetric,
)
from ..schemas import (
    FallEventRead,
    FallReport,
    MessageResponse,
    WearableBatch,
    WearableSummary,
)

router = APIRouter(prefix="/wearable", tags=["wearable"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]

#: Readings older than this are rejected outright. A watch that syncs a fortnight of
#: backlog after a flat battery would otherwise rewrite a trend the clinician already read.
MAX_BACKFILL_DAYS = 30


def _as_utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


@router.post("/{patient_id}", response_model=WearableSummary,
             status_code=status.HTTP_201_CREATED)
async def ingest(payload: WearableBatch, patient: AuthorisedPatient,
                 user: CurrentUser, db: Session) -> WearableSummary:
    """Accept a batch of device readings.

    Batched because a watch syncs when it can, not when a reading happens — the patient is
    frequently out of range of the phone, and the honest ingestion path is "here is
    everything since we last spoke".
    """
    if patient.deployment_tier == DeploymentTier.TIER_1_PHONE:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This patient is on the phone-only tier. Move them to TIER_2_WATCH before "
            "sending device data, so the dashboard reflects what they actually have.",
        )

    now = datetime.now(timezone.utc)
    stored = 0
    skipped_old = 0
    for reading in payload.readings:
        ts = _as_utc(reading.ts)
        if (now - ts).days > MAX_BACKFILL_DAYS:
            skipped_old += 1
            continue
        db.add(WearableData(
            patient_id=patient.id, source=payload.source, metric=reading.metric,
            value=reading.value, unit=reading.unit, ts=ts,
            device_id=payload.device_id,
        ))
        stored += 1

    db.add(AuditLog(actor_id=user.id, action="wearable.ingest", patient_id=patient.id))
    await db.commit()
    return WearableSummary(
        stored=stored, skipped_too_old=skipped_old, source=payload.source,
        # Restated on every response so a client integrator cannot miss it.
        claim_notice=(
            "Readings are stored and trended as reported by the device. NeuroTrace makes "
            "no measurement claim about them; the device manufacturer does."
        ),
    )


@router.get("/{patient_id}", response_model=list[dict])
async def series(patient: AuthorisedPatient, db: Session,
                 metric: WearableMetric | None = None, days: int = 30) -> list[dict]:
    """Recent readings, newest last, for the trend lanes on the dashboard."""
    stmt = select(WearableData).where(WearableData.patient_id == patient.id)
    if metric is not None:
        stmt = stmt.where(WearableData.metric == metric)
    rows = list(await db.scalars(stmt.order_by(WearableData.ts.asc()).limit(2000)))
    return [
        {"metric": r.metric.value, "value": r.value, "unit": r.unit,
         "ts": r.ts.isoformat(), "source": r.source, "device_id": r.device_id}
        for r in rows
    ]


# --------------------------------------------------------------------------- falls
@router.post("/{patient_id}/fall", response_model=FallEventRead,
             status_code=status.HTTP_201_CREATED)
async def report_fall(payload: FallReport, patient: AuthorisedPatient,
                      user: CurrentUser, db: Session) -> FallEventRead:
    """A fall the device detected.

    This deliberately does not touch the scoring engine — no band, no deviation, no gate.
    The response tells the caller what to do now, in the same shape as the acute-symptom
    path, and the caregiver is marked for immediate notification.
    """
    ts = _as_utc(payload.ts)
    event = FallEvent(
        patient_id=patient.id, source=payload.source, ts=ts,
        device_id=payload.device_id, device_confidence=payload.device_confidence,
        dismissed_by_patient=payload.dismissed_by_patient,
        caregiver_notified_at=datetime.now(timezone.utc),
    )
    db.add(event)
    db.add(AuditLog(actor_id=user.id, action="wearable.fall", patient_id=patient.id))
    await db.commit()
    await db.refresh(event)

    return FallEventRead(
        id=event.id,
        patient_id=patient.id,
        ts=event.ts,
        source=event.source,
        dismissed_by_patient=event.dismissed_by_patient,
        scoring_bypassed=True,
        caregiver_notified=True,
        message=(
            "Their watch reported a fall. Check on them now. If they are hurt, cannot get "
            "up, or seem confused, call 108. If they are fine, you can dismiss this."
        ),
        claim_notice=(
            "Fall detection is performed by the device. NeuroTrace relays what the device "
            "reported and does not itself detect falls."
        ),
    )


@router.get("/{patient_id}/falls", response_model=list[FallEventRead])
async def list_falls(patient: AuthorisedPatient, db: Session,
                     unacknowledged_only: bool = False) -> list[FallEventRead]:
    stmt = select(FallEvent).where(FallEvent.patient_id == patient.id)
    if unacknowledged_only:
        stmt = stmt.where(FallEvent.acknowledged_at.is_(None))
    rows = list(await db.scalars(stmt.order_by(FallEvent.ts.desc()).limit(100)))
    return [
        FallEventRead(
            id=r.id, patient_id=r.patient_id, ts=r.ts, source=r.source,
            dismissed_by_patient=r.dismissed_by_patient,
            scoring_bypassed=True,
            caregiver_notified=r.caregiver_notified_at is not None,
            acknowledged=r.acknowledged_at is not None,
            message="Fall reported by the patient's device.",
            claim_notice="Fall detection is performed by the device, not by NeuroTrace.",
        )
        for r in rows
    ]


@router.post("/fall/{fall_id}/acknowledge", response_model=MessageResponse)
async def acknowledge_fall(fall_id: uuid.UUID, user: CurrentUser,
                           db: Session) -> MessageResponse:
    """Until this fix, authorisation here read the legacy `Patient.clinician_id` column —
    caregiver-writable via `PATCH /patients` with no check that the value even names a
    clinician account, and never cleared when `clinician.py:revoke_link` unlinks a
    clinician through the real Part 3.2 mechanism. So a revoked clinician kept the ability
    to acknowledge falls indefinitely, and a caregiver could point it at an arbitrary
    account. Now uses the same active-link check every other clinician-facing route uses.
    Found in the Part 5.1 endpoint data audit.
    """
    from ..auth.deps import clinician_may_access_patient
    from ..models import Role

    event = await db.get(FallEvent, fall_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fall event not found")
    patient = await db.get(Patient, event.patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your patient")
    allowed = patient.caregiver_id == user.id
    if not allowed and user.role is Role.clinician:
        allowed = await clinician_may_access_patient(db, user.id, patient.id)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your patient")
    event.acknowledged_at = datetime.now(timezone.utc)
    db.add(AuditLog(actor_id=user.id, action="wearable.fall.ack",
                    patient_id=event.patient_id))
    await db.commit()
    return MessageResponse(detail="Fall acknowledged")


async def unacknowledged_falls(db: AsyncSession, patient_id: uuid.UUID) -> int:
    return int(await db.scalar(
        select(func.count()).select_from(FallEvent)
        .where(FallEvent.patient_id == patient_id, FallEvent.acknowledged_at.is_(None))
    ) or 0)
