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


#: The passwords that appear at the top of every breach corpus. Twenty-five is enough to
#: stop the guesses an attacker tries first; a full dictionary is a dependency and a
#: download, and bcrypt plus the login rate limit carry the rest.
_COMMON = frozenset({
    "password", "password1", "password123", "passw0rd", "12345678", "123456789",
    "1234567890", "qwerty123", "qwertyuiop", "11111111", "00000000", "iloveyou",
    "sunshine", "princess", "football", "baseball", "welcome1", "abc12345", "letmein1",
    "admin123", "monkey123", "dragon123", "neurotrace", "neurotrace1", "changeme",
})


def password_problem(password: str, email: str) -> str | None:
    """A plain-words reason this password is not acceptable, or None.

    Length is pydantic's job (min 8, max 128, on every schema that carries a password).
    This covers the two things a length rule cannot: a password that IS the identifier,
    and one that is in every attacker's first hundred guesses.
    """
    lowered = password.lower()
    email = email.lower().strip()
    if lowered == email or lowered == email.split("@", 1)[0]:
        return "Your password cannot be your email address"
    if lowered in _COMMON:
        return "That password is too common"
    return None
