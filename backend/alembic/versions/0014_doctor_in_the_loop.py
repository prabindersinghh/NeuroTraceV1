"""Part 3: clinician profiles, doctor-patient links, baseline reviews.

PURELY ADDITIVE. Three new tables, no existing row touched, no constraint rewritten. Kept
separate from 0015 (which rewrites `baseline_state_enum`'s values) on purpose: splitting
them concentrates the risk in one small, reviewable migration instead of hiding a data
rewrite inside a larger additive one.

Backfill: every existing `patients.clinician_id` becomes an active row in
`patient_clinician_links`, so the access-scoping change that lands with this work does not
silently strip a clinician of a patient they legitimately had. `Patient.clinician_id` is
deliberately NOT dropped here — it stays for one release as a fallback while the link table
proves itself.

Revision ID: 0014
Revises: 0013
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

CLINICIAN_ROLES = ("TREATING_PHYSICIAN", "CONSULTING_NEUROLOGIST", "CLINICAL_REVIEWER")
VERIFICATION_STATUSES = ("SELF_DECLARED",)
REVIEW_ACTIONS = ("CONFIRM", "EXTEND", "FLAG_CONCERN")


def _enum(values: tuple[str, ...], name: str) -> sa.Enum:
    # native_enum=False to match the rest of the schema: VARCHAR + CHECK, so the same DDL
    # runs on SQLite and Postgres without a dialect branch (models.py header).
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True,
                   validate_strings=True, length=32)


def upgrade() -> None:
    op.create_table(
        "clinician_profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("qualification", sa.String(120)),
        sa.Column("registration_number", sa.String(64)),
        sa.Column("registering_authority", sa.String(160)),
        sa.Column("specialty", sa.String(120)),
        sa.Column("affiliation", sa.String(200)),
        sa.Column("contact", sa.String(200)),
        sa.Column("verification_status",
                  _enum(VERIFICATION_STATUSES, "verification_status_enum"),
                  nullable=False, server_default="SELF_DECLARED"),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", name="uq_clinician_profiles_user_id"),
    )
    op.create_index("ix_clinician_profiles_user_id", "clinician_profiles", ["user_id"])

    op.create_table(
        "patient_clinician_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("clinician_id", sa.Uuid(), nullable=False),
        sa.Column("clinician_role", _enum(CLINICIAN_ROLES, "clinician_role_enum"),
                  nullable=False),
        sa.Column("linked_by", sa.Uuid()),
        sa.Column("linked_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True)),
        sa.Column("unlinked_by", sa.Uuid()),
        sa.Column("unlink_reason", sa.String(400)),
        # Nullable in Part 3 by design. Part 4 owns backfilling it — see D-046.
        sa.Column("consent_ref", sa.String(64)),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["clinician_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["linked_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["unlinked_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_pcl_patient_active", "patient_clinician_links",
                    ["patient_id", "unlinked_at"])
    op.create_index("ix_pcl_clinician_active", "patient_clinician_links",
                    ["clinician_id", "unlinked_at"])

    op.create_table(
        "baseline_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("clinician_id", sa.Uuid()),
        sa.Column("action", _enum(REVIEW_ACTIONS, "baseline_review_action_enum"),
                  nullable=False),
        sa.Column("note", sa.String(2000)),
        sa.Column("baseline_snapshot_json", sa.JSON()),
        sa.Column("sessions_in_window", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("reviewed_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["clinician_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_baseline_reviews_patient_id", "baseline_reviews", ["patient_id"])
    op.create_index("ix_baseline_reviews_reviewed_at", "baseline_reviews", ["reviewed_at"])

    # Backfill: an existing clinician_id is an existing relationship. Access scoping lands
    # with this work, so without this a clinician would lose patients they already had.
    # TREATING_PHYSICIAN is the honest default — it is the role the single FK implied.
    # Portable on both dialects: plain INSERT ... SELECT, no dialect-specific syntax.
    op.execute(
        """
        INSERT INTO patient_clinician_links
            (id, patient_id, clinician_id, clinician_role, linked_at)
        SELECT
            lower(hex(randomblob(16))), id, clinician_id, 'TREATING_PHYSICIAN', CURRENT_TIMESTAMP
        FROM patients
        WHERE clinician_id IS NOT NULL
        """
        if op.get_bind().dialect.name == "sqlite"
        else
        """
        INSERT INTO patient_clinician_links
            (id, patient_id, clinician_id, clinician_role, linked_at)
        SELECT
            gen_random_uuid(), id, clinician_id, 'TREATING_PHYSICIAN', CURRENT_TIMESTAMP
        FROM patients
        WHERE clinician_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Additive only, so the reverse is a clean drop. `patients.clinician_id` was never
    # touched, so the pre-0014 relationship survives untouched (INV-7).
    op.drop_index("ix_baseline_reviews_reviewed_at", table_name="baseline_reviews")
    op.drop_index("ix_baseline_reviews_patient_id", table_name="baseline_reviews")
    op.drop_table("baseline_reviews")

    op.drop_index("ix_pcl_clinician_active", table_name="patient_clinician_links")
    op.drop_index("ix_pcl_patient_active", table_name="patient_clinician_links")
    op.drop_table("patient_clinician_links")

    op.drop_index("ix_clinician_profiles_user_id", table_name="clinician_profiles")
    op.drop_table("clinician_profiles")
