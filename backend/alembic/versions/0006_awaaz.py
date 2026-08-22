"""Awaaz — phrase board, speech profile, voice sample metadata, utterance log

ADDITIVE ONLY. Four new tables, nothing existing is touched.

The safety-critical column is `awaaz_profiles.speech_profile`. It decides whether anything
may ever be spoken without the patient confirming it, and it defaults to `unassessed` —
which the gate treats as aphasia. Safe by default, not convenient by default.

`voice_samples` deliberately holds METADATA ONLY. The audio never enters this database.

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "awaaz_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("speech_profile", sa.String(32), nullable=False,
                  server_default="unassessed"),
        sa.Column("auto_speak_enabled", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("auto_speak_threshold", sa.Float(), nullable=False,
                  server_default="0.85"),
        sa.Column("voice_status", sa.String(16), nullable=False, server_default="none"),
        sa.Column("endpoint_silence_seconds", sa.Float(), nullable=False,
                  server_default="2.5"),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "phrase_cards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(200), nullable=False),
        sa.Column("lang", sa.String(8), nullable=False, server_default="en"),
        sa.Column("icon", sa.String(32), nullable=True),
        sa.Column("category", sa.String(32), nullable=False, server_default="general"),
        sa.Column("slot", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("use_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_emergency", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_phrase_cards_patient_id", "phrase_cards", ["patient_id"])

    op.create_table(
        "voice_samples",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("provenance", sa.String(128), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="uploaded"),
        sa.Column("consent_by", sa.Uuid(), nullable=True),
        sa.Column("audio_deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["consent_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_voice_samples_patient_id", "voice_samples", ["patient_id"])

    op.create_table(
        "utterance_log",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(500), nullable=False),
        sa.Column("lang", sa.String(8), nullable=False, server_default="en"),
        sa.Column("card_id", sa.Uuid(), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("confirmed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("is_emergency", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ts", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["card_id"], ["phrase_cards.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_utterance_log_patient_id", "utterance_log", ["patient_id"])


def downgrade() -> None:
    op.drop_table("utterance_log")
    op.drop_table("voice_samples")
    op.drop_table("phrase_cards")
    op.drop_table("awaaz_profiles")
