"""
NeuroTrace — voice feature extraction.
Stroke-relevant: dysarthria shows up as unstable pitch (jitter), breathy/noisy voice
(shimmer, low HNR), longer pauses, slower articulation, and altered spectral shape (MFCC).
CPU-only, target <2s per clip.
"""
from __future__ import annotations
import numpy as np, librosa

try:
    import parselmouth
    from parselmouth.praat import call
    HAS_PRAAT = True
except Exception:
    HAS_PRAAT = False

SR = 16000

def _safe(v, default=0.0):
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default

def _praat_voice_quality(path: str) -> dict:
    """jitter/shimmer/HNR — classic dysarthria markers."""
    if not HAS_PRAAT:
        return {"jitter_local": 0.0, "shimmer_local": 0.0, "hnr": 0.0}
    snd = parselmouth.Sound(path)
    pp = call(snd, "To PointProcess (periodic, cc)", 60, 400)
    jitter = call(pp, "Get jitter (local)", 0, 0, 1e-4, 0.02, 1.3)
    shimmer = call([snd, pp], "Get shimmer (local)", 0, 0, 1e-4, 0.02, 1.3, 1.6)
    hnr_obj = call(snd, "To Harmonicity (cc)", 0.01, 60, 0.1, 1.0)
    hnr = call(hnr_obj, "Get mean", 0, 0)
    return {"jitter_local": _safe(jitter), "shimmer_local": _safe(shimmer), "hnr": _safe(hnr)}

def _pause_stats(y: np.ndarray, sr: int) -> dict:
    """Pause ratio + speaking rate proxy. Longer/more pauses = motor speech difficulty."""
    intervals = librosa.effects.split(y, top_db=30)
    speech = sum((e - s) for s, e in intervals) / sr if len(intervals) else 0.0
    total = len(y) / sr if len(y) else 1e-6
    pause_ratio = max(0.0, 1.0 - speech / total)
    n_pauses = max(0, len(intervals) - 1)
    return {
        "pause_ratio": _safe(pause_ratio),
        "n_pauses_per_sec": _safe(n_pauses / total),
        "speech_dur_ratio": _safe(speech / total),
        "articulation_rate": _safe(len(intervals) / speech) if speech > 0.1 else 0.0,
    }

def _f0_stats(y: np.ndarray, sr: int) -> dict:
    f0, vflag, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
    f0v = f0[~np.isnan(f0)] if f0 is not None else np.array([])
    if f0v.size < 3:
        return {"f0_mean": 0.0, "f0_std": 0.0, "f0_cv": 0.0}
    return {
        "f0_mean": _safe(np.mean(f0v)),
        "f0_std": _safe(np.std(f0v)),
        "f0_cv": _safe(np.std(f0v) / (np.mean(f0v) + 1e-6)),
    }

def extract_speech_features(path: str) -> dict:
    """Returns a flat dict of numeric features. Never raises on bad audio."""
    y, sr = librosa.load(path, sr=SR, mono=True)
    if y.size < sr // 2:                      # < 0.5s -> unusable
        return {"valid": 0.0}
    y, _ = librosa.effects.trim(y, top_db=30)
    feats: dict = {"valid": 1.0, "duration_s": _safe(len(y) / sr)}

    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
    for i in range(13):
        feats[f"mfcc{i+1}_mean"] = _safe(np.mean(mfcc[i]))
        feats[f"mfcc{i+1}_std"] = _safe(np.std(mfcc[i]))

    feats.update(_f0_stats(y, sr))
    feats.update(_pause_stats(y, sr))
    feats.update(_praat_voice_quality(path))

    feats["rms_mean"] = _safe(np.mean(librosa.feature.rms(y=y)))
    feats["zcr_mean"] = _safe(np.mean(librosa.feature.zero_crossing_rate(y)))
    feats["spec_centroid"] = _safe(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    return feats

# Features used for deviation scoring (stable, low-noise subset)
SPEECH_SCORING_KEYS = [
    "jitter_local", "shimmer_local", "hnr", "pause_ratio", "n_pauses_per_sec",
    "articulation_rate", "f0_cv", "f0_std", "spec_centroid",
    "mfcc1_mean", "mfcc2_mean", "mfcc3_mean", "mfcc4_mean",
]
