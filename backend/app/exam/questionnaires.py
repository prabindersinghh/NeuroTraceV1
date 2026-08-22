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


# --------------------------------------------------------------------------- DHI
#: Dizziness Handicap Inventory. 25 items, scored 0 (no) / 2 (sometimes) / 4 (yes).
#: Total 0-100. The subscales matter clinically: a patient can be barely impaired
#: physically and severely handicapped emotionally, and the intervention differs.
DHI_ITEMS = 25
DHI_PHYSICAL = (0, 3, 5, 10, 12, 13, 16)                      # 7 items
DHI_EMOTIONAL = (1, 8, 9, 14, 17, 19, 20, 21, 24)             # 9 items
DHI_FUNCTIONAL = (2, 4, 6, 7, 11, 15, 18, 22, 23)             # 9 items
#: Jacobson & Newman bands. 16 is the published minimum detectable change, so a total
#: below it is not read as handicap at all.
DHI_BANDS = [(0, 16, "none"), (16, 36, "mild"), (36, 54, "moderate"), (54, 101, "severe")]


def score_dhi(responses: list[int]) -> dict:
    """Score a DHI. Responses are 25 values in {0, 2, 4}.

    Added when the product's scope widened to posterior-circulation stroke: for a patient
    whose deficits are vertigo and imbalance, this is the closest thing to a functional
    outcome measure we have, and it is the number the treating clinician will already know.
    """
    if len(responses) != DHI_ITEMS:
        raise ValueError(f"DHI needs exactly {DHI_ITEMS} responses, got {len(responses)}")
    items = [int(r) for r in responses]
    if any(r not in (0, 2, 4) for r in items):
        raise ValueError("DHI responses must each be 0, 2 or 4")

    total = sum(items)
    band = next((name for lo, hi, name in DHI_BANDS if lo <= total < hi), "severe")
    return {
        "instrument": "DHI",
        "total": float(total),
        "physical": float(sum(items[i] for i in DHI_PHYSICAL)),
        "emotional": float(sum(items[i] for i in DHI_EMOTIONAL)),
        "functional": float(sum(items[i] for i in DHI_FUNCTIONAL)),
        "band": band,
        "escalate": False,
        # Stated so nobody reads a band change as a measured deterioration: the published
        # minimum detectable change is 18 points on the total.
        "note": ("Self-reported handicap, not a measurement of balance. A change under "
                 "18 points is within the instrument's own measurement error."),
    }


# --------------------------------------------------------------------------- vertigo log
#: An attack shorter than this is more likely a postural wobble than a vertigo episode.
VERTIGO_MIN_SECONDS = 10


def score_vertigo_log(attacks: list[dict]) -> dict:
    """Summarise a period of logged vertigo attacks.

    `attacks` = [{"ts": iso, "duration_seconds": int, "severity": 0-3} ...]

    Worth its own instrument because in the index case this single number moved long
    before anything else did: sixty attacks accumulated over months while every limb
    coordination test stayed normal. Attack frequency is the earliest thing a family can
    actually observe, and it costs them nothing to record.
    """
    valid = [
        a for a in attacks
        if float(a.get("duration_seconds") or 0) >= VERTIGO_MIN_SECONDS
    ]
    durations = [float(a["duration_seconds"]) for a in valid]
    severities = [float(a.get("severity") or 0) for a in valid]

    out = {
        "instrument": "VERTIGO_LOG",
        "attack_count": float(len(valid)),
        "total_minutes": float(sum(durations) / 60.0),
        "median_duration_seconds": float(sorted(durations)[len(durations) // 2])
        if durations else 0.0,
        "longest_seconds": float(max(durations)) if durations else 0.0,
        "mean_severity": float(sum(severities) / len(severities)) if severities else 0.0,
        "discarded_too_short": float(len(attacks) - len(valid)),
        "escalate": False,
    }
    # A single attack lasting over an hour is not the usual peripheral picture and is worth
    # a same-day conversation rather than a trend line.
    if out["longest_seconds"] > 3600:
        out["escalate"] = True
        out["note"] = ("An attack lasting over an hour is unusual. Please contact their "
                       "doctor today.")
    return out


# Registered after definition: the dispatch table above is declared before these scorers
# exist in the module body.
SCORERS["DHI"] = score_dhi


# --------------------------------------------------------------------------- hearing
#: Per-ear change, the only thing a caregiver can reliably judge without equipment.
HEARING_OPTIONS = {"better": -1, "same": 0, "worse": 1}

#: Amendment v3 E3. The reference patient's hearing was worse in BOTH ears, confirmed by
#: audiometry as well as by his own report — in a man with bilateral occipital and left
#: cerebellar infarcts. The vestibulocochlear nerve and the labyrinth share a blood supply
#: with the posterior circulation (AICA), so hearing change is a genuine posterior-territory
#: signal and not merely age.
#:
#: This is deliberately a THREE-OPTION question per ear, not a scale. A caregiver can tell
#: you whether their father hears the television better or worse than last month. They
#: cannot give you a decibel, and a five-point scale would invite them to invent precision.


def score_hearing_change(responses: dict) -> dict:
    """Monthly per-ear hearing change, caregiver-reported.

    `responses` = {"left": "better"|"same"|"worse", "right": ..., "aid_used": bool}

    NOT a hearing test. We make no measurement claim about hearing level — a phone speaker
    has no calibrated output and the ambient noise of a home is unknown. What we record is
    a family member's observation of change over time, which is a different and honest
    thing.
    """
    left = str(responses.get("left", "")).lower()
    right = str(responses.get("right", "")).lower()
    if left not in HEARING_OPTIONS or right not in HEARING_OPTIONS:
        raise ValueError("each ear must be one of: better, same, worse")

    l_val = HEARING_OPTIONS[left]
    r_val = HEARING_OPTIONS[right]
    worse_ears = sum(1 for v in (l_val, r_val) if v > 0)

    out = {
        "instrument": "HEARING",
        "left": float(l_val),
        "right": float(r_val),
        "worse_ears": float(worse_ears),
        # Asymmetric change is the more localising finding: one ear deteriorating points at
        # that side's cochlea or nerve, both ears together is more often age or medication.
        "asymmetric": float(l_val != r_val),
        "aid_used": float(bool(responses.get("aid_used"))),
        "escalate": False,
        "note": ("Reported hearing change, not a hearing test. NeuroTrace makes no "
                 "measurement claim about hearing level."),
    }

    # Sudden unilateral hearing loss is an emergency in its own right — it can be the
    # presenting sign of an AICA-territory infarct, and it has a treatment window.
    if out["asymmetric"] and worse_ears == 1:
        out["escalate"] = True
        out["note"] = ("Hearing has become worse in one ear only. Please contact their "
                       "doctor — sudden hearing loss on one side needs prompt assessment.")
    return out


SCORERS["HEARING"] = score_hearing_change
