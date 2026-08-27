"""On-device Awaaz audio-pair receipts; no media bytes.

The browser may retain an explicitly-consented 16 kHz WAV in IndexedDB after a patient
speaks and taps the matching phrase card. The server stores only the capture UUID, duration,
consent receipt, and deletion state. There is deliberately no blob, path, or upload target.

Revision ID: 0013
Revises: 0012
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("utterance_log") as batch:
        batch.add_column(sa.Column("audio_capture_id", sa.String(36), nullable=True))
        batch.add_column(sa.Column("audio_duration_seconds", sa.Float(), nullable=True))
        batch.add_column(sa.Column("audio_sha256", sa.String(64), nullable=True))
        batch.add_column(sa.Column("audio_size_bytes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("audio_consent_by", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("audio_consent_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column(
            "audio_retained_on_device", sa.Boolean(), nullable=False,
            server_default=sa.false(),
        ))
        batch.add_column(sa.Column("audio_deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key(
            op.f("fk_utterance_log_audio_consent_by_users"),
            "users", ["audio_consent_by"], ["id"], ondelete="SET NULL",
        )
    op.create_index(
        "ix_utterance_log_audio_capture_id", "utterance_log", ["audio_capture_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_utterance_log_audio_capture_id", table_name="utterance_log")
    with op.batch_alter_table("utterance_log") as batch:
        batch.drop_constraint(
            op.f("fk_utterance_log_audio_consent_by_users"), type_="foreignkey")
        batch.drop_column("audio_deleted_at")
        batch.drop_column("audio_retained_on_device")
        batch.drop_column("audio_consent_at")
        batch.drop_column("audio_consent_by")
        batch.drop_column("audio_size_bytes")
        batch.drop_column("audio_sha256")
        batch.drop_column("audio_duration_seconds")
        batch.drop_column("audio_capture_id")
