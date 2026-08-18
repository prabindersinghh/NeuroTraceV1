"""initial schema — users, patients, daily_samples, feature_vectors, baselines, scores, alerts

Revision ID: 0001
Revises:
Create Date: 2026-08-17
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLE = sa.Enum(
    "patient", "caregiver", "clinician",
    name="role_enum", native_enum=False, create_constraint=True, length=16,
)
SAMPLE_STATUS = sa.Enum(
    "processing", "done",
    name="sample_status_enum", native_enum=False, create_constraint=True, length=16,
)
MODALITY = sa.Enum(
    "voice", "face", "reaction",
    name="modality_enum", native_enum=False, create_constraint=True, length=16,
)
BAND = sa.Enum(
    "STABLE", "WATCH", "ALERT",
    name="band_enum", native_enum=False, create_constraint=True, length=16,
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("pw_hash", sa.String(length=128), nullable=False),
        sa.Column("role", ROLE, nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "patients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("caregiver_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("sex", sa.String(length=16), nullable=True),
        sa.Column("language", sa.String(length=8), nullable=False, server_default="en"),
        sa.Column("baseline_ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["caregiver_id"], ["users.id"],
            name=op.f("fk_patients_caregiver_id_users"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"],
            name=op.f("fk_patients_user_id_users"), ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_patients")),
        sa.UniqueConstraint("user_id", name=op.f("uq_patients_user_id")),
    )
    op.create_index(op.f("ix_patients_caregiver_id"), "patients", ["caregiver_id"])

    op.create_table(
        "daily_samples",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("audio_path", sa.String(length=512), nullable=True),
        sa.Column("video_path", sa.String(length=512), nullable=True),
        sa.Column("reaction_json", sa.JSON(), nullable=True),
        sa.Column("status", SAMPLE_STATUS, nullable=False, server_default="processing"),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["patients.id"],
            name=op.f("fk_daily_samples_patient_id_patients"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_daily_samples")),
    )
    op.create_index(op.f("ix_daily_samples_patient_id"), "daily_samples", ["patient_id"])
    op.create_index(op.f("ix_daily_samples_ts"), "daily_samples", ["ts"])

    op.create_table(
        "feature_vectors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sample_id", sa.Uuid(), nullable=False),
        sa.Column("modality", MODALITY, nullable=False),
        sa.Column("features_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["daily_samples.id"],
            name=op.f("fk_feature_vectors_sample_id_daily_samples"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feature_vectors")),
        sa.UniqueConstraint("sample_id", "modality", name="uq_feature_sample_modality"),
    )
    op.create_index(op.f("ix_feature_vectors_sample_id"), "feature_vectors", ["sample_id"])

    op.create_table(
        "baselines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("modality", MODALITY, nullable=False),
        sa.Column("mean_json", sa.JSON(), nullable=False),
        sa.Column("std_json", sa.JSON(), nullable=False),
        sa.Column("n_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["patients.id"],
            name=op.f("fk_baselines_patient_id_patients"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_baselines")),
        sa.UniqueConstraint("patient_id", "modality", name="uq_baseline_patient_modality"),
    )
    op.create_index(op.f("ix_baselines_patient_id"), "baselines", ["patient_id"])

    op.create_table(
        "scores",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("sample_id", sa.Uuid(), nullable=False),
        sa.Column("voice_dev", sa.Float(), nullable=False, server_default="0"),
        sa.Column("face_dev", sa.Float(), nullable=False, server_default="0"),
        sa.Column("reaction_dev", sa.Float(), nullable=False, server_default="0"),
        sa.Column("stability_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("band", BAND, nullable=False),
        sa.Column("reason", sa.String(length=256), nullable=True),
        sa.Column("modalities_flagged", sa.JSON(), nullable=True),
        sa.Column("z_scores_json", sa.JSON(), nullable=True),
        sa.Column("explanation_en", sa.Text(), nullable=True),
        sa.Column("explanation_hi", sa.Text(), nullable=True),
        sa.Column("baseline_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["patients.id"],
            name=op.f("fk_scores_patient_id_patients"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["sample_id"], ["daily_samples.id"],
            name=op.f("fk_scores_sample_id_daily_samples"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scores")),
        sa.UniqueConstraint("sample_id", name=op.f("uq_scores_sample_id")),
    )
    op.create_index(op.f("ix_scores_patient_id"), "scores", ["patient_id"])
    op.create_index(op.f("ix_scores_created_at"), "scores", ["created_at"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("score_id", sa.Uuid(), nullable=False),
        sa.Column("band", BAND, nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("explanation_hi", sa.Text(), nullable=True),
        sa.Column("whatsapp_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["patients.id"],
            name=op.f("fk_alerts_patient_id_patients"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["score_id"], ["scores.id"],
            name=op.f("fk_alerts_score_id_scores"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alerts")),
    )
    op.create_index(op.f("ix_alerts_patient_id"), "alerts", ["patient_id"])
    op.create_index(op.f("ix_alerts_created_at"), "alerts", ["created_at"])


def downgrade() -> None:
    op.drop_table("alerts")
    op.drop_table("scores")
    op.drop_table("baselines")
    op.drop_table("feature_vectors")
    op.drop_table("daily_samples")
    op.drop_table("patients")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
