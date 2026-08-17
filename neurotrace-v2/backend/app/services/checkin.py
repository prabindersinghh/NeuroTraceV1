"""compute_checkin — the daily pipeline that turns one sample into a score + alert.

Chain (TRD §4):
    features -> baseline (build while < BASELINE_DAYS valid days, else z-scores)
             -> per-modality deviation -> stability score
             -> alert_decision over the last SUSTAIN_DAYS days
             -> explanation (EN + HI)
             -> persist a scores row, and an alerts row when the band is ALERT.

None of the maths lives here. Every number comes from app.ml.* which is the verified
reference implementation, unchanged.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ml.baseline import BASELINE_DAYS, build_baseline, modality_deviation, z_scores
from ..ml.explain import explain, top_drivers
from ..ml.scoring import SUSTAIN_DAYS, alert_decision, stability_score
from ..models import Alert, Baseline, Band, DailySample, FeatureVector, Modality, Patient, Score, SampleStatus
from ..schemas import CheckinResult
from .whatsapp import send_alert

logger = logging.getLogger("neurotrace.checkin")

MODALITIES: tuple[Modality, ...] = (Modality.voice, Modality.face, Modality.reaction)


def scoring_keys_for(modality: Modality) -> list[str]:
    """Feature subset each modality is scored on.

    Imported lazily and per-modality: `speech` pulls in librosa and `face` pulls in
    MediaPipe/OpenCV, so a missing capture-time dependency degrades that one modality
    instead of taking down the whole service.
    """
    if modality is Modality.voice:
        from ..ml.speech import SPEECH_SCORING_KEYS

        return list(SPEECH_SCORING_KEYS)
    if modality is Modality.face:
        from ..ml.face import FACE_SCORING_KEYS

        return list(FACE_SCORING_KEYS)
    from ..ml.reaction import REACTION_SCORING_KEYS

    return list(REACTION_SCORING_KEYS)


def _is_valid(features: dict | None) -> bool:
    return bool(features) and float(features.get("valid", 0.0)) == 1.0


async def _load_today_features(session: AsyncSession, sample_id: uuid.UUID) -> dict[Modality, dict]:
    rows = await session.scalars(
        select(FeatureVector).where(FeatureVector.sample_id == sample_id)
    )
    return {fv.modality: dict(fv.features_json or {}) for fv in rows}


async def _prior_valid_features(
    session: AsyncSession, patient_id: uuid.UUID, modality: Modality, sample: DailySample
) -> list[dict]:
    """Every valid feature dict for this modality from days strictly before `sample`.

    Chronological. The `valid` flag is filtered in Python rather than with SQL-JSON so the
    query stays dialect-neutral; the row count is one per patient-day, so this is cheap.
    """
    rows = await session.scalars(
        select(FeatureVector.features_json)
        .join(DailySample, FeatureVector.sample_id == DailySample.id)
        .where(
            DailySample.patient_id == patient_id,
            FeatureVector.modality == modality,
            DailySample.ts < sample.ts,
            DailySample.id != sample.id,
        )
        .order_by(DailySample.ts.asc(), DailySample.id.asc())
    )
    return [features for row in rows if _is_valid(features := dict(row or {}))]


async def _upsert_baseline(
    session: AsyncSession, patient_id: uuid.UUID, modality: Modality, built: dict
) -> Baseline:
    row = await session.scalar(
        select(Baseline).where(Baseline.patient_id == patient_id, Baseline.modality == modality)
    )
    if row is None:
        row = Baseline(patient_id=patient_id, modality=modality)
        session.add(row)
    row.mean_json = built.get("mean", {})
    row.std_json = built.get("std", {})
    row.n_days = int(built.get("n_days", 0))
    row.ready = bool(built.get("ready", False))
    return row


async def _recent_history(
    session: AsyncSession, patient_id: uuid.UUID, sample: DailySample
) -> list[dict]:
    """The last SUSTAIN_DAYS-1 persisted days, chronological (oldest first)."""
    rows = await session.execute(
        select(Score.voice_dev, Score.face_dev, Score.reaction_dev, Score.stability_score)
        .join(DailySample, Score.sample_id == DailySample.id)
        .where(
            Score.patient_id == patient_id,
            DailySample.ts < sample.ts,
            Score.sample_id != sample.id,
        )
        .order_by(DailySample.ts.desc(), DailySample.id.desc())
        .limit(max(0, SUSTAIN_DAYS - 1))
    )
    history = [
        {
            "devs": {"voice": float(v), "face": float(f), "reaction": float(r)},
            "score": float(s),
        }
        for v, f, r, s in rows.all()
    ]
    history.reverse()
    return history


async def _refresh_baseline_ready(session: AsyncSession, patient: Patient) -> bool:
    rows = list(
        await session.scalars(select(Baseline).where(Baseline.patient_id == patient.id))
    )
    ready = bool(rows) and all(r.ready and r.n_days >= BASELINE_DAYS for r in rows)
    patient.baseline_ready = ready
    return ready


async def compute_checkin(
    session: AsyncSession,
    patient_id: uuid.UUID,
    sample_id: uuid.UUID,
    *,
    notify: bool = True,
    commit: bool = True,
) -> CheckinResult:
    """Score one daily sample end to end and persist the result.

    Idempotent: recomputing the same sample replaces its previous score/alert rows.
    """
    sample = await session.get(DailySample, sample_id)
    if sample is None or sample.patient_id != patient_id:
        raise ValueError(f"sample {sample_id} does not belong to patient {patient_id}")

    patient = await session.get(Patient, patient_id)
    if patient is None:
        raise ValueError(f"patient {patient_id} not found")

    today = await _load_today_features(session, sample_id)

    devs: dict[str, float] = {}
    valid_flags: dict[str, bool] = {}
    all_z: dict[str, float] = {}
    baseline_day = False

    for modality in MODALITIES:
        name = modality.value
        features = today.get(modality)
        valid_flags[name] = _is_valid(features)
        devs[name] = 0.0
        if not valid_flags[name]:
            continue

        keys = scoring_keys_for(modality)
        prior = await _prior_valid_features(session, patient_id, modality, sample)

        if len(prior) < BASELINE_DAYS:
            # Still learning this patient's normal — today feeds the baseline, it is not judged.
            built = build_baseline([*prior, features], keys)
            await _upsert_baseline(session, patient_id, modality, built)
            baseline_day = True
            continue

        row = await session.scalar(
            select(Baseline).where(
                Baseline.patient_id == patient_id, Baseline.modality == modality
            )
        )
        if row is None or not row.ready:
            # Baseline row missing (e.g. imported history) -> rebuild from the first N days.
            built = build_baseline(prior[:BASELINE_DAYS], keys)
            row = await _upsert_baseline(session, patient_id, modality, built)
            frozen = built
        else:
            frozen = {
                "ready": row.ready,
                "n_days": row.n_days,
                "mean": dict(row.mean_json or {}),
                "std": dict(row.std_json or {}),
            }

        zs = z_scores(features, frozen, keys)
        all_z.update(zs)
        devs[name] = modality_deviation(zs)

    score = stability_score(devs, valid_flags)
    history = await _recent_history(session, patient_id, sample)
    history.append({"devs": devs, "score": score})
    decision = alert_decision(history)
    band = Band(decision["band"])

    explanation_en = explain(all_z, band.value, "en")
    explanation_hi = explain(all_z, band.value, "hi")
    drivers = top_drivers(all_z, 3)

    # Idempotent rewrite of this sample's verdict.
    existing = await session.scalar(select(Score).where(Score.sample_id == sample_id))
    if existing is not None:
        await session.execute(delete(Alert).where(Alert.score_id == existing.id))
        await session.execute(delete(Score).where(Score.id == existing.id))
        await session.flush()

    score_row = Score(
        patient_id=patient_id,
        sample_id=sample_id,
        voice_dev=devs["voice"],
        face_dev=devs["face"],
        reaction_dev=devs["reaction"],
        stability_score=score,
        band=band,
        reason=decision["reason"],
        modalities_flagged=list(decision["modalities_flagged"]),
        z_scores_json=all_z,
        explanation_en=explanation_en,
        explanation_hi=explanation_hi,
        baseline_day=baseline_day,
    )
    session.add(score_row)
    await session.flush()

    alert_row: Alert | None = None
    if band is Band.ALERT:
        alert_row = Alert(
            patient_id=patient_id,
            score_id=score_row.id,
            band=band,
            explanation=explanation_en,
            explanation_hi=explanation_hi,
            whatsapp_sent=False,
        )
        session.add(alert_row)
        await session.flush()
        if notify:
            alert_row.whatsapp_sent = send_alert(patient_id, band.value, explanation_en)

    sample.status = SampleStatus.done
    baseline_ready = await _refresh_baseline_ready(session, patient)

    if commit:
        await session.commit()
    else:
        await session.flush()

    logger.info(
        "checkin patient_id=%s sample_id=%s score=%.1f band=%s baseline_day=%s flagged=%s",
        patient_id, sample_id, score, band.value, baseline_day, decision["modalities_flagged"],
    )

    return CheckinResult(
        sample_id=sample_id,
        patient_id=patient_id,
        stability_score=score,
        band=band,
        reason=decision["reason"],
        baseline_day=baseline_day,
        baseline_ready=baseline_ready,
        deviations=devs,
        modalities_flagged=list(decision["modalities_flagged"]),
        valid_modalities=valid_flags,
        top_drivers=drivers,
        explanation_en=explanation_en,
        explanation_hi=explanation_hi,
        alert_id=alert_row.id if alert_row is not None else None,
    )
