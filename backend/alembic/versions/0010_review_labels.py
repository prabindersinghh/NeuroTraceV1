"""caregiver review labels on the utterance log

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-23

(text -> corrected_text) is the labelled pair the personalised ASR adapter trains on.
It lives on the utterance row itself so a label can never be orphaned from the utterance
it corrects. Additive only.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("utterance_log") as b:
        b.add_column(sa.Column("corrected_text", sa.String(500), nullable=True))
        b.add_column(sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("utterance_log") as b:
        b.drop_column("reviewed_at")
        b.drop_column("corrected_text")
