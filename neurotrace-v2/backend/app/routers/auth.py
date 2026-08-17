"""/auth — register, login, refresh, me. TRD §6."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import CurrentUser, require_roles
from ..auth.jwt import TokenError, access_token_lifetime, create_access_token, create_refresh_token, decode_token
from ..auth.password import hash_password, verify_password
from ..config import settings
from ..db import get_session
from ..models import Role, User
from ..schemas import AuthResponse, RefreshRequest, TokenPair, UserCreate, UserLogin, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

Session = Annotated[AsyncSession, Depends(get_session)]

_BAD_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
    headers={"WWW-Authenticate": "Bearer"},
)


def _issue(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(user.id, user.role.value),
        refresh_token=create_refresh_token(user.id, user.role.value),
        expires_in=int(access_token_lifetime().total_seconds()),
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, session: Session) -> AuthResponse:
    email = payload.email.lower().strip()
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
        await session.commit()
    except IntegrityError as exc:  # lost the race against a concurrent register
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists") from exc
    await session.refresh(user)
    return AuthResponse(user=UserRead.model_validate(user), tokens=_issue(user))


@router.post("/login", response_model=AuthResponse)
async def login(payload: UserLogin, session: Session) -> AuthResponse:
    email = payload.email.lower().strip()
    user = await session.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(payload.password, user.pw_hash):
        raise _BAD_CREDENTIALS
    return AuthResponse(user=UserRead.model_validate(user), tokens=_issue(user))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, session: Session) -> TokenPair:
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
        user_id = uuid.UUID(str(claims["sub"]))
    except (TokenError, ValueError, KeyError) as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            str(exc) or "Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return _issue(user)


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
