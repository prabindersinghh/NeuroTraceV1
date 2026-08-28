"""Part 2.1/2.2 — the two-layer session model, and the position-consistency guarantee.

The central claim under test: Daily Pulse's six modules occupy IDENTICAL positions
whether captured standalone (Daily Pulse) or embedded in Comprehensive. This is not a
style preference — see D-044. `SessionObservation` carries a module's raw feature values
into its baseline with no position-adjustment, so if a module's true values shift with
fatigue position (the entire premise of `within_session_fatigue_slope`), letting the same
module land at different positions across session types would silently blend two
different physiological states into one "normal" baseline.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from app.exam.session_plan import (
    COMPREHENSIVE_STEPS,
    DAILY_PULSE_MODULES,
    DAILY_PULSE_STEPS,
    Intensity,
    PROTOCOL,
    planned_seconds,
    steps_for_session_type,
)


def test_every_daily_pulse_module_appears_in_the_daily_pulse_protocol():
    modules_present = {s.module for s in DAILY_PULSE_STEPS}
    assert modules_present == DAILY_PULSE_MODULES


def test_daily_pulse_steps_occupy_positions_one_through_six_consecutively():
    positions = [s.position for s in DAILY_PULSE_STEPS]
    assert positions == list(range(1, len(DAILY_PULSE_STEPS) + 1))


def test_daily_pulse_modules_land_at_identical_positions_in_both_protocols():
    """The property D-044 exists to guarantee. Compares module, task and position triples
    — not just module — so a reordering WITHIN the daily-pulse block would also be caught,
    not only a daily-pulse step drifting into the comprehensive-only range."""
    daily_pulse_triples = [(s.module, s.task, s.position) for s in DAILY_PULSE_STEPS]
    comprehensive_prefix = [
        (s.module, s.task, s.position) for s in COMPREHENSIVE_STEPS
        if s.module in DAILY_PULSE_MODULES
    ]
    assert daily_pulse_triples == comprehensive_prefix


def test_comprehensive_contains_every_step_from_the_original_protocol_exactly_once():
    """Nothing was dropped or duplicated in the derivation — every (module, task) pair
    from the source-of-truth PROTOCOL appears exactly once in COMPREHENSIVE_STEPS."""
    original = sorted((s.module, s.task) for s in PROTOCOL)
    derived = sorted((s.module, s.task) for s in COMPREHENSIVE_STEPS)
    assert original == derived


def test_comprehensive_only_steps_keep_their_original_relative_order():
    """The >=300s gap MIN_RECALL_DELAY_SECONDS requires between M11's word-encoding and
    delayed-recall steps, and the fall-risk gate's position relative to the standing
    block, both depend on this — a shuffle that preserved which steps appear but not their
    ORDER could silently violate either."""
    original_order = [
        (s.module, s.task) for s in PROTOCOL if s.module not in DAILY_PULSE_MODULES
    ]
    derived_order = [
        (s.module, s.task) for s in COMPREHENSIVE_STEPS if s.module not in DAILY_PULSE_MODULES
    ]
    assert original_order == derived_order


def test_the_fall_risk_gate_still_precedes_the_standing_block_in_comprehensive():
    from app.exam.session_plan import Block
    first_standing = next(
        s.position for s in COMPREHENSIVE_STEPS if s.block is Block.C_BALANCE
    )
    # Every seated step (blocks A, B) must precede it; nothing standing may appear earlier.
    for s in COMPREHENSIVE_STEPS:
        if s.block is Block.C_BALANCE:
            assert s.position >= first_standing
        else:
            assert s.position < first_standing or s.block.value.startswith(("D_", "E_"))


def test_daily_pulse_ignores_intensity_it_has_nothing_left_to_trim():
    full = steps_for_session_type("DAILY_PULSE", Intensity.FULL)
    light = steps_for_session_type("DAILY_PULSE", Intensity.LIGHT)
    assert full == light == list(DAILY_PULSE_STEPS)


def test_comprehensive_at_full_intensity_returns_everything():
    steps = steps_for_session_type("COMPREHENSIVE", Intensity.FULL)
    assert steps == list(COMPREHENSIVE_STEPS)


def test_comprehensive_at_standard_never_drops_a_daily_pulse_step():
    """STANDARD trims optional comprehensive-only steps; it must never be able to drop a
    Daily Pulse module — those six are not optional in any session type that includes
    them."""
    steps = steps_for_session_type("COMPREHENSIVE", Intensity.STANDARD)
    present = {s.module for s in steps if s.module in DAILY_PULSE_MODULES}
    assert present == DAILY_PULSE_MODULES


def test_comprehensive_at_light_always_includes_daily_pulse_plus_one_rotating_block():
    from app.exam.session_plan import Block
    for day in range(3):
        steps = steps_for_session_type("COMPREHENSIVE", Intensity.LIGHT, day_index=day)
        daily_pulse_present = {s.module for s in steps if s.module in DAILY_PULSE_MODULES}
        assert daily_pulse_present == DAILY_PULSE_MODULES
        # Every comprehensive-only step present is either core or in today's rotating block.
        rotating = [Block.B_OCULAR, Block.C_BALANCE, Block.D_MOTOR][day % 3]
        for s in steps:
            if s.module not in DAILY_PULSE_MODULES:
                assert s.core or s.block is rotating


def test_an_unknown_session_type_raises_rather_than_silently_returning_something():
    with pytest.raises(ValueError):
        steps_for_session_type("WEEKLY")  # the old name — must not silently still work


def test_daily_pulse_raw_task_time_is_the_honestly_reported_figure():
    """D-044: the six Daily Pulse modules sum to ~195s of raw task time, not the ~90s the
    task brief targeted. This pins the REAL number so a future change to any of the six
    modules' durations is a visible, deliberate edit — not a silent drift back toward (or
    further from) the stated target."""
    total = planned_seconds(list(DAILY_PULSE_STEPS))
    assert 180 <= total <= 210, (
        f"Daily Pulse raw task time is {total}s — if this changed, update the honest "
        "duration figure in docs/PRD.md, docs/DECISIONS.md D-044 and patient-facing copy "
        "to match, rather than letting the claim drift out of sync with reality again"
    )


# ------------------------------------------- registry.py vs session_plan.py timing agreement
def test_registry_matches_session_plan_timings():
    """Two files described how long each module takes, and they disagreed (D-045).

    `registry.py`'s per-module `seconds` had been reverse-engineered so the six DAILY
    modules summed to a 90-second target. `session_plan.py`'s `Step.seconds` — the numbers
    that actually drive the live timer — said 195 for the same six. Nothing computed "these
    six alone" until the Daily Pulse split, so the contradiction stayed invisible.

    The rule pinned here is deliberately an inequality, not equality: a module MAY claim
    more time than the daily protocol spends on it, because some modules own tasks the
    protocol does not run (M9's Unterberger and tandem walk are ASHA-visit only; M11 has
    three cognition tasks beyond word encoding and recall). What is never legitimate is
    claiming LESS than the protocol actually spends — that is the direction that
    under-promises the patient's real burden and let the 90s figure survive.
    """
    from collections import defaultdict

    from app.exam.registry import MODULES

    protocol_seconds: dict[str, int] = defaultdict(int)
    for step in PROTOCOL:
        protocol_seconds[step.module] += step.seconds

    understated = [
        f"{code}: registry claims {MODULES[code].seconds}s but the protocol spends {total}s"
        for code, total in sorted(protocol_seconds.items())
        if MODULES[code].seconds < total
    ]
    assert understated == [], (
        "A module claims less capture time than the protocol actually spends on it:\n  "
        + "\n  ".join(understated)
    )


def test_the_daily_pulse_budget_constant_is_the_real_number():
    """`DAILY_BUDGET_SECONDS` is asserted against by `test_exam_modules.py`, so if it drifts
    back to an aspirational target the suite would enforce the wrong figure — the exact way
    the 90s claim survived as long as it did."""
    from app.exam.registry import DAILY_BUDGET_SECONDS, daily_battery_seconds

    assert daily_battery_seconds() == planned_seconds(list(DAILY_PULSE_STEPS)), (
        "registry's Daily Pulse total and session_plan's Daily Pulse total disagree — "
        "these two must describe the same six modules identically"
    )
    assert DAILY_BUDGET_SECONDS >= daily_battery_seconds(), (
        "the budget is below the battery's real duration, which makes the budget a "
        "target rather than a limit — the mistake D-045 corrected"
    )
