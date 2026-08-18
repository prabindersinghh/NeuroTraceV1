"""Authentication: bcrypt hashing, JWT issue/verify, FastAPI dependencies + role guards."""
from .deps import CurrentUser, get_current_user, require_roles
from .jwt import TokenError, create_access_token, create_refresh_token, decode_token
from .password import hash_password, verify_password

__all__ = [
    "CurrentUser",
    "TokenError",
    "create_access_token",
    "create_refresh_token",
    "decode_token",
    "get_current_user",
    "hash_password",
    "require_roles",
    "verify_password",
]
