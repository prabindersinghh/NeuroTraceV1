"""The doctor-in-the-loop baseline gate — Part 3.3, 3.4, 3.6.

The clinician sets the clinical reference; NeuroTrace maintains the longitudinal
observation. That division is the point: the system is visibly not autonomous, and the
frozen reference every later comparison is measured against has a named human author.

WHAT THIS MODULE OWNS
  - the completion criteria that move a patient to DOCTOR_REVIEW_PENDING
  - the three doctor actions (CONFIRM / EXTEND / FLAG_CONCERN) and their audit trail
  - THE ONLY WRITE OF THE FROZEN REFERENCE (INV-4), on CONFIRM
  - invalidation when a new clinical event lands mid-baseline (3.6)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..engine.baseline import BASELINE_WINDOW_MIN_DAYS, as_utc
from ..exam.registry import MODULES
from ..models import (
    AuditLog,
    Baseline as BaselineRow,
    BaselineReview,
    BaselineReviewAction,
    BaselineState,
    ExamSession,
    Patient,
)

#: The nominal baseline window the product promises (Part 3).
BASELINE_TARGET_DAYS = 21

#: One automatic extension, to here. D-047.
BASELINE_EXTENDED_DAYS = 35

#: Below this, a window is not representative enough to lock on however many sessions it
#: contains — a patient who did twelve sessions in four days has not shown us a normal.
BASELINE_MIN_ADHERENCE = 0.5


class BaselineGateError(ValueError):
    """A doctor action that the current phase does not permit."""


# --------------------------------------------------------------------- completion
async def completion_status(db: AsyncSession, patient: Patient) -> dict:
    """Is this baseline ready for a clinician to look at, and if not, what is missing?

    Returns the reasons either way. A doctor asked to approve something needs to see why
    the system thinks it is ready, and a caregiver asking "why is this taking so long"
    deserves a specific answer rather than a spinner.
    """
    rows = list(await db.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
    ))
    sessions = list(await db.scalars(
        select(ExamSession)
        .where(ExamSession.patient_id == patient.id,
               ExamSession.is_practice.is_(False),
               ExamSession.completed.is_(True))
        .order_by(ExamSession.ts.asc())
    ))

    # `as_utc` because SQLite returns naive datetimes while the ones we construct are
    # aware, and subtracting the two raises. Every timestamp entering the engine passes
    # through the same helper for the same reason.
    first_ts = as_utc(sessions[0].ts) if sessions else None
    last_ts = as_utc(sessions[-1].ts) if sessions else None
    days_elapsed = ((last_ts - first_ts).days + 1) if first_ts and last_ts else 0

    unlocked = sorted(r.module_code for r in rows if not r.locked)
    # Cadence-aware by construction: each row locked at its own threshold (D-043), so a
    # twice-weekly module is not held to a daily module's session count.
    all_modules_locked = bool(rows) and not unlocked

    expected_days = max(days_elapsed, 1)
    adherence = min(1.0, len(sessions) / expected_days) if expected_days else 0.0

    blockers: list[str] = []
    if not rows:
        blockers.append("no sessions recorded yet")
    if unlocked:
        blockers.append(f"{len(unlocked)} module(s) still collecting: {', '.join(unlocked)}")
    if days_elapsed < BASELINE_WINDOW_MIN_DAYS:
        blockers.append(
            f"window is {days_elapsed} days; at least {BASELINE_WINDOW_MIN_DAYS} needed"
        )
    if adherence < BASELINE_MIN_ADHERENCE:
        blockers.append(f"adherence {adherence:.0%} is below {BASELINE_MIN_ADHERENCE:.0%}")

    return {
        "ready_for_review": not blockers,
        "blockers": blockers,
        "all_modules_locked": all_modules_locked,
        "days_elapsed": days_elapsed,
        "sessions": len(sessions),
        "adherence": round(adherence, 3),
        "first_session": first_ts.isoformat() if first_ts else None,
        "last_session": last_ts.isoformat() if last_ts else None,
    }


# ------------------------------------------------------------------ the review view
async def build_review(db: AsyncSession, patient: Patient) -> dict:
    """Everything the clinician sees before deciding — Part 3.4.

    Per module: the captured values, the variability, how often capture succeeded, what
    was rejected and why, and a plain sentence describing this patient's normal.

    THE CADENCE ASYMMETRY IS SHOWN, NOT HIDDEN. Daily Pulse modules will carry ~21
    observations and Comprehensive-only modules ~6 (D-043/D-044). A doctor who is not told
    that will read six points as thin data rather than as correct-for-its-cadence, and
    will extend a baseline that was already complete.
    """
    rows = list(await db.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
        .order_by(BaselineRow.module_code)
    ))
    status = await completion_status(db, patient)

    modules = []
    for row in rows:
        module = MODULES.get(row.module_code)
        schedule = module.schedule if module else "unknown"
        total = row.n_sessions + row.n_rejected + row.n_discarded
        modules.append({
            "module_code": row.module_code,
            "name": module.name if module else row.module_code,
            "domain": module.domain if module else None,
            "schedule": schedule,
            #: Why this module has the count it has, in the doctor's terms.
            "cadence_note": (
                "measured every day" if schedule == "daily"
                else "measured with the twice-weekly comprehensive session"
                if schedule == "weekly" else f"measured on the {schedule} schedule"
            ),
            "n_sessions": row.n_sessions,
            "n_rejected": row.n_rejected,
            "n_discarded_as_practice": row.n_discarded,
            "capture_quality_rate": (
                round(row.n_sessions / total, 3) if total else None
            ),
            "locked": row.locked,
            "reason": row.reason,
            "window_start": row.window_start.isoformat() if row.window_start else None,
            "window_end": row.window_end.isoformat() if row.window_end else None,
            "median": dict(row.median_json or {}),
            "variability_mad": dict(row.mad_json or {}),
            "trajectory": dict(row.trajectory_json or {}),
        })

    previous = list(await db.scalars(
        select(BaselineReview).where(BaselineReview.patient_id == patient.id)
        .order_by(BaselineReview.reviewed_at.asc())
    ))

    return {
        "patient_id": str(patient.id),
        "baseline_state": patient.baseline_state.value,
        "completion": status,
        "modules": modules,
        "summary": _plain_summary(modules, status),
        "previous_reviews": [
            {
                "action": r.action.value,
                "note": r.note,
                "reviewed_at": r.reviewed_at.isoformat(),
                "clinician_id": str(r.clinician_id) if r.clinician_id else None,
                "sessions_in_window": r.sessions_in_window,
            }
            for r in previous
        ],
        #: Stated on every render. The models behind these numbers are synthetic
        #: (ML_STATUS.md), and a clinician signing a baseline should know that.
        "disclosure": (
            "These are this patient's own measured values. No population norm is applied. "
            "Model-derived advisory features are trained on synthetic fixtures — see "
            "docs/ML_STATUS.md."
        ),
    }


def _plain_summary(modules: list[dict], status: dict) -> str:
    if not modules:
        return "No measurements have been captured yet."
    locked = sum(1 for m in modules if m["locked"])
    return (
        f"{status['sessions']} sessions over {status['days_elapsed']} days, "
        f"{status['adherence']:.0%} adherence. {locked} of {len(modules)} modules have "
        f"enough repeats to describe this patient's normal. Values below are this "
        f"patient's own; nothing is compared to a population."
    )


# ------------------------------------------------------------------ doctor actions
async def record_review(
    db: AsyncSession,
    patient: Patient,
    clinician_id: uuid.UUID,
    action: BaselineReviewAction,
    note: str | None,
    snapshot: dict | None = None,
) -> BaselineReview:
    """Apply a doctor action, immutably. Part 3.4.

    Every action writes one append-only `baseline_reviews` row AND one `audit_log` row
    (INV-8). Nothing here updates or deletes a prior review — a change of mind is a new
    row, so an EXTEND followed by a CONFIRM stays readable as the sequence it was.
    """
    if patient.baseline_state is not BaselineState.DOCTOR_REVIEW_PENDING:
        raise BaselineGateError(
            f"baseline is {patient.baseline_state.value}, not awaiting review; "
            "only a patient in DOCTOR_REVIEW_PENDING can be reviewed"
        )
    if action in (BaselineReviewAction.EXTEND, BaselineReviewAction.FLAG_CONCERN) \
            and not (note or "").strip():
        raise BaselineGateError(f"{action.value} requires a note explaining why")

    status = await completion_status(db, patient)
    review = BaselineReview(
        patient_id=patient.id,
        clinician_id=clinician_id,
        action=action,
        note=(note or None),
        baseline_snapshot_json=snapshot,
        sessions_in_window=int(status["sessions"]),
    )
    db.add(review)

    if action is BaselineReviewAction.CONFIRM:
        # The ONE place the frozen reference is written (INV-4, D-048).
        await freeze_reference(db, patient)
        patient.baseline_state = BaselineState.LOCKED
    elif action is BaselineReviewAction.EXTEND:
        # Back to collecting. The reference is NOT written — that is the whole reason it
        # moved off module-lock.
        patient.baseline_state = BaselineState.IN_PROGRESS
    # FLAG_CONCERN deliberately changes no state: it records a worry and HOLDS the patient
    # at review. It is not a rejection, and it must not silently restart collection.

    db.add(AuditLog(
        actor_id=clinician_id,
        action=f"baseline.review.{action.value.lower()}",
        patient_id=patient.id,
        meta_json={
            "resulting_state": patient.baseline_state.value,
            "sessions_in_window": int(status["sessions"]),
            "days_elapsed": int(status["days_elapsed"]),
            "note_present": bool((note or "").strip()),
        },
    ))
    await db.flush()
    return review


async def freeze_reference(db: AsyncSession, patient: Patient) -> int:
    """Write the frozen reference. Once, ever, on CONFIRM.

    INV-4: the frozen reference is written once and never updated. An adaptive yardstick
    cannot see a decline it has been following, which is the entire reason a second,
    immutable one exists.

    The `reference_locked_at is None` guard is what makes this idempotent, and it is
    load-bearing across an EXTEND → later-CONFIRM cycle: the second CONFIRM must not
    re-snapshot modules that were already frozen by the first. Returns how many modules
    were newly frozen, so a caller (and a test) can tell the difference between "wrote it"
    and "it was already there".
    """
    rows = list(await db.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
    ))
    now = datetime.now(timezone.utc)
    frozen = 0
    for row in rows:
        if not row.locked or row.reference_locked_at is not None:
            continue
        row.reference_median_json = dict(row.median_json or {})
        row.reference_mad_json = dict(row.mad_json or {})
        row.reference_n_sessions = row.n_sessions
        row.reference_locked_at = now
        frozen += 1
    return frozen


# ------------------------------------------------- 3.6 invalidation / D-047 expiry
async def invalidate_baseline(
    db: AsyncSession,
    patient: Patient,
    actor_id: uuid.UUID | None,
    reason: str,
) -> None:
    """A new clinical event landed mid-baseline — Part 3.6.

    The patient's normal has changed, so everything collected against the old normal is
    no longer a description of it. The baseline is ABANDONED with a recorded reason and a
    fresh one starts; the reason is visible to caregiver and clinician, because a baseline
    silently restarting is indistinguishable from the app being broken.

    Deliberately does NOT clear any frozen reference already written: if a previous
    baseline was confirmed and frozen, that snapshot is a historical fact about a period
    that really happened (INV-4). A new baseline gets new rows.
    """
    if not (reason or "").strip():
        raise BaselineGateError("invalidating a baseline requires a reason")

    patient.baseline_state = BaselineState.ABANDONED
    db.add(AuditLog(
        actor_id=actor_id,
        action="baseline.invalidated",
        patient_id=patient.id,
        meta_json={"reason": reason.strip()[:400]},
    ))
    await db.flush()


def expiry_decision(days_elapsed: int, extensions_used: int) -> str:
    """What to do with a baseline that has not completed in time — D-047.

    One automatic extension to 35 days, then ABANDONED with a reason. Never an automatic
    downgrade to LIGHT intensity: LIGHT changes which tasks run and therefore where each
    module sits on the fatigue curve, which is precisely the confound INV-14 and D-027
    exist to prevent. It would corrupt the very baseline being built. Extending costs
    time; downgrading costs validity.

    And "auto-extend once" must not become "extend forever" — a second failure is a real
    finding about this patient's ability to complete the protocol, and it belongs in front
    of a human rather than in another silent retry.
    """
    if days_elapsed < BASELINE_TARGET_DAYS:
        return "continue"
    if extensions_used == 0:
        return "extend"
    if days_elapsed < BASELINE_EXTENDED_DAYS:
        return "continue"
    return "abandon"
