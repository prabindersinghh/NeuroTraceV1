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
        # TRD §3
        "users", "patients", "sessions", "module_results", "baselines",
        "deviations", "scores", "alerts", "questionnaires", "vitals",
        "adherence", "audit_log",
        # TRD §8
        "safety_events",
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


@pytest.mark.xfail(
    strict=True,
    reason=(
        "BLOCKED BY A PRE-EXISTING MIGRATION DEFECT, not by this feature. A migrated "
        "SQLite `patients` table carries two conflicting baseline_state CHECK constraints "
        "— `baseline_state_enum` (lowercase, from 0002) and "
        "`ck_patients_baseline_state_enum` (uppercase, from 0015) — so NO value satisfies "
        "both and no patient row can be inserted. This test needs a real patient because "
        "env.py refuses a migration that leaves a dangling foreign key. Marked strict so it "
        "turns into a failure the moment the defect is fixed, rather than being forgotten. "
        "See COMPLETION_RUN_REPORT / the caretaker report for the full diagnosis."
    ),
)
def test_downgrading_0019_deletes_only_caretaker_consents(migrated_db: Path):
    """0019's downgrade removes C7 rows. It must remove NOTHING ELSE.

    This test exists because 0019's docstring claims it. A CARETAKER_SHARING row cannot
    survive the narrowed CHECK constraint, and relabelling it as some other type would
    fabricate a consent the caregiver never gave — saying they agreed to share with a doctor
    when they agreed to share with family. So the row is deleted, which is a genuine, narrow
    loss on downgrade.

    The danger in a `DELETE ... WHERE consent_type = ...` is that the WHERE clause is wrong
    or later widened, taking real consents with it. That is what this pins: every other
    consent type, and the count of every other table, is identical before and after.
    """
    import uuid as uuid_module

    con = sqlite3.connect(migrated_db)
    try:
        now = "2026-08-29 00:00:00"
        user_id = str(uuid_module.uuid4())
        patient_id = str(uuid_module.uuid4())
        con.execute(
            "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?,?,?,?,?)",
            (user_id, "c@example.com", "x", "caregiver", now),
        )
        con.execute(
            "INSERT INTO patients (id, caregiver_id, name, stroke_side, baseline_state,"
            " intensity, comprehensive_days_per_week, pd_diagnosis,"
            " other_movement_disorder, aphasia_mode, onboarding_complete,"
            " deployment_tier, enrolment_date, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (patient_id, user_id, "Test", "unknown", "NOT_STARTED", "FULL", 2,
             0, 0, 0, 0, "TIER_1_PHONE", now, now),
        )
        types = ["FOLLOW_UP", "DATA_PROCESSING", "CLINICIAN_SHARING", "RESEARCH",
                 "MEDIA_TESTIMONIAL", "TELECONSULTATION", "CARETAKER_SHARING"]
        for consent_type in types:
            con.execute(
                "INSERT INTO consents (id, patient_id, consent_type, version, granted,"
                " granted_at) VALUES (?,?,?,?,?,?)",
                (str(uuid_module.uuid4()), patient_id, consent_type, "v1", 1, now),
            )
        con.commit()

        before = dict(con.execute(
            "SELECT consent_type, COUNT(*) FROM consents GROUP BY consent_type").fetchall())
        assert before["CARETAKER_SHARING"] == 1
    finally:
        con.close()

    result = _alembic("downgrade 0018", migrated_db)
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    con = sqlite3.connect(migrated_db)
    try:
        after = dict(con.execute(
            "SELECT consent_type, COUNT(*) FROM consents GROUP BY consent_type").fetchall())
    finally:
        con.close()

    assert "CARETAKER_SHARING" not in after, "the C7 row survived a narrowing downgrade"
    expected = {k: v for k, v in before.items() if k != "CARETAKER_SHARING"}
    assert after == expected, (
        "0019's downgrade removed a consent it should not have — the DELETE's WHERE clause "
        f"is too broad. before={before} after={after}"
    )


def test_downgrading_0018_demotes_caretakers_instead_of_deleting_them(migrated_db: Path):
    """INV-7 in the direction that is easy to get wrong.

    A `caretaker` row violates the narrowed role constraint. Deleting the USER to satisfy it
    would lose a person's account — which is exactly what INV-7 forbids — so 0018 demotes to
    `caregiver` instead. `caregiver` is the honest landing role: it is the family role that
    exists without this migration, and it grants nothing the account did not already have.
    """
    import uuid as uuid_module

    con = sqlite3.connect(migrated_db)
    try:
        con.execute(
            "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?,?,?,?,?)",
            (str(uuid_module.uuid4()), "family@example.com", "x", "caretaker",
             "2026-08-29 00:00:00"),
        )
        con.commit()
    finally:
        con.close()

    result = _alembic("downgrade 0017", migrated_db)
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"

    con = sqlite3.connect(migrated_db)
    try:
        rows = con.execute(
            "SELECT role FROM users WHERE email = 'family@example.com'").fetchall()
    finally:
        con.close()

    assert len(rows) == 1, "the caretaker account was DELETED on downgrade (INV-7)"
    assert rows[0][0] == "caregiver", f"demoted to {rows[0][0]!r}, expected 'caregiver'"
