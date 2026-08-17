"""/checkin — the 45-second daily capture. TRD §6.

Each modality posts independently and is feature-extracted immediately, so a slow webcam
upload never blocks the microphone step. `finalize` runs compute_checkin over whatever
arrived and returns the band + explanation.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import get_patient_for_user
from ..config import settings
from ..db import get_session
from ..models import DailySample, FeatureVector, Modality, Patient, SampleStatus
from ..schemas import CheckinResult, DailySampleRead, FeatureExtractionResult, ReactionPayload
from ..services.checkin import compute_checkin
from ..services.media import stored_upload

router = APIRouter(prefix="/checkin", tags=["checkin"])
logger = logging.getLogger("neurotrace.checkin.api")

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]


async def _open_sample(session: AsyncSession, patient: Patient) -> DailySample:
    """The check-in currently in progress, or a new one.

    One open sample at a time: `finalize` marks it done, so the next capture starts a
    fresh one. Tier 1 assumes one check-in per day (PRD §5).
    """
    sample = await session.scalar(
        select(DailySample)
        .where(DailySample.patient_id == patient.id, DailySample.status == SampleStatus.processing)
        .order_by(DailySample.ts.desc())
        .limit(1)
    )
    if sample is None:
        sample = DailySample(patient_id=patient.id, status=SampleStatus.processing)
        session.add(sample)
        await session.flush()
    return sample


async def _store_features(
    session: AsyncSession, sample: DailySample, modality: Modality, features: dict
) -> FeatureExtractionResult:
    row = await session.scalar(
        select(FeatureVector).where(
            FeatureVector.sample_id == sample.id, FeatureVector.modality == modality
        )
    )
    if row is None:
        row = FeatureVector(sample_id=sample.id, modality=modality, features_json=features)
        session.add(row)
    else:
        row.features_json = features  # re-taking a step overwrites it
    await session.commit()

    valid = float(features.get("valid", 0.0)) == 1.0
    logger.info(
        "features sample_id=%s modality=%s valid=%s n=%d",
        sample.id, modality.value, valid, len(features),
    )
    return FeatureExtractionResult(
        sample_id=sample.id, modality=modality, valid=valid,
        n_features=len(features), features=features,
    )


@router.post("/{patient_id}/audio", response_model=FeatureExtractionResult)
async def upload_audio(
    patient: AuthorisedPatient, session: Session, file: UploadFile = File(...)
) -> FeatureExtractionResult:
    """Voice features: MFCC, jitter, shimmer, HNR, pauses, F0 (app/ml/speech.py)."""
    from ..ml.speech import extract_speech_features

    sample = await _open_sample(session, patient)
    async with stored_upload(file, "audio") as path:
        if not settings.delete_raw_media:
            sample.audio_path = str(path)
        try:
            features = await asyncio.to_thread(extract_speech_features, str(path))
        except Exception as exc:  # unreadable codec, truncated upload, ...
            logger.warning("speech extraction failed sample_id=%s: %s", sample.id, exc)
            features = {"valid": 0.0, "error": type(exc).__name__}
    return await _store_features(session, sample, Modality.voice, features)


@router.post("/{patient_id}/video", response_model=FeatureExtractionResult)
async def upload_video(
    patient: AuthorisedPatient, session: Session, file: UploadFile = File(...)
) -> FeatureExtractionResult:
    """Face features via MediaPipe FaceMesh (app/ml/face.py)."""
    from ..ml.face import extract_face_features

    sample = await _open_sample(session, patient)
    async with stored_upload(file, "video") as path:
        if not settings.delete_raw_media:
            sample.video_path = str(path)
        try:
            features = await asyncio.to_thread(extract_face_features, str(path))
        except Exception as exc:
            logger.warning("face extraction failed sample_id=%s: %s", sample.id, exc)
            features = {"valid": 0.0, "error": type(exc).__name__}
    return await _store_features(session, sample, Modality.face, features)


@router.post("/{patient_id}/reaction", response_model=FeatureExtractionResult)
async def upload_reaction(
    payload: ReactionPayload, patient: AuthorisedPatient, session: Session
) -> FeatureExtractionResult:
    """Reaction features from the browser tap game (app/ml/reaction.py)."""
    from ..ml.reaction import extract_reaction_features

    sample = await _open_sample(session, patient)
    raw = payload.model_dump()
    sample.reaction_json = raw
    features = extract_reaction_features(raw)
    return await _store_features(session, sample, Modality.reaction, features)


@router.post("/{patient_id}/finalize", response_model=CheckinResult)
async def finalize(patient: AuthorisedPatient, session: Session) -> CheckinResult:
    """Baseline or score the open sample, then close it."""
    sample = await session.scalar(
        select(DailySample)
        .where(DailySample.patient_id == patient.id, DailySample.status == SampleStatus.processing)
        .order_by(DailySample.ts.desc())
        .limit(1)
    )
    if sample is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No check-in in progress for this patient")

    captured = await session.scalars(
        select(FeatureVector.modality).where(FeatureVector.sample_id == sample.id)
    )
    if not list(captured):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nothing captured yet — post audio, video or reaction before finalizing",
        )
    return await compute_checkin(session, patient.id, sample.id)


@router.get("/{patient_id}/current", response_model=DailySampleRead | None)
async def current_checkin(patient: AuthorisedPatient, session: Session) -> DailySampleRead | None:
    """Lets the frontend resume a check-in that was interrupted mid-flow."""
    sample = await session.scalar(
        select(DailySample)
        .where(DailySample.patient_id == patient.id, DailySample.status == SampleStatus.processing)
        .order_by(DailySample.ts.desc())
        .limit(1)
    )
    return DailySampleRead.model_validate(sample) if sample else None
