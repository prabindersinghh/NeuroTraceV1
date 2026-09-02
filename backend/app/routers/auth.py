"""/auth — register, login, refresh, logout, password, me. TRD §6."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import ratelimit
from ..auth.deps import CurrentUser, require_roles
from ..auth.jwt import (
    TokenError, access_token_lifetime, create_access_token, create_refresh_token,
    decode_token, refresh_token_lifetime,
)
from ..auth.password import hash_password, password_problem, verify_password
from ..config import settings
from ..db import get_session
from ..models import RefreshToken, Role, User
from ..schemas import (
    AuthResponse, PasswordChange, RefreshRequest, TokenPair, UserCreate, UserLogin, UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])

#: The only roles a stranger may assign themselves. Everything else sees data belonging to
#: someone other than the person signing up.
SELF_SERVICE_ROLES = frozenset({Role.caregiver, Role.patient})

Session = Annotated[AsyncSession, Depends(get_session)]

_BAD_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
    headers={"WWW-Authenticate": "Bearer"},
)
_BAD_REFRESH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Session has expired. Sign in again.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(ts: datetime) -> datetime:
    # SQLite hands back naive datetimes for DateTime(timezone=True); Postgres does not.
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


def _issue(user: User, session: AsyncSession) -> TokenPair:
    """Mint a pair and RECORD the refresh token. The caller commits."""
    jti = uuid.uuid4().hex
    now = _now()
    session.add(RefreshToken(
        user_id=user.id, jti=jti, issued_at=now, expires_at=now + refresh_token_lifetime(),
    ))
    return TokenPair(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=create_refresh_token(user.id, user.role.value, jti=jti),
        expires_in=int(access_token_lifetime().total_seconds()),
    )


async def _revoke_all(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, request: Request, session: Session) -> AuthResponse:
    if settings.auth_rate_limit:
        ratelimit.enforce(ratelimit.REGISTER_PER_IP, ratelimit.client_ip(request))

    # SELF-SERVICE ROLES ONLY.
    #
    # `role` arrives from the client, so before this check anyone could sign up as a
    # clinician and read /clinic/patients — which returns every patient's name and age
    # across all caregivers. The frontend only ever offered caregiver and patient, which is
    # precisely why this was invisible: INV-6 says the UI is never the boundary, and here
    # the UI was doing all the work.
    #
    # Privileged accounts are provisioned by an admin (`POST /admin/users`) or by the seed,
    # both server-side. Nobody grants themselves a role that can see other people's data.
    if payload.role not in SELF_SERVICE_ROLES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"The {payload.role.value} role is provisioned by an administrator, "
            "not through registration",
        )

    email = payload.email.lower().strip()
    if problem := password_problem(payload.password, email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)

    existing = await session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")

    user = User(
        email=email,
        pw_hash=hash_password(payload.password),
        role=payload.role,
        full_name=payload.full_name,
    )
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:  # lost the race against a concurrent register
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists") from exc
    tokens = _issue(user, session)
    await session.commit()
    await session.refresh(user)
    return AuthResponse(user=UserRead.model_validate(user), tokens=tokens)


@router.post("/login", response_model=AuthResponse)
async def login(payload: UserLogin, request: Request, session: Session) -> AuthResponse:
    email = payload.email.lower().strip()
    ip = ratelimit.client_ip(request)
    account_key = f"{ip}|{email}"
    if settings.auth_rate_limit:
        # Checked, not counted: only a FAILURE spends the budget, below.
        ratelimit.enforce(ratelimit.LOGIN_PER_IP, ip, record=False)
        ratelimit.enforce(ratelimit.LOGIN_PER_ACCOUNT, account_key, record=False)

    user = await session.scalar(select(User).where(User.email == email))
    # Always run the hash, so a missing account costs the same ~250 ms as a wrong password
    # and timing does not reveal which emails exist. Any real hash will do for the dummy.
    ok = verify_password(payload.password, user.pw_hash if user else _DUMMY_HASH)
    if user is None or not ok:
        if settings.auth_rate_limit:
            ratelimit.LOGIN_PER_IP.record(ip)
            ratelimit.LOGIN_PER_ACCOUNT.record(account_key)
        raise _BAD_CREDENTIALS
    ratelimit.LOGIN_PER_ACCOUNT.clear(account_key)
    tokens = _issue(user, session)
    await session.commit()
    return AuthResponse(user=UserRead.model_validate(user), tokens=tokens)


_DUMMY_HASH = hash_password("timing-equaliser-not-a-real-account")


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, request: Request, session: Session) -> TokenPair:
    if settings.auth_rate_limit:
        ratelimit.enforce(ratelimit.REFRESH_PER_IP, ratelimit.client_ip(request))
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
        user_id = uuid.UUID(str(claims["sub"]))
        jti = str(claims["jti"])
    except (TokenError, ValueError, KeyError) as exc:
        raise _BAD_REFRESH from exc

    row = await session.scalar(select(RefreshToken).where(RefreshToken.jti == jti))
    if row is None or _aware(row.expires_at) < _now():
        raise _BAD_REFRESH
    if row.revoked_at is not None:
        # A rotated-out token coming back means two parties hold this session — the
        # legitimate client and whoever copied it. Neither can be trusted; end the family.
        await _revoke_all(session, row.user_id)
        await session.commit()
        raise _BAD_REFRESH

    user = await session.get(User, user_id)
    if user is None or user.id != row.user_id:
        raise _BAD_REFRESH

    tokens = _issue(user, session)
    row.revoked_at = _now()
    row.replaced_by_jti = decode_token(tokens.refresh_token, expected_type="refresh")["jti"]
    await session.commit()
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def logout(payload: RefreshRequest, session: Session) -> Response:
    """Revoke a refresh token. The token IS the credential, so no bearer is required — and
    an unknown or expired token is 204 too, so the endpoint reveals nothing about which
    tokens exist. Idempotent: logging out twice is fine."""
    try:
        jti = str(decode_token(payload.refresh_token, expected_type="refresh")["jti"])
    except (TokenError, KeyError):
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.jti == jti, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_now())
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password", response_model=AuthResponse)
async def change_password(payload: PasswordChange, user: CurrentUser, session: Session) -> AuthResponse:
    """Signed-in password change. Every OTHER session is signed out (a password change is
    the one moment a person is certainly trying to lock someone out), and the caller gets a
    fresh pair so the device they are holding stays signed in."""
    if not verify_password(payload.current_password, user.pw_hash):
        raise _BAD_CREDENTIALS
    if problem := password_problem(payload.new_password, user.email):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    user.pw_hash = hash_password(payload.new_password)
    await _revoke_all(session, user.id)
    tokens = _issue(user, session)
    await session.commit()
    return AuthResponse(user=UserRead.model_validate(user), tokens=tokens)


@router.get("/me", response_model=UserRead)
async def me(user: CurrentUser) -> UserRead:
    return UserRead.model_validate(user)


@router.get("/clinician-check", response_model=UserRead)
async def clinician_check(
    user: Annotated[User, Depends(require_roles(Role.clinician, Role.caregiver))],
) -> UserRead:
    """Role-guarded probe: caregivers and clinicians only. Used by the role-guard test
    and by the frontend to confirm a session can open the dashboard."""
    return UserRead.model_validate(user)


@router.get("/config", tags=["meta"])
async def auth_config() -> dict:
    return {
        "access_token_expire_minutes": settings.access_token_expire_minutes,
        "refresh_token_expire_days": settings.refresh_token_expire_days,
        "roles": [r.value for r in Role],
    }
