"""Add the admin role to the role CHECK constraint.

Roles are stored as VARCHAR + a named CHECK (`native_enum=False`), not a native Postgres
ENUM — so widening the set means dropping and recreating the constraint, not
`ALTER TYPE ... ADD VALUE`.

PORTABILITY, which this repo has been bitten by twice (D-014). Postgres can drop a named
constraint in place; SQLite cannot, and needs the table rebuilt. `batch_alter_table` is the
one form that expresses both — it passes through to a plain ALTER on Postgres and rebuilds
on SQLite. Writing the raw ALTER would render identically for both dialects and fail only
on a real database, which is exactly the failure mode that broke the first Neon boot.

INV-7: a rebuild must not lose rows. `test_migration.py` asserts the user count and every
existing role survive this in both directions.

Revision ID: 0011
Revises: 0010
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

CONSTRAINT = "role_enum"
WITHOUT_ADMIN = ("patient", "caregiver", "clinician", "asha_worker")
WITH_ADMIN = WITHOUT_ADMIN + ("admin",)


def _check(values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"role IN ({joined})"


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(WITH_ADMIN)))


def downgrade() -> None:
    # Any admin would violate the narrowed constraint, so demote before shrinking it.
    # Dropping the users instead would lose rows, which INV-7 forbids outright.
    op.execute("UPDATE users SET role = 'clinician' WHERE role = 'admin'")
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(WITHOUT_ADMIN)))
