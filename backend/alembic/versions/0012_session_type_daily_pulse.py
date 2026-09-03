"""Rename SessionType values: daily/weekly/monthly -> DAILY_PULSE/COMPREHENSIVE/MONTHLY/ASHA_VISIT.

docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md Part 2, D-044. The old values described a MODULE's
measurement schedule, not a SESSION, and never differentiated live session content — the
frontend has always run the full battery under `type="daily"` regardless of what the old
`weekly`/`monthly` values existed to mean. This migration makes `sessions.type` genuinely
drive what gets run: DAILY_PULSE (six modules, ~195s capture — the "~90s" figure this
docstring first carried was a target the protocol never met, D-045), COMPREHENSIVE (Daily Pulse
plus the WEEKLY-schedule modules), MONTHLY, and the new ASHA_VISIT.

PORTABILITY (D-014). `sessions.type` is VARCHAR + a named CHECK, not a native Postgres
ENUM, so this is a constraint swap plus a data rewrite, not `ALTER TYPE ... RENAME VALUE`.
`batch_alter_table` for the constraint (works on both dialects, as migration 0011); a plain
`UPDATE` for the data, since renaming existing rows' values is portable SQL on both — no
dialect-specific syntax to trip on rendering-vs-running (unlike 0004/env.py's PRAGMA).

INV-7: no rows lost. Existing sessions keep their identity and every other column; only
the `type` string changes, 1:1, both directions.

Revision ID: 0012
Revises: 0011
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# The BARE name, not the rendered `ck_sessions_session_type_enum`. `db.py`'s
# naming_convention is "ck_%(table_name)s_%(constraint_name)s", and batch_alter_table
# applies it — so passing the already-rendered name produces the doubled
# `ck_sessions_ck_sessions_session_type_enum` and the drop silently targets a constraint
# that does not exist. This is the identical bug DEPLOY.md records migration 0003 hitting
# ("DROP CONSTRAINT ck_scores_ck_scores_band_enum"); caught here by RUNNING the migration
# in the test suite, not by rendering it (D-014). Migration 0011 gets this right and is
# the reference.
CONSTRAINT = "session_type_enum"
OLD_VALUES = ("daily", "weekly", "monthly")
NEW_VALUES = ("DAILY_PULSE", "COMPREHENSIVE", "MONTHLY", "ASHA_VISIT")

# old -> new. "weekly" becomes COMPREHENSIVE, not a same-named WEEKLY value — Comprehensive
# is the session TYPE that runs the weekly-schedule modules, matching Part 2's naming.
RENAME = {"daily": "DAILY_PULSE", "weekly": "COMPREHENSIVE", "monthly": "MONTHLY"}


def _check(values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"type IN ({joined})"


def upgrade() -> None:
    # Widen the constraint FIRST so the data rewrite below is never rejected mid-flight by
    # the old, narrower CHECK while old and new values briefly coexist in the same UPDATE.
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(
            CONSTRAINT, sa.text(_check(OLD_VALUES + NEW_VALUES))
        )
    for old, new in RENAME.items():
        op.execute(f"UPDATE sessions SET type = '{new}' WHERE type = '{old}'")
    # Narrow to the final value set now that no old-format row remains.
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(NEW_VALUES)))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(
            CONSTRAINT, sa.text(_check(OLD_VALUES + NEW_VALUES))
        )
    # ASHA_VISIT has no pre-Part-2 equivalent; any such row predates this migration's own
    # upgrade path, so downgrading it to the closest old meaning (an in-person deep visit)
    # is "monthly" rather than losing the row (INV-7).
    for old, new in RENAME.items():
        op.execute(f"UPDATE sessions SET type = '{old}' WHERE type = '{new}'")
    op.execute("UPDATE sessions SET type = 'monthly' WHERE type = 'ASHA_VISIT'")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(OLD_VALUES)))
