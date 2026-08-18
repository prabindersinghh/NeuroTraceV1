"""M17 rhythm · M18 blood pressure · M19 adherence · M20 symptom log — Domain G.

Clinical rationale
------------------
Secondary prevention is where the actual mortality reduction lives. One in four stroke
survivors has another stroke, and the dominant modifiable drivers are blood pressure,
medication adherence and undetected atrial fibrillation. A monitoring product that watches
only the neurological exam and ignores these is watching the consequence and not the cause.

**M17 rhythm** derives inter-beat intervals from a PPG waveform captured with the phone
camera and flashlight. The output is deliberately constrained:

    "an irregular rhythm was seen — please get an ECG"

and never "you have atrial fibrillation". PPG-based irregularity has a meaningful false
positive rate from motion and ectopy, and AF is a diagnosis that requires an ECG. Saying
otherwise would be both wrong and, under Indian medical-device rules, a different product.

The features (RMSSD, pNN50, RR irregularity, Poincaré SD1/SD2) are the standard HRV set
used in the PhysioNet AF Challenge, which `03_DATASETS_v2.md` proposes for threshold
validation.
"""
from __future__ import annotations

import numpy as np

# Physiological bounds for accepting a beat interval (ms).
RR_MIN_MS, RR_MAX_MS = 300.0, 2000.0
IRREGULARITY_ADVISORY_THRESHOLD = 0.20  # RR irregularity index above which we advise an ECG

# BP categories (Indian/ISH guidance; used for annotation only, never diagnosis).
BP_BANDS = [
    (0, 120, 0, 80, "optimal"),
    (120, 130, 80, 85, "normal"),
    (130, 140, 85, 90, "high-normal"),
    (140, 160, 90, 100, "grade 1 elevated"),
    (160, 180, 100, 110, "grade 2 elevated"),
    (180, 999, 110, 999, "grade 3 elevated"),
]
BP_URGENT_SYS, BP_URGENT_DIA = 180, 110


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


# --------------------------------------------------------------------------- M17
def detect_beats(ppg: np.ndarray, fs: float) -> np.ndarray:
    """Beat times (seconds) from a PPG waveform.

    Band-passes to the plausible cardiac range, then takes rising-edge zero crossings of
    the differentiated signal above an adaptive threshold. Deliberately simple and
    deterministic — no learned peak detector in the clinical path.
    """
    if ppg.size < int(fs * 3):
        return np.array([])

    x = ppg - np.mean(ppg)
    # Moving-average band-pass: remove baseline wander, smooth high-frequency noise.
    def moving(sig: np.ndarray, w: int) -> np.ndarray:
        w = max(1, int(w))
        kernel = np.ones(w) / w
        return np.convolve(sig, kernel, mode="same")

    baseline = moving(x, int(fs * 1.5))
    smooth = moving(x - baseline, max(2, int(fs * 0.05)))

    d = np.diff(smooth)
    if d.size < 3:
        return np.array([])
    threshold = float(np.percentile(d, 75))
    if threshold <= 0:
        return np.array([])

    peaks: list[int] = []
    refractory = int(fs * 0.3)  # no two beats closer than 300 ms
    i = 1
    while i < d.size:
        if d[i - 1] <= threshold < d[i]:
            window_end = min(smooth.size, i + int(fs * 0.3))
            peak = i + int(np.argmax(smooth[i:window_end])) if window_end > i else i
            if not peaks or (peak - peaks[-1]) >= refractory:
                peaks.append(peak)
            i = peak + refractory
        else:
            i += 1
    return np.asarray(peaks, dtype=float) / fs


def rr_features(rr_ms: np.ndarray) -> dict:
    """Standard HRV / irregularity set from inter-beat intervals."""
    rr = rr_ms[(rr_ms >= RR_MIN_MS) & (rr_ms <= RR_MAX_MS)]
    if rr.size < 5:
        return {}

    diffs = np.diff(rr)
    rmssd = float(np.sqrt(np.mean(diffs ** 2))) if diffs.size else 0.0
    pnn50 = float(np.sum(np.abs(diffs) > 50.0) / diffs.size) if diffs.size else 0.0

    # Poincaré geometry — SD1 is short-term (beat-to-beat) variability, SD2 long-term.
    sd1 = float(np.std(diffs) / np.sqrt(2.0)) if diffs.size else 0.0
    sd2 = float(np.sqrt(max(0.0, 2.0 * np.var(rr) - 0.5 * np.var(diffs))))

    mean_rr = float(np.mean(rr))
    return {
        "mean_hr": _safe(60000.0 / mean_rr) if mean_rr > 0 else 0.0,
        "mean_rr": _safe(mean_rr),
        "sdnn": _safe(np.std(rr)),
        "rmssd": _safe(rmssd),
        "pnn50": _safe(pnn50),
        # The AF-relevant measure: normalised dispersion of successive intervals.
        "rr_irregularity_index": _safe(rmssd / (mean_rr + 1e-9)),
        "poincare_sd1": _safe(sd1),
        "poincare_sd2": _safe(sd2),
        "poincare_ratio": _safe(sd1 / (sd2 + 1e-9)),
        "n_beats": float(rr.size + 1),
    }


def extract_rhythm(raw: dict) -> dict:
    """`raw` = {"ppg": [...], "fs": float}  or  {"rr_ms": [...]}"""
    out: dict = {}

    if raw.get("rr_ms"):
        rr = np.asarray(raw["rr_ms"], dtype=float)
        out.update(rr_features(rr))
    elif raw.get("ppg"):
        ppg = np.asarray(raw["ppg"], dtype=float)
        fs = float(raw.get("fs") or 30.0)
        beats = detect_beats(ppg, fs)
        if beats.size >= 6:
            out.update(rr_features(np.diff(beats) * 1000.0))
            out["signal_seconds"] = float(ppg.size / fs)

    if not out:
        return {"valid": 0.0}

    irregular = out.get("rr_irregularity_index", 0.0) >= IRREGULARITY_ADVISORY_THRESHOLD
    out["irregular_rhythm_flag"] = 1.0 if irregular else 0.0
    # Wording is fixed and non-diagnostic by design.
    out["advisory"] = (
        "an irregular heart rhythm was seen during this reading - please arrange an ECG "
        "with your doctor" if irregular else ""
    )
    out["valid"] = 1.0
    return out


RHYTHM_SCORING_KEYS = [
    "mean_hr", "sdnn", "rmssd", "pnn50", "rr_irregularity_index",
    "poincare_sd1", "poincare_sd2", "poincare_ratio",
]

# Only the irregularity measures carry a direction. The raw HRV magnitudes (mean_hr,
# sdnn, rmssd, poincare_sd1/sd2) are recorded as context but left directionless on
# purpose: low SDNN indicates cardiac risk, while a high RMSSD in this setting indicates
# the beat-to-beat irregularity we are screening for. Assigning either a "worse"
# direction would encode a claim we cannot defend, so the directional signal comes from
# rr_irregularity_index alone.
RHYTHM_BAD_DIRECTION = {
    "rr_irregularity_index": "up", "pnn50": "up", "poincare_ratio": "up",
}


# --------------------------------------------------------------------------- M18
def extract_blood_pressure(raw: dict) -> dict:
    """Manual entry or a connected cuff. Annotation only — never a diagnosis."""
    sys_bp = raw.get("bp_sys")
    dia_bp = raw.get("bp_dia")
    if sys_bp is None or dia_bp is None:
        return {"valid": 0.0}

    s, d = _safe(sys_bp), _safe(dia_bp)
    band = "optimal"
    for lo_s, hi_s, lo_d, hi_d, name in BP_BANDS:
        if lo_s <= s < hi_s or lo_d <= d < hi_d:
            band = name
    urgent = s >= BP_URGENT_SYS or d >= BP_URGENT_DIA

    return {
        "valid": 1.0,
        "bp_sys": s,
        "bp_dia": d,
        "pulse_pressure": _safe(s - d),
        "bp_band": band,
        "bp_urgent_flag": 1.0 if urgent else 0.0,
        "advisory": (
            "this blood pressure reading is very high - please contact your doctor today"
            if urgent else ""
        ),
    }


BP_SCORING_KEYS = ["bp_sys", "bp_dia", "pulse_pressure"]
BP_BAD_DIRECTION = {"bp_sys": "up", "bp_dia": "up", "pulse_pressure": "up"}


# --------------------------------------------------------------------------- M19
def extract_adherence(raw: dict) -> dict:
    """Two-tap medication confirmation, plus a rolling streak.

    Adherence is the most modifiable secondary-prevention lever there is, and a falling
    streak is itself a leading indicator: patients stop taking medication when they feel
    unwell, confused or low.
    """
    taken = raw.get("taken")
    if taken is None:
        return {"valid": 0.0}
    history = [bool(x) for x in (raw.get("history") or [])]
    window = history[-30:] if history else []
    streak = 0
    for flag in reversed(history):
        if flag:
            streak += 1
        else:
            break
    return {
        "valid": 1.0,
        "taken": 1.0 if taken else 0.0,
        "adherence_streak": float(streak),
        "adherence_rate_30d": _safe(sum(window) / len(window)) if window else 0.0,
    }


ADHERENCE_SCORING_KEYS = ["adherence_rate_30d"]
ADHERENCE_BAD_DIRECTION = {"adherence_rate_30d": "down"}


# --------------------------------------------------------------------------- M20
ACUTE_SYMPTOMS = {
    "sudden_weakness", "sudden_numbness", "face_droop_new", "speech_loss_sudden",
    "vision_loss_sudden", "worst_headache", "loss_of_consciousness", "seizure",
    "severe_imbalance_sudden",
}


def extract_symptom_log(raw: dict) -> dict:
    """Structured symptom checkboxes plus free-text caregiver notes.

    Any acute symptom sets `acute_flag`, which the safety layer uses to bypass scoring
    entirely (TRD §8). This module never decides what to do about it — it only reports.
    """
    symptoms = [str(s) for s in (raw.get("symptoms") or [])]
    acute = sorted(set(symptoms) & ACUTE_SYMPTOMS)
    return {
        "valid": 1.0,
        "symptom_count": float(len(symptoms)),
        "acute_flag": 1.0 if acute else 0.0,
        "acute_symptoms": acute,
        "note_length": float(len(str(raw.get("note") or ""))),
    }


SYMPTOM_SCORING_KEYS: list[str] = []
SYMPTOM_BAD_DIRECTION: dict[str, str] = {}
