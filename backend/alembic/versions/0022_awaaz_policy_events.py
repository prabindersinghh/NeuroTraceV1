"""Awaaz privacy-safe policy events — the counterfactual logging contract (AWA-FR-014).

ADDITIVE ONLY. One new table, no existing column touched, no data read or rewritten, so
there is no row this can lose (INV-7). `downgrade` drops only the table it created.

PORTABILITY (D-014). There is no `op.execute` anywhere in this file. Migration 0004 shipped
`WHERE locked = 1` inside one, which SQLite accepts and Postgres rejects, and
`alembic upgrade --sql` renders raw SQL identically for both dialects so it could never have
caught it. Everything here goes through the SQLAlchemy type system, which is where the
dialect difference is actually resolved: `sa.Uuid` becomes native UUID on Postgres and
CHAR(32) on SQLite, `sa.JSON` becomes JSON and TEXT, `sa.Date` becomes DATE on both, and
`sa.false()` renders `false` rather than the `0` that made 0004 fail.

There is deliberately no FOREIGN KEY on this table, and no enum type. Per D-016 an enum
column is a plain VARCHAR; here it is a plain VARCHAR with no CHECK either, matching the
`awaaz_profiles.speech_profile` precedent — the enums are enforced by the Pydantic request
models at the only writer, and a CHECK would have to be dropped and recreated in a batch
operation every time a value is added, which is where SQLite downgrades break.

The absence of `patient_id` is the point of the table, not an omission. See
`app/models.py::AwaazPolicyEvent`.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-31
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# HISTORICAL NOTE (the collision this anticipated is now resolved). `main` already
# carries a different migration claiming revision "0014" (doctor-in-the-loop), and this
# branch and that one have independently used 0012, 0013 and 0014 for unrelated changes.
# Two revisions sharing an id do not merge -- alembic resolves one and silently loses the
# other's ordering. A unique id means this migration is at worst a branch point alembic
# can be told to merge, rather than a collision it cannot see.
revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "awaaz_policy_events",
        # The opaque event UUID minted by the client, used as both identity and idempotency
        # key so a retried outcome POST cannot create a second observation of one decision.
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("behavior_policy_id", sa.String(64), nullable=False),
        # Ordered slate of opaque candidate UUIDs; index 0 is rank 0 is the logged action.
        sa.Column("candidate_action_ids", sa.JSON(), nullable=False),
        sa.Column("logged_action_id", sa.Uuid(), nullable=False),
        # pi_0 of the LOGGED action, not of the top-ranked one.
        sa.Column("logged_action_probability", sa.Float(), nullable=False),
        sa.Column("top_ranked_action_id", sa.Uuid(), nullable=False),
        sa.Column("randomised", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("speech_profile", sa.String(32), nullable=False,
                  server_default="unassessed"),
        sa.Column("confirmation_required", sa.Boolean(), nullable=False,
                  server_default=sa.true()),
        sa.Column("confirmation_observed", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("output_spoken", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("emergency", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("feedback_actor", sa.String(16), nullable=False,
                  server_default="patient"),
        sa.Column("outcome", sa.String(32), nullable=False),
        sa.Column("selected_action_id", sa.Uuid(), nullable=True),
        sa.Column("rejected_action_ids", sa.JSON(), nullable=False),
        # A DATE, not a timestamp: a microsecond clock here would join exactly onto
        # audit_log.ts and utterance_log.ts, both of which carry patient_id.
        sa.Column("logged_on", sa.Date(), nullable=False),
    )
    op.create_index(
        "ix_awaaz_policy_events_logged_on", "awaaz_policy_events", ["logged_on"])


def downgrade() -> None:
    op.drop_index("ix_awaaz_policy_events_logged_on",
                  table_name="awaaz_policy_events")
    op.drop_table("awaaz_policy_events")
