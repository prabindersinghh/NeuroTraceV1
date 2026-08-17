"""
NeuroTrace — fusion + Neurological Stability Score + alert gate.
S = 100 * scaled_sigmoid(w_v*d_v + w_f*d_f + w_r*d_r)
Alert requires >=2 modalities above threshold, sustained over a rolling window.
This cross-validation is what kills false alarms.
"""
from __future__ import annotations
import numpy as np

W = {"voice": 1.0, "face": 1.0, "reaction": 1.0}   # equal default weights
DEV_THRESHOLD = 2.0        # per-modality "this is drifting" gate (in mean-|z|)
SUSTAIN_DAYS = 3           # must persist this many days
MIN_MODALITIES = 2         # cross-validation requirement

BANDS = [(0, 40, "STABLE"), (40, 70, "WATCH"), (70, 101, "ALERT")]

def quality_weights(valid_flags: dict) -> dict:
    """Drop modalities whose capture failed; renormalise the rest."""
    w = {m: (W[m] if valid_flags.get(m, False) else 0.0) for m in W}
    tot = sum(w.values())
    if tot <= 0:
        return {m: 0.0 for m in W}
    return {m: w[m] / tot * len(W) for m in w}     # keep scale comparable

def stability_score(devs: dict, valid_flags: dict) -> float:
    """devs: {'voice':d_v,'face':d_f,'reaction':d_r} -> 0..100 (higher = worse)."""
    w = quality_weights(valid_flags)
    combined = sum(w.get(m, 0.0) * float(devs.get(m, 0.0)) for m in W)
    combined /= max(1e-6, sum(w.values()))          # weighted mean of deviations
    # map mean-|z| ~[0..4] onto 0..100 with a sigmoid centred at ~2.0
    s = 100.0 / (1.0 + np.exp(-1.6 * (combined - 2.0)))
    return float(np.clip(s, 0, 100))

def band_for(score: float) -> str:
    for lo, hi, name in BANDS:
        if lo <= score < hi:
            return name
    return "STABLE"

def alert_decision(history: list[dict]) -> dict:
    """
    history: chronological list of {'devs':{...}} for the last N days (most recent last).
    Returns final band after applying the sustained + cross-modality gate.
    """
    if not history:
        return {"band": "STABLE", "reason": "no data", "modalities_flagged": []}

    today = history[-1]
    score = today.get("score", 0.0)
    raw_band = band_for(score)

    window = history[-SUSTAIN_DAYS:]
    flagged = []
    for m in W:
        # modality must be above threshold on EVERY day in the window
        if len(window) >= SUSTAIN_DAYS and all(
            float(d.get("devs", {}).get(m, 0.0)) > DEV_THRESHOLD for d in window
        ):
            flagged.append(m)

    if len(flagged) >= MIN_MODALITIES:
        return {"band": "ALERT", "reason": f"{len(flagged)} signals deviating "
                f"{SUSTAIN_DAYS}+ days", "modalities_flagged": flagged}

    # Not enough cross-validation -> cap at WATCH even if today's score is high
    if raw_band == "ALERT":
        return {"band": "WATCH", "reason": "single-signal or unsustained deviation",
                "modalities_flagged": flagged}
    return {"band": raw_band, "reason": "within normal variation",
            "modalities_flagged": flagged}
