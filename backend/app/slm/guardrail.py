"""SLM output guardrail — TRD §7. Every generation passes through here before display.

Four checks, in order of severity:

1. **Band match.** The rendered text must agree with the engine's band. A model that says
   "keep an eye on this" when the engine said STABLE, or "everything looked usual" when the
   engine said ALERT, has silently overridden the clinical logic. This is the check that
   enforces "the SLM never computes anything".

2. **Forbidden language.** No diagnostic terms, no wellness assertions, in any of the three
   languages. See `safety/guards.py` for why each is banned.

3. **No fabricated numbers.** The model was given no numbers, so any digit it produces was
   invented. A hallucinated "your reaction time is 15% slower" is indistinguishable from a
   real measurement to a reader, which makes it worse than saying nothing.

4. **Length.** 2-3 sentences. A model that runs long has usually started improvising.

Any failure falls back to the deterministic template. We never show partially-repaired
model output, because a scrubbed sentence reads as broken, and broken copy in a health app
costs trust as fast as a wrong claim does.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..safety.guards import contains_forbidden
from .prompt import SLMInput
from .templates import render_template

MAX_SENTENCES = 4       # 3 intended, 1 of slack for a trailing clause
MAX_CHARS = 600

# Words that would mean the model asserted the wrong band.
_BAND_CONTRADICTIONS = {
    "STABLE": ("contact their doctor", "check on them today", "call the doctor",
               "seek medical", "urgent", "immediately"),
    "ALERT": ("as usual", "same as always", "no change", "unchanged", "usual pattern"),
    # Two ways to get this band wrong: reassure the reader that nothing is happening
    # (something is, and it is progressing), or imply a stroke finding (there is none -
    # that is precisely what the symmetry told us).
    "PATTERN_ATYPICAL": ("as usual", "same as always", "no change", "unchanged",
                         "usual pattern", "stroke"),
}

_DIGIT = re.compile(r"\d")
# Numbers that are legitimately allowed through: emergency phone numbers.
_ALLOWED_NUMERIC = ("108", "112")


class GuardrailViolation(Exception):
    """Raised internally when generated text fails a check."""


@dataclass(slots=True)
class GuardrailResult:
    text: str
    source: str                      # "slm" or "template"
    passed: bool = True
    violations: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {"text": self.text, "source": self.source,
                "passed": self.passed, "violations": self.violations}


def _check_band_match(text: str, band: str) -> list[str]:
    lowered = text.lower()
    return [f"band contradiction for {band}: {phrase!r}"
            for phrase in _BAND_CONTRADICTIONS.get(band, ())
            if phrase in lowered]


def _check_numbers(text: str) -> list[str]:
    stripped = text
    for allowed in _ALLOWED_NUMERIC:
        stripped = stripped.replace(allowed, "")
    return ["fabricated number in output"] if _DIGIT.search(stripped) else []


def _check_length(text: str) -> list[str]:
    problems: list[str] = []
    if len(text) > MAX_CHARS:
        problems.append(f"too long ({len(text)} chars)")
    sentences = [s for s in re.split(r"[.!?।]+", text) if s.strip()]
    if len(sentences) > MAX_SENTENCES:
        problems.append(f"too many sentences ({len(sentences)})")
    if not text.strip():
        problems.append("empty output")
    return problems


def validate_generation(text: str, payload: SLMInput) -> GuardrailResult:
    """Validate one SLM generation. On any violation, return the template instead.

    The returned object always carries usable text — callers never have to handle a
    failure path, which is the point: the explanation layer cannot break the session.
    """
    violations: list[str] = []
    violations += [f"forbidden: {t}" for t in contains_forbidden(text)]
    violations += _check_band_match(text, payload.band)
    violations += _check_numbers(text)
    violations += _check_length(text)

    if violations:
        fallback = render_template(
            payload.band,
            drivers=[(k, 0.0) for k in payload.driver_keys],
            confounders=payload.confounders,
            lang=payload.language,
            baseline_phase=payload.baseline_phase,
            improving=payload.improving,
            sustained=payload.sustained,
        )
        return GuardrailResult(text=fallback, source="template",
                               passed=False, violations=violations)

    return GuardrailResult(text=text.strip(), source="slm", passed=True)


def explain(payload: SLMInput, generate=None) -> GuardrailResult:
    """Produce a caregiver explanation, using the SLM when one is available.

    `generate` is an optional callable (system_prompt, user_prompt) -> str. In the PWA this
    is WebLLM running on the device; on the server it is normally absent, and the
    deterministic template is used. Either way the output is validated identically.
    """
    if generate is None:
        return GuardrailResult(
            text=render_template(
                payload.band,
                drivers=[(k, 0.0) for k in payload.driver_keys],
                confounders=payload.confounders,
                lang=payload.language,
                baseline_phase=payload.baseline_phase,
                improving=payload.improving,
                sustained=payload.sustained,
            ),
            source="template",
        )

    from .prompt import build_prompt

    try:
        system, user = build_prompt(payload)
        raw = generate(system, user)
    except Exception as exc:  # model missing, OOM, timeout — all degrade the same way
        result = validate_generation("", payload)
        result.violations.append(f"generation failed: {type(exc).__name__}")
        return result

    return validate_generation(raw or "", payload)


# The exact wording of the on-device indicator required by TRD §7.
ON_DEVICE_NOTICE = {
    "en": "generated on this device - no data left your phone",
    "hi": "इसी फ़ोन पर तैयार - कोई डेटा फ़ोन से बाहर नहीं गया",
    "pa": "ਇਸੇ ਫ਼ੋਨ 'ਤੇ ਤਿਆਰ - ਕੋਈ ਡਾਟਾ ਫ਼ੋਨ ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਗਿਆ",
}
