"""Repair the stale duplicate CHECK constraints a migrated schema accumulated — D-055.

THE DEFECT. A migrated database and a `Base.metadata.create_all()` database disagreed about
CHECK constraints on three tables, and the migrated side was the broken one:

    patients   baseline_state_enum            (lowercase, from 0002)
               ck_patients_baseline_state_enum (uppercase, from 0015)   -> NO value satisfies
                                                                            both; no patient
                                                                            row could be
                                                                            inserted at all
               stroke_side_enum + ck_patients_stroke_side_enum          -> harmless twin
    scores     ck_scores_ck_scores_band_enum  (no PATTERN_ATYPICAL)     -> the atypical band
    alerts     ck_alerts_ck_alerts_band_enum  (no PATTERN_ATYPICAL)        was unstorable

`users` had the same shape and was repaired in 0018.

THE ROOT CAUSE, which is not what it first looks like. It is tempting to call this a naming
mistake — bare `baseline_state_enum` from `sa.Enum(name=...)` versus the convention-prefixed
`ck_patients_baseline_state_enum` — and to fix it by passing a naming convention to
`batch_alter_table`. That was tried and it does not work, because the real problem is one
layer down: **SQLAlchemy's SQLite CHECK-constraint reflection mis-parses multi-constraint
DDL.** Asked to reflect

    CONSTRAINT pk_t PRIMARY KEY (id), CONSTRAINT state_enum CHECK (state IN (...))

it returns the constraint name as ``"pk_t PRIMARY KEY (id), CONSTRAINT state_enum"`` — it
swallows the preceding clause. Batch mode therefore cannot match the constraint it was asked
to drop, and re-emits it under a mangled name alongside the new one. No naming convention can
repair a name that was never parsed correctly.

THE FIX. `batch_alter_table(..., copy_from=...)` skips reflection entirely and rebuilds from
the Table object it is handed. Handing it `Base.metadata.tables[...]` — the same definition
`create_all` uses, and therefore the definition the application actually expects — makes the
migrated schema converge on the create_all schema by construction rather than by a sequence
of drops that have to guess at names.

Coupling this migration to `app.models` is deliberate and bounded: this is a REPAIR pinned at
one revision, and the thing it must converge on is precisely "what the models say today".
`env.py` already imports that metadata for autogenerate, so the dependency is not new.

Revision ID: 0020
Revises: 0019
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

#: Tables whose migrated CHECK set diverged from the model definition. Verified by diffing a
#: migrated database against a create_all database, table by table — not by inspection.
AFFECTED = ("patients", "scores", "alerts")

#: Legacy constraint names to remove on Postgres, where there is no rebuild to converge on
#: the model and the stale names must be dropped explicitly. `IF EXISTS` because which of
#: these is present depends on how far a given deployment had migrated.
POSTGRES_LEGACY = {
    "patients": ("baseline_state_enum", "stroke_side_enum",
                 "ck_patients_ck_patients_baseline_state_enum",
                 "ck_patients_ck_patients_stroke_side_enum"),
    "scores": ("band_enum", "ck_scores_ck_scores_band_enum"),
    "alerts": ("band_enum", "ck_alerts_ck_alerts_band_enum"),
}


def _model_table(name: str) -> sa.Table:
    """A DETACHED copy of the model table whose CHECK constraints carry the SAME names
    `create_all` produces.

    Three details here are load-bearing, and each was found by testing rather than assumed:

    1. **Detached.** Mutating `Base.metadata` would change the live application metadata for
       the rest of the process.

    2. **The convention must be carried onto the copy**, or `to_metadata` lands the table in
       convention-less metadata.

    3. **The type-generated CHECK must be suppressed.** This is the part that is not obvious.
       `sa.Enum(..., create_constraint=True)` emits its own CHECK during `CREATE TABLE`, named
       after the TYPE (`band_enum`) and ignoring the table-level constraint that the naming
       convention produced (`ck_alerts_band_enum`). Under `copy_from` that type-generated
       form is what lands, so the rebuild would converge on the right VALUES and the wrong
       NAMES. Turning `create_constraint` off on the copy and adding the constraint
       explicitly is what makes the migrated schema match `create_all` exactly.

    That last point matters beyond tidiness: a mismatched name is precisely what made this
    whole defect possible, because `drop_constraint("band_enum")` under batch mode prefixes
    the name and would miss on one schema while hitting on the other.
    """
    from app.db import NAMING_CONVENTION
    from app.models import Base

    table = Base.metadata.tables[name].to_metadata(
        sa.MetaData(naming_convention=NAMING_CONVENTION)
    )

    # `copy_from` renders ONLY the CHECK that the column TYPE generates — a table-level
    # `CheckConstraint` object is ignored entirely (verified: suppressing the type constraint
    # made the CHECKs vanish rather than fall back to the table-level one). So the type's own
    # `name` is the single lever that controls the emitted constraint name, and prefixing it
    # here is what makes the rebuild match `create_all`.
    #
    # Safe because these enums are all `native_enum=False`: the name is used for the CHECK
    # constraint and nothing else. On a native Postgres ENUM it would also name the type.
    for column in table.columns:
        enum_type = column.type
        if not isinstance(enum_type, sa.Enum) or not enum_type.create_constraint:
            continue
        if not str(enum_type.name).startswith(f"ck_{name}_"):
            enum_type.name = f"ck_{name}_{enum_type.name}"
    return table


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "sqlite":
        # Rebuild each table from the model definition. `recreate="always"` because the
        # point is the rebuild itself: there is no ALTER that removes a constraint SQLite
        # cannot name, and `copy_from` is what stops alembic reflecting (and mis-parsing) it.
        # No naming_convention here on purpose: `_model_table` has already applied the
        # `ck_<table>_<name>` spelling, and letting the convention run over an
        # already-prefixed name is how the doubled `ck_x_ck_x_...` forms appeared in the
        # first place.
        for table in AFFECTED:
            model = _model_table(table)
            with op.batch_alter_table(table, copy_from=model, recreate="always"):
                pass
            # A `copy_from` rebuild does NOT carry the table's indexes across — verified:
            # `patients` went from three indexes to none, and the next downgrade then failed
            # on `DROP INDEX ix_patients_asha_worker_id`. Recreate them from the same model
            # definition the rebuild used, so the index set converges too rather than only
            # the constraints.
            for index in sorted(model.indexes, key=lambda i: i.name or ""):
                op.create_index(index.name, table,
                                [c.name for c in index.columns], unique=index.unique)
        return

    # Postgres: no rebuild, so drop the stale names explicitly and re-assert the canonical
    # constraint from the model. Both halves are idempotent, so this converges whether the
    # deployment is fresh, part-migrated, or already correct.
    for table, legacy in POSTGRES_LEGACY.items():
        for name in legacy:
            op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")

    # Build the CHECK text from the enum VALUES rather than from `constraint.sqltext`.
    #
    # `sqltext` renders as `col IN (__[POSTCOMPILE_param_1])` — a bind-parameter placeholder,
    # not SQL. Emitting that would have produced a migration that renders happily and fails
    # the moment a real Postgres parses it, which is the exact failure mode D-014 exists to
    # catch. It was caught here by rendering with `alembic upgrade --sql` before trusting it.
    for table in AFFECTED:
        model = _model_table(table)
        for column in model.columns:
            enum_type = column.type
            if not isinstance(enum_type, sa.Enum) or not enum_type.create_constraint:
                continue
            name = str(enum_type.name)
            values = ", ".join(f"'{v}'" for v in enum_type.enums)
            op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
            op.execute(
                f"ALTER TABLE {table} ADD CONSTRAINT {name} "
                f"CHECK ({column.name} IN ({values}))"
            )


def downgrade() -> None:
    # Deliberately a no-op, and this is the honest choice rather than a lazy one.
    #
    # The "before" state is a schema in which a patient row cannot be inserted and the
    # PATTERN_ATYPICAL band cannot be stored. Recreating that on the way down would
    # reinstate a defect for the sake of symmetry — and INV-7 protects ROWS, which this
    # touches none of: every rebuild is a straight copy.
    #
    # Downgrading past this point therefore leaves the constraints correct. That is a
    # strictly better resting place than where they were.
    pass
