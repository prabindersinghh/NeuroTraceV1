"""Async SQLAlchemy engine / session / declarative base."""
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import MetaData, event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

# Deterministic constraint names so Alembic migrations are stable across dialects.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base for every NeuroTrace table."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def make_engine(url: str | None = None, **kwargs) -> AsyncEngine:
    url = url or settings.database_url
    opts: dict = {"echo": settings.debug, "future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        # SQLite has no real pool; pool_pre_ping is meaningless there.
        opts.pop("pool_pre_ping")
    opts.update(kwargs)
    engine = create_async_engine(url, **opts)

    if url.startswith("sqlite"):
        # SQLite ignores FOREIGN KEY ... ON DELETE CASCADE unless this pragma is set, so
        # without it a delete behaves differently here than on Postgres and tests would
        # pass against a laxer database than production.
        @event.listens_for(engine.sync_engine, "connect")
        def _enable_sqlite_fks(dbapi_connection, _record):  # pragma: no cover - driver hook
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine: AsyncEngine = make_engine()
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: one session per request, rolled back on error."""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
