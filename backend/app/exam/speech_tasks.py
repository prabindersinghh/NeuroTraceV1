"""M4 · dysarthria and M2 · tongue/palate — Domain B. M4 maps to NIHSS item 10.

Clinical rationale
------------------
Post-stroke dysarthria is a *motor* speech disorder: the plan is intact, the execution is
not. Three task types probe three different parts of that execution, and each contributes
features the others cannot:

* **Sustained /a/ (5s)** isolates phonation from articulation. Jitter (cycle-to-cycle
  pitch instability), shimmer (amplitude instability) and HNR (breathiness) come from
  here, uncontaminated by what the tongue is doing. Maximum phonation time additionally
  indexes respiratory support, which weakens early.

* **"pa-ta-ka" diadochokinesis (5s)** is the classic bedside test of articulatory agility.
  /p/ is bilabial, /t/ alveolar, /k/ velar — the sequence forces rapid switching across
  the whole vocal tract. DDK *rate* falls and DDK *regularity* degrades in dysarthria, and
  regularity degrades first.

* **Sentence reading** gives connected speech: pause structure, articulation rate and the
  spectral envelope under real coarticulatory load.

The reference implementation in `app/ml/speech.py` is reused verbatim for the sentence
task; this module adds the sustained-phonation and DDK maths that the reference did not
cover, because those tasks did not exist in v1.
"""
from __future__ import annotations

import numpy as np

SR = 16000


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


# --------------------------------------------------------------------------- sustained /a/
def sustained_phonation_features(y: np.ndarray, sr: int = SR) -> dict:
    """Features from a sustained vowel.

    Maximum phonation time is measured as the duration of continuous voicing above an
    energy floor — it is a respiratory-support measure and one of the earliest things to
    shorten when bulbar function declines.
    """
    import librosa

    if y.size < sr // 2:
        return {"valid": 0.0}

    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=256)[0]
    if rms.size == 0:
        return {"valid": 0.0}

    floor = float(np.max(rms)) * 0.15
    voiced = rms > floor
    # Longest continuous voiced run, converted to seconds.
    best = run = 0
    for flag in voiced:
        run = run + 1 if flag else 0
        best = max(best, run)
    mpt = float(best * 256 / sr)

    f0, _, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
    f0v = f0[~np.isnan(f0)] if f0 is not None else np.array([])

    out: dict[str, float] = {
        "valid": 1.0,
        "max_phonation_time": _safe(mpt),
        "phonation_rms_cv": _safe(np.std(rms) / (np.mean(rms) + 1e-9)),
    }
    if f0v.size >= 3:
        out["sustained_f0_mean"] = _safe(np.mean(f0v))
        out["sustained_f0_cv"] = _safe(np.std(f0v) / (np.mean(f0v) + 1e-6))
        # Period-to-period pitch perturbation, a jitter proxy independent of Praat.
        periods = 1.0 / np.clip(f0v, 1e-6, None)
        if periods.size > 1:
            out["sustained_jitter_proxy"] = _safe(
                np.mean(np.abs(np.diff(periods))) / (np.mean(periods) + 1e-12)
            )
    else:
        out["sustained_f0_mean"] = 0.0
        out["sustained_f0_cv"] = 0.0
        out["sustained_jitter_proxy"] = 0.0
    return out


# --------------------------------------------------------------------------- DDK
def ddk_features(y: np.ndarray, sr: int = SR) -> dict:
    """Diadochokinetic rate and regularity from a "pa-ta-ka" repetition.

    Syllable onsets are found as peaks in the spectral-flux envelope. Rate is syllables
    per second; regularity is the coefficient of variation of the inter-syllable intervals.

    Regularity is the more sensitive of the two. A patient compensating for weakness can
    often hold their rate up for a few seconds while the *evenness* of the sequence has
    already deteriorated.
    """
    import librosa

    if y.size < sr // 2:
        return {"valid": 0.0}

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=128)
    if onset_env.size < 4:
        return {"valid": 0.0}

    peaks = librosa.util.peak_pick(
        onset_env, pre_max=3, post_max=3, pre_avg=5, post_avg=5, delta=0.2, wait=4
    )
    duration = float(y.size / sr)
    n_syll = int(len(peaks))

    out: dict[str, float] = {
        "valid": 1.0,
        "ddk_syllables": float(n_syll),
        "ddk_rate": _safe(n_syll / duration) if duration > 0 else 0.0,
    }

    if n_syll >= 3:
        times = np.asarray(peaks, dtype=float) * 128 / sr
        intervals = np.diff(times)
        intervals = intervals[intervals > 0.02]
        if intervals.size >= 2:
            out["ddk_interval_mean"] = _safe(np.mean(intervals))
            out["ddk_regularity"] = _safe(np.std(intervals) / (np.mean(intervals) + 1e-9))
            # Fatigue across the run: do intervals lengthen toward the end?
            x = np.arange(intervals.size, dtype=float)
            out["ddk_decay_slope"] = _safe(np.polyfit(x, intervals, 1)[0])
        else:
            out["ddk_interval_mean"] = 0.0
            out["ddk_regularity"] = 0.0
            out["ddk_decay_slope"] = 0.0
    else:
        out["ddk_interval_mean"] = 0.0
        out["ddk_regularity"] = 0.0
        out["ddk_decay_slope"] = 0.0
    return out


# --------------------------------------------------------------------------- module M4
def extract_dysarthria(raw: dict) -> dict:
    """Combine sustained /a/, DDK and sentence reading into one feature vector.

    `raw` = {"sustained_a": path_or_array, "ddk": path_or_array, "sentence": path_or_array}
    Paths are loaded with librosa; arrays are used directly (the browser sends PCM).
    """
    import librosa

    from ..ml.speech import extract_speech_features

    def load(item) -> np.ndarray:
        if item is None:
            return np.array([])
        if isinstance(item, (str,)):
            y, _ = librosa.load(item, sr=SR, mono=True)
            return y
        return np.asarray(item, dtype=float)

    out: dict[str, float] = {}
    completed = 0

    y_sust = load(raw.get("sustained_a"))
    if y_sust.size:
        sust = sustained_phonation_features(y_sust)
        if sust.get("valid") == 1.0:
            completed += 1
            out.update({k: v for k, v in sust.items() if k != "valid"})

    y_ddk = load(raw.get("ddk"))
    if y_ddk.size:
        ddk = ddk_features(y_ddk)
        if ddk.get("valid") == 1.0:
            completed += 1
            out.update({k: v for k, v in ddk.items() if k != "valid"})

    sentence = raw.get("sentence")
    if isinstance(sentence, str):
        # The verbatim reference extractor — MFCCs, jitter/shimmer/HNR, pauses, F0.
        feats = extract_speech_features(sentence)
        if feats.get("valid") == 1.0:
            completed += 1
            out.update({k: v for k, v in feats.items() if k != "valid"})

    if completed == 0:
        return {"valid": 0.0, "tasks_completed": 0.0}

    out["valid"] = 1.0
    out["tasks_completed"] = float(completed)
    return {k: _safe(v) for k, v in out.items()}


DYSARTHRIA_SCORING_KEYS = [
    # phonation
    "jitter_local", "shimmer_local", "hnr", "max_phonation_time",
    "sustained_f0_cv", "sustained_jitter_proxy", "phonation_rms_cv",
    # articulation agility
    "ddk_rate", "ddk_regularity", "ddk_decay_slope",
    # connected speech
    "articulation_rate", "pause_ratio", "n_pauses_per_sec", "f0_cv", "spec_centroid",
    "mfcc1_mean", "mfcc2_mean", "mfcc3_mean", "mfcc4_mean",
]

DYSARTHRIA_BAD_DIRECTION = {
    "jitter_local": "up", "shimmer_local": "up", "hnr": "down",
    "max_phonation_time": "down", "sustained_f0_cv": "up",
    "sustained_jitter_proxy": "up", "phonation_rms_cv": "up",
    "ddk_rate": "down", "ddk_regularity": "up", "ddk_decay_slope": "up",
    "articulation_rate": "down", "pause_ratio": "up", "n_pauses_per_sec": "up",
    "f0_cv": "up",
}


# --------------------------------------------------------------------------- module M2
def extract_tongue_palate(raw: dict) -> dict:
    """M2 · tongue protrusion and palate elevation. WEEKLY.

    Tongue deviation on protrusion points *toward* the weak side in a hypoglossal or
    corticobulbar lesion, so the signed angle carries lateralising information that a
    magnitude alone would lose.

    `raw` = {"tongue_landmarks": [[x,y] ...], "midline": [x,y], "ahh_audio": array}
    """
    out: dict[str, float] = {}

    tongue = raw.get("tongue_landmarks")
    midline = raw.get("midline")
    if isinstance(tongue, list) and len(tongue) >= 2 and isinstance(midline, list):
        tip = np.asarray(tongue[0], dtype=float)[:2]
        base = np.asarray(tongue[-1], dtype=float)[:2]
        mid = np.asarray(midline, dtype=float)[:2]
        axis = tip - base
        if np.linalg.norm(axis) > 1e-6:
            reference = np.array([0.0, -1.0])
            cos = float(np.dot(axis, reference) / (np.linalg.norm(axis) + 1e-9))
            angle = float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))
            # Sign it: positive = deviates to the patient's left.
            out["tongue_deviation_angle"] = angle * (1.0 if tip[0] < mid[0] else -1.0)
            out["tongue_deviation_abs"] = angle
            out["tongue_protrusion_length"] = float(np.linalg.norm(axis))

    audio = raw.get("ahh_audio")
    if audio is not None:
        y = np.asarray(audio, dtype=float)
        if y.size > SR // 2:
            phon = sustained_phonation_features(y)
            if phon.get("valid") == 1.0:
                out["palate_phonation_time"] = phon["max_phonation_time"]
                out["palate_f0_cv"] = phon.get("sustained_f0_cv", 0.0)
                # Hypernasality proxy: low-frequency energy share rises when the palate
                # fails to seal the nasal port.
                import librosa
                spec = np.abs(librosa.stft(y, n_fft=1024))
                freqs = librosa.fft_frequencies(sr=SR, n_fft=1024)
                low = spec[freqs < 500].sum()
                total = spec.sum() + 1e-9
                out["nasality_index"] = float(low / total)

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


TONGUE_SCORING_KEYS = [
    "tongue_deviation_abs", "tongue_protrusion_length",
    "palate_phonation_time", "palate_f0_cv", "nasality_index",
]

TONGUE_BAD_DIRECTION = {
    "tongue_deviation_abs": "up", "tongue_protrusion_length": "down",
    "palate_phonation_time": "down", "palate_f0_cv": "up", "nasality_index": "up",
}
