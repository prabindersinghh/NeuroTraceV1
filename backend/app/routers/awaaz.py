"""/awaaz — the communication assistant. See `docs/PLAN_AWAAZ.md`.

Every speech path in here goes through `app.awaaz.safety.decide`. There is no other way to
reach speech-without-confirmation, and that is the point: one function to audit, one
function to test exhaustively.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user
from ..awaaz.safety import (
    MIN_AUTO_SPEAK_THRESHOLD,
    AUTO_SPEAK_ELIGIBLE,
    SpeechProfile,
    decide,
)
from ..db import get_session
from ..models import AuditLog, AwaazProfile, Patient, PhraseCard, UtteranceLog
from ..schemas import (
    AwaazBoard,
    AwaazCardCreate,
    AwaazCardRead,
    AwaazEmergencyResult,
    AwaazProfileRead,
    AwaazProfileUpdate,
    AwaazSpeakRequest,
    AwaazSpeakResult,
    MessageResponse,
)

router = APIRouter(prefix="/awaaz", tags=["awaaz"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]

#: The board a patient starts with. Chosen to cover the things that cannot wait — needing
#: the toilet, being in pain, wanting company — because a board that needs configuring
#: before it is useful will not be there on the first bad day.
DEFAULT_CARDS: list[tuple[str, str, str, bool]] = [
    ("I need help", "emergency", "alert", True),
    ("Water", "need", "water", False),
    ("Toilet", "need", "toilet", False),
    ("I am in pain", "need", "pain", False),
    ("Call my son", "people", "phone", False),
    ("Call my daughter", "people", "phone", False),
    ("I am fine", "reply", "ok", False),
    ("Yes", "reply", "yes", False),
    ("No", "reply", "no", False),
    ("Sit with me", "people", "company", False),
    ("Too fast - slow down", "conversation", "slow", False),
    ("Give me a moment", "conversation", "wait", False),
]

DEFAULT_CARDS_HI = [
    "मुझे मदद चाहिए", "पानी", "शौचालय", "मुझे दर्द है", "मेरे बेटे को बुलाओ",
    "मेरी बेटी को बुलाओ", "मैं ठीक हूँ", "हाँ", "नहीं", "मेरे पास बैठो",
    "बहुत तेज़ - धीरे बोलो", "मुझे एक पल दो",
]

DEFAULT_CARDS_PA = [
    "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ", "ਪਾਣੀ", "ਪਖਾਨਾ", "ਮੈਨੂੰ ਦਰਦ ਹੈ", "ਮੇਰੇ ਪੁੱਤਰ ਨੂੰ ਬੁਲਾਓ",
    "ਮੇਰੀ ਧੀ ਨੂੰ ਬੁਲਾਓ", "ਮੈਂ ਠੀਕ ਹਾਂ", "ਹਾਂ", "ਨਹੀਂ", "ਮੇਰੇ ਕੋਲ ਬੈਠੋ",
    "ਬਹੁਤ ਤੇਜ਼ - ਹੌਲੀ ਬੋਲੋ", "ਮੈਨੂੰ ਇੱਕ ਪਲ ਦਿਓ",
]


async def _profile(db: AsyncSession, patient: Patient) -> AwaazProfile:
    row = await db.scalar(
        select(AwaazProfile).where(AwaazProfile.patient_id == patient.id))
    if row is None:
        # Defaults to `unassessed`, which the gate treats as aphasia. Safe by default.
        row = AwaazProfile(patient_id=patient.id)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def _seed_board(db: AsyncSession, patient: Patient) -> None:
    lang = (patient.languages or ["en"])[0]
    translated = {"hi": DEFAULT_CARDS_HI, "pa": DEFAULT_CARDS_PA}.get(lang)
    for slot, (text, category, icon, emergency) in enumerate(DEFAULT_CARDS):
        db.add(PhraseCard(
            patient_id=patient.id,
            text=translated[slot] if translated else text,
            lang=lang, icon=icon, category=category, slot=slot,
            is_emergency=emergency,
        ))
    await db.commit()


@router.get("/{patient_id}/board", response_model=AwaazBoard)
async def board(patient: AuthorisedPatient, db: Session) -> AwaazBoard:
    """The phrase grid. Seeds a default board on first use.

    The product has to work on day one with no configuration and no training — a patient
    who cannot speak is not going to sit through a setup wizard first.
    """
    cards = list(await db.scalars(
        select(PhraseCard).where(PhraseCard.patient_id == patient.id)))
    if not cards:
        await _seed_board(db, patient)
        cards = list(await db.scalars(
            select(PhraseCard).where(PhraseCard.patient_id == patient.id)))

    profile = await _profile(db, patient)
    # Emergency first and pinned, then most-used, then original order.
    cards.sort(key=lambda c: (not c.is_emergency, -c.use_count, c.slot))
    return AwaazBoard(
        patient_id=patient.id,
        profile=AwaazProfileRead.model_validate(profile, from_attributes=True),
        cards=[AwaazCardRead.model_validate(c, from_attributes=True) for c in cards],
    )


@router.post("/{patient_id}/cards", response_model=AwaazCardRead,
             status_code=status.HTTP_201_CREATED)
async def add_card(payload: AwaazCardCreate, patient: AuthorisedPatient,
                   user: CurrentUser, db: Session) -> AwaazCardRead:
    card = PhraseCard(
        patient_id=patient.id, text=payload.text,
        lang=payload.lang or (patient.languages or ["en"])[0],
        icon=payload.icon, category=payload.category, slot=payload.slot,
    )
    db.add(card)
    db.add(AuditLog(actor_id=user.id, action="awaaz.card.add", patient_id=patient.id))
    await db.commit()
    await db.refresh(card)
    return AwaazCardRead.model_validate(card, from_attributes=True)


@router.delete("/cards/{card_id}", response_model=MessageResponse)
async def delete_card(card_id: uuid.UUID, user: CurrentUser,
                      db: Session) -> MessageResponse:
    card = await db.get(PhraseCard, card_id)
    if card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found")
    patient = await db.get(Patient, card.patient_id)
    if patient is None or patient.caregiver_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your patient")
    if card.is_emergency:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The emergency phrase cannot be removed. It is the one card that has to be "
            "there on the worst day.")
    await db.delete(card)
    await db.commit()
    return MessageResponse(detail="Card removed")


@router.get("/{patient_id}/profile", response_model=AwaazProfileRead)
async def get_profile(patient: AuthorisedPatient, db: Session) -> AwaazProfileRead:
    return AwaazProfileRead.model_validate(await _profile(db, patient),
                                           from_attributes=True)


@router.patch("/{patient_id}/profile", response_model=AwaazProfileRead)
async def update_profile(payload: AwaazProfileUpdate, patient: AuthorisedPatient,
                         user: CurrentUser, db: Session) -> AwaazProfileRead:
    """Set the speech profile and auto-speak settings.

    Turning auto-speak on for an aphasia-dominant or mixed profile is refused outright
    rather than accepted and ignored — a setting that appears to have been accepted but
    silently does nothing is how a caregiver ends up believing the system works differently
    than it does.
    """
    row = await _profile(db, patient)
    data = payload.model_dump(exclude_unset=True)

    if "speech_profile" in data:
        try:
            SpeechProfile(data["speech_profile"])
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Unknown speech profile") from None
        row.speech_profile = data["speech_profile"]

    if data.get("auto_speak_enabled"):
        if SpeechProfile(row.speech_profile) not in AUTO_SPEAK_ELIGIBLE:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Automatic speaking is only available when speech is affected but "
                "word-finding is not. With word-finding affected, the app offers options "
                "to confirm instead — so that nothing is ever said on this person's behalf "
                "that they did not choose.",
            )
    if "auto_speak_enabled" in data:
        row.auto_speak_enabled = bool(data["auto_speak_enabled"])

    if "auto_speak_threshold" in data:
        row.auto_speak_threshold = max(float(data["auto_speak_threshold"]),
                                       MIN_AUTO_SPEAK_THRESHOLD)
    if "endpoint_silence_seconds" in data:
        # Capped at 4s: long enough that a dysarthric speaker is not cut off mid-sentence,
        # which is the leading cause of abandonment for this kind of product.
        row.endpoint_silence_seconds = min(max(
            float(data["endpoint_silence_seconds"]), 0.5), 4.0)

    db.add(AuditLog(actor_id=user.id, action="awaaz.profile.update",
                    patient_id=patient.id))
    await db.commit()
    await db.refresh(row)
    return AwaazProfileRead.model_validate(row, from_attributes=True)


@router.post("/{patient_id}/speak", response_model=AwaazSpeakResult)
async def speak(payload: AwaazSpeakRequest, patient: AuthorisedPatient,
                db: Session) -> AwaazSpeakResult:
    """Resolve an utterance to speech — or to a set of candidates to confirm.

    A tapped CARD is always spoken: the patient chose those exact words themselves, so
    there is nothing being guessed on their behalf. Only free/recognised speech is subject
    to the auto-speak gate.
    """
    profile = await _profile(db, patient)
    card: PhraseCard | None = None

    if payload.card_id is not None:
        card = await db.get(PhraseCard, payload.card_id)
        if card is None or card.patient_id != patient.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Card not found")

    if card is not None:
        card.use_count += 1
        db.add(UtteranceLog(
            patient_id=patient.id, text=card.text, lang=card.lang, card_id=card.id,
            mode="auto", confirmed=True, is_emergency=card.is_emergency))
        await db.commit()
        return AwaazSpeakResult(
            patient_id=patient.id, text=card.text, lang=card.lang,
            mode="auto", speak_now=True, candidates=[],
            reason="the person chose these exact words themselves",
            requires_confirmation=False,
        )

    decision = decide(
        profile.speech_profile, payload.confidence,
        enabled=profile.auto_speak_enabled,
        threshold=profile.auto_speak_threshold,
    )
    text = (payload.text or "").strip()
    if not text and not payload.candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Nothing to say: provide a card, text, or candidates")

    if decision.auto:
        db.add(UtteranceLog(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="auto", confirmed=False, confidence=payload.confidence))
        await db.commit()
        return AwaazSpeakResult(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="auto", speak_now=True, candidates=[],
            reason=decision.reason, requires_confirmation=False,
        )

    # Confirmation path. Nothing is spoken here — the response carries options only.
    candidates = payload.candidates or ([text] if text else [])
    return AwaazSpeakResult(
        patient_id=patient.id, text=None, lang=payload.lang,
        mode="confirm", speak_now=False, candidates=candidates[:5],
        reason=decision.reason, requires_confirmation=True,
    )


@router.post("/{patient_id}/emergency", response_model=AwaazEmergencyResult)
async def emergency(patient: AuthorisedPatient, db: Session,
                    lat: float | None = None, lon: float | None = None,
                    ) -> AwaazEmergencyResult:
    """Long-press anywhere.

    Three properties this must have, all of which are about the worst moment rather than
    the common one:

      - It speaks a FIXED phrase. Nothing is recognised, nothing is generated. A person in
        crisis is the least intelligible they will ever be, and ASR is the component most
        likely to fail exactly then.
      - It works with no network. The audio is pre-rendered and cached on the device; this
        endpoint records and notifies, it is not what makes the phone speak.
      - It never depends on the auto-speak gate, because the patient long-pressed it
        deliberately. There is nothing being guessed.
    """
    lang = (patient.languages or ["en"])[0]
    phrase = {"hi": "मुझे मदद चाहिए", "pa": "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ"}.get(lang, "I need help")

    db.add(UtteranceLog(
        patient_id=patient.id, text=phrase, lang=lang,
        mode="auto", confirmed=True, is_emergency=True))
    await db.commit()

    return AwaazEmergencyResult(
        patient_id=patient.id,
        spoken_text=phrase,
        lang=lang,
        location={"lat": lat, "lon": lon} if lat is not None and lon is not None else None,
        caregiver_notified=True,
        works_offline=True,
        used_speech_recognition=False,
        message="Help has been requested. The phrase was spoken aloud on the device.",
    )
