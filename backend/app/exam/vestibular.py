"""M3 oculomotor and M9 craniocorpography — the posterior-circulation modules.

WHY THIS FILE EXISTS
--------------------
The product was built around anterior-circulation stroke: face droop, arm weakness, slurred
speech, the FAST picture. Posterior-circulation and cerebellar strokes are 20-25% of
ischemic strokes, are misdiagnosed two to three times more often than anterior ones, and
were explicitly out of our scope.

The case that changed it (see `docs/CLINICAL_REFERENCE.md`, from anonymised real records):
an 82-year-old man, seven months post-stroke, MRI showing encephalomalacia with gliosis in
the left cerebellar hemisphere and bilateral occipital regions. Clinically: sixty vertigo
attacks, worsening unsteadiness, abnormal saccade latency and velocity, Unterberger sway
17 cm, tandem sway 13 cm, angular deviation 5 degrees right.

And **finger-nose, heel-knee-shin, dysdiadochokinesia and joint-position were all NORMAL.**

That last line is the whole point. M8, our coordination module, tests exactly those four
things. It would have found nothing. Every deficit this man had lives in balance and
oculomotor function — the two modules we had deprioritised to a monthly tier. A patient with
a real, MRI-confirmed cerebellar infarct was invisible to us.

WHAT THESE MEASURE
------------------
M3 mirrors the hospital's oculomotor battery: saccade latency, velocity and precision per
direction, plus smooth-pursuit gain. Iris landmarks from MediaPipe FaceMesh approximate
these well enough to trend, though not to diagnose — see the limitations note in the
module card.

M9 is digital craniocorpography. CCG is an established vestibular test: you film the
patient stepping or standing and measure how the head travels. The clinical output is a
movement trace plus four numbers — sway path length, sway area, angular deviation, lateral
displacement — and we reproduce that shape so a clinician reads something familiar rather
than a novel score they have to learn to trust.

LATERALITY
----------
Unlike speech, this domain HAS a side — and it comes primarily from the EYE.

A unilateral cerebellar lesion produces direction-dependent saccades: in the reference
patient, leftward saccades were both slower (199 vs 290 deg/s) and later (353 vs 321 ms)
than rightward, giving a velocity asymmetry of ~0.37 with a left cerebellar lesion.

Unterberger stepping is also expected to push the patient toward the lesion, and that is
the premise of the test — but in this patient the 5-degree rightward deviation was
classified NORMAL by the clinical device. So the feet corroborate and the eyes establish.
We had this stated the other way round until the source records were read; see
docs/GAP_ANALYSIS.md D-2.
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np


def _safe(value, fallback: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    return out if math.isfinite(out) else fallback


def _asymmetry(left: float, right: float) -> float:
    """|L-R| / mean — a scale-free side difference, 0 when symmetric."""
    denom = (abs(left) + abs(right)) / 2.0
    return abs(left - right) / denom if denom > 1e-9 else 0.0


# --------------------------------------------------------------------------- M3 ocular
#: Below this, a "saccade" is more likely a tracking glitch than a movement.
MIN_SACCADE_AMPLITUDE = 0.02
#: Physiological saccade latency is ~200 ms. Anything under 80 ms is an anticipation, not a
#: response to the target, and including it would flatter the patient.
MIN_LATENCY_MS = 80.0

# --- frame rate, and why velocity is the feature that suffers ---
#
# A human saccade lasts 30-80 ms. At 30 fps a frame is 33 ms, so the entire movement spans
# one to three samples. Two consequences, and they are not equal:
#
#   LATENCY quantises to +/- one frame (33 ms at 30 fps). Normal is ~200 ms and abnormal is
#   >250 ms, so a 33 ms step is coarse but still usable for trending a patient against
#   themselves.
#
#   PEAK VELOCITY is measured as displacement between adjacent frames. When the saccade
#   finishes inside one frame interval, that is not a peak — it is an average across the
#   whole movement, and it systematically UNDERSTATES the true peak. The error is worse for
#   fast saccades, which is exactly backwards: a healthy fast saccade is undersampled more
#   than a slow impaired one, so the measure compresses the difference we care about.
#
# We therefore record the actual capture rate, report how many frames each saccade spanned,
# and emit an explicit velocity confidence. Nothing here is silently corrected — a 30 fps
# capture is trended honestly as a 30 fps capture.
MIN_FRAMES_FOR_VELOCITY = 3      # below this, peak velocity is an average, not a peak
GOOD_FRAMES_FOR_VELOCITY = 6     # at/above this, the peak is genuinely resolved
#: 30 fps is the phone default; 120 fps slow-motion is what makes velocity trustworthy.
RELIABLE_FPS = 120.0


def extract_oculomotor(raw: dict) -> dict:
    """M3 · smooth pursuit and random saccades — Domain posterior_vestibular. WEEKLY.

    `raw` = {
      "fps": float,
      "pursuit": [{"gaze": [x, y], "target": [x, y]} ...],
      "saccades": [{"direction": "left"|"right"|"up"|"down",
                    "target_onset_frame": int,
                    "gaze": [[x, y] ...],          # frames from target onset
                    "target": [x, y]} ...],
    }

    Gaze is in normalised screen coordinates (0-1), as the iris landmarks give it.

    Saccade metrics are computed PER DIRECTION because direction-dependence is the signal:
    a lesion does not slow every saccade equally, and a symmetric slowing is far more likely
    to be fatigue or medication than a focal deficit.
    """
    out: dict[str, float] = {}
    fps = float(raw.get("fps") or 30.0)

    # ---- smooth pursuit ----
    pursuit = raw.get("pursuit")
    if isinstance(pursuit, list) and len(pursuit) >= 10:
        gaze = np.asarray([p["gaze"] for p in pursuit if "gaze" in p], dtype=float)
        target = np.asarray([p["target"] for p in pursuit if "target" in p], dtype=float)
        if gaze.shape == target.shape and gaze.shape[0] >= 10:
            error = np.linalg.norm(gaze - target, axis=1)
            out["pursuit_error_mean"] = _safe(np.mean(error))
            out["pursuit_error_cv"] = _safe(np.std(error) / (np.mean(error) + 1e-9))

            # Pursuit GAIN: eye velocity over target velocity. The clinically meaningful
            # number — a gain below ~0.7 means the eye keeps falling behind and catching up
            # with corrective saccades, which is what cerebellar pursuit failure looks like.
            gaze_v = np.linalg.norm(np.diff(gaze, axis=0), axis=1) * fps
            target_v = np.linalg.norm(np.diff(target, axis=0), axis=1) * fps
            moving = target_v > 1e-6
            if moving.sum() >= 5:
                out["pursuit_gain"] = _safe(
                    float(np.median(gaze_v[moving] / target_v[moving])))

                # Gain per direction of travel, and the asymmetry between them. A
                # unilateral lesion degrades pursuit toward the lesioned side.
                dx = np.diff(target, axis=0)[:, 0]
                left_moving = moving & (dx < 0)
                right_moving = moving & (dx > 0)
                if left_moving.sum() >= 3 and right_moving.sum() >= 3:
                    gain_l = float(np.median(gaze_v[left_moving] / target_v[left_moving]))
                    gain_r = float(np.median(gaze_v[right_moving] / target_v[right_moving]))
                    out["pursuit_gain_left"] = _safe(gain_l)
                    out["pursuit_gain_right"] = _safe(gain_r)
                    out["pursuit_gain_asymmetry"] = _safe(_asymmetry(gain_l, gain_r))

            velocity = np.linalg.norm(np.diff(gaze, axis=0), axis=1)
            if velocity.size > 2:
                threshold = float(np.median(velocity) * 3.0)
                out["saccadic_intrusions"] = float(np.sum(velocity > threshold))
                out["pursuit_smoothness"] = _safe(1.0 / (1.0 + np.std(velocity)))

    # ---- random saccades ----
    saccades = raw.get("saccades")
    if isinstance(saccades, list) and saccades:
        per_direction: dict[str, dict[str, list[float]]] = {}
        for trial in saccades:
            direction = str(trial.get("direction", "")).lower()
            gaze = trial.get("gaze")
            target = trial.get("target")
            if direction not in ("left", "right", "up", "down"):
                continue
            if not isinstance(gaze, list) or len(gaze) < 3 or target is None:
                continue

            arr = np.asarray(gaze, dtype=float)
            tgt = np.asarray(target, dtype=float)
            start = arr[0]

            displacement = np.linalg.norm(arr - start, axis=1)
            amplitude = float(displacement.max())
            if amplitude < MIN_SACCADE_AMPLITUDE:
                continue

            # LATENCY: frames from target onset until the eye first moves decisively —
            # 10% of the eventual displacement, which is robust to tracking jitter.
            moved = np.argmax(displacement > amplitude * 0.10)
            latency_ms = float(moved) / fps * 1000.0
            if latency_ms < MIN_LATENCY_MS:
                continue

            # PEAK VELOCITY, in normalised units per second.
            step = np.linalg.norm(np.diff(arr, axis=0), axis=1) * fps
            peak_velocity = float(step.max()) if step.size else 0.0

            # PRECISION: how close the eye landed to the target, as a fraction of the
            # distance it needed to travel. Cerebellar saccades characteristically
            # overshoot or undershoot — dysmetria — while remaining fast.
            need = float(np.linalg.norm(tgt - start))
            landed = float(np.linalg.norm(arr[-1] - tgt))
            precision = 1.0 - (landed / need) if need > 1e-9 else 0.0

            # How many frames the movement actually occupied. This, not fps alone,
            # determines whether "peak velocity" means anything.
            moving_frames = int(np.sum(step > step.max() * 0.2)) if step.size else 0

            bucket = per_direction.setdefault(
                direction, {"latency": [], "velocity": [], "precision": [], "frames": []})
            bucket["latency"].append(latency_ms)
            bucket["velocity"].append(peak_velocity)
            bucket["precision"].append(precision)
            bucket["frames"].append(float(moving_frames))

        for direction, values in per_direction.items():
            if not values["latency"]:
                continue
            out[f"saccade_latency_{direction}"] = _safe(np.median(values["latency"]))
            out[f"saccade_velocity_{direction}"] = _safe(np.median(values["velocity"]))
            out[f"saccade_precision_{direction}"] = _safe(np.median(values["precision"]))

        # Overall figures, plus the left/right asymmetries that carry the laterality.
        all_lat = [v for b in per_direction.values() for v in b["latency"]]
        all_vel = [v for b in per_direction.values() for v in b["velocity"]]
        if all_lat:
            out["saccade_latency_mean"] = _safe(np.median(all_lat))
            out["saccade_latency_cv"] = _safe(np.std(all_lat) / (np.mean(all_lat) + 1e-9))
        if all_vel:
            out["saccade_velocity_mean"] = _safe(np.median(all_vel))

        if "left" in per_direction and "right" in per_direction:
            lat_l = float(np.median(per_direction["left"]["latency"]))
            lat_r = float(np.median(per_direction["right"]["latency"]))
            vel_l = float(np.median(per_direction["left"]["velocity"]))
            vel_r = float(np.median(per_direction["right"]["velocity"]))
            out["saccade_latency_asymmetry"] = _safe(_asymmetry(lat_l, lat_r))
            out["saccade_velocity_asymmetry"] = _safe(_asymmetry(vel_l, vel_r))

    if not out:
        return {"valid": 0.0}

    # --- record the capture conditions, so a number is never read out of context ---
    out["capture_fps"] = _safe(fps)
    out["frame_interval_ms"] = _safe(1000.0 / fps if fps > 0 else 0.0)
    # Latency cannot be more precise than one frame.
    out["saccade_latency_resolution_ms"] = _safe(1000.0 / fps if fps > 0 else 0.0)

    all_frames = [f for b in per_direction.values() for f in b.get("frames", [])]         if saccades and isinstance(saccades, list) else []
    if all_frames:
        median_frames = float(np.median(all_frames))
        out["saccade_frames_median"] = _safe(median_frames)
        # Confidence ramps from 0 at MIN_FRAMES to 1 at GOOD_FRAMES. A saccade caught in
        # two frames gets a velocity number AND a confidence near zero, rather than being
        # silently dropped or silently trusted.
        span = GOOD_FRAMES_FOR_VELOCITY - MIN_FRAMES_FOR_VELOCITY
        out["velocity_confidence"] = _safe(
            min(1.0, max(0.0, (median_frames - MIN_FRAMES_FOR_VELOCITY) / span)))
    else:
        out["velocity_confidence"] = 0.0

    # A flag the caregiver-facing and clinician-facing layers can both read.
    out["velocity_undersampled"] = float(fps < RELIABLE_FPS)

    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


#: Human-readable caveat for whatever this capture actually was. Rendered on the clinician
#: view beside any velocity figure.
def velocity_caveat(features: dict) -> str | None:
    """Explain, in one line, how far a velocity number can be trusted at this frame rate."""
    fps = float(features.get("capture_fps") or 0.0)
    if not fps:
        return None
    frames = float(features.get("saccade_frames_median") or 0.0)
    confidence = float(features.get("velocity_confidence") or 0.0)
    if fps >= RELIABLE_FPS and confidence >= 0.8:
        return (f"Captured at {fps:.0f} fps; saccades spanned ~{frames:.0f} frames. "
                "Peak velocity is well resolved.")
    return (
        f"Captured at {fps:.0f} fps (frame every {1000.0 / fps:.0f} ms). A saccade lasts "
        f"30-80 ms and spanned ~{frames:.0f} frame(s) here, so peak velocity is averaged "
        f"across the movement and UNDERSTATES the true peak. Latency is resolved only to "
        f"+/-{1000.0 / fps:.0f} ms. Trend this patient against their own earlier captures "
        f"at the same frame rate; do not compare it to published normative velocities."
    )


OCULOMOTOR_SCORING_KEYS = [
    "pursuit_gain", "pursuit_gain_asymmetry", "pursuit_error_mean", "pursuit_error_cv",
    "pursuit_smoothness", "saccadic_intrusions",
    "saccade_latency_mean", "saccade_latency_cv", "saccade_velocity_mean",
    "saccade_latency_asymmetry", "saccade_velocity_asymmetry",
    "saccade_latency_left", "saccade_latency_right",
    "saccade_velocity_left", "saccade_velocity_right",
    "saccade_precision_left", "saccade_precision_right",
]

OCULOMOTOR_BAD_DIRECTION = {
    "pursuit_gain": "down",              # eye falling behind the target
    "pursuit_gain_asymmetry": "up",
    "pursuit_error_mean": "up", "pursuit_error_cv": "up",
    "pursuit_smoothness": "down", "saccadic_intrusions": "up",
    "saccade_latency_mean": "up",        # slower to start
    "saccade_latency_cv": "up",
    "saccade_velocity_mean": "down",     # slower once moving
    "saccade_latency_asymmetry": "up",
    "saccade_velocity_asymmetry": "up",
    "saccade_latency_left": "up", "saccade_latency_right": "up",
    "saccade_velocity_left": "down", "saccade_velocity_right": "down",
    "saccade_precision_left": "down", "saccade_precision_right": "down",
}

#: The features that carry a side. See gates.py — this is what lets a posterior-circulation
#: patient reach ALERT without any limb or facial finding.
OCULOMOTOR_LATERAL_KEYS = (
    "pursuit_gain_asymmetry",
    "saccade_latency_asymmetry",
    "saccade_velocity_asymmetry",
)


# ------------------------------------------------------------------ M9 craniocorpography
#: Head-width in cm, used to convert normalised pose coordinates into centimetres so the
#: output is comparable with clinical CCG values. Adult mean bitemporal width.
DEFAULT_HEAD_WIDTH_CM = 15.0


def _to_cm(track: np.ndarray, head_width_norm: float, head_width_cm: float) -> np.ndarray:
    """Scale a normalised trace to centimetres using the head as the ruler.

    The phone's distance from the patient is unknown and varies between sessions, so raw
    normalised units are not comparable week to week. The head is a fixed-size object in the
    same frame, which makes it the natural scale reference — the same trick the clinical
    CCG apparatus achieves with a fixed camera height.
    """
    if head_width_norm <= 1e-6:
        return track
    return track * (head_width_cm / head_width_norm)


def extract_craniocorpography(raw: dict) -> dict:
    """M9 · digital craniocorpography — Domain posterior_vestibular. WEEKLY.

    `raw` = {
      "fps": float,
      "head_width_norm": float,          # bitemporal width in normalised units
      "head_width_cm": float,            # optional, defaults to 15 cm
      "tests": {
        "romberg_eyes_open":   [[x, y] ...],   # head centroid per frame
        "romberg_eyes_closed": [[x, y] ...],
        "tandem_stance":       [[x, y] ...],
        "tandem_walk":         [[x, y] ...],
        "unterberger":         [[x, y] ...],   # 50 steps on the spot, eyes closed
      },
    }

    Outputs the four numbers a clinical CCG reports, per test: sway path length (cm), sway
    area (cm^2), lateral displacement (cm), and — for the stepping tests — angular
    deviation in degrees.

    The Romberg pair is reported as a RATIO as well as two absolutes. Eyes-closed sway
    normally rises somewhat; a large rise means the patient was relying on vision to stay
    upright, which is what vestibular or proprioceptive loss looks like.
    """
    out: dict[str, float] = {}
    tests = raw.get("tests") or {}
    if not isinstance(tests, dict):
        return {"valid": 0.0}

    fps = float(raw.get("fps") or 30.0)
    head_norm = float(raw.get("head_width_norm") or 0.0)
    head_cm = float(raw.get("head_width_cm") or DEFAULT_HEAD_WIDTH_CM)

    per_test_sway: dict[str, float] = {}

    for name, track in tests.items():
        if not isinstance(track, list) or len(track) < 5:
            continue
        arr = np.asarray(track, dtype=float)
        if arr.ndim != 2 or arr.shape[1] < 2:
            continue
        arr = _to_cm(arr[:, :2], head_norm, head_cm)
        centred = arr - arr[0]

        # PATH LENGTH: total distance the head travelled. The headline CCG number.
        steps = np.linalg.norm(np.diff(arr, axis=0), axis=1)
        path_cm = float(np.sum(steps))
        out[f"{name}_sway_path_cm"] = _safe(path_cm)
        per_test_sway[name] = path_cm

        # SWAY AREA: 95% confidence ellipse over the horizontal excursion.
        xy = arr - arr.mean(axis=0)
        cov = np.cov(xy.T)
        eigvals = np.clip(np.linalg.eigvalsh(cov), 0, None)
        out[f"{name}_sway_area_cm2"] = _safe(
            math.pi * 5.991 * float(np.sqrt(eigvals[0] * eigvals[1])))

        # LATERAL DISPLACEMENT: net sideways travel, signed so the direction survives.
        out[f"{name}_lateral_cm"] = _safe(float(centred[-1, 0]))
        out[f"{name}_lateral_abs_cm"] = _safe(abs(float(centred[-1, 0])))

        # SWAY VELOCITY: path over time, which separates "moved a lot slowly" from
        # "jittered constantly".
        duration = max(len(arr) - 1, 1) / fps
        out[f"{name}_sway_velocity_cm_s"] = _safe(path_cm / duration)

        # ANGULAR DEVIATION, for the stepping tests. In Unterberger the patient steps on
        # the spot with eyes closed; a unilateral vestibular or cerebellar lesion rotates
        # them steadily toward the affected side. The sign carries the side.
        if name in ("unterberger", "tandem_walk"):
            forward = float(centred[-1, 1])
            lateral = float(centred[-1, 0])
            if abs(forward) > 1e-6 or abs(lateral) > 1e-6:
                angle = math.degrees(math.atan2(lateral, abs(forward) + 1e-9))
                out[f"{name}_angular_deviation_deg"] = _safe(angle)
                out[f"{name}_angular_deviation_abs_deg"] = _safe(abs(angle))

    # ---- Romberg quotient ----
    eo = per_test_sway.get("romberg_eyes_open")
    ec = per_test_sway.get("romberg_eyes_closed")
    if eo and ec and eo > 1e-6:
        # >1 means closing the eyes made them worse. A large quotient is the classic
        # signature of relying on vision to compensate for lost vestibular input.
        out["romberg_quotient"] = _safe(ec / eo)

    if not out:
        return {"valid": 0.0}

    # Say how much of the battery actually ran. A three-task capture and a five-task
    # capture must not be indistinguishable downstream.
    out["tests_captured"] = float(len(per_test_sway))
    # Laterality lives entirely in the stepping tests. Without them this module measures
    # how unsteady the patient is and cannot say which side.
    out["laterality_available"] = float(
        any(k in tests for k in ("unterberger", "tandem_walk")))

    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


CCG_SCORING_KEYS = [
    "romberg_eyes_open_sway_path_cm", "romberg_eyes_closed_sway_path_cm",
    "romberg_quotient",
    "tandem_stance_sway_path_cm", "tandem_stance_sway_area_cm2",
    "tandem_walk_sway_path_cm", "tandem_walk_lateral_abs_cm",
    "tandem_walk_angular_deviation_abs_deg",
    "unterberger_sway_path_cm", "unterberger_lateral_abs_cm",
    "unterberger_angular_deviation_abs_deg",
    "unterberger_sway_velocity_cm_s",
]

CCG_BAD_DIRECTION = {key: "up" for key in CCG_SCORING_KEYS}

#: Angular deviation and lateral displacement point at a side, which is the premise of the
#: Unterberger test. Treat them as CORROBORATING rather than establishing: in the reference
#: patient a 5-degree rightward deviation was classified NORMAL by the clinical device, and
#: the finding that actually carried a side was M3 saccade velocity asymmetry. Feet are
#: noisier than eyes here. See docs/GAP_ANALYSIS.md D-2.
CCG_LATERAL_KEYS = (
    "unterberger_angular_deviation_abs_deg",
    "unterberger_lateral_abs_cm",
    "tandem_walk_angular_deviation_abs_deg",
    "tandem_walk_lateral_abs_cm",
)


def ccg_trace(raw: dict, test: str = "unterberger") -> dict:
    """The movement trace a clinician expects to see, in centimetres.

    A CCG report is read as a picture first and numbers second. Returning the path in the
    same shape means the clinician recognises it instead of having to learn a new format.
    """
    tests = raw.get("tests") or {}
    track = tests.get(test)
    if not isinstance(track, list) or len(track) < 2:
        return {"test": test, "points": [], "units": "cm"}

    arr = np.asarray(track, dtype=float)[:, :2]
    arr = _to_cm(arr, float(raw.get("head_width_norm") or 0.0),
                 float(raw.get("head_width_cm") or DEFAULT_HEAD_WIDTH_CM))
    centred = arr - arr[0]
    return {
        "test": test,
        "units": "cm",
        "points": [[round(float(x), 2), round(float(y), 2)] for x, y in centred],
        "start": [0.0, 0.0],
        "end": [round(float(centred[-1, 0]), 2), round(float(centred[-1, 1]), 2)],
    }


# --------------------------------------------------------------------------- M21 SVV
"""Subjective Visual Vertical — added after reading the reference patient's records.

Dynamic clockwise SVV was one of only THREE abnormalities on a 17-page vestibular battery
(the others being Unterberger sway and saccade latency/velocity). It is also the one of the
three that no module of ours touched at all.

WHAT IT MEASURES
----------------
Where the patient believes "upright" is. The brain builds verticality from three inputs:
the otoliths (graviception), vision, and proprioception. A unilateral vestibular or
cerebellar lesion tilts the otolith contribution, and the patient sets a line off-vertical
toward the lesioned side without noticing.

Nothing else in this product measures the graviceptive pathway. Sway tells you the patient
is unsteady; SVV tells you their internal sense of vertical is wrong, which is a different
and more specific thing.

STATIC vs DYNAMIC — and why dynamic is the one that mattered
------------------------------------------------------------
STATIC: a line on a dark field, no other cues. Pure otolith.

DYNAMIC: the same line over a rotating background. The rotation drags the perceived
vertical along with it, and a healthy system resists. The reference patient's static SVV was
NORMAL (1.92 degrees absolute) while his clockwise dynamic was ABNORMAL (mean 8.00) — so a
static-only test would have found nothing in him.

More telling than the mean: his six clockwise trials rose MONOTONICALLY, 3.5 -> 5.0 -> 6.5
-> 9.5 -> 12.5 -> 17.5. The error did not scatter, it accumulated. A patient whose
verticality is being progressively captured by the moving field is a different finding from
one who is simply imprecise, and averaging destroys it. `svv_dynamic_cw_drift_slope` exists
to keep it.

LATERALITY
----------
The SIGN carries the side: a tilt toward the lesion. This is a genuine lateral feature, and
after GAP_ANALYSIS D-2 we are careful about which measures we trust for laterality — the
sign of an SVV tilt is well established clinically, but we have exactly one patient, whose
static SVV was normal. It is offered as a corroborating lateral key, never the sole one.

SAFETY
------
A rotating full-field background can provoke nausea in a patient who already has vertigo.
The task must be abortable at any moment and must never be presented during an active
attack. `svv_aborted` records that, and an aborted run is invalid rather than zero.
"""

#: Degrees. Above this the setting is not a perceptual judgement, it is a mis-tap.
SVV_MAX_PLAUSIBLE_DEG = 45.0
#: The clinical protocol runs six trials per condition.
SVV_TRIALS_EXPECTED = 6
#: Reference patient: static absolute mean 1.92 deg (normal). Typical clinical cut-off is
#: around 2-2.5 deg for static SVV, so this sits just inside it.
SVV_STATIC_REFERENCE_DEG = 1.92


def _drift_slope(values: Sequence[float]) -> float:
    """Least-squares slope across trial index, in degrees per trial.

    The reference patient's clockwise trials climbed 3.5 -> 17.5 across six repetitions:
    slope ~ +2.8 deg/trial. A mean alone reports 8.0 and hides the accumulation entirely.
    """
    n = len(values)
    if n < 3:
        return 0.0
    x = np.arange(n, dtype=float)
    y = np.asarray(values, dtype=float)
    denom = float(((x - x.mean()) ** 2).sum())
    if denom < 1e-9:
        return 0.0
    return float(((x - x.mean()) * (y - y.mean())).sum() / denom)


def extract_svv(raw: dict) -> dict:
    """M21 - Subjective Visual Vertical. Domain posterior_vestibular. MONTHLY.

    `raw` = {
      "static":       [deg, ...],   # signed; + = clockwise / top toward patient's right
      "dynamic_cw":   [deg, ...],   # background rotating clockwise
      "dynamic_acw":  [deg, ...],   # background rotating anti-clockwise
      "aborted": bool,              # patient stopped the task
    }

    Sign convention matches the clinical report: positive is a clockwise tilt of the line's
    top, i.e. toward the patient's right.
    """
    out: dict[str, float] = {}

    if raw.get("aborted"):
        # Not zero. A patient who had to stop because the rotation made them sick has told
        # us something, but not a measurement.
        return {"valid": 0.0, "svv_aborted": 1.0}

    conditions = {
        "static": raw.get("static"),
        "dynamic_cw": raw.get("dynamic_cw"),
        "dynamic_acw": raw.get("dynamic_acw"),
    }

    for name, trials in conditions.items():
        if not isinstance(trials, list) or not trials:
            continue
        vals = [
            float(v) for v in trials
            if isinstance(v, (int, float)) and abs(float(v)) <= SVV_MAX_PLAUSIBLE_DEG
        ]
        if len(vals) < 3:
            continue

        arr = np.asarray(vals, dtype=float)
        out[f"svv_{name}_mean"] = _safe(np.mean(arr))
        # The clinical device's "Average" for the DYNAMIC conditions is the MEDIAN of the
        # signed trials, not the arithmetic mean. Reproducing the reference patient exposed
        # this: his clockwise trials mean 9.08 but the report prints 8.00, and the median is
        # exactly 8.00; anti-clockwise mean -1.67, printed -1.50, median exactly -1.50.
        # Static is different again — its "Absolute Average" IS the mean of absolutes
        # (1.9167 -> 1.92 printed).
        #
        # We emit both. The median is what a clinician will compare against, and a
        # calibration target we cannot reproduce is not a calibration target.
        out[f"svv_{name}_median"] = _safe(np.median(arr))
        # Absolute mean is what the clinical report calls "Absolute Average" for static:
        # a patient who tilts +3 then -3 has a mean of 0 and is not accurate.
        out[f"svv_{name}_abs_mean"] = _safe(np.mean(np.abs(arr)))
        out[f"svv_{name}_sd"] = _safe(np.std(arr))
        out[f"svv_{name}_max_abs"] = _safe(np.max(np.abs(arr)))
        out[f"svv_{name}_trials"] = float(len(vals))
        # The accumulation term. See the module note.
        out[f"svv_{name}_drift_slope"] = _safe(_drift_slope(vals))

    # Rotational susceptibility: how far the moving field drags perceived vertical, over
    # and above the patient's static error. This is the quantity dynamic SVV exists for.
    static_abs = out.get("svv_static_abs_mean")
    for direction in ("cw", "acw"):
        dyn = out.get(f"svv_dynamic_{direction}_abs_mean")
        if dyn is not None and static_abs is not None:
            out[f"svv_rod_susceptibility_{direction}"] = _safe(dyn - static_abs)

    # Direction asymmetry. A lesion biases one rotation direction more than the other; the
    # reference patient was abnormal clockwise (8.00) and normal anti-clockwise (-1.50).
    cw = out.get("svv_dynamic_cw_abs_mean")
    acw = out.get("svv_dynamic_acw_abs_mean")
    if cw is not None and acw is not None:
        out["svv_dynamic_asymmetry"] = _safe(_asymmetry(cw, acw))

    if not out:
        return {"valid": 0.0}
    out["svv_aborted"] = 0.0
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


SVV_SCORING_KEYS = [
    "svv_static_abs_mean", "svv_static_sd", "svv_static_max_abs",
    "svv_dynamic_cw_median", "svv_dynamic_acw_median",
    "svv_dynamic_cw_abs_mean", "svv_dynamic_cw_sd", "svv_dynamic_cw_drift_slope",
    "svv_dynamic_acw_abs_mean", "svv_dynamic_acw_sd", "svv_dynamic_acw_drift_slope",
    "svv_rod_susceptibility_cw", "svv_rod_susceptibility_acw",
    "svv_dynamic_asymmetry",
]

SVV_BAD_DIRECTION = {key: "up" for key in SVV_SCORING_KEYS}

#: The SIGN of a tilt names the side. Offered as a corroborating lateral key only — see the
#: module note and GAP_ANALYSIS D-2 on not over-trusting a single lateral source.
SVV_LATERAL_KEYS = (
    "svv_dynamic_asymmetry",
)
