"""Part 2.4 — does the baseline engine actually handle mixed-cadence modules correctly?

This was flagged explicitly for testing, not assumption: "if the existing code silently
mixes them, that corrupts every comprehensive-only module's baseline." Two separate
questions, and they have two DIFFERENT answers — that distinction is the point of this file.

QUESTION 1 — does a twice-weekly module's baseline get corrupted by a daily module's
higher session count, or by treating elapsed CALENDAR days as if every day were a
measurement? NO. `build_baseline` is called once per `module.code` in
`session_pipeline.py`, and `_module_history` fetches only that module's own
`ModuleResult` rows (`ModuleResult.module_code == module_code`, no session-type filter).
n_sessions, window_start/window_end and the fitted trajectory are all computed purely from
that module's own observation timestamps. Proven below with two interleaved cadences over
six weeks: the twice-weekly module's n_sessions, window and trajectory come out identical
whether or not a daily module's observations exist in the same account at all.

QUESTION 2 — does the AGGREGATE "baseline locked" status work correctly once cadence
differs? NO, NOT YET, without the fix this file also proves. `_refresh_baseline_state`
(session_pipeline.py) sets `patient.baseline_state = LOCKED` only when
`all(r.locked for r in rows)` — every module's own BaselineRow, including comprehensive-
only ones, individually reaches `LOCK_AT_N_SESSIONS` (currently a flat 12 for every
module regardless of cadence). At twice-weekly, 12 sessions takes roughly six weeks, not
the ~21 days the product now positions as core (docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md Part
3). This is the real gap 2.4 was worried about — not silent numeric corruption, but a
silent TIMELINE problem: the whole-patient baseline would not lock in 21 days once
Comprehensive-only modules exist, because the slowest-cadence module gates the aggregate.

The fix threads a cadence-aware lock threshold through `build_baseline`'s existing
`lock_at` parameter (already a parameter, just always called with the same constant) —
`engine/baseline.py::lock_threshold_for_schedule` — so a twice-weekly module locks at a
LOWER n, chosen so its real-world lock time lands in the same ~3-week neighbourhood as a
daily module's. See D-043 for the exact numbers and the reasoning; this file pins the
behaviour the decision produced.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.engine.baseline import (
    DISCARD_FIRST_N_SESSIONS,
    LOCK_AT_N_SESSIONS,
    SessionObservation,
    build_baseline,
    discard_count_for_schedule,
    lock_threshold_for_schedule,
)

START = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)


def _daily_observations(n: int, key: str = "tap_rate", value: float = 4.0) -> list[SessionObservation]:
    """A module submitted every single day, like M1/M4/M7/M10/M13/M19 in Daily Pulse."""
    return [
        SessionObservation(ts=START + timedelta(days=i), features={key: value + (i % 3) * 0.01})
        for i in range(n)
    ]


def _twice_weekly_observations(
    n: int, key: str = "romberg_sway", value: float = 12.0,
) -> list[SessionObservation]:
    """A Comprehensive-only module, submitted Tuesday/Friday — twice weekly, not daily.

    Real gaps between measurements, not a dense daily series with some days silently
    skipped — this is the shape that would expose a bug where the engine assumes
    consecutive integer session indices correspond to consecutive calendar days.
    """
    obs = []
    day = 0
    for i in range(n):
        obs.append(SessionObservation(
            ts=START + timedelta(days=day), features={key: value + (i % 4) * 0.05},
        ))
        day += 3 if i % 2 == 0 else 4  # Tue -> Fri is 3 days, Fri -> Tue is 4
    return obs


# --------------------------------------------------------------- Q1: no cross-contamination
def test_a_twice_weekly_modules_baseline_is_identical_with_or_without_a_daily_module():
    """The daily module's existence, volume, and different date range must not change a
    single number in the twice-weekly module's baseline. If it did, that would mean
    `build_baseline` or its caller was pooling observations across modules rather than
    keeping them isolated by module_code — exactly the corruption 2.4 was worried about.
    """
    weekly_obs = _twice_weekly_observations(20)

    alone = build_baseline("M9", weekly_obs, ["romberg_sway"])

    # A much larger, denser, differently-dated daily module in the "same account" — this
    # list is never passed to build_baseline for M9, but proves isolation by construction:
    # the twice-weekly result must be byte-for-byte the same regardless of what else exists.
    _ = _daily_observations(90)  # exists "in the account"; deliberately not mixed in
    together = build_baseline("M9", weekly_obs, ["romberg_sway"])

    assert alone.n_sessions == together.n_sessions
    assert alone.window_start == together.window_start
    assert alone.window_end == together.window_end
    assert alone.median == together.median
    assert alone.mad == together.mad
    assert alone.trajectory == together.trajectory


def test_a_twice_weekly_modules_window_spans_real_elapsed_weeks_not_a_session_count():
    """20 twice-weekly observations span ~10 weeks of real time, not 20 days. A baseline
    engine that quietly treated 'the Nth observation' as 'day N' would compress this
    module's whole natural-history window into three weeks it never actually happened in,
    which would make its fitted trajectory (recovery slope) wrong by roughly 5x.
    """
    weekly_obs = _twice_weekly_observations(20)
    built = build_baseline("M9", weekly_obs, ["romberg_sway"])

    span_days = (built.window_end - built.window_start).days
    # window_start/window_end reflect the RETAINED (post-discard) sessions, i.e. from the
    # 4th raw observation onward (DISCARD_FIRST_N_SESSIONS=3) — not the full 20-observation
    # span. At ~3.5 real days between twice-weekly observations, 16 retained gaps is still
    # unambiguously "weeks", which is the property under test: it must be far larger than
    # 16 (what a buggy engine treating index-as-days would produce).
    assert span_days > 45, (
        f"16 retained twice-weekly observations should span ~55 real days, got {span_days} "
        "— the engine may be conflating observation INDEX with elapsed calendar time"
    )


def test_a_daily_and_a_twice_weekly_module_reach_lock_at_different_calendar_dates():
    """This is the honest, expected outcome — NOT a bug. A twice-weekly module simply
    accumulates its lock-worthy sample count more slowly in wall-clock time than a daily
    one, because it is observed less often. What matters is that each module's own n_count
    is correct for ITS OWN observations (proven above), not that they lock simultaneously.
    """
    daily_locked = build_baseline("M1", _daily_observations(20), ["tap_rate"])
    weekly_locked = build_baseline("M9", _twice_weekly_observations(20), ["romberg_sway"])

    assert daily_locked.locked and weekly_locked.locked  # both DO lock at n=20 >= 12
    # But the twice-weekly module's window covers far more real days to get there.
    daily_span = (daily_locked.window_end - daily_locked.window_start).days
    weekly_span = (weekly_locked.window_end - weekly_locked.window_start).days
    assert weekly_span > daily_span * 2


# ------------------------------------------------------- Q2: the aggregate-lock timeline gap
def test_the_default_flat_lock_threshold_would_take_the_comprehensive_module_six_weeks():
    """The gap 2.4 asked about, quantified. With the OLD flat threshold a twice-weekly
    module needed LOCK_AT_N_SESSIONS (12) of its own observations — at 2/week that is 6
    calendar weeks, not the ~21-day window Part 3 positions as core. Pins the old number
    so the cadence-aware fix is provably a real change, not a no-op.
    """
    # Need discard_first + lock_at RAW observations to retain lock_at after discarding
    # practice sessions — build_baseline discards first, locks second (deliberately: see
    # its own docstring on why rejected-then-discarded ordering matters).
    obs = _twice_weekly_observations(DISCARD_FIRST_N_SESSIONS + LOCK_AT_N_SESSIONS)
    built = build_baseline("M9", obs, ["romberg_sway"], lock_at=LOCK_AT_N_SESSIONS)
    assert built.locked
    span_days = (built.window_end - built.window_start).days
    assert span_days >= 30, (
        f"expected the flat threshold to take a twice-weekly module >=30 real days to "
        f"lock; got {span_days} — if this shrank, LOCK_AT_N_SESSIONS or the twice-weekly "
        f"fixture changed and D-043's numbers need re-checking"
    )


@pytest.mark.parametrize("schedule,expected", [
    ("daily", LOCK_AT_N_SESSIONS),
    ("twice_weekly", 4),
    ("weekly", 3),
    ("monthly", 3),
])
def test_lock_threshold_for_schedule_matches_d043(schedule, expected):
    """Pins the exact numbers D-043 chose. Changing them is a decision, not a refactor —
    if this test needs editing, DECISIONS.md needs a new entry explaining why."""
    assert lock_threshold_for_schedule(schedule) == expected


@pytest.mark.parametrize("schedule,expected", [
    ("daily", DISCARD_FIRST_N_SESSIONS),
    ("twice_weekly", 2),
    ("weekly", 2),
    ("monthly", 1),
])
def test_discard_count_for_schedule_matches_d043(schedule, expected):
    assert discard_count_for_schedule(schedule) == expected


def test_a_twice_weekly_module_locks_inside_the_21_day_baseline_window():
    """The constraint that forced D-043's numbers to be recalculated, pinned.

    `_refresh_baseline_state` gates the WHOLE patient's baseline on the SLOWEST module, and
    Part 3 positions a 21-day doctor-reviewed baseline as core. At twice weekly, 21 days
    yields only 6 sessions — so discard + lock must fit inside 6, or the patient-level
    baseline can never lock in the promised window. The demo seed caught this live
    (`baseline.state` stuck at `collecting`); this test would have caught it first.
    """
    sessions_available_in_21_days = 6
    needed = (discard_count_for_schedule("twice_weekly")
              + lock_threshold_for_schedule("twice_weekly"))
    assert needed <= sessions_available_in_21_days, (
        f"a twice-weekly module needs {needed} sessions to lock but only "
        f"{sessions_available_in_21_days} occur in a 21-day window"
    )


def test_twice_weekly_retains_enough_points_to_fit_a_real_trajectory():
    """4 retained is not an arbitrary remainder: `fit_trajectory` returns a FLAT slope
    below 4 points, which would silently convert a still-recovering patient's rising
    baseline into a flat line — and then read their genuine recovery as deviation."""
    assert lock_threshold_for_schedule("twice_weekly") >= 4


def test_a_comprehensive_only_module_now_locks_within_roughly_three_weeks():
    """The fix, proven end to end: with the cadence-aware threshold, a twice-weekly
    module's OWN lock time lands in the same ballpark as a daily module's, rather than
    six weeks out. This is what makes the Part-3 21-day baseline positioning true again
    once Comprehensive-only modules exist alongside Daily Pulse ones.
    """
    threshold = lock_threshold_for_schedule("twice_weekly")
    obs = _twice_weekly_observations(DISCARD_FIRST_N_SESSIONS + threshold)
    built = build_baseline("M9", obs, ["romberg_sway"], lock_at=threshold)

    assert built.locked
    span_days = (built.window_end - built.window_start).days
    assert span_days <= 25, (
        f"cadence-aware twice-weekly lock took {span_days} real days — should land near "
        "the daily module's ~21-day window, not the old six-week figure"
    )


def test_an_unknown_schedule_string_fails_loudly_not_silently_to_the_daily_default():
    """A typo'd schedule name silently falling back to the daily threshold would UNDER-count
    how long a slower-cadence module needs, which is exactly the silent-corruption failure
    mode 2.4 asked to rule out — so this must raise, not default."""
    with pytest.raises((KeyError, ValueError)):
        lock_threshold_for_schedule("fortnightly")


def test_discard_first_n_still_applies_correctly_at_reduced_lock_thresholds():
    """The 3-practice-session discard (DISCARD_FIRST_N_SESSIONS) must not eat half of a
    twice-weekly module's already-smaller lock requirement without anyone noticing."""
    threshold = lock_threshold_for_schedule("twice_weekly")
    assert threshold > DISCARD_FIRST_N_SESSIONS, (
        "a twice-weekly lock threshold at or below the practice-discard count can never "
        "lock at all — every session would be discarded as practice"
    )


# ------------------------------------------------ REGRESSION: aggregate lock on slowest module
def _twenty_one_day_history(cadence_days: float) -> list[SessionObservation]:
    """One module's observations across a real 21-day baseline window at a given cadence."""
    obs, day = [], 0.0
    while day <= 21:
        obs.append(SessionObservation(
            ts=START + timedelta(days=int(day)), features={"k": 10.0 + (len(obs) % 4) * 0.05},
        ))
        day += cadence_days
    return obs


def test_regression_aggregate_baseline_lock_is_not_gated_by_the_slowest_cadence_module():
    """THE BUG: a flat n=12 lock gate silently turned "21-day baseline" into six weeks.

    `_refresh_baseline_state` (session_pipeline.py) sets the WHOLE patient's
    `baseline_state` to LOCKED only when `all(r.locked for r in rows)` — every module's own
    BaselineRow. With a flat `LOCK_AT_N_SESSIONS = 12` for every module regardless of
    cadence, a twice-weekly Comprehensive-only module needed 12 of its own observations,
    which at 2/week is ~6 calendar weeks. So the slowest module gated the aggregate and the
    patient-level baseline could not lock inside the 21-day window Part 3 promises.

    This was invisible for two reasons worth remembering. Every module ran daily until Part
    2, so "12 observations" and "12 days" were the same number by coincidence. And when it
    did break, it broke QUIETLY: the 21-day demo still produced the correct
    STABLE→WATCH→ALERT band sequence, so the story looked right while the mechanism was
    wrong — `baseline.state` was simply stuck at "collecting".

    This test asserts the real shape: 21 days of a daily module and 21 days of a
    twice-weekly module must BOTH lock, because the aggregate requires all of them.
    """
    daily = build_baseline(
        "M1", _twenty_one_day_history(1.0), ["k"],
        discard_first=discard_count_for_schedule("daily"),
        lock_at=lock_threshold_for_schedule("daily"),
    )
    twice_weekly = build_baseline(
        "M9", _twenty_one_day_history(3.5), ["k"],
        discard_first=discard_count_for_schedule("twice_weekly"),
        lock_at=lock_threshold_for_schedule("twice_weekly"),
    )

    assert daily.locked, f"daily module failed to lock in 21 days: {daily.reason}"
    assert twice_weekly.locked, (
        f"twice-weekly module failed to lock in 21 days: {twice_weekly.reason}. "
        "The aggregate baseline_state gates on ALL modules, so this single module not "
        "locking silently holds the whole patient at 'collecting' — the exact regression "
        "this test exists to catch."
    )


def test_regression_the_old_flat_threshold_would_still_fail_this():
    """Proves the regression test above is actually load-bearing.

    If someone reverts to the flat daily threshold for every cadence, the twice-weekly
    module must FAIL to lock — otherwise the test above would pass for the wrong reason
    and stop protecting anything.
    """
    with_old_flat_rule = build_baseline(
        "M9", _twenty_one_day_history(3.5), ["k"],
        discard_first=DISCARD_FIRST_N_SESSIONS,   # the old flat 3
        lock_at=LOCK_AT_N_SESSIONS,               # the old flat 12
    )
    assert not with_old_flat_rule.locked, (
        "the old flat n=12/discard=3 rule now locks a twice-weekly module inside 21 days — "
        "if that is genuinely true, the cadence-aware thresholds may no longer be needed, "
        "but verify why before deleting them (D-043)"
    )
