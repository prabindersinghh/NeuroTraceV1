"""/asha — the community health worker's surface. TRD §9.

An ASHA worker carries a shared tablet round a fixed list of households, runs the
assessments a patient's own phone cannot run validly, and uploads when they next find
signal. Three consequences shape this module:

  SCOPE. A worker sees only their own households, and only what a visit needs — a name, an
  age, a village, and which modules are due. Not bands, not explanations, not history. They
  are not the patient's clinician and the tablet is shared.

  IDEMPOTENT SYNC. Uploads are keyed on a device-side `client_visit_id`. A worker on a bad
  connection will retry, and a retry has to land on the same visit. Without that, a round of
  fifty households becomes an unknown number of duplicate assessments, and duplicates in a
  baseline are worse than missing data because they silently reweight the median.

  TIER GATING STILL APPLIES, ACROSS EVERY SCHEDULE. The visit covers what the patient
  cannot do at home, whatever its cadence — M12 is monthly and needs a tablet, M9 balance
  is WEEKLY and needs floor space and a carer. Asking only about monthly modules left M9
  off the list entirely, which for a posterior-circulation patient meant omitting the one
  measurement that matters most.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import require_roles
from ..db import get_session
from ..exam.registry import MODULES, visit_workload_for_tier
from ..models import (
    AshaVisit,
    AuditLog,
    DeploymentTier,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    SessionType,
    User,
)
from ..schemas import (
    AshaHousehold,
    AshaHouseholdList,
    AshaSessionResult,
    AshaSessionSubmit,
)
from ..services.session_pipeline import compute_session

router = APIRouter(prefix="/asha", tags=["asha"])

Session = Annotated[AsyncSession, Depends(get_session)]
AshaWorker = Annotated[User, Depends(require_roles(Role.asha_worker))]


@router.get("/households", response_model=AshaHouseholdList)
async def households(worker: AshaWorker, db: Session) -> AshaHouseholdList:
    """The worker's assigned households, and what each visit is for."""
    patients = list(await db.scalars(
        select(Patient).where(Patient.asha_worker_id == worker.id).order_by(Patient.name)
    ))

    out: list[AshaHousehold] = []
    for patient in patients:
        last_session = await db.scalar(
            select(func.max(ExamSession.ts)).where(ExamSession.patient_id == patient.id))
        last_visit = await db.scalar(
            select(func.max(AshaVisit.ts)).where(AshaVisit.patient_id == patient.id))

        # What this visit exists to cover. Task-aware, not module-aware: M9 balance now
        # runs its low-motion subset on the family's phone, but tandem walking and
        # Unterberger still need someone present — and those are the two tests that carry
        # the direction of deviation.
        workload = visit_workload_for_tier(DeploymentTier.TIER_1_PHONE.value)
        due = sorted(workload)
        out.append(AshaHousehold(
            patient_id=patient.id, name=patient.name, age=patient.age,
            deployment_tier=patient.deployment_tier,
            last_session=last_session, last_visit=last_visit,
            due_modules=due,
            due_tasks=workload,
        ))

    db.add(AuditLog(actor_id=worker.id, action="asha.households"))
    await db.commit()
    return AshaHouseholdList(households=out, total=len(out))


@router.post("/session", response_model=AshaSessionResult,
             status_code=status.HTTP_201_CREATED)
async def submit_session(payload: AshaSessionSubmit, worker: AshaWorker,
                         db: Session) -> AshaSessionResult:
    """Upload one patient's assessment from a visit.

    Idempotent on (worker, client_visit_id): a retry after a dropped connection updates the
    existing visit instead of creating a duplicate assessment.
    """
    patient = await db.get(Patient, payload.patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    if patient.asha_worker_id != worker.id:
        # Server-side scope enforcement. The tablet is shared and the UI is not the
        # security boundary.
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "That household is not on your list")

    existing = await db.scalar(
        select(AshaVisit).where(AshaVisit.asha_worker_id == worker.id,
                                AshaVisit.client_visit_id == payload.client_visit_id)
    )
    if existing is not None:
        # Already landed. Report what we have rather than scoring it a second time.
        return AshaSessionResult(
            visit_id=existing.id, patient_id=existing.patient_id,
            session_id=existing.session_id, modules_stored=[], modules_rejected=[],
            created=False,
            detail="This visit was already synced; nothing was recorded twice.",
        )

    ts = payload.ts if payload.ts.tzinfo else payload.ts.replace(tzinfo=timezone.utc)

    # Only modules the ASHA kit can actually run. A worker's tablet unlocks the deep
    # assessment; it does not unlock modules that need something they do not have.
    allowed = set(visit_workload_for_tier(DeploymentTier.TIER_1_PHONE.value))
    allowed |= {c for c, m in MODULES.items() if m.requires_device == "phone"}

    stored: list[str] = []
    rejected: list[str] = []
    exam: ExamSession | None = None

    for code, features in payload.modules.items():
        if code not in MODULES or code not in allowed:
            rejected.append(code)
            continue
        if exam is None:
            exam = ExamSession(patient_id=patient.id, ts=ts, type=SessionType.asha_visit,
                               quality_score=1.0, identity_verified=True)
            db.add(exam)
            await db.flush()
        db.add(ModuleResult(session_id=exam.id, module_code=code,
                            domain=MODULES[code].domain, features_json=dict(features),
                            quality_flag=True, extracted_on_device=True))
        stored.append(code)

    visit = AshaVisit(
        asha_worker_id=worker.id, patient_id=patient.id,
        client_visit_id=payload.client_visit_id, ts=ts,
        session_id=exam.id if exam is not None else None,
        device_id=payload.device_id, notes=payload.notes,
    )
    db.add(visit)
    db.add(AuditLog(actor_id=worker.id, action="asha.session", patient_id=patient.id))
    await db.commit()
    await db.refresh(visit)

    if exam is not None:
        await compute_session(db, exam.id)

    return AshaSessionResult(
        visit_id=visit.id, patient_id=patient.id,
        session_id=visit.session_id,
        modules_stored=sorted(stored), modules_rejected=sorted(rejected),
        created=True,
        detail=f"Visit synced. {len(stored)} module(s) recorded.",
    )
