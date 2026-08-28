"""Add patients.comprehensive_days_per_week — Part 2.3, the scheduler's per-patient config.

Straightforward additive column, portable on both dialects without a batch rebuild: a new
nullable-then-defaulted INTEGER column needs no constraint surgery like the enum-value
migrations (0011, 0012) did.

INV-7: existing patients get the task's stated default (2, twice weekly) via
`server_default`, so no row is left with a NULL the application would have to special-case.

Revision ID: 0013
Revises: 0012
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "patients",
        sa.Column("comprehensive_days_per_week", sa.Integer(),
                  nullable=False, server_default="2"),
    )


def downgrade() -> None:
    op.drop_column("patients", "comprehensive_days_per_week")
