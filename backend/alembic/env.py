"""Alembic environment — async engine, URL and metadata pulled from the app."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection

from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings
from app.db import Base

# Import for the side effect of registering every table on Base.metadata.
from app import models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or settings.database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations on an engine WITHOUT foreign-key enforcement.

    Deliberately not `app.db.make_engine`. That one turns on `PRAGMA foreign_keys` so the
    app behaves like Postgres for ON DELETE CASCADE — correct at runtime, catastrophic
    here. SQLite cannot ALTER a constraint, so Alembic's batch mode rebuilds a table:
    copy it, move the rows, DROP THE ORIGINAL, rename. With enforcement on, dropping a
    PARENT table cascades the delete into every child.

    That is not hypothetical. Migration 0005 rebuilds `users` to widen the role
    constraint. Run with enforcement on, it took every patient, session, score and
    baseline with it and left a structurally valid, entirely empty database.

    SQLite's own default is enforcement OFF, which is exactly what a schema migration
    wants. Integrity is checked explicitly once the migration is done.
    """
    engine = create_async_engine(_url(), future=True)
    async with engine.connect() as connection:
        await connection.run_sync(_do_migrations)
    await engine.dispose()

    # The integrity re-check is a SQLite affair. PRAGMA is not SQL Postgres understands —
    # it raises PostgresSyntaxError — and Postgres does not need it anyway: it enforced
    # every foreign key throughout the migration, which is exactly what this re-check is
    # compensating for on SQLite. Running it unconditionally is what broke the Neon boot
    # one fix after `WHERE locked = 1`.
    if _url().startswith("sqlite"):
        checker = create_async_engine(_url(), future=True)
        async with checker.connect() as connection:
            await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            rows = list(await connection.exec_driver_sql("PRAGMA foreign_key_check"))
        await checker.dispose()
        if rows:
            raise RuntimeError(
                f"migration left {len(rows)} dangling foreign-key row(s): {rows[:5]}")


def run_migrations_sync_sqlite() -> None:
    """The SQLite path runs on the STDLIB driver, synchronously, on purpose.

    The async path hung the first Railway deploy: aiosqlite services every connection from
    a worker thread, and a thread still alive at interpreter shutdown stops the process
    exiting. `alembic upgrade head` printed its last migration and then simply never
    returned, so the `&&` in the start command never reached uvicorn and the deploy died
    at the healthcheck with nothing in the log — no traceback, no exit, no uvicorn banner.
    Locally (Windows dev) the same code exits by timing luck, which is why no test ever
    caught it.

    Migrations gain nothing from async — one connection, sequential DDL — so the sqlite
    branch uses the built-in sqlite3 driver: no threads, deterministic exit. Postgres
    stays on the async engine because asyncpg is the only Postgres driver installed.

    Foreign-key enforcement stays OFF during the migration for the reason documented on
    run_migrations_online(): batch mode drops parent tables, and enforcement ON turns
    that into a cascade that empties the database (migration 0005 did exactly that once).
    """
    from sqlalchemy import create_engine

    url = _url().replace("sqlite+aiosqlite://", "sqlite://", 1)
    engine = create_engine(url, future=True)
    with engine.connect() as connection:
        _do_migrations(connection)
    engine.dispose()

    checker = create_engine(url, future=True)
    with checker.connect() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        rows = list(connection.exec_driver_sql("PRAGMA foreign_key_check"))
    checker.dispose()
    if rows:
        raise RuntimeError(
            f"migration left {len(rows)} dangling foreign-key row(s): {rows[:5]}")


if context.is_offline_mode():
    run_migrations_offline()
elif _url().startswith("sqlite"):
    run_migrations_sync_sqlite()
else:
    asyncio.run(run_migrations_online())
