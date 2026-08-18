"""FastAPI auth dependencies: current_user + role guards."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Patient, Role, User
from .jwt import TokenError, decode_token

bearer_scheme = HTTPBearer(auto_error=False, description="JWT access token")

_UNAUTHORIZED = dict(
    status_code=status.HTTP_401_UNAUTHORIZED,
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(detail="Not authenticated", **_UNAUTHORIZED)
    try:
        payload = decode_token(credentials.credentials, expected_type="access")
        user_id = uuid.UUID(str(payload["sub"]))
    except (TokenError, ValueError, KeyError) as exc:
        raise HTTPException(detail=str(exc) or "Invalid token", **_UNAUTHORIZED) from exc

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(detail="User no longer exists", **_UNAUTHORIZED)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role):
    """Dependency factory: `Depends(require_roles(Role.caregiver))`."""
    allowed = set(roles)

    async def _guard(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of: {', '.join(sorted(r.value for r in allowed))}",
            )
        return user

    return _guard


async def get_patient_for_user(
    patient_id: uuid.UUID,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Patient:
    """Access rule: the owning caregiver, the linked patient account, or any clinician."""
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")

    allowed = (
        user.role is Role.clinician
        or patient.caregiver_id == user.id
        or (patient.user_id is not None and patient.user_id == user.id)
    )
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to access this patient")
    return patient
