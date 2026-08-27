"""Repair stale user-role checks left by the earlier enum widenings.

Revisions 0005 and 0011 added ``asha_worker`` and ``admin`` respectively. On SQLite,
Alembic's reflected batch naming prefixed the original role check a second time instead of
replacing it. The table therefore carried both the new check and the original three-role
check, so a freshly migrated database rejected the new roles at runtime.

This migration discovers every check that constrains ``users.role``, removes all of them,
and installs one canonical check matching the model enum. Discovery also makes the repair
safe on Postgres databases whose constraint names did not take the SQLite double-prefix.

Revision ID: 0012
Revises: 0011
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

WITHOUT_ADMIN = ("patient", "caregiver", "clinician", "asha_worker")
WITH_ADMIN = WITHOUT_ADMIN + ("admin",)


def _role_check_names() -> list[str]:
    checks = sa.inspect(op.get_bind()).get_check_constraints("users")
    return [
        str(check["name"])
        for check in checks
        if check.get("name") and "role" in str(check.get("sqltext") or "").lower()
    ]


def _replace_role_checks(values: tuple[str, ...]) -> None:
    names = _role_check_names()
    expression = sa.column("role").in_(values)
    with op.batch_alter_table("users") as batch:
        for name in names:
            # ``op.f`` marks the reflected database name as already formatted. Without
            # it, the metadata convention prefixes an existing ``ck_users_...`` name
            # again while the SQLite batch table is being rebuilt.
            batch.drop_constraint(op.f(name), type_="check")
        batch.create_check_constraint(op.f("ck_users_role_enum"), expression)


def upgrade() -> None:
    _replace_role_checks(WITH_ADMIN)


def downgrade() -> None:
    # Preserve every account while narrowing the allowed set.
    op.execute("UPDATE users SET role = 'clinician' WHERE role = 'admin'")
    _replace_role_checks(WITHOUT_ADMIN)
