"""derived movement trace on module results (M9 craniocorpography)

ADDITIVE. One nullable JSON column.

Stores the head-centre path in centimetres — derived coordinates, not media. The frames are
still reduced on the device and discarded there, so INV-1 is unchanged. A clinical CCG
report is read as a picture first and numbers second; without the path we hand a specialist
four unfamiliar numbers and ask them to trust them.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("module_results") as batch:
        batch.add_column(sa.Column("trace_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("module_results") as batch:
        batch.drop_column("trace_json")
