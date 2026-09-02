"""The daily 12-minute protocol — ordering, intensity, and fatigue control.

The spec's reasoning for a 12-minute session is sound: a clinic follow-up runs 30 minutes
and we are replicating that examination. What makes it SAFE is that fatigue is controlled
rather than omitted, and what makes fatigue controllable is FIXED ORDERING — position
becomes a constant that each module's personal baseline absorbs.

These tests exist because two things break that constant after a baseline locks, both in
the direction that MASKS DECLINE: an intensity change (fewer preceding tasks = less
fatigued = better score) and a mid-session pause (tasks performed rested).
"""
from __future__ import annotations

import pytest

from app.exam.registry import MODULES
from app.exam.session_plan import (
    PROTOCOL,
    SUPERVISED_ONLY,
    Block,
    Intensity,
    TaskTiming,
    planned_seconds,
    should_offer_lighter,
    steps_for,
    within_session_fatigue_slope,
)


# ------------------------------------------------------------------ ordering
def test_positions_are_contiguous_and_ordered():
    positions = [s.position for s in PROTOCOL]
    assert positions == list(range(1, len(PROTOCOL) + 1))


def test_blocks_run_in_the_clinically_deliberate_order():
    """Cognitive first while freshest, standing in the middle, passive last.

    A block appearing out of order is not a cosmetic bug: every locked baseline encodes its
    module's position on the fatigue curve, so reordering silently invalidates all of them.
    """
    order = [Block.A_COGNITIVE, Block.B_OCULAR, Block.C_BALANCE, Block.D_MOTOR, Block.E_CLOSE]
    seen = []
    for step in PROTOCOL:
        if not seen or seen[-1] is not step.block:
            seen.append(step.block)
    assert seen == order


def test_the_cognitively_demanding_tasks_run_first():
    """M10 attention and M11 encoding must not land after eleven minutes of fatigue."""
    first_block = [s for s in PROTOCOL if s.block is Block.A_COGNITIVE]
    assert first_block[0].module == "M10"
    assert any(s.module == "M11" and s.task == "word_encoding" for s in first_block[:3])


def test_delayed_recall_is_far_enough_after_encoding_to_mean_anything():
    from app.exam.session_plan import MIN_RECALL_DELAY_SECONDS

    encode = next(s for s in PROTOCOL if s.task == "word_encoding")
    recall = next(s for s in PROTOCOL if s.task == "delayed_recall")
    assert recall.position > encode.position
    gap = sum(s.seconds for s in PROTOCOL if encode.position < s.position < recall.position)
    assert gap >= MIN_RECALL_DELAY_SECONDS, (
        f"only {gap}s between encoding and recall — a delayed recall that is not delayed "
        "measures immediate memory instead")


def test_the_full_session_lands_in_the_specified_window():
    """11-12 minutes of task time. Real sessions run longer with instructions and framing."""
    seconds = planned_seconds(steps_for(Intensity.FULL))
    assert 10 * 60 <= seconds <= 12 * 60, f"{seconds}s is outside the 10-12 minute window"


# ------------------------------------------------------------------ supervised-only
def test_the_fall_risk_tasks_are_never_in_the_daily_protocol():
    """Unterberger is fifty eyes-closed steps; tandem walking is ten heel-to-toe steps —
    performed by someone whose balance we are measuring because it is impaired."""
    daily_tasks = {s.task for s in PROTOCOL}
    assert not (daily_tasks & SUPERVISED_ONLY)


def test_those_tasks_still_exist_and_still_carry_the_laterality():
    """They are excluded from daily, NOT deleted. Every one of M9's lateral features comes
    from them, so losing them would un-lateralise the posterior domain."""
    lateral = MODULES["M9"].lateral_keys
    assert lateral
    assert all(
        any(k.startswith(t) for t in ("unterberger", "tandem_walk")) for k in lateral)
    assert MODULES["M9"].task_devices["unterberger"] == "floor_space"


# ------------------------------------------------------------------ intensity
@pytest.mark.parametrize("intensity", list(Intensity))
def test_every_intensity_produces_a_runnable_session(intensity):
    steps = steps_for(intensity)
    assert steps
    assert planned_seconds(steps) > 0


def test_standard_is_shorter_than_full_and_light_shorter_still():
    full = planned_seconds(steps_for(Intensity.FULL))
    standard = planned_seconds(steps_for(Intensity.STANDARD))
    light = planned_seconds(steps_for(Intensity.LIGHT))
    assert light < standard < full


def test_standard_drops_exactly_what_the_spec_says():
    dropped = {s.task for s in PROTOCOL} - {s.task for s in steps_for(Intensity.STANDARD)}
    assert dropped == {"svv_static_and_dynamic", "vertical_saccades", "rapid_alternating"}


def test_light_keeps_the_core_every_day_and_rotates_the_rest():
    """A frail patient still gets the core daily; physical blocks rotate so they get full
    coverage across a week without a twelve-minute session."""
    seen_blocks = set()
    for day in range(3):
        steps = steps_for(Intensity.LIGHT, day_index=day)
        assert any(s.module == "M10" for s in steps), "core must run every day"
        assert any(s.module == "M13" for s in steps)
        seen_blocks |= {s.block for s in steps}
    assert Block.C_BALANCE in seen_blocks, "balance must be sampled within a week"


def test_a_step_down_is_offered_but_never_a_step_up():
    """Auto-escalating a frail patient back to a longer battery after one good week is how
    you lose them. Stepping up is a human decision."""
    assert should_offer_lighter(4, 0, Intensity.FULL) is Intensity.STANDARD
    assert should_offer_lighter(0, 2, Intensity.STANDARD) is Intensity.LIGHT
    assert should_offer_lighter(0, 0, Intensity.FULL) is None
    # Already at the lightest — nothing further to offer, and never an increase.
    assert should_offer_lighter(9, 9, Intensity.LIGHT) is None


# ------------------------------------------------------------------ fatigue
def test_every_result_can_carry_its_position_and_elapsed_time():
    t = TaskTiming(position=15, elapsed_seconds_at_task_start=430.0,
                   intensity="FULL", paused_before_task=True, pauses_so_far=1)
    j = t.to_json()
    assert j["session_position"] == 15.0
    assert j["elapsed_seconds_at_task_start"] == 430.0
    assert j["paused_before_task"] == 1.0


def test_the_fatigue_slope_detects_decay_across_the_session():
    """Post-stroke fatigue is a real, under-measured symptom — this is a finding in its own
    right, not only nuisance-correction."""
    decaying = within_session_fatigue_slope([(1, 0.0), (8, -0.4), (15, -0.9), (21, -1.3)])
    steady = within_session_fatigue_slope([(1, 0.0), (8, 0.05), (15, -0.05), (21, 0.0)])
    assert decaying < -0.03
    assert abs(steady) < 0.01


def test_the_fatigue_slope_needs_enough_points_to_mean_anything():
    assert within_session_fatigue_slope([(1, 0.0), (5, -1.0)]) == 0.0


def test_the_model_records_what_breaks_the_fixed_position_assumption():
    """The columns exist because an intensity change and a pause both move a task's position
    relative to the baseline that scores it."""
    from app.models import ModuleResult

    for column in ("session_position", "elapsed_seconds_at_task_start",
                   "intensity", "paused_before_task"):
        assert column in ModuleResult.__table__.c, column


# --------------------------------------------------------------- INV-12, stated as it is
#: Daily-protocol tasks that `registry` marks `"caregiver"` in `task_devices`. Listing them
#: is not approval; it is refusing to let the set change unnoticed.
#:
#: The registry author reasoned about exactly this (registry.py, above `romberg_eyes_closed`):
#: eyes closed with a narrowed base is a deliberate destabilisation, so "caregiver-filmed" and
#: "phone-propped" were split apart precisely because collapsing them "put a fall risk on the
#: base tier". The requirement is therefore declared and intentional.
#:
#: What is NOT settled is enforcement. Every tier in `TIER_CAPABILITIES` — including
#: TIER_1_PHONE, one person alone with a phone — declares a `caregiver` capability, and
#: nothing anywhere verifies one is actually present when the protocol is served. INV-12 says
#: fall-risk tasks never appear in an unsupervised schedule; today that holds by declaration
#: rather than by a check.
#:
#: The existing `test_the_fall_risk_tasks_are_never_in_the_daily_protocol` cannot see this.
#: It tests `session_plan.SUPERVISED_ONLY`, which omits `romberg_eyes_closed`,
#: `standing_sway`, `tandem_stance` and `timed_up_and_go` — so it passes while two of them sit
#: in the daily protocol. Neither that list nor `registry.SUPERVISED_TASKS` is read at
#: runtime; both exist only to be asserted against, and they answer different questions.
KNOWN_CAREGIVER_TASKS_IN_DAILY_PROTOCOL: frozenset[str] = frozenset({
    "romberg_eyes_closed",
    "tandem_stance",
})


def test_no_caregiver_requiring_task_joins_the_daily_protocol_unnoticed():
    """Pin the set against the registry's own per-task requirement, not a hand-kept list.

    Deliberately an equality. A task arriving needs a clinical decision rather than a list
    update, and a task leaving is also something someone should notice — M9's lateral features
    come from these, so dropping one silently un-lateralises the posterior domain.
    """
    from app.exam.registry import MODULES

    requires_caregiver = {
        task
        for module in MODULES.values()
        for task, capability in getattr(module, "task_devices", {}).items()
        if capability == "caregiver"
    }
    present = {step.task for step in PROTOCOL} & requires_caregiver

    assert present == KNOWN_CAREGIVER_TASKS_IN_DAILY_PROTOCOL, (
        "the caregiver-requiring tasks in the daily protocol changed.\n"
        f"  now present:  {sorted(present)}\n"
        f"  recorded:     {sorted(KNOWN_CAREGIVER_TASKS_IN_DAILY_PROTOCOL)}\n"
        "INV-12 says fall-risk tasks never appear in an unsupervised schedule."
    )
