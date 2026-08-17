"""ml/test_sim.py, ported from a print-out script into real assertions.

Ten simulated days, seed=42, in the reference module's exact RNG call order:
    days 1-4   build the baseline
    days 5-7   stable      -> no alert, ever
    days 8-9   declining   -> WATCH: deviation is present but not yet cross-validated
    day 10     declining   -> ALERT: the third sustained day across >=2 signals

This is the PRD's demo acceptance criterion (§7): zero false alerts across a stable week,
and an injected decline flagged within one check-in of it becoming sustained.
"""
from __future__ import annotations

import pytest

from app.ml.baseline import build_baseline, modality_deviation, z_scores
from app.ml.explain import explain
from app.ml.scoring import DEV_THRESHOLD, alert_decision, stability_score

from .simulation import FK, PLAN, RK, VK, make_rng, reference_day

ALL_VALID = {"voice": True, "face": True, "reaction": True}


def run_simulation() -> list[dict]:
    """Replays ml/test_sim.py. Returns one record per scored day (days 5..10)."""
    rng = make_rng(42)

    # --- 4 clean baseline days per modality, built in the reference order ---
    vb = build_baseline([reference_day(rng, VK) for _ in range(4)], VK)
    fb = build_baseline([reference_day(rng, FK) for _ in range(4)], FK)
    rb = build_baseline([reference_day(rng, RK) for _ in range(4)], RK)
    assert vb["ready"] and fb["ready"] and rb["ready"]
    assert vb["n_days"] == fb["n_days"] == rb["n_days"] == 4

    history: list[dict] = []
    days: list[dict] = []
    for day_number, (label, drift) in enumerate(PLAN, start=5):
        vf = reference_day(rng, VK, drift)
        ff = reference_day(rng, FK, drift)
        rf = reference_day(rng, RK, drift)

        vz = z_scores(vf, vb, VK)
        fz = z_scores(ff, fb, FK)
        rz = z_scores(rf, rb, RK)

        devs = {
            "voice": modality_deviation(vz),
            "face": modality_deviation(fz),
            "reaction": modality_deviation(rz),
        }
        score = stability_score(devs, ALL_VALID)
        history.append({"devs": devs, "score": score})
        decision = alert_decision(history)
        all_z = {**vz, **fz, **rz}

        days.append({
            "day": day_number,
            "label": label,
            "devs": devs,
            "score": score,
            "band": decision["band"],
            "reason": decision["reason"],
            "flagged": decision["modalities_flagged"],
            "explanation_en": explain(all_z, decision["band"], "en"),
            "explanation_hi": explain(all_z, decision["band"], "hi"),
        })
    return days


@pytest.fixture(scope="module")
def simulation() -> list[dict]:
    return run_simulation()


def test_the_simulation_covers_three_stable_then_three_declining_days(simulation):
    assert [d["day"] for d in simulation] == [5, 6, 7, 8, 9, 10]
    assert [d["label"] for d in simulation] == ["stable"] * 3 + ["decline"] * 3


# --------------------------------------------------------------- requirement 1: no false alerts
def test_no_alert_on_any_stable_day(simulation):
    stable_days = [d for d in simulation if d["label"] == "stable"]
    assert len(stable_days) == 3
    for d in stable_days:
        assert d["band"] == "STABLE", f"day {d['day']} was {d['band']}, expected STABLE"
        assert d["flagged"] == []


def test_stable_days_stay_well_below_the_deviation_threshold(simulation):
    for d in simulation:
        if d["label"] != "stable":
            continue
        for modality, dev in d["devs"].items():
            assert dev < DEV_THRESHOLD, f"day {d['day']} {modality} dev={dev:.2f}"


def test_stable_days_read_as_reassuring_in_both_languages(simulation):
    for d in simulation:
        if d["label"] == "stable":
            assert "normal" in d["explanation_en"].lower()
            assert "सामान्य" in d["explanation_hi"]


# --------------------------------------------------------------- requirement 2: escalation
def test_the_first_two_decline_days_are_watch_not_alert(simulation):
    for d in simulation:
        if d["day"] in (8, 9):
            assert d["band"] == "WATCH", f"day {d['day']} was {d['band']}"
            assert d["reason"] == "single-signal or unsustained deviation"


def test_alert_fires_on_the_third_sustained_decline_day(simulation):
    day10 = simulation[-1]
    assert day10["day"] == 10
    assert day10["band"] == "ALERT"
    assert len(day10["flagged"]) >= 2, day10["flagged"]
    assert "3+ days" in day10["reason"]


def test_the_alert_is_explained_in_english_and_hindi(simulation):
    day10 = simulation[-1]
    assert day10["explanation_en"].startswith("Please check on them today:")
    assert "आज उनका हाल ज़रूर देखें" in day10["explanation_hi"]
    assert len(day10["explanation_en"]) > 60 and len(day10["explanation_hi"]) > 40


def test_every_modality_deviates_on_every_decline_day(simulation):
    decline = [d for d in simulation if d["label"] == "decline"]
    for modality in ("voice", "face", "reaction"):
        devs = [d["devs"][modality] for d in decline]
        assert all(x > DEV_THRESHOLD for x in devs), f"{modality}: {devs}"


def test_the_score_rises_from_stable_into_the_alert_band(simulation):
    stable_scores = [d["score"] for d in simulation if d["label"] == "stable"]
    decline_scores = [d["score"] for d in simulation if d["label"] == "decline"]
    assert max(stable_scores) < 40.0
    assert min(decline_scores) >= 70.0


def test_the_simulation_is_deterministic():
    assert [d["band"] for d in run_simulation()] == [d["band"] for d in run_simulation()]
