"""The clinical engine: baseline, deviation, gates, confounders. TRD §10.

These pin the maths. If a change here makes a test fail, the change is wrong.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

from app.engine.baseline import (
    DISCARD_FIRST_N_SESSIONS,
    ENROLMENT_MIN_DAYS_POST_STROKE,
    LOCK_AT_N_SESSIONS,
    MAD_TO_SD,
    Baseline,
    EnrolmentError,
    SessionObservation,
    build_baseline,
    check_enrolment,
    is_off_window,
    mad_of,
    median_of,
    window_progress,
)
from app.engine.confounders import ConfounderContext, detect_confounders
from app.engine.deviation import (
    CUSUM_H,
    CUSUM_K,
    DEVIATION_CLIP,
    RCI_CRITICAL,
    compute_module_deviation,
    cusum_series,
    reliable_change_index,
    robust_z,
)
from app.engine.gates import (
    BAND_ALERT,
    BAND_STABLE,
    BAND_WATCH,
    DEV_THRESHOLD,
    MIN_DOMAINS,
    PERSISTENCE_SESSIONS,
    SessionDeviations,
    evaluate_gates,
)
from app.engine.deviation import ModuleDeviation

DAY0 = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
KEYS = ["a", "b"]


def obs(day: int, a: float = 10.0, b: float = 1.0, **kw) -> SessionObservation:
    return SessionObservation(ts=DAY0 + timedelta(days=day),
                              features={"valid": 1.0, "a": a, "b": b}, **kw)


# --------------------------------------------------------------------------- enrolment
def test_enrolment_requires_three_months_post_stroke():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc)
    check_enrolment(now - timedelta(days=ENROLMENT_MIN_DAYS_POST_STROKE), now)
    with pytest.raises(EnrolmentError, match="days post-stroke"):
        check_enrolment(now - timedelta(days=ENROLMENT_MIN_DAYS_POST_STROKE - 1), now)


def test_enrolment_requires_a_stroke_date_at_all():
    with pytest.raises(EnrolmentError):
        check_enrolment(None, datetime(2026, 6, 1, tzinfo=timezone.utc))


def test_enrolment_accepts_naive_timestamps():
    """SQLite hands back naive datetimes; the gate must not crash on them."""
    check_enrolment(datetime(2025, 1, 1), datetime(2026, 6, 1))


# --------------------------------------------------------------------------- median/MAD
def test_median_and_mad_are_robust_to_one_bad_capture():
    clean = [10.0, 10.2, 9.8, 10.1, 10.0]
    contaminated = clean + [95.0]          # one catastrophic outlier

    assert median_of(contaminated) == pytest.approx(10.1, abs=0.15)
    # A mean would have moved by ~14; the median moves by 0.1.
    assert abs(median_of(contaminated) - median_of(clean)) < 0.2
    # And the MAD barely widens, so the band does not blind itself.
    assert mad_of(contaminated) < 2 * mad_of(clean) + 0.2


def test_mad_is_floored_so_a_flat_feature_cannot_divide_by_zero():
    flat = [5.0] * 8
    assert mad_of(flat) > 0
    assert mad_of(flat) == pytest.approx(0.05)     # 1% of |median|


def test_robust_z_uses_the_iglewicz_hoaglin_constant():
    assert robust_z(12.0, 10.0, 1.0) == pytest.approx(0.6745 * 2.0)
    assert robust_z(10.0, 10.0, 1.0) == 0.0
    assert robust_z(8.0, 10.0, 1.0) == pytest.approx(-0.6745 * 2.0)
    assert robust_z(12.0, 10.0, 0.0) == 0.0        # no spread -> no signal, not a crash


# --------------------------------------------------------------------------- baseline build
def test_baseline_discards_the_first_sessions_for_practice_effect():
    # Days 1-3 are deliberately poor (learning); days 4+ are the true level.
    sessions = [obs(0, 30.0), obs(1, 25.0), obs(2, 22.0)] + [obs(d, 10.0) for d in range(3, 15)]
    built = build_baseline("M7", sessions, KEYS)

    assert built.n_discarded == DISCARD_FIRST_N_SESSIONS
    assert built.n_sessions == len(sessions) - DISCARD_FIRST_N_SESSIONS
    # The practice sessions are gone, so the median is the real level.
    assert built.median["a"] == pytest.approx(10.0)


def test_baseline_rejects_bad_quality_and_unverified_identity_before_discarding():
    """Order matters: rejecting first stops bad captures eating the practice allowance."""
    sessions = (
        [obs(0, 99.0, quality_ok=False), obs(1, 99.0, identity_ok=False),
         obs(2, 99.0, off_window=True)]
        + [obs(d, 10.0) for d in range(3, 19)]
    )
    built = build_baseline("M7", sessions, KEYS)

    assert built.n_rejected == 3
    assert built.n_discarded == DISCARD_FIRST_N_SESSIONS
    assert built.median["a"] == pytest.approx(10.0)   # no 99s leaked in


def test_baseline_locks_only_at_the_required_session_count():
    almost = build_baseline("M7", [obs(d, 10.0) for d in range(DISCARD_FIRST_N_SESSIONS + LOCK_AT_N_SESSIONS - 1)], KEYS)
    assert almost.locked is False
    assert str(LOCK_AT_N_SESSIONS) in almost.reason

    enough = build_baseline("M7", [obs(d, 10.0) for d in range(DISCARD_FIRST_N_SESSIONS + LOCK_AT_N_SESSIONS)], KEYS)
    assert enough.locked is True
    assert enough.n_sessions == LOCK_AT_N_SESSIONS


def test_baseline_with_no_usable_sessions_reports_why():
    built = build_baseline("M7", [obs(d, 10.0, quality_ok=False) for d in range(5)], KEYS)
    assert built.locked is False
    assert built.n_rejected == 5
    assert "0 usable sessions" in built.reason


def test_baseline_fits_a_recovery_trajectory():
    """A steadily improving feature should produce a non-zero slope."""
    sessions = [obs(d, 10.0 + 0.5 * d) for d in range(20)]
    built = build_baseline("M7", sessions, KEYS)
    slope, _intercept = built.trajectory["a"]
    assert slope == pytest.approx(0.5, abs=0.05)


def test_off_window_detection_wraps_around_midnight():
    assert is_off_window(datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc), 9.0) is False
    assert is_off_window(datetime(2026, 6, 1, 11, 30, tzinfo=timezone.utc), 9.0) is True
    assert is_off_window(datetime(2026, 6, 1, 23, 30, tzinfo=timezone.utc), 0.5) is False
    assert is_off_window(datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc), None) is False


def test_window_progress_reports_cadence():
    weekly = [obs(d) for d in (0, 2, 4, 7, 9, 11, 14)]
    progress = window_progress(weekly)
    assert progress["cadence_ok"] is True
    assert progress["locked"] is False

    sparse = [obs(d) for d in (0, 10, 20)]
    assert window_progress(sparse)["cadence_ok"] is False


# --------------------------------------------------------------------------- RCI / CUSUM
def test_rci_is_the_jacobson_truax_formulation():
    sd, reliability = 2.0, 0.75
    sem = sd * math.sqrt(1 - reliability)
    se_diff = math.sqrt(2) * sem
    assert reliable_change_index(14.0, 10.0, sd, reliability) == pytest.approx(4.0 / se_diff)


def test_rci_treats_small_moves_as_measurement_noise():
    # A move well inside the instrument's own error is not reliable change.
    assert abs(reliable_change_index(10.4, 10.0, 2.0)) < RCI_CRITICAL
    assert abs(reliable_change_index(16.0, 10.0, 2.0)) > RCI_CRITICAL


def test_cusum_accumulates_small_drift_that_no_single_day_would_trip():
    drift = [0.9] * 12          # never near DEV_THRESHOLD on any one day
    series = cusum_series(drift)
    assert all(d < DEV_THRESHOLD for d in drift)
    assert series[-1] >= CUSUM_H          # ...but the accumulation alarms
    assert series == sorted(series)       # monotonic while drift exceeds k


def test_cusum_decays_back_to_zero_once_the_signal_returns_to_normal():
    """CUSUM drains at the slack rate k rather than resetting instantly.

    That is deliberate: an abrupt reset would let a genuinely deteriorating patient who
    has one good day escape the accumulated evidence entirely.
    """
    series = cusum_series([3.0, 3.0] + [0.0] * 20)
    peak = series[1]
    assert peak == pytest.approx(5.0)
    # Drains by exactly k per quiet session...
    assert series[2] == pytest.approx(peak - CUSUM_K)
    # ...and reaches zero rather than sticking.
    assert series[-1] == 0.0


def test_cusum_ignores_noise_below_the_slack_term():
    assert all(v == 0.0 for v in cusum_series([CUSUM_K - 0.01] * 10))


# --------------------------------------------------------------------------- module deviation
def _locked_baseline(median: float = 10.0, mad: float = 1.0) -> Baseline:
    b = Baseline(module_code="M7", median={"a": median, "b": median},
                 mad={"a": mad, "b": mad}, locked=True, n_sessions=LOCK_AT_N_SESSIONS)
    return b


def test_module_deviation_is_the_clipped_mean_absolute_z():
    dev = compute_module_deviation("M7", "motor", {"a": 13.0, "b": 10.0},
                                   _locked_baseline(), KEYS)
    assert dev.computed is True
    expected = (abs(robust_z(13.0, 10.0, 1.0)) + 0.0) / 2
    assert dev.mean_abs_z == pytest.approx(expected)


def test_one_runaway_feature_cannot_dominate_a_module():
    dev = compute_module_deviation("M7", "motor", {"a": 1e6, "b": 10.0},
                                   _locked_baseline(), KEYS)
    assert dev.mean_abs_z == pytest.approx(DEVIATION_CLIP / 2)


def test_module_deviation_is_not_computed_before_the_baseline_locks():
    unlocked = Baseline(module_code="M7", locked=False, reason="4/12 valid sessions")
    dev = compute_module_deviation("M7", "motor", {"a": 99.0}, unlocked, KEYS)
    assert dev.computed is False
    assert dev.mean_abs_z == 0.0
    assert "not locked" in dev.reason


def test_improvement_is_detected_when_features_move_the_good_way():
    # `a` is worse when it goes UP, so a large drop is improvement.
    dev = compute_module_deviation(
        "M7", "motor", {"a": 2.0, "b": 10.0}, _locked_baseline(),
        KEYS, bad_direction={"a": "up", "b": "up"},
    )
    assert dev.improving is True


def test_deterioration_is_not_marked_improving():
    dev = compute_module_deviation(
        "M7", "motor", {"a": 20.0, "b": 20.0}, _locked_baseline(),
        KEYS, bad_direction={"a": "up", "b": "up"},
    )
    assert dev.improving is False


# --------------------------------------------------------------------------- gates
def _session(devs: dict[str, float], valid: bool = True,
             improving: set[str] | None = None) -> SessionDeviations:
    container = SessionDeviations(session_id="s", valid=valid)
    for i, (domain, value) in enumerate(devs.items()):
        container.modules[f"M{i}"] = ModuleDeviation(
            module_code=f"M{i}", domain=domain, mean_abs_z=value, computed=True,
            improving=domain in (improving or set()),
        )
    return container


HIGH, LOW = DEV_THRESHOLD + 1.0, 0.5


def test_no_history_is_stable():
    assert evaluate_gates([]).band == BAND_STABLE


def test_quiet_sessions_are_stable():
    result = evaluate_gates([_session({"motor": LOW, "speech_language": LOW})] * 3)
    assert result.band == BAND_STABLE
    assert result.persistent_domains == []


def test_a_single_bad_session_is_watch_not_alert():
    """The whole point of Gate 1: one bad day never reaches the family."""
    result = evaluate_gates([_session({"motor": HIGH, "speech_language": HIGH})])
    assert result.band == BAND_WATCH
    assert result.gate1_passed is False


def test_one_domain_sustained_is_watch_not_alert():
    """Gate 2: a hoarse throat moves every speech feature, and that is not enough."""
    result = evaluate_gates([_session({"speech_language": HIGH, "motor": LOW})] * 3)
    assert result.band == BAND_WATCH
    assert result.gate1_passed is True
    assert result.gate2_passed is False
    assert result.persistent_domains == ["speech_language"]
    assert "no second domain" in result.reason


def test_two_domains_sustained_is_alert():
    result = evaluate_gates([_session({"speech_language": HIGH, "motor": HIGH})]
                            * PERSISTENCE_SESSIONS)
    assert result.band == BAND_ALERT
    assert result.gate1_passed and result.gate2_passed
    assert len(result.persistent_domains) >= MIN_DOMAINS


def test_a_gap_in_the_run_breaks_persistence():
    result = evaluate_gates([
        _session({"speech_language": HIGH, "motor": HIGH}),
        _session({"speech_language": LOW, "motor": LOW}),
        _session({"speech_language": HIGH, "motor": HIGH}),
    ])
    assert result.band == BAND_WATCH
    assert result.persistent_domains == []


def test_invalid_sessions_do_not_count_toward_persistence():
    """A rejected capture must neither manufacture nor mask a sustained deviation."""
    result = evaluate_gates([
        _session({"speech_language": HIGH, "motor": HIGH}),
        _session({"speech_language": HIGH, "motor": HIGH}, valid=False),
    ])
    assert result.band == BAND_WATCH


def test_improvement_never_alerts_however_large_the_deviation():
    huge = DEV_THRESHOLD * 3
    result = evaluate_gates(
        [_session({"speech_language": huge, "motor": huge},
                  improving={"speech_language", "motor"})] * 4
    )
    assert result.band == BAND_STABLE
    assert result.improving is True
    assert "recovery" in result.reason


def test_the_sustained_run_length_is_reported_honestly():
    result = evaluate_gates([_session({"speech_language": HIGH, "motor": HIGH})] * 5)
    assert result.band == BAND_ALERT
    assert result.sustained_sessions == 5


def test_threshold_is_strict():
    at = evaluate_gates([_session({"speech_language": DEV_THRESHOLD,
                                   "motor": DEV_THRESHOLD})] * 3)
    assert at.persistent_domains == []


# --------------------------------------------------------------------------- confounders
def _ctx(**kw) -> ConfounderContext:
    base = dict(session_ts=DAY0, quality_score=1.0, identity_verified=True,
                off_window=False, baseline_n_sessions=99)
    base.update(kw)
    return ConfounderContext(**base)


def test_clean_session_has_no_confounders_and_full_confidence():
    report = detect_confounders(_ctx())
    assert report.active == []
    assert report.confidence == 1.0


def test_each_confounder_is_detected_and_lowers_confidence():
    cases = {
        "low_quality_capture": _ctx(quality_score=0.3),
        "identity_uncertain": _ctx(identity_verified=False),
        "off_window_time": _ctx(off_window=True),
        "recent_illness": _ctx(recent_illness_ts=DAY0 - timedelta(days=2)),
        "medication_change": _ctx(medication_change_ts=DAY0 - timedelta(days=3)),
        "phq_change": _ctx(phq_current=5, phq_baseline=1),
        "baseline_short": _ctx(baseline_n_sessions=LOCK_AT_N_SESSIONS),
    }
    for code, ctx in cases.items():
        report = detect_confounders(ctx)
        assert code in report.active, code
        assert report.confidence < 1.0, code


def test_stale_illness_and_medication_changes_expire():
    assert "recent_illness" not in detect_confounders(
        _ctx(recent_illness_ts=DAY0 - timedelta(days=30))).active
    assert "medication_change" not in detect_confounders(
        _ctx(medication_change_ts=DAY0 - timedelta(days=60))).active


def test_confounders_compound_but_confidence_never_reaches_zero():
    report = detect_confounders(_ctx(
        quality_score=0.1, identity_verified=False, off_window=True,
        recent_illness_ts=DAY0, medication_change_ts=DAY0,
        phq_current=6, phq_baseline=0, baseline_n_sessions=1,
    ))
    assert len(report.active) >= 6
    assert 0.0 < report.confidence < 0.2


def test_confounders_are_described_in_both_languages():
    from app.engine.confounders import describe

    report = detect_confounders(_ctx(quality_score=0.2))
    assert describe(report.active, "en")[0]
    assert describe(report.active, "hi")[0]
    assert describe(report.active, "en") != describe(report.active, "hi")
