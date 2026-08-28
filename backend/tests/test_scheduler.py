"""Part 2.3 — which session type is due today.

Comprehensive already contains everything Daily Pulse runs (D-044), so the scheduler's
answer is binary per day: Comprehensive, or Daily Pulse. Never both, never neither.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.exam.scheduler import next_comprehensive_due, session_type_due_today
from app.models import SessionType

ENROLLED = datetime(2026, 1, 1, tzinfo=timezone.utc)  # a Thursday


def _due(days_after: int, cadence: int = 2) -> SessionType:
    return session_type_due_today(ENROLLED, cadence, ENROLLED + timedelta(days=days_after))


def test_twice_weekly_produces_roughly_two_comprehensive_days_in_seven():
    due = [_due(d) for d in range(7)]
    assert due.count(SessionType.comprehensive) == 2


def test_comprehensive_days_are_not_adjacent_at_twice_weekly():
    """Spread out, not bunched — a caregiver doing the fuller session two days running
    while the rest of the week goes untouched would defeat the point of "twice weekly."""
    due = [_due(d) for d in range(7)]
    comp_days = [i for i, t in enumerate(due) if t is SessionType.comprehensive]
    gaps = [comp_days[i + 1] - comp_days[i] for i in range(len(comp_days) - 1)]
    assert all(g >= 2 for g in gaps)


def test_the_pattern_repeats_identically_every_week():
    week1 = [_due(d) for d in range(7)]
    week2 = [_due(d + 7) for d in range(7)]
    assert week1 == week2


@pytest.mark.parametrize("cadence,expected_count", [(1, 1), (2, 2), (3, 3), (4, 4), (7, 7)])
def test_cadence_count_matches_the_configured_days_per_week(cadence, expected_count):
    due = [_due(d, cadence) for d in range(7)]
    assert due.count(SessionType.comprehensive) == expected_count


def test_zero_or_negative_cadence_means_comprehensive_is_off():
    for cadence in (0, -1):
        due = [_due(d, cadence) for d in range(7)]
        assert all(t is SessionType.daily_pulse for t in due)


def test_every_day_is_daily_pulse_or_comprehensive_never_anything_else():
    """The scheduler's whole contract: MONTHLY and ASHA_VISIT are scheduled by other
    paths and must never come back from this function."""
    for d in range(30):
        assert _due(d) in (SessionType.daily_pulse, SessionType.comprehensive)


def test_days_before_enrolment_clamp_to_daily_pulse_not_comprehensive():
    """A pre-enrolment date means the CALLER has a date bug, not that a deep session is
    due. Clamping to day 0 (a Comprehensive day) silently returned COMPREHENSIVE for every
    such date — which is how the demo seed produced 21 Comprehensive days while looking
    correct, because the alert story still came out right. Daily Pulse is the safe clamp:
    lower burden, and obviously wrong if it ever shows up where it should not."""
    for delta in (timedelta(hours=3), timedelta(days=1), timedelta(days=30)):
        assert session_type_due_today(ENROLLED, 2, ENROLLED - delta) is SessionType.daily_pulse


def test_next_comprehensive_due_finds_a_real_future_comprehensive_day():
    daily_day = next(d for d in range(7) if _due(d) is SessionType.daily_pulse)
    after = ENROLLED + timedelta(days=daily_day)
    nxt = next_comprehensive_due(ENROLLED, 2, after)
    assert session_type_due_today(ENROLLED, 2, nxt) is SessionType.comprehensive
    assert nxt >= after


def test_next_comprehensive_due_does_not_hang_when_comprehensive_is_off():
    # Must return without looping forever when comprehensive_days_per_week <= 0.
    result = next_comprehensive_due(ENROLLED, 0, ENROLLED)
    assert result == ENROLLED
