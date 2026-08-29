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


#: 0002 created this constraint through `sa.Enum(name="baseline_state_enum")` inside
#: `op.create_table`. A standalone `sa.Enum` is not attached to `Base.metadata`, so the
#: `ck_%(table_name)s_%(constraint_name)s` convention never applied and the constraint landed
#: under the BARE name. `batch_alter_table` DOES apply the convention, so the original
#: `drop_constraint("baseline_state_enum")` here resolved to `ck_patients_baseline_state_enum`
#: — a name that has never existed on either dialect.
#:
#: On Postgres that renders `ALTER TABLE patients DROP CONSTRAINT ck_patients_baseline_state_enum`
#: and FAILS the migration outright. That is the deploy blocker this fix removes: both
#: candidate names are dropped, tolerantly, so the statement cannot trip over a phantom.
#: See D-055.
CANDIDATE_NAMES = ("baseline_state_enum", "ck_patients_baseline_state_enum")


def _reset_check(values: tuple[str, ...]) -> None:
    """Drop whichever spelling of the constraint is actually present, then add the wanted one.

    Postgres only. SQLite cannot drop a CHECK in place, and its reflection mis-parses the
    name (D-055), so the SQLite path skips constraint work entirely and 0020 rebuilds the
    table from the model definition instead — which is the only mechanism that reliably
    converges there.
    """
    for name in CANDIDATE_NAMES:
        op.execute(f"ALTER TABLE patients DROP CONSTRAINT IF EXISTS {name}")
    op.execute(
        f"ALTER TABLE patients ADD CONSTRAINT ck_patients_baseline_state_enum "
        f"CHECK ({_check(values)})"
    )


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    # Widen first so the rows can be rewritten, then narrow. On SQLite the constraint is
    # left alone here and normalised by 0020; the UPDATE below is what this migration is
    # really for, and it is dialect-independent.
    if _is_postgres():
        _reset_check(OLD_VALUES + NEW_VALUES)

    for old, new in FORWARD.items():
        op.execute(f"UPDATE patients SET baseline_state = '{new}' WHERE baseline_state = '{old}'")

    if _is_postgres():
        _reset_check(NEW_VALUES)


def downgrade() -> None:
    if _is_postgres():
        _reset_check(OLD_VALUES + NEW_VALUES)

    for new, old in BACKWARD.items():
        op.execute(f"UPDATE patients SET baseline_state = '{old}' WHERE baseline_state = '{new}'")

    if _is_postgres():
        _reset_check(OLD_VALUES)
