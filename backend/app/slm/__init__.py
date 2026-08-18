"""On-device explanation layer — TRD §7.

The contract, and the reason it is written this way:

**The SLM writes text. It does not think.** It never receives a raw feature, never sees a
number it could reason about, and never decides anything. Its entire input is
`{band, top_drivers, confounders, language}` — all of which were already computed by the
deterministic engine. Its entire job is to turn that structured verdict into two sentences
a worried family member can act on, in their own language.

This is not caution for its own sake. A 1B-parameter quantised model running offline on a
₹12,000 phone will occasionally produce confident nonsense. If that model were anywhere in
the decision path, the decision would inherit the nonsense. By constraining it to
rendering, the worst failure mode is an awkward sentence — and even that is caught, because
every generation is validated against the engine's band and the forbidden-token list before
it is shown. On any failure we fall back to a deterministic template that always renders.

`templates.py` is therefore not a stub. It is the guaranteed path, and the SLM is the
enhancement.
"""
from .guardrail import GuardrailResult, GuardrailViolation, validate_generation
from .prompt import SLMInput, build_prompt
from .templates import render_template

__all__ = [
    "GuardrailResult", "GuardrailViolation", "SLMInput",
    "build_prompt", "render_template", "validate_generation",
]
