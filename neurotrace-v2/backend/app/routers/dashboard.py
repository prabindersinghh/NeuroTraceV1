"""/dashboard — the caregiver view: status, trends, history, alerts. TRD §6."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import get_patient_for_user
from ..db import get_session
from ..ml.baseline import BASELINE_DAYS
from ..ml.scoring import BANDS, DEV_THRESHOLD
from ..models import Alert, Baseline, DailySample, Patient, Score
from ..schemas import (
    AlertRead,
    DashboardResponse,
    HistoryRow,
    PatientRead,
    ScoreRead,
    TrendPoint,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/{patient_id}", response_model=DashboardResponse)
async def dashboard(
    patient: Annotated[Patient, Depends(get_patient_for_user)],
    session: Session,
    days: Annotated[int, Query(ge=1, le=365, description="How many recent days to return")] = 30,
) -> DashboardResponse:
    rows = list(
        await session.execute(
            select(Score, DailySample.ts)
            .join(DailySample, Score.sample_id == DailySample.id)
            .where(Score.patient_id == patient.id)
            .order_by(DailySample.ts.desc(), DailySample.id.desc())
            .limit(days)
        )
    )
    rows.reverse()  # chronological for the charts

    trends = [
        TrendPoint(
            date=ts,
            sample_id=score.sample_id,
            voice_dev=score.voice_dev,
            face_dev=score.face_dev,
            reaction_dev=score.reaction_dev,
            stability_score=score.stability_score,
            band=score.band,
            baseline_day=score.baseline_day,
        )
        for score, ts in rows
    ]
    history = [
        HistoryRow(
            date=ts,
            band=score.band,
            stability_score=score.stability_score,
            reason=score.reason,
            explanation_en=score.explanation_en,
            explanation_hi=score.explanation_hi,
            baseline_day=score.baseline_day,
        )
        for score, ts in reversed(rows)  # newest first for the table
    ]

    latest_score = rows[-1][0] if rows else None

    alerts = list(
        await session.scalars(
            select(Alert)
            .where(Alert.patient_id == patient.id)
            .order_by(Alert.created_at.desc())
            .limit(50)
        )
    )

    baseline_rows = list(
        await session.scalars(select(Baseline).where(Baseline.patient_id == patient.id))
    )
    days_recorded = min((b.n_days for b in baseline_rows), default=0)

    return DashboardResponse(
        patient=PatientRead.model_validate(patient),
        baseline_ready=patient.baseline_ready,
        baseline_days_recorded=days_recorded,
        baseline_days_required=BASELINE_DAYS,
        latest=ScoreRead.model_validate(latest_score) if latest_score else None,
        latest_explanation_en=latest_score.explanation_en if latest_score else None,
        latest_explanation_hi=latest_score.explanation_hi if latest_score else None,
        trends=trends,
        history=history,
        alerts=[AlertRead.model_validate(a) for a in alerts],
        dev_threshold=DEV_THRESHOLD,
        band_thresholds={name: float(lo) for lo, _hi, name in BANDS},
    )
