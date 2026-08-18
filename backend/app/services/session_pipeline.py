"""compute_session — the whole clinical pipeline, TRD §5-§8.

    module features
      -> per-module baseline (build while collecting, compare once locked)
      -> robust z / RCI / CUSUM per module
      -> domain deviations
      -> Gate 1 persistence, Gate 2 cross-modality, IMPROVING override
      -> confounder annotation
      -> deterministic explanation (SLM optional, guardrailed)
      -> persist deviations, score, and an alert only when the band is ALERT

Every step is deterministic and auditable. The one optional component — the SLM — can only
change wording, never the band, and its output is validated against the band before it is
stored.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..engine.baseline import (
    LOCK_AT_N_SESSIONS,
    as_utc,
    Baseline as EngineBaseline,
    SessionObservation,
    build_baseline,
    is_off_window,
)
from ..engine.confounders import ConfounderContext, detect_confounders
from ..engine.deviation import compute_module_deviation
from ..engine.gates import (
    BAND_ALERT,
    BAND_STABLE,
    GateResult,
    SessionDeviations,
    evaluate_gates,
    rank_drivers,
)
from ..exam.registry import MODULES, get_module
from ..models import (
    Alert,
    Band,
    Baseline as BaselineRow,
    BaselineState,
    Deviation,
    ExamSession,
    ModuleResult,
    Patient,
    Score,
)
from ..slm.guardrail import GuardrailResult, explain as slm_explain
from ..slm.prompt import build_slm_input
from ..slm.templates import render_clinician_line, render_template

logger = logging.getLogger("neurotrace.pipeline")

QUALITY_FLOOR = 0.6


async def _module_history(
    session: AsyncSession, patient_id: uuid.UUID, module_code: str,
    before: ExamSession,
) -> list[SessionObservation]:
    """Every prior result for this module, with the metadata the baseline needs."""
    rows = await session.execute(
        select(ModuleResult.features_json, ModuleResult.quality_flag,
               ExamSession.ts, ExamSession.identity_verified,
               ExamSession.off_window, ExamSession.quality_score)
        .join(ExamSession, ModuleResult.session_id == ExamSession.id)
        .where(
            ExamSession.patient_id == patient_id,
            ModuleResult.module_code == module_code,
            ExamSession.ts < before.ts,
            ExamSession.id != before.id,
        )
        .order_by(ExamSession.ts.asc())
    )
    observations: list[SessionObservation] = []
    for features, quality_flag, ts, identity_ok, off_window, quality_score in rows.all():
        feats = dict(features or {})
        if float(feats.get("valid", 0.0)) != 1.0:
            continue
        observations.append(SessionObservation(
            ts=ts, features=feats,
            quality_ok=bool(quality_flag) and float(quality_score or 1.0) >= QUALITY_FLOOR,
            identity_ok=bool(identity_ok),
            off_window=bool(off_window),
        ))
    return observations


def _row_to_engine_baseline(row: BaselineRow) -> EngineBaseline:
    return EngineBaseline(
        module_code=row.module_code,
        median=dict(row.median_json or {}),
        mad=dict(row.mad_json or {}),
        trajectory={k: tuple(v) for k, v in (row.trajectory_json or {}).items()},
        n_sessions=row.n_sessions,
        locked=row.locked,
        reason=row.reason or "",
        window_start=row.window_start,
        window_end=row.window_end,
    )


async def _upsert_baseline(session: AsyncSession, patient_id: uuid.UUID,
                           built: EngineBaseline) -> BaselineRow:
    row = await session.scalar(
        select(BaselineRow).where(BaselineRow.patient_id == patient_id,
                                  BaselineRow.module_code == built.module_code)
    )
    if row is None:
        row = BaselineRow(patient_id=patient_id, module_code=built.module_code)
        session.add(row)
    row.median_json = built.median
    row.mad_json = built.mad
    row.trajectory_json = {k: list(v) for k, v in built.trajectory.items()}
    row.n_sessions = built.n_sessions
    row.n_rejected = built.n_rejected
    row.n_discarded = built.n_discarded
    row.window_start = built.window_start
    row.window_end = built.window_end
    row.locked = built.locked
    row.reason = built.reason[:256]
    return row


async def _recent_sessions(session: AsyncSession, patient_id: uuid.UUID,
                           current: ExamSession, limit: int = 4) -> list[SessionDeviations]:
    """Prior sessions' persisted deviations, chronological, for the persistence gate."""
    rows = await session.execute(
        select(ExamSession.id, ExamSession.quality_score, ExamSession.identity_verified)
        .where(ExamSession.patient_id == patient_id,
               ExamSession.ts < current.ts,
               ExamSession.completed.is_(True))
        .order_by(ExamSession.ts.desc())
        .limit(limit)
    )
    ordered = list(rows.all())[::-1]

    history: list[SessionDeviations] = []
    for session_id, quality, identity_ok in ordered:
        devs = await session.scalars(
            select(Deviation).where(Deviation.session_id == session_id)
        )
        container = SessionDeviations(
            session_id=str(session_id),
            valid=bool(identity_ok) and float(quality or 1.0) >= QUALITY_FLOOR,
        )
        for row in devs:
            from ..engine.deviation import ModuleDeviation
            container.modules[row.module_code] = ModuleDeviation(
                module_code=row.module_code, domain=row.domain,
                mean_abs_z=row.mean_abs_z, max_abs_z=row.max_abs_z,
                cusum=row.cusum_stat, cusum_alarm=row.cusum_alarm,
                improving=row.improving, computed=True, gateable=row.gateable,
            )
        history.append(container)
    return history


async def compute_session(
    db: AsyncSession,
    session_id: uuid.UUID,
    *,
    generate=None,
    commit: bool = True,
) -> dict:
    """Score one exam session end to end and persist the result.

    Idempotent: recomputing replaces this session's deviations, score and alert.
    """
    exam = await db.get(ExamSession, session_id)
    if exam is None:
        raise ValueError(f"session {session_id} not found")
    patient = await db.get(Patient, exam.patient_id)
    if patient is None:
        raise ValueError(f"patient {exam.patient_id} not found")

    exam_ts = as_utc(exam.ts)
    exam.off_window = is_off_window(exam_ts, patient.preferred_hour)

    results = list(await db.scalars(
        select(ModuleResult).where(ModuleResult.session_id == session_id)
    ))
    if not results:
        raise ValueError("session has no module results to score")

    today = SessionDeviations(
        session_id=str(session_id),
        valid=exam.identity_verified and exam.quality_score >= QUALITY_FLOOR,
    )
    baseline_phase = False
    min_baseline_n = 10**6

    # --- per module: build or compare ---
    for result in results:
        try:
            module = get_module(result.module_code)
        except KeyError:
            logger.warning("unknown module %s on session %s", result.module_code, session_id)
            continue
        if not module.scoring_keys:
            continue

        features = dict(result.features_json or {})
        if float(features.get("valid", 0.0)) != 1.0:
            continue

        history = await _module_history(db, patient.id, module.code, exam)
        row = await db.scalar(
            select(BaselineRow).where(BaselineRow.patient_id == patient.id,
                                      BaselineRow.module_code == module.code)
        )

        if row is None or not row.locked:
            # Still collecting. Today feeds the baseline; it is not judged.
            observation = SessionObservation(
                ts=exam_ts, features=features,
                quality_ok=exam.quality_score >= QUALITY_FLOOR,
                identity_ok=exam.identity_verified,
                off_window=exam.off_window,
            )
            built = build_baseline(module.code, [*history, observation],
                                   list(module.scoring_keys))
            row = await _upsert_baseline(db, patient.id, built)
            baseline_phase = True
            min_baseline_n = min(min_baseline_n, built.n_sessions)
            continue

        engine_baseline = _row_to_engine_baseline(row)
        min_baseline_n = min(min_baseline_n, row.n_sessions)

        days = 0.0
        if row.window_start is not None:
            days = (exam_ts - as_utc(row.window_start)).total_seconds() / 86400.0

        previous_cusum = await db.scalar(
            select(Deviation.cusum_stat)
            .join(ExamSession, Deviation.session_id == ExamSession.id)
            .where(ExamSession.patient_id == patient.id,
                   Deviation.module_code == module.code,
                   ExamSession.ts < exam.ts)
            .order_by(ExamSession.ts.desc())
            .limit(1)
        ) or 0.0

        deviation = compute_module_deviation(
            module.code, module.domain, features, engine_baseline,
            list(module.scoring_keys),
            days_since_window_start=days,
            bad_direction=dict(module.bad_direction),
            previous_cusum=float(previous_cusum),
            gates_alerts=module.gates_alerts,
        )
        today.modules[module.code] = deviation

    # --- gates ---
    history_sessions = await _recent_sessions(db, patient.id, exam)
    history_sessions.append(today)
    gate: GateResult = evaluate_gates(history_sessions)

    if baseline_phase:
        # Never band a patient whose baseline is still forming.
        gate = GateResult(band=BAND_STABLE, reason="baseline still being collected")

    band = Band(gate.band)
    drivers = rank_drivers(today, k=3)

    # --- confounders ---
    ctx = ConfounderContext(
        session_ts=exam_ts,
        quality_score=exam.quality_score,
        identity_verified=exam.identity_verified,
        off_window=exam.off_window,
        baseline_n_sessions=min_baseline_n if min_baseline_n < 10**6 else 0,
        baseline_lock_at=LOCK_AT_N_SESSIONS,
        quality_floor=QUALITY_FLOOR,
    )
    confounders = detect_confounders(ctx)

    # --- explanation (deterministic; SLM only rephrases, and is validated) ---
    lang = (patient.languages or ["en"])[0] if patient.languages else "en"
    sustained = gate.gate1_passed and gate.gate2_passed

    payload_en = build_slm_input(band.value, drivers, confounders.active, "en",
                                 baseline_phase=baseline_phase,
                                 improving=gate.improving, sustained=sustained)
    generated: GuardrailResult = slm_explain(payload_en, generate=generate)
    explanation_en = generated.text

    explanation_hi = render_template(
        band.value, drivers=drivers, confounders=confounders.active, lang="hi",
        baseline_phase=baseline_phase, improving=gate.improving, sustained=sustained,
    )
    clinician_line = render_clinician_line(
        band.value, gate.persistent_domains,
        gate.sustained_sessions or len(history_sessions), confounders.active
    )

    # --- persist (idempotent) ---
    existing = await db.scalar(select(Score).where(Score.session_id == session_id))
    if existing is not None:
        await db.execute(delete(Alert).where(Alert.score_id == existing.id))
        await db.execute(delete(Score).where(Score.id == existing.id))
    await db.execute(delete(Deviation).where(Deviation.session_id == session_id))
    await db.flush()

    for code, deviation in today.modules.items():
        db.add(Deviation(
            session_id=session_id, module_code=code, domain=deviation.domain,
            rci_json={f.key: f.rci for f in deviation.features},
            mean_abs_z=deviation.mean_abs_z, max_abs_z=deviation.max_abs_z,
            cusum_stat=deviation.cusum, cusum_alarm=deviation.cusum_alarm,
            improving=deviation.improving,
            gateable=deviation.gateable,
            flagged=code in {m for m in today.modules
                             if today.modules[m].domain in gate.flagged_today},
        ))

    score = Score(
        patient_id=patient.id, session_id=session_id,
        domain_devs_json=today.domain_deviation(gateable_only=False),
        band=band,
        gate1_passed=gate.gate1_passed, gate2_passed=gate.gate2_passed,
        persistent_domains=list(gate.persistent_domains),
        drivers_json=[list(d) for d in drivers],
        confounders_json=confounders.to_json(),
        confidence=confounders.confidence,
        improving=gate.improving,
        reason=gate.reason[:512],
        baseline_phase=baseline_phase,
        explanation_en=explanation_en,
        explanation_hi=explanation_hi,
        explanation_source=generated.source,
    )
    db.add(score)
    await db.flush()

    alert_id = None
    if band is Band.ALERT and await _is_episode_onset(db, patient.id, exam_ts):
        alert = Alert(
            patient_id=patient.id, score_id=score.id, band=band,
            drivers_json=[list(d) for d in drivers],
            confounders_json=confounders.to_json(),
            explanation_en=explanation_en, explanation_hi=explanation_hi,
            clinician_line=clinician_line,
        )
        db.add(alert)
        await db.flush()
        alert_id = alert.id

    exam.completed = True
    await _refresh_baseline_state(db, patient)

    if commit:
        await db.commit()
    else:
        await db.flush()

    logger.info("session %s -> %s (gate1=%s gate2=%s conf=%.2f)",
                session_id, band.value, gate.gate1_passed, gate.gate2_passed,
                confounders.confidence)

    return {
        "session_id": str(session_id),
        "patient_id": str(patient.id),
        "band": band.value,
        "reason": gate.reason,
        "gate1_passed": gate.gate1_passed,
        "gate2_passed": gate.gate2_passed,
        "persistent_domains": gate.persistent_domains,
        "domain_deviations": today.domain_deviation(gateable_only=False),
        "drivers": [list(d) for d in drivers],
        "confounders": confounders.to_json(),
        "confidence": confounders.confidence,
        "improving": gate.improving,
        "sustained_sessions": gate.sustained_sessions,
        "baseline_phase": baseline_phase,
        "baseline_state": patient.baseline_state.value,
        "explanation_en": explanation_en,
        "explanation_hi": explanation_hi,
        "explanation_source": generated.source,
        "guardrail_violations": generated.violations,
        "clinician_line": clinician_line,
        "alert_id": str(alert_id) if alert_id else None,
    }


async def _refresh_baseline_state(db: AsyncSession, patient: Patient) -> None:
    rows = list(await db.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
    ))
    if not rows:
        patient.baseline_state = BaselineState.not_started
    elif all(r.locked for r in rows):
        patient.baseline_state = BaselineState.locked
    else:
        patient.baseline_state = BaselineState.collecting


async def _is_episode_onset(db: AsyncSession, patient_id: uuid.UUID,
                            current_ts) -> bool:
    """True when today starts a NEW alert episode rather than continuing one.

    Once two domains are sustained, the band correctly stays ALERT for as long as that
    remains true — the patient has not improved just because we already said so. But
    raising a fresh alert every single day of a continuing episode is how a product trains
    a family to ignore it. So the band persists and the notification does not: one alert
    per episode, until the band returns to WATCH or STABLE and later rises again.
    """
    previous = await db.scalar(
        select(Score.band)
        .join(ExamSession, Score.session_id == ExamSession.id)
        .where(Score.patient_id == patient_id, ExamSession.ts < current_ts)
        .order_by(ExamSession.ts.desc())
        .limit(1)
    )
    return previous is not Band.ALERT
