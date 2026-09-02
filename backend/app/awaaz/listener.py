"""Awaaz D2 — listener mode.

A shareable browser link, no install, showing live cleaned text of what the survivor is
saying, plus one line of coaching for the person listening.

WHY THIS IS THE DIFFERENTIATOR
------------------------------
Every other assistive-communication product treats the disabled person as the user and the
listener as a bystander. But a conversation fails at the listener as often as at the
speaker: people finish sentences, fill silences, switch to the caregiver mid-sentence, and
raise their voice as though the problem were hearing. None of that is malice — it is what
untrained people do when a conversation stalls, and it is the thing that makes a stroke
survivor stop trying.

So the listener gets a screen too. One line, not a tutorial: nobody reads a tutorial while
a person is waiting to speak to them.

AND IT IS THE DISTRIBUTION MECHANISM
------------------------------------
Every conversation puts the product in a stranger's browser — a shopkeeper, a nurse, a
grandchild. No install, no account, no app store. The link IS the growth loop, which is
also why it must be revocable and time-limited: a link that spreads is a link that leaks.

PRIVACY SHAPE
-------------
A session token is a capability. It grants a live view of one patient's utterances for a
bounded window and nothing else — no history, no name beyond a display name the caregiver
chooses, no other patient, no write access. It expires, and it can be killed instantly.

INV-1 still holds: no audio crosses the wire. The device transcribes and posts text.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

#: A listener link is for one conversation, not for a relationship. Long enough for a
#: hospital appointment, short enough that a forwarded link is dead by the time it spreads.
DEFAULT_TTL_MINUTES = 120
MAX_TTL_MINUTES = 480

#: Tokens are shown as part of a URL a stranger may read aloud. 32 hex chars is plenty of
#: entropy while staying short enough to be typed if someone has to.
TOKEN_BYTES = 16


def new_listener_token() -> str:
    return secrets.token_hex(TOKEN_BYTES)


# --- listener coaching -------------------------------------------------------
#
# One line at a time. The line is chosen by what is actually happening in the conversation,
# because generic advice ("be patient") changes nobody's behaviour, and a wall of guidance
# gets skipped.

COACHING = {
    "default": {
        "en": "Give them time. Do not finish their sentences.",
        "hi": "उन्हें समय दीजिए। उनका वाक्य पूरा मत कीजिए।",
        "pa": "ਉਹਨਾਂ ਨੂੰ ਸਮਾਂ ਦਿਓ। ਉਹਨਾਂ ਦਾ ਵਾਕ ਪੂਰਾ ਨਾ ਕਰੋ।",
    },
    # Long pause: the commonest moment a listener jumps in, and the one where waiting
    # matters most — word-finding takes the time it takes.
    "long_pause": {
        "en": "They are still thinking. Give them 10 more seconds.",
        "hi": "वे अभी सोच रहे हैं। 10 सेकंड और दीजिए।",
        "pa": "ਉਹ ਹਾਲੇ ਸੋਚ ਰਹੇ ਹਨ। 10 ਸਕਿੰਟ ਹੋਰ ਦਿਓ।",
    },
    # Repeated low-confidence output: switch the question shape rather than repeating it
    # louder, which is the instinctive and useless response.
    "low_confidence": {
        "en": "Hard to make out. Try a question they can answer yes or no.",
        "hi": "समझना मुश्किल है। ऐसा सवाल पूछिए जिसका जवाब हाँ या ना हो।",
        "pa": "ਸਮਝਣਾ ਔਖਾ ਹੈ। ਅਜਿਹਾ ਸਵਾਲ ਪੁੱਛੋ ਜਿਸਦਾ ਜਵਾਬ ਹਾਂ ਜਾਂ ਨਾ ਹੋਵੇ।",
    },
    "word_finding": {
        "en": "They know the word. Do not guess it for them — offer two choices.",
        "hi": "उन्हें शब्द पता है। अंदाज़ा मत लगाइए — दो विकल्प दीजिए।",
        "pa": "ਉਹਨਾਂ ਨੂੰ ਸ਼ਬਦ ਪਤਾ ਹੈ। ਅੰਦਾਜ਼ਾ ਨਾ ਲਗਾਓ — ਦੋ ਬਦਲ ਦਿਓ।",
    },
    "flowing": {
        "en": "That is working. Keep going at this pace.",
        "hi": "यह ठीक चल रहा है। इसी गति से चलिए।",
        "pa": "ਇਹ ਠੀਕ ਚੱਲ ਰਿਹਾ ਹੈ। ਇਸੇ ਰਫ਼ਤਾਰ ਨਾਲ ਚੱਲੋ।",
    },
    # Said to the listener, not about the patient. The commonest error of all.
    "talking_to_carer": {
        "en": "Look at them, not at whoever came with them.",
        "hi": "उनकी ओर देखिए, साथ आए व्यक्ति की ओर नहीं।",
        "pa": "ਉਹਨਾਂ ਵੱਲ ਦੇਖੋ, ਨਾਲ ਆਏ ਵਿਅਕਤੀ ਵੱਲ ਨਹੀਂ।",
    },
}

#: Seconds of silence after which the listener is told to wait rather than jump in. Matches
#: the endpoint threshold the patient's own ASR uses — a listener who interrupts at 2s
#: defeats a 4s silence window.
LONG_PAUSE_SECONDS = 4.0
#: Below this mean confidence over recent utterances, switch to yes/no questions.
LOW_CONFIDENCE = 0.55


@dataclass(slots=True)
class ListenerState:
    """What the listener view knows. Deliberately tiny."""

    display_name: str
    lang: str = "en"
    recent_confidences: list[float] = field(default_factory=list)
    seconds_since_last_utterance: float = 0.0
    word_finding_flagged: bool = False
    utterances: int = 0


def coaching_line(state: ListenerState) -> tuple[str, str]:
    """Return (code, line) — the single most useful thing to say right now.

    Ordered by urgency of the mistake it prevents, not by cleverness. A listener reads one
    line; it should be the one that matters most at this instant.
    """
    lang = state.lang if state.lang in ("en", "hi", "pa") else "en"

    if state.seconds_since_last_utterance >= LONG_PAUSE_SECONDS:
        code = "long_pause"
    elif state.word_finding_flagged:
        code = "word_finding"
    elif state.recent_confidences and (
        sum(state.recent_confidences) / len(state.recent_confidences) < LOW_CONFIDENCE
    ):
        code = "low_confidence"
    elif state.utterances >= 3:
        code = "flowing"
    else:
        code = "default"

    return code, COACHING[code][lang]


@dataclass(slots=True)
class ListenerSession:
    """A capability to watch one patient's live transcript for a bounded window."""

    token: str
    patient_id: str
    display_name: str
    lang: str
    created_at: datetime
    expires_at: datetime
    revoked: bool = False

    @property
    def active(self) -> bool:
        return not self.revoked and datetime.now(timezone.utc) < self.expires_at

    def to_json(self) -> dict:
        return {
            "token": self.token,
            "display_name": self.display_name,
            "lang": self.lang,
            "expires_at": self.expires_at.isoformat(),
            "active": self.active,
        }


def create_listener_session(
    patient_id: str,
    display_name: str,
    lang: str = "en",
    ttl_minutes: int = DEFAULT_TTL_MINUTES,
) -> ListenerSession:
    """Mint a listener link.

    `display_name` is whatever the caregiver wants a stranger to see — often a first name
    only, sometimes just "my father". We do not put the enrolled patient name on a page that
    can be forwarded.
    """
    ttl = max(1, min(int(ttl_minutes), MAX_TTL_MINUTES))
    now = datetime.now(timezone.utc)
    return ListenerSession(
        token=new_listener_token(),
        patient_id=str(patient_id),
        display_name=display_name.strip()[:64] or "Someone",
        lang=lang if lang in ("en", "hi", "pa") else "en",
        created_at=now,
        expires_at=now + timedelta(minutes=ttl),
    )
