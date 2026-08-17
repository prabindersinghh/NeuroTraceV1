"""bcrypt password hashing (passlib), per TRD §1."""
from __future__ import annotations

from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# bcrypt truncates at 72 bytes; do it explicitly so long passwords never raise.
_BCRYPT_MAX_BYTES = 72


def _clamp(password: str) -> str:
    raw = password.encode("utf-8")
    if len(raw) <= _BCRYPT_MAX_BYTES:
        return password
    return raw[:_BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    return _pwd_context.hash(_clamp(password))


def verify_password(password: str, pw_hash: str) -> bool:
    try:
        return _pwd_context.verify(_clamp(password), pw_hash)
    except ValueError:
        # malformed / unknown hash -> treat as a failed login, never a 500
        return False
