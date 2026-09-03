"""Personal baseline construction — TRD §5.

Clinical rationale
------------------
A post-stroke patient's "normal" is not the population's normal. A patient with a chronic
left facial weakness has an asymmetry index that would be pathological in a healthy adult
and is simply *their baseline*. Every threshold in this system is therefore derived from
the patient's own repeated measurements.

Three design choices matter and are deliberate:

1. **Median and MAD, not mean and SD.** A single bad capture — poor light, a cough during
   the sustained /a/ — shifts a mean and inflates an SD, permanently widening the band and
   blinding the system. The median is unmoved by up to 50% contamination.

2. **Discard the first sessions.** Every task in this battery has a practice effect. Trail
   Making, digit span and finger tapping all improve over the first few administrations
   purely from learning. Baselining on them bakes in a falsely poor normal, against which
   genuine later decline looks like a return to baseline.

3. **Trajectory, not a flat line.** A patient three months post-stroke is still recovering.
   The expected signal is slow improvement. Measuring against a flat median would flag
   recovery as change; measuring against a fitted trajectory does not.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, Sequence

import numpy as np

# --- window rules (TRD §5) ---
BASELINE_WINDOW_MIN_DAYS = 14
BASELINE_WINDOW_MAX_DAYS = 21
MIN_SESSIONS_PER_WEEK = 3
DISCARD_FIRST_N_SESSIONS = 3
LOCK_AT_N_SESSIONS = 12
TIME_OF_DAY_TOLERANCE_HOURS = 2.0

# --- cadence-aware lock thresholds (D-043) ---
#
# LOCK_AT_N_SESSIONS is a count of that MODULE's own usable observations, and
# `build_baseline` was always parameterised to accept a different `lock_at` per call — but
# every call site passed the same flat constant, for every module, regardless of how often
# that module is actually measured. That was silently fine for as long as every module ran
# daily (the case until Part 2 of docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md), because "12
# observations" and "12 days" were the same thing. They stop being the same thing the
# moment a Comprehensive-only module runs twice weekly instead of daily: 12 observations at
# 2/week is six calendar weeks, not the ~21-day window the product positions as core
# (Part 3). Verified explicitly, not assumed — see test_mixed_cadence_baseline.py.
#
# The fix is a lower n for slower cadences, chosen so the REAL-WORLD lock time lands near
# the same ~3-week neighbourhood a daily module reaches, rather than leaving it at whatever
# a flat count happens to imply. These are the DEFAULT session-type cadences from
# docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md Part 2 (Daily Pulse = daily, Comprehensive Follow-up =
# twice weekly default) plus the pre-existing WEEKLY/MONTHLY module schedules
# (`exam/registry.py`) for modules that fall outside both layers (e.g. the monthly-only
# battery). DISCARD_FIRST_N_SESSIONS is deliberately left flat at 3 for every cadence here:
# the practice effect it corrects for is a property of REPEATING a task, not of calendar
# time, so there is no clinical basis to shrink it for a slower-cadence module. The one
# honest rough edge this leaves: at MONTHLY cadence, 3 discarded practice sessions is 3
# months before any signal accumulates at all. That module set (M12/M15/M16) is already the
# lowest-priority tier — several are `gates_alerts=False` — so it is recorded here rather
# than solved: a MONTHLY-cadence baseline is known to be slow to establish, on purpose,
# because forcing a faster lock there would mean trusting fewer real repetitions of a task
# with a genuine learning curve.
_CADENCE_LOCK_THRESHOLDS: dict[str, int] = {
    "daily": LOCK_AT_N_SESSIONS,   # 12 usable + 3 discarded ≈ 15-18 calendar days
    "twice_weekly": 4,             # 4 usable + 2 discarded = 6 sessions = exactly 3 weeks
    "weekly": 3,                   # 3 usable + 2 discarded ≈ 5 weeks
    "monthly": 3,                  # 3 usable + 1 discarded ≈ 4 months — see note above
}

#: How many leading PRACTICE sessions to discard, per cadence.
#:
#: Flat 3 was the original rule and stays right for daily modules. It is wrong for slower
#: cadences for a reason that only became visible once the arithmetic was checked against
#: the 21-day baseline window the product actually promises (Part 3): at twice weekly,
#: 3 discarded + 6 retained = 9 sessions = 4.5 weeks, so the patient-level baseline could
#: never lock inside 21 days — and `_refresh_baseline_state` gates the WHOLE patient on
#: the slowest module. The demo seed caught this live: 21 days produced 6 Comprehensive
#: sessions and the baseline stayed `collecting`.
#:
#: The practice effect is real and cadence does not remove it, so the discard is reduced
#: rather than dropped. Two is the floor worth keeping: the sharpest learning gain on
#: these tasks is between the 1st and 2nd administration. And 4 retained is not an
#: arbitrary remainder — it is the minimum `fit_trajectory` needs to fit a real recovery
#: slope at all (below 4 it returns flat, which would silently convert a
#: still-recovering patient's rising baseline into a flat line and read that recovery as
#: deviation).
_CADENCE_DISCARD_COUNTS: dict[str, int] = {
    "daily": DISCARD_FIRST_N_SESSIONS,
    "twice_weekly": 2,
    "weekly": 2,
    #: One only: at monthly cadence each discarded session costs a whole month, and three
    #: would mean a third of a year before the module contributes anything.
    "monthly": 1,
}


def lock_threshold_for_schedule(schedule: str) -> int:
    """How many of a module's OWN usable observations it needs before its baseline locks.

    Raises on an unrecognised schedule rather than defaulting to the daily threshold — a
    typo'd schedule name silently falling back to `daily` would UNDER-count how long a
    slower-cadence module actually needs, which is exactly the silent-corruption failure
    mode this function exists to rule out.
    """
    try:
        return _CADENCE_LOCK_THRESHOLDS[schedule]
    except KeyError:
        raise ValueError(
            f"unknown cadence schedule {schedule!r}; expected one of "
            f"{sorted(_CADENCE_LOCK_THRESHOLDS)}"
        ) from None


def discard_count_for_schedule(schedule: str) -> int:
    """How many leading practice sessions to discard, for a module at this cadence."""
    try:
        return _CADENCE_DISCARD_COUNTS[schedule]
    except KeyError:
        raise ValueError(
            f"unknown cadence schedule {schedule!r}; expected one of "
            f"{sorted(_CADENCE_DISCARD_COUNTS)}"
        ) from None

# --- statistics ---
MIN_MAD = 1e-6           # floor so a perfectly flat feature cannot divide by zero
MAD_TO_SD = 1.4826       # makes MAD a consistent estimator of SD under normality
ENROLMENT_MIN_DAYS_POST_STROKE = 90  # PRD §3: >= 3 months post-discharge


class EnrolmentError(ValueError):
    """Raised when a patient does not meet the locked inclusion criteria."""


def as_utc(ts: datetime) -> datetime:
    """Coerce a timestamp to UTC-aware.

    SQLite has no timezone type, so datetimes read back from a test database are naive
    while the ones we construct are aware. Comparing the two raises. Every timestamp
    entering the engine passes through here so that the engine never has to care which
    database it came from.
    """
    return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)


@dataclass(slots=True)
class SessionObservation:
    """One module's features from one session, with the metadata the baseline needs."""

    ts: datetime
    features: dict[str, float]
    quality_ok: bool = True
    identity_ok: bool = True
    off_window: bool = False

    def __post_init__(self) -> None:
        self.ts = as_utc(self.ts)

    @property
    def usable(self) -> bool:
        """Only clean, verified, on-window captures may shape a baseline (TRD §5)."""
        return self.quality_ok and self.identity_ok and not self.off_window


@dataclass(slots=True)
class Baseline:
    """A locked (or still-forming) per-module baseline."""

    module_code: str
    median: dict[str, float] = field(default_factory=dict)
    mad: dict[str, float] = field(default_factory=dict)
    trajectory: dict[str, tuple[float, float]] = field(default_factory=dict)
    n_sessions: int = 0
    n_rejected: int = 0
    n_discarded: int = 0
    window_start: datetime | None = None
    window_end: datetime | None = None
    locked: bool = False
    reason: str = "not enough sessions"

    @property
    def ready(self) -> bool:
        return self.locked

    def sd(self, key: str) -> float:
        """Robust SD estimate for this feature, used by the RCI."""
        return max(self.mad.get(key, 0.0) * MAD_TO_SD, MIN_MAD)

    def to_json(self) -> dict:
        return {
            "module_code": self.module_code,
            "median": self.median,
            "mad": self.mad,
            "trajectory": {k: list(v) for k, v in self.trajectory.items()},
            "n_sessions": self.n_sessions,
            "n_rejected": self.n_rejected,
            "n_discarded": self.n_discarded,
            "locked": self.locked,
            "reason": self.reason,
        }


# --------------------------------------------------------------------------- enrolment
def check_enrolment(
    stroke_date: datetime | None,
    now: datetime,
    *,
    pd_diagnosis: bool = False,
    other_movement_disorder: bool = False,
) -> None:
    """PRD §3 inclusion and exclusion criteria, enforced in one place.

    Two independent reasons to refuse:

    **Too recent.** Our logic detects change over days; an acute stroke evolves in seconds.
    Enrolling an acute patient would be clinically useless and actively dangerous, because
    the product would appear to be watching for something it structurally cannot see.

    **A comorbid movement disorder.** Parkinson's disease degrades face, movement and voice
    symmetrically and simultaneously — the exact combination the alert gate reads as
    deterioration. The engine's laterality requirement (Gate 3) stops that producing a false
    stroke alert, but this system has been validated only for post-stroke monitoring without
    such comorbidities. Refusing enrolment is the honest position; silently monitoring
    someone whose baseline is itself progressively moving is not.
    """
    if pd_diagnosis or other_movement_disorder:
        raise EnrolmentError(
            "NeuroTrace is validated only for post-stroke monitoring in patients without a "
            "comorbid movement disorder. Parkinson's disease and related conditions change "
            "face, movement and voice together, which this system cannot separate from the "
            "changes it is designed to detect. Please continue under your neurologist's "
            "direct care instead."
        )
    if stroke_date is None:
        raise EnrolmentError("stroke date is required to confirm >= 3 months post-stroke")
    days = (as_utc(now) - as_utc(stroke_date)).days
    if days < ENROLMENT_MIN_DAYS_POST_STROKE:
        raise EnrolmentError(
            f"patient is {days} days post-stroke; enrolment requires "
            f">= {ENROLMENT_MIN_DAYS_POST_STROKE} days (PRD §3)"
        )


def is_off_window(ts: datetime, preferred_hour: float | None,
                  tolerance_hours: float = TIME_OF_DAY_TOLERANCE_HOURS) -> bool:
    """Diurnal variation is real: fatigue, medication timing and alertness all swing
    across a day. A session taken far from the patient's usual slot is tagged so it can
    be kept out of the baseline and annotated as a confounder rather than silently mixed in.
    """
    if preferred_hour is None:
        return False
    hour = ts.hour + ts.minute / 60.0
    delta = abs(hour - preferred_hour)
    delta = min(delta, 24.0 - delta)  # wrap around midnight
    return delta > tolerance_hours


# --------------------------------------------------------------------------- statistics
def median_of(values: Sequence[float]) -> float:
    return float(np.median(values)) if len(values) else 0.0


def mad_of(values: Sequence[float], centre: float | None = None) -> float:
    """Median absolute deviation, floored.

    The floor matters: a feature that is genuinely constant across the baseline (a
    perfectly regular tapper, a naming score of 10/10 every time) has MAD 0, and any
    later change would divide by zero. Flooring converts that into "any movement is a
    large movement", which is the clinically correct reading of a previously stable
    finding starting to move.
    """
    if not len(values):
        return MIN_MAD
    arr = np.asarray(values, dtype=float)
    centre = float(np.median(arr)) if centre is None else centre
    mad = float(np.median(np.abs(arr - centre)))
    # Also floor relative to scale, so a large-magnitude feature is not hypersensitive.
    return max(mad, MIN_MAD, abs(centre) * 0.01)


def fit_trajectory(days: Sequence[float], values: Sequence[float]) -> tuple[float, float]:
    """Least-squares slope/intercept of a feature across the baseline window.

    Returns (slope_per_day, intercept). With fewer than 4 points the slope is not
    trustworthy and is reported as 0 — a flat baseline, which is the conservative choice.
    """
    if len(values) < 4:
        return 0.0, median_of(values)
    slope, intercept = np.polyfit(np.asarray(days, dtype=float),
                                  np.asarray(values, dtype=float), 1)
    return float(slope), float(intercept)


# --------------------------------------------------------------------------- build
def build_baseline(
    module_code: str,
    observations: Iterable[SessionObservation],
    keys: Sequence[str],
    *,
    discard_first: int = DISCARD_FIRST_N_SESSIONS,
    lock_at: int = LOCK_AT_N_SESSIONS,
) -> Baseline:
    """Construct a per-module baseline from that module's session history.

    Order of operations is deliberate: reject unusable captures FIRST, then discard the
    practice sessions from what remains. Discarding first would let three rejected
    captures consume the practice allowance and leave learning effects in the baseline.
    """
    ordered = sorted(observations, key=lambda o: o.ts)
    baseline = Baseline(module_code=module_code)

    usable = [o for o in ordered if o.usable]
    baseline.n_rejected = len(ordered) - len(usable)

    retained = usable[discard_first:]
    baseline.n_discarded = min(discard_first, len(usable))
    baseline.n_sessions = len(retained)

    if not retained:
        baseline.reason = (
            f"0 usable sessions after rejecting {baseline.n_rejected} and discarding "
            f"{baseline.n_discarded} practice sessions"
        )
        return baseline

    baseline.window_start = retained[0].ts
    baseline.window_end = retained[-1].ts

    day0 = retained[0].ts
    days = [(o.ts - day0).total_seconds() / 86400.0 for o in retained]

    for key in keys:
        values = [float(o.features.get(key, 0.0)) for o in retained]
        values = [v for v in values if np.isfinite(v)]
        if not values:
            baseline.median[key] = 0.0
            baseline.mad[key] = MIN_MAD
            baseline.trajectory[key] = (0.0, 0.0)
            continue
        centre = median_of(values)
        baseline.median[key] = centre
        baseline.mad[key] = mad_of(values, centre)
        baseline.trajectory[key] = fit_trajectory(days[: len(values)], values)

    baseline.locked = len(retained) >= lock_at
    if baseline.locked:
        baseline.reason = f"locked on {len(retained)} valid sessions"
    else:
        baseline.reason = f"{len(retained)}/{lock_at} valid sessions collected"
    return baseline


def window_progress(observations: Iterable[SessionObservation],
                    *, lock_at: int = LOCK_AT_N_SESSIONS) -> dict:
    """Progress summary for the caregiver's "still learning" card."""
    ordered = sorted(observations, key=lambda o: o.ts)
    usable = [o for o in ordered if o.usable]
    retained = usable[DISCARD_FIRST_N_SESSIONS:]
    if not ordered:
        return {"sessions": 0, "required": lock_at, "days_elapsed": 0,
                "cadence_ok": False, "locked": False}
    days_elapsed = (ordered[-1].ts - ordered[0].ts).days + 1
    weeks = max(1.0, days_elapsed / 7.0)
    return {
        "sessions": len(retained),
        "required": lock_at,
        "days_elapsed": days_elapsed,
        "window_min_days": BASELINE_WINDOW_MIN_DAYS,
        "window_max_days": BASELINE_WINDOW_MAX_DAYS,
        "cadence_ok": (len(usable) / weeks) >= MIN_SESSIONS_PER_WEEK,
        "locked": len(retained) >= lock_at,
    }


def expected_value(baseline: Baseline, key: str, days_since_window_start: float) -> float:
    """What this feature *should* read today given the fitted recovery trajectory.

    Falls back to the flat median when no usable slope was fitted.
    """
    slope, intercept = baseline.trajectory.get(key, (0.0, baseline.median.get(key, 0.0)))
    if slope == 0.0:
        return baseline.median.get(key, 0.0)
    return intercept + slope * days_since_window_start
