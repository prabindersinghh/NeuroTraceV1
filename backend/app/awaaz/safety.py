"""Awaaz — the auto-speak gate. INV-9.

This file is small and it is the most important file in the second product.

DYSARTHRIA is a motor failure. The muscles that shape sound are weak or uncoordinated; the
message behind them is intact and the patient knows exactly what they meant. Recovering that
signal automatically is legitimate — you are undoing a transmission fault, not inventing
content.

APHASIA is a failure of language itself. The message may not be fully formed. A model that
completes an aphasic patient's sentence is not recovering a signal; it is generating one and
attaching that person's name and voice to it.

The consequence is asymmetric in a way that matters. If the guess is wrong, the patient has
been made to say something they did not mean — in their own cloned voice, to their own
family, who have no way to tell it apart from something they did mean. And the patient may
not have the language left to correct it. There is no undo for a sentence somebody has
already heard in your voice.

So auto-speak requires BOTH:
  1. a dysarthria-dominant profile, and
  2. transcript confidence above the configured threshold.

`may_auto_speak` is the ONLY path to speech without confirmation. It is deliberately a
single pure function with no I/O, so it can be exhaustively tested and so there is exactly
one place to audit.

A MIXED profile is treated as aphasia. When both are present the language impairment governs
what is safe, because the failure mode we are guarding against is a plausible sentence the
patient never meant. Erring toward confirmation costs the patient a tap. Erring the other
way costs them their words.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass


class SpeechProfile(str, enum.Enum):
    """Which impairment dominates. Set by a clinician, or a caregiver on their advice."""

    #: Motor problem, message intact. The ONLY profile that may auto-speak.
    dysarthria_dominant = "dysarthria_dominant"
    #: Language problem. Candidates only, always confirmed.
    aphasia_dominant = "aphasia_dominant"
    #: Both present. Treated as aphasia — the language impairment governs what is safe.
    mixed = "mixed"
    #: Not yet assessed. Treated as aphasia until somebody decides.
    unassessed = "unassessed"


#: Profiles for which auto-speak is reachable at all. Deliberately an allow-list: a profile
#: added later is safe by default rather than dangerous by default.
AUTO_SPEAK_ELIGIBLE = frozenset({SpeechProfile.dysarthria_dominant})

#: Below this, even a dysarthria-dominant patient confirms. High on purpose — the cost of a
#: wrong auto-spoken sentence is far greater than the cost of one extra tap.
DEFAULT_AUTO_SPEAK_THRESHOLD = 0.85

#: Nobody may configure the threshold below this, however much they want fewer taps.
MIN_AUTO_SPEAK_THRESHOLD = 0.70


class SpeakMode(str, enum.Enum):
    #: Spoken immediately, no confirmation.
    auto = "auto"
    #: Candidates offered; the patient picks one and only then is it spoken.
    confirm = "confirm"


@dataclass(frozen=True, slots=True)
class SpeakDecision:
    mode: SpeakMode
    reason: str

    @property
    def auto(self) -> bool:
        return self.mode is SpeakMode.auto


def may_auto_speak(
    profile: SpeechProfile | str,
    confidence: float,
    *,
    enabled: bool = True,
    threshold: float = DEFAULT_AUTO_SPEAK_THRESHOLD,
) -> bool:
    """May this utterance be spoken WITHOUT the patient confirming it?

    The single gate. Every speech path goes through this, and it returns False for anything
    other than a dysarthria-dominant profile with high confidence and the feature explicitly
    enabled.
    """
    try:
        profile = SpeechProfile(profile)
    except ValueError:
        # An unrecognised profile is not a reason to guess. It is a reason to confirm.
        return False

    if profile not in AUTO_SPEAK_ELIGIBLE:
        return False
    if not enabled:
        return False

    effective = max(float(threshold), MIN_AUTO_SPEAK_THRESHOLD)
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        return False
    if not 0.0 <= confidence <= 1.0:
        return False

    return confidence >= effective


def decide(
    profile: SpeechProfile | str,
    confidence: float,
    *,
    enabled: bool = True,
    threshold: float = DEFAULT_AUTO_SPEAK_THRESHOLD,
) -> SpeakDecision:
    """The same decision, with a reason the UI and the audit log can both use."""
    if may_auto_speak(profile, confidence, enabled=enabled, threshold=threshold):
        return SpeakDecision(SpeakMode.auto,
                             "clear speech, motor-only impairment - spoken directly")

    try:
        resolved = SpeechProfile(profile)
    except ValueError:
        resolved = SpeechProfile.unassessed

    if resolved is SpeechProfile.aphasia_dominant:
        reason = ("word-finding is affected, so options are offered and never spoken until "
                  "confirmed")
    elif resolved is SpeechProfile.mixed:
        reason = ("both speech and word-finding are affected; options are confirmed, which "
                  "is the safer of the two")
    elif resolved is SpeechProfile.unassessed:
        reason = "speech profile not yet assessed - confirming until it is"
    elif not enabled:
        reason = "automatic speaking is switched off for this person"
    else:
        reason = "not clear enough to speak without checking"
    return SpeakDecision(SpeakMode.confirm, reason)
