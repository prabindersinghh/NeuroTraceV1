"""SLM input construction — TRD §7.

The input schema is the guardrail. `SLMInput` is the *only* thing the model ever sees, and
it contains no raw feature, no z-score, no threshold and no number it could reason about
numerically. The band has already been decided; the model is told what it is and asked to
phrase it.

If a future change adds a field here, that change is a safety change and needs the
guardrail tests re-read, not just re-run.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .templates import phrase_for

MAX_DRIVERS = 3

SYSTEM_PROMPT = """You write short, calm messages for the family of a stroke survivor being monitored at home.

Rules you must never break:
- Write two or three short sentences. Nothing longer.
- Use only the observations you are given. Never invent a finding.
- Never name or suggest any disease or condition. Never use the words "stroke" or "diagnosis".
- Never claim the person is well. Do not reassure. Describe only what was observed.
- Never give a number, a score, a percentage or a threshold.
- Never tell them to ignore anything or to wait.
- Write plainly, as you would speak to a worried adult child. No medical jargon.
"""

_BAND_INSTRUCTION = {
    "STABLE": "Today matched their usual pattern. Say so calmly, without claiming they are well.",
    "WATCH": "Something looked slightly different. Say it is worth watching, and that you will keep monitoring.",
    "ALERT": "Several things changed together over more than one day. Ask them to check on the person today and to consider contacting their doctor.",
    # Without its own entry this fell through to STABLE - producing calm reassurance for a
    # progressive finding, which is the opposite of what the reader needs.
    "PATTERN_ATYPICAL": (
        "Face, movement and voice have all changed together and evenly on both sides. "
        "Say the changes do not look one-sided, that this system watches for one-sided "
        "changes, and that they should discuss other causes with their doctor. Do not "
        "reassure them that nothing has changed, and do not mention stroke."
    ),
}

_LANG_NAME = {"en": "English", "hi": "Hindi", "pa": "Punjabi"}


@dataclass(slots=True)
class SLMInput:
    """Everything, and only, what the model receives."""

    band: str
    drivers: list[str] = field(default_factory=list)          # English phrases, for the model
    driver_keys: list[str] = field(default_factory=list)      # feature keys, for the fallback
    confounders: list[str] = field(default_factory=list)
    language: str = "en"
    baseline_phase: bool = False
    improving: bool = False
    sustained: bool = False

    def to_json(self) -> dict:
        return {
            "band": self.band,
            "drivers": self.drivers,
            "driver_keys": self.driver_keys,
            "confounders": self.confounders,
            "language": self.language,
            "baseline_phase": self.baseline_phase,
            "improving": self.improving,
            "sustained": self.sustained,
        }


def build_slm_input(
    band: str,
    drivers: list[tuple[str, float]] | None,
    confounders: list[str] | None,
    language: str = "en",
    *,
    baseline_phase: bool = False,
    improving: bool = False,
    sustained: bool = False,
) -> SLMInput:
    """Convert engine output into model input, dropping every magnitude on the way.

    Note what is discarded here: the z-score attached to each driver. The model is told
    *which* observations changed, never *by how much*, because "by how much" is exactly
    the kind of quantity it might restate incorrectly.
    """
    phrases: list[str] = []
    keys: list[str] = []
    for feature, _magnitude in (drivers or [])[:MAX_DRIVERS]:
        phrase = phrase_for(feature, "en")   # model reasons in English, renders in `language`
        if phrase:
            phrases.append(phrase)
            keys.append(feature)

    return SLMInput(
        band=band,
        drivers=phrases,
        driver_keys=keys,
        confounders=list(confounders or []),
        language=language if language in _LANG_NAME else "en",
        baseline_phase=baseline_phase,
        improving=improving,
        sustained=sustained,
    )


def build_prompt(payload: SLMInput) -> tuple[str, str]:
    """Return (system_prompt, user_prompt)."""
    lines = [f"Situation: {_BAND_INSTRUCTION.get(payload.band, _BAND_INSTRUCTION['STABLE'])}"]

    if payload.baseline_phase:
        lines.append(
            "We are still learning this person's usual pattern, so today was recorded "
            "but not compared. Say that plainly."
        )
    if payload.drivers:
        lines.append("Observations from today:")
        lines.extend(f"- {d}" for d in payload.drivers)
    else:
        lines.append("No specific observation stood out today.")

    if payload.improving:
        lines.append("These changes are in the direction of improvement. Say so.")
    if payload.sustained:
        lines.append("These changes have continued across more than one day and more than one kind of check.")
    if payload.confounders:
        from ..engine.confounders import describe
        labels = describe(payload.confounders, "en")
        if labels:
            lines.append("Mention that these could also explain what we saw:")
            lines.extend(f"- {label}" for label in labels)

    lines.append(f"\nWrite the message in {_LANG_NAME[payload.language]}.")
    return SYSTEM_PROMPT, "\n".join(lines)
