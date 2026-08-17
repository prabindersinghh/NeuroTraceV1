"""JWT access + refresh tokens (HS256 by default). Secret comes from .env only."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt

from ..config import settings

TokenType = Literal["access", "refresh"]


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired or of the wrong type."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _encode(subject: str, token_type: TokenType, expires: timedelta, extra: dict[str, Any]) -> str:
    issued = _now()
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": token_type,
        "iat": int(issued.timestamp()),
        "exp": int((issued + expires).timestamp()),
        "jti": uuid.uuid4().hex,
        **extra,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def access_token_lifetime() -> timedelta:
    return timedelta(minutes=settings.access_token_expire_minutes)


def refresh_token_lifetime() -> timedelta:
    return timedelta(days=settings.refresh_token_expire_days)


def create_access_token(subject: str | uuid.UUID, role: str, **extra: Any) -> str:
    return _encode(str(subject), "access", access_token_lifetime(), {"role": role, **extra})


def create_refresh_token(subject: str | uuid.UUID, role: str, **extra: Any) -> str:
    return _encode(str(subject), "refresh", refresh_token_lifetime(), {"role": role, **extra})


def decode_token(token: str, expected_type: TokenType | None = None) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token has expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("could not validate credentials") from exc

    if expected_type is not None and payload.get("typ") != expected_type:
        raise TokenError(f"expected a {expected_type} token")
    return payload
