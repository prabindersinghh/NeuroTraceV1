"""Shared pytest fixtures.

Tests run against SQLite (aiosqlite) so the suite needs no Postgres server; the models and
the Alembic migration are written to be dialect-neutral, and tests/test_migration.py proves
the migration and the models agree. Point TEST_DATABASE_URL at a Postgres database to run
the identical suite there.
"""
from __future__ import annotations

import os
import sys
from collections.abc import AsyncGenerator
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Per-PROCESS test database.
#
# Every pytest process gets its own SQLite file, keyed on PID. Two concurrent runs — a
# background full suite and a foreground single-file run, or the registry-guard hook firing
# while a suite is already going — previously shared one file, and the `engine` fixture
# drops and recreates the schema on every test. The result is "no such table: users" in
# whichever process loses the race.
#
# That has happened three times in this project. Each time it looked like a real failure
# and cost an investigation; once it was misdiagnosed as a conftest fixture bug. It also
# makes the INV-10 registry hook actively harmful, because a guard that emits spurious
# failures is a guard somebody switches off.
#
# `pytest-xdist` workers additionally get their own suffix, so this stays correct if the
# suite is ever parallelised.
_WORKER = os.environ.get("PYTEST_XDIST_WORKER", "")
_TEST_DB_FILE = (
    BACKEND_DIR / "tests" / f".pytest_neurotrace.{os.getpid()}{_WORKER}.sqlite3"
)

# Must be set before app.config is imported for the first time.
os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", f"sqlite+aiosqlite:///{_TEST_DB_FILE.as_posix()}"),
)
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-in-production-0123456789")
os.environ.setdefault("ENV", "test")
# The suite logs in hundreds of times from one client address; the limiter would lock it
# out by the second file. test_auth_hardening.py switches it on per test.
os.environ.setdefault("AUTH_RATE_LIMIT", "false")
os.environ.setdefault("SEED", "42")

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker  # noqa: E402

from app.config import apply_seed, settings  # noqa: E402
from app.db import Base, get_session, make_engine  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402
from app import models  # noqa: E402,F401  (registers the tables on Base.metadata)


@pytest.fixture(autouse=True)
def _seeded() -> int:
    """seed=42 everywhere (TRD §7)."""
    return apply_seed(settings.seed)


@pytest_asyncio.fixture
async def engine():
    if _TEST_DB_FILE.exists():
        try:
            _TEST_DB_FILE.unlink()
        except OSError:
            # Windows keeps the file locked while a pooled connection is open; the
            # drop_all/create_all below gives us a clean schema either way.
            pass
    eng = make_engine(settings.database_url)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield eng
    finally:
        async with eng.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await eng.dispose()


@pytest_asyncio.fixture
async def session(engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as s:
        yield s


@pytest_asyncio.fixture
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override() -> AsyncGenerator[AsyncSession, None]:
        async with maker() as s:
            yield s

    fastapi_app.dependency_overrides[get_session] = _override
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def provision(engine):
    """Create a privileged account the way production does — server-side.

    `/auth/register` refuses clinician / asha_worker / admin, because `role` comes from the
    client and a self-assigned clinician can read every patient's name. That is the fix, not
    an inconvenience, so tests must not route around it by calling the endpoint. This writes
    the row directly (as the seed and `POST /admin/users` do) and returns a bearer token.
    """
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.auth.password import hash_password
    from app.models import Role, User

    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _make(client, email: str, role: str, password: str = "correct-horse-battery"):
        async with maker() as s:
            s.add(User(email=email.lower(), pw_hash=hash_password(password),
                       role=Role(role), full_name=f"Test {role}"))
            await s.commit()
        resp = await client.post("/auth/login", json={"email": email, "password": password})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        return body["tokens"]["access_token"], body["user"]

    return _make
