"""Forbidden-language guards — TRD §8 and the session rules.

Two categories, and they are forbidden for different reasons.

**Diagnostic language** ("stroke", "diagnos*") is forbidden because the system does not
have the evidence to support a diagnostic claim, independent of what that would do to our
regulatory posture. Saying "possible stroke" to a family invites them to act on a claim
the engine cannot support — that is the harm, not a classification technicality. (Word
choice was never a route to being unregulated: under the CDSCO Medical Devices Rules
framework, classification follows intended use, not phrasing. See `docs/INTENDED_USE.md`.)

**Wellness assertions** ("you are fine", "all clear", "normal, no action") are forbidden
because they are actively dangerous. This system monitors slow change and structurally
cannot see an acute event. Telling somebody they are fine on the morning they are having a
stroke is the single worst output this product could produce.

The checks are substring-based on purpose. A clever regex that "understands context" is
exactly the kind of thing that fails open. These fail closed.
"""
from __future__ import annotations

import re

# Never appear in any user-facing string.
DIAGNOSTIC_TERMS = (
    "stroke",
    "diagnos",       # diagnosis, diagnose, diagnostic, diagnosed
    "infarct",
    "haemorrhage",
    "hemorrhage",
    "atrial fibrillation",
    "you have ",
)

# Never assert that the patient is well.
WELLNESS_ASSERTIONS = (
    "you are fine",
    "you're fine",
    "all clear",
    "all is well",
    "nothing to worry",
    "no need to worry",
    "no problem",
    "you are healthy",
    "you're healthy",
    "everything is normal",
    "normal, no action",
    "no action needed",
    "no action required",
    "perfectly normal",
    "you are okay",
    "you're okay",
    "nothing is wrong",
)

FORBIDDEN_SUBSTRINGS = DIAGNOSTIC_TERMS + WELLNESS_ASSERTIONS

# Hindi / Punjabi equivalents of the wellness assertion.
FORBIDDEN_LOCALISED = (
    "आप ठीक हैं",
    "सब ठीक है",
    "कोई चिंता नहीं",
    "चिंता की कोई बात नहीं",
    "ਤੁਸੀਂ ਠੀਕ ਹੋ",
    "ਸਭ ਠੀਕ ਹੈ",
    "ਕੋਈ ਚਿੰਤਾ ਨਹੀਂ",
)

ALL_FORBIDDEN = FORBIDDEN_SUBSTRINGS + FORBIDDEN_LOCALISED

# "stroke" is legitimate in a few internal contexts (a column called stroke_date, a
# clinician-facing field label). Only user-facing copy is checked, and these exact
# technical tokens are exempted.
TECHNICAL_EXEMPTIONS = ("stroke_date", "stroke_side", "post-stroke", "poststroke")


class SafetyViolation(AssertionError):
    """Raised when generated text would breach the safety contract."""


def _normalise(text: str) -> str:
    lowered = (text or "").lower()
    for exemption in TECHNICAL_EXEMPTIONS:
        lowered = lowered.replace(exemption, "")
    return re.sub(r"\s+", " ", lowered)


def contains_forbidden(text: str) -> list[str]:
    """Every forbidden phrase present in `text`. Empty list means the text is safe."""
    normalised = _normalise(text)
    hits = [term for term in FORBIDDEN_SUBSTRINGS if term in normalised]
    hits += [term for term in FORBIDDEN_LOCALISED if term in (text or "")]
    return hits


def assert_no_wellness_assertion(text: str, *, where: str = "output") -> None:
    """Raise if `text` breaches the contract. Used by the SLM guardrail and by tests."""
    hits = contains_forbidden(text)
    if hits:
        raise SafetyViolation(
            f"{where} contains forbidden language: {', '.join(sorted(set(hits)))}"
        )


def scrub(text: str, replacement: str = "") -> str:
    """Remove forbidden phrases from text.

    Used only as a last resort after the SLM has already failed the guardrail once; the
    deterministic template fallback is preferred, because a scrubbed sentence often reads
    as nonsense and nonsense in a health app destroys trust just as fast as a wrong claim.
    """
    out = text or ""
    for term in ALL_FORBIDDEN:
        out = re.sub(re.escape(term), replacement, out, flags=re.IGNORECASE)
    return re.sub(r"\s{2,}", " ", out).strip()
