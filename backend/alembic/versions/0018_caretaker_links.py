"""Caretaker role, the family link table, and the notification channel.

PURELY ADDITIVE apart from one constraint widening (`role_enum`), which is unavoidable
because roles are stored as VARCHAR + a named CHECK (`native_enum=False`) rather than a
native Postgres ENUM. Kept separate from 0019 (the `consent_type_enum` widening) on purpose:
splitting them concentrates each rewrite in one small reviewable migration instead of hiding
a second constraint change inside a table-creating one. Same discipline as 0014/0015.

PORTABILITY (D-014, and this repo has been bitten twice). Postgres drops a named constraint
in place; SQLite cannot and needs the table rebuilt. `batch_alter_table` is the one form that
expresses both. The constraint name passed to it is the **bare** name — batch mode applies
the `ck_%(table_name)s_%(constraint_name)s` naming convention itself, and passing the
rendered name produces a doubled prefix. 0003, 0012 and 0015 all hit that.

INV-7: no row is lost in either direction. The downgrade demotes caretakers rather than
deleting them — see the note there.

Revision ID: 0018
Revises: 0017
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

ROLE_CONSTRAINT = "role_enum"
WITHOUT_CARETAKER = ("patient", "caregiver", "clinician", "asha_worker", "admin")
WITH_CARETAKER = WITHOUT_CARETAKER + ("caretaker",)

RELATIONSHIPS = ("SON", "DAUGHTER", "SPOUSE", "SIBLING", "OTHER")
CHANNELS = ("WHATSAPP", "SMS", "EMAIL")


def _role_check(values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"role IN ({joined})"


def _enum(values: tuple[str, ...], name: str) -> sa.Enum:
    # native_enum=False to match the rest of the schema: VARCHAR + CHECK, so the same DDL
    # runs on SQLite and Postgres without a dialect branch (models.py header).
    return sa.Enum(*values, name=name, native_enum=False, create_constraint=True,
                   validate_strings=True, length=32)


def upgrade() -> None:
    # --- 1. widen the role set, and repair a STALE DUPLICATE that has been there since 0005 ---
    #
    # THE BUG, found by this migration's own test and verified against a real database:
    # on SQLite the `users` table carries TWO role CHECK constraints, not one.
    #
    #   ck_users_ck_users_role_enum  CHECK (role IN ('patient','caregiver','clinician'))
    #   ck_users_role_enum           CHECK (role IN (... all current roles ...))
    #
    # Both are enforced, so the effective rule is their AND — and an alembic-migrated SQLite
    # database has therefore been unable to create an `asha_worker`, `admin` OR `caretaker`
    # account since 0005. Confirmed by inserting each role: the first two succeed, the rest
    # fail on `ck_users_ck_users_role_enum`.
    #
    # WHERE THE DOUBLED NAME COMES FROM. `batch_alter_table` rebuilds the table on SQLite by
    # reflecting it first. Reflection returns the constraint under its RENDERED name
    # (`ck_users_role_enum`), and batch mode then applies the `ck_%(table_name)s_%(constraint_name)s`
    # convention to that already-rendered name — producing the doubled form, still carrying
    # the OLD value set, alongside the new correct one. It is the same trap 0003, 0012 and
    # 0015 hit, arriving from reflection rather than from a hand-passed name.
    #
    # WHY NOBODY NOTICED. The test fixtures build the schema with `Base.metadata.create_all()`,
    # not with alembic, so every functional test bypasses the migrated table entirely. Only
    # `test_migration.py` touches it, and until this change nothing there inserted a
    # privileged user.
    #
    # PRODUCTION IS UNAFFECTED. On Postgres, batch mode passes through to a plain
    # `ALTER TABLE ... DROP CONSTRAINT` with no rebuild and no reflection, so the duplicate
    # never forms — the rendered SQL for this migration shows a single `ck_users_role_enum`.
    # This repair is therefore SQLite-only, and guarded as such: attempting the drop on
    # Postgres would fail on a constraint that does not exist.
    is_sqlite = op.get_bind().dialect.name == "sqlite"
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(ROLE_CONSTRAINT, type_="check")
        if is_sqlite:
            # Passing the RENDERED name here is deliberate, not a slip: batch mode applies
            # the convention to it, which yields exactly the doubled name we need to drop.
            batch.drop_constraint("ck_users_role_enum", type_="check")
        batch.create_check_constraint(ROLE_CONSTRAINT, sa.text(_role_check(WITH_CARETAKER)))

    # --- 2. the family link: the access boundary itself ---
    op.create_table(
        "patient_caretaker_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("caretaker_id", sa.Uuid(), nullable=False),
        sa.Column("relationship", _enum(RELATIONSHIPS, "caretaker_relationship_enum"),
                  nullable=False),
        sa.Column("linked_by", sa.Uuid()),
        sa.Column("linked_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("unlinked_at", sa.DateTime(timezone=True)),
        sa.Column("unlinked_by", sa.Uuid()),
        sa.Column("unlink_reason", sa.String(400)),
        # Populated at creation, NOT nullable-then-backfilled. D-046 is the reason: Part 3
        # shipped links whose consent lived only in an audit event and needed a later
        # migration to reference it. The consent table already exists now.
        sa.Column("consent_ref", sa.String(64)),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["caretaker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["linked_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["unlinked_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_pcl_care_patient_active", "patient_caretaker_links",
                    ["patient_id", "unlinked_at"])
    op.create_index("ix_pcl_care_caretaker_active", "patient_caretaker_links",
                    ["caretaker_id", "unlinked_at"])

    # --- 3. the notification channel: health-adjacent PII ---
    # Scoped per patient as well as per caretaker so erasing one patient removes that
    # patient's channel without touching another's.
    op.create_table(
        "caretaker_channels",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("caretaker_id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("channel", _enum(CHANNELS, "notification_channel_enum"), nullable=False),
        sa.Column("destination", sa.String(190), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["caretaker_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_caretaker_channels_active", "caretaker_channels",
                    ["caretaker_id", "patient_id", "revoked_at"])


def downgrade() -> None:
    op.drop_index("ix_caretaker_channels_active", table_name="caretaker_channels")
    op.drop_table("caretaker_channels")

    op.drop_index("ix_pcl_care_caretaker_active", table_name="patient_caretaker_links")
    op.drop_index("ix_pcl_care_patient_active", table_name="patient_caretaker_links")
    op.drop_table("patient_caretaker_links")

    # Any caretaker would violate the narrowed constraint. DEMOTE rather than delete:
    # dropping the users would lose rows, which INV-7 forbids outright. `caregiver` is the
    # honest landing role — it is the family role that exists without this migration, and it
    # grants no access the account did not already have to its own patients.
    op.execute("UPDATE users SET role = 'caregiver' WHERE role = 'caretaker'")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(ROLE_CONSTRAINT, type_="check")
        batch.create_check_constraint(ROLE_CONSTRAINT,
                                      sa.text(_role_check(WITHOUT_CARETAKER)))
    # The stale duplicate dropped in `upgrade` is deliberately NOT recreated. INV-7 protects
    # ROWS, not broken constraints, and restoring a constraint that silently blocks three
    # legitimate roles would be reinstating a defect for the sake of symmetry.
