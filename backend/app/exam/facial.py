"""M1 · facial motor — Domain A (cranial nerves). Maps to NIHSS item 4. DAILY.

Clinical rationale
------------------
The single most important thing this module does is distinguish a **central** facial palsy
(the kind a stroke causes) from a **peripheral** one (Bell's palsy).

The forehead has bilateral cortical innervation. In a central lesion the forehead is
therefore *spared* — the patient can still raise both eyebrows — while the lower face
droops. In a peripheral lesion the whole hemiface is affected, forehead included.

That is why `forehead_raise` is a task and `forehead_movement_symmetry` is a feature. A
face module that only measures the smile cannot tell the two apart, and would raise a
stroke-shaped alarm for a self-limiting Bell's palsy.

Input is a series of per-frame MediaPipe FaceMesh landmarks — 468 normalised (x, y, z)
points — one series per task. On the phone this is produced by MediaPipe Tasks Web and
never leaves the device; this module is the authoritative Python mirror of that maths.
"""
from __future__ import annotations

import numpy as np

# --- FaceMesh landmark indices ---
L_MOUTH, R_MOUTH = 61, 291
UP_LIP, LOW_LIP = 13, 14
L_EYE = [33, 160, 158, 133, 153, 144]
R_EYE = [362, 385, 387, 263, 373, 380]
L_BROW_INNER, R_BROW_INNER = 105, 334
L_BROW_OUTER, R_BROW_OUTER = 70, 300
NOSE_TIP, NOSE_BRIDGE, CHIN = 1, 168, 199
L_NASOLABIAL, R_NASOLABIAL = 129, 358
L_CHEEK, R_CHEEK = 205, 425
FOREHEAD_MID = 10


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


def _ear(pts: np.ndarray, idx: list[int]) -> float:
    """Eye aspect ratio: vertical opening over horizontal width."""
    p = pts[idx]
    vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    horizontal = 2.0 * np.linalg.norm(p[0] - p[3]) + 1e-6
    return float(vertical / horizontal)


def _face_scale(pts: np.ndarray) -> float:
    """Normalising length so features are invariant to distance from the camera."""
    return float(np.linalg.norm(pts[NOSE_BRIDGE][:2] - pts[CHIN][:2]) + 1e-6)


def _midline(pts: np.ndarray) -> np.ndarray:
    return (pts[NOSE_BRIDGE][:2] + pts[CHIN][:2]) / 2.0


def _symmetry(left: float, right: float) -> float:
    """0 = perfectly symmetric, 1 = maximally asymmetric."""
    return float(abs(left - right) / (abs(left) + abs(right) + 1e-6))


# --------------------------------------------------------------------------- per frame
def frame_features(pts: np.ndarray) -> dict:
    """Geometry for one frame. `pts` is (468, 3) normalised landmarks."""
    scale = _face_scale(pts)
    mid = _midline(pts)

    # Mouth corner displacement from the facial midline, per side.
    d_left = float(np.linalg.norm(pts[L_MOUTH][:2] - mid))
    d_right = float(np.linalg.norm(pts[R_MOUTH][:2] - mid))
    mouth_corner_symmetry = _symmetry(d_left, d_right)

    # Vertical droop of one corner relative to the other.
    corner_drop = float(abs(pts[L_MOUTH][1] - pts[R_MOUTH][1]) / scale)

    # Nasolabial fold depth proxy: cheek-to-nasolabial distance, each side.
    nl_left = float(np.linalg.norm(pts[L_NASOLABIAL][:2] - pts[L_CHEEK][:2]) / scale)
    nl_right = float(np.linalg.norm(pts[R_NASOLABIAL][:2] - pts[R_CHEEK][:2]) / scale)
    nasolabial_ratio = _symmetry(nl_left, nl_right)

    ear_l, ear_r = _ear(pts, L_EYE), _ear(pts, R_EYE)

    # Brow height above the nose bridge — the forehead signal.
    brow_l = float((pts[NOSE_BRIDGE][1] - pts[L_BROW_INNER][1]) / scale)
    brow_r = float((pts[NOSE_BRIDGE][1] - pts[R_BROW_INNER][1]) / scale)
    brow_outer_l = float((pts[NOSE_BRIDGE][1] - pts[L_BROW_OUTER][1]) / scale)
    brow_outer_r = float((pts[NOSE_BRIDGE][1] - pts[R_BROW_OUTER][1]) / scale)

    return {
        "mouth_corner_symmetry": _safe(mouth_corner_symmetry),
        "corner_drop": _safe(corner_drop),
        "nasolabial_ratio": _safe(nasolabial_ratio),
        "eye_aperture_L": _safe(ear_l),
        "eye_aperture_R": _safe(ear_r),
        "ear_asymmetry": _safe(_symmetry(ear_l, ear_r)),
        "brow_height_L": _safe(brow_l),
        "brow_height_R": _safe(brow_r),
        "brow_outer_L": _safe(brow_outer_l),
        "brow_outer_R": _safe(brow_outer_r),
        "mouth_open": _safe(abs(pts[UP_LIP][1] - pts[LOW_LIP][1]) / scale),
    }


def _series(frames: list[dict], key: str) -> np.ndarray:
    return np.array([f[key] for f in frames], dtype=float)


def _excursion(frames: list[dict], key: str) -> float:
    """How far a landmark travelled between rest and peak effort.

    Range rather than mean: the clinical question is "how much can this side MOVE", and a
    weak side is one whose excursion is small even at maximum effort.
    """
    if not frames:
        return 0.0
    values = _series(frames, key)
    return float(np.percentile(values, 90) - np.percentile(values, 10))


# --------------------------------------------------------------------------- module
def extract_facial_motor(raw: dict) -> dict:
    """Combine the four tasks into one feature vector.

    `raw` = {
      "smile":         [[[x,y,z] x468] per frame],
      "forehead_raise":[...],
      "eye_closure":   [...],
      "cheek_puff":    [...],
    }
    Any task may be absent; the features it drives are then omitted rather than faked.
    """
    out: dict[str, float] = {}
    per_task: dict[str, list[dict]] = {}

    for task, frames in raw.items():
        if not isinstance(frames, list) or len(frames) < 3:
            continue
        computed: list[dict] = []
        for frame in frames:
            arr = np.asarray(frame, dtype=float)
            if arr.ndim != 2 or arr.shape[0] < 468 or arr.shape[1] < 2:
                continue
            computed.append(frame_features(arr))
        if len(computed) >= 3:
            per_task[task] = computed

    if not per_task:
        return {"valid": 0.0, "frames_detected": 0.0}

    total_frames = sum(len(v) for v in per_task.values())

    # --- smile: the lower-face signal (NIHSS 4) ---
    if "smile" in per_task:
        smile = per_task["smile"]
        out["mouth_corner_symmetry"] = float(np.median(_series(smile, "mouth_corner_symmetry")))
        out["corner_drop"] = float(np.median(_series(smile, "corner_drop")))
        out["nasolabial_ratio"] = float(np.median(_series(smile, "nasolabial_ratio")))
        out["smile_excursion_L"] = _excursion(smile, "brow_height_L") * 0 + _excursion(smile, "mouth_open")
        out["mouth_corner_symmetry_std"] = float(np.std(_series(smile, "mouth_corner_symmetry")))

    # --- forehead raise: the CENTRAL vs PERIPHERAL discriminator ---
    if "forehead_raise" in per_task:
        fh = per_task["forehead_raise"]
        exc_l = _excursion(fh, "brow_height_L")
        exc_r = _excursion(fh, "brow_height_R")
        out["forehead_excursion_L"] = exc_l
        out["forehead_excursion_R"] = exc_r
        out["forehead_movement_symmetry"] = _symmetry(exc_l, exc_r)
        # Spared forehead + drooping lower face = central pattern.
        lower = out.get("mouth_corner_symmetry", 0.0)
        upper = out["forehead_movement_symmetry"]
        out["central_pattern_index"] = float(lower - upper)

    # --- tight eye closure: orbicularis oculi strength ---
    if "eye_closure" in per_task:
        ec = per_task["eye_closure"]
        out["eye_closure_L"] = float(np.min(_series(ec, "eye_aperture_L")))
        out["eye_closure_R"] = float(np.min(_series(ec, "eye_aperture_R")))
        out["eye_closure_asymmetry"] = _symmetry(out["eye_closure_L"], out["eye_closure_R"])

    # --- cheek puff: buccinator / lip seal ---
    if "cheek_puff" in per_task:
        cp = per_task["cheek_puff"]
        out["cheek_puff_symmetry"] = float(np.median(_series(cp, "nasolabial_ratio")))

    # --- resting values and tremor, pooled across every task ---
    pooled = [f for frames in per_task.values() for f in frames]
    out["eye_aperture_L"] = float(np.median(_series(pooled, "eye_aperture_L")))
    out["eye_aperture_R"] = float(np.median(_series(pooled, "eye_aperture_R")))
    out["ear_asymmetry"] = float(np.median(_series(pooled, "ear_asymmetry")))

    # Micro-tremor: high-frequency jitter of the mouth corners frame to frame.
    corner = _series(pooled, "corner_drop")
    out["landmark_tremor"] = float(np.mean(np.abs(np.diff(corner)))) if corner.size > 1 else 0.0

    # Blink asymmetry: does one lid close less often than the other?
    ear_l, ear_r = _series(pooled, "eye_aperture_L"), _series(pooled, "eye_aperture_R")
    out["blink_asymmetry"] = _blink_asymmetry(ear_l, ear_r)

    out["valid"] = 1.0
    out["frames_detected"] = float(total_frames)
    out["tasks_completed"] = float(len(per_task))
    return {k: _safe(v) for k, v in out.items()}


def _blink_asymmetry(ear_left: np.ndarray, ear_right: np.ndarray) -> float:
    """Difference in blink count between the two eyes, normalised."""
    def count(series: np.ndarray) -> int:
        if series.size < 3:
            return 0
        threshold = float(np.median(series)) * 0.7
        below = series < threshold
        return int(np.sum((~below[:-1]) & (below[1:])))

    left, right = count(ear_left), count(ear_right)
    return float(abs(left - right) / (left + right + 1e-6))


FACIAL_SCORING_KEYS = [
    "mouth_corner_symmetry", "corner_drop", "nasolabial_ratio",
    "forehead_movement_symmetry", "central_pattern_index",
    "eye_aperture_L", "eye_aperture_R", "ear_asymmetry",
    "eye_closure_asymmetry", "blink_asymmetry", "landmark_tremor",
    "mouth_corner_symmetry_std",
]

# Direction in which a change is clinically worse.
FACIAL_BAD_DIRECTION = {
    "mouth_corner_symmetry": "up",
    "corner_drop": "up",
    "nasolabial_ratio": "up",
    "forehead_movement_symmetry": "up",
    "ear_asymmetry": "up",
    "eye_closure_asymmetry": "up",
    "blink_asymmetry": "up",
    "landmark_tremor": "up",
    "mouth_corner_symmetry_std": "up",
    "eye_aperture_L": "down",
    "eye_aperture_R": "down",
}
