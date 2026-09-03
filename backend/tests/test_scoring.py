"""What survives of `app/ml/`: the per-patient baseline and the explainer.

The stability-score and alert-gate halves were deleted with `app/ml/scoring.py` — see that
module's note in `app/ml/__init__.py`. They tested a second alert implementation with no
laterality gate and no caller. The live gate's equivalents live in `tests/test_engine.py`
(`test_quiet_sessions_are_stable`, `test_two_domains_sustained_is_alert`,
`test_two_domains_sustained_without_laterality_is_not_an_alert`) and `tests/test_laterality.py`.
"""
from __future__ import annotations

import pytest

from app.ml.baseline import BASELINE_DAYS, MIN_STD, build_baseline, modality_deviation, z_scores
from app.ml.explain import TEMPLATES, explain, top_drivers
KEYS = ["a", "b"]

# --------------------------------------------------------------------------- baseline
def test_build_baseline_needs_at_least_two_valid_days():
    built = build_baseline([{"valid": 1.0, "a": 1.0, "b": 2.0}], KEYS)
    assert built["ready"] is False
    assert built["n_days"] == 1
    assert built["mean"] == {} and built["std"] == {}


def test_build_baseline_ignores_invalid_days():
    days = [{"valid": 1.0, "a": 1.0, "b": 1.0}] * 3 + [{"valid": 0.0}] * 5
    built = build_baseline(days, KEYS)
    assert built["n_days"] == 3
    assert built["ready"] is True


def test_build_baseline_means_and_std_floor():
    days = [{"valid": 1.0, "a": 10.0, "b": 0.0} for _ in range(4)]
    built = build_baseline(days, KEYS)
    assert built["mean"]["a"] == pytest.approx(10.0)
    # constant feature -> std floored at max(0, MIN_STD, |mean| * 0.02)
    assert built["std"]["a"] == pytest.approx(0.2)
    assert built["std"]["b"] == pytest.approx(MIN_STD)


def test_build_baseline_real_std_wins_when_larger():
    days = [{"valid": 1.0, "a": v, "b": 0.0} for v in (8.0, 10.0, 12.0, 10.0)]
    built = build_baseline(days, KEYS)
    assert built["std"]["a"] == pytest.approx(1.4142135, rel=1e-6)


# --------------------------------------------------------------------------- z-scores
def test_z_scores_are_empty_until_the_baseline_is_ready():
    assert z_scores({"a": 5.0}, {"ready": False, "mean": {}, "std": {}}, KEYS) == {}


def test_z_scores_against_a_known_baseline():
    baseline = {"ready": True, "mean": {"a": 10.0, "b": 0.0}, "std": {"a": 2.0, "b": 1.0}}
    zs = z_scores({"a": 14.0, "b": -3.0}, baseline, KEYS)
    assert zs["a"] == pytest.approx(2.0, abs=1e-6)
    assert zs["b"] == pytest.approx(-3.0, abs=1e-6)


def test_missing_feature_falls_back_to_the_baseline_mean_so_z_is_zero():
    baseline = {"ready": True, "mean": {"a": 10.0, "b": 4.0}, "std": {"a": 2.0, "b": 1.0}}
    zs = z_scores({"a": 10.0}, baseline, KEYS)
    assert zs["b"] == pytest.approx(0.0, abs=1e-9)


# --------------------------------------------------------------------------- deviation
def test_modality_deviation_is_the_mean_absolute_z():
    assert modality_deviation({"a": 2.0, "b": -4.0}) == pytest.approx(3.0)


def test_modality_deviation_clips_a_single_runaway_feature():
    # 100 is clipped to 6 before averaging, so one broken feature cannot dominate.
    assert modality_deviation({"a": 100.0, "b": 0.0}) == pytest.approx(3.0)


def test_modality_deviation_of_nothing_is_zero():
    assert modality_deviation({}) == 0.0


# --------------------------------------------------------------------------- explainability
def test_top_drivers_only_keeps_the_clinically_bad_direction():
    # pause_ratio is bad when UP, hnr is bad when DOWN
    drivers = dict(top_drivers({"pause_ratio": 3.0, "hnr": 4.0, "rt_median": -5.0}, k=3))
    assert "pause_ratio" in drivers
    assert "hnr" not in drivers       # z is positive -> voice got *less* breathy
    assert "rt_median" not in drivers  # z is negative -> reactions got faster


def test_top_drivers_are_ranked_by_magnitude_and_capped_at_k():
    z = {"pause_ratio": 1.0, "rt_median": 5.0, "mouth_symmetry_mean": 3.0, "rt_cov": 2.0}
    assert [f for f, _ in top_drivers(z, k=3)] == ["rt_median", "mouth_symmetry_mean", "rt_cov"]


def test_unknown_features_are_ignored_by_the_explainer():
    assert top_drivers({"mfcc7_mean": 99.0}) == []


def test_explanations_exist_in_both_languages_for_every_band():
    z = {"pause_ratio": 4.0, "mouth_symmetry_mean": 3.5, "rt_cov": 3.0}
    for band in ("STABLE", "WATCH", "ALERT"):
        en, hi = explain(z, band, "en"), explain(z, band, "hi")
        assert en and hi and en != hi
    assert "pauses while speaking are longer than usual" in explain(z, "ALERT", "en")
    assert "बोलते समय रुकावट" in explain(z, "ALERT", "hi")


def test_stable_days_get_the_reassuring_message():
    assert "normal" in explain({"pause_ratio": 4.0}, "STABLE", "en").lower()


def test_every_template_has_a_direction_and_both_languages():
    for feature, tpl in TEMPLATES.items():
        assert tpl[0] in ("up", "down"), feature
        assert len(tpl) == 3 and all(isinstance(s, str) and s for s in tpl[1:]), feature
