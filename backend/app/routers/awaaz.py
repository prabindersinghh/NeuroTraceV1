"""/awaaz — the communication assistant. See `docs/PLAN_AWAAZ.md`.

Every recognised-speech path goes through `app.awaaz.safety.decide`. Exact patient
choices (cards, confirmed candidates, and emergency phrases) bypass the gate because the
patient selected those words directly; nothing is being inferred on their behalf.
"""
from __future__ import annotations

import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, get_patient_for_user, require_roles
from ..awaaz.safety import (
    AUTO_SPEAK_ELIGIBLE,
    MIN_AUTO_SPEAK_THRESHOLD,
    SpeechProfile,
    decide,
)
from ..db import get_session
from ..models import (
    AuditLog, AwaazPolicyEvent, AwaazProfile, MAX_POLICY_CANDIDATES, Patient,
    PhraseCard, PolicyEventOutcome, PolicyFeedbackActor, Role, User, UtteranceLog,
)
from ..services.emergency_notifications import deliver_emergency
from ..services.policy_retention import (
    DEFAULT_RETENTION_POLICY,
    sweep_expired_policy_events,
)
from ..schemas import (
    AwaazBoard,
    AwaazPolicyDecision,
    AwaazPolicyDecisionRequest,
    AwaazPolicyEventRead,
    AwaazPolicyOutcomeRequest,
    AwaazCardCreate,
    AwaazCardRead,
    AwaazEmergencyResult,
    AwaazEmergencyRequest,
    AwaazProfileRead,
    AwaazProfileUpdate,
    AwaazReviewLabelRequest,
    AwaazSpeakRequest,
    AwaazSpeakResult,
    MessageResponse,
)

router = APIRouter(prefix="/awaaz", tags=["awaaz"])

Session = Annotated[AsyncSession, Depends(get_session)]
AuthorisedPatient = Annotated[Patient, Depends(get_patient_for_user)]
Admin = Annotated[User, Depends(require_roles(Role.admin))]

MAX_BOARD_CARDS = 36
SUPPORTED_LANGUAGES = frozenset({"en", "hi", "pa"})

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


def _normalise_card_text(text: str) -> str:
    """Comparison form for duplicate prevention; never stored in place of patient text."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


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
    cards.sort(key=lambda c: (not c.is_emergency, -(c.use_count or 0), c.slot))
    return AwaazBoard(
        patient_id=patient.id,
        profile=AwaazProfileRead.model_validate(profile, from_attributes=True),
        cards=[AwaazCardRead.model_validate(c, from_attributes=True) for c in cards],
    )


@router.post("/{patient_id}/cards", response_model=AwaazCardRead,
             status_code=status.HTTP_201_CREATED)
async def add_card(payload: AwaazCardCreate, patient: AuthorisedPatient,
                   user: CurrentUser, db: Session) -> AwaazCardRead:
    cards = list(await db.scalars(
        select(PhraseCard).where(PhraseCard.patient_id == patient.id)))
    if len(cards) >= MAX_BOARD_CARDS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"The phrase board is limited to {MAX_BOARD_CARDS} cards so it stays usable.",
        )

    text = payload.text.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Phrase cannot be blank")
    lang = payload.lang or (patient.languages or ["en"])[0]
    if lang not in SUPPORTED_LANGUAGES:
        lang = "en"
    normalised = _normalise_card_text(text)
    if any(
        card.lang == lang and _normalise_card_text(card.text) == normalised
        for card in cards
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That phrase is already on this patient's board.",
        )
    next_slot = max((card.slot for card in cards), default=-1) + 1
    card = PhraseCard(
        patient_id=patient.id, text=text, lang=lang,
        icon=payload.icon, category=payload.category,
        slot=payload.slot if payload.slot is not None else next_slot,
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
    patient = await get_patient_for_user(card.patient_id, user, db)
    if card.is_emergency:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The emergency phrase cannot be removed. It is the one card that has to be "
            "there on the worst day.")
    await db.delete(card)
    db.add(AuditLog(
        actor_id=user.id, action="awaaz.card.delete", patient_id=patient.id,
    ))
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
                user: CurrentUser, db: Session) -> AwaazSpeakResult:
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

    capture_id = str(payload.audio_capture_id) if payload.audio_capture_id else None
    has_capture_metadata = bool(
        capture_id or payload.audio_duration_seconds is not None
        or payload.audio_sha256 is not None or payload.audio_size_bytes is not None
        or payload.audio_capture_consent
    )
    if has_capture_metadata and capture_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "An audio capture receipt requires audio_capture_id",
        )
    if capture_id is not None:
        # Until ASR exists, only a card tap supplies an acoustically-independent, exact
        # target. Registering free text beside audio would manufacture a training label.
        if card is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "On-device audio can only be paired with a phrase the person tapped",
            )
        if not payload.audio_capture_consent:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Explicit consent is required before retaining an audio pair",
            )
        if payload.audio_duration_seconds is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "audio_duration_seconds is required for an audio capture receipt",
            )
        if payload.audio_sha256 is None or payload.audio_size_bytes is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Audio integrity metadata is required for an audio capture receipt",
            )

        existing = await db.scalar(select(UtteranceLog).where(
            UtteranceLog.audio_capture_id == capture_id))
        if existing is not None:
            # Retrying after a lost response must not increment use_count or create a
            # second training pair. Reusing the id for different words is refused.
            if (
                existing.patient_id != patient.id
                or existing.card_id != card.id
                or existing.audio_sha256 != payload.audio_sha256
            ):
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "This audio capture is already paired with a different phrase",
                )
            return AwaazSpeakResult(
                patient_id=patient.id, text=existing.text, lang=existing.lang,
                mode=existing.mode, speak_now=True, candidates=[],
                reason="the person chose these exact words themselves",
                requires_confirmation=False, utterance_id=existing.id,
                audio_pair_registered=existing.audio_retained_on_device,
            )

    if card is not None:
        card.use_count = (card.use_count or 0) + 1
        utterance = UtteranceLog(
            patient_id=patient.id, text=card.text, lang=card.lang, card_id=card.id,
            mode="auto", confirmed=True, is_emergency=card.is_emergency,
            audio_capture_id=capture_id,
            audio_duration_seconds=payload.audio_duration_seconds,
            audio_sha256=payload.audio_sha256,
            audio_size_bytes=payload.audio_size_bytes,
            audio_consent_by=user.id if capture_id else None,
            audio_consent_at=datetime.now(timezone.utc) if capture_id else None,
            audio_retained_on_device=bool(capture_id),
        )
        db.add(utterance)
        if capture_id:
            db.add(AuditLog(
                actor_id=user.id, action="awaaz.audio_pair.register",
                patient_id=patient.id,
                meta_json={
                    "capture_id": capture_id,
                    "duration_seconds": payload.audio_duration_seconds,
                    "sha256": payload.audio_sha256,
                    "size_bytes": payload.audio_size_bytes,
                    "storage": "on_device",
                },
            ))
        await db.commit()
        await db.refresh(utterance)
        return AwaazSpeakResult(
            patient_id=patient.id, text=card.text, lang=card.lang,
            mode="auto", speak_now=True, candidates=[],
            reason="the person chose these exact words themselves",
            requires_confirmation=False,
            utterance_id=utterance.id,
            audio_pair_registered=bool(capture_id),
        )

    text = (payload.text or "").strip()
    if not text and not payload.candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Nothing to say: provide a card, text, or candidates")

    if payload.confirmed_candidate:
        if not text:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "A confirmed candidate must include the text the person chose",
            )
        utterance = UtteranceLog(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="confirm", confirmed=True, confidence=payload.confidence)
        db.add(utterance)
        await db.commit()
        await db.refresh(utterance)
        return AwaazSpeakResult(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="confirm", speak_now=True, candidates=[],
            reason="the person confirmed this candidate themselves",
            requires_confirmation=False,
            utterance_id=utterance.id,
        )

    decision = decide(
        profile.speech_profile, payload.confidence,
        enabled=profile.auto_speak_enabled,
        threshold=profile.auto_speak_threshold,
    )

    if decision.auto:
        utterance = UtteranceLog(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="auto", confirmed=False, confidence=payload.confidence)
        db.add(utterance)
        await db.commit()
        await db.refresh(utterance)
        return AwaazSpeakResult(
            patient_id=patient.id, text=text, lang=payload.lang,
            mode="auto", speak_now=True, candidates=[],
            reason=decision.reason, requires_confirmation=False,
            utterance_id=utterance.id,
        )

    # Confirmation path. Nothing is spoken here — the response carries options only.
    candidates = payload.candidates or ([text] if text else [])
    return AwaazSpeakResult(
        patient_id=patient.id, text=None, lang=payload.lang,
        mode="confirm", speak_now=False, candidates=candidates[:5],
        reason=decision.reason, requires_confirmation=True,
    )


@router.delete("/audio-pairs/{capture_id}", response_model=MessageResponse)
async def delete_audio_pair(
    capture_id: uuid.UUID, user: CurrentUser, db: Session,
) -> MessageResponse:
    """Record revocation after the browser deletes its local WAV.

    The raw audio never reaches this endpoint. Deletion is intentionally idempotent so a
    client can retry after losing a response without turning revocation into an error.
    """
    row = await db.scalar(select(UtteranceLog).where(
        UtteranceLog.audio_capture_id == str(capture_id)))
    if row is None:
        return MessageResponse(detail="No retained audio receipt exists for this capture.")

    await get_patient_for_user(row.patient_id, user, db)
    if row.audio_retained_on_device:
        row.audio_retained_on_device = False
        row.audio_deleted_at = datetime.now(timezone.utc)
        db.add(AuditLog(
            actor_id=user.id, action="awaaz.audio_pair.delete",
            patient_id=row.patient_id,
            meta_json={"capture_id": str(capture_id), "storage": "on_device"},
        ))
        await db.commit()
    return MessageResponse(detail="The on-device audio receipt is marked deleted.")


@router.post("/{patient_id}/emergency", response_model=AwaazEmergencyResult)
async def emergency(patient: AuthorisedPatient, db: Session,
                    user: CurrentUser,
                    payload: AwaazEmergencyRequest | None = None,
                    lat: float | None = None, lon: float | None = None,
                    ) -> AwaazEmergencyResult:
    """Record a deliberately selected, fixed emergency phrase.

    The frontend starts its patient-specific on-device WAV before awaiting this request.
    The receipt records what happened during this invocation; no audio enters this API.
    Caregiver delivery is still reported unavailable until a real provider accepts it.
    """
    lang = (patient.languages or ["en"])[0]
    phrase = {"hi": "मुझे मदद चाहिए", "pa": "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ"}.get(lang, "I need help")

    request = payload or AwaazEmergencyRequest()
    offline_audio_played = request.offline_audio_played
    if request.location_consent and request.lat is not None and request.lon is not None:
        resolved_lat, resolved_lon = request.lat, request.lon
        accuracy_m = request.location_accuracy_m
        location_source = "consented_body"
    else:
        # Backward compatibility for callers that used the original query contract. New
        # clients use the consent-bearing body above.
        resolved_lat, resolved_lon = lat, lon
        accuracy_m = None
        location_source = "legacy_query" if lat is not None and lon is not None else None
    location_payload = (
        {"lat": resolved_lat, "lon": resolved_lon}
        | ({"accuracy_m": accuracy_m} if accuracy_m is not None else {})
    ) if resolved_lat is not None and resolved_lon is not None else None

    caregiver = await db.get(User, patient.caregiver_id)
    delivery = await deliver_emergency(
        recipient=caregiver.email if caregiver is not None else "",
        patient_name=patient.name,
        lang=caregiver.lang if caregiver is not None else lang,
        event_id=request.event_id,
        location=location_payload,
    ) if caregiver is not None else None
    caregiver_notified = bool(delivery and delivery.accepted)
    db.add(UtteranceLog(
        patient_id=patient.id, text=phrase, lang=lang,
        mode="auto", confirmed=True, is_emergency=True))
    db.add(AuditLog(
        actor_id=user.id,
        action="awaaz.emergency",
        patient_id=patient.id,
        meta_json={
            "event_id": str(request.event_id),
            "offline_audio_played": offline_audio_played,
            "used_speech_recognition": False,
            "location_shared": resolved_lat is not None and resolved_lon is not None,
            "location_source": location_source,
            "caregiver_notified": caregiver_notified,
            "notification_provider": delivery.provider if delivery else "unavailable",
        },
    ))
    await db.commit()

    return AwaazEmergencyResult(
        patient_id=patient.id,
        spoken_text=phrase,
        lang=lang,
        location=location_payload,
        caregiver_notified=caregiver_notified,
        works_offline=offline_audio_played,
        used_speech_recognition=False,
        message=(
            ("The on-device help phrase started playing. " if offline_audio_played else
             "No on-device help phrase was played. ")
            + ("The caregiver alert was accepted for delivery. " if caregiver_notified else
               "Caregiver delivery was not accepted; call the family directly. ")
            + "Call emergency services directly if there may be immediate danger."
        ),
    )


# --------------------------------------------------------------------------- D2 · listener
# Listener sessions are CAPABILITIES, held in process memory on purpose: a link is a
# bounded window (TTL-capped in listener.py), and a server restart revoking every
# outstanding link errs exactly the right way for something that shows a live transcript.
# Nothing about a listener session belongs in the durable record except the audit line.
from ..awaaz.listener import (  # noqa: E402  (grouped with the endpoints they serve)
    ListenerSession,
    ListenerState,
    coaching_line,
    create_listener_session,
)

_LISTENER_SESSIONS: dict[str, ListenerSession] = {}


@router.get("/{patient_id}/listener")
async def active_listener_link(patient: AuthorisedPatient) -> dict:
    """Recover the one active capability after an owner refreshes the sharing screen."""
    active = [
        session for session in _LISTENER_SESSIONS.values()
        if session.patient_id == str(patient.id) and session.active
    ]
    if not active:
        return {"active": False}
    session = max(active, key=lambda item: item.created_at)
    return {**session.to_json(), "path": f"/listen/{session.token}"}


@router.post("/{patient_id}/listener")
async def mint_listener_link(
    payload: dict, patient: AuthorisedPatient, user: CurrentUser, db: Session,
) -> dict:
    """Caregiver mints a shareable listener link.

    `display_name` is whatever the caregiver wants a stranger to see — often a first name,
    sometimes just "my father". The enrolled patient name never goes on a page that can be
    forwarded.
    """
    display_name = str(payload.get("display_name") or "").strip()
    if not display_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "display_name is required")
    superseded = 0
    for existing in _LISTENER_SESSIONS.values():
        if existing.patient_id == str(patient.id) and existing.active:
            existing.revoked = True
            superseded += 1
    session = create_listener_session(
        patient_id=str(patient.id),
        display_name=display_name[:60],
        lang=str(payload.get("lang") or "en")[:8],
        ttl_minutes=int(payload.get("ttl_minutes") or 60),
    )
    _LISTENER_SESSIONS[session.token] = session
    db.add(AuditLog(actor_id=user.id, action="awaaz.listener.mint", patient_id=patient.id,
                    meta_json={
                        "expires_at": session.expires_at.isoformat(),
                        "superseded_active_links": superseded,
                    }))
    await db.commit()
    return {**session.to_json(), "path": f"/listen/{session.token}"}


@router.delete("/listener/{token}", response_model=MessageResponse)
async def revoke_listener_link(token: str, user: CurrentUser, db: Session) -> MessageResponse:
    """Until this fix, revocation needed only a valid login — no check tying the caller to
    the token's patient at all, asymmetric with minting (`mint_listener_link`), which
    correctly requires `get_patient_for_user`. Any authenticated user who obtained or
    guessed a token could kill another patient's live listener session. Found in the
    Part 5.1 endpoint data audit. An unknown/already-gone token still returns 200 as a
    no-op, unchanged from before — only a REAL token now requires the caller to actually
    be allowed to see that patient, via the same rule every other patient-scoped route uses.
    """
    session = _LISTENER_SESSIONS.get(token)
    if session is None:
        # Idempotent and non-enumerable: an unknown or already-cleared token reveals no
        # session information to an authenticated caller.
        return MessageResponse(detail="Listener link revoked")

    await get_patient_for_user(uuid.UUID(session.patient_id), user, db)
    if not session.revoked:
        session.revoked = True
        db.add(AuditLog(actor_id=user.id, action="awaaz.listener.revoke",
                        patient_id=uuid.UUID(session.patient_id)))
        await db.commit()
    return MessageResponse(detail="Listener link revoked")


@router.get("/listen/{token}")
async def listener_view(token: str, db: Session) -> dict:
    """The listener's page. NO auth — the unguessable token IS the capability.

    Returns the display name, one coaching line (the single most useful thing to say right
    now, computed from the live utterance pattern), and the recent confirmed utterances.
    Expired or revoked tokens 404 indistinguishably from never-existed ones.
    """
    session = _LISTENER_SESSIONS.get(token)
    if session is None or not session.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link is no longer active")

    pid = uuid.UUID(session.patient_id)
    rows = list(await db.scalars(
        select(UtteranceLog)
        .where(
            UtteranceLog.patient_id == pid,
            UtteranceLog.confirmed.is_(True),
            # A conversation link is a live capability, not permission to read what the
            # person said before it was created.
            UtteranceLog.ts >= session.created_at,
        )
        .order_by(UtteranceLog.ts.desc())
        .limit(5)
    ))
    now = datetime.now(timezone.utc)
    last_ts = rows[0].ts if rows else None
    if last_ts is not None and last_ts.tzinfo is None:
        last_ts = last_ts.replace(tzinfo=timezone.utc)
    state = ListenerState(
        display_name=session.display_name,
        lang=session.lang,
        recent_confidences=[float(r.confidence) for r in rows if r.confidence is not None],
        seconds_since_last_utterance=(now - last_ts).total_seconds() if last_ts else 0.0,
        utterances=len(rows),
    )
    code, line = coaching_line(state)
    return {
        "display_name": session.display_name,
        "lang": session.lang,
        "expires_at": session.expires_at.isoformat(),
        "coaching": {"code": code, "line": line},
        "recent": [
            {"text": r.text, "lang": r.lang, "ts": r.ts.isoformat()} for r in rows
        ],
    }


# ------------------------------------------------------------------- D4 · review queue
from ..awaaz.convergence import build_review_queue  # noqa: E402


@router.get("/{patient_id}/review")
async def review_queue(patient: AuthorisedPatient, db: Session) -> dict:
    """The caregiver's evening list — worst-first, capped, last 24 hours.

    Worst-first because those labels buy the most; capped because a caregiver who does
    only three items should have done the three that mattered, and a list that scrolls
    forever teaches them to do none.
    """
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    rows = list(await db.scalars(
        select(UtteranceLog)
        .where(UtteranceLog.patient_id == patient.id,
               UtteranceLog.ts >= since,
               UtteranceLog.reviewed_at.is_(None),
               UtteranceLog.is_emergency.is_(False))
    ))
    queue = build_review_queue([
        {"id": str(r.id), "text": r.text, "lang": r.lang,
         "confidence": r.confidence, "card_id": str(r.card_id) if r.card_id else None,
         "ts": r.ts.isoformat()}
        for r in rows
    ])
    return {"patient_id": str(patient.id), "items": queue, "total_candidates": len(rows)}


@router.post("/review/{utterance_id}", response_model=MessageResponse)
async def label_utterance(
    utterance_id: uuid.UUID, payload: AwaazReviewLabelRequest,
    user: CurrentUser, db: Session,
) -> MessageResponse:
    """Save a verified label and, optionally, a consented local-audio receipt.

    The optional WAV is a fresh patient repeat recorded during review. It remains in that
    browser's IndexedDB vault; only integrity, consent, and deletion metadata crosses this
    boundary. Retrying the exact receipt after a lost response is idempotent.
    """
    row = await db.get(UtteranceLog, utterance_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Utterance not found")
    # Access control rides the patient, same as every other awaaz surface.
    from ..auth.deps import get_patient_for_user

    await get_patient_for_user(row.patient_id, user, db)
    corrected = payload.corrected_text.strip()
    if not corrected:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "corrected_text is required")

    capture_id = str(payload.audio_capture_id) if payload.audio_capture_id else None
    if row.is_emergency:
        raise HTTPException(status.HTTP_409_CONFLICT, "Emergency events cannot become review pairs")
    if row.reviewed_at is not None:
        if row.corrected_text == corrected and row.audio_capture_id == capture_id:
            return MessageResponse(detail="This review was already saved.")
        raise HTTPException(status.HTTP_409_CONFLICT, "This utterance was already reviewed")
    if capture_id:
        existing = await db.scalar(select(UtteranceLog).where(
            UtteranceLog.audio_capture_id == capture_id,
        ))
        if existing is not None and existing.id != row.id:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This local audio capture is already paired with another utterance",
            )

    row.corrected_text = corrected[:500]
    row.reviewed_at = datetime.now(timezone.utc)
    if capture_id:
        row.audio_capture_id = capture_id
        row.audio_duration_seconds = payload.audio_duration_seconds
        row.audio_sha256 = payload.audio_sha256
        row.audio_size_bytes = payload.audio_size_bytes
        row.audio_consent_by = user.id
        row.audio_consent_at = datetime.now(timezone.utc)
        row.audio_retained_on_device = True
        db.add(AuditLog(
            actor_id=user.id,
            action="awaaz.audio_pair.register",
            patient_id=row.patient_id,
            meta_json={
                "capture_id": capture_id,
                "duration_seconds": payload.audio_duration_seconds,
                "sha256": payload.audio_sha256,
                "size_bytes": payload.audio_size_bytes,
                "source": "caregiver_review",
                "storage": "on_device",
            },
        ))
    db.add(AuditLog(
        actor_id=user.id,
        action="awaaz.review.label",
        patient_id=row.patient_id,
        meta_json={"audio_pair_registered": bool(capture_id)},
    ))
    await db.commit()
    return MessageResponse(detail=(
        "Correction and local audio receipt saved for future personalisation."
        if capture_id else
        "Correction saved for review and future personalisation."
    ))


# ------------------------------------------------- D5 · privacy-safe policy event logging
# AWA-FR-014. `app/ml/rl/` has been able to compare candidate-ranking policies offline for
# a while, and not one production event was eligible for it: Awaaz recorded no slate, no
# policy version, no propensity, and no confirmation outcome, so every importance weight had
# an unknown denominator. `docs/PLAN_RL.md` and `docs/PRD_AWAAZ.md` §11 both say so. This
# section is the missing half -- a behaviour policy that genuinely randomises among near-tied
# candidates, and an append-only row that records the probability of the action it logged.
#
# It is NOT online learning. Nothing here reads the logged rows, no model is fitted, and no
# ranking adapts from feedback at runtime. The distribution below is a fixed function of the
# scores the client's ranker already produced. Data is being collected so that a human can
# later run `compare_policies` offline; that is the entire scope.
from collections.abc import Sequence  # noqa: E402  (grouped with the endpoints they serve)
from dataclasses import dataclass  # noqa: E402
import math  # noqa: E402
import random as _random  # noqa: E402

#: Bump on ANY change to the distribution below, including a constant. An estimate is a
#: statement about a named logger; two distributions sharing one slug makes the log a
#: mixture nobody can decompose after the fact.
BEHAVIOUR_POLICY_ID = "awaaz-neartie-explore-v1"

# ------------------------------------------------------------------ the exploration bound
#
# WHY WE RANDOMISE AT ALL. IPS and SNIPS are unidentifiable under a deterministic logger:
# with pi_0(a|x)=1 no alternative was ever observable, positivity fails, and the importance
# weight collapses to the evaluated policy's own probability. `offline.compare_policies`
# refuses such a log outright (`logging_policy_is_deterministic`), which is correct and also
# means a non-randomising product can never be evaluated. So the randomisation has to be
# real, and the probability of the action we actually showed has to be written down.
#
# WHY IT IS SAFE AT THIS SIZE. Three bounds, each doing separate work:
#
#   1. NEAR-TIE ONLY. A candidate can be logged only if its score is within
#      `NEAR_TIE_MARGIN` of the best score. A clearly-better candidate is therefore never
#      displaced by a clearly-worse one -- not "rarely", never, because a worse candidate is
#      assigned probability 0 and cannot be drawn. Exploration lives entirely inside the
#      region where the ranker itself is not claiming a difference.
#   2. TOP STAYS MODAL BY A LARGE MARGIN. Each alternative gets a flat `EXPLORATION_EPSILON`
#      and the top keeps the rest, so with the maximum explored set the top still holds
#      1 - 0.08*2 = 0.84 and any single alternative holds 0.08. Flat-per-alternative rather
#      than epsilon-split-k on purpose: a split shrinks as the slate grows and would push
#      propensities under `offline.MIN_LOGGED_PROBABILITY_FLOOR`, where one event becomes a
#      100x weight and the estimate is one patient's afternoon.
#   3. CONFIRMATION ONLY. The decision endpoint refuses to randomise unless the caller
#      declares that this slate goes to the confirmation loop. Reordering options a patient
#      is about to read and choose between is a presentation change they can override with a
#      tap. Reordering something that will be SPOKEN without confirmation would be
#      exploration on a disabled person's mouth, which INV-9 forbids and which no evaluation
#      is worth. Nothing in this section touches the gate, `decide()`, or `/speak`.
#
# The emergency flow is never ranked and never reaches this code at all.
#
#: Score units are the ranker's calibrated confidence in [0, 1]; 0.05 is roughly the width
#: at which the phrase-board study could not tell two candidates apart either.
NEAR_TIE_MARGIN = 0.05
#: Ceiling on the margin. Beyond this "near-tied" stops meaning near-tied.
MAX_NEAR_TIE_MARGIN = 0.10
#: Flat probability for each non-top member of the explored set.
EXPLORATION_EPSILON = 0.08
#: Below this the log is effectively deterministic and buys nothing; above it the patient
#: pays too much for our statistics.
MIN_EXPLORATION_EPSILON = 0.02
MAX_EXPLORATION_EPSILON = 0.15
#: Top candidate plus at most two alternatives.
MAX_EXPLORED_CANDIDATES = 3
#: However the bound is configured, the top-ranked candidate keeps at least this much mass.
MIN_TOP_ACTION_PROBABILITY = 0.75

#: A sampled decision waits here between the two requests. Process memory on purpose, the
#: same reasoning as the listener capabilities above: the propensity must come from the
#: server that drew it, never from the client, and the row is append-only so the outcome has
#: to be known before the single INSERT. A restart drops pending decisions and those events
#: are never logged -- losing an observation is the right failure, inventing one is not.
_PENDING_POLICY_DECISIONS: dict[uuid.UUID, "_PendingDecision"] = {}
PENDING_DECISION_TTL_MINUTES = 30
MAX_PENDING_DECISIONS = 1_024


@dataclass(frozen=True, slots=True)
class ExplorationBound:
    """The randomisation bound, validated so it cannot be configured into uselessness."""

    epsilon: float = EXPLORATION_EPSILON
    near_tie_margin: float = NEAR_TIE_MARGIN
    max_explored: int = MAX_EXPLORED_CANDIDATES

    def __post_init__(self) -> None:
        for name in ("epsilon", "near_tie_margin"):
            value = getattr(self, name)
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError(f"{name} must be finite")
        if not MIN_EXPLORATION_EPSILON <= float(self.epsilon) <= MAX_EXPLORATION_EPSILON:
            raise ValueError(
                "epsilon must be in "
                f"[{MIN_EXPLORATION_EPSILON}, {MAX_EXPLORATION_EPSILON}]: an exploration "
                "probability of zero makes every logged propensity 1.0, and "
                "offline.compare_policies refuses that log with "
                "logging_policy_is_deterministic rather than producing an estimate from it"
            )
        if not 0.0 < float(self.near_tie_margin) <= MAX_NEAR_TIE_MARGIN:
            raise ValueError(
                f"near_tie_margin must be in (0, {MAX_NEAR_TIE_MARGIN}]; a wider margin "
                "would let a clearly-worse candidate be shown ahead of a better one"
            )
        if type(self.max_explored) is not int or not (
            2 <= self.max_explored <= MAX_POLICY_CANDIDATES
        ):
            raise ValueError(
                f"max_explored must be an integer in [2, {MAX_POLICY_CANDIDATES}]")
        top = 1.0 - float(self.epsilon) * (self.max_explored - 1)
        if top < MIN_TOP_ACTION_PROBABILITY:
            raise ValueError(
                "this bound leaves the top-ranked candidate only "
                f"{top:.2f} probability; it may not fall below "
                f"{MIN_TOP_ACTION_PROBABILITY} on a patient-facing surface"
            )


DEFAULT_EXPLORATION_BOUND = ExplorationBound()


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    """What the behaviour policy did for one slate."""

    #: Display order. Index 0 is `logged_action_id` -- the slate is presented with the
    #: sampled candidate first, so "logged" and "what the patient saw first" are the same
    #: fact and cannot drift apart.
    offered_candidate_ids: tuple[uuid.UUID, ...]
    logged_action_id: uuid.UUID
    #: pi_0(logged_action_id | context). The probability of the action we LOGGED.
    logged_action_probability: float
    top_ranked_action_id: uuid.UUID
    randomised: bool


def rank_and_sample(
    candidates: Sequence[tuple[uuid.UUID, float]],
    *,
    rng: _random.Random | None = None,
    bound: ExplorationBound | None = None,
) -> PolicyDecision:
    """Rank by score, then sample which near-tied candidate to show first.

    Pure: no database, no patient, no clock. That is what makes the empirical frequencies
    testable against the recorded propensities, which is the only way anyone can check that
    the number in the denominator is the number the sampler actually used.
    """
    bound = bound or DEFAULT_EXPLORATION_BOUND
    draw_from = rng if rng is not None else _random
    # Descending score, then ascending UUID. The UUID tie-break matters: without it two
    # exactly-equal scores would rank by whatever order the request happened to arrive in,
    # and `top_ranked_action_id` would stop being a reproducible property of the scores.
    ordered = sorted(candidates, key=lambda item: (-item[1], item[0].int))
    top_id, top_score = ordered[0]
    explored = [
        item for item in ordered
        if top_score - item[1] <= bound.near_tie_margin
    ][:bound.max_explored]

    if len(explored) < 2:
        # A clear winner. There is nothing to randomise among, so the honest propensity is
        # 1.0 and the row is flagged unrandomised. Refusing to log it would select the log
        # on the shape of the slate; `offline.py` already fails closed when too many of
        # these accumulate, which is the right place for that judgement.
        return PolicyDecision(
            offered_candidate_ids=tuple(item[0] for item in ordered),
            logged_action_id=top_id,
            logged_action_probability=1.0,
            top_ranked_action_id=top_id,
            randomised=False,
        )

    probabilities = {item[0]: bound.epsilon for item in explored[1:]}
    probabilities[top_id] = 1.0 - bound.epsilon * (len(explored) - 1)

    draw = draw_from.random()
    cumulative = 0.0
    logged_id = top_id
    for action_id, _ in explored:
        cumulative += probabilities[action_id]
        if draw < cumulative:
            logged_id = action_id
            break

    rest = [item[0] for item in ordered if item[0] != logged_id]
    return PolicyDecision(
        offered_candidate_ids=(logged_id, *rest),
        logged_action_id=logged_id,
        logged_action_probability=probabilities[logged_id],
        top_ranked_action_id=top_id,
        randomised=True,
    )


@dataclass(frozen=True, slots=True)
class _PendingDecision:
    """A drawn-but-unlogged decision. Never persisted, never returned to a caller."""

    #: Held so the outcome POST can be checked against the patient the decision was drawn
    #: for. It stays in memory: writing it to the row is exactly the patient link this table
    #: exists without.
    patient_id: uuid.UUID
    speech_profile: str
    decision: PolicyDecision
    expires_at: datetime


def _prune_pending_decisions(now: datetime) -> None:
    """Bounded in both time and count so a client that never reports cannot grow this."""
    for event_id, pending in list(_PENDING_POLICY_DECISIONS.items()):
        if pending.expires_at <= now:
            del _PENDING_POLICY_DECISIONS[event_id]
    while len(_PENDING_POLICY_DECISIONS) > MAX_PENDING_DECISIONS:
        oldest = min(_PENDING_POLICY_DECISIONS.items(),
                     key=lambda item: item[1].expires_at)[0]
        del _PENDING_POLICY_DECISIONS[oldest]


def _decision_response(
    event_id: uuid.UUID, decision: PolicyDecision,
) -> AwaazPolicyDecision:
    return AwaazPolicyDecision(
        event_id=event_id,
        behavior_policy_id=BEHAVIOUR_POLICY_ID,
        offered_candidate_ids=list(decision.offered_candidate_ids),
        logged_action_id=decision.logged_action_id,
        logged_action_probability=decision.logged_action_probability,
        top_ranked_action_id=decision.top_ranked_action_id,
        randomised=decision.randomised,
        exploration_epsilon=DEFAULT_EXPLORATION_BOUND.epsilon,
        near_tie_margin=DEFAULT_EXPLORATION_BOUND.near_tie_margin,
    )


@router.post("/{patient_id}/policy/decision", response_model=AwaazPolicyDecision)
async def policy_decision(
    payload: AwaazPolicyDecisionRequest, patient: AuthorisedPatient,
    user: CurrentUser, db: Session,
) -> AwaazPolicyDecision:
    """Draw which near-tied candidate to show first, and remember its probability.

    Returns an ordering only. Nothing is spoken, no gate is consulted or changed, and no
    candidate text ever reaches this endpoint -- the slate is opaque UUIDs and scores.
    """
    if not payload.policy_logging_consent:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Explicit consent is required before a policy event is recorded",
        )
    if not payload.requires_confirmation:
        # See bound 3 above. A slate that may be spoken without the patient choosing from it
        # is not a surface we will reorder for the sake of an offline estimate.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Candidate ranking is only randomised on the confirmation path, where the "
            "person still chooses. Nothing is reordered on a path that speaks without "
            "confirmation.",
        )

    requested = {item.candidate_id for item in payload.candidates}
    now = datetime.now(timezone.utc)
    _prune_pending_decisions(now)

    # Idempotent retry, in both directions. A repeated decision request must return the
    # SAME draw: resampling would mean the propensity we eventually write was not the
    # probability of the action the patient was actually shown.
    pending = _PENDING_POLICY_DECISIONS.get(payload.event_id)
    if pending is not None:
        if (
            pending.patient_id != patient.id
            or set(pending.decision.offered_candidate_ids) != requested
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This event id was already used for a different slate",
            )
        return _decision_response(payload.event_id, pending.decision)

    committed = await db.get(AwaazPolicyEvent, payload.event_id)
    if committed is not None:
        if {uuid.UUID(value) for value in committed.candidate_action_ids} != requested:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This event id was already used for a different slate",
            )
        return _decision_response(payload.event_id, PolicyDecision(
            offered_candidate_ids=tuple(
                uuid.UUID(value) for value in committed.candidate_action_ids),
            logged_action_id=committed.logged_action_id,
            logged_action_probability=committed.logged_action_probability,
            top_ranked_action_id=committed.top_ranked_action_id,
            randomised=committed.randomised,
        ))

    profile = await _profile(db, patient)
    decision = rank_and_sample(
        [(item.candidate_id, item.score) for item in payload.candidates])
    _PENDING_POLICY_DECISIONS[payload.event_id] = _PendingDecision(
        patient_id=patient.id,
        speech_profile=profile.speech_profile,
        decision=decision,
        expires_at=now + timedelta(minutes=PENDING_DECISION_TTL_MINUTES),
    )
    # The audit row carries the actor, the patient and the consent fact -- that is what an
    # audit trail is for. It deliberately does NOT carry the event id or any candidate id:
    # audit_log has patient_id and a microsecond ts, so an event id here would be an exact
    # join key back onto a table built to have no patient link.
    db.add(AuditLog(
        actor_id=user.id, action="awaaz.policy_event.decide", patient_id=patient.id,
        meta_json={
            "behavior_policy_id": BEHAVIOUR_POLICY_ID,
            "slate_size": len(payload.candidates),
            "randomised": decision.randomised,
            "exploration_epsilon": DEFAULT_EXPLORATION_BOUND.epsilon,
            "near_tie_margin": DEFAULT_EXPLORATION_BOUND.near_tie_margin,
            "consent": "policy_event_logging",
        },
    ))
    await db.commit()
    return _decision_response(payload.event_id, decision)


@router.post("/{patient_id}/policy/outcome", response_model=AwaazPolicyEventRead)
async def policy_outcome(
    payload: AwaazPolicyOutcomeRequest, patient: AuthorisedPatient,
    user: CurrentUser, db: Session,
) -> AwaazPolicyEventRead:
    """Close one decision with what the patient did. One INSERT, then immutable (INV-8)."""
    now = datetime.now(timezone.utc)
    _prune_pending_decisions(now)

    existing = await db.get(AwaazPolicyEvent, payload.event_id)
    if existing is not None:
        # Retry after a lost response. Append-only means a differing report cannot be
        # accepted as a correction -- it would silently rewrite an observation an estimate
        # may already have been computed from.
        if (
            existing.outcome != payload.outcome.value
            or existing.feedback_actor != payload.actor.value
            or existing.selected_action_id != payload.selected_action_id
            or [uuid.UUID(v) for v in existing.rejected_action_ids]
            != payload.rejected_action_ids
            or existing.confirmation_observed != payload.confirmation_observed
            or existing.output_spoken != payload.output_spoken
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "This policy event was already logged with a different outcome",
            )
        return AwaazPolicyEventRead.model_validate(existing, from_attributes=True)

    pending = _PENDING_POLICY_DECISIONS.get(payload.event_id)
    if pending is None or pending.patient_id != patient.id:
        # Indistinguishable for "expired", "never existed", and "belongs to someone else":
        # a caller must not be able to probe which event ids are live.
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No pending ranking decision matches this event. Without the propensity the "
            "policy drew, a row here would carry an unknown denominator and is worse than "
            "no row at all.",
        )

    decision = pending.decision
    slate = set(decision.offered_candidate_ids)
    referenced = set(payload.rejected_action_ids)
    if payload.selected_action_id is not None:
        referenced.add(payload.selected_action_id)
    if not referenced.issubset(slate):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Feedback may only reference candidates that were offered for this event",
        )
    # INV-9 as an observation, not a new rule. These are the same consistency conditions
    # `rl.safety.gate_logged_feedback` applies at read time; enforcing them at write time
    # too is deliberate, because an append-only row that contradicts the confirmation gate
    # can never be corrected and would sit in the log looking like evidence.
    if payload.confirmation_observed and payload.selected_action_id is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A confirmation without a selected candidate is not a confirmation",
        )
    if payload.output_spoken and not (
        payload.confirmation_observed and payload.selected_action_id is not None
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Nothing on the confirmation path is spoken before the person confirms it",
        )

    row = AwaazPolicyEvent(
        id=payload.event_id,
        behavior_policy_id=BEHAVIOUR_POLICY_ID,
        candidate_action_ids=[str(value) for value in decision.offered_candidate_ids],
        logged_action_id=decision.logged_action_id,
        logged_action_probability=decision.logged_action_probability,
        top_ranked_action_id=decision.top_ranked_action_id,
        randomised=decision.randomised,
        speech_profile=pending.speech_profile,
        # True by construction: the decision endpoint refuses any other path.
        confirmation_required=True,
        confirmation_observed=payload.confirmation_observed,
        output_spoken=payload.output_spoken,
        emergency=False,
        feedback_actor=payload.actor.value,
        outcome=payload.outcome.value,
        selected_action_id=payload.selected_action_id,
        rejected_action_ids=[str(value) for value in payload.rejected_action_ids],
        logged_on=now.date(),
    )
    db.add(row)
    db.add(AuditLog(
        actor_id=user.id, action="awaaz.policy_event.log", patient_id=patient.id,
        meta_json={
            "behavior_policy_id": BEHAVIOUR_POLICY_ID,
            "outcome": payload.outcome.value,
            "actor": payload.actor.value,
            "randomised": decision.randomised,
        },
    ))
    await db.commit()
    _PENDING_POLICY_DECISIONS.pop(payload.event_id, None)
    return AwaazPolicyEventRead.model_validate(row, from_attributes=True)


# ------------------------------------------------------- D5 · retention for the same table
# D-062 indexed `logged_on` for a sweep and no sweep existed, so the rows accrued forever.
# The window, the append-only reasoning, and the erasure limitation all live in
# `services/policy_retention.py`; this is only the door.
#
# WHY AN ENDPOINT AT ALL. This deployment has no scheduler. Railway runs one web process,
# operations are performed against the running instance (`scripts/verify_deploy.sh`,
# `/admin/*`), and a retention promise whose only implementation needs a shell on the
# production host is a promise that gets skipped. The module also exposes a `python -m`
# runner for the one situation the API cannot serve -- a database restored into an isolated
# environment during the ML_RECOVERY drill -- so both paths exist because both are needed,
# not to be thorough.
#
# WHY IT IS ADMIN-ONLY AND CARRIES NO PATIENT IN ITS PATH. Every other route in this file is
# scoped by `get_patient_for_user` (INV-6). This one cannot be: the table has no patient
# column, so there is no patient whose authorisation would mean anything here, and mounting
# it under `/{patient_id}` would advertise a per-patient deletion this table cannot perform.
# It is an operator action on aggregate data, which is exactly what `/admin` is for, so it
# takes the same `require_roles(Role.admin)` guard.
@router.post("/policy/retention/sweep")
async def policy_retention_sweep(admin: Admin, db: Session) -> dict:
    """Delete policy events past the retention window. Bounded, repeatable, aggregate-only.

    Idempotent in the sense that matters for a deletion: the effect is a function of the
    day, not of how many times it is called. Once nothing is beyond the window a repeat call
    deletes nothing and returns `deleted: 0`, and `complete: false` is the caller's
    instruction to call again rather than an error.
    """
    report = await sweep_expired_policy_events(db, policy=DEFAULT_RETENTION_POLICY)
    # An audit row for a deletion, with no patient (there is none to name) and no event id
    # -- for the same reason the two writers omit it, and because a list of what was deleted
    # would preserve outside the table what deleting it was meant to end. Note this row is
    # inside the same database as the rows it describes, so it is NOT a tombstone in
    # ML_RECOVERY's sense; that document explains why this table does not need one.
    db.add(AuditLog(
        actor_id=admin.id, action="awaaz.policy_event.retention_sweep",
        meta_json=report.as_audit_meta(),
    ))
    await db.commit()
    return report.as_audit_meta()


def logged_feedback_from(row: AwaazPolicyEvent):
    """Turn one stored row into an `app.ml.rl.contracts.LoggedFeedback`.

    Lives beside the writer rather than in `app/ml/rl/` so the row shape and the wire shape
    cannot drift apart unnoticed: if a column is added or renamed, this function is in the
    same file and the round-trip test fails immediately. The import is deferred because the
    RL package is an analysis dependency, and the request path should not pay for it at boot.

    Raises ValueError for a row the contract cannot represent -- an event with no explicit
    signal. Inactivity is not a preference and must not become one by being cast into a
    feedback record with all-false fields.
    """
    from ..ml.rl.contracts import (
        CollectionMode, ExplicitFeedback, FeedbackActor, LoggedFeedback,
    )

    outcome = PolicyEventOutcome(row.outcome)
    if outcome is PolicyEventOutcome.no_explicit_signal:
        raise ValueError(
            "an event with no explicit patient signal is not eligible feedback")
    feedback = ExplicitFeedback(
        actor=FeedbackActor(row.feedback_actor),
        selected_action_id=row.selected_action_id,
        rejected_action_ids=tuple(
            uuid.UUID(value) for value in row.rejected_action_ids),
        correction_made=outcome is PolicyEventOutcome.corrected,
        phrase_board_fallback=outcome is PolicyEventOutcome.phrase_board_fallback,
    )
    return LoggedFeedback(
        event_id=row.id,
        behavior_policy_id=row.behavior_policy_id,
        candidate_action_ids=tuple(
            uuid.UUID(value) for value in row.candidate_action_ids),
        logged_action_id=row.logged_action_id,
        logged_action_probability=row.logged_action_probability,
        top_ranked_action_id=row.top_ranked_action_id,
        speech_profile=SpeechProfile(row.speech_profile),
        confirmation_required=row.confirmation_required,
        confirmation_observed=row.confirmation_observed,
        output_spoken=row.output_spoken,
        emergency=row.emergency,
        feedback=feedback,
        # Never `offline_replay`: these rows are observations of the live product, and
        # mislabelling them would let a replay be scored as though it were passive.
        collection_mode=CollectionMode.passive_observation,
    )


def eligible_logged_feedback(rows) -> list:
    """Map a batch, skipping only the rows the contract genuinely cannot represent.

    The skip rate is a number a reviewer has to look at: a log whose eligible subset was
    chosen by the outcome is a sample selected on the dependent variable.
    """
    out = []
    for row in rows:
        try:
            out.append(logged_feedback_from(row))
        except ValueError:
            continue
    return out
