"""Posterior circulation — oculomotor, craniocorpography, DHI, vertigo log.

The test that matters is `test_the_reference_patient_reaches_alert_with_normal_limb_tests`.

An 82-year-old man, seven months post-stroke, MRI showing encephalomalacia with gliosis in
the left cerebellar hemisphere and bilateral occipital regions. Sixty vertigo attacks,
Unterberger sway 17 cm, tandem sway 13 cm, angular deviation 5 degrees right, abnormal
saccade latency and velocity, DHI 28.

And finger-nose, heel-knee-shin, dysdiadochokinesia and joint-position ALL NORMAL.

Before this work the product would have run M8 on him, found nothing, and reported him
stable — with an MRI-confirmed cerebellar infarct and months of accumulating vertigo. Every
number below is from `docs/CLINICAL_REFERENCE.md`.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from app.engine.deviation import LATERAL_THRESHOLD, ModuleDeviation
from app.engine.gates import (
    BAND_ALERT,
    DEV_THRESHOLD,
    DOMAINS,
    NON_LATERALISABLE_DOMAINS,
    SessionDeviations,
    evaluate_gates,
)
from app.exam.questionnaires import score_dhi, score_vertigo_log
from app.exam.registry import MODULES, modules_for_tier
from app.exam.vestibular import (
    CCG_LATERAL_KEYS,
    OCULOMOTOR_LATERAL_KEYS,
    ccg_trace,
    extract_craniocorpography,
    extract_oculomotor,
)

HIGH = DEV_THRESHOLD + 1.5


# ------------------------------------------------------------------ registry / domain
def test_the_posterior_modules_are_core_and_weekly():
    """They were monthly and tier-gated. For these patients that was the whole failure."""
    assert MODULES["M3"].domain == "posterior_vestibular"
    assert MODULES["M9"].domain == "posterior_vestibular"
    assert MODULES["M3"].schedule == "weekly"
    assert MODULES["M9"].schedule == "weekly"
    # M3 must run on the base tier — a front camera is all it needs.
    assert MODULES["M3"].requires_device == "phone"
    assert "M3" in modules_for_tier("weekly", "TIER_1_PHONE")


def test_posterior_is_its_own_domain_not_folded_into_coordination():
    """The index case had NORMAL limb coordination. Merged, this domain could never
    corroborate coordination_gait under Gate 2, which is exactly the evidence we need."""
    assert "posterior_vestibular" in DOMAINS.values()
    assert MODULES["M9"].domain != MODULES["M8"].domain


def test_the_posterior_domain_can_establish_laterality():
    """The domain carries a side — from BOTH the eye and the feet.

    Which one actually fires matters. In the reference patient the Unterberger angular
    deviation was classified NORMAL, and the lateralised finding came from M3: saccade
    velocity asymmetry ~0.37, leftward slower and later than rightward. So the eye is the
    evidenced source and the feet are the corroborating one, not the other way round.
    See GAP_ANALYSIS D-2.
    """
    assert "posterior_vestibular" not in NON_LATERALISABLE_DOMAINS
    assert MODULES["M3"].lateral_keys == OCULOMOTOR_LATERAL_KEYS
    assert MODULES["M9"].lateral_keys == CCG_LATERAL_KEYS
    assert MODULES["M9"].lateral_keys, "balance must carry a side or Gate 3 blocks it"


# ------------------------------------------------------------------ oculomotor
def _saccade_trial(direction, latency_frames, peak_step, overshoot=0.0, fps=30.0,
                   steps=6):
    """A synthetic saccade: hold, then move to the target over `steps` frames.

    `steps` matters for the frame-rate tests: it is how many samples the movement occupies,
    which is what decides whether a measured 'peak velocity' is a peak at all.
    """
    start = [0.5, 0.5]
    target = {"left": [0.2, 0.5], "right": [0.8, 0.5],
              "up": [0.5, 0.2], "down": [0.5, 0.8]}[direction]
    frames = [list(start) for _ in range(latency_frames)]
    for i in range(1, steps + 1):
        frac = (i / steps) * (1.0 + overshoot)
        frames.append([start[0] + (target[0] - start[0]) * frac,
                       start[1] + (target[1] - start[1]) * frac])
    # A couple of settled frames so the landing point is stable.
    frames += [frames[-1], frames[-1]]
    return {"direction": direction, "gaze": frames, "target": target}


def test_saccade_latency_and_velocity_are_measured_per_direction():
    raw = {
        "fps": 30.0,
        "saccades": [
            _saccade_trial("left", latency_frames=12, peak_step=0.05),   # 400 ms: slow
            _saccade_trial("left", latency_frames=12, peak_step=0.05),
            _saccade_trial("right", latency_frames=6, peak_step=0.05),   # 200 ms: normal
            _saccade_trial("right", latency_frames=6, peak_step=0.05),
        ],
    }
    out = extract_oculomotor(raw)
    assert out["valid"] == 1.0
    assert out["saccade_latency_left"] > out["saccade_latency_right"]
    assert out["saccade_latency_left"] == pytest.approx(400.0, abs=40)
    assert out["saccade_latency_right"] == pytest.approx(200.0, abs=40)
    # ...and the side difference is exposed as its own feature for Gate 3.
    assert out["saccade_latency_asymmetry"] > 0.4


def test_a_symmetric_slowing_produces_no_laterality():
    """Fatigue and sedation slow both directions. That must not read as focal."""
    raw = {"fps": 30.0, "saccades": [
        _saccade_trial(d, latency_frames=12, peak_step=0.05)
        for d in ("left", "left", "right", "right")
    ]}
    out = extract_oculomotor(raw)
    assert out["saccade_latency_mean"] == pytest.approx(400.0, abs=40)
    assert out["saccade_latency_asymmetry"] < 0.05


def test_pursuit_gain_falls_when_the_eye_lags_the_target():
    fps = 30.0
    n = 60
    target = [[0.2 + 0.6 * i / n, 0.5] for i in range(n)]
    # Eye tracks at 60% of target speed: classic cerebellar pursuit failure.
    lagging = [[0.2 + 0.6 * 0.6 * i / n, 0.5] for i in range(n)]
    perfect = [list(p) for p in target]

    bad = extract_oculomotor({"fps": fps, "pursuit": [
        {"gaze": g, "target": t} for g, t in zip(lagging, target)]})
    good = extract_oculomotor({"fps": fps, "pursuit": [
        {"gaze": g, "target": t} for g, t in zip(perfect, target)]})

    assert bad["pursuit_gain"] == pytest.approx(0.6, abs=0.05)
    assert good["pursuit_gain"] == pytest.approx(1.0, abs=0.05)
    assert bad["pursuit_gain"] < good["pursuit_gain"]


def test_an_empty_capture_is_invalid_not_zero():
    """A missing capture must never look like a perfect score."""
    assert extract_oculomotor({"fps": 30.0})["valid"] == 0.0
    assert extract_craniocorpography({"fps": 30.0})["valid"] == 0.0


# ------------------------------------------------------------------ craniocorpography
def _walk(steps, lateral_per_step, forward_per_step=0.01, jitter=0.0):
    pts, x, y = [], 0.0, 0.0
    for i in range(steps):
        x += lateral_per_step + (jitter if i % 2 else -jitter)
        y += forward_per_step
        pts.append([x, y])
    return pts


def test_unterberger_angular_deviation_matches_the_clinical_measure():
    """The reference patient deviated 5 degrees to the right."""
    # Build a track whose net displacement is 5 degrees off straight ahead.
    forward = 1.0
    lateral = forward * math.tan(math.radians(5.0))
    track = [[lateral * i / 50, forward * i / 50] for i in range(51)]

    out = extract_craniocorpography({
        "fps": 30.0, "head_width_norm": 0.15, "head_width_cm": 15.0,
        "tests": {"unterberger": track},
    })
    assert out["unterberger_angular_deviation_deg"] == pytest.approx(5.0, abs=0.3)
    assert out["unterberger_angular_deviation_abs_deg"] == pytest.approx(5.0, abs=0.3)


def test_deviation_direction_is_preserved_because_it_names_the_side():
    right = extract_craniocorpography({
        "fps": 30.0, "head_width_norm": 0.15,
        "tests": {"unterberger": _walk(50, 0.002)}})
    left = extract_craniocorpography({
        "fps": 30.0, "head_width_norm": 0.15,
        "tests": {"unterberger": _walk(50, -0.002)}})
    assert right["unterberger_angular_deviation_deg"] > 0
    assert left["unterberger_angular_deviation_deg"] < 0
    # ...but the magnitude used for scoring is side-agnostic.
    assert right["unterberger_angular_deviation_abs_deg"] == pytest.approx(
        left["unterberger_angular_deviation_abs_deg"], abs=0.1)


def test_sway_path_is_reported_in_centimetres():
    """Normalised units are not comparable between sessions — the phone moves. The head is
    the ruler."""
    # Five points minimum, travelling 0.2 normalised units in total.
    track = [[0.0, 0.0], [0.05, 0.0], [0.10, 0.0], [0.10, 0.05], [0.10, 0.10]]
    out = extract_craniocorpography({
        "fps": 30.0, "head_width_norm": 0.15, "head_width_cm": 15.0,
        "tests": {"tandem_stance": track}})
    # 0.2 norm * (15 cm / 0.15 norm) = 20 cm
    assert out["tandem_stance_sway_path_cm"] == pytest.approx(20.0, abs=0.5)


def test_the_romberg_quotient_catches_reliance_on_vision():
    # Standing still, not walking: forward travel would otherwise dominate both paths and
    # swamp the difference the quotient exists to expose.
    steady = [[0.0, 0.0]] + _walk(30, 0.0002, forward_per_step=0.0)
    unsteady = [[0.0, 0.0]] + _walk(30, 0.0, forward_per_step=0.0, jitter=0.004)
    out = extract_craniocorpography({
        "fps": 30.0, "head_width_norm": 0.15,
        "tests": {"romberg_eyes_open": steady, "romberg_eyes_closed": unsteady}})
    assert out["romberg_quotient"] > 3.0


def test_the_trace_is_returned_in_the_clinical_ccg_shape():
    raw = {"fps": 30.0, "head_width_norm": 0.15, "head_width_cm": 15.0,
           "tests": {"unterberger": _walk(20, 0.002)}}
    trace = ccg_trace(raw, "unterberger")
    assert trace["units"] == "cm"
    assert trace["start"] == [0.0, 0.0]
    assert len(trace["points"]) == 20
    assert trace["end"] != [0.0, 0.0]


# ------------------------------------------------------------------ instruments
#: The reference patient's actual DHI response profile, reconstructed from the recorded
#: subscale scores: physical 6, emotional 8, functional 14, total 28.
#:
#: The earlier fixture used `[4] * 7 + [0] * 18`, which happens to total 28 but distributes
#: it as physical 12 / emotional 4 / functional 12 — almost the inverse of the real
#: patient, whose burden is predominantly FUNCTIONAL. A total-only check would never have
#: caught that, and the subscales are the clinically interesting part: someone barely
#: impaired physically whose life is substantially restricted.
REFERENCE_DHI_RESPONSES = [4, 4, 4, 2, 4, 0, 4, 2, 4, 0, 0, 0, 0,
                           0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]


def test_the_dhi_reproduces_the_reference_subscales():
    """Physical 6, emotional 8, functional 14, total 28 — all four, not just the total."""
    result = score_dhi(REFERENCE_DHI_RESPONSES)
    assert result["physical"] == 6.0
    assert result["emotional"] == 8.0
    assert result["functional"] == 14.0
    assert result["total"] == 28.0
    assert result["band"] == "mild"


def test_the_reference_burden_is_predominantly_functional():
    """The shape of the score, not its size. Half the total sits in the functional
    subscale — this is a patient whose life is restricted more than his body is."""
    result = score_dhi(REFERENCE_DHI_RESPONSES)
    assert result["functional"] > result["physical"]
    assert result["functional"] > result["emotional"]
    assert result["functional"] / result["total"] == pytest.approx(0.5)


def test_the_dhi_states_its_own_measurement_error():
    """A 10-point move is inside the instrument's noise and must not be read as change."""
    assert "18 points" in score_dhi([0] * 25)["note"]


def test_the_dhi_rejects_a_malformed_response_set():
    with pytest.raises(ValueError):
        score_dhi([0] * 24)
    with pytest.raises(ValueError):
        score_dhi([1] * 25)          # 1 is not a valid DHI response


def test_the_vertigo_log_summarises_the_reference_burden():
    """Sixty attacks of about fifteen minutes — the metric that moved first."""
    attacks = [{"duration_seconds": 900, "severity": 2} for _ in range(60)]
    out = score_vertigo_log(attacks)
    assert out["attack_count"] == 60.0
    assert out["total_minutes"] == pytest.approx(900.0)
    assert out["median_duration_seconds"] == 900.0
    assert out["escalate"] is False


def test_a_very_long_attack_escalates_rather_than_trending():
    out = score_vertigo_log([{"duration_seconds": 7200, "severity": 3}])
    assert out["escalate"] is True
    assert "today" in out["note"]


def test_momentary_wobbles_are_not_counted_as_attacks():
    out = score_vertigo_log([{"duration_seconds": 3}] * 5)
    assert out["attack_count"] == 0.0
    assert out["discarded_too_short"] == 5.0


# ------------------------------------------------------------------ the decisive test
def _session(devs, lateral=None):
    lateral = lateral or {}
    container = SessionDeviations(session_id="s")
    for i, (domain, value) in enumerate(devs.items()):
        lat = lateral.get(domain, 0.0)
        container.modules[f"M{i}"] = ModuleDeviation(
            module_code=f"M{i}", domain=domain, mean_abs_z=value, computed=True,
            has_laterality=domain in lateral,
            lateral_abs_z=lat, lateralised=lat > LATERAL_THRESHOLD,
        )
    return container


def test_the_reference_patient_reaches_alert_with_normal_limb_tests():
    """The whole point of widening scope.

    Balance and oculomotor deviating together, one-sided (he deviates consistently right on
    Unterberger), while limb coordination — finger-nose, heel-knee-shin,
    dysdiadochokinesia, joint position — is entirely normal.

    Before this change: one unrecognised domain, no alert, patient reported stable.
    """
    session = _session(
        {
            "posterior_vestibular": HIGH,   # M9 balance + M3 oculomotor
            "cranial_nerves": HIGH,         # bilateral hearing loss, occipital involvement
            "coordination_gait": 0.4,       # NORMAL — this is the trap
        },
        lateral={"posterior_vestibular": HIGH},
    )
    result = evaluate_gates([session] * 3)

    assert result.band == BAND_ALERT
    assert result.gate1_passed and result.gate2_passed and result.gate3_passed
    assert "posterior_vestibular" in result.lateralised_domains
    assert "coordination_gait" not in result.persistent_domains, (
        "limb coordination was normal in this patient and must not be what fires")


def test_posterior_findings_alone_are_watched_not_alerted():
    """One domain is still one domain. Widening scope must not lower the bar."""
    session = _session({"posterior_vestibular": HIGH},
                       lateral={"posterior_vestibular": HIGH})
    result = evaluate_gates([session] * 3)
    assert result.band != BAND_ALERT
    assert result.gate2_passed is False


def test_posterior_can_supply_the_laterality_for_a_speech_finding():
    """A cerebellar patient with dysarthria and a one-sided balance deficit: two domains,
    one of them lateralised. This is a real presentation and it must alert."""
    session = _session({"posterior_vestibular": HIGH, "motor_speech": HIGH},
                       lateral={"posterior_vestibular": HIGH})
    result = evaluate_gates([session] * 3)
    assert result.band == BAND_ALERT
    assert result.lateralised_domains == ["posterior_vestibular"]


# ------------------------------------------------------------------ TIER_1 balance access
def test_a_tier_one_patient_receives_balance_measurement():
    """The gap that made the whole widening inert.

    M9 was gated on `floor_space`, so a phone-only patient got NO balance measurement at
    all — and phone-only is most of the people posterior-circulation monitoring exists for.
    It now runs the low-motion subset a caregiver can film.
    """
    from app.exam.registry import modules_for_tier, tasks_for_tier

    assert "M9" in modules_for_tier("weekly", "TIER_1_PHONE")
    runnable = tasks_for_tier("M9", "TIER_1_PHONE")
    assert "romberg_eyes_open" in runnable
    assert "romberg_eyes_closed" in runnable
    assert "tandem_stance" in runnable
    assert runnable, "a phone-only patient must get some balance measurement"


def test_the_walking_tasks_are_deferred_not_silently_dropped():
    """Tandem walking and Unterberger move the patient through space with their eyes shut.
    That needs floor room and someone positioned to catch them."""
    from app.exam.registry import tasks_deferred_for_tier

    deferred = tasks_deferred_for_tier("M9", "TIER_1_PHONE")
    assert set(deferred) == {"tandem_walk", "unterberger"}
    assert tasks_deferred_for_tier("M9", "TIER_3_ASHA") == []


def test_a_phone_only_capture_still_measures_deterioration():
    """Romberg and tandem stance carry sway path, sway area and the Romberg quotient —
    enough to see someone getting worse."""
    low_motion = {
        "fps": 30.0, "head_width_norm": 0.15, "head_width_cm": 15.0,
        "tests": {
            "romberg_eyes_open": [[0, 0], [0.01, 0], [0.02, 0], [0.02, 0.01], [0.02, 0.02]],
            "romberg_eyes_closed": [[0, 0], [0.04, 0], [0.08, 0], [0.08, 0.04], [0.08, 0.08]],
            "tandem_stance": [[0, 0], [0.02, 0], [0.04, 0], [0.04, 0.02], [0.04, 0.04]],
        },
    }
    out = extract_craniocorpography(low_motion)
    assert out["valid"] == 1.0
    assert out["romberg_eyes_open_sway_path_cm"] > 0
    assert out["tandem_stance_sway_path_cm"] > 0
    assert out["romberg_quotient"] > 1.0        # eyes closed is worse, as expected


def test_a_phone_only_capture_declares_that_it_cannot_establish_a_side():
    """Every one of M9's laterality features lives in the deferred tasks.

    A phone-only patient gets deterioration from M9 and their SIDE from M3 oculomotor,
    which does run on a phone. What must never happen is M9 quietly reporting a complete
    capture when it ran three tasks out of five.
    """
    low_motion = {
        "fps": 30.0, "head_width_norm": 0.15,
        "tests": {
            "romberg_eyes_open": [[0, 0], [0.01, 0], [0.02, 0], [0.02, 0.01], [0.02, 0.02]],
            "tandem_stance": [[0, 0], [0.02, 0], [0.04, 0], [0.04, 0.02], [0.04, 0.04]],
        },
    }
    out = extract_craniocorpography(low_motion)
    assert out["laterality_available"] == 0.0
    assert out["tests_captured"] == 2.0
    assert not any("angular_deviation" in k for k in out)

    full = dict(low_motion)
    full["tests"] = dict(low_motion["tests"])
    full["tests"]["unterberger"] = [[0.002 * i, 0.02 * i] for i in range(30)]
    complete = extract_craniocorpography(full)
    assert complete["laterality_available"] == 1.0


def test_a_partial_capture_lowers_confidence():
    """Saying so is the alternative to a weaker measurement reading as a stronger one."""
    from app.engine.confounders import ConfounderContext, detect_confounders

    base = dict(session_ts=datetime(2026, 8, 1, 9, tzinfo=timezone.utc),
                quality_score=1.0, identity_verified=True, off_window=False,
                baseline_n_sessions=99)
    full = detect_confounders(ConfounderContext(**base))
    partial = detect_confounders(ConfounderContext(**base, partial_capture=True))

    assert "partial_capture" in partial.active
    assert partial.confidence < full.confidence


def test_the_posterior_domain_can_still_alert_on_a_phone_only_patient():
    """M9 gives deterioration, M3 gives the side, both on a phone. The domain still reaches
    ALERT for exactly the patient the widening was for."""
    session = _session(
        {"posterior_vestibular": HIGH, "cranial_nerves": HIGH},
        lateral={"posterior_vestibular": HIGH},   # supplied by M3, not M9
    )
    result = evaluate_gates([session] * 3)
    assert result.band == BAND_ALERT
    assert "posterior_vestibular" in result.lateralised_domains


# ------------------------------------------------------------------ M3 capture conditions
def test_the_capture_frame_rate_is_recorded_not_just_used():
    """A velocity number without its frame rate cannot be interpreted later."""
    from app.exam.vestibular import extract_oculomotor

    out = extract_oculomotor({"fps": 30.0, "saccades": [
        _saccade_trial("left", 6, 0.05), _saccade_trial("right", 6, 0.05)]})
    assert out["capture_fps"] == 30.0
    assert out["frame_interval_ms"] == pytest.approx(33.3, abs=0.5)
    assert out["saccade_latency_resolution_ms"] == pytest.approx(33.3, abs=0.5)


def test_velocity_confidence_collapses_at_phone_frame_rates():
    """A saccade lasts 30-80 ms. At 30 fps it spans one to three frames, so the measured
    'peak' is an average across the whole movement and understates the true peak."""
    from app.exam.vestibular import extract_oculomotor

    # 30 fps: the saccade lands in 2 frames. 120 fps: the same movement spans 8.
    slow = extract_oculomotor({"fps": 30.0, "saccades": [
        _saccade_trial("left", 6, 0.05, steps=2),
        _saccade_trial("right", 6, 0.05, steps=2)]})
    fast = extract_oculomotor({"fps": 120.0, "saccades": [
        _saccade_trial("left", 24, 0.05, steps=8),
        _saccade_trial("right", 24, 0.05, steps=8)]})

    assert slow["velocity_undersampled"] == 1.0
    assert fast["velocity_undersampled"] == 0.0
    assert slow["velocity_confidence"] < fast["velocity_confidence"]
    assert slow["velocity_confidence"] == 0.0


def test_the_velocity_caveat_says_which_way_the_error_runs():
    """Not merely 'less accurate' — it systematically UNDERSTATES, and a reader needs to
    know the direction."""
    from app.exam.vestibular import extract_oculomotor, velocity_caveat

    out = extract_oculomotor({"fps": 30.0, "saccades": [
        _saccade_trial("left", 6, 0.05, steps=2),
        _saccade_trial("right", 6, 0.05, steps=2)]})
    caveat = velocity_caveat(out)
    assert "UNDERSTATES" in caveat
    assert "30 fps" in caveat
    assert "do not compare it to published normative velocities" in caveat

    good = extract_oculomotor({"fps": 120.0, "saccades": [
        _saccade_trial("left", 24, 0.05, steps=8),
        _saccade_trial("right", 24, 0.05, steps=8)]})
    assert "well resolved" in velocity_caveat(good)


# ------------------------------------------------------------------ M21 SVV
#: The reference patient's actual SVV trials, from the source report.
REF_SVV_STATIC = [3.0, 1.0, 2.0, 0.0, 2.5, 3.0]
REF_SVV_CW = [3.5, 5.0, 6.5, 9.5, 12.5, 17.5]
REF_SVV_ACW = [5.5, -5.0, -3.0, -7.5, 0.0, 0.0]


def test_svv_reproduces_every_printed_average():
    """All three printed averages, to the decimal.

    This is what exposed the averaging convention: the device reports the MEDIAN for the
    dynamic conditions (CW mean 9.08 but printed 8.00; ACW mean -1.67 but printed -1.50)
    and the MEAN OF ABSOLUTES for static (1.9167 -> 1.92). A calibration target we cannot
    reproduce is not a calibration target.
    """
    from app.exam.vestibular import extract_svv

    out = extract_svv({"static": REF_SVV_STATIC, "dynamic_cw": REF_SVV_CW,
                       "dynamic_acw": REF_SVV_ACW})
    assert out["svv_static_abs_mean"] == pytest.approx(1.92, abs=0.01)
    assert out["svv_dynamic_cw_median"] == pytest.approx(8.00, abs=0.01)
    assert out["svv_dynamic_acw_median"] == pytest.approx(-1.50, abs=0.01)


def test_svv_keeps_the_accumulation_that_averaging_destroys():
    """His clockwise trials rose monotonically 3.5 -> 17.5.

    A patient whose sense of vertical is progressively captured by a moving field is a
    different finding from one who is merely imprecise, and the mean cannot tell them
    apart. The drift slope can.
    """
    from app.exam.vestibular import extract_svv

    out = extract_svv({"static": REF_SVV_STATIC, "dynamic_cw": REF_SVV_CW,
                       "dynamic_acw": REF_SVV_ACW})
    assert out["svv_dynamic_cw_drift_slope"] > 2.0
    # Anti-clockwise was normal and does not accumulate.
    assert abs(out["svv_dynamic_acw_drift_slope"]) < 1.0


def test_svv_static_can_be_normal_while_dynamic_is_abnormal():
    """The reason a static-only test would have missed this patient entirely."""
    from app.exam.vestibular import SVV_STATIC_REFERENCE_DEG, extract_svv

    out = extract_svv({"static": REF_SVV_STATIC, "dynamic_cw": REF_SVV_CW,
                       "dynamic_acw": REF_SVV_ACW})
    assert out["svv_static_abs_mean"] < 2.5          # within the usual static cut-off
    assert out["svv_dynamic_cw_median"] > 5.0        # clearly abnormal
    assert out["svv_rod_susceptibility_cw"] > 3.0    # the field is dragging him
    assert SVV_STATIC_REFERENCE_DEG == pytest.approx(1.92, abs=0.01)


def test_an_aborted_svv_is_invalid_not_zero():
    """The rotating field can make a vertiginous patient sick. Stopping is not a score of
    zero — a zero would read as a perfect result."""
    from app.exam.vestibular import extract_svv

    out = extract_svv({"aborted": True})
    assert out["valid"] == 0.0
    assert out["svv_aborted"] == 1.0
    assert "svv_static_abs_mean" not in out


def test_svv_rejects_implausible_settings():
    from app.exam.vestibular import extract_svv

    out = extract_svv({"static": [3.0, 1.0, 999.0, 2.0, 2.5, 3.0]})
    assert out["svv_static_trials"] == 5.0          # the 999 was dropped, not clamped


def test_the_dynamic_rotation_needs_someone_present():
    """A full-field rotation shown to someone with vertigo, alone, is a fall risk."""
    from app.exam.registry import MODULES, SUPERVISED_DEVICES

    m = MODULES["M21"]
    assert m.task_devices["svv_static"] == "phone"
    assert m.task_devices["svv_dynamic_cw"] in SUPERVISED_DEVICES
    assert m.task_devices["svv_dynamic_acw"] in SUPERVISED_DEVICES


def test_svv_is_in_the_posterior_domain_and_offered_on_tier_one():
    from app.exam.registry import MODULES, modules_for_tier

    assert MODULES["M21"].domain == "posterior_vestibular"
    assert "M21" in modules_for_tier("monthly", "TIER_1_PHONE")


# ------------------------------------------------------------------ E3 hearing
def test_hearing_reproduces_the_reference_patient():
    """Worse in both ears, by his own report and by audiometry."""
    from app.exam.questionnaires import score_hearing_change

    out = score_hearing_change({"left": "worse", "right": "worse"})
    assert out["worse_ears"] == 2.0
    assert out["asymmetric"] == 0.0
    assert out["escalate"] is False       # bilateral is not the emergency


def test_one_sided_hearing_loss_escalates():
    """Sudden unilateral loss can be an AICA-territory infarct and has a treatment window."""
    from app.exam.questionnaires import score_hearing_change

    out = score_hearing_change({"left": "worse", "right": "same"})
    assert out["escalate"] is True
    assert "one ear" in out["note"]


def test_hearing_makes_no_measurement_claim():
    from app.exam.questionnaires import score_hearing_change

    note = score_hearing_change({"left": "same", "right": "same"})["note"]
    assert "no measurement claim" in note.lower()


def test_hearing_rejects_a_freeform_answer():
    from app.exam.questionnaires import score_hearing_change

    with pytest.raises(ValueError):
        score_hearing_change({"left": "a bit worse maybe", "right": "same"})
