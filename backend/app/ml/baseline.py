"""
NeuroTrace — per-patient baseline. Core philosophy: no population thresholds.
We learn THIS patient's normal over the first N valid days, then measure deviation from it.
"""
from __future__ import annotations
import numpy as np

BASELINE_DAYS = 4          # 3-5 per PRD; 4 is the default
MIN_STD = 1e-3             # floor so a flat feature can't explode z-scores

def build_baseline(daily_feature_dicts: list[dict], keys: list[str]) -> dict:
    """daily_feature_dicts: one dict per baseline day for ONE modality."""
    valid = [d for d in daily_feature_dicts if d.get("valid", 0.0) == 1.0]
    if len(valid) < 2:
        return {"ready": False, "n_days": len(valid), "mean": {}, "std": {}}

    mean, std = {}, {}
    for k in keys:
        vals = np.array([float(d.get(k, 0.0)) for d in valid], dtype=float)
        vals = vals[np.isfinite(vals)]
        if vals.size == 0:
            mean[k], std[k] = 0.0, MIN_STD
            continue
        mean[k] = float(np.mean(vals))
        # robust-ish std; floor prevents divide-by-zero blowups
        std[k] = float(max(np.std(vals), MIN_STD, abs(mean[k]) * 0.02))
    return {"ready": len(valid) >= min(3, BASELINE_DAYS), "n_days": len(valid),
            "mean": mean, "std": std}

def z_scores(features: dict, baseline: dict, keys: list[str]) -> dict:
    """Per-feature z vs the patient's own baseline."""
    if not baseline.get("ready"):
        return {}
    m, s = baseline["mean"], baseline["std"]
    out = {}
    for k in keys:
        if k not in m:
            continue
        x = float(features.get(k, m[k]))
        out[k] = float((x - m[k]) / (s[k] + 1e-9))
    return out

def modality_deviation(zs: dict, clip: float = 6.0) -> float:
    """d_m = mean(|z|), clipped so one crazy feature can't dominate."""
    if not zs:
        return 0.0
    v = np.clip(np.abs(np.array(list(zs.values()), dtype=float)), 0, clip)
    return float(np.mean(v))
