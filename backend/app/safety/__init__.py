"""The safety layer — TRD §8. Unconditional, and deliberately dumb.

Three rules, none of which may be made conditional on a model, a score or a band:

1. **A FAST card renders at the end of every session and on every dashboard.** Not when
   the band is high — always. The whole point is that our system explicitly cannot detect
   an acute stroke (PRD §3: acute events evolve in seconds; our logic works over days), so
   the human-recognisable warning signs have to be in front of the family regardless of
   what we computed.

2. **An acute symptom report bypasses everything.** It does not get scored, gated,
   explained or banded. It returns an escalation immediately. Running our pipeline on an
   acute presentation would add latency to an emergency in exchange for nothing.

3. **Nothing may assert wellness.** "You are fine", "all clear", "normal, no action" are
   forbidden strings. A system that says "you are fine" to someone having a stroke it
   structurally cannot see has caused harm. `test_safety.py` greps for these.
"""
from .fast import FAST_CARD, fast_card
from .guards import (
    FORBIDDEN_SUBSTRINGS,
    WELLNESS_ASSERTIONS,
    SafetyViolation,
    assert_no_wellness_assertion,
    contains_forbidden,
    scrub,
)
from .acute import ACUTE_SYMPTOMS, EscalationResponse, build_escalation

__all__ = [
    "ACUTE_SYMPTOMS", "FAST_CARD", "FORBIDDEN_SUBSTRINGS", "WELLNESS_ASSERTIONS",
    "EscalationResponse", "SafetyViolation", "assert_no_wellness_assertion",
    "build_escalation", "contains_forbidden", "fast_card", "scrub",
]
