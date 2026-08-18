"""The scoring math: baseline -> z -> deviation -> stability score -> bands -> alert gate.

These pin the numbers produced by the verified reference implementation. If a change here
makes a test fail, the change is wrong.
"""
from __future__ import annotations

import math

import pytest

from app.ml.baseline import BASELINE_DAYS, MIN_STD, build_baseline, modality_deviation, z_scores
from app.ml.explain import TEMPLATES, explain, top_drivers
from app.ml.scoring import (
    BANDS,
    DEV_THRESHOLD,
    MIN_MODALITIES,
    SUSTAIN_DAYS,
    alert_decision,
    band_for,
    quality_weights,
    stability_score,
)

ALL_VALID = {"voice": True, "face": True, "reaction": True}
KEYS = ["a", "b"]


def _sigmoid_score(combined: float) -> float:
    return 100.0 / (1.0 + math.exp(-1.6 * (combined - 2.0)))


# --------------------------------------------------------------------------- constants
def test_gate_constants_match_the_trd():
    assert DEV_THRESHOLD == 2.0
    assert SUSTAIN_DAYS == 3
    assert MIN_MODALITIES == 2
    assert BASELINE_DAYS == 4
    assert BANDS == [(0, 40, "STABLE"), (40, 70, "WATCH"), (70, 101, "ALERT")]


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


# --------------------------------------------------------------------------- weights + score
def test_quality_weights_renormalise_to_keep_scale_comparable():
    assert quality_weights(ALL_VALID) == {"voice": 1.0, "face": 1.0, "reaction": 1.0}
    two = quality_weights({"voice": True, "face": True, "reaction": False})
    assert two == {"voice": 1.5, "face": 1.5, "reaction": 0.0}
    assert sum(two.values()) == pytest.approx(3.0)
    assert quality_weights({"voice": False, "face": False, "reaction": False}) == {
        "voice": 0.0, "face": 0.0, "reaction": 0.0
    }


def test_stability_score_is_the_sigmoid_of_the_weighted_mean_deviation():
    devs = {"voice": 1.0, "face": 2.0, "reaction": 3.0}
    assert stability_score(devs, ALL_VALID) == pytest.approx(_sigmoid_score(2.0), abs=1e-9)
    assert stability_score(devs, ALL_VALID) == pytest.approx(50.0, abs=1e-9)


def test_stability_score_ignores_modalities_whose_capture_failed():
    devs = {"voice": 4.0, "face": 4.0, "reaction": 0.0}
    dropped = stability_score(devs, {"voice": True, "face": True, "reaction": False})
    assert dropped == pytest.approx(_sigmoid_score(4.0), abs=1e-9)
    # ...whereas counting the failed capture as a perfect day would dilute the signal
    assert stability_score(devs, ALL_VALID) < dropped


def test_stability_score_is_monotonic_and_bounded():
    scores = [stability_score({m: d for m in ALL_VALID}, ALL_VALID) for d in (0, 1, 2, 3, 6, 20)]
    assert scores == sorted(scores)
    assert 0.0 <= scores[0] < 5.0
    assert scores[-1] <= 100.0


def test_stability_score_with_no_valid_modality_stays_in_the_stable_band():
    s = stability_score({}, {"voice": False, "face": False, "reaction": False})
    assert band_for(s) == "STABLE"


# --------------------------------------------------------------------------- bands
@pytest.mark.parametrize(
    "score,expected",
    [(0.0, "STABLE"), (39.9, "STABLE"), (40.0, "WATCH"), (69.9, "WATCH"),
     (70.0, "ALERT"), (100.0, "ALERT")],
)
def test_band_boundaries(score, expected):
    assert band_for(score) == expected


# --------------------------------------------------------------------------- alert gate
def _day(v: float, f: float, r: float) -> dict:
    devs = {"voice": v, "face": f, "reaction": r}
    return {"devs": devs, "score": stability_score(devs, ALL_VALID)}


def test_alert_decision_with_no_history():
    d = alert_decision([])
    assert d["band"] == "STABLE" and d["modalities_flagged"] == []


def test_no_alert_when_everything_is_within_normal_variation():
    d = alert_decision([_day(0.8, 0.9, 1.1)] * 3)
    assert d["band"] == "STABLE"
    assert d["modalities_flagged"] == []


def test_alert_needs_two_modalities_sustained_for_three_days():
    d = alert_decision([_day(3.0, 3.0, 0.5)] * SUSTAIN_DAYS)
    assert d["band"] == "ALERT"
    assert sorted(d["modalities_flagged"]) == ["face", "voice"]
    assert "3+ days" in d["reason"]


def test_one_deviating_modality_never_alerts():
    d = alert_decision([_day(6.0, 0.2, 0.2)] * SUSTAIN_DAYS)
    assert d["band"] != "ALERT"
    assert d["modalities_flagged"] == ["voice"]


def test_a_single_bad_day_is_capped_at_watch_even_with_a_high_score():
    d = alert_decision([_day(6.0, 6.0, 6.0)])
    assert d["band"] == "WATCH"
    assert d["reason"] == "single-signal or unsustained deviation"


def test_two_bad_days_are_not_yet_sustained():
    d = alert_decision([_day(6.0, 6.0, 6.0)] * 2)
    assert d["band"] == "WATCH"


def test_a_gap_in_the_window_breaks_the_sustain_requirement():
    d = alert_decision([_day(4.0, 4.0, 0.2), _day(0.3, 0.3, 0.2), _day(4.0, 4.0, 0.2)])
    assert d["band"] == "WATCH"
    assert d["modalities_flagged"] == []


def test_only_the_last_three_days_are_considered():
    history = [_day(0.2, 0.2, 0.2)] * 5 + [_day(3.0, 3.0, 0.2)] * SUSTAIN_DAYS
    assert alert_decision(history)["band"] == "ALERT"


def test_the_threshold_is_strict():
    at_threshold = alert_decision([_day(DEV_THRESHOLD, DEV_THRESHOLD, 0.2)] * SUSTAIN_DAYS)
    assert at_threshold["modalities_flagged"] == []
    just_over = alert_decision([_day(DEV_THRESHOLD + 1e-6, DEV_THRESHOLD + 1e-6, 0.2)] * SUSTAIN_DAYS)
    assert sorted(just_over["modalities_flagged"]) == ["face", "voice"]


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
