"""daily 12-minute protocol: intensity and fatigue instrumentation

ADDITIVE. Five nullable/defaulted columns.

  patients.intensity                          FULL | STANDARD | LIGHT | RESEARCH
  module_results.session_position             1-indexed position in the protocol
  module_results.elapsed_seconds_at_task_start
  module_results.intensity                    what the result was captured under
  module_results.paused_before_task           performed rested, against an unpaused baseline

WHY THESE EXIST. Fixed task ordering makes fatigue a constant that each module's personal
baseline absorbs. Two things break that constant after a baseline locks — an intensity
change (fewer preceding tasks = less fatigued = better score) and a mid-session pause — and
both bias in the direction that MASKS DECLINE. Recording them makes the bias measurable
instead of invisible.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("patients") as batch:
        batch.add_column(sa.Column("intensity", sa.String(16), nullable=False,
                                   server_default="FULL"))

    with op.batch_alter_table("module_results") as batch:
        batch.add_column(sa.Column("session_position", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("elapsed_seconds_at_task_start", sa.Float(),
                                   nullable=True))
        batch.add_column(sa.Column("intensity", sa.String(16), nullable=True))
        batch.add_column(sa.Column("paused_before_task", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("module_results") as batch:
        batch.drop_column("paused_before_task")
        batch.drop_column("intensity")
        batch.drop_column("elapsed_seconds_at_task_start")
        batch.drop_column("session_position")

    with op.batch_alter_table("patients") as batch:
        batch.drop_column("intensity")
