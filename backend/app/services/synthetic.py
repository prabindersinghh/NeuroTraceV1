"""Synthetic feature generator for demo seeding, seed=42.

Produces feature dicts covering every key in SPEECH/FACE/REACTION_SCORING_KEYS with a
realistic per-day noise floor, plus a `drift` dial that pushes each feature in its
clinically bad direction. The demo history is generated, not recorded, so the pitch demo
loads instantly instead of waiting on ten webcam sessions.

Tests import FULL_NORM / synthetic_day from here so there is one source of truth.
"""
from __future__ import annotations

import numpy as np

# Per-feature "normal" for a plausible 67-year-old post-stroke patient.
FULL_NORM: dict[str, float] = {
    # voice — SPEECH_SCORING_KEYS
    "jitter_local": 0.012, "shimmer_local": 0.05, "hnr": 18.0,
    "pause_ratio": 0.25, "n_pauses_per_sec": 0.8, "articulation_rate": 4.2,
    "f0_cv": 0.15, "f0_std": 22.0, "spec_centroid": 1800.0,
    "mfcc1_mean": -320.0, "mfcc2_mean": 95.0, "mfcc3_mean": -12.0, "mfcc4_mean": 18.0,
    # face — FACE_SCORING_KEYS
    "mouth_symmetry_mean": 0.04, "corner_drop_mean": 0.02, "eye_asymmetry_mean": 0.05,
    "brow_asymmetry_mean": 0.03, "landmark_tremor": 0.002, "blink_rate_per_frame": 0.035,
    "mouth_symmetry_std": 0.01, "ear_left_mean": 0.28, "ear_right_mean": 0.27,
    # reaction — REACTION_SCORING_KEYS
    "rt_median": 420.0, "rt_cov": 0.18, "rt_iqr": 90.0, "lapse_rate": 0.05,
    "attention_decay_slope": 0.5, "fatigue_delta": 15.0, "miss_rate": 0.03,
}

# Features that get WORSE by going DOWN. Everything else worsens by going up.
DOWN_IS_BAD = ("hnr", "articulation_rate", "blink_rate_per_frame", "ear_left_mean", "ear_right_mean")

DAY_NOISE = 0.05     # 5% day-to-day variation -> a realistic personal baseline spread
DRIFT_GAIN = 0.55    # how hard one unit of drift pushes a feature


def make_rng(seed: int = 42) -> np.random.Generator:
    return np.random.default_rng(seed)


def synthetic_day(rng: np.random.Generator, keys: list[str], drift: float = 0.0) -> dict:
    """One modality's features for one day. `drift` 0 = normal, 2.2 = clearly declining."""
    day = {"valid": 1.0}
    for key in keys:
        base = FULL_NORM[key]
        noise = rng.normal(0.0, abs(base) * DAY_NOISE)
        sign = -1.0 if key in DOWN_IS_BAD else 1.0
        day[key] = base + noise + sign * drift * abs(base) * DRIFT_GAIN
    return day


# The ten-day demo story: 4 baseline, 3 stable, 3 escalating decline.
DEMO_PLAN: list[tuple[str, float]] = (
    [("baseline", 0.0)] * 4 + [("stable", 0.0)] * 3 + [("decline", 1.0), ("decline", 1.6), ("decline", 2.2)]
)
