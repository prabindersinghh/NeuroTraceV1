"""Synthetic exam-module features for demo seeding and simulation, seed=42.

Produces a plausible feature vector for any module in the registry, with a `drift` dial
that pushes each feature in its clinically worse direction.

Day-to-day noise is deliberately generous (6% of each feature's normal value). A tighter
noise floor would make the demo look better — deviations would be enormous the moment
drift begins — but it would also be dishonest, because a real patient's day-to-day spread
is what determines whether this system can distinguish signal from a bad morning. The
demo is set at a spread we would actually expect to see.
"""
from __future__ import annotations

import numpy as np

from ..engine.baseline import DISCARD_FIRST_N_SESSIONS, LOCK_AT_N_SESSIONS
from ..exam.registry import MODULES

# Plausible values for a 67-year-old, five months after a left MCA infarct with residual
# right facial weakness and mild dysarthria. Asymmetry features are non-zero at baseline
# because that IS his baseline — which is the entire point of a personal baseline.
NORMALS: dict[str, float] = {
    # --- M1 facial ---
    "mouth_corner_symmetry": 0.085, "corner_drop": 0.031, "nasolabial_ratio": 0.072,
    "forehead_movement_symmetry": 0.021, "central_pattern_index": 0.064,
    "eye_aperture_L": 0.284, "eye_aperture_R": 0.271, "ear_asymmetry": 0.047,
    "eye_closure_asymmetry": 0.038, "blink_asymmetry": 0.091,
    "landmark_tremor": 0.0021, "mouth_corner_symmetry_std": 0.014,
    # --- M4 dysarthria ---
    "jitter_local": 0.0138, "shimmer_local": 0.058, "hnr": 16.4,
    "max_phonation_time": 9.2, "sustained_f0_cv": 0.041,
    "sustained_jitter_proxy": 0.0125, "phonation_rms_cv": 0.134,
    "ddk_rate": 4.9, "ddk_regularity": 0.148, "ddk_decay_slope": 0.0032,
    "articulation_rate": 3.8, "pause_ratio": 0.288, "n_pauses_per_sec": 0.92,
    "f0_cv": 0.163, "spec_centroid": 1712.0,
    "mfcc1_mean": -318.0, "mfcc2_mean": 92.0, "mfcc3_mean": -13.5, "mfcc4_mean": 17.2,
    # --- M7 fine motor ---
    "tap_rate_L": 5.1, "tap_rate_R": 4.2, "tap_asymmetry_ratio": 0.097,
    "inter_tap_cv_L": 0.176, "inter_tap_cv_R": 0.229, "tap_cv_asymmetry": 0.131,
    "decrement_slope_L": 0.85, "decrement_slope_R": 1.42,
    "tap_rate_mean": 4.65, "drag_error_mean": 11.8, "drag_error_cv": 0.31,
    # --- M10 attention ---
    "rt_median": 468.0, "rt_cov": 0.196, "rt_iqr": 104.0, "lapse_rate": 0.058,
    "miss_rate": 0.031, "attention_decay_slope": 1.9, "fatigue_delta": 17.5,
    "choice_rt_median": 712.0, "choice_rt_cov": 0.221, "choice_accuracy": 0.93,
    "decision_cost_ms": 244.0, "tmt_a_seconds": 41.5,
    # --- M13 mood ---
    "phq2_score": 1.4,
    # --- M19 adherence ---
    "adherence_rate_30d": 0.93,
    # --- M2 tongue ---
    "tongue_deviation_abs": 4.1, "tongue_protrusion_length": 0.089,
    "palate_phonation_time": 8.8, "palate_f0_cv": 0.046, "nasality_index": 0.213,
    # --- M5 aphasia ---
    "words_per_min": 96.0, "type_token_ratio": 0.61, "mean_length_utterance": 7.4,
    "naming_accuracy": 0.86, "word_finding_latency": 1480.0,
    "word_finding_latency_cv": 0.34, "repetition_accuracy": 0.91,
    "comprehension_score": 0.95, "fluency_count": 13.0, "fluency_decay_ratio": 0.62,
    # --- M6 pronator ---
    "vertical_drift_L": 0.014, "vertical_drift_R": 0.038, "drift_asymmetry": 0.171,
    "pronation_angle_L": 3.2, "pronation_angle_R": 6.8, "pronation_asymmetry": 0.196,
    "wrist_instability_L": 0.0071, "wrist_instability_R": 0.0094, "max_drift": 0.038,
    # --- M8 coordination ---
    "endpoint_accuracy": 14.2, "endpoint_variability": 4.6, "movement_smoothness": 82.0,
    "reach_duration_mean": 1.28, "alternation_rate": 2.7, "dysdiadochokinesia": 0.24,
    # --- M9 gait ---
    "tug_seconds": 13.6, "cadence": 96.0, "step_symmetry": 0.86,
    "gait_variability": 0.129, "sway_area": 4.9, "sway_velocity": 1.7,
    # --- M11 memory ---
    "recall_immediate": 4.2, "recall_delayed": 3.4, "retention_ratio": 0.81,
    "span_forward": 5.1, "span_backward": 3.3, "span_gap": 1.8,
    "tmt_b_seconds": 108.0, "tmt_b_minus_a": 66.5, "clock_score": 8.4,
    # --- M12 neglect ---
    "bisection_deviation_abs": 0.041, "bisection_variability": 0.019,
    "left_omission_rate": 0.032, "right_omission_rate": 0.027, "omission_asymmetry": 0.021,
    # --- M3 ocular ---
    "pursuit_error_mean": 0.037, "pursuit_error_cv": 0.28, "pursuit_smoothness": 0.71,
    "saccadic_intrusions": 3.1, "field_defect_count": 0.0, "field_asymmetry": 0.0,
    # --- M14/M15/M16 ---
    "fss_mean": 3.9, "barthel_score": 85.0, "eat10_score": 2.1,
    # --- M17/M18 vitals ---
    "mean_hr": 74.0, "sdnn": 38.0, "rmssd": 27.0, "pnn50": 0.061,
    "rr_irregularity_index": 0.033, "poincare_sd1": 19.1, "poincare_sd2": 49.0,
    "poincare_ratio": 0.39, "bp_sys": 138.0, "bp_dia": 84.0, "pulse_pressure": 54.0,
}

DAY_NOISE = 0.06
DRIFT_GAIN = 0.55


def make_rng(seed: int = 42) -> np.random.Generator:
    return np.random.default_rng(seed)


def synthetic_module(rng: np.random.Generator, module_code: str,
                     drift: float = 0.0) -> dict[str, float]:
    """One module's features for one session.

    `drift` 0 = a normal day for this patient; 2.5 = clearly and consistently worse.
    Each feature moves in the direction its module declares clinically worse, so the
    engine's IMPROVING logic can be exercised by passing a negative drift.
    """
    module = MODULES[module_code]
    bad = module.bad_direction
    out: dict[str, float] = {"valid": 1.0}

    for key in module.scoring_keys:
        base = NORMALS.get(key)
        if base is None:
            continue
        noise = rng.normal(0.0, abs(base) * DAY_NOISE)
        sign = -1.0 if bad.get(key) == "down" else 1.0
        out[key] = float(base + noise + sign * drift * abs(base) * DRIFT_GAIN)
    return out


def synthetic_session(rng: np.random.Generator, module_codes: list[str],
                      drift: float = 0.0,
                      drift_modules: list[str] | None = None) -> dict[str, dict]:
    """A whole session's modules.

    `drift_modules` limits the decline to specific modules — used to prove that a single
    deviating domain produces WATCH and never ALERT, which is the behaviour Gate 2 exists
    to guarantee.
    """
    out: dict[str, dict] = {}
    for code in module_codes:
        module_drift = drift
        if drift_modules is not None and code not in drift_modules:
            module_drift = 0.0
        out[code] = synthetic_module(rng, code, module_drift)
    return out


# The 21-day demo story: baseline, then stable, then an escalating decline.
#
# The baseline length is DERIVED, not written down. A module locks at LOCK_AT_N_SESSIONS
# *retained* sessions, and the first DISCARD_FIRST_N_SESSIONS are discarded for practice
# effect, so scoring cannot begin until 15 daily sessions have been recorded. Hard-coding
# "14 baseline days" — as the build plan does — would leave the first two "stable" days
# still baselining, and the demo would silently show no verdict where the script promises
# one. Deriving it keeps the story and the engine in step if either constant ever changes.
BASELINE_DAYS: int = DISCARD_FIRST_N_SESSIONS + LOCK_AT_N_SESSIONS
STABLE_DAYS: int = 3
DECLINE_DRIFTS: tuple[float, ...] = (1.6, 2.2, 2.8)

DEMO_PLAN: list[tuple[str, float]] = (
    [("baseline", 0.0)] * BASELINE_DAYS
    + [("stable", 0.0)] * STABLE_DAYS
    + [("decline", d) for d in DECLINE_DRIFTS]
)
