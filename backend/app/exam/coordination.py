"""M8 · coordination and M9 · gait/balance — Domain D. M8 maps to NIHSS item 7.

Clinical rationale
------------------
**Finger-to-nose** tests cerebellar and proprioceptive integration. Two things degrade:
*endpoint accuracy* (dysmetria — over- or undershooting the target) and *movement
smoothness*. Smoothness is quantified as normalised jerk, the third derivative of
position: a healthy reach has one smooth acceleration/deceleration profile, an ataxic
reach is decomposed into corrective sub-movements, which shows up as high jerk.

**Rapid alternating movements** test dysdiadochokinesia — the inability to perform smooth
alternating pronation/supination.

**Timed Up & Go** is the standard functional mobility measure and predicts falls. Falls are
a leading cause of morbidity in this population, so this is not a proxy for anything — it
is the outcome itself.

Gait and sway come from the phone's IMU while it sits in a pocket, so this module receives
accelerometer samples, not video.
"""
from __future__ import annotations

import numpy as np


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def _normalised_jerk(path: np.ndarray, dt: float) -> float:
    """Dimensionless jerk of a reach. Lower is smoother.

    Normalised by duration and path length so reaches of different speed and extent are
    comparable — otherwise a slow reach would always look smoother.
    """
    if path.shape[0] < 5 or dt <= 0:
        return 0.0
    velocity = np.diff(path, axis=0) / dt
    accel = np.diff(velocity, axis=0) / dt
    jerk = np.diff(accel, axis=0) / dt
    if jerk.size == 0:
        return 0.0
    duration = path.shape[0] * dt
    length = float(np.sum(np.linalg.norm(np.diff(path, axis=0), axis=1))) + 1e-9
    integral = float(np.sum(np.linalg.norm(jerk, axis=1) ** 2) * dt)
    return float(np.sqrt(0.5 * integral * (duration ** 5) / (length ** 2)))


def extract_coordination(raw: dict) -> dict:
    """`raw` = {
        "reaches": [{"path": [[x,y] ...], "target": [x,y], "fps": float}, ...],
        "alternating": {"angles_deg": [...], "fps": float},
    }
    """
    out: dict[str, float] = {}

    reaches = raw.get("reaches")
    if isinstance(reaches, list) and reaches:
        errors, jerks, durations = [], [], []
        for reach in reaches:
            path = np.asarray(reach.get("path") or [], dtype=float)
            target = np.asarray(reach.get("target") or [], dtype=float)
            fps = float(reach.get("fps") or 30.0)
            if path.ndim != 2 or path.shape[0] < 5 or target.size < 2:
                continue
            errors.append(float(np.linalg.norm(path[-1][:2] - target[:2])))
            jerks.append(_normalised_jerk(path[:, :2], 1.0 / max(fps, 1.0)))
            durations.append(path.shape[0] / max(fps, 1.0))
        if errors:
            out["endpoint_accuracy"] = _safe(np.mean(errors))
            out["endpoint_variability"] = _safe(np.std(errors))
            out["movement_smoothness"] = _safe(np.mean(jerks))
            out["reach_duration_mean"] = _safe(np.mean(durations))
            out["reaches_completed"] = float(len(errors))

    alt = raw.get("alternating") or {}
    angles = alt.get("angles_deg")
    if isinstance(angles, list) and len(angles) >= 10:
        arr = np.asarray(angles, dtype=float)
        fps = float(alt.get("fps") or 30.0)
        # Count direction reversals — each is one alternation.
        d = np.diff(arr)
        signs = np.sign(d)
        reversals = int(np.sum(signs[:-1] * signs[1:] < 0))
        duration = arr.size / max(fps, 1.0)
        out["alternation_rate"] = _safe(reversals / (2.0 * duration)) if duration > 0 else 0.0
        # Irregularity of the alternation amplitude = dysdiadochokinesia.
        peaks = arr[np.r_[True, (signs[:-1] * signs[1:] < 0), True][: arr.size]]
        if peaks.size >= 3:
            amps = np.abs(np.diff(peaks))
            out["dysdiadochokinesia"] = _safe(np.std(amps) / (np.mean(amps) + 1e-9))

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


COORDINATION_SCORING_KEYS = [
    "endpoint_accuracy", "endpoint_variability", "movement_smoothness",
    "reach_duration_mean", "alternation_rate", "dysdiadochokinesia",
]

COORDINATION_BAD_DIRECTION = {
    "endpoint_accuracy": "up", "endpoint_variability": "up",
    "movement_smoothness": "up", "reach_duration_mean": "up",
    "alternation_rate": "down", "dysdiadochokinesia": "up",
}


# --------------------------------------------------------------------------- M9
def extract_gait_balance(raw: dict) -> dict:
    """Timed Up & Go plus 30s standing sway, from phone accelerometry.

    `raw` = {"tug_seconds": float,
             "accel": [[ax,ay,az] ...], "fs": float,
             "sway": [[ax,ay,az] ...], "sway_fs": float}
    """
    out: dict[str, float] = {}

    if raw.get("tug_seconds"):
        out["tug_seconds"] = _safe(raw["tug_seconds"])

    accel = raw.get("accel")
    fs = float(raw.get("fs") or 50.0)
    if isinstance(accel, list) and len(accel) > int(fs * 2):
        arr = np.asarray(accel, dtype=float)
        magnitude = np.linalg.norm(arr, axis=1)
        signal = magnitude - float(np.mean(magnitude))

        # Cadence from the dominant frequency of the vertical acceleration.
        spectrum = np.abs(np.fft.rfft(signal))
        freqs = np.fft.rfftfreq(signal.size, d=1.0 / fs)
        band = (freqs > 0.5) & (freqs < 3.5)   # plausible step frequency range
        if band.any():
            peak = float(freqs[band][int(np.argmax(spectrum[band]))])
            out["cadence"] = _safe(peak * 60.0)  # steps per minute

        # Step symmetry: autocorrelation at one step vs two steps. In an asymmetric gait
        # the one-step peak weakens relative to the stride peak.
        centred = signal - signal.mean()
        acf = np.correlate(centred, centred, mode="full")[centred.size - 1:]
        acf = acf / (acf[0] + 1e-9)
        if band.any() and peak > 0:
            step_lag = int(fs / peak)
            stride_lag = 2 * step_lag
            if 0 < step_lag < acf.size and stride_lag < acf.size:
                out["step_symmetry"] = _safe(acf[step_lag] / (acf[stride_lag] + 1e-9))
        out["gait_variability"] = _safe(np.std(signal) / (np.mean(magnitude) + 1e-9))

    sway = raw.get("sway")
    sway_fs = float(raw.get("sway_fs") or 50.0)
    if isinstance(sway, list) and len(sway) > int(sway_fs * 2):
        arr = np.asarray(sway, dtype=float)
        # Postural sway in the horizontal plane; area of the 95% ellipse.
        xy = arr[:, :2] - arr[:, :2].mean(axis=0)
        cov = np.cov(xy.T)
        eigvals = np.linalg.eigvalsh(cov)
        eigvals = np.clip(eigvals, 0, None)
        out["sway_area"] = _safe(np.pi * 5.991 * float(np.sqrt(eigvals[0] * eigvals[1])))
        out["sway_velocity"] = _safe(
            np.mean(np.linalg.norm(np.diff(xy, axis=0), axis=1)) * sway_fs
        )

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


GAIT_SCORING_KEYS = [
    "tug_seconds", "cadence", "step_symmetry", "gait_variability",
    "sway_area", "sway_velocity",
]

GAIT_BAD_DIRECTION = {
    "tug_seconds": "up", "cadence": "down", "step_symmetry": "down",
    "gait_variability": "up", "sway_area": "up", "sway_velocity": "up",
}
