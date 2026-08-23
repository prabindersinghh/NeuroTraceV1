"""onboarding consent, aphasia mode, calibration, and practice sessions

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-23

Additive only. `sessions.is_practice` is the load-bearing column: a practice session is
stored but never scored and never enters a baseline — the pipeline filters on it.
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("patients") as b:
        b.add_column(sa.Column("aphasia_mode", sa.Boolean(), nullable=False,
                               server_default=sa.false()))
        b.add_column(sa.Column("consent_version", sa.String(16), nullable=True))
        b.add_column(sa.Column("consent_lang", sa.String(8), nullable=True))
        b.add_column(sa.Column("calibration_json", sa.JSON(), nullable=True))
        b.add_column(sa.Column("onboarding_complete", sa.Boolean(), nullable=False,
                               server_default=sa.false()))
    with op.batch_alter_table("sessions") as b:
        b.add_column(sa.Column("is_practice", sa.Boolean(), nullable=False,
                               server_default=sa.false()))


def downgrade() -> None:
    with op.batch_alter_table("sessions") as b:
        b.drop_column("is_practice")
    with op.batch_alter_table("patients") as b:
        b.drop_column("onboarding_complete")
        b.drop_column("calibration_json")
        b.drop_column("consent_lang")
        b.drop_column("consent_version")
        b.drop_column("aphasia_mode")
