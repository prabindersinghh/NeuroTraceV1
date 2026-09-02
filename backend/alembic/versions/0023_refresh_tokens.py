"""The refresh-token table: rotation, revocation and logout for JWT sessions.

PURELY ADDITIVE. One new table, no existing row touched (INV-7). Dialect-neutral by
construction — plain `op.create_table`, no raw SQL, no enum, so there is nothing for D-014's
portability scan to catch and nothing for a real Postgres to parse differently.

Revision ID: 0023
Revises: 0022
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("jti", sa.String(32), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("replaced_by_jti", sa.String(32)),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])
    op.create_index("ix_refresh_tokens_jti", "refresh_tokens", ["jti"], unique=True)


def downgrade() -> None:
    # Dropping this table signs everyone out at their next refresh and loses nothing a
    # person entered — it holds only token identifiers.
    op.drop_table("refresh_tokens")
