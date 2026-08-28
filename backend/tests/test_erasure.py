"""Part 5.4 — erasure deletes measurements and RETAINS the audit trail.

The bug this whole mechanism exists around was found by probing, not by reading:
`audit_log.patient_id` carries `ondelete="CASCADE"`, so `await db.delete(patient)` destroyed
every audit row for that patient. One row before the delete, zero after. An erasure that
destroys the record of who accessed the data before the erasure is not a privacy feature.

So the two assertions that matter are opposites of each other, and both have to hold at
once: the measurements must really be gone, and the audit must really still be there.
"""
from __future__ import annotations

import uuid as uuid_module
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

NOW = datetime.now(timezone.utc)
CAREGIVER = {"email": "family@example.com", "password": "correct-horse-battery",
             "role": "caregiver"}


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def register_caregiver(client, **overrides) -> str:
    resp = await client.post("/auth/register", json={**CAREGIVER, **overrides})
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


async def make_patient(client, token: str) -> str:
    resp = await client.post("/patients", json={
        "name": "Harjit Kaur", "age": 71, "sex": "female",
        "stroke_date": (NOW - timedelta(days=200)).isoformat(),
        "stroke_side": "right", "languages": ["pa", "en"], "preferred_hour": 9.0,
    }, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _seed_clinical_data(client, token: str, patient_id: str) -> None:
    """Create real rows through the normal paths, so the erasure has something to remove
    and the test is not trivially green against an empty patient."""
    await client.post(f"/sessions/{patient_id}/start", json={"type": "DAILY_PULSE"},
                      headers=auth(token))
    await client.post(f"/vitals/{patient_id}", json={
        "bp_sys": 130, "bp_dia": 84, "ts": NOW.isoformat(),
    }, headers=auth(token))
    await client.post(f"/adherence/{patient_id}", json={
        "taken": True, "ts": NOW.isoformat(),
    }, headers=auth(token))
    await client.post(f"/wearable/{patient_id}/fall", json={
        "source": "watch_accelerometer", "ts": NOW.isoformat(),
    }, headers=auth(token))
    # Reads generate audit rows, which is what must survive.
    await client.get(f"/dashboard/{patient_id}", headers=auth(token))


async def test_erasure_deletes_measurements_and_keeps_the_audit_trail(client, session):
    """THE CENTRAL TEST. Both halves, asserted together."""
    from app.models import Adherence, AuditLog, ExamSession, FallEvent, Vital

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await _seed_clinical_data(client, care, patient_id)
    pid = uuid_module.UUID(patient_id)

    async def count(model, column="patient_id"):
        return await session.scalar(
            select(func.count()).select_from(model)
            .where(getattr(model, column) == pid)
        )

    assert await count(ExamSession) >= 1
    assert await count(Vital) >= 1
    assert await count(Adherence) >= 1
    assert await count(FallEvent) >= 1
    audit_before = await count(AuditLog)
    assert audit_before >= 1, "no audit rows were generated; the test proves nothing"

    resp = await client.delete(f"/patients/{patient_id}?reason=withdrew+from+the+study",
                               headers=auth(care))
    assert resp.status_code == 200, resp.text

    # --- measurements: really gone ---
    assert await count(ExamSession) == 0, "sessions survived an erasure"
    assert await count(Vital) == 0, "vitals survived an erasure"
    assert await count(Adherence) == 0, "adherence survived an erasure"
    assert await count(FallEvent) == 0, "fall events survived an erasure"

    # --- audit: really retained, and one row richer for the erasure itself ---
    audit_after = await count(AuditLog)
    assert audit_after > audit_before, (
        "the audit trail was destroyed by the erasure — this is the exact CASCADE bug "
        "the tombstone design exists to avoid"
    )
    actions = set(await session.scalars(
        select(AuditLog.action).where(AuditLog.patient_id == pid)
    ))
    assert "patient.erased" in actions
    assert "patient.create" in actions, "pre-erasure history must survive the erasure"


async def test_the_tombstone_carries_no_identifying_field(client, session):
    from app.models import Patient

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await _seed_clinical_data(client, care, patient_id)

    await client.delete(f"/patients/{patient_id}?reason=requested", headers=auth(care))

    patient = await session.get(Patient, uuid_module.UUID(patient_id))
    assert patient is not None, "the row must survive so audit linkage survives with it"
    assert patient.erased is True
    assert patient.erased_at is not None
    assert patient.erasure_reason == "requested"

    assert patient.name == ""
    assert patient.age is None
    assert patient.sex is None
    assert patient.stroke_date is None
    # NOT NULL with an `unknown` default, so it is reset rather than nulled — and `unknown`
    # is the honest value: after erasure we genuinely do not know which side.
    assert patient.stroke_side.value == "unknown"
    assert patient.languages == []
    # The one stored thing derived from the patient's body.
    assert patient.calibration_json is None, "the face-identity vector survived an erasure"


async def test_erasure_revokes_clinician_links_without_deleting_them(client, provision, session):
    """Same INV-8 reasoning as the audit trail: who could see this patient, and until when,
    stays recoverable — the link is revoked, not removed."""
    from app.models import PatientClinicianLink

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.erase@hospital.example", "clinician")
    await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care))

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200

    await client.delete(f"/patients/{patient_id}?reason=withdrew", headers=auth(care))

    link = await session.scalar(
        select(PatientClinicianLink)
        .where(PatientClinicianLink.patient_id == uuid_module.UUID(patient_id))
    )
    assert link is not None, "the link row was deleted; revocation history is lost"
    assert link.unlinked_at is not None
    assert link.unlink_reason == "patient data erased"

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403


async def test_only_the_owning_caregiver_can_erase(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.noterase@hospital.example", "clinician")
    await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care))

    assert (await client.delete(f"/patients/{patient_id}",
                                headers=auth(token))).status_code == 403


async def test_erasing_twice_is_refused_rather_than_silently_repeated(client):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    assert (await client.delete(f"/patients/{patient_id}",
                                headers=auth(care))).status_code == 200
    assert (await client.delete(f"/patients/{patient_id}",
                                headers=auth(care))).status_code == 409


async def test_consent_history_survives_erasure(client, session):
    """A record that consent was granted and later withdrawn is evidence about a decision,
    not a measurement of a body. It is retained for the same reason the audit trail is."""
    from app.models import Consent

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await client.put(f"/consents/{patient_id}/FOLLOW_UP", json={"granted": True},
                     headers=auth(care))

    await client.delete(f"/patients/{patient_id}?reason=withdrew", headers=auth(care))

    rows = await session.scalar(
        select(func.count()).select_from(Consent)
        .where(Consent.patient_id == uuid_module.UUID(patient_id))
    )
    assert rows >= 1, "consent history was destroyed by the erasure"
