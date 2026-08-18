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

_TEST_DB_FILE = BACKEND_DIR / "tests" / ".pytest_neurotrace.sqlite3"

# Must be set before app.config is imported for the first time.
os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", f"sqlite+aiosqlite:///{_TEST_DB_FILE.as_posix()}"),
)
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-used-in-production-0123456789")
os.environ.setdefault("ENV", "test")
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
