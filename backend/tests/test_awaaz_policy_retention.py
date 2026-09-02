"""Retention for `awaaz_policy_events` — the sweep D-062 promised and never wrote.

The table indexed `logged_on` "for a retention or deletion sweep" and no sweep existed, so
the rows accrued without end. These tests hold the four properties that make the sweep
trustworthy rather than merely present:

  * `test_the_sweep_deletes_beyond_the_window_and_nothing_inside_it` and
    `test_a_row_on_its_final_day_survives` — the boundary. A sweep that is one day out
    destroys evidence someone is still allowed to have, and cannot give it back.
  * `test_the_window_may_be_tightened_and_never_widened` — the whole privacy argument. The
    window is a gate in the idiom of `offline.EvaluationConfig`'s stringency floors, and a
    gate that can be configured looser is not a gate.
  * `test_the_report_carries_no_row_identifier` — INV-11 in the shape `test_privacy.py`
    uses. A deletion report that names what it deleted rebuilds outside the table exactly
    what deleting it was for.
  * `test_the_sweep_cannot_be_pointed_at_the_audit_trail` — INV-8. Retention here must not
    become a general delete facility that a later caller can aim at genuine audit data.
"""
from __future__ import annotations

import inspect
import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, AwaazPolicyEvent, PolicyEventOutcome
from app.services import policy_retention
from app.services.policy_retention import (
    DEFAULT_RETENTION_POLICY,
    MAX_RETENTION_DAYS,
    MAX_SWEEP_BATCH_LIMIT,
    MIN_RETENTION_DAYS,
    RETENTION_DAYS,
    RetentionPolicy,
    SweepReport,
    sweep_expired_policy_events,
)

SWEEP_ROUTE = "/awaaz/policy/retention/sweep"


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _today() -> date:
    """The same clock the sweep uses by default, so fixtures and cutoff cannot drift."""
    return datetime.now(timezone.utc).date()


def _event(day: date, *, event_id: uuid.UUID | None = None) -> AwaazPolicyEvent:
    """One logged decision on `day`. Rows are built directly: the writer's own path is
    covered by `test_awaaz_policy_logging.py`, and it can only ever write today's date."""
    action = uuid.uuid4()
    other = uuid.uuid4()
    return AwaazPolicyEvent(
        id=event_id or uuid.uuid4(),
        behavior_policy_id="awaaz-neartie-explore-v1",
        candidate_action_ids=[str(action), str(other)],
        logged_action_id=action,
        logged_action_probability=0.84,
        top_ranked_action_id=action,
        randomised=True,
        speech_profile="dysarthria_dominant",
        confirmation_required=True,
        confirmation_observed=True,
        output_spoken=True,
        emergency=False,
        feedback_actor="patient",
        outcome=PolicyEventOutcome.selected.value,
        selected_action_id=action,
        rejected_action_ids=[str(other)],
        logged_on=day,
    )


async def _add(session, *events) -> None:
    for event in events:
        session.add(event)
    await session.commit()


async def _count(session) -> int:
    return int(await session.scalar(select(func.count(AwaazPolicyEvent.id))) or 0)


# ------------------------------------------------------------------- the window as a gate
def test_the_default_window_is_the_documented_one():
    """120 days = 90 days of accrual + 30 days of review lag. If either half changes, the
    number changes with it deliberately rather than by drift."""
    assert RETENTION_DAYS == 120
    assert DEFAULT_RETENTION_POLICY.retention_days == RETENTION_DAYS


def test_the_window_may_be_tightened_and_never_widened():
    """The ceiling equals the default on purpose: there is no legitimate reason to hold
    these events longer than the evaluation they were consented for."""
    assert MAX_RETENTION_DAYS == RETENTION_DAYS
    assert RetentionPolicy(retention_days=60).retention_days == 60
    floor = RetentionPolicy(retention_days=MIN_RETENTION_DAYS)
    assert floor.retention_days == MIN_RETENTION_DAYS
    for weaker in (RETENTION_DAYS + 1, 365, 3_650):
        with pytest.raises(ValueError, match="ceiling"):
            RetentionPolicy(retention_days=weaker)


def test_a_window_too_short_to_evaluate_is_refused():
    """Not a privacy limit but a purpose one: events destroyed before any comparison can
    run were collected for nothing, and the answer to that is to stop collecting."""
    with pytest.raises(ValueError, match="accrual cycle"):
        RetentionPolicy(retention_days=MIN_RETENTION_DAYS - 1)
    with pytest.raises(ValueError, match="accrual cycle"):
        RetentionPolicy(retention_days=0)


@pytest.mark.parametrize("bad", [True, 30.0, "30", None])
def test_a_non_integer_window_is_refused(bad):
    """`True` is an int and would pass every bound below as a one-day window."""
    with pytest.raises(ValueError):
        RetentionPolicy(retention_days=bad)


@pytest.mark.parametrize("bad", [0, -1, MAX_SWEEP_BATCH_LIMIT + 1, True, 500.0])
def test_the_batch_bound_is_validated(bad):
    with pytest.raises(ValueError):
        RetentionPolicy(batch_limit=bad)


def test_the_cutoff_keeps_a_row_for_its_whole_final_day():
    today = date(2026, 8, 31)
    policy = RetentionPolicy(retention_days=120)
    assert policy.cutoff(today) == today - timedelta(days=120)


# --------------------------------------------------------------------------- the sweep
async def test_an_empty_table_is_a_no_op_not_an_error(session):
    report = await sweep_expired_policy_events(session)
    assert (report.deleted, report.remaining_expired, report.complete) == (0, 0, True)


async def test_the_sweep_deletes_beyond_the_window_and_nothing_inside_it(session):
    today = _today()
    inside = [
        _event(today),
        _event(today - timedelta(days=1)),
        _event(today - timedelta(days=RETENTION_DAYS - 1)),
    ]
    outside = [
        _event(today - timedelta(days=RETENTION_DAYS + 1)),
        _event(today - timedelta(days=400)),
    ]
    await _add(session, *inside, *outside)

    report = await sweep_expired_policy_events(session, today=today)

    assert report.deleted == len(outside)
    assert report.complete
    survivors = {row.id for row in await session.scalars(select(AwaazPolicyEvent))}
    assert survivors == {row.id for row in inside}


async def test_a_row_on_its_final_day_survives(session):
    """`logged_on` is a whole UTC day, so deleting on equality would cut every row's window
    short by up to a day."""
    today = _today()
    boundary = _event(today - timedelta(days=RETENTION_DAYS))
    expired = _event(today - timedelta(days=RETENTION_DAYS + 1))
    await _add(session, boundary, expired)

    report = await sweep_expired_policy_events(session, today=today)

    assert report.deleted == 1
    survivors = [row.id for row in await session.scalars(select(AwaazPolicyEvent))]
    assert survivors == [boundary.id]


async def test_the_sweep_is_idempotent(session):
    today = _today()
    await _add(
        session,
        _event(today),
        *[_event(today - timedelta(days=200 + i)) for i in range(4)],
    )

    first = await sweep_expired_policy_events(session, today=today)
    second = await sweep_expired_policy_events(session, today=today)
    third = await sweep_expired_policy_events(session, today=today)

    assert first.deleted == 4
    assert (second.deleted, third.deleted) == (0, 0)
    assert second.complete and third.complete
    assert await _count(session) == 1


async def test_one_invocation_is_bounded_and_says_so(session):
    """A sweep that deletes an unbounded backlog in one statement holds row locks across
    the whole of it, and a patient's outcome INSERT waits behind it."""
    today = _today()
    await _add(session, *[_event(today - timedelta(days=200 + i)) for i in range(5)])
    policy = RetentionPolicy(batch_limit=2)

    first = await sweep_expired_policy_events(session, policy=policy, today=today)
    assert (first.deleted, first.remaining_expired, first.complete) == (2, 3, False)

    second = await sweep_expired_policy_events(session, policy=policy, today=today)
    assert (second.deleted, second.remaining_expired, second.complete) == (2, 1, False)

    third = await sweep_expired_policy_events(session, policy=policy, today=today)
    assert (third.deleted, third.remaining_expired, third.complete) == (1, 0, True)
    assert await _count(session) == 0


async def test_an_interrupted_sweep_leaves_a_consistent_table(session):
    """Each invocation is one bounded DELETE in one transaction. Stopping between two of
    them is indistinguishable from never having started the second."""
    today = _today()
    await _add(session, *[_event(today - timedelta(days=300 + i)) for i in range(6)])
    policy = RetentionPolicy(batch_limit=3)

    await sweep_expired_policy_events(session, policy=policy, today=today)
    # ... operator's shell dies here ...
    assert await _count(session) == 3

    resumed = await sweep_expired_policy_events(session, policy=policy, today=today)
    assert resumed.complete
    assert await _count(session) == 0


# ------------------------------------------------------------------------ what it reports
async def test_the_report_carries_no_row_identifier(session):
    """INV-11 in `test_privacy.py`'s idiom: assert on the shape AND on the values, so a
    field added later that happens to hold an id fails this rather than passing quietly."""
    today = _today()
    doomed = _event(today - timedelta(days=500))
    await _add(session, doomed)
    identifiers = {str(doomed.id), doomed.id.hex, str(doomed.logged_action_id),
                   *doomed.candidate_action_ids, *doomed.rejected_action_ids,
                   doomed.logged_on.isoformat()}

    report = await sweep_expired_policy_events(session, today=today)
    meta = report.as_audit_meta()

    assert set(meta) == {
        "table", "retention_days", "cutoff", "batch_limit", "deleted",
        "remaining_expired", "complete",
    }
    assert all(isinstance(v, (str, int, bool)) for v in meta.values())
    blob = json.dumps(meta)
    for identifier in identifiers:
        assert identifier not in blob, f"the report leaked {identifier!r}"
    # Nothing UUID-shaped at all, whether or not it came from a row we know about.
    assert not [
        value for value in meta.values()
        if isinstance(value, str) and len(value.replace("-", "")) == 32
    ]


async def test_the_report_states_the_policy_it_applied(session):
    """An operator reading an audit row has to be able to tell which window ran."""
    today = date(2026, 8, 31)
    report = await sweep_expired_policy_events(session, today=today)
    meta = report.as_audit_meta()
    assert meta["table"] == "awaaz_policy_events"
    assert meta["retention_days"] == RETENTION_DAYS
    assert meta["cutoff"] == (today - timedelta(days=RETENTION_DAYS)).isoformat()


def test_the_report_is_aggregate_by_construction():
    """No field on the report can hold a row: the annotations are counts, a date and the
    fixed table name, and there is no collection type among them."""
    for name, annotation in SweepReport.__annotations__.items():
        assert annotation in ("str", "int", "date", str, int, date), (name, annotation)


# ----------------------------------------------------------------- INV-8 stays untouched
def test_the_sweep_cannot_be_pointed_at_the_audit_trail():
    """The append-only invariant protects `audit_log`. This module keeps that true by
    construction rather than by convention: there is no table, model, or filter parameter a
    caller could supply, so retention cannot be reused as a delete facility."""
    params = set(inspect.signature(sweep_expired_policy_events).parameters)
    assert params == {"db", "policy", "today"}
    assert set(RetentionPolicy.__annotations__) == {"retention_days", "batch_limit"}
    source = inspect.getsource(policy_retention)
    assert "AuditLog" not in source
    assert source.count("delete(") == 1


async def test_the_sweep_cannot_select_rows_on_what_they_say(session):
    """The predicate is the day and nothing else, so the one mutation append-only exists to
    forbid -- removing the events that record an inconvenient outcome -- is not expressible.
    Two rows of the same age with opposite outcomes are treated identically."""
    today = _today()
    old = today - timedelta(days=300)
    selected = _event(old)
    rejected = _event(old)
    rejected.outcome = PolicyEventOutcome.rejected.value
    rejected.selected_action_id = None
    rejected.confirmation_observed = False
    rejected.output_spoken = False
    await _add(session, selected, rejected)

    report = await sweep_expired_policy_events(session, today=today)

    assert report.deleted == 2
    assert await _count(session) == 0


async def test_a_sweep_leaves_the_audit_trail_intact(session, client, provision):
    """Genuine audit rows -- including the sweep's own -- are never swept."""
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    today = _today()
    await _add(session, _event(today - timedelta(days=400)))
    session.add(AuditLog(action="awaaz.policy_event.log", ts=datetime(
        2020, 1, 1, tzinfo=timezone.utc)))
    await session.commit()

    resp = await client.post(SWEEP_ROUTE, headers=auth(token))
    assert resp.status_code == 200, resp.text

    actions = [row.action for row in await session.scalars(select(AuditLog))]
    assert "awaaz.policy_event.log" in actions
    assert "awaaz.policy_event.retention_sweep" in actions


# --------------------------------------------------------------------------- the endpoint
async def test_only_an_admin_may_run_the_sweep(client, provision):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    resp = await client.post(SWEEP_ROUTE, headers=auth(token))
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("role", ["caregiver", "clinician", "patient", "asha_worker"])
async def test_no_other_role_can_run_the_sweep(client, provision, role):
    token, _ = await provision(client, f"{role}@example.com", role)
    resp = await client.post(SWEEP_ROUTE, headers=auth(token))
    assert resp.status_code == 403, f"{role} swept the policy log"


async def test_anonymous_cannot_run_the_sweep(client, session):
    """And an unauthenticated call must not delete anything on its way to being refused."""
    today = _today()
    await _add(session, _event(today - timedelta(days=400)))
    resp = await client.post(SWEEP_ROUTE)
    assert resp.status_code in (401, 403)
    assert await _count(session) == 1


async def test_the_endpoint_deletes_the_expired_rows_and_is_idempotent(
    session, client, provision,
):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    today = _today()
    kept = _event(today)
    await _add(session, kept, *[_event(today - timedelta(days=200 + i)) for i in range(3)])

    first = (await client.post(SWEEP_ROUTE, headers=auth(token))).json()
    second = (await client.post(SWEEP_ROUTE, headers=auth(token))).json()

    assert first["deleted"] == 3 and first["complete"] is True
    assert second["deleted"] == 0 and second["complete"] is True
    assert [row.id for row in await session.scalars(select(AwaazPolicyEvent))] == [kept.id]


async def test_the_sweep_audit_row_names_no_patient_and_no_event(
    session, client, provision,
):
    """`audit_log` carries a patient column and a microsecond timestamp. An event id here
    would be the exact join key back onto a table built to have no patient link (D-062);
    there is also no patient to name, because this table has none."""
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    today = _today()
    doomed = _event(today - timedelta(days=400))
    await _add(session, doomed)

    resp = await client.post(SWEEP_ROUTE, headers=auth(token))
    assert resp.status_code == 200, resp.text

    row = await session.scalar(
        select(AuditLog).where(AuditLog.action == "awaaz.policy_event.retention_sweep"))
    assert row is not None
    assert row.patient_id is None
    blob = json.dumps(row.meta_json)
    assert str(doomed.id) not in blob and doomed.id.hex not in blob
    assert str(doomed.logged_action_id) not in blob
    assert row.meta_json["deleted"] == 1


async def test_the_response_is_the_same_aggregate_the_audit_row_records(
    session, client, provision,
):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    await _add(session, _event(_today() - timedelta(days=400)))

    body = (await client.post(SWEEP_ROUTE, headers=auth(token))).json()
    row = await session.scalar(
        select(AuditLog).where(AuditLog.action == "awaaz.policy_event.retention_sweep"))

    assert body == row.meta_json
