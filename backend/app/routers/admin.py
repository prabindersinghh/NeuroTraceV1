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
    ClinicianProfile,
    ExamSession,
    ModuleResult,
    Patient,
    PatientClinicianLink,
    Role,
    Score,
    User,
    VerificationStatus,
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


@router.get("/doctors")
async def doctor_census(admin: Admin, db: Session) -> dict:
    """How many clinicians are onboarded, and who they are — Part 3.7e.

    THIS IS THE ONE ROSTER AN ADMIN GETS, AND IT IS A ROSTER OF STAFF, NOT PATIENTS.
    A clinician's name, registration number and affiliation are operational metadata about
    a person who works on the deployment: an operator legitimately needs to know who has
    accounts, whether their profiles are filled in, and how the load is distributed. That
    is categorically different from patient data, which D-041 and INV-11 keep out of every
    admin surface.

    So the patient dimension here is a COUNT AND NOTHING ELSE. `patients_linked` is an
    integer. There is deliberately no drill-down: no patient ids, no names, no bands, no
    per-patient rows, and no route anywhere that takes a clinician id and returns their
    patients. An admin who could expand a doctor into their patient list would have exactly
    the backdoor this file exists to refuse, wearing an org-chart costume.

    `verification_status` is surfaced verbatim, always SELF_DECLARED — the registration
    number is what the clinician typed, checked against nothing. Rendering the number
    without the status beside it would imply a verification that never happened.
    """
    profiles = {
        p.user_id: p
        for p in await db.scalars(select(ClinicianProfile))
    }
    clinicians = list(await db.scalars(
        select(User).where(User.role == Role.clinician).order_by(User.created_at.asc())
    ))

    link_counts = {
        row[0]: int(row[1])
        for row in (
            await db.execute(
                select(PatientClinicianLink.clinician_id,
                       func.count(PatientClinicianLink.id))
                .where(PatientClinicianLink.unlinked_at.is_(None))
                .group_by(PatientClinicianLink.clinician_id)
            )
        ).all()
    }

    doctors = []
    for user in clinicians:
        profile = profiles.get(user.id)
        doctors.append({
            "id": str(user.id),
            "email": user.email,
            "full_name": (profile.full_name if profile else None) or user.full_name,
            "qualification": profile.qualification if profile else None,
            "registration_number": profile.registration_number if profile else None,
            "registering_authority": profile.registering_authority if profile else None,
            "specialty": profile.specialty if profile else None,
            "affiliation": profile.affiliation if profile else None,
            # Always SELF_DECLARED. Never render the number without this beside it.
            "verification_status": (
                profile.verification_status.value if profile
                else VerificationStatus.SELF_DECLARED.value
            ),
            "profile_complete": profile is not None,
            # A COUNT. Never a list, never expandable — see the docstring.
            "patients_linked": link_counts.get(user.id, 0),
            "created_at": user.created_at.isoformat(),
        })

    return {
        "total": len(doctors),
        "with_profile": sum(1 for d in doctors if d["profile_complete"]),
        "unverified": len(doctors),   # every one of them: nothing is checked
        "doctors": doctors,
        "note": (
            "Registration numbers are self-declared and verified against no medical "
            "register. Patient counts are counts only — this surface exposes no patient "
            "identity or clinical content (D-041, INV-11)."
        ),
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
