"""
NeuroTrace — reaction/cognition features from the browser tap game.
Stroke-relevant: slowed processing speed, increased variability (CoV is the most sensitive
marker of cognitive decline), attention lapses, and fatigue across the trial run.
Input: {"latencies_ms":[...], "misses":int, "false_starts":int}
"""
from __future__ import annotations
import numpy as np

def _safe(v, d=0.0):
    try:
        f = float(v)
        return f if np.isfinite(f) else d
    except Exception:
        return d

def extract_reaction_features(payload: dict) -> dict:
    lat = np.array([x for x in payload.get("latencies_ms", []) if x and x > 80], dtype=float)
    misses = float(payload.get("misses", 0) or 0)
    false_starts = float(payload.get("false_starts", 0) or 0)

    if lat.size < 4:
        return {"valid": 0.0, "n_trials": float(lat.size)}

    med = float(np.median(lat))
    q75, q25 = np.percentile(lat, [75, 25])
    iqr = float(q75 - q25)
    cov = float(np.std(lat) / (np.mean(lat) + 1e-6))     # variability > raw speed
    lapses = float(np.sum(lat > med * 2.0))              # attention lapses

    # Fatigue: does RT drift upward across the run?
    x = np.arange(lat.size, dtype=float)
    slope = float(np.polyfit(x, lat, 1)[0]) if lat.size >= 5 else 0.0

    # Best/worst split — early vs late half
    half = lat.size // 2
    first, second = float(np.median(lat[:half])), float(np.median(lat[half:]))

    return {
        "valid": 1.0,
        "n_trials": float(lat.size),
        "rt_median": _safe(med),
        "rt_mean": _safe(np.mean(lat)),
        "rt_std": _safe(np.std(lat)),
        "rt_iqr": _safe(iqr),
        "rt_cov": _safe(cov),
        "rt_min": _safe(np.min(lat)),
        "rt_max": _safe(np.max(lat)),
        "lapse_count": _safe(lapses),
        "lapse_rate": _safe(lapses / lat.size),
        "attention_decay_slope": _safe(slope),
        "fatigue_delta": _safe(second - first),
        "miss_rate": _safe(misses / max(1.0, lat.size + misses)),
        "false_start_rate": _safe(false_starts / max(1.0, lat.size)),
    }

REACTION_SCORING_KEYS = [
    "rt_median", "rt_cov", "rt_iqr", "lapse_rate",
    "attention_decay_slope", "fatigue_delta", "miss_rate",
]
