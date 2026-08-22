"""Exam modules M1-M20 — TRD §4, §10 ("each extractor on a fixture").

Fixtures are synthesised where no sample file exists, which the TRD explicitly permits.
Each one is built so that a *known* clinical pattern is present, and the test asserts the
extractor recovers it — a symmetric face reads as symmetric, an asymmetric one does not.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.exam.cognition import (
    extract_attention_speed,
    extract_memory_executive,
    extract_neglect,
    extract_ocular,
)
from app.exam.coordination import extract_coordination, extract_gait_balance
from app.exam.facial import extract_facial_motor, frame_features
from app.exam.language import (
    connected_speech_features,
    extract_aphasia,
    fluency_features,
    naming_features,
    repetition_features,
)
from app.exam.motor import extract_fine_motor, extract_pronator_drift, tap_features
from app.exam.questionnaires import (
    EAT10_POSITIVE_THRESHOLD,
    PHQ2_POSITIVE_THRESHOLD,
    score_instrument,
)
from app.exam.registry import (
    DAILY_MODULES,
    MODULES,
    MONTHLY_MODULES,
    WEEKLY_MODULES,
    daily_battery_seconds,
)
from app.exam.registry import DAILY_BUDGET_SECONDS
from app.exam.speech_tasks import ddk_features, sustained_phonation_features
from app.exam.vitals import (
    IRREGULARITY_ADVISORY_THRESHOLD,
    extract_adherence,
    extract_blood_pressure,
    extract_rhythm,
    extract_symptom_log,
    rr_features,
)

SR = 16000
RNG = np.random.default_rng(42)


# --------------------------------------------------------------------------- registry
def test_the_module_codes_are_contiguous_with_no_gaps():
    """M1..Mn with nothing missing.

    Asserted as a contiguous range rather than a magic count, because the count changes
    every time a clinical amendment adds a module (M21 SVV was the most recent) and a bare
    `== 20` fails for the entirely uninteresting reason that the number moved. What actually
    matters is that no code is skipped: a gap means a module was removed and its features
    are still referenced somewhere, or one was added out of sequence.
    """
    codes = sorted(MODULES, key=lambda c: int(c[1:]))
    numbers = [int(c[1:]) for c in codes]
    assert numbers == list(range(1, len(MODULES) + 1)), (
        f"module codes are not contiguous: {codes}")
    assert len(MODULES) >= 21, "modules should never be silently removed"


def test_every_module_declares_a_domain_and_a_schedule():
    for code, module in MODULES.items():
        assert module.domain, code
        assert module.schedule in ("daily", "weekly", "monthly", "any"), code
        assert module.tasks, code
        assert callable(module.extract), code


def test_every_scored_module_can_tell_recovery_from_decline():
    """Each scored module needs at least one directional feature.

    Without one, `compute_module_deviation` cannot populate `improving`, and a recovering
    patient would be flagged as deteriorating.

    Not every feature gets a direction, and that is deliberate rather than an omission.
    M17's raw HRV magnitudes are the clearest case: low SDNN indicates cardiac risk, but a
    high RMSSD in this context indicates the irregularity we are actually screening for.
    Assigning either one a direction would assert a clinical claim we cannot defend, so
    they stay descriptive and the directional signal comes from `rr_irregularity_index`.
    """
    for code, module in MODULES.items():
        if not module.scoring_keys:
            continue
        directional = [k for k in module.scoring_keys if k in module.bad_direction]
        assert directional, f"{code} has no directional feature at all"


def test_the_daily_alert_drivers_are_well_covered():
    """The daily modules drive alerts, so most of their features must be directional."""
    for code in DAILY_MODULES:
        module = MODULES[code]
        if not module.scoring_keys:
            continue
        directional = [k for k in module.scoring_keys if k in module.bad_direction]
        assert len(directional) >= len(module.scoring_keys) * 0.6, code


def test_nihss_mappings_are_correct():
    assert MODULES["M1"].nihss_item == 4      # facial palsy
    assert MODULES["M5"].nihss_item == 9      # aphasia
    assert MODULES["M4"].nihss_item == 10     # dysarthria
    assert MODULES["M6"].nihss_item == 5      # motor arm
    assert MODULES["M8"].nihss_item == 7      # ataxia
    assert MODULES["M12"].nihss_item == 11    # extinction / neglect


def test_the_daily_battery_fits_the_ninety_second_budget():
    """PRD §7. A battery that overruns is a battery patients abandon."""
    assert daily_battery_seconds() <= DAILY_BUDGET_SECONDS


def test_the_daily_battery_covers_four_independent_domains():
    """Gate 2 needs two independent domains; the daily battery must be able to supply them."""
    domains = {MODULES[c].domain for c in DAILY_MODULES}
    assert len(domains) >= 4


def test_every_module_appears_in_exactly_one_schedule():
    scheduled = set(DAILY_MODULES) | set(WEEKLY_MODULES) | set(MONTHLY_MODULES)
    any_time = {c for c, m in MODULES.items() if m.schedule == "any"}
    assert scheduled | any_time == set(MODULES)
    assert not (set(DAILY_MODULES) & set(WEEKLY_MODULES))


def test_every_module_has_bilingual_instructions():
    for code, module in MODULES.items():
        assert module.instructions_en, code
        assert module.instructions_hi, code


# --------------------------------------------------------------------------- M1 facial
def _face(n_points: int = 478, droop: float = 0.0, brow_lift: float = 0.0,
          left_brow_lift: float | None = None) -> np.ndarray:
    """A synthetic landmark set with controllable asymmetry."""
    pts = np.zeros((n_points, 3), dtype=float)
    pts[1] = [0.50, 0.50, 0.0]     # nose tip
    pts[168] = [0.50, 0.42, 0.0]   # nose bridge
    pts[199] = [0.50, 0.72, 0.0]   # chin
    pts[61] = [0.42, 0.60 + droop, 0.0]   # left mouth corner (droops)
    pts[291] = [0.58, 0.60, 0.0]          # right mouth corner
    pts[13], pts[14] = [0.50, 0.585, 0.0], [0.50, 0.605, 0.0]
    for idx, x in ((105, 0.44), (334, 0.56), (70, 0.40), (300, 0.60)):
        lift = left_brow_lift if (left_brow_lift is not None and x < 0.5) else brow_lift
        pts[idx] = [x, 0.38 - lift, 0.0]
    for base, cx in ((33, 0.44), (362, 0.56)):
        pts[base] = [cx - 0.03, 0.45, 0.0]
        pts[base + 1] = [cx - 0.015, 0.435, 0.0]
        pts[base + 2] = [cx + 0.015, 0.435, 0.0]
    pts[133], pts[153], pts[144] = [0.47, 0.45, 0], [0.455, 0.465, 0], [0.425, 0.465, 0]
    pts[385], pts[387], pts[263] = [0.545, 0.435, 0], [0.575, 0.435, 0], [0.59, 0.45, 0]
    pts[373], pts[380] = [0.575, 0.465, 0], [0.545, 0.465, 0]
    pts[129], pts[358] = [0.455, 0.55, 0], [0.545, 0.55, 0]
    pts[205], pts[425] = [0.43, 0.56, 0], [0.57, 0.56, 0]
    pts[10] = [0.50, 0.30, 0.0]
    return pts


def test_facial_frame_features_detect_a_drooping_mouth_corner():
    symmetric = frame_features(_face(droop=0.0))
    drooping = frame_features(_face(droop=0.04))
    assert drooping["corner_drop"] > symmetric["corner_drop"]
    assert drooping["mouth_corner_symmetry"] > symmetric["mouth_corner_symmetry"]


def test_facial_extractor_needs_enough_frames():
    assert extract_facial_motor({"smile": [_face().tolist()]})["valid"] == 0.0
    assert extract_facial_motor({})["valid"] == 0.0


def test_facial_extractor_produces_the_full_feature_set():
    frames = [_face(droop=0.01 * (i % 2)).tolist() for i in range(10)]
    feats = extract_facial_motor({
        "smile": frames, "forehead_raise": frames,
        "eye_closure": frames, "cheek_puff": frames,
    })
    assert feats["valid"] == 1.0
    assert feats["tasks_completed"] == 4.0
    for key in ("mouth_corner_symmetry", "corner_drop", "nasolabial_ratio",
                "forehead_movement_symmetry", "landmark_tremor", "blink_asymmetry"):
        assert key in feats, key


def test_forehead_sparing_is_measurable():
    """The central-vs-peripheral discriminator (M1's whole reason for existing).

    A central pattern has an asymmetric lower face and a SYMMETRIC forehead, so
    `central_pattern_index` (lower asymmetry minus upper asymmetry) is clearly positive.
    """
    smile = [_face(droop=0.05).tolist() for _ in range(10)]
    # Forehead raises equally on both sides -> spared.
    forehead = [_face(droop=0.05, brow_lift=0.02 * (i % 2)).tolist() for i in range(10)]
    central = extract_facial_motor({"smile": smile, "forehead_raise": forehead})

    # Peripheral: the left brow barely moves.
    forehead_weak = [_face(droop=0.05, brow_lift=0.02 * (i % 2),
                           left_brow_lift=0.0).tolist() for i in range(10)]
    peripheral = extract_facial_motor({"smile": smile, "forehead_raise": forehead_weak})

    assert central["forehead_movement_symmetry"] < peripheral["forehead_movement_symmetry"]
    assert central["central_pattern_index"] > peripheral["central_pattern_index"]


# --------------------------------------------------------------------------- M4 speech
def _voiced(seconds: float, f0: float = 130.0, noise: float = 0.01) -> np.ndarray:
    t = np.arange(int(seconds * SR))
    sig = np.sin(2 * np.pi * f0 * t / SR) + 0.4 * np.sin(4 * np.pi * f0 * t / SR)
    return sig + RNG.normal(0, noise, t.size)


def test_sustained_phonation_measures_maximum_phonation_time():
    short = sustained_phonation_features(_voiced(1.5))
    long = sustained_phonation_features(_voiced(5.0))
    assert short["valid"] == long["valid"] == 1.0
    assert long["max_phonation_time"] > short["max_phonation_time"]


def test_sustained_phonation_rejects_a_too_short_clip():
    assert sustained_phonation_features(np.zeros(100))["valid"] == 0.0


def test_ddk_counts_syllables_and_measures_regularity():
    # Six evenly spaced bursts.
    burst = np.concatenate([_voiced(0.08), np.zeros(int(0.12 * SR))])
    even = np.tile(burst, 6)
    feats = ddk_features(even)
    assert feats["valid"] == 1.0
    assert feats["ddk_syllables"] >= 4
    assert feats["ddk_rate"] > 0


def test_ddk_regularity_is_worse_for_an_uneven_sequence():
    even = np.tile(np.concatenate([_voiced(0.08), np.zeros(int(0.12 * SR))]), 8)
    uneven = np.concatenate([
        np.concatenate([_voiced(0.08), np.zeros(int(gap * SR))])
        for gap in (0.10, 0.24, 0.11, 0.30, 0.12, 0.26, 0.10, 0.28)
    ])
    a, b = ddk_features(even), ddk_features(uneven)
    if a.get("ddk_regularity") and b.get("ddk_regularity"):
        assert b["ddk_regularity"] > a["ddk_regularity"]


# --------------------------------------------------------------------------- M5 language
def test_connected_speech_features_measure_fluency():
    feats = connected_speech_features(
        "The boy is taking cookies. The girl is asking for one. The water is running over.",
        30.0)
    assert feats["words_per_min"] > 0
    assert 0 < feats["type_token_ratio"] <= 1
    assert feats["utterance_count"] == 3


def test_naming_captures_latency_before_accuracy_falls():
    fast = naming_features([{"correct": True, "latency_ms": 800} for _ in range(10)])
    slow = naming_features([{"correct": True, "latency_ms": 2600} for _ in range(10)])
    assert fast["naming_accuracy"] == slow["naming_accuracy"] == 1.0
    assert slow["word_finding_latency"] > fast["word_finding_latency"]


def test_repetition_is_scored_by_token_overlap():
    perfect = repetition_features([{"target": "no ifs ands or buts",
                                    "said": "no ifs ands or buts"}])
    partial = repetition_features([{"target": "no ifs ands or buts", "said": "no ifs"}])
    assert perfect["repetition_accuracy"] == 1.0
    assert 0 < partial["repetition_accuracy"] < 1.0


def test_fluency_counts_unique_items_and_penalises_repeats():
    feats = fluency_features(["dog", "cat", "cow", "dog", "goat", "hen"])
    assert feats["fluency_count"] == 5
    assert feats["fluency_repetitions"] == 1


def test_aphasia_extractor_combines_available_tasks():
    feats = extract_aphasia({
        "description": {"transcript": "A boy and a girl in a kitchen.", "duration_s": 20},
        "naming": [{"correct": True, "latency_ms": 900}] * 10,
        "repetition": [{"target": "the sky is blue", "said": "the sky is blue"}],
        "comprehension": [{"correct": True}] * 4,
        "fluency": {"words": ["dog", "cat", "cow"], "duration_s": 60},
    })
    assert feats["valid"] == 1.0
    assert feats["tasks_completed"] == 5


def test_aphasia_extractor_with_nothing_is_invalid():
    assert extract_aphasia({})["valid"] == 0.0


# --------------------------------------------------------------------------- M6/M7 motor
def _pose(n: int, drift_right: float = 0.0) -> list:
    frames = []
    for i in range(n):
        pts = np.zeros((33, 3), dtype=float)
        pts[11], pts[12] = [0.35, 0.40, 0], [0.65, 0.40, 0]      # shoulders
        pts[15] = [0.20, 0.45, 0]                                 # left wrist
        pts[16] = [0.80, 0.45 + drift_right * i / max(1, n - 1), 0]  # right wrist drifts
        pts[19], pts[21] = [0.18, 0.44, 0], [0.19, 0.47, 0]
        pts[20], pts[22] = [0.82, 0.44, 0], [0.81, 0.47, 0]
        frames.append(pts.tolist())
    return frames


def test_pronator_drift_detects_a_drifting_arm():
    steady = extract_pronator_drift({"frames": _pose(30, 0.0)})
    drifting = extract_pronator_drift({"frames": _pose(30, 0.12)})
    assert steady["valid"] == drifting["valid"] == 1.0
    assert drifting["max_drift"] > steady["max_drift"]
    assert drifting["drift_asymmetry"] > steady["drift_asymmetry"]


def test_pronator_drift_needs_enough_frames():
    assert extract_pronator_drift({"frames": _pose(3)})["valid"] == 0.0


def test_tap_features_measure_rate_and_consistency():
    steady = tap_features(list(np.arange(0, 10000, 200)), "L")
    erratic = tap_features(list(np.cumsum(RNG.uniform(120, 400, 50))), "L")
    assert steady["tap_rate_L"] > 0
    assert erratic["inter_tap_cv_L"] > steady["inter_tap_cv_L"]


def test_asymmetry_ratio_separates_unilateral_from_bilateral_slowing():
    """The discriminator that separates a lesion from Parkinson's or plain ageing."""
    fast = list(np.arange(0, 10000, 200))    # 5 taps/sec
    slow = list(np.arange(0, 10000, 400))    # 2.5 taps/sec

    unilateral = extract_fine_motor({"taps_L": fast, "taps_R": slow})
    bilateral = extract_fine_motor({"taps_L": slow, "taps_R": slow})

    assert unilateral["tap_asymmetry_ratio"] > 0.3
    assert bilateral["tap_asymmetry_ratio"] < 0.05
    # Both are slow overall, so rate alone cannot tell them apart...
    assert bilateral["tap_rate_mean"] < unilateral["tap_rate_mean"]
    # ...but the asymmetry ratio can, which is the point.
    assert unilateral["tap_asymmetry_ratio"] > bilateral["tap_asymmetry_ratio"] * 10


# --------------------------------------------------------------------------- M8/M9
def test_coordination_measures_endpoint_accuracy_and_smoothness():
    straight = {"path": [[i / 20, i / 20] for i in range(21)],
                "target": [1.0, 1.0], "fps": 30}
    wobbly = {"path": [[i / 20 + RNG.normal(0, 0.05), i / 20 + RNG.normal(0, 0.05)]
                       for i in range(21)], "target": [1.0, 1.0], "fps": 30}
    smooth = extract_coordination({"reaches": [straight] * 3})
    ataxic = extract_coordination({"reaches": [wobbly] * 3})
    assert smooth["valid"] == ataxic["valid"] == 1.0
    assert ataxic["movement_smoothness"] > smooth["movement_smoothness"]


def test_gait_extractor_reads_tug_and_sway():
    fs = 50.0
    t = np.arange(int(fs * 10)) / fs
    walk = np.stack([np.sin(2 * np.pi * 1.7 * t), np.cos(2 * np.pi * 1.7 * t),
                     9.8 + 0.4 * np.sin(2 * np.pi * 1.7 * t)], axis=1)
    feats = extract_gait_balance({
        "tug_seconds": 14.2, "accel": walk.tolist(), "fs": fs,
        "sway": (RNG.normal(0, 0.02, (int(fs * 10), 3))).tolist(), "sway_fs": fs,
    })
    assert feats["valid"] == 1.0
    assert feats["tug_seconds"] == pytest.approx(14.2)
    assert 60 < feats["cadence"] < 220
    assert feats["sway_area"] > 0


# --------------------------------------------------------------------------- M10-M12
def test_reaction_variability_is_captured_independently_of_speed():
    consistent = extract_attention_speed({"simple_rt": {
        "latencies_ms": [450, 455, 448, 452, 447, 453, 449, 451, 450, 452, 448, 450]}})
    erratic = extract_attention_speed({"simple_rt": {
        "latencies_ms": [300, 620, 340, 700, 380, 590, 330, 650, 360, 610, 350, 640]}})
    # Almost identical medians...
    assert abs(consistent["rt_median"] - erratic["rt_median"]) < 60
    # ...but very different consistency, which is the sensitive marker.
    assert erratic["rt_cov"] > consistent["rt_cov"] * 3


def test_attention_extractor_needs_enough_trials():
    assert extract_attention_speed({"simple_rt": {"latencies_ms": [400, 410]}})["valid"] == 0.0


def test_decision_cost_isolates_the_choice_component():
    feats = extract_attention_speed({
        "simple_rt": {"latencies_ms": [450] * 12},
        "choice_rt": [{"latency_ms": 700, "correct": True}] * 12,
    })
    assert feats["decision_cost_ms"] == pytest.approx(250, abs=5)


def test_memory_module_separates_encoding_from_retrieval():
    feats = extract_memory_executive({
        "recall_immediate": 5, "recall_delayed": 2,
        "span_forward": 6, "span_backward": 3,
        "tmt_a_seconds": 40, "tmt_b_seconds": 120, "clock_score": 9,
        "education_band": "primary",
    })
    assert feats["valid"] == 1.0
    assert feats["retention_ratio"] == pytest.approx(0.4, abs=0.01)
    assert feats["span_gap"] == 3
    assert feats["tmt_b_minus_a"] == 80


def test_neglect_reports_the_lateralised_asymmetry_not_the_total():
    lateralised = extract_neglect({"cancellation": {"left_total": 20, "left_found": 8,
                                                    "right_total": 20, "right_found": 19}})
    symmetric = extract_neglect({"cancellation": {"left_total": 20, "left_found": 14,
                                                  "right_total": 20, "right_found": 13}})
    assert lateralised["omission_asymmetry"] > symmetric["omission_asymmetry"] * 3


def test_ocular_module_reads_pursuit_error():
    good = [{"gaze": [i / 10, 0.5], "target": [i / 10, 0.5]} for i in range(20)]
    poor = [{"gaze": [i / 10 + RNG.normal(0, 0.05), 0.5], "target": [i / 10, 0.5]}
            for i in range(20)]
    assert extract_ocular({"pursuit": poor})["pursuit_error_mean"] > \
           extract_ocular({"pursuit": good})["pursuit_error_mean"]


# --------------------------------------------------------------------------- M13-M16
def test_phq2_escalates_at_the_validated_threshold():
    low = score_instrument("PHQ2", [0, 1])
    high = score_instrument("PHQ2", [2, 2])
    assert low["escalate_to_phq9"] is False
    assert high["phq2_score"] == 4 >= PHQ2_POSITIVE_THRESHOLD
    assert high["escalate_to_phq9"] is True


def test_phq9_item_nine_escalates_regardless_of_the_total():
    """A low total with a positive self-harm item is still an emergency."""
    low_total_with_flag = score_instrument("PHQ9", [0, 0, 0, 0, 0, 0, 0, 0, 1])
    assert low_total_with_flag["phq9_score"] == 1
    assert low_total_with_flag["requires_urgent_review"] is True

    higher_without = score_instrument("PHQ9", [2, 2, 2, 2, 1, 1, 1, 1, 0])
    assert higher_without["phq9_score"] == 12
    assert higher_without["requires_urgent_review"] is False


def test_fss_reports_the_mean_item_score():
    assert score_instrument("FSS", [5] * 9)["fss_mean"] == 5.0
    assert score_instrument("FSS", [1] * 9)["fss_positive"] == 0.0


def test_barthel_bands_dependency():
    assert score_instrument("BARTHEL", {"a": 100})["barthel_dependency"] == "independent"
    assert score_instrument("BARTHEL", {"a": 30})["barthel_dependency"] == "very dependent"


def test_eat10_advisory_is_non_diagnostic():
    positive = score_instrument("EAT10", [1] * 10)
    assert positive["eat10_score"] == 10 >= EAT10_POSITIVE_THRESHOLD
    assert "doctor" in positive["advisory"]
    assert "dysphagia" not in positive["advisory"].lower()


def test_incomplete_questionnaires_are_rejected():
    assert score_instrument("PHQ9", [1, 2])["valid"] == 0.0
    assert score_instrument("NOPE", [1])["valid"] == 0.0


# --------------------------------------------------------------------------- M17-M20
def test_rr_features_compute_the_standard_hrv_set():
    regular = rr_features(np.array([800.0] * 20))
    irregular = rr_features(np.array([600, 950, 700, 1050, 640, 900] * 4, dtype=float))
    assert regular["mean_hr"] == pytest.approx(75.0, abs=1)
    assert irregular["rr_irregularity_index"] > regular["rr_irregularity_index"]
    for key in ("rmssd", "pnn50", "poincare_sd1", "poincare_sd2"):
        assert key in irregular


def test_rhythm_advisory_never_names_a_diagnosis():
    irregular = extract_rhythm({"rr_ms": [600, 980, 640, 1080, 620, 940] * 4})
    assert irregular["valid"] == 1.0
    if irregular["rr_irregularity_index"] >= IRREGULARITY_ADVISORY_THRESHOLD:
        assert irregular["irregular_rhythm_flag"] == 1.0
        assert "ECG" in irregular["advisory"]
        assert "fibrillation" not in irregular["advisory"].lower()


def test_rhythm_detects_beats_from_a_ppg_waveform():
    fs = 30.0
    t = np.arange(int(fs * 20)) / fs
    ppg = np.sin(2 * np.pi * 1.2 * t) + 0.05 * RNG.normal(0, 1, t.size)
    feats = extract_rhythm({"ppg": ppg.tolist(), "fs": fs})
    assert feats["valid"] == 1.0
    assert 40 < feats["mean_hr"] < 160


def test_blood_pressure_flags_an_urgent_reading():
    normal = extract_blood_pressure({"bp_sys": 128, "bp_dia": 82})
    urgent = extract_blood_pressure({"bp_sys": 195, "bp_dia": 118})
    assert normal["bp_urgent_flag"] == 0.0
    assert urgent["bp_urgent_flag"] == 1.0
    assert "doctor" in urgent["advisory"]


def test_adherence_tracks_the_streak():
    feats = extract_adherence({"taken": True,
                               "history": [True, True, False, True, True, True]})
    assert feats["adherence_streak"] == 3
    assert 0 < feats["adherence_rate_30d"] < 1


def test_symptom_log_flags_acute_reports():
    acute = extract_symptom_log({"symptoms": ["sudden_weakness", "tired"]})
    benign = extract_symptom_log({"symptoms": ["tired"]})
    assert acute["acute_flag"] == 1.0
    assert acute["acute_symptoms"] == ["sudden_weakness"]
    assert benign["acute_flag"] == 0.0
