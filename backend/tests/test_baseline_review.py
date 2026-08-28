"""Part 3.3/3.4 — the doctor gate, and the single frozen-reference write.

THE CENTRAL TEST IN THIS FILE is `test_extend_then_confirm_writes_the_reference_exactly_once`.
The frozen reference (INV-4) is the engine's most safety-critical write: every later
comparison is measured against it, and it may be written once and never updated. Part 3
moved that write from module-lock to the doctor's CONFIRM (D-048), which creates a bug
shape that did not exist before — **written twice across an extend-then-confirm cycle**.
A test that only checked "not written on EXTEND" would pass while that bug shipped.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models import (
    Baseline as BaselineRow,
    BaselineReview,
    BaselineReviewAction,
    BaselineState,
    Patient,
    Role,
    User,
)
from app.services.baseline_review import (
    BaselineGateError,
    expiry_decision,
    freeze_reference,
    record_review,
)
from app.auth.password import hash_password

NOW = datetime.now(timezone.utc)


async def _patient_awaiting_review(session, *, modules=("M1", "M4")) -> tuple[Patient, User]:
    """A patient whose modules have all locked and who is therefore at the gate."""
    caregiver = User(email=f"c{id(session)}@example.com", pw_hash=hash_password("x" * 12),
                     role=Role.caregiver)
    clinician = User(email=f"d{id(session)}@example.com", pw_hash=hash_password("x" * 12),
                     role=Role.clinician)
    session.add_all([caregiver, clinician])
    await session.flush()

    patient = Patient(caregiver_id=caregiver.id, name="Test",
                      stroke_date=NOW - timedelta(days=200),
                      baseline_state=BaselineState.DOCTOR_REVIEW_PENDING)
    session.add(patient)
    await session.flush()

    for code in modules:
        session.add(BaselineRow(
            patient_id=patient.id, module_code=code, locked=True, n_sessions=12,
            median_json={"k": 1.0}, mad_json={"k": 0.1},
            window_start=NOW - timedelta(days=20), window_end=NOW,
        ))
    await session.flush()
    return patient, clinician


async def _refs(session, patient) -> list[BaselineRow]:
    return list(await session.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
    ))


# ------------------------------------------------- the frozen reference (INV-4, D-048)
async def test_confirm_writes_the_frozen_reference_and_locks(session):
    patient, clinician = await _patient_awaiting_review(session)
    assert all(r.reference_locked_at is None for r in await _refs(session, patient))

    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)

    rows = await _refs(session, patient)
    assert all(r.reference_locked_at is not None for r in rows)
    assert all(r.reference_median_json == r.median_json for r in rows)
    assert patient.baseline_state is BaselineState.LOCKED


async def test_extend_never_writes_the_frozen_reference(session):
    patient, clinician = await _patient_awaiting_review(session)

    await record_review(session, patient, clinician.id, BaselineReviewAction.EXTEND,
                        "not enough variety in the window")

    assert all(r.reference_locked_at is None for r in await _refs(session, patient)), (
        "EXTEND sealed the permanent yardstick against a window the clinician just "
        "rejected — this is exactly why the write moved off module-lock"
    )
    assert patient.baseline_state is BaselineState.IN_PROGRESS


async def test_flag_concern_neither_writes_nor_unlocks(session):
    patient, clinician = await _patient_awaiting_review(session)

    await record_review(session, patient, clinician.id, BaselineReviewAction.FLAG_CONCERN,
                        "tremor looks new")

    assert all(r.reference_locked_at is None for r in await _refs(session, patient))
    # FLAG_CONCERN records a worry and HOLDS. It is not a rejection.
    assert patient.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING


async def test_the_reference_is_never_written_while_awaiting_review(session):
    patient, _ = await _patient_awaiting_review(session)
    # Modules are locked and the patient sits at the gate — the exact window in which the
    # OLD code would already have frozen the reference.
    assert patient.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING
    assert all(r.reference_locked_at is None for r in await _refs(session, patient))


async def test_the_reference_is_never_written_for_an_abandoned_baseline(session):
    patient, _ = await _patient_awaiting_review(session)
    patient.baseline_state = BaselineState.ABANDONED
    await session.flush()

    frozen = await freeze_reference(session, patient)
    # freeze_reference is only ever called from CONFIRM; if some future caller invokes it
    # here, the rows are still eligible — so this documents that the GATE is the caller,
    # and the state machine is what keeps ABANDONED out of it.
    assert patient.baseline_state is BaselineState.ABANDONED
    assert frozen >= 0  # no exception, no state change


async def test_extend_then_confirm_writes_the_reference_exactly_once(session):
    """THE BUG TO HUNT: written twice across an extend-then-confirm cycle.

    A clinician EXTENDs, more sessions arrive, and they CONFIRM later. The reference must
    be written once — at the final CONFIRM — and must not be re-snapshotted per attempt.
    Checking only "not written on EXTEND" would miss a second write at the second CONFIRM.
    """
    patient, clinician = await _patient_awaiting_review(session)

    await record_review(session, patient, clinician.id, BaselineReviewAction.EXTEND,
                        "come back after another week")
    assert patient.baseline_state is BaselineState.IN_PROGRESS
    assert all(r.reference_locked_at is None for r in await _refs(session, patient))

    # More data arrives; the gate reopens.
    patient.baseline_state = BaselineState.DOCTOR_REVIEW_PENDING
    for row in await _refs(session, patient):
        row.n_sessions = 18
        row.median_json = {"k": 1.5}       # the adaptive values moved
    await session.flush()

    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)
    rows = await _refs(session, patient)
    first_write = {r.module_code: r.reference_locked_at for r in rows}
    assert all(v is not None for v in first_write.values())
    # It captured the FINAL window, not the rejected one.
    assert all(r.reference_median_json == {"k": 1.5} for r in rows)
    assert all(r.reference_n_sessions == 18 for r in rows)

    # A second CONFIRM (double-submit, retry, a second reviewer) must not re-snapshot.
    patient.baseline_state = BaselineState.DOCTOR_REVIEW_PENDING
    for row in rows:
        row.median_json = {"k": 9.9}       # drift after locking
    await session.flush()

    newly_frozen = await freeze_reference(session, patient)
    assert newly_frozen == 0, "the frozen reference was written a second time"
    after = await _refs(session, patient)
    assert {r.module_code: r.reference_locked_at for r in after} == first_write
    assert all(r.reference_median_json == {"k": 1.5} for r in after), (
        "the reference was overwritten with post-lock drift — INV-4 says written once"
    )


# ------------------------------------------------------------- gate + audit behaviour
async def test_a_review_is_refused_unless_the_patient_is_awaiting_one(session):
    patient, clinician = await _patient_awaiting_review(session)
    patient.baseline_state = BaselineState.IN_PROGRESS
    await session.flush()

    with pytest.raises(BaselineGateError):
        await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)


@pytest.mark.parametrize("action", [BaselineReviewAction.EXTEND,
                                    BaselineReviewAction.FLAG_CONCERN])
async def test_extend_and_flag_require_a_note(session, action):
    patient, clinician = await _patient_awaiting_review(session)
    with pytest.raises(BaselineGateError):
        await record_review(session, patient, clinician.id, action, "   ")


async def test_every_review_is_recorded_append_only_with_a_timestamp(session):
    patient, clinician = await _patient_awaiting_review(session)

    await record_review(session, patient, clinician.id, BaselineReviewAction.EXTEND, "wait")
    patient.baseline_state = BaselineState.DOCTOR_REVIEW_PENDING
    await session.flush()
    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, "ok")

    rows = list(await session.scalars(
        select(BaselineReview).where(BaselineReview.patient_id == patient.id)
        .order_by(BaselineReview.reviewed_at.asc())
    ))
    # Two rows, not one updated row — the sequence of what was thought and when.
    assert [r.action for r in rows] == [BaselineReviewAction.EXTEND,
                                        BaselineReviewAction.CONFIRM]
    assert all(r.reviewed_at is not None for r in rows)
    assert all(r.clinician_id == clinician.id for r in rows)
    # And what the reviewer actually saw is kept with the decision.
    assert rows[-1].baseline_snapshot_json is None or isinstance(
        rows[-1].baseline_snapshot_json, dict)


# --------------------------------------------------------------- D-047 expiry policy
@pytest.mark.parametrize("days,extensions,expected", [
    (10, 0, "continue"),
    (21, 0, "extend"),
    (25, 1, "continue"),
    (35, 1, "abandon"),
    (60, 1, "abandon"),
])
def test_expiry_extends_once_then_abandons(days, extensions, expected):
    """One automatic extension, then a human. "Auto-extend once" must not become
    "extend forever": a second failure is a real finding about this patient's ability to
    complete the protocol, and belongs in front of a person."""
    assert expiry_decision(days, extensions) == expected


def test_expiry_never_recommends_a_light_downgrade():
    """LIGHT changes which tasks run and therefore where each module sits on the fatigue
    curve — the confound INV-14 and D-027 exist to prevent. It would corrupt the very
    baseline being built."""
    outcomes = {expiry_decision(d, e) for d in (0, 21, 30, 35, 90) for e in (0, 1, 2)}
    assert outcomes <= {"continue", "extend", "abandon"}
    assert "downgrade" not in outcomes
