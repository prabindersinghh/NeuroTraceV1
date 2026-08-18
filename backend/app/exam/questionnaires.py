"""M13 depression · M14 fatigue · M15 function · M16 dysphagia — Domain F.

Clinical rationale
------------------
These four instruments are not decoration. Each is standard, validated, and each also acts
as a **confounder detector** for the rest of the battery:

* **PHQ-2 / PHQ-9** — post-stroke depression affects 11-41%. Depression slows reaction
  time, flattens prosody and reduces speech output. Without measuring mood, a depressive
  episode is indistinguishable from neurological decline on every other module in this
  system. That is why a PHQ shift is wired into `confounders.py`.
* **Fatigue Severity Scale** — post-stroke fatigue is extremely common and independently
  degrades every timed task.
* **Barthel Index** — functional independence; the outcome families actually care about.
* **EAT-10** — dysphagia screening. A score >= 3 is the validated threshold for aspiration
  risk, which is a genuine mortality driver, so this one carries a direct advisory.

Scoring is arithmetic on validated instruments. We report the score and the standard
threshold; we do not diagnose from it.
"""
from __future__ import annotations

import numpy as np

# --- PHQ-2 / PHQ-9 (Kroenke et al.) ---
PHQ2_POSITIVE_THRESHOLD = 3          # >= 3 triggers the full PHQ-9
PHQ9_BANDS = [(0, 5, "minimal"), (5, 10, "mild"), (10, 15, "moderate"),
              (15, 20, "moderately severe"), (20, 28, "severe")]
PHQ9_ITEM9_INDEX = 8                 # self-harm item — always escalates

# --- Fatigue Severity Scale ---
FSS_ITEMS = 9
FSS_POSITIVE_THRESHOLD = 4.0         # mean item score >= 4 indicates significant fatigue

# --- Barthel Index ---
BARTHEL_MAX = 100

# --- EAT-10 ---
EAT10_ITEMS = 10
EAT10_POSITIVE_THRESHOLD = 3         # >= 3 indicates possible swallowing problem


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def score_phq2(responses: list[int]) -> dict:
    """Two items, each 0-3. Screens for the need to administer PHQ-9."""
    if len(responses or []) < 2:
        return {"valid": 0.0}
    items = [int(r) for r in responses[:2]]
    total = sum(items)
    return {
        "valid": 1.0,
        "instrument": "PHQ2",
        "phq2_score": float(total),
        "phq2_positive": 1.0 if total >= PHQ2_POSITIVE_THRESHOLD else 0.0,
        "escalate_to_phq9": total >= PHQ2_POSITIVE_THRESHOLD,
    }


def score_phq9(responses: list[int]) -> dict:
    """Nine items, each 0-3.

    Item 9 (thoughts of self-harm) is handled separately and unconditionally: any non-zero
    response escalates regardless of the total, because a low total with a positive item 9
    is still an emergency.
    """
    if len(responses or []) < 9:
        return {"valid": 0.0}
    items = [int(r) for r in responses[:9]]
    total = sum(items)
    band = next((name for lo, hi, name in PHQ9_BANDS if lo <= total < hi), "severe")
    self_harm = items[PHQ9_ITEM9_INDEX] > 0
    return {
        "valid": 1.0,
        "instrument": "PHQ9",
        "phq9_score": float(total),
        "phq9_band": band,
        "phq9_self_harm_flag": 1.0 if self_harm else 0.0,
        "requires_urgent_review": self_harm,
    }


def score_fss(responses: list[int]) -> dict:
    """Nine items, each 1-7. Reported as the mean item score, per the instrument."""
    if len(responses or []) < FSS_ITEMS:
        return {"valid": 0.0}
    items = [float(r) for r in responses[:FSS_ITEMS]]
    mean = float(np.mean(items))
    return {
        "valid": 1.0,
        "instrument": "FSS",
        "fss_mean": _safe(mean),
        "fss_total": _safe(sum(items)),
        "fss_positive": 1.0 if mean >= FSS_POSITIVE_THRESHOLD else 0.0,
    }


def score_barthel(responses: dict[str, int]) -> dict:
    """Ten weighted activities of daily living, 0-100."""
    if not responses:
        return {"valid": 0.0}
    total = float(sum(int(v) for v in responses.values()))
    total = max(0.0, min(BARTHEL_MAX, total))
    if total >= 90:
        dependency = "independent"
    elif total >= 60:
        dependency = "minimally dependent"
    elif total >= 40:
        dependency = "partially dependent"
    else:
        dependency = "very dependent"
    return {
        "valid": 1.0,
        "instrument": "BARTHEL",
        "barthel_score": total,
        "barthel_dependency": dependency,
    }


def score_eat10(responses: list[int]) -> dict:
    """Ten items, each 0-4. >= 3 is the validated aspiration-risk threshold."""
    if len(responses or []) < EAT10_ITEMS:
        return {"valid": 0.0}
    items = [int(r) for r in responses[:EAT10_ITEMS]]
    total = float(sum(items))
    return {
        "valid": 1.0,
        "instrument": "EAT10",
        "eat10_score": total,
        "eat10_positive": 1.0 if total >= EAT10_POSITIVE_THRESHOLD else 0.0,
        # Advisory, not a diagnosis — the wording is deliberate.
        "advisory": (
            "swallowing difficulty reported — worth raising with the treating doctor"
            if total >= EAT10_POSITIVE_THRESHOLD else ""
        ),
    }


SCORERS = {
    "PHQ2": score_phq2,
    "PHQ9": score_phq9,
    "FSS": score_fss,
    "BARTHEL": score_barthel,
    "EAT10": score_eat10,
}


def score_instrument(instrument: str, responses) -> dict:
    scorer = SCORERS.get(instrument.upper())
    if scorer is None:
        return {"valid": 0.0, "error": f"unknown instrument {instrument}"}
    return scorer(responses)


MOOD_SCORING_KEYS = ["phq2_score", "phq9_score"]
FATIGUE_SCORING_KEYS = ["fss_mean"]
FUNCTION_SCORING_KEYS = ["barthel_score"]
DYSPHAGIA_SCORING_KEYS = ["eat10_score"]

MOOD_BAD_DIRECTION = {"phq2_score": "up", "phq9_score": "up"}
FATIGUE_BAD_DIRECTION = {"fss_mean": "up"}
FUNCTION_BAD_DIRECTION = {"barthel_score": "down"}
DYSPHAGIA_BAD_DIRECTION = {"eat10_score": "up"}
