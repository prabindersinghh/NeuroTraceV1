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
from app.models import Role

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


def test_freshly_migrated_database_accepts_every_model_role(migrated_db: Path):
    """Column parity misses stale CHECK constraints; exercise every value the ORM emits."""
    con = sqlite3.connect(migrated_db)
    try:
        for index, role in enumerate(Role):
            con.execute(
                "INSERT INTO users (id, email, pw_hash, role) VALUES (?, ?, ?, ?)",
                (f"{index + 1:032x}", f"role-{role.value}@example.test", "not-a-real-hash", role.value),
            )
        con.commit()
    finally:
        con.close()


def test_downgrade_removes_the_schema(migrated_db: Path):
    result = _alembic("downgrade base", migrated_db)
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    remaining = set(_reflect(migrated_db)) - {"alembic_version"}
    assert remaining == set()


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


def test_the_migrated_schema_matches_create_all(migrated_db: Path):
    """D-055's regression guard: the migrated schema and the `create_all` schema must agree
    on every CHECK constraint, on every table.

    This is the check that did not exist, and its absence is why three tables drifted
    unnoticed for months. Every functional test builds the schema with
    `Base.metadata.create_all()`, so the migrated path was never compared against it — and
    the divergence was not cosmetic: `patients` could not accept ANY `baseline_state`,
    `scores` and `alerts` could not store `PATTERN_ATYPICAL`, and `users` could not hold an
    `asha_worker`, `admin` or `caretaker`.

    Compares NAMES as well as presence. A constraint that is right in substance but differs
    in name is exactly what enabled the bug: `drop_constraint("band_enum")` under batch mode
    prefixes the name, so it hits on one schema and misses on the other.

    And compares the VALUE SET inside each CHECK, which the first version of this test did
    not. That omission cost a production outage: `sessions.session_type` carried a
    correctly-NAMED constraint on both schemas holding DIFFERENT values — migration 0012
    wrote `'DAILY_PULSE'` while `create_all` wrote `'daily_pulse'`, because `SessionType` is
    the one enum whose member name differs from its value and SQLAlchemy constrains on the
    name unless told otherwise. Every test passed and the deployed API could not create a
    single session. D-057.
    """
    import asyncio
    import re

    from sqlalchemy import MetaData
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.models import Base

    created = migrated_db.parent / "created_check.sqlite3"

    async def build() -> None:
        eng = create_async_engine(f"sqlite+aiosqlite:///{created.as_posix()}")
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await eng.dispose()

    asyncio.run(build())

    def checks(db: Path) -> dict[str, set[tuple[str, tuple[str, ...]]]]:
        """{table: {(constraint_name, sorted allowed values)}}.

        The value set is half the point: a name-only comparison passes a constraint that is
        correctly named and enforces the wrong strings, which is exactly D-057.
        """
        con = sqlite3.connect(db)
        try:
            out = {}
            for name, sql in con.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL"
            ):
                if name.startswith("sqlite_") or name == "alembic_version":
                    continue
                out[name] = {
                    (cname, tuple(sorted(re.findall(r"'([^']*)'", body))))
                    for cname, body in re.findall(
                        r"CONSTRAINT\s+(\w+)\s+CHECK\s*\((.*?)\)\s*(?=,\s*CONSTRAINT|\)\s*$|$)",
                        sql or "", re.S)
                }
            return out
        finally:
            con.close()

    mig, cre = checks(migrated_db), checks(created)
    drift = {
        table: {"migrated_only": sorted(mig.get(table, set()) - cre.get(table, set())),
                "create_all_only": sorted(cre.get(table, set()) - mig.get(table, set()))}
        for table in sorted(set(mig) | set(cre))
        if mig.get(table, set()) != cre.get(table, set())
    }
    assert drift == {}, (
        "the migrated schema and the create_all schema disagree about CHECK constraints. "
        "That divergence is D-055, and it made three tables partly or wholly "
        f"un-insertable.\n{drift}"
    )


def test_every_role_and_band_is_insertable_after_migration(migrated_db: Path):
    """The behavioural half of D-055, asserted on the MIGRATED schema.

    A constraint diff can look clean and still be wrong, so this inserts the values that
    were actually blocked: three roles, four baseline states, and the PATTERN_ATYPICAL band
    in both tables that carry it.
    """
    import uuid as uuid_module

    con = sqlite3.connect(migrated_db)
    try:
        now = "2026-08-29 00:00:00"
        for role in ("caregiver", "clinician", "asha_worker", "admin", "caretaker"):
            con.execute(
                "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?,?,?,?,?)",
                (str(uuid_module.uuid4()), f"{role}@example.com", "h", role, now),
            )

        owner = str(uuid_module.uuid4())
        con.execute(
            "INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?,?,?,?,?)",
            (owner, "owner@example.com", "h", "caregiver", now),
        )
        for state in ("NOT_STARTED", "IN_PROGRESS", "DOCTOR_REVIEW_PENDING",
                      "LOCKED", "ABANDONED"):
            con.execute(
                "INSERT INTO patients (id, caregiver_id, name, stroke_side, baseline_state,"
                " intensity, comprehensive_days_per_week, pd_diagnosis,"
                " other_movement_disorder, aphasia_mode, onboarding_complete,"
                " deployment_tier, enrolment_date, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (str(uuid_module.uuid4()), owner, "T", "unknown", state, "FULL", 2,
                 0, 0, 0, 0, "TIER_1_PHONE", now, now),
            )

        # PATTERN_ATYPICAL is the band that keeps a Parkinson's patient out of the stroke
        # alert path (INV-2). It was unstorable on a migrated database.
        for band in ("STABLE", "WATCH", "ALERT", "PATTERN_ATYPICAL"):
            patient = str(uuid_module.uuid4())
            session_id = str(uuid_module.uuid4())
            con.execute(
                "INSERT INTO sessions (id, patient_id, ts, type, quality_score,"
                " identity_verified, off_window, completed, offline_captured, is_practice)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (session_id, patient, now, "DAILY_PULSE", 1.0, 1, 0, 0, 0, 0),
            )
            con.execute(
                "INSERT INTO scores (id, patient_id, session_id, domain_devs_json, band,"
                " gate1_passed, gate2_passed, gate3_passed, symmetric_pattern,"
                " cumulative_drift, drift_flagged, confidence, improving, baseline_phase,"
                " explanation_source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (str(uuid_module.uuid4()), patient, session_id, "{}", band,
                 0, 0, 0, 0, 0.0, 0, 1.0, 0, 0, "template", now),
            )
            con.execute(
                "INSERT INTO alerts (id, patient_id, score_id, band, explanation_en,"
                " created_at) VALUES (?,?,?,?,?,?)",
                (str(uuid_module.uuid4()), patient, str(uuid_module.uuid4()), band, "x", now),
            )
        con.commit()
    finally:
        con.close()
