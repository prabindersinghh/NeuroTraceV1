"""Awaaz D1 — phrase board, the auto-speak gate, and emergency mode.

The load-bearing test is `test_an_aphasia_profile_can_never_auto_speak`, which sweeps
confidence across its entire range and asserts the gate holds at every point.

Auto-completing an aphasic patient's sentence puts words in a disabled person's mouth that
neither they nor the listener can distinguish from their own — in their own cloned voice, to
their own family. The confirmation loop is a safety mechanism, not a UX preference.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.auth.password import hash_password
from app.awaaz.safety import (
    AUTO_SPEAK_ELIGIBLE,
    DEFAULT_AUTO_SPEAK_THRESHOLD,
    MIN_AUTO_SPEAK_THRESHOLD,
    SpeakMode,
    SpeechProfile,
    decide,
    may_auto_speak,
)
from app.models import AuditLog, Patient, PhraseCard, Role, StrokeSide, User, UtteranceLog

NOW = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
AUDIO_RECEIPT = {"audio_sha256": "ab" * 32, "audio_size_bytes": 88_044}


# ------------------------------------------------------------------ THE SAFETY GATE
@pytest.mark.parametrize("confidence", [i / 100 for i in range(0, 101)])
def test_an_aphasia_profile_can_never_auto_speak(confidence):
    """The one that matters. Every confidence from 0.00 to 1.00, all refused.

    There is no threshold, no setting and no confidence at which the system speaks for
    someone whose language is impaired. If this ever passes for a single value, the product
    is putting words in a disabled person's mouth.
    """
    assert may_auto_speak(SpeechProfile.aphasia_dominant, confidence) is False
    assert may_auto_speak(SpeechProfile.aphasia_dominant, confidence,
                          enabled=True, threshold=0.0) is False
    assert decide(SpeechProfile.aphasia_dominant, confidence).mode is SpeakMode.confirm


@pytest.mark.parametrize("confidence", [i / 100 for i in range(0, 101)])
def test_a_mixed_profile_can_never_auto_speak(confidence):
    """When both are present the language impairment governs. Erring toward confirmation
    costs a tap; erring the other way costs the patient their words."""
    assert may_auto_speak(SpeechProfile.mixed, confidence) is False
    assert may_auto_speak(SpeechProfile.mixed, confidence, threshold=0.0) is False


@pytest.mark.parametrize("confidence", [i / 100 for i in range(0, 101)])
def test_an_unassessed_profile_can_never_auto_speak(confidence):
    """Safe by default. Nobody has decided yet, so we do not guess."""
    assert may_auto_speak(SpeechProfile.unassessed, confidence) is False


def test_only_dysarthria_is_eligible_at_all():
    assert AUTO_SPEAK_ELIGIBLE == frozenset({SpeechProfile.dysarthria_dominant})


def test_dysarthria_auto_speaks_only_above_the_threshold():
    """Recovering a signal that exists is legitimate — but only when the signal is clear."""
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, 0.95) is True
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, 0.50) is False
    assert may_auto_speak(SpeechProfile.dysarthria_dominant,
                          DEFAULT_AUTO_SPEAK_THRESHOLD) is True


def test_the_threshold_has_a_floor_nobody_can_configure_away():
    """A caregiver tired of tapping cannot turn the safety off by lowering a number."""
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, 0.20, threshold=0.0) is False
    assert may_auto_speak(SpeechProfile.dysarthria_dominant,
                          MIN_AUTO_SPEAK_THRESHOLD, threshold=0.0) is True


def test_auto_speak_off_means_off_even_for_dysarthria():
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, 1.0, enabled=False) is False


def test_a_malformed_profile_or_confidence_confirms():
    """Anything unrecognised is a reason to confirm, never a reason to guess."""
    assert may_auto_speak("nonsense", 1.0) is False
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, "high") is False
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, 1.5) is False
    assert may_auto_speak(SpeechProfile.dysarthria_dominant, float("nan")) is False


def test_the_reason_explains_itself_to_a_caregiver():
    reason = decide(SpeechProfile.aphasia_dominant, 0.99).reason
    assert "confirmed" in reason
    assert "word-finding" in reason


# ------------------------------------------------------------------ fixtures
async def _patient(session, *, lang="en") -> tuple[User, Patient]:
    caregiver = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67,
        stroke_date=NOW - timedelta(days=200), stroke_side=StrokeSide.left,
        languages=[lang],
    )
    session.add(patient)
    await session.commit()
    return caregiver, patient


async def _headers(client, caregiver) -> dict:
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    return {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}


# ------------------------------------------------------------------ the board
async def test_the_board_works_on_day_one_with_no_setup(session, client):
    """A patient who cannot speak will not sit through a configuration wizard first."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)

    r = await client.get(f"/awaaz/{patient.id}/board", headers=headers)
    assert r.status_code == 200, r.text
    cards = r.json()["cards"]
    assert len(cards) >= 10
    texts = [c["text"].lower() for c in cards]
    assert any("water" in t for t in texts)
    assert any("toilet" in t for t in texts)
    assert any("pain" in t for t in texts)


async def test_the_board_seeds_in_the_patients_own_language(session, client):
    caregiver, patient = await _patient(session, lang="pa")
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    assert all(c["lang"] == "pa" for c in cards)
    assert any("ਪਾਣੀ" in c["text"] for c in cards)


async def test_the_emergency_card_is_pinned_first(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    assert cards[0]["is_emergency"] is True


async def test_the_emergency_card_cannot_be_deleted(session, client):
    """It is the one card that has to be there on the worst day."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    emergency = next(c for c in cards if c["is_emergency"])
    r = await client.delete(f"/awaaz/cards/{emergency['id']}", headers=headers)
    assert r.status_code == 409


async def test_a_new_profile_defaults_to_unassessed_and_auto_speak_off(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    profile = (await client.get(f"/awaaz/{patient.id}/profile", headers=headers)).json()
    assert profile["speech_profile"] == "unassessed"
    assert profile["auto_speak_enabled"] is False


# ------------------------------------------------------------------ speaking
async def test_a_tapped_card_is_always_spoken(session, client):
    """The patient chose those exact words. Nothing is being guessed on their behalf, so
    the gate does not apply — even for an aphasic patient."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile",
                       json={"speech_profile": "aphasia_dominant"}, headers=headers)

    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    water = next(c for c in cards if "water" in c["text"].lower())

    r = await client.post(f"/awaaz/{patient.id}/speak",
                          json={"card_id": water["id"]}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["speak_now"] is True
    assert r.json()["requires_confirmation"] is False


async def test_a_consented_card_capture_registers_a_real_on_device_audio_pair(
    session, client,
):
    """The target comes from the patient's tap; only a receipt crosses the API."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    water = next(c for c in cards if "water" in c["text"].lower())
    capture_id = uuid.uuid4()

    response = await client.post(f"/awaaz/{patient.id}/speak", json={
        "card_id": water["id"],
        "audio_capture_id": str(capture_id),
        "audio_duration_seconds": 2.75,
        "audio_capture_consent": True,
        **AUDIO_RECEIPT,
    }, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["audio_pair_registered"] is True
    assert response.json()["utterance_id"]

    row = await session.scalar(select(UtteranceLog).where(
        UtteranceLog.audio_capture_id == str(capture_id)))
    assert row is not None
    assert row.text == water["text"]
    assert row.card_id == uuid.UUID(water["id"])
    assert row.audio_duration_seconds == 2.75
    assert row.audio_sha256 == AUDIO_RECEIPT["audio_sha256"]
    assert row.audio_size_bytes == AUDIO_RECEIPT["audio_size_bytes"]
    assert row.audio_consent_by == caregiver.id
    assert row.audio_consent_at is not None
    assert row.audio_retained_on_device is True

    audit = await session.scalar(select(AuditLog).where(
        AuditLog.action == "awaaz.audio_pair.register"))
    assert audit is not None
    assert audit.meta_json["storage"] == "on_device"
    # No request/response field can carry the WAV; the receipt is metadata only.
    assert "audio" not in response.json()


async def test_an_audio_pair_requires_explicit_consent(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]

    response = await client.post(f"/awaaz/{patient.id}/speak", json={
        "card_id": cards[1]["id"],
        "audio_capture_id": str(uuid.uuid4()),
        "audio_duration_seconds": 1.5,
        "audio_capture_consent": False,
        **AUDIO_RECEIPT,
    }, headers=headers)
    assert response.status_code == 409
    assert "consent" in response.text.lower()
    assert await session.scalar(select(func.count(UtteranceLog.id))) == 0


async def test_audio_is_not_paired_with_unverified_free_text(session, client):
    """Without ASR or a card tap, typed text is not evidence of what the audio contains."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    response = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "water",
        "audio_capture_id": str(uuid.uuid4()),
        "audio_duration_seconds": 1.5,
        "audio_capture_consent": True,
        **AUDIO_RECEIPT,
    }, headers=headers)
    assert response.status_code == 400
    assert "phrase" in response.text.lower()


async def test_retrying_the_same_capture_is_idempotent(session, client):
    """A lost response must not create two pairs or count the card twice."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    card = cards[1]
    payload = {
        "card_id": card["id"], "audio_capture_id": str(uuid.uuid4()),
        "audio_duration_seconds": 1.25, "audio_capture_consent": True,
        **AUDIO_RECEIPT,
    }

    first = await client.post(f"/awaaz/{patient.id}/speak", json=payload, headers=headers)
    retry = await client.post(f"/awaaz/{patient.id}/speak", json=payload, headers=headers)
    assert retry.status_code == 200, retry.text
    assert retry.json()["utterance_id"] == first.json()["utterance_id"]
    assert await session.scalar(select(func.count(UtteranceLog.id))) == 1
    stored_card = await session.get(PhraseCard, uuid.UUID(card["id"]))
    assert stored_card is not None and stored_card.use_count == 1


async def test_revoking_a_local_pair_marks_its_receipt_deleted(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    capture_id = uuid.uuid4()
    await client.post(f"/awaaz/{patient.id}/speak", json={
        "card_id": cards[1]["id"], "audio_capture_id": str(capture_id),
        "audio_duration_seconds": 1.25, "audio_capture_consent": True,
        **AUDIO_RECEIPT,
    }, headers=headers)

    deleted = await client.delete(f"/awaaz/audio-pairs/{capture_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text
    row = await session.scalar(select(UtteranceLog).where(
        UtteranceLog.audio_capture_id == str(capture_id)))
    assert row is not None
    assert row.audio_retained_on_device is False
    assert row.audio_deleted_at is not None


async def test_recognised_speech_for_an_aphasic_patient_must_be_confirmed(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile",
                       json={"speech_profile": "aphasia_dominant"}, headers=headers)

    r = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "I want to go to the hospital", "confidence": 0.99,
        "candidates": ["I want to go to the hospital", "I want to go to the shop"],
    }, headers=headers)
    body = r.json()
    assert body["speak_now"] is False
    assert body["requires_confirmation"] is True
    assert body["mode"] == "confirm"
    # Crucially, no text is returned as though it had been decided.
    assert body["text"] is None
    assert len(body["candidates"]) == 2


async def test_auto_speak_cannot_be_switched_on_for_an_aphasic_patient(session, client):
    """Refused outright, not accepted and quietly ignored — a caregiver must not end up
    believing the system behaves differently than it does."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile",
                       json={"speech_profile": "aphasia_dominant"}, headers=headers)

    r = await client.patch(f"/awaaz/{patient.id}/profile",
                           json={"auto_speak_enabled": True}, headers=headers)
    assert r.status_code == 409
    assert "confirm" in r.text.lower()

    profile = (await client.get(f"/awaaz/{patient.id}/profile", headers=headers)).json()
    assert profile["auto_speak_enabled"] is False


async def test_a_dysarthric_patient_with_clear_speech_is_spoken_directly(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile", json={
        "speech_profile": "dysarthria_dominant", "auto_speak_enabled": True},
        headers=headers)

    r = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "pass me the water", "confidence": 0.95}, headers=headers)
    body = r.json()
    assert body["speak_now"] is True
    assert body["mode"] == "auto"
    assert body["text"] == "pass me the water"


async def test_unclear_speech_is_confirmed_even_for_a_dysarthric_patient(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile", json={
        "speech_profile": "dysarthria_dominant", "auto_speak_enabled": True},
        headers=headers)

    r = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "pass me the water", "confidence": 0.30}, headers=headers)
    assert r.json()["speak_now"] is False


async def test_a_confirmed_candidate_is_spoken_and_logged_as_confirmed(session, client):
    """The candidate tap is the consent event, so the second request must complete rather
    than returning the same confirmation prompt again."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile",
                       json={"speech_profile": "aphasia_dominant"}, headers=headers)

    offered = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "Please call my daughter",
        "confidence": 0.42,
        "candidates": ["Please call my daughter", "Please call my doctor"],
    }, headers=headers)
    assert offered.json()["requires_confirmation"] is True

    chosen = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "Please call my daughter",
        "confidence": 0.42,
        "confirmed_candidate": True,
    }, headers=headers)
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["speak_now"] is True
    assert chosen.json()["requires_confirmation"] is False
    assert chosen.json()["text"] == "Please call my daughter"

    rows = list(await session.scalars(
        select(UtteranceLog).where(UtteranceLog.patient_id == patient.id)))
    assert len(rows) == 1
    assert rows[0].mode == "confirm"
    assert rows[0].confirmed is True


async def test_a_confirmed_candidate_requires_text(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    r = await client.post(f"/awaaz/{patient.id}/speak", json={
        "confirmed_candidate": True,
    }, headers=headers)
    assert r.status_code == 400


async def test_every_utterance_is_logged_with_whether_it_was_confirmed(session, client):
    """The audit trail for INV-9 — it must be possible to show, after the fact, that
    nothing was ever spoken unconfirmed on an aphasic patient's behalf."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    cards = (await client.get(f"/awaaz/{patient.id}/board", headers=headers)).json()["cards"]
    await client.post(f"/awaaz/{patient.id}/speak",
                      json={"card_id": cards[1]["id"]}, headers=headers)

    rows = list(await session.scalars(
        select(UtteranceLog).where(UtteranceLog.patient_id == patient.id)))
    assert len(rows) == 1
    assert rows[0].confirmed is True


# ------------------------------------------------------------------ emergency
async def test_emergency_never_uses_speech_recognition(session, client):
    """A person in crisis is the least intelligible they will ever be, and ASR is the
    component most likely to fail exactly then."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)

    r = await client.post(f"/awaaz/{patient.id}/emergency", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["used_speech_recognition"] is False
    # No client playback receipt means the API must not infer offline capability merely
    # because a recording might exist in some browser.
    assert body["works_offline"] is False
    assert body["caregiver_notified"] is False
    assert body["spoken_text"] == "I need help"


async def test_emergency_reports_and_audits_a_local_playback_receipt(session, client):
    """The raw WAV stays on the phone; the server receives only what happened on tap."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)

    r = await client.post(
        f"/awaaz/{patient.id}/emergency",
        json={"offline_audio_played": True},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["works_offline"] is True
    assert body["used_speech_recognition"] is False
    assert body["caregiver_notified"] is False

    audit = await session.scalar(select(AuditLog).where(
        AuditLog.action == "awaaz.emergency",
        AuditLog.patient_id == patient.id,
    ))
    assert audit is not None
    assert audit.actor_id == caregiver.id
    assert audit.meta_json == {
        "offline_audio_played": True,
        "used_speech_recognition": False,
    }


async def test_emergency_speaks_the_patients_own_language(session, client):
    caregiver, patient = await _patient(session, lang="pa")
    headers = await _headers(client, caregiver)
    body = (await client.post(f"/awaaz/{patient.id}/emergency", headers=headers)).json()
    assert body["spoken_text"] == "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ"
    assert body["lang"] == "pa"


async def test_emergency_works_for_an_aphasic_patient_without_confirmation(session, client):
    """They long-pressed it deliberately. There is nothing being guessed, and a
    confirmation dialog in an emergency is an obstacle, not a safeguard."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    await client.patch(f"/awaaz/{patient.id}/profile",
                       json={"speech_profile": "aphasia_dominant"}, headers=headers)

    body = (await client.post(f"/awaaz/{patient.id}/emergency", headers=headers)).json()
    assert body["spoken_text"] == "I need help"


async def test_emergency_records_location_when_offered(session, client):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    body = (await client.post(
        f"/awaaz/{patient.id}/emergency?lat=30.9&lon=75.85", headers=headers)).json()
    assert body["location"] == {"lat": 30.9, "lon": 75.85}


# ------------------------------------------------------------------ endpointing
async def test_the_silence_threshold_is_tunable_up_to_four_seconds(session, client):
    """Default VAD cutting dysarthric speakers off mid-sentence is the leading cause of
    abandonment in this product category."""
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)

    r = await client.patch(f"/awaaz/{patient.id}/profile",
                           json={"endpoint_silence_seconds": 4.0}, headers=headers)
    assert r.json()["endpoint_silence_seconds"] == 4.0

    # Out-of-range values are rejected by the schema rather than silently clamped.
    too_long = await client.patch(f"/awaaz/{patient.id}/profile",
                                  json={"endpoint_silence_seconds": 10.0}, headers=headers)
    assert too_long.status_code == 422


# ------------------------------------------------------------------ D2 listener mode
def test_a_listener_link_expires_and_can_be_revoked():
    """A link that spreads is a link that leaks. It is a capability, not a relationship."""
    from app.awaaz.listener import MAX_TTL_MINUTES, create_listener_session

    s = create_listener_session("patient-1", "Papa", "pa", ttl_minutes=90)
    assert s.active is True
    assert len(s.token) == 32

    s.revoked = True
    assert s.active is False

    # Nobody can mint an unbounded link.
    long = create_listener_session("patient-1", "Papa", ttl_minutes=99999)
    assert (long.expires_at - datetime.now(timezone.utc)).total_seconds() <= \
        MAX_TTL_MINUTES * 60 + 5


def test_the_listener_link_does_not_carry_the_enrolled_name():
    """The page can be forwarded to strangers. The caregiver chooses what appears on it."""
    from app.awaaz.listener import create_listener_session

    s = create_listener_session("patient-1", "my father")
    assert s.display_name == "my father"
    assert "patient-1" not in s.display_name


async def test_listener_link_never_reveals_utterances_from_before_it_was_minted(
    session, client,
):
    caregiver, patient = await _patient(session)
    headers = await _headers(client, caregiver)
    session.add(UtteranceLog(
        patient_id=patient.id,
        text="This was said yesterday",
        lang="en",
        mode="confirm",
        confirmed=True,
        ts=NOW,
    ))
    await session.commit()

    minted = await client.post(f"/awaaz/{patient.id}/listener", json={
        "display_name": "my father", "lang": "en", "ttl_minutes": 30,
    }, headers=headers)
    assert minted.status_code == 200, minted.text
    token = minted.json()["token"]

    spoken = await client.post(f"/awaaz/{patient.id}/speak", json={
        "text": "This is part of this conversation",
        "lang": "en",
        "confirmed_candidate": True,
    }, headers=headers)
    assert spoken.status_code == 200, spoken.text

    view = await client.get(f"/awaaz/listen/{token}")
    assert view.status_code == 200, view.text
    assert [row["text"] for row in view.json()["recent"]] == [
        "This is part of this conversation",
    ]


def test_coaching_tells_the_listener_to_wait_during_a_long_pause():
    """The commonest moment a listener jumps in, and the one where waiting matters most."""
    from app.awaaz.listener import LONG_PAUSE_SECONDS, ListenerState, coaching_line

    code, line = coaching_line(
        ListenerState("Papa", "en", seconds_since_last_utterance=LONG_PAUSE_SECONDS + 1))
    assert code == "long_pause"
    assert "seconds" in line.lower()


def test_coaching_switches_to_yes_no_when_speech_is_unclear():
    """Not 'speak louder' — that is the instinctive and useless response."""
    from app.awaaz.listener import ListenerState, coaching_line

    code, line = coaching_line(
        ListenerState("Papa", "en", recent_confidences=[0.3, 0.4, 0.35]))
    assert code == "low_confidence"
    assert "yes or no" in line.lower()


def test_coaching_never_tells_a_listener_to_guess_the_word():
    """Guessing for an aphasic patient is the same error as auto-speak, made by a human."""
    from app.awaaz.listener import ListenerState, coaching_line

    _, line = coaching_line(ListenerState("Papa", "en", word_finding_flagged=True))
    assert "do not guess" in line.lower()


@pytest.mark.parametrize("lang", ["en", "hi", "pa"])
def test_coaching_is_available_in_every_language(lang):
    from app.awaaz.listener import COACHING, ListenerState, coaching_line

    for code in COACHING:
        assert COACHING[code][lang].strip()
    _, line = coaching_line(ListenerState("Papa", lang))
    assert line.strip()


# ------------------------------------------------------------------ D4 passive learning
def test_a_tapped_card_never_goes_to_the_caregiver_for_review():
    """The tap already gave us the target. Asking would waste the two minutes we have."""
    from app.awaaz.convergence import should_request_caregiver_review

    assert should_request_caregiver_review(0.1, has_card_target=True) is False
    assert should_request_caregiver_review(0.1, has_card_target=False) is True


def test_the_review_queue_is_worst_first_and_capped():
    """A caregiver who does only three items should have done the three that mattered, and
    a list of forty is a chore that gets abandoned."""
    from app.awaaz.convergence import MAX_REVIEW_ITEMS, build_review_queue

    q = build_review_queue([{"confidence": c / 100} for c in range(0, 60)])
    assert len(q) <= MAX_REVIEW_ITEMS
    confidences = [u["confidence"] for u in q]
    assert confidences == sorted(confidences)


def test_clear_speech_is_not_sent_for_review():
    from app.awaaz.convergence import build_review_queue

    assert build_review_queue([{"confidence": 0.95}, {"confidence": 0.99}]) == []


# ------------------------------------------------------------------ D5 convergence
def test_conversational_features_route_to_the_modules_that_already_score_them():
    from app.awaaz.convergence import route_conversational_features

    out = route_conversational_features({
        "articulation_rate": 4.1, "pause_ratio": 0.3,
        "words_per_min": 88.0, "type_token_ratio": 0.42,
    })
    assert set(out) == {"M4", "M5"}
    assert "articulation_rate" in out["M4"]
    assert "words_per_min" in out["M5"]


def test_prompted_only_features_are_never_inferred_from_conversation():
    """Sustained phonation and DDK need a prompted task. Letting them through would put a
    value into M4's baseline that free speech cannot actually support."""
    from app.awaaz.convergence import route_conversational_features

    out = route_conversational_features({
        "ddk_rate": 5.0, "max_phonation_time": 12.0, "articulation_rate": 4.1})
    assert "ddk_rate" not in out.get("M4", {})
    assert "max_phonation_time" not in out.get("M4", {})
    assert "articulation_rate" in out["M4"]


def test_the_frozen_adapter_catches_a_decline_the_live_one_hides():
    """The point of D5.

    The live adapter learns the degraded speech and keeps transcribing well, so the better
    our assistive tool works the more completely the decline disappears. The frozen day-30
    adapter does not move.
    """
    from app.awaaz.convergence import AdapterDrift

    d = AdapterDrift("p1", day=90, wer_live=0.183, wer_frozen=0.297,
                     wer_frozen_at_reference=0.171, n_utterances=200)
    assert d.drift > 0.1
    assert d.masked_by_adaptation is True
    assert "deteriorated" in d.to_json()["note"]


def test_a_genuinely_stable_patient_is_not_flagged():
    from app.awaaz.convergence import AdapterDrift

    d = AdapterDrift("p1", day=90, wer_live=0.175, wer_frozen=0.178,
                     wer_frozen_at_reference=0.171, n_utterances=200)
    assert d.masked_by_adaptation is False
    assert "stable" in d.to_json()["note"]


def test_a_decline_the_live_adapter_also_shows_is_not_called_masked():
    """Masked means specifically 'hidden by adaptation'. If both models show it, it is a
    plain decline and the word masked would be wrong."""
    from app.awaaz.convergence import AdapterDrift

    d = AdapterDrift("p1", day=90, wer_live=0.310, wer_frozen=0.320,
                     wer_frozen_at_reference=0.171, n_utterances=200)
    assert d.drift > 0.1
    assert d.masked_by_adaptation is False
