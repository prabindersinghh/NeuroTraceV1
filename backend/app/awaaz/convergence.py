"""Awaaz D4/D5 — passive learning, and convergence with the monitoring engine.

D4 — THE ENROLMENT PROBLEM
--------------------------
Personalised ASR needs labelled audio from the patient. The obvious way to get it is to ask
for it, and that is why Google's Project Relate stalls: you are asking a tired stroke
survivor to read five hundred phrases before the product does anything for them. Most people
never finish, and the ones who do are the least impaired.

So we never ask. Two sources, both free:

  TAPPED CARDS. When the patient taps "water" on the board, they very often say it aloud at
  the same time — that is what people do. The tap gives us the target text and the
  microphone gives us the audio. A labelled pair, obtained at the moment of ordinary use,
  with nobody asked to do anything.

  THE CAREGIVER'S EVENING TWO MINUTES. The app replays the day's unclear utterances and the
  caregiver types what they actually meant. Families are the world's best interpreters of
  their own relative's speech — better than any model — and this is the only way to harvest
  that. It is also the point: caregivers of stroke survivors overwhelmingly report feeling
  helpless, and this gives them something concrete that visibly helps.

D5 — EVERY UTTERANCE IS ALSO A MEASUREMENT
------------------------------------------
The same audio that trains the adapter carries articulation rate, pause structure, voice
quality, word-finding latency and vocabulary diversity — the exact features M4 (dysarthria)
and M5 (aphasia) already score. Routing them into the same pipeline gives monitoring data at
conversational density with ZERO adherence burden: no daily check-in required, no compliance
to chase, and a signal that gets denser precisely when the patient is talking more.

THE FROZEN ADAPTER — the part that makes this clinical rather than convenient
----------------------------------------------------------------------------
The live per-patient adapter tracks the patient. As their speech degrades it quietly learns
the degraded speech and keeps transcribing well. That is exactly right for an assistive tool
and exactly wrong for detection: the better the assistant works, the more invisible the
decline becomes.

So we keep the day-30 adapter permanently and score every day's audio against BOTH. If
today's speech is worse against the FROZEN adapter while the live one still performs, the
speech has objectively deteriorated — measured against the patient's own recorded speech
from a month after enrolment, with no clinician, no questionnaire and no extra burden.

This is the same insight as the frozen baseline in the monitoring engine (DECISIONS D-013),
applied to a model instead of a median.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

#: Below this confidence an utterance goes into the caregiver's evening review queue.
REVIEW_CONFIDENCE_THRESHOLD = 0.70
#: Cap on the nightly review list. The whole proposition is "two minutes"; a list of forty
#: items is a chore, and a chore gets abandoned.
MAX_REVIEW_ITEMS = 12
#: Below this many pairs an adapter memorises phrases instead of learning the speaker.
MIN_PAIRS_TO_TRAIN = 50
#: The adapter frozen as the patient's reference. Day 30, not day 1 — by then they are past
#: the enrolment novelty and the recordings reflect settled post-stroke speech.
REFERENCE_ADAPTER_DAY = 30
#: WER rise against the frozen adapter that counts as real deterioration rather than noise.
DRIFT_SIGNIFICANT = 0.05
#: Live WER movement below this counts as "the adapter is compensating".
LIVE_STABLE_BAND = 0.02


@dataclass(slots=True)
class HarvestedPair:
    """One free training example."""

    target_text: str
    #: "card_tap" (the patient tapped a card and spoke) or "caregiver_review".
    source: str
    confidence: float = 0.0
    duration_seconds: float = 0.0
    ts: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def is_labelled(self) -> bool:
        return bool(self.target_text.strip())


def should_request_caregiver_review(confidence: float, has_card_target: bool) -> bool:
    """Does this utterance need a human label tonight?

    A card tap already gives us the target, so it never needs review — asking would waste
    the caregiver's two minutes on something we already know.
    """
    if has_card_target:
        return False
    return confidence < REVIEW_CONFIDENCE_THRESHOLD


def build_review_queue(utterances: list[dict]) -> list[dict]:
    """The evening list, worst-first and capped.

    Worst-first because those are the utterances where a label buys the most, and because a
    caregiver who does only three items should have done the three that mattered.
    """
    candidates = [
        u for u in utterances
        if should_request_caregiver_review(
            float(u.get("confidence") or 0.0), bool(u.get("card_id")))
    ]
    candidates.sort(key=lambda u: float(u.get("confidence") or 0.0))
    return candidates[:MAX_REVIEW_ITEMS]


# --------------------------------------------------------------------------- D5
#: Conversational speech features that map onto modules we already score. Deliberately a
#: subset: these are the ones a free-conversation sample supports. Sustained phonation and
#: DDK need a prompted task and are NOT inferable from spontaneous speech, so they stay in
#: the daily check-in.
CONVERSATIONAL_FEATURE_MAP = {
    "articulation_rate": "M4",
    "pause_ratio": "M4",
    "n_pauses_per_sec": "M4",
    "jitter_local": "M4",
    "shimmer_local": "M4",
    "hnr": "M4",
    "f0_cv": "M4",
    "words_per_min": "M5",
    "type_token_ratio": "M5",
    "mean_length_utterance": "M5",
    "word_finding_latency": "M5",
    "word_finding_latency_cv": "M5",
}


def route_conversational_features(features: dict) -> dict[str, dict[str, float]]:
    """Split one utterance's features into the module buckets the engine already knows.

    Returns {module_code: {feature: value}}. Anything unmapped is dropped rather than
    guessed at — a feature landing in the wrong module would corrupt that module's baseline
    silently, which is worse than not having it.
    """
    out: dict[str, dict[str, float]] = {}
    for key, value in features.items():
        module = CONVERSATIONAL_FEATURE_MAP.get(key)
        if module is None:
            continue
        try:
            out.setdefault(module, {})[key] = float(value)
        except (TypeError, ValueError):
            continue
    return out


@dataclass(slots=True)
class AdapterDrift:
    """Today's speech, measured against the live adapter and the frozen day-30 one."""

    patient_id: str
    day: int
    wer_live: float
    wer_frozen: float
    wer_frozen_at_reference: float
    n_utterances: int

    @property
    def drift(self) -> float:
        return self.wer_frozen - self.wer_frozen_at_reference

    @property
    def masked_by_adaptation(self) -> bool:
        """The finding this whole mechanism exists for.

        The live adapter has absorbed the change — its error is barely different from the
        reference — while the frozen one shows the speech is materially worse. Without the
        frozen comparison this patient looks completely stable, and the better our
        assistive tool works, the more completely they look stable.
        """
        return (
            self.drift > DRIFT_SIGNIFICANT
            and abs(self.wer_live - self.wer_frozen_at_reference) < LIVE_STABLE_BAND
        )

    def to_json(self) -> dict:
        return {
            "patient_id": self.patient_id,
            "day": self.day,
            "wer_live": round(self.wer_live, 4),
            "wer_frozen": round(self.wer_frozen, 4),
            "wer_frozen_at_reference": round(self.wer_frozen_at_reference, 4),
            "drift": round(self.drift, 4),
            "n_utterances": self.n_utterances,
            "masked_by_adaptation": self.masked_by_adaptation,
            "reference_adapter_day": REFERENCE_ADAPTER_DAY,
            "note": (
                "Speech has objectively deteriorated against this patient's own day-30 "
                "recordings, while the adapted model still transcribes them well."
                if self.masked_by_adaptation else
                "Speech is stable against the day-30 reference."
            ),
        }
