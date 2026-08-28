"""Six independent consents, Part 4.

WHAT THIS MODULE OWNS
  - the current wording version for each consent type (4.3)
  - reading whether a consent is currently in force (`consent_currently_granted`)
  - recording a grant or a withdrawal as a new, attributed row (4.1, 4.2)

THE RULE THAT MATTERS: `CLINICIAN_SHARING` (C3) is not just a record. Withdrawing it must
actually stop a linked clinician reading this patient's data — `consent_currently_granted`
is called from `app.auth.deps.clinician_may_access_patient`, which every clinician-facing
route now goes through, so a withdrawal takes effect the moment it is recorded, independent
of whether the `patient_clinician_links` row is still active. A link and a consent answer
two different questions — "is there a relationship" and "may it currently see data" — and
access requires both.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Consent, ConsentType, Patient

#: The wording version each consent type is currently offered at. Bumping one of these is
#: a material-change event (4.3): the product should prompt the caregiver to re-consent,
#: surfaced via `consent_status` below as `current_version != version`. This is a UX signal,
#: not a backend access gate — a caregiver who agreed to yesterday's wording is still
#: validly consented until the product actually asks them again.
CURRENT_VERSIONS: dict[ConsentType, str] = {t: "2026-08-v1" for t in ConsentType}

#: C4 and C5 default OFF. Nothing else is opt-out-by-default: the product does not need
#: research participation or a testimonial to function, so silence must not read as yes.
DEFAULT_OFF = frozenset({ConsentType.RESEARCH, ConsentType.MEDIA_TESTIMONIAL})


class ConsentError(ValueError):
    """A consent action the current state does not permit."""


async def _latest(db: AsyncSession, patient_id: uuid.UUID,
                  consent_type: ConsentType) -> Consent | None:
    return await db.scalar(
        select(Consent)
        .where(Consent.patient_id == patient_id, Consent.consent_type == consent_type)
        .order_by(Consent.granted_at.desc())
        .limit(1)
    )


async def consent_currently_granted(
    db: AsyncSession, patient_id: uuid.UUID, consent_type: ConsentType,
) -> bool:
    """True only if the latest decision for this type is a grant that has not been
    withdrawn. No row at all means never asked, which is not consent — the default for
    every type, including the ones that default OFF in the UI, is DENIED until a real row
    says otherwise."""
    row = await _latest(db, patient_id, consent_type)
    return row is not None and row.in_force


async def consent_status(db: AsyncSession, patient: Patient) -> dict:
    """The current state of all six, for a settings screen or a consent-status endpoint."""
    out = {}
    for consent_type in ConsentType:
        row = await _latest(db, patient.id, consent_type)
        out[consent_type.value] = {
            "granted": bool(row and row.in_force),
            "version": row.version if row else None,
            "current_version": CURRENT_VERSIONS[consent_type],
            "stale": bool(row and row.in_force and row.version != CURRENT_VERSIONS[consent_type]),
            "granted_at": row.granted_at.isoformat() if row and row.granted_at else None,
            "withdrawn_at": row.withdrawn_at.isoformat() if row and row.withdrawn_at else None,
            "default_off": consent_type in DEFAULT_OFF,
        }
    return out


async def set_consent(
    db: AsyncSession,
    patient: Patient,
    consent_type: ConsentType,
    granted: bool,
    actor_id: uuid.UUID,
    *,
    version: str | None = None,
    ip_address: str | None = None,
    device_context: str | None = None,
) -> Consent | None:
    """Record a grant or a withdrawal as a new, attributed decision.

    A grant always creates a fresh row rather than mutating an old one — even a re-grant of
    the SAME version after a withdrawal — so the sequence of what was agreed to and when
    stays reconstructable (the same reason `BaselineReview` and `audit_log` are append-only,
    INV-8). A withdrawal mutates the currently in-force row's `withdrawn_at`, because it is
    the same decision ending, not a new one starting.

    Withdrawing something that is not currently granted, or granting something already
    granted at the same version, is a no-op that returns the current row rather than an
    error — a settings toggle tapped twice must not surface a 4xx to a caregiver.
    """
    current = await _latest(db, patient.id, consent_type)
    now = datetime.now(timezone.utc)

    if granted:
        effective_version = version or CURRENT_VERSIONS[consent_type]
        if current is not None and current.in_force and current.version == effective_version:
            return current
        row = Consent(
            patient_id=patient.id, consent_type=consent_type, version=effective_version,
            granted=True, granted_at=now, granted_by=actor_id,
            ip_address=ip_address, device_context=device_context,
        )
        db.add(row)
        await db.flush()
        return row

    if current is None or not current.in_force:
        return current
    current.withdrawn_at = now
    current.withdrawn_by = actor_id
    await db.flush()
    return current


def client_ip(request: Request) -> str | None:
    """Server-observed, never client-asserted (the whole reason this exists rather than a
    request-body field)."""
    if request.client is not None:
        return request.client.host
    return None
