"""Synthetic check-in generator, seed=42.

`reference_*` reproduces ml/test_sim.py exactly — same keys, same normals, same RNG call
order — so the ported alert gate can be asserted against the verified reference behaviour.
`full_*` uses the complete SPEECH/FACE/REACTION scoring key sets and is what the database
level pipeline test feeds through compute_checkin.
"""
from __future__ import annotations

import numpy as np

# ------------------------------------------------------------------ reference (ml/test_sim.py)
VK = ["pause_ratio", "n_pauses_per_sec", "articulation_rate", "jitter_local",
      "shimmer_local", "hnr", "f0_cv"]
FK = ["mouth_symmetry_mean", "corner_drop_mean", "eye_asymmetry_mean",
      "brow_asymmetry_mean", "landmark_tremor"]
RK = ["rt_median", "rt_cov", "lapse_rate", "attention_decay_slope", "miss_rate"]

NORM = {
    "pause_ratio": 0.25, "n_pauses_per_sec": 0.8, "articulation_rate": 4.2,
    "jitter_local": 0.012, "shimmer_local": 0.05, "hnr": 18.0, "f0_cv": 0.15,
    "mouth_symmetry_mean": 0.04, "corner_drop_mean": 0.02, "eye_asymmetry_mean": 0.05,
    "brow_asymmetry_mean": 0.03, "landmark_tremor": 0.002,
    "rt_median": 420, "rt_cov": 0.18, "lapse_rate": 0.05,
    "attention_decay_slope": 0.5, "miss_rate": 0.03,
}

# 4 baseline days, then 3 stable days, then 3 days of worsening decline.
PLAN = [("stable", 0.0)] * 3 + [("decline", 1.0), ("decline", 1.6), ("decline", 2.2)]
BASELINE_DAY_COUNT = 4

# Features that get WORSE by going down; everything else worsens by going up.
_DOWN_IS_BAD_REFERENCE = ("hnr", "articulation_rate")


def make_rng(seed: int = 42) -> np.random.Generator:
    return np.random.default_rng(seed)


def _day(rng, keys, norms, drift: float, down_is_bad) -> dict:
    d = {"valid": 1.0}
    for k in keys:
        base = norms[k]
        noise = rng.normal(0, abs(base) * 0.05)
        sign = -1.0 if k in down_is_bad else 1.0
        d[k] = base + noise + sign * drift * abs(base) * 0.55
    return d


def reference_day(rng, keys, drift: float = 0.0) -> dict:
    return _day(rng, keys, NORM, drift, _DOWN_IS_BAD_REFERENCE)


__all__ = ["FK", "NORM", "PLAN", "RK", "VK", "make_rng", "reference_day"]
