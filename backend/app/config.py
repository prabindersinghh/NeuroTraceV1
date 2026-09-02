"""Runtime settings. Everything secret comes from the environment / .env — never from code."""
from __future__ import annotations

import random
from functools import lru_cache
from pathlib import Path

import numpy as np
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- app ---
    app_name: str = "NeuroTrace API"
    env: str = "development"
    debug: bool = False
    seed: int = 42

    # --- database (async driver required) ---
    database_url: str = "postgresql+asyncpg://neurotrace:neurotrace@localhost:5432/neurotrace"

    # --- auth ---
    jwt_secret: str = "change-me-in-env-file"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    # Sliding-window limits on /auth/login, /auth/register and /auth/refresh. Off in the
    # test suite (conftest), which logs in hundreds of times from one client address.
    auth_rate_limit: bool = True

    # --- cors ---
    frontend_origin: str = "http://localhost:5173"

    # --- demo ---
    # Exposes POST /demo/seed without auth. Fine for the pitch build; turn it off for
    # anything holding real data.
    demo_mode: bool = True

    # --- Awaaz emergency caregiver delivery ---
    # Deliberately disabled unless both host and sender are configured. No mock transport
    # may report caregiver delivery as successful.
    emergency_smtp_host: str | None = None
    emergency_smtp_port: int = Field(default=587, ge=1, le=65535)
    emergency_smtp_from: str | None = None
    emergency_smtp_username: str | None = None
    emergency_smtp_password: str | None = None
    emergency_smtp_security: str = Field(default="starttls", pattern="^(starttls|ssl|none)$")
    emergency_smtp_timeout_seconds: float = Field(default=5.0, ge=1.0, le=15.0)

    # No media settings, deliberately.
    #
    # v1 accepted audio and video uploads and deleted them after extraction, which needed a
    # storage path, a size cap and a retention flag. v2 extracts on the device, so the
    # server never receives media at all. Removing the settings removes the possibility of
    # a deployment turning retention back on by accident.

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, v: str) -> str:
        if v.startswith("postgresql://"):
            # psycopg2-style URL handed to an async engine -> upgrade it silently
            v = v.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif v.startswith("sqlite://") and "+aiosqlite" not in v:
            v = v.replace("sqlite://", "sqlite+aiosqlite://", 1)

        if v.startswith("postgresql+asyncpg://") and "?" in v:
            # Providers hand out libpq-style URLs (Neon's dashboard, Heroku, RDS docs all
            # do). asyncpg is not libpq: `sslmode` and `channel_binding` are not connect
            # arguments it accepts, and SQLAlchemy forwards unknown query params straight
            # into asyncpg.connect(), which raises TypeError AT FIRST CONNECT — i.e. in
            # production, at boot, not on anyone's laptop. Normalise here so the value an
            # operator pastes verbatim from a provider dashboard simply works:
            #   sslmode=require|verify-*  ->  ssl=require   (asyncpg's spelling)
            #   sslmode=disable           ->  dropped       (asyncpg default is off)
            #   channel_binding=...       ->  dropped       (asyncpg negotiates SCRAM
            #                                                channel binding itself)
            from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

            parts = urlsplit(v)
            params = []
            for key, value in parse_qsl(parts.query):
                if key == "channel_binding":
                    continue
                if key == "sslmode":
                    if value != "disable":
                        params.append(("ssl", "require"))
                    continue
                params.append((key, value))
            v = urlunsplit(parts._replace(query=urlencode(params)))
        return v

    @model_validator(mode="after")
    def _refuse_a_dev_secret_outside_development(self) -> "Settings":
        # The default secret is in this file, so a deployment that never set JWT_SECRET is
        # signing every token with a value anyone can read on GitHub. Refusing to boot is
        # the only failure mode an operator cannot miss; a warning in the logs was already
        # the status quo and was never read.
        if self.env in ("development", "test"):
            return self
        if self.jwt_secret == "change-me-in-env-file" or len(self.jwt_secret) < 32:
            raise ValueError(
                f"JWT_SECRET is the development default or shorter than 32 characters "
                f"(ENV={self.env}). Set JWT_SECRET to a random value, e.g. "
                "`openssl rand -hex 32`, before running outside development."
            )
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


def apply_seed(seed: int | None = None) -> int:
    """Deterministic everywhere: seed=42 per TRD §7."""
    seed = get_settings().seed if seed is None else seed
    random.seed(seed)
    np.random.seed(seed)
    return seed


settings = get_settings()
