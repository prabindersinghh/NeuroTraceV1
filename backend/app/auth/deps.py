"""FastAPI auth dependencies: current_user + role guards."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import PatientClinicianLink, Patient, Role, User
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
    """Access rule: the owning caregiver, the linked patient account, or a LINKED clinician.

    "or any clinician" is what this used to say, and it meant it: `user.role is
    Role.clinician` granted access to every patient in the deployment. `Patient.clinician_id`
    existed and was never consulted for authorisation. So a clinician provisioned for one
    hospital could read every patient in the system — the roster query had the same hole
    (`select(Patient)` with no scoping).

    Part 3.2 closes it. An ACTIVE row in `patient_clinician_links` is now what grants a
    clinician access, and an unlinked one gets 403. Admins are deliberately not added here:
    the admin surface returns counts and audit events, never clinical rows (D-041).

    Part 4 narrows the clinician branch further: a link alone is not enough. C3
    (`CLINICIAN_SHARING`) must also currently be in force — see `clinician_may_access_
    patient` below. A link answers "is there a relationship"; consent answers "may it see
    data right now", and withdrawing the second must take effect even if nobody touches
    the first.
    """
    patient = await session.scalar(select(Patient).where(Patient.id == patient_id))
    if patient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Patient not found")

    allowed = (
        patient.caregiver_id == user.id
        or (patient.user_id is not None and patient.user_id == user.id)
    )
    if not allowed and user.role is Role.clinician:
        allowed = await clinician_may_access_patient(session, user.id, patient.id)
    if not allowed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to access this patient")
    return patient


async def clinician_is_linked(
    session: AsyncSession, clinician_id: uuid.UUID, patient_id: uuid.UUID,
) -> bool:
    """True when an ACTIVE link exists. `unlinked_at IS NULL` is what "active" means —
    links are revoked, never deleted, so the history of who could see whom survives."""
    found = await session.scalar(
        select(PatientClinicianLink.id).where(
            PatientClinicianLink.clinician_id == clinician_id,
            PatientClinicianLink.patient_id == patient_id,
            PatientClinicianLink.unlinked_at.is_(None),
        ).limit(1)
    )
    return found is not None


async def clinician_may_access_patient(
    session: AsyncSession, clinician_id: uuid.UUID, patient_id: uuid.UUID,
) -> bool:
    """Part 4: a link is necessary but not sufficient. `CLINICIAN_SHARING` (C3) must also
    currently be in force. This is the single place that combination is checked — every
    clinician-facing route that used to call `clinician_is_linked` directly now calls this
    instead, so a C3 withdrawal takes effect everywhere at once rather than needing every
    call site updated separately.
    """
    from ..models import ConsentType
    from ..services.consent import consent_currently_granted

    if not await clinician_is_linked(session, clinician_id, patient_id):
        return False
    return await consent_currently_granted(session, patient_id, ConsentType.CLINICIAN_SHARING)
