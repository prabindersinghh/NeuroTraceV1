"""laterality gate, PD exclusions, and the PATTERN_ATYPICAL band

Closes a clinical hole in Gate 2. Parkinson's disease degrades face, movement and voice
*simultaneously and symmetrically*, so under persistence + cross-modality alone a PD
patient would trip three domains at once and produce this system's highest-confidence
ALERT — for a condition it does not monitor and cannot help with.

The discriminator is anatomy: stroke is lateralised, Parkinson's is symmetric. This
migration adds the columns that record and persist that distinction:

- `deviations.lateral_abs_z` / `.lateralised` — per-module asymmetry deviation
- `scores.gate3_passed` / `.lateralised_domains` / `.symmetric_pattern`
- `patients.pd_diagnosis` / `.other_movement_disorder` — enrolment exclusions
- `PATTERN_ATYPICAL` added to the band enum

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-21
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

BAND_OLD = sa.Enum("STABLE", "WATCH", "ALERT", name="band_enum",
                   native_enum=False, create_constraint=True, length=24)
BAND_NEW = sa.Enum("STABLE", "WATCH", "ALERT", "PATTERN_ATYPICAL", name="band_enum",
                   native_enum=False, create_constraint=True, length=24)


def upgrade() -> None:
    # ---------------- per-module laterality ----------------
    with op.batch_alter_table("deviations") as batch:
        batch.add_column(sa.Column("lateral_abs_z", sa.Float(), nullable=False,
                                   server_default="0"))
        batch.add_column(sa.Column("lateralised", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))

    # ---------------- gate 3 on the score ----------------
    with op.batch_alter_table("scores") as batch:
        batch.add_column(sa.Column("gate3_passed", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))
        batch.add_column(sa.Column("lateralised_domains", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("symmetric_pattern", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))

    # ---------------- enrolment exclusions ----------------
    with op.batch_alter_table("patients") as batch:
        batch.add_column(sa.Column("pd_diagnosis", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))
        batch.add_column(sa.Column("other_movement_disorder", sa.Boolean(), nullable=False,
                                   server_default=sa.false()))

    # ---------------- widen the band enum ----------------
    # The CHECK constraint enumerates the permitted values, so adding a band means
    # replacing it on both tables that carry one.
    for table in ("scores", "alerts"):
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            # No explicit drop. `alter_column` with a changed Enum already emits the
            # DROP + ADD for the CHECK, and adding our own drop on top was both redundant
            # and wrong: passing an already-prefixed name into a naming convention that
            # prefixes again produced ck_scores_ck_scores_band_enum, which does not exist.
            # SQLite hid it (batch mode rebuilds the table instead of issuing the DROP);
            # Postgres would have failed hard on the first deploy.
            batch.alter_column("band", existing_type=BAND_OLD, type_=BAND_NEW,
                               existing_nullable=False)


def downgrade() -> None:
    # Any row already carrying the new band has to be moved to a value the old constraint
    # permits. WATCH is the honest target: PATTERN_ATYPICAL means "something is changing,
    # but not focally", which is what WATCH conveys in the narrower vocabulary.
    op.execute("UPDATE scores SET band = 'WATCH' WHERE band = 'PATTERN_ATYPICAL'")
    op.execute("UPDATE alerts SET band = 'WATCH' WHERE band = 'PATTERN_ATYPICAL'")

    for table in ("scores", "alerts"):
        with op.batch_alter_table(table, naming_convention=NAMING_CONVENTION) as batch:
            # No explicit drop. `alter_column` with a changed Enum already emits the
            # DROP + ADD for the CHECK, and adding our own drop on top was both redundant
            # and wrong: passing an already-prefixed name into a naming convention that
            # prefixes again produced ck_scores_ck_scores_band_enum, which does not exist.
            # SQLite hid it (batch mode rebuilds the table instead of issuing the DROP);
            # Postgres would have failed hard on the first deploy.
            batch.alter_column("band", existing_type=BAND_NEW, type_=BAND_OLD,
                               existing_nullable=False)

    with op.batch_alter_table("patients") as batch:
        batch.drop_column("other_movement_disorder")
        batch.drop_column("pd_diagnosis")

    with op.batch_alter_table("scores") as batch:
        batch.drop_column("symmetric_pattern")
        batch.drop_column("lateralised_domains")
        batch.drop_column("gate3_passed")

    with op.batch_alter_table("deviations") as batch:
        batch.drop_column("lateralised")
        batch.drop_column("lateral_abs_z")
