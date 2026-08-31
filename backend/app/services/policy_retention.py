"""Bounded life for `awaaz_policy_events` — the retention sweep D-062 promised.

D-062 indexed `logged_on` "for a retention or deletion sweep" and then nothing swept, so
rows accrued forever. A stated retention commitment with no code behind it is worse than no
commitment: it is the shape of a promise with none of the effect.

WHAT THIS TABLE IS, since INV-8 and retention do not automatically agree
-----------------------------------------------------------------------
INV-8 says audit data is append-only. That invariant protects the *audit trail* — `audit_log`
— whose entire value is that nobody can edit or cherry-pick what it says happened. Nothing
here touches that table, and nothing here can be pointed at it: this module names
`AwaazPolicyEvent` literally and takes no table, model, or filter argument from a caller.

`awaaz_policy_events` is not audit data. It is operational analytics collected under a
purpose-specific `policy_logging_consent` (PRD §10.2) for one declared purpose — offline
comparison of candidate-ranking policies by `app.ml.rl.offline`. Data held for a purpose is
held for as long as that purpose lasts and no longer. So the honest classification is
operational data with a bounded life, which is what D-062 already said in the sentence that
put an index on the date column.

Append-only survives intact under a narrower and still load-bearing reading: no code path
UPDATEs a row, and no code path deletes a row on account of what the row *says*. The sweep
below can select on exactly one thing, the day, and it deletes whole rows. There is no way
to ask it to remove the events where the patient rejected the machine's guess, which is the
mutation an append-only rule exists to forbid. Expiry by age is not editing the record; it
is the record having an end.

WHAT THIS CANNOT DO
-------------------
It cannot honour a subject-erasure request. The table has no patient column and no foreign
key by design (D-062), so given a person asking to be rid of their events, the server cannot
identify which rows are theirs — and building any mechanism that could would mean storing
the link the table was built without. Time-based expiry is therefore the only deletion this
table can offer, and it is offered as exactly that. See `docs/ML_RECOVERY.md`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AwaazPolicyEvent

logger = logging.getLogger("neurotrace.policy_retention")

# ------------------------------------------------------------------- the window, and why
#
# The window is one evaluation cycle plus the time it takes a human to finish an evaluation.
#
#   * 90 days of accrual. An estimate from `offline.compare_policies` is a statement about
#     one named behaviour policy (`BEHAVIOUR_POLICY_ID`); rows written either side of a slug
#     bump can never be pooled, so a window longer than a policy's life keeps rows no
#     estimate will ever include. 90 days is the review cadence this project already runs on
#     — `docs/ML_RECOVERY.md` puts the restore drill at "at least quarterly" — and it is the
#     shortest accrual over which `MIN_EVENTS_FLOOR` (50 eligible events, after the profile,
#     explicit-signal and randomisation filters throw most rows away) is plausibly reachable
#     at this product's scale.
#   * 30 days of review lag. A log exported on the last day of a cycle still has to be run
#     through `compare_policies`, read, and argued about. Expiring rows out from under an
#     open review would mean the numbers in it cannot be reproduced from the source.
#
# So 120 days, not because four months feels prudent but because it is 90 + 30 and both
# halves have a job. It is deliberately NOT a round year, and it is not "as long as it might
# one day be useful" — that reasoning has no end and is how a log becomes permanent.
RETENTION_DAYS = 120

#: The idiom of `offline.EvaluationConfig`'s stringency floors, pointed the other way. A
#: deployment may hold these events for LESS time than the default; it may never hold them
#: for more, so this ceiling equals the default rather than sitting above it. Retention is a
#: privacy gate, and a gate that can be dialled looser by configuration is not a gate.
MAX_RETENTION_DAYS = 120

#: A lower bound on the window, which is not a privacy limit but a purpose one. Below one
#: accrual cycle no comparison can ever be run, and events collected under a consent for
#: offline evaluation that are destroyed before any evaluation is possible were collected
#: for nothing. The right response to a window this short is to stop collecting, not to
#: collect and shred.
MIN_RETENTION_DAYS = 30

#: Rows removed per invocation. A single bounded DELETE takes row locks on at most this many
#: rows and commits immediately, so a sweep can never sit on the table while a patient's
#: outcome INSERT waits behind it. A backlog is drained by calling again — which the report
#: says outright via `complete`.
SWEEP_BATCH_LIMIT = 500
MAX_SWEEP_BATCH_LIMIT = 2_000
MIN_SWEEP_BATCH_LIMIT = 1


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    """How long a policy event earns its keep, and how much one sweep may do."""

    retention_days: int = RETENTION_DAYS
    batch_limit: int = SWEEP_BATCH_LIMIT

    def __post_init__(self) -> None:
        # `type(...) is not int` rather than isinstance: True is an int and would sail
        # through every bound below as 1. The same check guards `EvaluationConfig`.
        if type(self.retention_days) is not int:
            raise ValueError("retention_days must be an integer number of days")
        if self.retention_days > MAX_RETENTION_DAYS:
            raise ValueError(
                f"retention_days may not exceed the {MAX_RETENTION_DAYS}-day ceiling; "
                "this window may be tightened by a deployment and never widened"
            )
        if self.retention_days < MIN_RETENTION_DAYS:
            raise ValueError(
                f"retention_days must be at least {MIN_RETENTION_DAYS}; below one accrual "
                "cycle no offline comparison is ever possible and the events should not be "
                "collected at all"
            )
        if type(self.batch_limit) is not int or not (
            MIN_SWEEP_BATCH_LIMIT <= self.batch_limit <= MAX_SWEEP_BATCH_LIMIT
        ):
            raise ValueError(
                "batch_limit must be an integer in "
                f"[{MIN_SWEEP_BATCH_LIMIT}, {MAX_SWEEP_BATCH_LIMIT}]"
            )

    def cutoff(self, today: date) -> date:
        """The first day whose rows are still kept. Anything strictly before it expires.

        Strictly-before, so a row logged exactly `retention_days` ago survives its final
        day. `logged_on` is a whole UTC day (D-062), so a boundary that deleted on equality
        would cut the window short by up to one day for every row in it.
        """
        return today - timedelta(days=self.retention_days)


DEFAULT_RETENTION_POLICY = RetentionPolicy()


@dataclass(frozen=True, slots=True)
class SweepReport:
    """Aggregates only.

    There is no field here that can hold an event id, a candidate id, a slate, an outcome or
    a day-of-a-single-row: a deletion report naming the rows it deleted would reconstruct
    outside the table precisely what deleting them was supposed to end. Counts and the
    policy boundary are all an operator needs to know whether the sweep is keeping up.
    """

    #: Named so a reader of an audit row knows which table this was, without the report
    #: being parameterised by it — the sweep function hard-codes the same name.
    table: str
    retention_days: int
    #: Rows on or after this day are kept. A policy boundary, not anybody's data.
    cutoff: date
    batch_limit: int
    deleted: int
    #: Expired rows still present after this invocation. Non-zero means call again.
    remaining_expired: int

    @property
    def complete(self) -> bool:
        """True when nothing beyond the window is left. The signal to stop calling."""
        return self.remaining_expired == 0

    def as_audit_meta(self) -> dict:
        """The shape written to `audit_log.meta_json` and returned over the wire."""
        return {
            "table": self.table,
            "retention_days": self.retention_days,
            "cutoff": self.cutoff.isoformat(),
            "batch_limit": self.batch_limit,
            "deleted": self.deleted,
            "remaining_expired": self.remaining_expired,
            "complete": self.complete,
        }


async def sweep_expired_policy_events(
    db: AsyncSession,
    *,
    policy: RetentionPolicy | None = None,
    today: date | None = None,
) -> SweepReport:
    """Delete `awaaz_policy_events` rows older than the window. Repeatable and bounded.

    Safe to run repeatedly: the predicate is `logged_on < cutoff` and nothing else, so a
    second call on a swept table matches no rows and returns `deleted=0` rather than an
    error. Safe to interrupt: one invocation is one bounded DELETE in one transaction, so it
    either applied or it did not, and the next call resumes from whatever survived. Safe to
    run on an empty table for the same reason — no rows match, and no row is required to
    exist for the count to be zero.
    """
    policy = policy or DEFAULT_RETENTION_POLICY
    cutoff = policy.cutoff(today or datetime.now(timezone.utc).date())
    expired = AwaazPolicyEvent.logged_on < cutoff

    # The bound is expressed as a subselect over the primary key rather than as `DELETE ...
    # LIMIT`, which Postgres does not accept at all and SQLite only accepts when built with
    # an optional flag. D-014's trap is the reason: `--sql` would render either form without
    # complaint and only a real Postgres would refuse one of them.
    doomed = (
        select(AwaazPolicyEvent.id)
        .where(expired)
        .order_by(AwaazPolicyEvent.logged_on)
        .limit(policy.batch_limit)
    )
    result = await db.execute(
        delete(AwaazPolicyEvent)
        .where(AwaazPolicyEvent.id.in_(doomed.scalar_subquery()))
        .execution_options(synchronize_session=False)
    )
    deleted = int(result.rowcount or 0)
    await db.commit()

    remaining = int(await db.scalar(
        select(func.count(AwaazPolicyEvent.id)).where(expired)) or 0)
    report = SweepReport(
        table=AwaazPolicyEvent.__tablename__,
        retention_days=policy.retention_days,
        cutoff=cutoff,
        batch_limit=policy.batch_limit,
        deleted=deleted,
        remaining_expired=remaining,
    )
    # Aggregates only, as above; this line is safe to leave on in production, which is the
    # only reason it is here — a retention sweep nobody can see running is one nobody
    # notices has stopped.
    logger.info(
        "policy-event retention sweep: deleted=%d remaining_expired=%d cutoff=%s",
        report.deleted, report.remaining_expired, report.cutoff.isoformat(),
    )
    return report


async def _run_until_complete() -> SweepReport:
    """Drain the backlog from a shell, for the restore drill.

    `docs/ML_RECOVERY.md` restores the database into an isolated environment with outbound
    network disabled, where there is no API to call. Re-applying the window there is the
    whole of this table's deletion evidence (the sweep is a deterministic predicate, so a
    restored snapshot re-expires at least everything it expired before), so it has to be
    runnable without the app serving. Everything real happens in the function above; this is
    a loop and a print.
    """
    from ..db import make_engine
    from ..config import settings
    from sqlalchemy.ext.asyncio import async_sessionmaker

    engine = make_engine(settings.database_url)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with maker() as db:
            report = await sweep_expired_policy_events(db)
            # `deleted == 0` with expired rows left cannot happen against a healthy
            # database, so if it does, something is refusing the delete and looping would
            # spin forever rather than report it.
            while not report.complete and report.deleted > 0:
                report = await sweep_expired_policy_events(db)
    finally:
        await engine.dispose()
    return report


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import asyncio
    import json

    print(json.dumps(asyncio.run(_run_until_complete()).as_audit_meta(), indent=2))
