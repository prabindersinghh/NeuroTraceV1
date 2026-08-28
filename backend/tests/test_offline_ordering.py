"""Part 5.6 — sessions captured offline and synced late must not corrupt a baseline.

SCOPE: this VERIFIES the existing manual-drain path. It does not build automatic drain,
which is plan-only (`docs/plans/PLAN_offline_auto_drain.md`) precisely because replaying
clinical sessions unattended is a data-integrity change that needs review first.

THE HAZARD. A phone in a dead zone queues day 1 and day 2. Connectivity returns and the
queue drains — but if anything replays out of capture order, or if the engine establishes
"consecutive sessions" from ARRIVAL order rather than CAPTURE order, then the persistence
gate (gate 1, "deviation held across consecutive valid sessions") is counting the wrong
thing. That would mis-time alerts for exactly the rural, intermittently-connected users
this product is built for.

THE TEST STRATEGY: build the same clinical history twice and compare the two patients
field by field. Asserting "the late one looks sensible" would not catch a subtle ordering
bug; asserting it is IDENTICAL to the online one does.

TWO PROPERTIES, AND THEY ARE DIFFERENT. A late drain **in capture order** must be
indistinguishable from having been online throughout — that is what the shipped
`syncPending` does and it is the guarantee that matters. A drain **out of capture order**
demonstrably is NOT equivalent, and the second test pins that divergence on purpose: it is
the concrete reason ordered replay is a requirement rather than a preference.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.password import hash_password
from app.engine.baseline import LOCK_AT_N_SESSIONS
from app.exam.registry import DAILY_MODULES, MODULES
from app.models import (
    Baseline as BaselineRow,
    BaselineReviewAction,
    BaselineState,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    Score,
    SessionType,
    StrokeSide,
    User,
)
from app.services.baseline_review import record_review
from app.services.session_pipeline import compute_session
from app.services.synthetic import make_rng, synthetic_session

START = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
DECLINING = ["M4", "M7", "M1"]


async def _make_patient(session, email_tag: str) -> Patient:
    caregiver = User(email=f"c-{email_tag}-{uuid.uuid4().hex[:6]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67,
        stroke_date=START - timedelta(days=150), stroke_side=StrokeSide.left,
        languages=["en"], preferred_hour=9.0,
    )
    session.add(patient)
    await session.commit()
    return patient


async def _confirm_baseline(session, patient) -> None:
    clinician = User(email=f"dr-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.clinician)
    session.add(clinician)
    await session.flush()
    await record_review(session, patient, clinician.id, BaselineReviewAction.CONFIRM, None)
    await session.commit()


async def _capture(session, patient, day: int, drift: float):
    """Create the session row with its real CAPTURE timestamp, but do not score it yet —
    this is what the phone does offline."""
    exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day),
                       type=SessionType.daily_pulse)
    session.add(exam)
    await session.flush()
    feats = synthetic_session(make_rng(5000 + day), list(DAILY_MODULES), drift,
                              drift_modules=DECLINING if drift else None)
    for code, f in feats.items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=f))
    await session.commit()
    return exam.id


async def _final_state(session, patient) -> dict:
    """Everything an out-of-order bug could plausibly disturb."""
    scores = list(await session.scalars(
        select(Score).join(ExamSession, Score.session_id == ExamSession.id)
        .where(Score.patient_id == patient.id)
        .order_by(ExamSession.ts.asc())
    ))
    baselines = list(await session.scalars(
        select(BaselineRow).where(BaselineRow.patient_id == patient.id)
        .order_by(BaselineRow.module_code.asc())
    ))
    return {
        "bands": [s.band.value for s in scores],
        "gate1": [s.gate1_passed for s in scores],
        "gate2": [s.gate2_passed for s in scores],
        "drift": [round(s.cumulative_drift, 6) for s in scores],
        "baseline_medians": {
            b.module_code: {k: round(v, 6) for k, v in (b.median_json or {}).items()}
            for b in baselines
        },
        "baseline_n": {b.module_code: b.n_sessions for b in baselines},
    }


DAYS = list(range(LOCK_AT_N_SESSIONS + 3)) + [
    LOCK_AT_N_SESSIONS + 3, LOCK_AT_N_SESSIONS + 4, LOCK_AT_N_SESSIONS + 5,
]
DRIFTS = [0.0] * (LOCK_AT_N_SESSIONS + 3) + [1.6, 2.2, 2.8]


async def test_a_late_drain_in_capture_order_produces_the_identical_result(session):
    """THE CENTRAL TEST. The whole clinical history captured offline and submitted late,
    in capture order, must be indistinguishable from having been online the whole time.

    This is what `offline.ts:syncPending` actually does — it replays in capture order and
    stops at the first failure — so this is the property the shipped drain has to hold.
    """
    # --- patient A: everything submitted as it happens, the online case ---
    in_order = await _make_patient(session, "inorder")
    confirmed = False
    for day, drift in zip(DAYS, DRIFTS):
        exam_id = await _capture(session, in_order, day, drift)
        await compute_session(session, exam_id)
        if not confirmed:
            await session.refresh(in_order)
            if in_order.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING:
                await _confirm_baseline(session, in_order)
                confirmed = True
    assert confirmed, "patient A never reached the doctor gate"

    # --- patient B: nothing reaches the server until the whole history drains at once ---
    drained = await _make_patient(session, "drained")
    captured: list[tuple[int, uuid.UUID]] = []
    for day, drift in zip(DAYS, DRIFTS):
        captured.append((day, await _capture(session, drained, day, drift)))

    confirmed = False
    for _day, exam_id in captured:                 # capture order, as the real drain does
        await compute_session(session, exam_id)
        if not confirmed:
            await session.refresh(drained)
            if drained.baseline_state is BaselineState.DOCTOR_REVIEW_PENDING:
                await _confirm_baseline(session, drained)
                confirmed = True
    assert confirmed, "patient B never reached the doctor gate"

    a = await _final_state(session, in_order)
    b = await _final_state(session, drained)

    assert b["baseline_medians"] == a["baseline_medians"], (
        "a late drain produced a different baseline from the same captures — the only "
        "thing that should determine it is capture order, which was identical"
    )
    assert b["baseline_n"] == a["baseline_n"]
    assert b["bands"] == a["bands"], (
        f"band sequence diverged on a late drain: {b['bands']} vs {a['bands']}"
    )
    assert b["gate1"] == a["gate1"], "the persistence gate counted arrival order"
    assert b["gate2"] == a["gate2"]
    assert b["drift"] == a["drift"]


async def test_replaying_out_of_capture_order_does_change_the_baseline(session):
    """A FINDING, pinned deliberately — this is the reason ordered replay is mandatory.

    Draining newest-first is not merely untidy, it produces a materially different
    baseline. `_upsert_baseline` builds each module's window from the sessions that already
    exist with an EARLIER timestamp; replaying backwards means the very first session
    processed already sees the entire history behind it, so the baseline locks in one step
    against a window the in-order path would never have produced. Rescoring afterwards does
    not undo it, because a locked baseline row is never rebuilt.

    So this test asserts the DIVERGENCE. If a future change made backwards replay safe this
    test would fail, and that would be good news worth looking at — but until then, the
    ordering guarantee in `syncPending` is load-bearing and automatic drain must preserve
    it (`docs/plans/PLAN_offline_auto_drain.md`).
    """
    forward = await _make_patient(session, "fwd")
    for day, drift in zip(DAYS, DRIFTS):
        exam_id = await _capture(session, forward, day, drift)
        await compute_session(session, exam_id)

    backward = await _make_patient(session, "bwd")
    captured = [(day, await _capture(session, backward, day, drift))
                for day, drift in zip(DAYS, DRIFTS)]
    for _day, exam_id in reversed(captured):
        await compute_session(session, exam_id)
    # Even a full rescore in the right order afterwards does not repair it.
    for _day, exam_id in captured:
        await compute_session(session, exam_id)

    a = await _final_state(session, forward)
    b = await _final_state(session, backward)
    assert b["baseline_medians"] != a["baseline_medians"], (
        "backwards replay now yields the same baseline as ordered replay. That is a "
        "behaviour change worth understanding before relaxing the ordering requirement in "
        "docs/plans/PLAN_offline_auto_drain.md"
    )


async def test_the_engine_orders_history_by_capture_time_not_insertion(session):
    """Pins the mechanism the test above verifies behaviourally.

    Every history query in the pipeline must order on `ExamSession.ts` (when the phone
    captured it), never on an insertion-order proxy like `created_at` or the primary key.
    A single `order_by(ExamSession.id)` slipping in here would break offline users only,
    silently, and only sometimes — the hardest possible bug to notice in a demo.
    """
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1]
           / "app" / "services" / "session_pipeline.py").read_text(encoding="utf-8")
    assert "order_by(ExamSession.ts" in src
    assert "order_by(ExamSession.id" not in src, (
        "history is being ordered by insertion order, not capture time"
    )
    assert "order_by(ExamSession.created_at" not in src


async def test_a_backdated_session_is_scored_against_only_its_own_past(session):
    """A session that arrives late must be judged against what came before IT, not against
    everything that has since been recorded — otherwise a late arrival is measured against
    its own future."""
    patient = await _make_patient(session, "backdated")
    confirmed = False
    for day, drift in zip(DAYS, DRIFTS):
        exam_id = await _capture(session, patient, day, drift)
        await compute_session(session, exam_id)
        if not confirmed:
            await session.refresh(patient)
            if patient.baseline_state.value == "DOCTOR_REVIEW_PENDING":
                await _confirm_baseline(session, patient)
                confirmed = True

    # A session captured in the middle of the stable stretch, arriving now.
    late_day = LOCK_AT_N_SESSIONS + 1
    late_id = await _capture(session, patient, late_day, 0.0)
    result = await compute_session(session, late_id)

    prior = list(await session.scalars(
        select(ExamSession.ts).where(
            ExamSession.patient_id == patient.id,
            ExamSession.ts < START + timedelta(days=late_day),
        )
    ))
    assert prior, "the fixture must have sessions before the late one for this to mean anything"
    # It landed inside the calm stretch, so it must not inherit the later decline's band.
    assert result["band"] in ("STABLE", "WATCH"), (
        f"a backdated calm session was scored {result['band']} — it was judged against "
        "sessions captured AFTER it"
    )
