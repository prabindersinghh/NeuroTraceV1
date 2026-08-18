"""/sessions — the exam session lifecycle. TRD §9.

The device runs the battery, extracts features locally, and posts *numbers*. There is no
media upload endpoint in this API by design: if the server cannot receive audio or video,
then no deployment mistake, log misconfiguration or breach can leak it.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..exam.registry import MODULES, get_module, modules_for
from ..models import AuditLog, ExamSession, ModuleResult, Patient, SessionType
from ..safety.fast import fast_card
from ..schemas import (
    ModuleResultRead,
    ModuleSubmit,
    SessionFinalizeResponse,
    SessionRead,
    SessionStart,
)
from ..services.session_pipeline import compute_session

router = APIRouter(prefix="/sessions", tags=["sessions"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


@router.get("/battery/{schedule}")
async def battery(schedule: str) -> dict:
    """What the device should run for a given session type, with spoken instructions."""
    if schedule not in ("daily", "weekly", "monthly"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "schedule must be daily|weekly|monthly")
    modules = modules_for(schedule)
    return {
        "schedule": schedule,
        "total_seconds": sum(m.seconds for m in modules),
        "modules": [
            {
                "code": m.code, "name": m.name, "domain": m.domain,
                "tasks": list(m.tasks), "seconds": m.seconds,
                "nihss_item": m.nihss_item,
                "instructions": {"en": m.instructions_en, "hi": m.instructions_hi},
            }
            for m in modules
        ],
    }


@router.post("/{patient_id}/start", response_model=SessionRead,
             status_code=status.HTTP_201_CREATED)
async def start_session(
    payload: SessionStart, patient: AuthorisedPatient, user: CurrentUser, db: Session
) -> SessionRead:
    exam = ExamSession(
        patient_id=patient.id,
        type=payload.type,
        device_info=payload.device_info,
        offline_captured=payload.offline_captured,
    )
    db.add(exam)
    await db.flush()
    db.add(AuditLog(actor_id=user.id, action="session.start", patient_id=patient.id,
                    meta_json={"session_id": str(exam.id), "type": payload.type.value}))
    await db.commit()
    await db.refresh(exam)
    return SessionRead.model_validate(exam)


@router.post("/{session_id}/module/{code}", response_model=ModuleResultRead)
async def submit_module(
    session_id: uuid.UUID, code: str, payload: ModuleSubmit,
    user: CurrentUser, db: Session,
) -> ModuleResultRead:
    """Store one module's extracted features.

    Quality gating (TRD §5/FR8) happens here: a capture flagged as poor is stored — we want
    the audit trail — but `quality_flag=False` keeps it out of the baseline and raises the
    `low_quality_capture` confounder rather than silently contaminating the statistics.
    """
    exam = await db.get(ExamSession, session_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    await _assert_can_access(db, exam.patient_id, user)

    try:
        module = get_module(code)
    except KeyError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown exam module {code!r}")

    features = {k: v for k, v in payload.features.items() if v is not None}
    row = await db.scalar(
        select(ModuleResult).where(ModuleResult.session_id == session_id,
                                   ModuleResult.module_code == module.code)
    )
    if row is None:
        row = ModuleResult(session_id=session_id, module_code=module.code,
                           domain=module.domain, features_json=features)
        db.add(row)
    else:
        row.features_json = features   # re-taking a task overwrites it
    row.quality_flag = payload.quality_flag
    row.quality_detail = payload.quality_detail
    row.extracted_on_device = payload.extracted_on_device

    # Session quality is the worst module quality seen so far.
    if not payload.quality_flag:
        exam.quality_score = min(exam.quality_score, 0.4)

    await db.commit()
    await db.refresh(row)
    return ModuleResultRead.model_validate(row)


@router.post("/{session_id}/finalize", response_model=SessionFinalizeResponse)
async def finalize(session_id: uuid.UUID, user: CurrentUser, db: Session) -> SessionFinalizeResponse:
    exam = await db.get(ExamSession, session_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    patient = await _assert_can_access(db, exam.patient_id, user)

    count = len(list(await db.scalars(
        select(ModuleResult.id).where(ModuleResult.session_id == session_id)
    )))
    if count == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "No module results submitted for this session")

    result = await compute_session(db, session_id)

    db.add(AuditLog(actor_id=user.id, action="session.finalize", patient_id=patient.id,
                    meta_json={"session_id": str(session_id), "band": result["band"]}))
    await db.commit()

    lang = (patient.languages or ["en"])[0] if patient.languages else "en"
    # TRD §8: unconditional. Every finalize carries the FAST card.
    result["fast"] = fast_card(lang)
    return SessionFinalizeResponse(**result)


@router.get("/{patient_id}/current", response_model=SessionRead | None)
async def current_session(patient: AuthorisedPatient, db: Session) -> SessionRead | None:
    """Lets the PWA resume a session interrupted mid-battery."""
    exam = await db.scalar(
        select(ExamSession)
        .where(ExamSession.patient_id == patient.id, ExamSession.completed.is_(False))
        .order_by(ExamSession.ts.desc()).limit(1)
    )
    return SessionRead.model_validate(exam) if exam else None


@router.get("/{session_id}/modules", response_model=list[ModuleResultRead])
async def session_modules(session_id: uuid.UUID, user: CurrentUser,
                          db: Session) -> list[ModuleResultRead]:
    exam = await db.get(ExamSession, session_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    await _assert_can_access(db, exam.patient_id, user)
    rows = await db.scalars(
        select(ModuleResult).where(ModuleResult.session_id == session_id)
    )
    return [ModuleResultRead.model_validate(r) for r in rows]


async def _assert_can_access(db: AsyncSession, patient_id: uuid.UUID, user) -> Patient:
    from ..models import Role

    patient = await db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    allowed = (
        user.role is Role.clinician
        or patient.caregiver_id == user.id
        or (patient.user_id is not None and patient.user_id == user.id)
    )
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to access this patient")
    return patient
