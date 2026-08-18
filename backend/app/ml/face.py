"""
NeuroTrace — facial feature extraction via MediaPipe FaceMesh (468 landmarks, pretrained).
Stroke-relevant: unilateral facial weakness -> mouth/smile asymmetry, uneven eye aperture,
reduced blink on affected side, and micro-tremor in landmark position.
"""
from __future__ import annotations
import numpy as np, cv2
import mediapipe as mp

mp_face = mp.solutions.face_mesh

# FaceMesh landmark indices
L_MOUTH, R_MOUTH = 61, 291
UP_LIP, LOW_LIP = 13, 14
L_EYE = [33, 160, 158, 133, 153, 144]
R_EYE = [362, 385, 387, 263, 373, 380]
L_BROW, R_BROW = 105, 334
NOSE_TIP, CHIN = 1, 199

def _safe(v, d=0.0):
    try:
        f = float(v)
        return f if np.isfinite(f) else d
    except Exception:
        return d

def _ear(pts, idx):
    """Eye aspect ratio — vertical/horizontal. Drops when eye can't open fully."""
    p = pts[idx]
    v = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
    h = 2.0 * np.linalg.norm(p[0] - p[3]) + 1e-6
    return v / h

def _frame_features(pts: np.ndarray) -> dict:
    """pts: (468,3) normalized landmarks for one frame."""
    # Midline from nose->chin; measure how far each mouth corner sits from it
    mid = (pts[NOSE_TIP][:2] + pts[CHIN][:2]) / 2.0
    face_w = np.linalg.norm(pts[L_MOUTH][:2] - pts[R_MOUTH][:2]) + 1e-6

    dl = np.linalg.norm(pts[L_MOUTH][:2] - mid)
    dr = np.linalg.norm(pts[R_MOUTH][:2] - mid)
    mouth_sym = abs(dl - dr) / (dl + dr + 1e-6)          # 0 = symmetric

    # Vertical corner height difference (droop)
    corner_drop = abs(pts[L_MOUTH][1] - pts[R_MOUTH][1]) / face_w

    earl, earr = _ear(pts, L_EYE), _ear(pts, R_EYE)
    eye_asym = abs(earl - earr) / (earl + earr + 1e-6)

    brow_asym = abs((pts[L_BROW][1] - pts[NOSE_TIP][1]) -
                    (pts[R_BROW][1] - pts[NOSE_TIP][1])) / face_w

    mouth_open = abs(pts[UP_LIP][1] - pts[LOW_LIP][1]) / face_w

    return {
        "mouth_symmetry": _safe(mouth_sym),
        "corner_drop": _safe(corner_drop),
        "ear_left": _safe(earl), "ear_right": _safe(earr),
        "eye_asymmetry": _safe(eye_asym),
        "brow_asymmetry": _safe(brow_asym),
        "mouth_open": _safe(mouth_open),
    }

def extract_face_features(video_path: str, max_frames: int = 90) -> dict:
    cap = cv2.VideoCapture(video_path)
    per_frame, mouth_track, blink_series = [], [], []
    with mp_face.FaceMesh(static_image_mode=False, max_num_faces=1,
                          refine_landmarks=True, min_detection_confidence=0.5) as fm:
        n = 0
        while n < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            n += 1
            res = fm.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            if not res.multi_face_landmarks:
                continue
            lm = res.multi_face_landmarks[0].landmark
            pts = np.array([[p.x, p.y, p.z] for p in lm])
            f = _frame_features(pts)
            per_frame.append(f)
            mouth_track.append(pts[L_MOUTH][:2].tolist() + pts[R_MOUTH][:2].tolist())
            blink_series.append((f["ear_left"] + f["ear_right"]) / 2.0)
    cap.release()

    if len(per_frame) < 5:
        return {"valid": 0.0, "frames_detected": float(len(per_frame))}

    out = {"valid": 1.0, "frames_detected": float(len(per_frame))}
    keys = per_frame[0].keys()
    for k in keys:
        vals = np.array([f[k] for f in per_frame], dtype=float)
        out[f"{k}_mean"] = _safe(np.mean(vals))
        out[f"{k}_std"] = _safe(np.std(vals))

    # Tremor: high-frequency jitter of mouth landmarks across frames
    mt = np.array(mouth_track)
    out["landmark_tremor"] = _safe(np.mean(np.std(np.diff(mt, axis=0), axis=0)))

    # Blink rate: EAR dips below 70% of median
    b = np.array(blink_series)
    thr = np.median(b) * 0.7
    below = b < thr
    blinks = int(np.sum((~below[:-1]) & (below[1:])))
    out["blink_count"] = float(blinks)
    out["blink_rate_per_frame"] = _safe(blinks / len(b))
    return out

FACE_SCORING_KEYS = [
    "mouth_symmetry_mean", "corner_drop_mean", "eye_asymmetry_mean",
    "brow_asymmetry_mean", "landmark_tremor", "blink_rate_per_frame",
    "mouth_symmetry_std", "ear_left_mean", "ear_right_mean",
]
