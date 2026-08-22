"""/questionnaire, /vitals, /adherence — Domain F and G capture. TRD §9.

These are separated from `/sessions` because they are not always part of an exam battery:
a caregiver may enter a blood pressure reading on Tuesday and complete the weekly FSS on
Thursday. Where they *do* belong to a session, `session_id` links them.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..db import get_session
from ..exam.questionnaires import score_instrument
from ..exam.vitals import extract_adherence, extract_blood_pressure, extract_rhythm
from ..models import Adherence, AuditLog, Patient, Questionnaire, Vital
from ..safety.fast import fast_card
from ..schemas import (
    AdherenceRead,
    AdherenceSubmit,
    QuestionnaireRead,
    QuestionnaireSubmit,
    VitalRead,
    VitalSubmit,
)

router = APIRouter(tags=["clinical-data"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]

_SCORE_KEY = {
    "PHQ2": "phq2_score", "PHQ9": "phq9_score", "FSS": "fss_mean",
    "BARTHEL": "barthel_score", "EAT10": "eat10_score",
}


@router.post("/questionnaire/{patient_id}", response_model=QuestionnaireRead,
             status_code=status.HTTP_201_CREATED)
async def submit_questionnaire(
    payload: QuestionnaireSubmit, patient: AuthorisedPatient,
    user: CurrentUser, db: Session,
) -> QuestionnaireRead:
    """Score a validated instrument and store it.

    A positive PHQ-9 item 9 (self-harm) is surfaced in `flags_json` and audited. It does
    not go through the deviation engine at all — it is not a trend, it is a now.
    """
    result = score_instrument(payload.instrument.value, payload.responses)
    if result.get("valid") != 1.0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Incomplete responses for {payload.instrument.value}")

    key = _SCORE_KEY[payload.instrument.value]
    flags = {k: v for k, v in result.items()
             if k not in {"valid", "instrument", key} and v not in (None, "", 0.0)}

    row = Questionnaire(
        patient_id=patient.id, session_id=payload.session_id,
        instrument=payload.instrument, score=float(result[key]),
        responses_json={"responses": payload.responses}, flags_json=flags,
    )
    db.add(row)

    if result.get("requires_urgent_review"):
        db.add(AuditLog(actor_id=user.id, action="questionnaire.urgent",
                        patient_id=patient.id,
                        meta_json={"instrument": payload.instrument.value}))
    await db.commit()
    await db.refresh(row)
    return QuestionnaireRead.model_validate(row)


@router.post("/vitals/{patient_id}", response_model=VitalRead,
             status_code=status.HTTP_201_CREATED)
async def submit_vitals(
    payload: VitalSubmit, patient: AuthorisedPatient, user: CurrentUser, db: Session,
) -> VitalRead:
    bp = extract_blood_pressure({"bp_sys": payload.bp_sys, "bp_dia": payload.bp_dia})
    rhythm = extract_rhythm({"rr_ms": (payload.ppg_features or {}).get("rr_ms")}) \
        if payload.ppg_features else {"valid": 0.0}

    row = Vital(
        patient_id=patient.id, session_id=payload.session_id,
        bp_sys=payload.bp_sys, bp_dia=payload.bp_dia,
        rhythm_flag=bool(rhythm.get("irregular_rhythm_flag", 0.0)),
        ppg_features_json={k: v for k, v in rhythm.items() if k != "valid"} or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    if bp.get("bp_urgent_flag") or row.rhythm_flag:
        db.add(AuditLog(actor_id=user.id, action="vitals.advisory", patient_id=patient.id,
                        meta_json={"bp": bp.get("advisory"), "rhythm": rhythm.get("advisory")}))
        await db.commit()
    return VitalRead.model_validate(row)


@router.post("/adherence/{patient_id}", response_model=AdherenceRead,
             status_code=status.HTTP_201_CREATED)
async def submit_adherence(
    payload: AdherenceSubmit, patient: AuthorisedPatient, db: Session,
) -> AdherenceRead:
    row = Adherence(patient_id=patient.id, taken=payload.taken)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return AdherenceRead.model_validate(row)


@router.get("/report/{patient_id}")
async def exam_report(patient: AuthorisedPatient, user: CurrentUser, db: Session) -> dict:
    """Structured exam report for the clinician (the PDF renderer consumes this).

    Returned as JSON rather than a binary PDF so the same payload can drive the on-screen
    clinician view and a printed export without diverging.
    """
    from sqlalchemy import select

    from ..models import Baseline, ExamSession, Score

    scores = list(await db.execute(
        select(Score, ExamSession.ts)
        .join(ExamSession, Score.session_id == ExamSession.id)
        .where(Score.patient_id == patient.id)
        .order_by(ExamSession.ts.desc()).limit(30)
    ))
    baselines = list(await db.scalars(
        select(Baseline).where(Baseline.patient_id == patient.id)
    ))

    db.add(AuditLog(actor_id=user.id, action="report.export", patient_id=patient.id))
    await db.commit()

    return {
        "patient": {
            "id": str(patient.id), "name": patient.name, "age": patient.age,
            "sex": patient.sex, "stroke_side": patient.stroke_side.value,
            "stroke_date": patient.stroke_date.isoformat() if patient.stroke_date else None,
            "enrolment_date": patient.enrolment_date.isoformat(),
            "baseline_state": patient.baseline_state.value,
        },
        "baselines": [
            {"module_code": b.module_code, "locked": b.locked, "n_sessions": b.n_sessions,
             "n_rejected": b.n_rejected, "n_discarded": b.n_discarded,
             "window_start": b.window_start.isoformat() if b.window_start else None,
             "window_end": b.window_end.isoformat() if b.window_end else None}
            for b in baselines
        ],
        "sessions": [
            {"date": ts.isoformat(), "band": s.band.value, "reason": s.reason,
             "domain_deviations": s.domain_devs_json,
             "gate1": s.gate1_passed, "gate2": s.gate2_passed,
             "confidence": s.confidence,
             "confounders": (s.confounders_json or {}).get("active", []),
             "clinician_note": s.reason}
            for s, ts in scores
        ],
        "method_note": (
            "All deviations are computed against this patient's own median/MAD baseline "
            "using a robust z-score and a Reliable Change Index. An ALERT requires two "
            "independent domains to exceed threshold across two consecutive valid "
            "sessions. This is a monitoring aid and does not constitute a diagnosis."
        ),
        "fast": fast_card("en"),
    }


@router.get("/trace/{patient_id}")
async def movement_trace(patient: AuthorisedPatient, db: Session,
                         session_id: uuid.UUID | None = None) -> dict:
    """The craniocorpography movement trace — latest session, or a named one.

    This is the output a vestibular specialist reads first. A clinical CCG apparatus films
    the patient stepping with their eyes closed and plots how the head travelled; the
    numbers come second. Returning the same shape means the finding arrives in a format the
    clinician already trusts, rather than as four unfamiliar quantities from a phone.
    """
    from sqlalchemy import select

    from ..exam.registry import MODULES
    from ..models import ExamSession, ModuleResult

    stmt = (
        select(ModuleResult, ExamSession.ts)
        .join(ExamSession, ModuleResult.session_id == ExamSession.id)
        .where(ExamSession.patient_id == patient.id, ModuleResult.module_code == "M9")
        .order_by(ExamSession.ts.desc())
    )
    if session_id is not None:
        stmt = stmt.where(ModuleResult.session_id == session_id)
    row = (await db.execute(stmt.limit(1))).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND,
                            "No balance capture recorded for this patient yet")

    result, ts = row
    features = dict(result.features_json or {})
    trace = dict(result.trace_json or {})
    captured = float(features.get("tests_captured") or 0.0)
    total = len(MODULES["M9"].tasks)

    return {
        "patient_id": str(patient.id),
        "session_id": str(result.session_id),
        "date": ts.isoformat(),
        "units": "cm",
        "traces": trace.get("traces", {}),
        "metrics": {
            k: round(float(v), 2) for k, v in features.items()
            if k.endswith(("_cm", "_cm2", "_deg", "_cm_s")) or k == "romberg_quotient"
        },
        "tests_captured": captured,
        "tests_total": total,
        # Stated on the payload so a partial capture can never be read as a complete one.
        "complete": captured >= total,
        "laterality_available": bool(features.get("laterality_available")),
        "note": (
            None if captured >= total else
            "Partial capture: the walking and stepping tests need someone present, so they "
            "were not recorded. Sway is measured; the direction of deviation is not."
        ),
    }
