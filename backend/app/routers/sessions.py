"""/sessions — the exam session lifecycle. TRD §9.

The device runs the battery, extracts features locally, and posts *numbers*. There is no
media upload endpoint in this API by design: if the server cannot receive audio or video,
then no deployment mistake, log misconfiguration or breach can leak it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..exam.registry import MODULES, get_module, modules_for
from ..exam.scheduler import next_comprehensive_due, session_type_due_today
from ..exam.session_plan import Intensity, planned_seconds, steps_for, steps_for_session_type
from ..models import AuditLog, ExamSession, ModuleResult, Patient, SessionType
from ..safety.fast import fast_card
from ..schemas import (
    ModuleResultRead,
    ModuleSubmit,
    SessionAbandon,
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


def _plan_response(steps: list, *, session_type: str, intensity: str) -> dict:
    first_standing = next(
        (st.position for st in steps if st.block.value.startswith("C_")), None)
    return {
        "session_type": session_type,
        "intensity": intensity,
        "planned_seconds": planned_seconds(steps),
        # The fall-risk gate renders immediately before this position, full screen; the
        # standing block cannot be reached around it.
        "fall_gate_before_position": first_standing,
        "steps": [
            {
                "position": st.position, "module": st.module, "task": st.task,
                "block": st.block.value, "seconds": st.seconds,
                "label_en": st.label_en, "core": st.core,
            }
            for st in steps
        ],
    }


@router.get("/plan/{intensity}")
async def session_plan(intensity: str) -> dict:
    """DEPRECATED — kept for any caller still on the pre-Part-2 single-protocol model.

    Always returns the full COMPREHENSIVE protocol at the requested intensity (what the
    old flat daily session actually ran). New callers should use `/plan-v2/{session_type}`,
    which is session-type aware and is what Daily Pulse / Comprehensive Follow-up actually
    need — two different batteries, not one battery at different intensities.
    """
    try:
        level = Intensity(intensity.upper())
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "intensity must be full|standard|light|research")
    steps = steps_for(level)
    return _plan_response(steps, session_type="COMPREHENSIVE", intensity=level.value.lower())


@router.get("/plan-v2/{session_type}")
async def session_plan_v2(session_type: str, intensity: str = "FULL",
                          day_index: int = 0) -> dict:
    """The ordered protocol for one SESSION TYPE — Part 2. The server is the source of
    truth; the frontend runs exactly this list in exactly this order. Ordering is part of
    the measurement (D-044): Daily Pulse's six modules land at identical positions
    whichever session type they were captured through, so a module's baseline is never
    silently blended from two different points on the fatigue curve.
    """
    try:
        steps = steps_for_session_type(session_type.upper(), intensity, day_index)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return _plan_response(
        steps, session_type=session_type.upper(), intensity=intensity.lower(),
    )


@router.get("/{patient_id}/due")
async def session_due_today(patient: AuthorisedPatient) -> dict:
    """Which session type is due for this patient today, and roughly how long it takes.

    Part 2.3. The SERVER decides, not the client: the caregiver's dashboard and the
    patient's own app both need this answer and must agree, and duplicating the cadence
    arithmetic in the frontend is how they would drift apart.

    `estimated_seconds` is raw task time from the protocol — `planned_seconds`'s own
    docstring is explicit that real sessions run longer once instructions, framing and
    retries are counted, so patient-facing copy should present this as a floor
    ("about four minutes"), never as a precise promise.
    """
    due = session_type_due_today(
        patient.enrolment_date, patient.comprehensive_days_per_week,
        datetime.now(timezone.utc),
    )
    steps = steps_for_session_type(due.value, patient.intensity)
    next_comp = next_comprehensive_due(
        patient.enrolment_date, patient.comprehensive_days_per_week,
        datetime.now(timezone.utc) + timedelta(days=1),
    )
    return {
        "session_type": due.value,
        "estimated_seconds": planned_seconds(steps),
        "step_count": len(steps),
        "comprehensive_days_per_week": patient.comprehensive_days_per_week,
        "next_comprehensive_date": (
            next_comp.date().isoformat() if patient.comprehensive_days_per_week > 0 else None
        ),
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
        is_practice=payload.is_practice,
        # Recorded, never enforced. A failed same-person check makes the session a
        # confounder (`identity_uncertain`), which lowers confidence and keeps it out of
        # the baseline — it does not lock a stroke survivor out of their own check-in.
        identity_verified=payload.identity_verified,
        identity_score=payload.identity_score,
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

    trace_json = None
    if payload.raw is not None and module.extract is not None:
        # The device sent landmark-derived POINTS (numbers, never media), and the server
        # runs the extractor the test suite pins. One implementation, no JS drift.
        extracted = module.extract(payload.raw)
        features = {**features, **{k: v for k, v in extracted.items() if v is not None}}
        if module.code == "M9":
            from ..exam.vestibular import ccg_trace
            traces = {
                test: ccg_trace(payload.raw, test)
                for test in (payload.raw.get("tests") or {})
            }
            if traces:
                trace_json = {"traces": traces}

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
    if trace_json is not None:
        row.trace_json = trace_json
    # Fatigue instrumentation — recorded verbatim; interpretation is the engine's job.
    row.session_position = payload.session_position
    row.elapsed_seconds_at_task_start = payload.elapsed_seconds_at_task_start
    row.intensity = payload.intensity
    row.paused_before_task = payload.paused_before_task

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

    if exam.is_practice:
        # A practice run is stored — the family can see it happened — but it never
        # reaches the engine. The patient is still learning the tasks; scoring a
        # learning attempt, or letting it into a baseline, manufactures a week of
        # false improvement that is really just familiarity.
        exam.completed = True
        db.add(AuditLog(actor_id=user.id, action="session.practice",
                        patient_id=patient.id,
                        meta_json={"session_id": str(session_id)}))
        await db.commit()
        lang = (patient.languages or ["en"])[0] if patient.languages else "en"
        return SessionFinalizeResponse(
            session_id=session_id, patient_id=patient.id, band="STABLE",
            reason="practice", gate1_passed=False, gate2_passed=False,
            persistent_domains=[], domain_deviations={}, drivers=[],
            confounders={"active": [], "labels_en": [], "labels_hi": []},
            confidence=0.0, improving=False, baseline_phase=True,
            baseline_state=patient.baseline_state.value,
            explanation_en="Practice complete. Nothing from a practice run is scored.",
            explanation_hi="अभ्यास पूरा हुआ। अभ्यास के अंक नहीं गिने जाते।",
            explanation_source="template", clinician_line="Practice session — excluded from scoring and baselines.",
            fast=fast_card(lang),
        )

    result = await compute_session(db, session_id)

    db.add(AuditLog(actor_id=user.id, action="session.finalize", patient_id=patient.id,
                    meta_json={"session_id": str(session_id), "band": result["band"]}))
    await db.commit()

    lang = (patient.languages or ["en"])[0] if patient.languages else "en"
    # TRD §8: unconditional. Every finalize carries the FAST card.
    result["fast"] = fast_card(lang)
    return SessionFinalizeResponse(**result)


@router.post("/{session_id}/abandon", response_model=SessionRead)
async def abandon_session(
    session_id: uuid.UUID, payload: SessionAbandon, user: CurrentUser, db: Session,
) -> SessionRead:
    """The patient stopped part-way. Keep what was measured; keep it out of the engine.

    `completed` stays False, and that single fact is what excludes this session from every
    baseline and from scoring — the pipeline filters on it (see `_module_history`, and
    `tests/test_incomplete_session.py`). Nothing here needs to reach into the engine, which
    is the point: exiting is not a special case the engine has to know about, it is just a
    session that never finished.

    The results already submitted are RETAINED. The family should be able to see that a
    check-in was started, and adherence should count the attempt. Deleting them would
    punish someone for stopping, which is the opposite of what an exit button is for.

    Idempotent: exiting twice (a double tap, a retried request from the offline queue)
    records the first exit and leaves it alone, rather than 409-ing at a patient who is
    trying to leave.
    """
    exam = await db.get(ExamSession, session_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    patient = await _assert_can_access(db, exam.patient_id, user)

    if exam.completed:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This session is already finished and scored")

    if exam.abandoned is None:
        info = dict(exam.device_info or {})
        info["abandoned"] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "steps_completed": payload.steps_completed,
            "steps_total": payload.steps_total,
        }
        # Reassigned, not mutated in place: SQLAlchemy does not track mutation of a plain
        # JSON dict, so an in-place update would be silently dropped on commit.
        exam.device_info = info
        db.add(AuditLog(
            actor_id=user.id, action="session.abandoned", patient_id=patient.id,
            meta_json={"session_id": str(session_id),
                       "steps_completed": payload.steps_completed,
                       "steps_total": payload.steps_total},
        ))
        await db.commit()
        await db.refresh(exam)
    return SessionRead.model_validate(exam)


@router.get("/{patient_id}/current", response_model=SessionRead | None)
async def current_session(patient: AuthorisedPatient, db: Session) -> SessionRead | None:
    """Lets the PWA resume a session interrupted mid-battery.

    A session the patient deliberately EXITED is not offered for resume. Interrupted and
    abandoned are both `completed=False`, and only one of them is an invitation to carry
    on — re-offering a check-in somebody just chose to stop would undo the exit.
    """
    rows = await db.scalars(
        select(ExamSession)
        .where(ExamSession.patient_id == patient.id, ExamSession.completed.is_(False))
        .order_by(ExamSession.ts.desc()).limit(20)
    )
    exam = next((s for s in rows if s.abandoned is None), None)
    return SessionRead.model_validate(exam) if exam else None


@router.get("/{patient_id}/history", response_model=list[SessionRead])
async def session_history(
    patient: AuthorisedPatient, db: Session, limit: int = 90,
) -> list[SessionRead]:
    """The check-ins themselves — when, which type, finished or not. NO VERDICTS.

    This feeds the patient's own history list and calendar, so what it deliberately does
    not carry matters more than what it does: no band, no score, no deviation. Bands go to
    the caregiver dashboard after aggregation, never to the person at or near the moment of
    performance — a patient reading ALERT off their own calendar the morning after is
    exactly the "app tells me I am declining" experience this product refuses to build.
    `SessionRead` already has that shape; the caregiver's clinical view stays `/dashboard`.

    Authorisation is the standard patient gate, so the same list serves the patient, the
    owning caregiver, and a linked clinician or family member with consent in force.

    Capped and ordered newest-first: the calendar wants a season, not an unbounded table.
    """
    rows = await db.scalars(
        select(ExamSession)
        .where(ExamSession.patient_id == patient.id)
        .order_by(ExamSession.ts.desc())
        .limit(max(1, min(limit, 366)))
    )
    return [SessionRead.model_validate(s) for s in rows]


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
    """Same access rule as `get_patient_for_user` (`app/auth/deps.py`), reimplemented here
    because these three routes resolve `patient_id` from an already-fetched `ExamSession`
    rather than a path parameter, so it cannot be wired in as a FastAPI dependency directly.

    Until this fix, this local copy still granted access to `user.role is Role.clinician`
    unconditionally — the exact pre-Part-3.2 hole `get_patient_for_user` was fixed to close,
    reintroduced here because the fix was never propagated to this duplicate. An unlinked
    clinician could read AND write another patient's raw module features
    (`POST /sessions/{id}/module/{code}`, `POST /sessions/{id}/finalize`) and read them back
    (`GET /sessions/{id}/modules`). Found in the Part 5.1 endpoint data audit.
    """
    from ..auth.deps import caretaker_may_access_patient, clinician_may_access_patient
    from ..models import Role

    patient = await db.get(Patient, patient_id)
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")
    allowed = (
        patient.caregiver_id == user.id
        or (patient.user_id is not None and patient.user_id == user.id)
    )
    if not allowed and user.role is Role.clinician:
        allowed = await clinician_may_access_patient(db, user.id, patient.id)
    if not allowed and user.role is Role.caretaker:
        allowed = await caretaker_may_access_patient(db, user.id, patient.id)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to access this patient")
    return patient
