"""Part 3.2 — the doctor-patient link, and the access path it closes.

This is not primarily a feature test. Before Part 3, `get_patient_for_user` allowed ANY
user whose role was `clinician` to read ANY patient, and `/clinic/patients` ran a bare
`select(Patient)` with no scoping. `Patient.clinician_id` existed and was never consulted
for authorisation. So the tests that matter most here are the ones asserting the OLD
behaviour is gone: an unlinked clinician must get 403, and must see an empty roster.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

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


# ---------------------------------------------- the access path Part 3.2 closes
async def test_an_unlinked_clinician_cannot_read_a_patient(client, provision):
    """THE REGRESSION THIS EXISTS FOR. This returned 200 before Part 3."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    stranger, _ = await provision(client, "unlinked@hospital.example", "clinician")
    resp = await client.get(f"/dashboard/{patient_id}", headers=auth(stranger))
    assert resp.status_code == 403, (
        "an unlinked clinician read a patient — the pre-Part-3 hole is back"
    )


async def test_an_unlinked_clinician_sees_an_empty_roster(client, provision):
    """The roster had the same hole: `select(Patient)` with no scoping at all."""
    care = await register_caregiver(client)
    await make_patient(client, care)

    stranger, _ = await provision(client, "unlinked2@hospital.example", "clinician")
    resp = await client.get("/clinic/patients", headers=auth(stranger))
    assert resp.status_code == 200, resp.text
    assert resp.json()["patients"] == [], (
        "an unlinked clinician saw a patient on their roster"
    )


async def test_a_linked_clinician_can_read_and_sees_them_on_the_roster(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.linked@hospital.example", "clinician")

    made = await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care))
    assert made.status_code == 201, made.text

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200
    roster = (await client.get("/clinic/patients", headers=auth(token))).json()
    assert [p["patient_id"] for p in roster["patients"]] == [patient_id]


async def test_revoking_a_link_removes_access_again(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.temp@hospital.example", "clinician")

    link_id = (await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "CONSULTING_NEUROLOGIST",
    }, headers=auth(care))).json()["id"]
    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200

    revoked = await client.delete(
        f"/clinician/links/{link_id}?reason=transferred+care", headers=auth(care))
    assert revoked.status_code == 200, revoked.text

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403


async def test_a_clinician_cannot_link_themselves_to_a_patient(client, provision):
    """A doctor who could add themselves would make the link meaningless as access
    control. The owning caregiver consents on the patient's behalf."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.self@hospital.example", "clinician")

    resp = await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(token))
    assert resp.status_code == 403, resp.text


async def test_linking_and_revoking_both_write_audit_rows(client, provision):
    """INV-8: who could see this patient, and when, must stay recoverable."""
    from sqlalchemy import select
    from app.models import AuditLog

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    _, doctor = await provision(client, "dr.audit@hospital.example", "clinician")

    link_id = (await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "CLINICAL_REVIEWER",
    }, headers=auth(care))).json()["id"]
    await client.delete(f"/clinician/links/{link_id}?reason=done", headers=auth(care))

    # Read back through the admin audit surface rather than the DB, so this also proves
    # the events are actually reachable.
    admin, _ = await provision(client, "ops@neurotrace.app", "admin")
    audit = (await client.get("/admin/audit?limit=100", headers=auth(admin))).json()
    actions = {e["action"] for e in audit["entries"]}
    assert "clinician.link.granted" in actions
    assert "clinician.link.revoked" in actions


async def test_the_link_records_consent_now_for_part_4_to_reference(client, provision):
    """D-046: a Part-3-era link records a caregiver-granted consent EVENT, and Part 4's
    migration must backfill `consent_ref` for these. Without this event there would be no
    evidence of consent for that cohort at all."""
    from sqlalchemy import select
    from app.models import AuditLog

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    _, doctor = await provision(client, "dr.consent@hospital.example", "clinician")
    await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care))

    admin, _ = await provision(client, "ops2@neurotrace.app", "admin")
    audit = (await client.get("/admin/audit?limit=100", headers=auth(admin))).json()
    assert any(e["action"] == "clinician.link.granted" for e in audit["entries"])


# --------------------------------------------------------------- 3.1 profile honesty
async def test_the_registration_number_is_stored_but_marked_self_declared(client, provision):
    token, _ = await provision(client, "dr.profile@hospital.example", "clinician")
    resp = await client.put("/clinician/profile", json={
        "full_name": "Dr A Sharma",
        "qualification": "MD (Medicine), DM (Neurology)",
        "registration_number": "PMC-12345",
        "registering_authority": "Punjab Medical Council",
        "specialty": "Neurology",
    }, headers=auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["registration_number"] == "PMC-12345"
    assert body["verification_status"] == "SELF_DECLARED", (
        "we display a registration number we have not checked; saying so is the whole "
        "point of storing the status alongside it"
    )


async def test_verification_status_cannot_be_set_by_the_client(client, provision):
    """A client that could claim VERIFIED would be asserting a check we never performed."""
    token, _ = await provision(client, "dr.claim@hospital.example", "clinician")
    resp = await client.put("/clinician/profile", json={
        "full_name": "Dr B", "verification_status": "VERIFIED",
    }, headers=auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["verification_status"] == "SELF_DECLARED"


# ---------------------------------------------------------- Part 5.1 endpoint data audit
#
# The link check closed the main path (`get_patient_for_user`), but several routes had
# their own hand-rolled copy of "is this caller allowed to touch this patient" that never
# got the same fix. Each test below pins the exact regression the audit found.

async def test_an_unlinked_clinician_cannot_submit_a_module_or_finalize_a_session(
    client, provision,
):
    """sessions.py's `_assert_can_access` still granted `user.role is Role.clinician`
    unconditionally — the pre-Part-3.2 hole, reintroduced via a local duplicate that never
    got the fix. An unlinked clinician could read AND write another patient's raw module
    features and trigger scoring on their session."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    started = await client.post(f"/sessions/{patient_id}/start", json={"type": "DAILY_PULSE"},
                                headers=auth(care))
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]

    stranger, _ = await provision(client, "unlinked3@hospital.example", "clinician")
    assert (await client.post(
        f"/sessions/{session_id}/module/M1", json={}, headers=auth(stranger)
    )).status_code == 403
    assert (await client.get(
        f"/sessions/{session_id}/modules", headers=auth(stranger)
    )).status_code == 403
    assert (await client.post(
        f"/sessions/{session_id}/finalize", json={}, headers=auth(stranger)
    )).status_code == 403


async def test_get_patients_no_longer_leaks_every_patient_to_a_clinician_or_admin(
    client, provision,
):
    """`GET /patients`'s role dispatch only special-cased caregiver and patient; every
    other role fell through with no WHERE clause and got every patient in the deployment.
    A clinician now gets only their linked patients (like `/clinic/patients`); admin gets
    none at all — this route returns clinical rows (name, age, stroke details), which
    INV-11 forbids for admin regardless of what other operational data it may see."""
    care = await register_caregiver(client)
    await make_patient(client, care)

    stranger, _ = await provision(client, "unlinked4@hospital.example", "clinician")
    assert (await client.get("/patients", headers=auth(stranger))).json() == []

    admin, _ = await provision(client, "ops3@neurotrace.app", "admin")
    assert (await client.get("/patients", headers=auth(admin))).json() == []


async def test_a_linked_clinician_sees_their_patient_via_get_patients(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.viaget@hospital.example", "clinician")
    made = await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care))
    assert made.status_code == 201, made.text

    rows = (await client.get("/patients", headers=auth(token))).json()
    assert [p["id"] for p in rows] == [patient_id]


async def test_an_unlinked_clinician_cannot_acknowledge_a_fall_event(client, provision):
    """`acknowledge_fall` authorised via the legacy `Patient.clinician_id` column, which
    link revocation never touches and which a caregiver could point at an arbitrary
    account. It now uses the same active-link check as every other clinician route."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    reported = await client.post(f"/wearable/{patient_id}/fall", json={
        "source": "watch_accelerometer", "ts": NOW.isoformat(),
    }, headers=auth(care))
    assert reported.status_code == 201, reported.text
    fall_id = reported.json()["id"]

    stranger, _ = await provision(client, "unlinked5@hospital.example", "clinician")
    resp = await client.post(f"/wearable/fall/{fall_id}/acknowledge", headers=auth(stranger))
    assert resp.status_code == 403, resp.text


async def test_an_unlinked_clinician_cannot_acknowledge_an_alert(client, provision, session):
    """Role-gated to `clinician`, but had no check that THIS clinician is linked to the
    alert's patient — any clinician account could acknowledge any patient's alert given
    the alert id."""
    import uuid as uuid_module

    from app.models import Alert, Band, ExamSession, Patient, Score

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    patient = await session.get(Patient, uuid_module.UUID(patient_id))
    exam = ExamSession(patient_id=patient.id)
    session.add(exam)
    await session.flush()
    score = Score(patient_id=patient.id, session_id=exam.id, band=Band.ALERT)
    session.add(score)
    await session.flush()
    alert = Alert(patient_id=patient.id, score_id=score.id, band=Band.ALERT,
                  explanation_en="test")
    session.add(alert)
    await session.commit()

    stranger, _ = await provision(client, "unlinked6@hospital.example", "clinician")
    resp = await client.post(f"/clinic/alerts/{alert.id}/acknowledge", headers=auth(stranger))
    assert resp.status_code == 403, resp.text


async def test_only_the_authorised_caller_can_revoke_a_listener_link(client, provision):
    """Minting required `get_patient_for_user`; revocation required only SOME valid login
    with no check tying the caller to the token's patient at all."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    minted = await client.post(f"/awaaz/{patient_id}/listener", json={
        "display_name": "Papa",
    }, headers=auth(care))
    assert minted.status_code == 200, minted.text
    token = minted.json()["token"]

    stranger, _ = await provision(client, "unlinked7@hospital.example", "clinician")
    denied = await client.delete(f"/awaaz/listener/{token}", headers=auth(stranger))
    assert denied.status_code == 403, denied.text

    revoked = await client.delete(f"/awaaz/listener/{token}", headers=auth(care))
    assert revoked.status_code == 200, revoked.text


async def test_patch_patients_rejects_a_clinician_id_that_is_not_a_clinician(client, provision):
    """`POST /patients` validated `clinician_id` names a clinician account; `PATCH
    /patients/{id}` did not, so a caregiver could point the (now-legacy) column at any
    user id at all."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    other_caregiver = await register_caregiver(client, email="other-family@example.com")
    other_user = (await client.get("/auth/me", headers=auth(other_caregiver))).json()

    resp = await client.patch(f"/patients/{patient_id}", json={
        "clinician_id": other_user["id"],
    }, headers=auth(care))
    assert resp.status_code == 400, resp.text
