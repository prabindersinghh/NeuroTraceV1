"""M10 attention/speed · M11 memory/executive · M12 neglect — Domain E.
M12 maps to NIHSS item 11.

Clinical rationale
------------------
**Reaction-time variability, not reaction time.** The most robust finding in the
cognitive-ageing literature is that intra-individual *variability* of response time is a
more sensitive marker of neural integrity than mean speed. A patient can maintain their
median RT by trying harder while their consistency collapses. So `rt_cov` is the headline
feature and `rt_median` is supporting evidence.

**Education stratification is mandatory in this population.** Trail Making and digit span
are heavily education-dependent, and a large share of Tier-2/3 Indian patients aged 55-75
have limited formal schooling. Applying Western literate norms would classify normal
low-education performance as impairment. We therefore never compare to a population norm at
all — only to the patient's own baseline — and additionally tag which normative band
applies so a clinician reading the export knows the context.

**Neglect is asymmetric by construction.** Line bisection deviates toward the side of the
lesion; cancellation tasks show omissions contralateral to it. The left/right omission
*difference* is the signal, not the total.
"""
from __future__ import annotations

import numpy as np


def _safe(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if np.isfinite(f) else default
    except Exception:
        return default


# Education bands used only for annotation, never as a threshold.
EDUCATION_BANDS = ("illiterate", "primary", "secondary", "tertiary")


# --------------------------------------------------------------------------- M10
def simple_rt_features(latencies_ms: list[float], misses: int = 0,
                       false_starts: int = 0) -> dict:
    """Simple reaction time over 12 trials."""
    lat = np.asarray([x for x in (latencies_ms or []) if x and float(x) > 80], dtype=float)
    if lat.size < 4:
        return {}

    median = float(np.median(lat))
    q75, q25 = np.percentile(lat, [75, 25])
    lapses = float(np.sum(lat > median * 2.0))

    out = {
        "rt_median": _safe(median),
        "rt_mean": _safe(np.mean(lat)),
        "rt_iqr": _safe(q75 - q25),
        # The headline measure.
        "rt_cov": _safe(np.std(lat) / (np.mean(lat) + 1e-9)),
        "lapse_rate": _safe(lapses / lat.size),
        "miss_rate": _safe(misses / max(1.0, lat.size + misses)),
        "false_start_rate": _safe(false_starts / max(1.0, lat.size)),
        "rt_trials": float(lat.size),
    }
    if lat.size >= 5:
        x = np.arange(lat.size, dtype=float)
        out["attention_decay_slope"] = _safe(np.polyfit(x, lat, 1)[0])
        half = lat.size // 2
        out["fatigue_delta"] = _safe(np.median(lat[half:]) - np.median(lat[:half]))
    return out


def choice_rt_features(trials: list[dict]) -> dict:
    """Choice RT adds a decision stage; the difference from simple RT isolates it."""
    valid = [t for t in (trials or []) if t.get("latency_ms")]
    if len(valid) < 4:
        return {}
    lat = np.asarray([float(t["latency_ms"]) for t in valid], dtype=float)
    correct = [bool(t.get("correct", True)) for t in valid]
    return {
        "choice_rt_median": _safe(np.median(lat)),
        "choice_rt_cov": _safe(np.std(lat) / (np.mean(lat) + 1e-9)),
        "choice_accuracy": _safe(sum(correct) / len(correct)),
    }


def extract_attention_speed(raw: dict) -> dict:
    """`raw` = {"simple_rt": {"latencies_ms": [...], "misses": int, "false_starts": int},
                "choice_rt": [{"latency_ms": float, "correct": bool}, ...],
                "tmt_a_seconds": float, "tmt_a_errors": int}
    """
    out: dict[str, float] = {}
    completed = 0

    simple = raw.get("simple_rt") or {}
    feats = simple_rt_features(simple.get("latencies_ms"),
                               int(simple.get("misses", 0) or 0),
                               int(simple.get("false_starts", 0) or 0))
    if feats:
        out.update(feats)
        completed += 1

    feats = choice_rt_features(raw.get("choice_rt"))
    if feats:
        out.update(feats)
        completed += 1
        if "rt_median" in out and "choice_rt_median" in out:
            # Decision cost: the pure processing component.
            out["decision_cost_ms"] = _safe(out["choice_rt_median"] - out["rt_median"])

    if raw.get("tmt_a_seconds"):
        out["tmt_a_seconds"] = _safe(raw["tmt_a_seconds"])
        out["tmt_a_errors"] = _safe(raw.get("tmt_a_errors", 0))
        completed += 1

    if completed == 0:
        return {"valid": 0.0, "tasks_completed": 0.0}
    out["valid"] = 1.0
    out["tasks_completed"] = float(completed)
    return {k: _safe(v) for k, v in out.items()}


ATTENTION_SCORING_KEYS = [
    "rt_median", "rt_cov", "rt_iqr", "lapse_rate", "miss_rate",
    "attention_decay_slope", "fatigue_delta",
    "choice_rt_median", "choice_rt_cov", "choice_accuracy",
    "decision_cost_ms", "tmt_a_seconds",
]

ATTENTION_BAD_DIRECTION = {
    "rt_median": "up", "rt_cov": "up", "rt_iqr": "up", "lapse_rate": "up",
    "miss_rate": "up", "attention_decay_slope": "up", "fatigue_delta": "up",
    "choice_rt_median": "up", "choice_rt_cov": "up", "choice_accuracy": "down",
    "decision_cost_ms": "up", "tmt_a_seconds": "up",
}


# --------------------------------------------------------------------------- M11
def extract_memory_executive(raw: dict) -> dict:
    """`raw` = {"recall_immediate": int, "recall_delayed": int, "recall_total": int,
                "span_forward": int, "span_backward": int,
                "tmt_b_seconds": float, "tmt_a_seconds": float,
                "clock_score": int, "education_band": str}
    """
    out: dict[str, float] = {}

    for key in ("recall_immediate", "recall_delayed", "span_forward",
                "span_backward", "clock_score"):
        if raw.get(key) is not None:
            out[key] = _safe(raw[key])

    if raw.get("recall_immediate") is not None and raw.get("recall_delayed") is not None:
        # Retention ratio separates an encoding failure from a retrieval failure.
        immediate = _safe(raw["recall_immediate"])
        out["retention_ratio"] = _safe(_safe(raw["recall_delayed"]) / (immediate + 1e-9))

    if raw.get("span_forward") is not None and raw.get("span_backward") is not None:
        # Backward span loads working memory; the gap is the executive component.
        out["span_gap"] = _safe(_safe(raw["span_forward"]) - _safe(raw["span_backward"]))

    if raw.get("tmt_b_seconds") is not None:
        out["tmt_b_seconds"] = _safe(raw["tmt_b_seconds"])
        if raw.get("tmt_a_seconds") is not None:
            # B minus A removes motor speed, leaving set-shifting.
            out["tmt_b_minus_a"] = _safe(
                _safe(raw["tmt_b_seconds"]) - _safe(raw["tmt_a_seconds"])
            )

    band = raw.get("education_band")
    if band in EDUCATION_BANDS:
        out["education_band_index"] = float(EDUCATION_BANDS.index(band))

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


MEMORY_SCORING_KEYS = [
    "recall_immediate", "recall_delayed", "retention_ratio",
    "span_forward", "span_backward", "span_gap",
    "tmt_b_seconds", "tmt_b_minus_a", "clock_score",
]

MEMORY_BAD_DIRECTION = {
    "recall_immediate": "down", "recall_delayed": "down", "retention_ratio": "down",
    "span_forward": "down", "span_backward": "down", "span_gap": "up",
    "tmt_b_seconds": "up", "tmt_b_minus_a": "up", "clock_score": "down",
}


# --------------------------------------------------------------------------- M12
def extract_neglect(raw: dict) -> dict:
    """Line bisection and star cancellation.

    `raw` = {"bisections": [{"line_length": float, "mark_offset": float}, ...],
             "cancellation": {"left_total": int, "left_found": int,
                              "right_total": int, "right_found": int}}
    """
    out: dict[str, float] = {}

    bisections = raw.get("bisections")
    if isinstance(bisections, list) and bisections:
        deviations = []
        for b in bisections:
            length = float(b.get("line_length") or 0)
            offset = float(b.get("mark_offset") or 0)  # signed, + = rightward
            if length > 0:
                deviations.append(offset / (length / 2.0))  # normalised, -1..1
        if deviations:
            out["bisection_deviation"] = _safe(np.mean(deviations))
            out["bisection_deviation_abs"] = _safe(np.mean(np.abs(deviations)))
            out["bisection_variability"] = _safe(np.std(deviations))

    canc = raw.get("cancellation") or {}
    if canc:
        lt = float(canc.get("left_total") or 0)
        lf = float(canc.get("left_found") or 0)
        rt = float(canc.get("right_total") or 0)
        rf = float(canc.get("right_found") or 0)
        if lt > 0:
            out["left_omissions"] = _safe(lt - lf)
            out["left_omission_rate"] = _safe((lt - lf) / lt)
        if rt > 0:
            out["right_omissions"] = _safe(rt - rf)
            out["right_omission_rate"] = _safe((rt - rf) / rt)
        if lt > 0 and rt > 0:
            # The lateralised signal. Symmetric omissions mean inattention, not neglect.
            out["omission_asymmetry"] = _safe(
                abs(out["left_omission_rate"] - out["right_omission_rate"])
            )

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


NEGLECT_SCORING_KEYS = [
    "bisection_deviation_abs", "bisection_variability",
    "left_omission_rate", "right_omission_rate", "omission_asymmetry",
]

NEGLECT_BAD_DIRECTION = {
    "bisection_deviation_abs": "up", "bisection_variability": "up",
    "left_omission_rate": "up", "right_omission_rate": "up",
    "omission_asymmetry": "up",
}


# --------------------------------------------------------------------------- M3
def extract_ocular(raw: dict) -> dict:
    """M3 · ocular pursuit and visual fields — Domain A. MONTHLY.

    `raw` = {"pursuit": [{"gaze": [x,y], "target": [x,y]} ...], "fps": float,
             "field_check": {"quadrant_TL": bool, "quadrant_TR": bool,
                             "quadrant_BL": bool, "quadrant_BR": bool}}
    """
    out: dict[str, float] = {}

    pursuit = raw.get("pursuit")
    if isinstance(pursuit, list) and len(pursuit) >= 10:
        gaze = np.asarray([p["gaze"] for p in pursuit if "gaze" in p], dtype=float)
        target = np.asarray([p["target"] for p in pursuit if "target" in p], dtype=float)
        if gaze.shape == target.shape and gaze.shape[0] >= 10:
            error = np.linalg.norm(gaze - target, axis=1)
            out["pursuit_error_mean"] = _safe(np.mean(error))
            out["pursuit_error_cv"] = _safe(np.std(error) / (np.mean(error) + 1e-9))
            # Smooth pursuit should track continuously; saccadic intrusions show as
            # spikes in gaze velocity.
            velocity = np.linalg.norm(np.diff(gaze, axis=0), axis=1)
            if velocity.size > 2:
                threshold = float(np.median(velocity) * 3.0)
                out["saccadic_intrusions"] = float(np.sum(velocity > threshold))
                out["pursuit_smoothness"] = _safe(1.0 / (1.0 + np.std(velocity)))

    field = raw.get("field_check") or {}
    if field:
        missed = [k for k, seen in field.items() if not seen]
        out["field_defect_count"] = float(len(missed))
        left_missed = sum(1 for k in missed if k.endswith("L"))
        right_missed = sum(1 for k in missed if k.endswith("R"))
        out["field_asymmetry"] = float(abs(left_missed - right_missed))

    if not out:
        return {"valid": 0.0}
    out["valid"] = 1.0
    return {k: _safe(v) for k, v in out.items()}


OCULAR_SCORING_KEYS = [
    "pursuit_error_mean", "pursuit_error_cv", "pursuit_smoothness",
    "saccadic_intrusions", "field_defect_count", "field_asymmetry",
]

OCULAR_BAD_DIRECTION = {
    "pursuit_error_mean": "up", "pursuit_error_cv": "up",
    "pursuit_smoothness": "down", "saccadic_intrusions": "up",
    "field_defect_count": "up", "field_asymmetry": "up",
}
