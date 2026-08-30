"""A session the patient walked out of must never reach the engine — INV-14.

WHY THIS FILE EXISTS. The runner had no way to leave a session in progress, so the only
sessions that existed were finished ones and the question never came up. Adding an exit
button creates a new kind of row: a session with real module results and fewer of them than
the protocol calls for.

Those results must be KEPT — the family should see the check-in was started, and adherence
should count the attempt — and they must be excluded from the baseline and from scoring.
That is not a preference. `session_position` and `elapsed_seconds_at_task_start` exist
because every module's baseline absorbs its own place on the fatigue curve (INV-14). A
truncated session measures its modules under different conditions: nothing after the exit
point ran, so the modules that DID run sat at their normal positions but the session as a
whole is not the session the baseline was built from. Mixing the two makes a module's
baseline a blend of two measurement conditions, and the drift that matters disappears into
the spread.

`is_practice` already establishes exactly this shape — stored in full, never scored, never
in a baseline (0009) — and an abandoned session is the same argument for a different reason.

THE GAP THIS FOUND. `_module_history`, the query that feeds the baseline, filtered
`is_practice` but NOT `completed`. Every other pipeline query pairs them:
`_recent_sessions` checks both, and so does `baseline_review`. So an unfinished session's
results were already reaching the baseline before any exit button existed — reachable today
by closing the tab mid-session after the runner has posted its first module.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.password import hash_password
from app.exam.registry import DAILY_MODULES, MODULES
from app.models import (
    Baseline,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    Score,
    SessionType,
    StrokeSide,
    User,
)
from app.services.session_pipeline import compute_session
from app.services.synthetic import make_rng, synthetic_session

START = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
#: Enough days for a baseline to have a median worth contaminating.
DAYS = 6


async def _patient(session) -> Patient:
    caregiver = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                     pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(caregiver)
    await session.flush()
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67, sex="male",
        stroke_date=START - timedelta(days=150), stroke_side=StrokeSide.left,
        languages=["hi", "en"], preferred_hour=9.0,
    )
    session.add(patient)
    await session.commit()
    return patient


async def _complete_day(session, patient: Patient, day: int, drift: float = 0.0) -> None:
    """One finished session, run through the pipeline exactly as production does."""
    exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day),
                       type=SessionType.daily_pulse)
    session.add(exam)
    await session.flush()
    for code, feats in synthetic_session(make_rng(1000 + day), list(DAILY_MODULES),
                                         drift).items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=feats,
                                 quality_flag=True))
    await session.commit()
    await compute_session(session, exam.id)


async def _abandoned_session(session, patient: Patient, day: int,
                             drift: float = 6.0) -> ExamSession:
    """A session the patient exited part-way: real results, `completed` never set.

    The drift is deliberately large. If this row reaches a baseline it MOVES the median,
    and the assertions below compare medians — a subtle contamination would pass.
    """
    exam = ExamSession(patient_id=patient.id, ts=START + timedelta(days=day, hours=2),
                       type=SessionType.daily_pulse)
    session.add(exam)
    await session.flush()
    # Only the first three modules ran — that is what walking out looks like.
    partial = list(DAILY_MODULES)[:3]
    for code, feats in synthetic_session(make_rng(77), partial, drift).items():
        session.add(ModuleResult(session_id=exam.id, module_code=code,
                                 domain=MODULES[code].domain, features_json=feats,
                                 quality_flag=True))
    await session.commit()
    assert exam.completed is False, "the fixture must model an UNFINISHED session"
    return exam


async def _baselines(session, patient: Patient) -> dict[str, tuple[int, dict]]:
    rows = await session.scalars(
        select(Baseline).where(Baseline.patient_id == patient.id))
    return {b.module_code: (b.n_sessions, dict(b.median_json or {})) for b in rows}


# --------------------------------------------------------------------------- the gate
async def test_an_abandoned_session_never_reaches_a_baseline(session):
    """THE HEADLINE. Two patients, identical finished sessions; one also walked out of a
    session in between. Their baselines must be indistinguishable.

    Compared against a CONTROL rather than against a hardcoded number, so the test cannot
    drift out of date as the synthetic fixtures change — the only difference between the
    two patients is the abandoned row.
    """
    control = await _patient(session)
    walked_out = await _patient(session)

    for day in range(DAYS):
        await _complete_day(session, control, day)
        await _complete_day(session, walked_out, day)
        if day == 2:
            await _abandoned_session(session, walked_out, day)

    a, b = await _baselines(session, control), await _baselines(session, walked_out)
    assert set(a) == set(b), "the two patients ran the same modules"
    for code in sorted(a):
        assert a[code][0] == b[code][0], (
            f"{code}: baseline session COUNT differs ({a[code][0]} vs {b[code][0]}) — an "
            "abandoned session was counted as a measurement"
        )
        assert a[code][1] == b[code][1], (
            f"{code}: baseline MEDIAN moved because of an abandoned session. This is the "
            "INV-14 failure: a truncated session measured under different conditions was "
            "blended into a module's normal range."
        )


async def test_an_abandoned_session_has_no_score_and_no_band(session):
    """The other half: it is stored, and it is not scored."""
    patient = await _patient(session)
    for day in range(DAYS):
        await _complete_day(session, patient, day)
    exam = await _abandoned_session(session, patient, DAYS)

    score = await session.scalar(select(Score).where(Score.session_id == exam.id))
    assert score is None, "an abandoned session must not carry a band"


async def test_the_results_of_an_abandoned_session_are_kept(session):
    """Excluded from the engine is NOT the same as discarded. The family should be able to
    see the check-in was started, and adherence should count the attempt."""
    patient = await _patient(session)
    exam = await _abandoned_session(session, patient, 0)

    kept = list(await session.scalars(
        select(ModuleResult).where(ModuleResult.session_id == exam.id)))
    assert len(kept) == 3, (
        "the completed steps were dropped — exiting must retain what was measured, only "
        "keep it out of the baseline and the score"
    )
    still_there = await session.get(ExamSession, exam.id)
    assert still_there is not None, "the session row itself must survive"


async def test_the_control_baseline_is_actually_sensitive_to_contamination(session):
    """THE PIN. Proves the headline test can fail.

    If `_abandoned_session`'s drift were too small, or medians were compared loosely, the
    headline test would pass while contamination happened. This runs the same row through
    the pipeline as a COMPLETED session and requires the baseline to move — so the headline
    test's equality is evidence of exclusion, not evidence of a fixture that changes
    nothing.
    """
    control = await _patient(session)
    contaminated = await _patient(session)

    for day in range(DAYS):
        await _complete_day(session, control, day)
        await _complete_day(session, contaminated, day)
        if day == 2:
            # Same shape as the abandoned row, but finished — so it legitimately counts.
            exam = await _abandoned_session(session, contaminated, day)
            await compute_session(session, exam.id)

    a, b = await _baselines(session, control), await _baselines(session, contaminated)
    moved = [c for c in a if c in b and (a[c][0] != b[c][0] or a[c][1] != b[c][1])]
    assert moved, (
        "a COMPLETED session with the same contents changed nothing either — the fixture "
        "cannot detect contamination, so the headline test proves nothing"
    )
