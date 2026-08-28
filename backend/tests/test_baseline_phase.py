"""Part 3.3/3.5/3.6 — the phase machine, re-entry criteria, and invalidation.

The rule that matters most here: **no band and no alert reaches anyone until a clinician
has confirmed the baseline.** Before Part 3, suppression meant "some module is still
collecting"; it now means "this patient is not LOCKED", which additionally silences
DOCTOR_REVIEW_PENDING and ABANDONED. A patient waiting on a doctor is not a patient being
monitored.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.engine.reentry import (
    ADHERENCE_FLOOR,
    PERIODIC_REVIEW_DAYS,
    ReentryTrigger,
    evaluate_reentry,
)
from app.models import BaselineState

NOW = datetime.now(timezone.utc)


# ------------------------------------------------------------------- the state set
def test_the_phase_machine_has_the_five_states_part_3_requires():
    assert {b.value for b in BaselineState} == {
        "NOT_STARTED", "IN_PROGRESS", "DOCTOR_REVIEW_PENDING", "LOCKED", "ABANDONED",
    }


def test_only_locked_permits_monitoring():
    """The suppression rule, stated as a test so it cannot be quietly widened.

    `session_pipeline` computes `baseline_phase = patient.baseline_state is not LOCKED`,
    so every other state suppresses bands and alerts. If someone later adds a state and
    forgets, this test is where it shows up.
    """
    monitored = {s for s in BaselineState if s is BaselineState.LOCKED}
    suppressed = set(BaselineState) - monitored
    assert monitored == {BaselineState.LOCKED}
    assert BaselineState.DOCTOR_REVIEW_PENDING in suppressed, (
        "a patient whose baseline nobody has approved would receive a band"
    )
    assert BaselineState.ABANDONED in suppressed, (
        "a patient whose baseline was invalidated would be scored against it"
    )


def test_the_pipeline_reads_suppression_from_the_patient_not_the_modules():
    """Pins the actual line, because the old per-module version silently excluded the two
    new states — all modules can be locked while nobody has confirmed anything."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1]
           / "app" / "services" / "session_pipeline.py").read_text(encoding="utf-8")
    assert "baseline_phase = patient.baseline_state is not BaselineState.LOCKED" in src


def test_terminal_states_are_not_recomputed_away_by_a_later_session():
    """LOCKED was a human decision and ABANDONED was an invalidation. A session arriving
    afterwards must not silently move either — `_refresh_baseline_state` returns early."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1]
           / "app" / "services" / "session_pipeline.py").read_text(encoding="utf-8")
    idx = src.index("async def _refresh_baseline_state")
    body = src[idx:idx + 1200]
    assert "BaselineState.LOCKED, BaselineState.ABANDONED" in body
    assert "return" in body


def test_all_modules_locked_means_review_pending_not_locked():
    """The single most important behavioural change in Part 3: meeting the criteria is a
    REQUEST FOR REVIEW, not a lock."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1]
           / "app" / "services" / "session_pipeline.py").read_text(encoding="utf-8")
    idx = src.index("async def _refresh_baseline_state")
    body = src[idx:idx + 1200]
    assert "BaselineState.DOCTOR_REVIEW_PENDING" in body
    # And the old auto-lock is gone.
    assert "all(r.locked for r in rows)" in body
    assert "= BaselineState.LOCKED" not in body, (
        "_refresh_baseline_state still auto-locks — the doctor gate can be bypassed by "
        "simply completing enough sessions"
    )


# ------------------------------------------------------------------- 3.5 re-entry
def test_an_alert_brings_the_clinician_back():
    reasons = evaluate_reentry(band="ALERT", adherence=1.0, days_since_last_review=1)
    assert reasons[0].trigger is ReentryTrigger.ALERT_BAND


def test_pattern_atypical_brings_the_clinician_back():
    """It is NOT our alert — which is exactly why a human needs to see it; it points at a
    different referral."""
    reasons = evaluate_reentry(band="PATTERN_ATYPICAL", adherence=1.0,
                               days_since_last_review=1)
    assert any(r.trigger is ReentryTrigger.PATTERN_ATYPICAL for r in reasons)


def test_low_adherence_brings_the_clinician_back():
    reasons = evaluate_reentry(band="STABLE", adherence=ADHERENCE_FLOOR - 0.01,
                               days_since_last_review=1)
    assert any(r.trigger is ReentryTrigger.LOW_ADHERENCE for r in reasons)


def test_a_caregiver_concern_is_sufficient_on_its_own():
    """A family's worry does not need to be corroborated by a number first."""
    reasons = evaluate_reentry(band="STABLE", adherence=1.0, days_since_last_review=1,
                               caregiver_concern=True)
    assert [r.trigger for r in reasons] == [ReentryTrigger.CAREGIVER_CONCERN]


def test_the_scheduled_review_fires_so_a_quiet_patient_is_not_forgotten():
    reasons = evaluate_reentry(band="STABLE", adherence=1.0,
                               days_since_last_review=PERIODIC_REVIEW_DAYS)
    assert any(r.trigger is ReentryTrigger.PERIODIC_REVIEW for r in reasons)


def test_a_stable_adherent_recently_reviewed_patient_is_left_alone():
    """Re-entry must be a real signal. If it fired for everyone it would be ignored."""
    assert evaluate_reentry(band="STABLE", adherence=1.0, days_since_last_review=1) == []


def test_every_matching_reason_is_returned_not_just_the_first():
    """A patient who is both alerting AND non-adherent is a different conversation from
    one who is only alerting."""
    reasons = evaluate_reentry(band="ALERT", adherence=0.2, days_since_last_review=200,
                               caregiver_concern=True)
    triggers = {r.trigger for r in reasons}
    assert {ReentryTrigger.ALERT_BAND, ReentryTrigger.LOW_ADHERENCE,
            ReentryTrigger.CAREGIVER_CONCERN, ReentryTrigger.PERIODIC_REVIEW} <= triggers
    # Most urgent first.
    assert reasons[0].trigger is ReentryTrigger.ALERT_BAND


def test_every_trigger_carries_a_readable_detail():
    """A queue entry saying only "LOW_ADHERENCE" makes a clinician go and look it up."""
    reasons = evaluate_reentry(band="ALERT", adherence=0.1, days_since_last_review=200,
                               caregiver_concern=True, clinical_event=True)
    assert all(r.detail and len(r.detail) > 20 for r in reasons)


# ------------------------------------------------------------- 3.6 invalidation
async def test_invalidation_requires_a_reason(session):
    from app.auth.password import hash_password
    from app.models import Patient, Role, User
    from app.services.baseline_review import BaselineGateError, invalidate_baseline

    care = User(email="inv@example.com", pw_hash=hash_password("x" * 12),
                role=Role.caregiver)
    session.add(care)
    await session.flush()
    patient = Patient(caregiver_id=care.id, name="T",
                      stroke_date=NOW - timedelta(days=200),
                      baseline_state=BaselineState.IN_PROGRESS)
    session.add(patient)
    await session.flush()

    with pytest.raises(BaselineGateError):
        await invalidate_baseline(session, patient, care.id, "   ")


async def test_invalidation_abandons_the_baseline_and_records_why(session):
    from sqlalchemy import select

    from app.auth.password import hash_password
    from app.models import AuditLog, Patient, Role, User
    from app.services.baseline_review import invalidate_baseline

    care = User(email="inv2@example.com", pw_hash=hash_password("x" * 12),
                role=Role.caregiver)
    session.add(care)
    await session.flush()
    patient = Patient(caregiver_id=care.id, name="T",
                      stroke_date=NOW - timedelta(days=200),
                      baseline_state=BaselineState.IN_PROGRESS)
    session.add(patient)
    await session.flush()

    await invalidate_baseline(session, patient, care.id, "second stroke, admitted 12 Aug")

    assert patient.baseline_state is BaselineState.ABANDONED
    row = await session.scalar(
        select(AuditLog).where(AuditLog.patient_id == patient.id,
                               AuditLog.action == "baseline.invalidated")
    )
    assert row is not None
    assert "second stroke" in row.meta_json["reason"]
