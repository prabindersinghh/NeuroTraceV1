"""v2 exam schema — sessions, module results, deviations, questionnaires, vitals, audit

Replaces the v1-shaped capture tables (`daily_samples`, `feature_vectors`) with the
session/module model from TRD §3, rebuilds `baselines` around median+MAD, and adds the
domain F/G tables plus the safety and audit trails.

The old capture tables are dropped rather than migrated: their row shape (one sample with
three fixed modalities) cannot represent a twenty-module battery, and no production data
exists yet.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-19
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(*values: str, name: str) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False,
                   create_constraint=True, length=24)


SESSION_TYPE = _enum("daily", "weekly", "monthly", name="session_type_enum")
BAND = _enum("STABLE", "WATCH", "ALERT", name="band_enum")
BASELINE_STATE = _enum("not_started", "collecting", "locked", name="baseline_state_enum")
INSTRUMENT = _enum("PHQ2", "PHQ9", "EAT10", "FSS", "BARTHEL", name="instrument_enum")
STROKE_SIDE = _enum("left", "right", "bilateral", "unknown", name="stroke_side_enum")

# Batch mode on SQLite rebuilds the whole table from its reflected definition. Without the
# naming convention the reflected CHECK constraints come back unnamed, so they cannot be
# dropped, and the rebuilt table keeps a constraint referencing a column we just removed.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def _patients_v2() -> sa.Table:
    """The `patients` table exactly as this migration leaves it.

    Used as `copy_from` for the downgrade so SQLite's table rebuild works from a known
    definition instead of reflection.
    """
    return sa.Table(
        "patients", sa.MetaData(naming_convention=NAMING_CONVENTION),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("caregiver_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("sex", sa.String(length=16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clinician_id", sa.Uuid(), nullable=True),
        sa.Column("stroke_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stroke_side", STROKE_SIDE, nullable=False),
        sa.Column("enrolment_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("languages", sa.JSON(), nullable=True),
        sa.Column("preferred_hour", sa.Float(), nullable=True),
        sa.Column("education_band", sa.String(length=24), nullable=True),
        sa.Column("baseline_state", BASELINE_STATE, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_patients"),
        sa.UniqueConstraint("user_id", name="uq_patients_user_id"),
        sa.ForeignKeyConstraint(["caregiver_id"], ["users.id"],
                                name="fk_patients_caregiver_id_users", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"],
                                name="fk_patients_user_id_users", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["clinician_id"], ["users.id"],
                                name="fk_patients_clinician_id_users", ondelete="SET NULL"),
    )


def upgrade() -> None:
    # ---------------- drop the v1 capture and scoring tables ----------------
    op.drop_table("alerts")
    op.drop_table("scores")
    op.drop_table("baselines")
    op.drop_table("feature_vectors")
    op.drop_table("daily_samples")

    # ---------------- extend users and patients ----------------
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("lang", sa.String(length=8), nullable=False,
                                   server_default="en"))

    with op.batch_alter_table("patients") as batch:
        batch.add_column(sa.Column("clinician_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("stroke_date", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("stroke_side", STROKE_SIDE, nullable=False,
                                   server_default="unknown"))
        batch.add_column(sa.Column("enrolment_date", sa.DateTime(timezone=True),
                                   nullable=False, server_default=sa.func.now()))
        batch.add_column(sa.Column("languages", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("preferred_hour", sa.Float(), nullable=True))
        batch.add_column(sa.Column("education_band", sa.String(length=24), nullable=True))
        batch.add_column(sa.Column("baseline_state", BASELINE_STATE, nullable=False,
                                   server_default="not_started"))
        batch.create_foreign_key(op.f("fk_patients_clinician_id_users"), "users",
                                 ["clinician_id"], ["id"], ondelete="SET NULL")
        batch.drop_column("baseline_ready")
        # Superseded by `languages`: patients in this population are commonly
        # multilingual, and the order matters for which language the app speaks first.
        batch.drop_column("language")
    op.create_index(op.f("ix_patients_clinician_id"), "patients", ["clinician_id"])

    # ---------------- sessions ----------------
    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("type", SESSION_TYPE, nullable=False, server_default="daily"),
        sa.Column("device_info", sa.JSON(), nullable=True),
        sa.Column("quality_score", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("identity_verified", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("identity_score", sa.Float(), nullable=True),
        sa.Column("off_window", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("offline_captured", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_sessions_patient_id_patients"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessions")),
    )
    op.create_index(op.f("ix_sessions_patient_id"), "sessions", ["patient_id"])
    op.create_index(op.f("ix_sessions_ts"), "sessions", ["ts"])

    op.create_table(
        "module_results",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=8), nullable=False),
        sa.Column("domain", sa.String(length=32), nullable=False),
        sa.Column("features_json", sa.JSON(), nullable=False),
        sa.Column("quality_flag", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("quality_detail", sa.JSON(), nullable=True),
        sa.Column("extracted_on_device", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"],
                                name=op.f("fk_module_results_session_id_sessions"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_module_results")),
        sa.UniqueConstraint("session_id", "module_code", name="uq_module_result_session_code"),
    )
    op.create_index(op.f("ix_module_results_session_id"), "module_results", ["session_id"])

    # ---------------- baselines (median + MAD) ----------------
    op.create_table(
        "baselines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=8), nullable=False),
        sa.Column("median_json", sa.JSON(), nullable=False),
        sa.Column("mad_json", sa.JSON(), nullable=False),
        sa.Column("trajectory_json", sa.JSON(), nullable=True),
        sa.Column("n_sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("n_rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("n_discarded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("window_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("locked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.String(length=256), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_baselines_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_baselines")),
        sa.UniqueConstraint("patient_id", "module_code", name="uq_baseline_patient_module"),
    )
    op.create_index(op.f("ix_baselines_patient_id"), "baselines", ["patient_id"])

    # ---------------- deviations ----------------
    op.create_table(
        "deviations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("module_code", sa.String(length=8), nullable=False),
        sa.Column("domain", sa.String(length=32), nullable=False),
        sa.Column("rci_json", sa.JSON(), nullable=True),
        sa.Column("mean_abs_z", sa.Float(), nullable=False, server_default="0"),
        sa.Column("max_abs_z", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cusum_stat", sa.Float(), nullable=False, server_default="0"),
        sa.Column("cusum_alarm", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("improving", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("gateable", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("flagged", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"],
                                name=op.f("fk_deviations_session_id_sessions"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_deviations")),
        sa.UniqueConstraint("session_id", "module_code", name="uq_deviation_session_module"),
    )
    op.create_index(op.f("ix_deviations_session_id"), "deviations", ["session_id"])

    # ---------------- scores ----------------
    op.create_table(
        "scores",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("domain_devs_json", sa.JSON(), nullable=False),
        sa.Column("band", BAND, nullable=False),
        sa.Column("gate1_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("gate2_passed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("persistent_domains", sa.JSON(), nullable=True),
        sa.Column("drivers_json", sa.JSON(), nullable=True),
        sa.Column("confounders_json", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("improving", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.String(length=512), nullable=True),
        sa.Column("baseline_phase", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("explanation_en", sa.Text(), nullable=True),
        sa.Column("explanation_hi", sa.Text(), nullable=True),
        sa.Column("explanation_source", sa.String(length=16), nullable=False,
                  server_default="template"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_scores_patient_id_patients"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"],
                                name=op.f("fk_scores_session_id_sessions"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scores")),
        sa.UniqueConstraint("session_id", name=op.f("uq_scores_session_id")),
    )
    op.create_index(op.f("ix_scores_patient_id"), "scores", ["patient_id"])
    op.create_index(op.f("ix_scores_created_at"), "scores", ["created_at"])

    # ---------------- alerts ----------------
    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("score_id", sa.Uuid(), nullable=False),
        sa.Column("band", BAND, nullable=False),
        sa.Column("drivers_json", sa.JSON(), nullable=True),
        sa.Column("confounders_json", sa.JSON(), nullable=True),
        sa.Column("explanation_en", sa.Text(), nullable=False),
        sa.Column("explanation_hi", sa.Text(), nullable=True),
        sa.Column("clinician_line", sa.Text(), nullable=True),
        sa.Column("acknowledged_by", sa.Uuid(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_alerts_patient_id_patients"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"],
                                name=op.f("fk_alerts_score_id_scores"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["acknowledged_by"], ["users.id"],
                                name=op.f("fk_alerts_acknowledged_by_users"),
                                ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alerts")),
    )
    op.create_index(op.f("ix_alerts_patient_id"), "alerts", ["patient_id"])
    op.create_index(op.f("ix_alerts_created_at"), "alerts", ["created_at"])

    # ---------------- domain F / G ----------------
    op.create_table(
        "questionnaires",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("instrument", INSTRUMENT, nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("responses_json", sa.JSON(), nullable=True),
        sa.Column("flags_json", sa.JSON(), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_questionnaires_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"],
                                name=op.f("fk_questionnaires_session_id_sessions"),
                                ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_questionnaires")),
    )
    op.create_index(op.f("ix_questionnaires_patient_id"), "questionnaires", ["patient_id"])
    op.create_index(op.f("ix_questionnaires_ts"), "questionnaires", ["ts"])

    op.create_table(
        "vitals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("bp_sys", sa.Integer(), nullable=True),
        sa.Column("bp_dia", sa.Integer(), nullable=True),
        sa.Column("rhythm_flag", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("ppg_features_json", sa.JSON(), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_vitals_patient_id_patients"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"],
                                name=op.f("fk_vitals_session_id_sessions"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vitals")),
    )
    op.create_index(op.f("ix_vitals_patient_id"), "vitals", ["patient_id"])
    op.create_index(op.f("ix_vitals_ts"), "vitals", ["ts"])

    op.create_table(
        "adherence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("taken", sa.Boolean(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_adherence_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_adherence")),
    )
    op.create_index(op.f("ix_adherence_patient_id"), "adherence", ["patient_id"])
    op.create_index(op.f("ix_adherence_ts"), "adherence", ["ts"])

    # ---------------- safety and audit ----------------
    op.create_table(
        "safety_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("reported_by", sa.Uuid(), nullable=True),
        sa.Column("symptoms_json", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("escalated", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_safety_events_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reported_by"], ["users.id"],
                                name=op.f("fk_safety_events_reported_by_users"),
                                ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_safety_events")),
    )
    op.create_index(op.f("ix_safety_events_patient_id"), "safety_events", ["patient_id"])
    op.create_index(op.f("ix_safety_events_ts"), "safety_events", ["ts"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"],
                                name=op.f("fk_audit_log_actor_id_users"), ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_audit_log_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
    )
    op.create_index(op.f("ix_audit_log_actor_id"), "audit_log", ["actor_id"])
    op.create_index(op.f("ix_audit_log_patient_id"), "audit_log", ["patient_id"])
    op.create_index(op.f("ix_audit_log_ts"), "audit_log", ["ts"])


def downgrade() -> None:
    for table in ("audit_log", "safety_events", "adherence", "vitals", "questionnaires",
                  "alerts", "scores", "deviations", "baselines", "module_results", "sessions"):
        op.drop_table(table)

    # `copy_from` rather than reflection. SQLite batch mode rebuilds the table from its
    # definition, and reflection does not reliably recover the names of the enum CHECK
    # constraints — leaving the rebuilt table with a constraint that references a column
    # this downgrade is removing. Describing the current table explicitly avoids that
    # entirely, and is the documented approach for exactly this case.
    with op.batch_alter_table("patients", copy_from=_patients_v2(),
                              naming_convention=NAMING_CONVENTION) as batch:
        batch.add_column(sa.Column("baseline_ready", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))
        batch.add_column(sa.Column("language", sa.String(length=8), nullable=False,
                                   server_default="en"))
        for col in ("baseline_state", "education_band", "preferred_hour", "languages",
                    "enrolment_date", "stroke_side", "stroke_date", "clinician_id"):
            batch.drop_column(col)

    with op.batch_alter_table("users") as batch:
        batch.drop_column("lang")

    # Recreate the v1 capture tables so 0001 remains a valid target.
    op.create_table(
        "daily_samples",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("audio_path", sa.String(length=512), nullable=True),
        sa.Column("video_path", sa.String(length=512), nullable=True),
        sa.Column("reaction_json", sa.JSON(), nullable=True),
        sa.Column("status", _enum("processing", "done", name="sample_status_enum"),
                  nullable=False, server_default="processing"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_daily_samples_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_daily_samples")),
    )
    op.create_table(
        "feature_vectors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sample_id", sa.Uuid(), nullable=False),
        sa.Column("modality", _enum("voice", "face", "reaction", name="modality_enum"),
                  nullable=False),
        sa.Column("features_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["sample_id"], ["daily_samples.id"],
                                name=op.f("fk_feature_vectors_sample_id_daily_samples"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_feature_vectors")),
        sa.UniqueConstraint("sample_id", "modality", name="uq_feature_sample_modality"),
    )
    op.create_table(
        "baselines",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("modality", _enum("voice", "face", "reaction", name="modality_enum"),
                  nullable=False),
        sa.Column("mean_json", sa.JSON(), nullable=False),
        sa.Column("std_json", sa.JSON(), nullable=False),
        sa.Column("n_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ready", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_baselines_patient_id_patients"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_baselines")),
        sa.UniqueConstraint("patient_id", "modality", name="uq_baseline_patient_modality"),
    )
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
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_scores_patient_id_patients"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sample_id"], ["daily_samples.id"],
                                name=op.f("fk_scores_sample_id_daily_samples"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_scores")),
        sa.UniqueConstraint("sample_id", name=op.f("uq_scores_sample_id")),
    )
    op.create_table(
        "alerts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("score_id", sa.Uuid(), nullable=False),
        sa.Column("band", BAND, nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("explanation_hi", sa.Text(), nullable=True),
        sa.Column("whatsapp_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(),
                  nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"],
                                name=op.f("fk_alerts_patient_id_patients"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"],
                                name=op.f("fk_alerts_score_id_scores"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alerts")),
    )
