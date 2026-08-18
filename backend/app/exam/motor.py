"""M6 · pronator drift and M7 · fine motor — Domain C. M6 maps to NIHSS item 5.

Clinical rationale
------------------
**Pronator drift** is the most sensitive bedside test for mild pyramidal weakness. Arms
outstretched, palms up, eyes closed: a subtly weak arm drifts *downward* and *pronates*
(the palm rotates inward) because the supinators fatigue before the pronators. Eyes closed
matters — visual feedback lets a patient correct the drift and hides the sign.

**Fine motor tapping** carries the single most important discriminator in this whole
battery: the **asymmetry ratio**.

Bilateral slowing of finger tapping is the signature of Parkinson's disease and of normal
ageing. *Unilateral* slowing is the signature of a corticospinal lesion. A monitoring
product that reports "tapping has slowed" without saying which hand is worse than the
other will generate a stream of alerts on every ageing patient in the cohort. Reporting
the left-right ratio, measured against that patient's own baseline ratio, is what makes
the finding specific.

`03_DATASETS_v2.md` proposes validating exactly this against mPower (Parkinson's tapping),
which should show preserved symmetry while stroke shows asymmetry.
"""
from __future__ import annotations

import numpy as np

# MediaPipe Pose landmark indices
L_WRIST, R_WRIST = 15, 16
L_ELBOW, R_ELBOW = 13, 14
L_SHOULDER, R_SHOULDER = 11, 12
L_INDEX, R_INDEX = 19, 20
L_THUMB, R_THUMB = 21, 22


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def _asymmetry_ratio(left: float, right: float) -> float:
    """|L - R| / (L + R). Scale-free, and 0 when the two sides match.

    Deliberately unsigned here: which side is weak is a property of the patient's stroke
    and is already known. What we track is whether the *gap* is widening.
    """
    return float(abs(left - right) / (abs(left) + abs(right) + 1e-9))


# --------------------------------------------------------------------------- M6
def extract_pronator_drift(raw: dict) -> dict:
    """Arms out, palms up, eyes closed, 10s.

    `raw` = {"frames": [[[x,y,z] x33] per frame], "fps": float}
    Landmarks are MediaPipe Pose in normalised image coordinates.
    """
    frames = raw.get("frames")
    if not isinstance(frames, list) or len(frames) < 10:
        return {"valid": 0.0, "frames_detected": float(len(frames or []))}

    arrays = []
    for f in frames:
        arr = np.asarray(f, dtype=float)
        if arr.ndim == 2 and arr.shape[0] > max(R_THUMB, R_INDEX) and arr.shape[1] >= 2:
            arrays.append(arr)
    if len(arrays) < 10:
        return {"valid": 0.0, "frames_detected": float(len(arrays))}

    stack = np.stack(arrays)
    n = stack.shape[0]

    # Normalise by shoulder width so distance from camera does not matter.
    shoulder_w = float(np.median(
        np.linalg.norm(stack[:, L_SHOULDER, :2] - stack[:, R_SHOULDER, :2], axis=1)
    )) + 1e-9

    # Vertical drift: wrist height at the end vs the start (y grows downward).
    head = max(3, n // 10)
    def drift(idx: int) -> float:
        start = float(np.median(stack[:head, idx, 1]))
        end = float(np.median(stack[-head:, idx, 1]))
        return float((end - start) / shoulder_w)

    drift_l, drift_r = drift(L_WRIST), drift(R_WRIST)

    # Pronation: angle of the index-thumb axis. As the palm rotates inward the axis
    # swings toward vertical.
    def pronation(index_idx: int, thumb_idx: int) -> float:
        axis = stack[:, index_idx, :2] - stack[:, thumb_idx, :2]
        angles = np.degrees(np.arctan2(axis[:, 1], axis[:, 0]))
        head_a = float(np.median(angles[:head]))
        tail_a = float(np.median(angles[-head:]))
        return float(abs(tail_a - head_a))

    pron_l, pron_r = pronation(L_INDEX, L_THUMB), pronation(R_INDEX, R_THUMB)

    # Tremor / instability of each wrist across the hold.
    def instability(idx: int) -> float:
        path = stack[:, idx, :2]
        return float(np.mean(np.linalg.norm(np.diff(path, axis=0), axis=1)) / shoulder_w)

    out = {
        "valid": 1.0,
        "frames_detected": float(n),
        "vertical_drift_L": _safe(drift_l),
        "vertical_drift_R": _safe(drift_r),
        "drift_asymmetry": _safe(_asymmetry_ratio(abs(drift_l), abs(drift_r))),
        "pronation_angle_L": _safe(pron_l),
        "pronation_angle_R": _safe(pron_r),
        "pronation_asymmetry": _safe(_asymmetry_ratio(pron_l, pron_r)),
        "wrist_instability_L": _safe(instability(L_WRIST)),
        "wrist_instability_R": _safe(instability(R_WRIST)),
        "max_drift": _safe(max(abs(drift_l), abs(drift_r))),
    }
    return out


PRONATOR_SCORING_KEYS = [
    "vertical_drift_L", "vertical_drift_R", "drift_asymmetry",
    "pronation_angle_L", "pronation_angle_R", "pronation_asymmetry",
    "wrist_instability_L", "wrist_instability_R", "max_drift",
]

PRONATOR_BAD_DIRECTION = {
    "drift_asymmetry": "up", "pronation_asymmetry": "up", "max_drift": "up",
    "wrist_instability_L": "up", "wrist_instability_R": "up",
}


# --------------------------------------------------------------------------- M7
def tap_features(timestamps_ms: list[float], prefix: str) -> dict:
    """Per-hand finger tapping statistics from tap timestamps."""
    ts = np.asarray([t for t in (timestamps_ms or []) if t is not None], dtype=float)
    ts = np.sort(ts)
    if ts.size < 4:
        return {}

    intervals = np.diff(ts)
    intervals = intervals[intervals > 20.0]  # discard double-registrations
    if intervals.size < 3:
        return {}

    duration_s = float((ts[-1] - ts[0]) / 1000.0)
    rate = float(ts.size / duration_s) if duration_s > 0 else 0.0
    mean_iti = float(np.mean(intervals))

    # Decrement: do the taps slow across the 10s run? A hallmark of fatigable weakness.
    x = np.arange(intervals.size, dtype=float)
    slope = float(np.polyfit(x, intervals, 1)[0]) if intervals.size >= 4 else 0.0

    return {
        f"tap_rate_{prefix}": _safe(rate),
        f"tap_count_{prefix}": float(ts.size),
        f"inter_tap_mean_{prefix}": _safe(mean_iti),
        f"inter_tap_cv_{prefix}": _safe(np.std(intervals) / (mean_iti + 1e-9)),
        f"decrement_slope_{prefix}": _safe(slope),
    }


def extract_fine_motor(raw: dict) -> dict:
    """`raw` = {"taps_L": [ms...], "taps_R": [ms...],
                "drag": {"error_px": [...], "duration_ms": float}}
    """
    out: dict[str, float] = {}
    left = tap_features(raw.get("taps_L"), "L")
    right = tap_features(raw.get("taps_R"), "R")
    out.update(left)
    out.update(right)

    if left and right:
        rate_l = out.get("tap_rate_L", 0.0)
        rate_r = out.get("tap_rate_R", 0.0)
        cv_l = out.get("inter_tap_cv_L", 0.0)
        cv_r = out.get("inter_tap_cv_R", 0.0)

        # THE stroke signal. Bilateral slowing leaves this flat; a lesion widens it.
        out["tap_asymmetry_ratio"] = _safe(_asymmetry_ratio(rate_l, rate_r))
        out["tap_cv_asymmetry"] = _safe(_asymmetry_ratio(cv_l, cv_r))
        out["tap_rate_mean"] = _safe((rate_l + rate_r) / 2.0)
        # Bilateral slowing indicator, kept separate so the two can be told apart.
        out["tap_bilateral_slowing"] = _safe(min(rate_l, rate_r))

    drag = raw.get("drag") or {}
    errors = drag.get("error_px")
    if isinstance(errors, list) and len(errors) >= 3:
        arr = np.asarray(errors, dtype=float)
        out["drag_error_mean"] = _safe(np.mean(arr))
        out["drag_error_cv"] = _safe(np.std(arr) / (np.mean(arr) + 1e-9))
        if drag.get("duration_ms"):
            out["drag_duration_ms"] = _safe(drag["duration_ms"])

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


FINE_MOTOR_SCORING_KEYS = [
    "tap_rate_L", "tap_rate_R", "tap_asymmetry_ratio",
    "inter_tap_cv_L", "inter_tap_cv_R", "tap_cv_asymmetry",
    "decrement_slope_L", "decrement_slope_R",
    "tap_rate_mean", "drag_error_mean", "drag_error_cv",
]

FINE_MOTOR_BAD_DIRECTION = {
    "tap_rate_L": "down", "tap_rate_R": "down", "tap_rate_mean": "down",
    "tap_asymmetry_ratio": "up", "tap_cv_asymmetry": "up",
    "inter_tap_cv_L": "up", "inter_tap_cv_R": "up",
    "decrement_slope_L": "up", "decrement_slope_R": "up",
    "drag_error_mean": "up", "drag_error_cv": "up",
}
