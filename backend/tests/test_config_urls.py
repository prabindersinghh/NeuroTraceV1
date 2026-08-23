"""The DATABASE_URL an operator pastes from a provider dashboard must simply work.

Neon, Heroku and RDS all hand out libpq-style URLs. asyncpg is not libpq: `sslmode` and
`channel_binding` are not arguments it accepts, and the failure they cause happens at
FIRST CONNECT — in production, at boot — not on any developer laptop. The validator
normalises; these pin exactly what it does, because a "helpful" URL rewriter that guesses
wrong is worse than none.
"""
from __future__ import annotations

from app.config import Settings


def _normalise(url: str) -> str:
    return Settings(database_url=url).database_url


def test_a_pasted_neon_url_becomes_asyncpg_safe():
    out = _normalise(
        "postgresql://u:p@ep-x-pooler.aws.neon.tech/neondb"
        "?channel_binding=require&sslmode=require"
    )
    assert out == "postgresql+asyncpg://u:p@ep-x-pooler.aws.neon.tech/neondb?ssl=require"


def test_sslmode_disable_is_dropped_not_upgraded():
    out = _normalise("postgresql://u:p@host/db?sslmode=disable")
    assert out == "postgresql+asyncpg://u:p@host/db"


def test_unrelated_query_params_survive():
    out = _normalise("postgresql://u:p@host/db?application_name=neurotrace&sslmode=require")
    assert "application_name=neurotrace" in out
    assert "ssl=require" in out
    assert "sslmode" not in out


def test_sqlite_urls_are_untouched_by_the_postgres_rules():
    assert _normalise("sqlite:///./x.sqlite3") == "sqlite+aiosqlite:///./x.sqlite3"
