"""Migrations must be portable, and rendering them does not prove it.

`alembic upgrade --sql` renders literal SQL unchanged, so a SQLite-ism inside an
`op.execute("...")` string renders identically for Postgres and is only rejected when a
real Postgres parses it — i.e. at the first production boot, which is exactly where it
happened: migration 0004's `WHERE locked = 1` broke the Neon swap with
UndefinedFunctionError after running clean on SQLite for weeks.

These are text checks over the migration sources. Crude, but they run in milliseconds on
every commit and they catch the specific dialect traps this project has actually hit.

SCOPE MATTERS. The checks apply ONLY to raw SQL — the inside of `op.execute(...)` — not
to Python. A first version flagged `sa.DateTime(` as the SQLite `datetime(` function and
failed two innocent migrations; a guard that cries wolf gets deleted by whoever is trying
to ship. `_raw_sql_lines` is that narrowing, and `test_the_scanner_*` below pin it in both
directions.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

VERSIONS = sorted((Path(__file__).resolve().parents[1] / "alembic" / "versions").glob("0*.py"))

#: Booleans compared to integers. Valid SQLite, rejected by Postgres.
BOOL_AS_INT = re.compile(
    r"\b(locked|confirmed|enabled|completed|reviewed|is_\w+|\w+_flag)\s*=\s*[01]\b", re.I
)
#: Functions that exist in SQLite and not in Postgres. Word-boundary anchored so a
#: qualified Python call like `sa.DateTime(` can never match.
SQLITE_ONLY = re.compile(
    r"(?<![\w.])(datetime|strftime|julianday|ifnull|group_concat)\s*\(", re.I
)


def _raw_sql_lines(source: str) -> list[tuple[int, str]]:
    """Lines inside an `op.execute(...)` call, with SQL comments stripped.

    Tracked by paren depth from the `op.execute(` that opened the block, so a multi-line
    statement is covered in full and ordinary Python outside it is never scanned.
    """
    out: list[tuple[int, str]] = []
    depth = 0
    for i, line in enumerate(source.splitlines(), 1):
        opening = "op.execute(" in line
        if depth > 0 or opening:
            stripped = re.sub(r"--.*$", "", line)
            if not (opening and depth == 0 and stripped.strip() == "op.execute("):
                out.append((i, stripped))
        if opening and depth == 0:
            depth = line.count("(") - line.count(")")
        elif depth > 0:
            depth += line.count("(") - line.count(")")
        depth = max(depth, 0)
    return out


def test_migrations_exist():
    assert VERSIONS, "no migration files found — has the layout changed?"


@pytest.mark.parametrize("path", VERSIONS, ids=lambda p: p.name)
def test_no_boolean_compared_to_an_integer(path: Path):
    offenders = [
        f"{path.name}:{i}: {line.strip()}"
        for i, line in _raw_sql_lines(path.read_text(encoding="utf-8"))
        if BOOL_AS_INT.search(line)
    ]
    assert not offenders, (
        "boolean compared to an integer in raw SQL — Postgres rejects this; "
        "use `= true` / `= false`:\n  " + "\n  ".join(offenders)
    )


@pytest.mark.parametrize("path", VERSIONS, ids=lambda p: p.name)
def test_no_sqlite_only_functions(path: Path):
    offenders = [
        f"{path.name}:{i}: {line.strip()}"
        for i, line in _raw_sql_lines(path.read_text(encoding="utf-8"))
        if SQLITE_ONLY.search(line)
    ]
    assert not offenders, (
        "SQLite-only SQL function in raw SQL:\n  " + "\n  ".join(offenders)
    )


# ------------------------------------------------------------------ the scanner itself
# Narrowing a guard is the moment to test the guard. These are the exact distinctions it
# now rests on.

_REAL_BUG = '''
def upgrade():
    op.execute("""
        UPDATE baselines SET x = 1
         WHERE locked = 1 AND reference_locked_at IS NULL
    """)
'''

_INNOCENT_PYTHON = '''
def upgrade():
    op.add_column("t", sa.Column("ts", sa.DateTime(timezone=True), nullable=True))
    op.create_table("u", sa.Column("created_at", sa.DateTime(timezone=True)))
'''


def test_the_scanner_catches_a_real_dialect_bug():
    lines = _raw_sql_lines(_REAL_BUG)
    assert any(BOOL_AS_INT.search(l) for _, l in lines), "the 0004 bug would slip through"


def test_the_scanner_ignores_sqlalchemy_column_types():
    """`sa.DateTime(` is not the SQLite `datetime(` function, and is not even raw SQL."""
    lines = _raw_sql_lines(_INNOCENT_PYTHON)
    assert lines == [], "Python outside op.execute() must not be scanned at all"
    assert not SQLITE_ONLY.search("sa.DateTime(timezone=True)")
    assert SQLITE_ONLY.search("SELECT datetime('now')")


# ------------------------------------------------------- what the ORM writes vs the DB
def test_enum_columns_persist_member_values_not_names():
    """The ORM must write what the migrations' CHECK constraints accept.

    `sa.Enum` persists the member NAME by default. Every enum here has name == value
    except SessionType (`daily_pulse = "DAILY_PULSE"`), so the ORM wrote 'comprehensive'
    against a CHECK that migration 0012 had narrowed to the VALUES — every session insert
    on a migrated Postgres failed. SQLite hid it: create_all built the CHECK from the same
    names, so the schema agreed with itself and disagreed with production.
    """
    import sqlalchemy as sa
    from app.db import Base

    for table in Base.metadata.tables.values():
        for column in table.columns:
            if isinstance(column.type, sa.Enum) and column.type.enum_class:
                expected = [m.value for m in column.type.enum_class]
                assert list(column.type.enums) == expected, (
                    f"{table.name}.{column.name} persists names, not values"
                )
