"""Which session type is due today — Part 2.3.

Comprehensive Follow-up ALREADY contains everything Daily Pulse runs (D-044's derivation
guarantees it: `COMPREHENSIVE_STEPS` is `DAILY_PULSE_STEPS` plus more). So the scheduler's
job on any given day is binary, not additive: is today a Comprehensive day, or a Daily
Pulse day? There is never a day where a patient needs to do both.

WHY A DETERMINISTIC ROTATION FROM ENROLMENT DATE, NOT CAREGIVER-PICKED WEEKDAYS
---------------------------------------------------------------------------------
The task says Comprehensive's default cadence is "twice weekly, configurable per patient."
The obvious UI is a weekday picker (Tuesday and Friday). That is one more setting a
caregiver has to get right, one more thing that can silently drift out of sync with
`comprehensive_days_per_week` if they change the count but not the days, and one more
field this session does not have time to build a considered UI for.

Spacing due days evenly across a 7-day window starting from `enrolment_date` gets the same
outcome — roughly N Comprehensive sessions a week, spread out rather than clustered — with
no extra state to store or get inconsistent. It is deterministic and reproducible: the same
patient, the same day, always computes the same answer, which matters for a scheduler a
caregiver's dashboard and the patient's own app both need to agree on independently.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from ..models import SessionType

DAYS_PER_WEEK = 7


def as_utc(ts: datetime) -> datetime:
    return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)


def session_type_due_today(
    enrolment_date: datetime, comprehensive_days_per_week: int, now: datetime,
) -> SessionType:
    """DAILY_PULSE or COMPREHENSIVE — never MONTHLY or ASHA_VISIT, which are scheduled by
    their own separate paths (a monthly reminder; an ASHA worker's visit calendar) and are
    never what this function's caller — the daily "what should today's check-in be"
    entry point — is asking about.

    `comprehensive_days_per_week <= 0` means Comprehensive is off for this patient (every
    day is Daily Pulse) — a legitimate configuration for someone whose caregiver has
    decided the deeper battery is not worth the burden right now, not an error.
    """
    if comprehensive_days_per_week <= 0:
        return SessionType.daily_pulse
    if comprehensive_days_per_week >= DAYS_PER_WEEK:
        return SessionType.comprehensive

    day0 = as_utc(enrolment_date)
    today = as_utc(now)
    days_since_enrolment = (today.date() - day0.date()).days
    if days_since_enrolment < 0:
        # Before enrolment. Clamping to 0 here is deliberate but was previously a trap:
        # day 0 is always a Comprehensive day, so ANY pre-enrolment date silently returned
        # COMPREHENSIVE — and a caller passing the wrong reference date (the demo seed did
        # exactly this, anchoring on `enrolment_date` while backdating its sessions) got a
        # uniform Comprehensive schedule that looked plausible and was completely wrong.
        # Daily Pulse is the safer clamp: it is the lower-burden session, and a caller in
        # this state has a date bug rather than a real scheduling question.
        return SessionType.daily_pulse

    # Evenly spaced slots within each 7-day window: comprehensive_days_per_week=2 lands on
    # days {0, 3} of every 7 (via floor(day_in_week * N / 7) changing value) — every ~3-4
    # days, never bunched at the start of the week.
    day_in_week = days_since_enrolment % DAYS_PER_WEEK
    slot_today = (day_in_week * comprehensive_days_per_week) // DAYS_PER_WEEK
    slot_yesterday = (
        ((day_in_week - 1) % DAYS_PER_WEEK) * comprehensive_days_per_week
    ) // DAYS_PER_WEEK
    is_due = slot_today != slot_yesterday or day_in_week == 0
    return SessionType.comprehensive if is_due else SessionType.daily_pulse


def next_comprehensive_due(
    enrolment_date: datetime, comprehensive_days_per_week: int, after: datetime,
) -> datetime:
    """The next calendar date Comprehensive is due, for "your fuller check-in is on
    Friday" style copy. Scans forward day by day rather than solving the slot arithmetic
    in closed form — this runs once per dashboard render for one patient, not in a hot
    loop, and a readable scan is worth more here than a clever formula."""
    day = as_utc(after)
    for _ in range(DAYS_PER_WEEK + 1):
        if session_type_due_today(enrolment_date, comprehensive_days_per_week, day) \
                is SessionType.comprehensive:
            return day
        day += timedelta(days=1)
    # comprehensive_days_per_week <= 0: never due. Caller should check that case first;
    # this is a safe fallback rather than an infinite-loop risk.
    return after
