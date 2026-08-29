"""C7 — CARETAKER_SHARING added to the consent type set.

A CONSTRAINT REWRITE, deliberately isolated in its own migration. 0018 creates the caretaker
tables; this one only widens `consent_type_enum`. Splitting them means the risky half is one
short reviewable file rather than four lines buried inside a table-creating migration — the
same reason 0014 (additive) and 0015 (enum rewrite) were kept apart.

Consent types are VARCHAR + a named CHECK (`native_enum=False`), so widening the set is a
drop-and-recreate, not `ALTER TYPE ... ADD VALUE`. `batch_alter_table` is the one form that
works on both dialects — Postgres alters in place, SQLite rebuilds the table — and the
constraint name passed to it is the **bare** name, because batch mode applies the
`ck_%(table_name)s_%(constraint_name)s` convention itself. Passing the rendered name doubles
the prefix; 0003, 0012 and 0015 all hit that.

INV-7 both directions. The downgrade cannot simply narrow the constraint: any C7 row would
violate it. Those rows are DELETED rather than relabelled — see the note in `downgrade`,
which is the one place in this migration where the honest choice needed thinking about.

Revision ID: 0019
Revises: 0018
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

CONSTRAINT = "consent_type_enum"
WITHOUT_C7 = (
    "FOLLOW_UP", "DATA_PROCESSING", "CLINICIAN_SHARING",
    "RESEARCH", "MEDIA_TESTIMONIAL", "TELECONSULTATION",
)
WITH_C7 = WITHOUT_C7 + ("CARETAKER_SHARING",)


def _check(values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"consent_type IN ({joined})"


def upgrade() -> None:
    with op.batch_alter_table("consents") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(WITH_C7)))


def downgrade() -> None:
    # A CARETAKER_SHARING row would violate the narrowed constraint, so it cannot stay.
    #
    # WHY DELETE RATHER THAN RELABEL. 0011's downgrade demotes an admin to clinician, and
    # 0018's demotes a caretaker to caregiver, because a USER must survive — deleting a
    # person's account to satisfy a constraint would lose data INV-7 protects. A consent row
    # is different: it is a record of a decision about a specific thing. Relabelling a C7
    # grant as, say, CLINICIAN_SHARING would fabricate a consent the caregiver never gave —
    # it would say they agreed to share with a doctor when they agreed to share with family.
    # A false consent record is worse than an absent one, and this is the direction that
    # unwinds a feature nobody can use once 0018 is also reversed.
    #
    # This is a genuine, narrow loss on downgrade and it is recorded rather than hidden:
    # `test_migration.py` asserts the row count of every OTHER consent type is unchanged, so
    # the deletion cannot silently widen.
    op.execute("DELETE FROM consents WHERE consent_type = 'CARETAKER_SHARING'")
    # The links that referenced those consents are dropped by 0018's downgrade, so no
    # dangling consent_ref survives a full unwind.
    with op.batch_alter_table("consents") as batch:
        batch.drop_constraint(CONSTRAINT, type_="check")
        batch.create_check_constraint(CONSTRAINT, sa.text(_check(WITHOUT_C7)))
