"""deployment tiers, wearable ingestion, fall events, and the ASHA worker role

ADDITIVE ONLY. No column is dropped, no column changes type, and no existing row loses
data. Two enum CHECK constraints widen (`role_enum` gains `asha_worker`), and every new
column on an existing table carries a server_default so existing rows remain valid.

What this adds:
  patients.deployment_tier   TIER_1_PHONE | TIER_2_WATCH | TIER_3_ASHA, default TIER_1_PHONE
  patients.asha_worker_id    FK -> users.id, nullable
  users.role                 gains 'asha_worker'
  wearable_data              vendor device readings we log and trend, never re-claim
  fall_events                device-reported falls, which bypass the scoring engine
  asha_visits                one household visit, idempotent on (worker, client_visit_id)

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

ROLE_OLD = sa.Enum("patient", "caregiver", "clinician", name="role_enum",
                   native_enum=False, create_constraint=True, length=24)
ROLE_NEW = sa.Enum("patient", "caregiver", "clinician", "asha_worker", name="role_enum",
                   native_enum=False, create_constraint=True, length=24)

TIER = sa.Enum("TIER_1_PHONE", "TIER_2_WATCH", "TIER_3_ASHA",
               name="deployment_tier_enum", native_enum=False, create_constraint=True,
               length=24)
METRIC = sa.Enum("heart_rate", "irregular_rhythm", "sleep_quality", "step_count", "spo2",
                 "blood_pressure_systolic", "blood_pressure_diastolic",
                 name="wearable_metric_enum", native_enum=False, create_constraint=True,
                 length=24)


def upgrade() -> None:
    # ---------------- role gains asha_worker ----------------
    with op.batch_alter_table("users", naming_convention=NAMING_CONVENTION) as batch:
        # See 0003: alter_column emits the CHECK drop-and-add itself.
        batch.alter_column("role", existing_type=ROLE_OLD, type_=ROLE_NEW,
                           existing_nullable=False)

    # ---------------- tier + ASHA assignment on the patient ----------------
    with op.batch_alter_table("patients") as batch:
        # Added as a plain string plus ONE explicitly named CHECK, rather than as a
        # constrained Enum. Passing the Enum here creates the check twice under two names
        # (its own `deployment_tier_enum`, and `ck_patients_...` from the naming
        # convention), and the downgrade then drops one and trips over the other.
        batch.add_column(sa.Column("deployment_tier", sa.String(24), nullable=False,
                                   server_default="TIER_1_PHONE"))
        batch.add_column(sa.Column("asha_worker_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_patients_asha_worker_id_users", "users",
                                 ["asha_worker_id"], ["id"], ondelete="SET NULL")
        # Bare name: NAMING_CONVENTION prefixes "ck_patients_" itself, so passing the
        # full name here produces ck_patients_ck_patients_deployment_tier_enum.
        batch.create_check_constraint(
            "deployment_tier_enum",
            sa.column("deployment_tier").in_(
                ["TIER_1_PHONE", "TIER_2_WATCH", "TIER_3_ASHA"]))
    op.create_index("ix_patients_asha_worker_id", "patients", ["asha_worker_id"])

    # ---------------- wearable readings ----------------
    op.create_table(
        "wearable_data",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("metric", METRIC, nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(24), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_wearable_data_patient_id", "wearable_data", ["patient_id"])
    op.create_index("ix_wearable_patient_metric_ts", "wearable_data",
                    ["patient_id", "metric", "ts"])

    # ---------------- fall events ----------------
    op.create_table(
        "fall_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("device_confidence", sa.Float(), nullable=True),
        sa.Column("dismissed_by_patient", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("caregiver_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_fall_events_patient_id", "fall_events", ["patient_id"])

    # ---------------- ASHA visits ----------------
    op.create_table(
        "asha_visits",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("asha_worker_id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("client_visit_id", sa.String(64), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=True),
        sa.Column("device_id", sa.String(128), nullable=True),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["asha_worker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="SET NULL"),
        # The idempotency guarantee that makes offline retry safe.
        sa.UniqueConstraint("asha_worker_id", "client_visit_id",
                            name="uq_asha_visit_worker_client"),
    )
    op.create_index("ix_asha_visits_asha_worker_id", "asha_visits", ["asha_worker_id"])
    op.create_index("ix_asha_visits_patient_id", "asha_visits", ["patient_id"])


def downgrade() -> None:
    op.drop_table("asha_visits")
    op.drop_table("fall_events")
    op.drop_table("wearable_data")

    op.drop_index("ix_patients_asha_worker_id", table_name="patients")

    # `copy_from` rather than reflection. SQLite cannot DROP COLUMN, so batch mode rebuilds
    # the table — and when it reflects, it carries the deployment_tier CHECK into the new
    # definition while the column is being dropped, which fails with "no such column".
    # Handing it an explicit table (the shape at revision 0004, plus the two columns being
    # removed, and no CHECK) is the documented way to stop it reflecting at all.
    patients_at_0005 = sa.Table(
        "patients", sa.MetaData(),
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("caregiver_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("sex", sa.String(16), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clinician_id", sa.Uuid(), nullable=True),
        sa.Column("stroke_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stroke_side", sa.String(24), nullable=False),
        sa.Column("enrolment_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("languages", sa.JSON(), nullable=True),
        sa.Column("preferred_hour", sa.Float(), nullable=True),
        sa.Column("education_band", sa.String(24), nullable=True),
        sa.Column("baseline_state", sa.String(24), nullable=False),
        sa.Column("pd_diagnosis", sa.Boolean(), nullable=False),
        sa.Column("other_movement_disorder", sa.Boolean(), nullable=False),
        sa.Column("deployment_tier", sa.String(24), nullable=False),
        sa.Column("asha_worker_id", sa.Uuid(), nullable=True),
    )
    with op.batch_alter_table("patients", copy_from=patients_at_0005) as batch:
        batch.drop_column("asha_worker_id")
        batch.drop_column("deployment_tier")

    # Any ASHA account has to become something the old constraint permits before it is
    # reinstated. Downgrading past this revision loses the distinction, which is why the
    # accounts are reported rather than silently rewritten.
    op.execute("UPDATE users SET role = 'caregiver' WHERE role = 'asha_worker'")
    with op.batch_alter_table("users", naming_convention=NAMING_CONVENTION) as batch:
        # See 0003: alter_column emits the CHECK drop-and-add itself.
        batch.alter_column("role", existing_type=ROLE_NEW, type_=ROLE_OLD,
                           existing_nullable=False)
