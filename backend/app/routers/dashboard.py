"""/dashboard and /clinic — the caregiver and clinician views. TRD §9.

Two audiences, two different contracts:

* The **caregiver** sees a band, a plain-language explanation and trends. WATCH is visible
  but never notifies — alert fatigue is the failure mode that kills adherence.
* The **clinician** sees a list ranked by *sustained* deviation, never a bare number. Every
  row states what it is relative to ("2 domains, 3 sessions, vs this patient's baseline")
  because a number without its comparison is not clinically actionable.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user, require_roles
from ..db import get_session
from ..engine.baseline import BASELINE_WINDOW_MAX_DAYS, BASELINE_WINDOW_MIN_DAYS, LOCK_AT_N_SESSIONS
from ..engine.gates import DEV_THRESHOLD
from ..exam.registry import MODULES
from ..models import (
    Adherence,
    Alert,
    AuditLog,
    Band,
    Baseline,
    ConsentType,
    ExamSession,
    Patient,
    PatientClinicianLink,
    Questionnaire,
    Role,
    Score,
    User,
)
from ..services.consent import consent_currently_granted
from ..safety.fast import fast_card, resolve_lang
from ..schemas import (
    AlertRead,
    AuditRow,
    BaselineProgress,
    ClinicListResponse,
    ClinicPatientRow,
    DashboardResponse,
    HistoryRow,
    MessageResponse,
    PatientRead,
    QuestionnaireRead,
    ScoreRead,
    TrendPoint,
)

router = APIRouter(tags=["dashboard"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]
Clinician = Annotated[User, Depends(require_roles(Role.clinician))]


@router.get("/dashboard/{patient_id}", response_model=DashboardResponse)
async def dashboard(
    patient: AuthorisedPatient, user: CurrentUser, db: Session,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    lang: Annotated[str | None, Query(pattern="^(en|hi|pa)$")] = None,
) -> DashboardResponse:
    rows = list(await db.execute(
        select(Score, ExamSession.ts)
        .join(ExamSession, Score.session_id == ExamSession.id)
        .where(Score.patient_id == patient.id)
        .order_by(ExamSession.ts.desc(), ExamSession.id.desc())
        .limit(days)
    ))
    rows.reverse()

    trends = [
        TrendPoint(
            date=ts, session_id=score.session_id, band=score.band,
            domain_devs=dict(score.domain_devs_json or {}),
            confidence=score.confidence, baseline_phase=score.baseline_phase,
            cumulative_drift=float(score.cumulative_drift or 0.0),
            drift_flagged=bool(score.drift_flagged),
        )
        for score, ts in rows
    ]
    history = [
        HistoryRow(
            date=ts, band=score.band, reason=score.reason,
            explanation_en=score.explanation_en, explanation_hi=score.explanation_hi,
            confidence=score.confidence, baseline_phase=score.baseline_phase,
            confounders=list((score.confounders_json or {}).get("active", [])),
        )
        for score, ts in reversed(rows)
    ]

    baseline_rows = list(await db.scalars(
        select(Baseline).where(Baseline.patient_id == patient.id)
    ))
    scored_modules = [m for m in MODULES.values() if m.scoring_keys]
    progress = BaselineProgress(
        state=patient.baseline_state,
        modules_locked=sum(1 for b in baseline_rows if b.locked),
        modules_total=len(scored_modules),
        min_sessions=min((b.n_sessions for b in baseline_rows), default=0),
        required_sessions=LOCK_AT_N_SESSIONS,
        window_min_days=BASELINE_WINDOW_MIN_DAYS,
        window_max_days=BASELINE_WINDOW_MAX_DAYS,
    )

    alerts = list(await db.scalars(
        select(Alert).where(Alert.patient_id == patient.id)
        .order_by(Alert.created_at.desc()).limit(50)
    ))

    streak, rate = await _adherence(db, patient.id)

    questionnaires = list(await db.scalars(
        select(Questionnaire).where(Questionnaire.patient_id == patient.id)
        .order_by(Questionnaire.ts.desc()).limit(10)
    ))

    db.add(AuditLog(actor_id=user.id, action="dashboard.view", patient_id=patient.id))
    await db.commit()

    return DashboardResponse(
        patient=PatientRead.model_validate(patient),
        baseline=progress,
        latest=ScoreRead.model_validate(rows[-1][0]) if rows else None,
        trends=trends,
        history=history,
        alerts=[AlertRead.model_validate(a) for a in alerts],
        adherence_streak=streak,
        adherence_rate_30d=rate,
        latest_questionnaires=[QuestionnaireRead.model_validate(q) for q in questionnaires],
        dev_threshold=DEV_THRESHOLD,
        # TRD §8: on every dashboard, unconditionally — in the language the reader
        # has the app set to, not the one on the record. See safety/fast.resolve_lang.
        fast=fast_card(resolve_lang(lang, patient.languages)),
    )


async def _adherence(db: AsyncSession, patient_id: uuid.UUID) -> tuple[int, float]:
    rows = list(await db.scalars(
        select(Adherence).where(Adherence.patient_id == patient_id)
        .order_by(Adherence.ts.desc()).limit(30)
    ))
    if not rows:
        return 0, 0.0
    streak = 0
    for row in rows:
        if row.taken:
            streak += 1
        else:
            break
    return streak, sum(1 for r in rows if r.taken) / len(rows)


# --------------------------------------------------------------------------- clinician
@router.get("/clinic/patients", response_model=ClinicListResponse)
async def clinic_patients(clinician: Clinician, db: Session) -> ClinicListResponse:
    """All patients, ranked by sustained deviation — not by today's number.

    Ranking on a single session's magnitude would put every noisy morning at the top of a
    busy clinician's list. Ranking on how many domains have been persistently deviating,
    and for how long, puts the patients who actually need review at the top.
    """
    # SCOPED TO THIS CLINICIAN'S LINKED PATIENTS (Part 3.2).
    #
    # This was `select(Patient)` — every clinician saw every patient in the deployment,
    # with no scoping of any kind. `Patient.clinician_id` existed and was never used here.
    # An active row in `patient_clinician_links` is now what puts a patient on a roster.
    linked = list(await db.scalars(
        select(Patient)
        .join(PatientClinicianLink, PatientClinicianLink.patient_id == Patient.id)
        .where(PatientClinicianLink.clinician_id == clinician.id,
               PatientClinicianLink.unlinked_at.is_(None))
        .order_by(Patient.name)
    ))
    # Part 4: an active link is not enough — C3 (CLINICIAN_SHARING) must also currently be
    # in force. A withdrawn patient must not appear on the roster with a name attached; the
    # per-patient routes enforce the same rule via `clinician_may_access_patient`, so this
    # keeps the roster consistent with what those routes will actually let the clinician see.
    patients = [
        p for p in linked
        if await consent_currently_granted(db, p.id, ConsentType.CLINICIAN_SHARING)
    ]
    out: list[ClinicPatientRow] = []

    for patient in patients:
        latest = await db.scalar(
            select(Score).join(ExamSession, Score.session_id == ExamSession.id)
            .where(Score.patient_id == patient.id)
            .order_by(ExamSession.ts.desc()).limit(1)
        )
        last_ts = await db.scalar(
            select(func.max(ExamSession.ts)).where(ExamSession.patient_id == patient.id)
        )
        unack = await db.scalar(
            select(func.count()).select_from(Alert)
            .where(Alert.patient_id == patient.id, Alert.acknowledged_at.is_(None))
        ) or 0

        band_value = latest.band.value if latest else None
        symmetric = bool(latest.symmetric_pattern) if latest else False

        # The atypical pattern gets its own card. It is not a deviation alert: nothing
        # focal was found, and the useful action is a different diagnostic conversation
        # rather than a stroke work-up.
        if symmetric or band_value == Band.PATTERN_ATYPICAL.value:
            card_type = "atypical_pattern"
            card_note = ("Symmetric progressive change across face, movement and voice "
                         "with no lateralised finding. Not a focal pattern - consider "
                         "non-vascular causes including parkinsonian syndromes.")
        elif band_value in (Band.ALERT.value, Band.WATCH.value):
            card_type, card_note = "deviation", None
        elif latest is not None and latest.drift_flagged:
            # Day-to-day looks unremarkable, but they are a long way from the normal this
            # patient established. That is the decline an adaptive baseline absorbs, and it
            # is the one finding that would otherwise never reach anybody.
            card_type = "cumulative_drift"
            card_note = (
                f"Day-to-day comparison is unremarkable, but cumulative drift from the "
                f"baseline established at lock is {latest.cumulative_drift:.1f} MAD - "
                f"beyond RCI. Slow decline that the adaptive baseline does not register."
            )
        else:
            card_type, card_note = "routine", None

        out.append(ClinicPatientRow(
            patient_id=patient.id, name=patient.name, age=patient.age,
            band=latest.band if latest else None,
            sustained_domains=list(latest.persistent_domains or []) if latest else [],
            lateralised_domains=list(latest.lateralised_domains or []) if latest else [],
            confidence=latest.confidence if latest else 1.0,
            last_session=last_ts,
            unacknowledged_alerts=int(unack),
            baseline_state=patient.baseline_state,
            cumulative_drift=float(latest.cumulative_drift) if latest else 0.0,
            drift_flagged=bool(latest.drift_flagged) if latest else False,
            card_type=card_type,
            card_note=card_note,
        ))

    # PATTERN_ATYPICAL ranks alongside WATCH. It is not an emergency, but it is a real and
    # progressive finding - dropping it below STABLE would bury the one signal the engine
    # deliberately refused to raise an alert about.
    rank = {"ALERT": 0, "WATCH": 1, "PATTERN_ATYPICAL": 1, "STABLE": 2, None: 3}
    out.sort(key=lambda r: (rank.get(r.band.value if r.band else None, 3),
                            # A drift flag lifts a patient above the quiet STABLE ones they
                            # would otherwise be sorted among.
                            0 if r.drift_flagged else 1,
                            -len(r.sustained_domains), -r.unacknowledged_alerts))

    db.add(AuditLog(actor_id=clinician.id, action="clinic.list"))
    await db.commit()
    return ClinicListResponse(patients=out)


@router.post("/clinic/alerts/{alert_id}/acknowledge", response_model=MessageResponse)
async def acknowledge_alert(alert_id: uuid.UUID, clinician: Clinician,
                            db: Session) -> MessageResponse:
    """Role-gated to `clinician`, but until this fix had no check that THIS clinician is
    linked to the alert's patient — any clinician account could acknowledge any patient's
    alert given the (UUID) `alert_id`. Found in the Part 5.1 endpoint data audit."""
    from ..auth.deps import clinician_may_access_patient

    alert = await db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    if not await clinician_may_access_patient(db, clinician.id, alert.patient_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to acknowledge this alert")
    alert.acknowledged_by = clinician.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.add(AuditLog(actor_id=clinician.id, action="alert.acknowledge",
                    patient_id=alert.patient_id, meta_json={"alert_id": str(alert_id)}))
    await db.commit()
    return MessageResponse(detail="Alert acknowledged")


@router.get("/audit/{patient_id}", response_model=list[AuditRow])
async def audit_trail(patient: AuthorisedPatient, user: CurrentUser, db: Session,
                      limit: Annotated[int, Query(ge=1, le=500)] = 200) -> list[AuditRow]:
    if user.role is Role.patient:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Audit trail is not patient-facing")
    rows = await db.scalars(
        select(AuditLog).where(AuditLog.patient_id == patient.id)
        .order_by(AuditLog.ts.desc()).limit(limit)
    )
    return [AuditRow.model_validate(r) for r in rows]
