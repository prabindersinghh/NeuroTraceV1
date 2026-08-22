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

    # Now verify, on a connection that DOES enforce, that nothing was left dangling.
    checker = create_async_engine(_url(), future=True)
    async with checker.connect() as connection:
        await connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        rows = list(await connection.exec_driver_sql("PRAGMA foreign_key_check"))
    await checker.dispose()
    if rows:
        raise RuntimeError(
            f"migration left {len(rows)} dangling foreign-key row(s): {rows[:5]}")


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
