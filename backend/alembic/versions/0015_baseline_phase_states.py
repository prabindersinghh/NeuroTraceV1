"""Part 3.3: baseline_state gains DOCTOR_REVIEW_PENDING and ABANDONED.

THIS IS THE RISKY ONE, AND IT IS ALONE ON PURPOSE. 0014 is purely additive; this migration
rewrites the values of every existing `patients.baseline_state` row and swaps a CHECK
constraint. Keeping them apart is what makes this one reviewable — merging them "for
tidiness" would bury a data rewrite inside a table-creation diff.

Values are renamed to uppercase at the same time, matching every other enum added since
(SessionType, Role, ClinicianRole). Mapping:

    not_started -> NOT_STARTED
    collecting  -> IN_PROGRESS          (what "collecting" always meant)
    locked      -> LOCKED
    (new)          DOCTOR_REVIEW_PENDING
    (new)          ABANDONED

PORTABILITY (D-014). `baseline_state` is VARCHAR + a named CHECK, not a native Postgres
ENUM, so this is a constraint swap plus an UPDATE — not `ALTER TYPE ... RENAME VALUE`.
`batch_alter_table` handles both dialects (0011/0012 are the proven precedent), and the
constraint name is the BARE one: db.py's naming_convention is
"ck_%(table_name)s_%(constraint_name)s" and batch mode applies it, so passing the rendered
name yields the doubled `ck_patients_ck_patients_...` that DEPLOY.md records 0003 hitting.

INV-7 — no rows lost, both directions. Widen the constraint first so old and new values may
briefly coexist during the UPDATE, rewrite, then narrow. Downgrade maps the two new states
onto the closest old meaning rather than dropping the rows:
  DOCTOR_REVIEW_PENDING -> collecting  (criteria met, not yet approved: still collecting)
  ABANDONED             -> not_started (invalidated; the old schema had no word for it)

Revision ID: 0015
Revises: 0014
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

CONSTRAINT = "baseline_state_enum"

OLD_VALUES = ("not_started", "collecting", "locked")
NEW_VALUES = ("NOT_STARTED", "IN_PROGRESS", "DOCTOR_REVIEW_PENDING", "LOCKED", "ABANDONED")

FORWARD = {"not_started": "NOT_STARTED", "collecting": "IN_PROGRESS", "locked": "LOCKED"}
BACKWARD = {
    "NOT_STARTED": "not_started",
    "IN_PROGRESS": "collecting",
    "LOCKED": "locked",
    "DOCTOR_REVIEW_PENDING": "collecting",
    "ABANDONED": "not_started",
}


def _check(values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"baseline_state IN ({joined})"


def upgrade() -> None:
    with op.batch_alter_table("patients") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(OLD_VALUES + NEW_VALUES)))

    for old, new in FORWARD.items():
        op.execute(f"UPDATE patients SET baseline_state = '{new}' WHERE baseline_state = '{old}'")

    with op.batch_alter_table("patients") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(NEW_VALUES)))


def downgrade() -> None:
    with op.batch_alter_table("patients") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(OLD_VALUES + NEW_VALUES)))

    for new, old in BACKWARD.items():
        op.execute(f"UPDATE patients SET baseline_state = '{old}' WHERE baseline_state = '{new}'")

    with op.batch_alter_table("patients") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(OLD_VALUES)))
