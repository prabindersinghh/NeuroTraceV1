"""The Alembic migration must produce exactly the schema the models describe.

Runs the real CLI (`python -m alembic upgrade head`) in a subprocess against a throwaway
SQLite file, then diffs the resulting tables/columns against Base.metadata.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.db import Base
from app import models  # noqa: F401  (registers tables)

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic(command: str, db_file: Path) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite+aiosqlite:///{db_file.as_posix()}",
        "JWT_SECRET": "migration-test-secret",
        "PYTHONPATH": str(BACKEND_DIR),
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", *command.split()],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def migrated_db(tmp_path: Path) -> Path:
    db_file = tmp_path / "migration_check.sqlite3"
    result = _alembic("upgrade head", db_file)
    assert result.returncode == 0, f"alembic upgrade failed:\n{result.stdout}\n{result.stderr}"
    return db_file


def _reflect(db_file: Path) -> dict[str, set[str]]:
    con = sqlite3.connect(db_file)
    try:
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {t: {row[1] for row in con.execute(f'PRAGMA table_info("{t}")')} for t in tables}
    finally:
        con.close()


def test_migration_creates_every_table_from_the_trd(migrated_db: Path):
    schema = _reflect(migrated_db)
    expected = {
        "users", "patients", "daily_samples", "feature_vectors",
        "baselines", "scores", "alerts",
    }
    assert expected <= set(schema)
    assert "alembic_version" in schema


def test_migration_columns_match_the_models(migrated_db: Path):
    schema = _reflect(migrated_db)
    for table in Base.metadata.sorted_tables:
        assert table.name in schema, f"missing table {table.name}"
        expected = {c.name for c in table.columns}
        assert expected == schema[table.name], (
            f"{table.name}: models={sorted(expected)} db={sorted(schema[table.name])}"
        )


def test_downgrade_removes_the_schema(migrated_db: Path):
    result = _alembic("downgrade base", migrated_db)
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    remaining = set(_reflect(migrated_db)) - {"alembic_version"}
    assert remaining == set()
