"""/admin — operating the deployment, not participating in care.

THE DESIGN RULE, which is the whole point of this file: an admin sees NUMBERS AND EVENTS,
never clinical rows. No patient names, no session features, no band history for a named
person, no free-text. An administrator who can read patient records is a backdoor around
INV-11 wearing a friendlier name — and in a product whose entire argument is that raw data
never leaves the device, an "admin can see everything" panel would be the loudest possible
contradiction.

So: counts, distributions, system health, and the append-only audit trail (INV-8). If an
operator needs to look at one patient's clinical data, that is a clinician's job and it
goes through the clinician's authorisation path, where it is logged.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import require_roles
from ..auth.password import hash_password
from ..db import get_session
from ..schemas import ProvisionUser
from ..models import (
    AuditLog,
    ExamSession,
    ModuleResult,
    Patient,
    Role,
    Score,
    User,
)

router = APIRouter(prefix="/admin", tags=["admin"])

Session = Annotated[AsyncSession, Depends(get_session)]
Admin = Annotated[User, Depends(require_roles(Role.admin))]


async def _count(db: AsyncSession, stmt) -> int:
    return int(await db.scalar(stmt) or 0)


@router.get("/overview")
async def overview(admin: Admin, db: Session) -> dict:
    """Aggregate census. Every value here is a count — deliberately nothing addressable."""
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    users_by_role = {
        role.value: await _count(db, select(func.count(User.id)).where(User.role == role))
        for role in Role
    }

    # Band is on Score (one per scored session), not on the session row itself.
    bands = {
        str(getattr(row[0], "value", row[0])): int(row[1])
        for row in (
            await db.execute(select(Score.band, func.count(Score.id)).group_by(Score.band))
        ).all()
    }
    baseline_states = {
        str(getattr(row[0], "value", row[0])): int(row[1])
        for row in (
            await db.execute(
                select(Patient.baseline_state, func.count(Patient.id))
                .group_by(Patient.baseline_state)
            )
        ).all()
    }

    return {
        "generated_at": now.isoformat(),
        "users": {"total": sum(users_by_role.values()), "by_role": users_by_role},
        "patients": {
            "total": await _count(db, select(func.count(Patient.id))),
            "onboarding_complete": await _count(
                db, select(func.count(Patient.id)).where(Patient.onboarding_complete.is_(True))
            ),
        },
        "sessions": {
            "total": await _count(db, select(func.count(ExamSession.id))),
            "last_7_days": await _count(
                db, select(func.count(ExamSession.id)).where(ExamSession.ts >= week_ago)
            ),
            "practice": await _count(
                db, select(func.count(ExamSession.id)).where(ExamSession.is_practice.is_(True))
            ),
            "by_band": bands,
        },
        "modules": {
            "total": await _count(db, select(func.count(ModuleResult.id))),
            "quality_flagged": await _count(
                db,
                select(func.count(ModuleResult.id)).where(ModuleResult.quality_flag.is_(False)),
            ),
        },
        "baselines": {"by_state": baseline_states},
        # The gate funnel, which is what an operator actually wants when asking whether the
        # engine is behaving: how many scored sessions cleared each of the three gates.
        "gates": {
            "scored": await _count(db, select(func.count(Score.id))),
            "gate1_persistence": await _count(
                db, select(func.count(Score.id)).where(Score.gate1_passed.is_(True))
            ),
            "gate2_cross_modality": await _count(
                db, select(func.count(Score.id)).where(Score.gate2_passed.is_(True))
            ),
            "gate3_laterality": await _count(
                db, select(func.count(Score.id)).where(Score.gate3_passed.is_(True))
            ),
        },
        # Surfaced because an operator asked "is this trustworthy" deserves the real answer,
        # and the real answer is in ML_STATUS.md.
        "models": {
            "all_synthetic": True,
            "note": "Every model is trained on synthetic fixtures. See docs/ML_STATUS.md.",
        },
    }


@router.get("/identity")
async def identity_health(admin: Admin, db: Session) -> dict:
    """How often the same-person check is firing.

    The threshold is uncalibrated (D-017), so the operator needs to see the rate to know
    whether it is too tight. Counts only — never which patient.
    """
    return {
        "sessions_flagged": await _count(
            db,
            select(func.count(ExamSession.id)).where(ExamSession.identity_verified.is_(False)),
        ),
        "sessions_scored": await _count(
            db,
            select(func.count(ExamSession.id)).where(ExamSession.identity_score.isnot(None)),
        ),
        "patients_enrolled": await _count(
            db,
            select(func.count(Patient.id)).where(
                Patient.calibration_json.isnot(None),
            ),
        ),
        "note": "Threshold is calibrated on synthetic geometry only — D-017.",
    }


@router.get("/audit")
async def audit_tail(admin: Admin, db: Session, limit: int = 50) -> dict:
    """The append-only trail (INV-8).

    Actions and actors, not payloads: `patient.update` tells an operator that something was
    edited and by whom, which is what an audit trail is for. What was edited is clinical
    content and stays out of this endpoint.
    """
    limit = max(1, min(limit, 200))
    rows = list(
        await db.scalars(select(AuditLog).order_by(AuditLog.ts.desc()).limit(limit))
    )
    return {
        "count": len(rows),
        "entries": [
            {
                "ts": r.ts.isoformat(),
                "action": r.action,
                "actor_id": str(r.actor_id) if r.actor_id else None,
                # An opaque id, so repeated activity on one record is visible without
                # identifying whose record it is.
                "patient_ref": str(r.patient_id)[:8] if r.patient_id else None,
            }
            for r in rows
        ],
    }


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def provision_user(payload: ProvisionUser, admin: Admin, db: Session) -> dict:
    """Create a privileged account.

    Registration deliberately refuses clinician / asha_worker / admin, because `role` comes
    from the client and a self-assigned clinician can read every patient's name. Those
    accounts are minted here instead, by someone who already holds the role — and the act is
    written to the append-only audit trail (INV-8).
    """
    email = payload.email.lower().strip()
    if await db.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")

    user = User(
        email=email,
        pw_hash=hash_password(payload.password),
        role=payload.role,
        full_name=payload.full_name,
    )
    db.add(user)
    db.add(AuditLog(actor_id=admin.id, action=f"admin.provision.{payload.role.value}"))
    await db.commit()
    return {"id": str(user.id), "email": user.email, "role": user.role.value}
