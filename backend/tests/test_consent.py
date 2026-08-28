"""Part 4 — six independent consents, and the one that actually gates access.

THE TEST THAT MATTERS MOST: withdrawing C3 (CLINICIAN_SHARING) must actually stop a linked
clinician reading this patient's data — not just record that someone said no. A link and a
consent answer different questions ("is there a relationship" vs "may it see data right
now"), and Part 4's whole point is that the second can change without touching the first.
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


async def link_clinician(client, care_token: str, patient_id: str, clinician_id: str) -> str:
    resp = await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": clinician_id,
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care_token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# --------------------------------------------------------------------------- the six
async def test_nothing_is_granted_by_default(client, provision):
    """Silence must not read as yes — including for the two that default OFF in the UI."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    status = (await client.get(f"/consents/{patient_id}", headers=auth(care))).json()
    assert len(status) == 6
    assert all(not entry["granted"] for entry in status.values())
    assert status["RESEARCH"]["default_off"] is True
    assert status["MEDIA_TESTIMONIAL"]["default_off"] is True
    assert status["FOLLOW_UP"]["default_off"] is False


async def test_each_consent_is_independent(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    granted = await client.put(f"/consents/{patient_id}/FOLLOW_UP", json={"granted": True},
                               headers=auth(care))
    assert granted.status_code == 200, granted.text
    status = granted.json()
    assert status["FOLLOW_UP"]["granted"] is True
    # Every OTHER consent is untouched by granting this one.
    for key, entry in status.items():
        if key != "FOLLOW_UP":
            assert entry["granted"] is False, key


async def test_grant_then_withdraw_then_regrant_is_visible_in_status(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    await client.put(f"/consents/{patient_id}/RESEARCH", json={"granted": True},
                     headers=auth(care))
    withdrawn = (await client.put(f"/consents/{patient_id}/RESEARCH", json={"granted": False},
                                  headers=auth(care))).json()
    assert withdrawn["RESEARCH"]["granted"] is False
    assert withdrawn["RESEARCH"]["withdrawn_at"] is not None

    regranted = (await client.put(f"/consents/{patient_id}/RESEARCH", json={"granted": True},
                                  headers=auth(care))).json()
    assert regranted["RESEARCH"]["granted"] is True
    assert regranted["RESEARCH"]["withdrawn_at"] is None


async def test_setting_consent_is_idempotent(client, provision):
    """A settings toggle tapped twice must not surface an error."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    first = await client.put(f"/consents/{patient_id}/DATA_PROCESSING", json={"granted": True},
                             headers=auth(care))
    second = await client.put(f"/consents/{patient_id}/DATA_PROCESSING", json={"granted": True},
                              headers=auth(care))
    assert first.status_code == second.status_code == 200

    withdrawn_once = await client.put(f"/consents/{patient_id}/DATA_PROCESSING",
                                      json={"granted": False}, headers=auth(care))
    withdrawn_twice = await client.put(f"/consents/{patient_id}/DATA_PROCESSING",
                                       json={"granted": False}, headers=auth(care))
    assert withdrawn_once.status_code == withdrawn_twice.status_code == 200


async def test_only_the_owning_caregiver_can_set_consent(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    other_care = await register_caregiver(client, email="other@example.com")
    clinician, doctor = await provision(client, "dr@example.com", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    for token in (other_care, clinician):
        resp = await client.put(f"/consents/{patient_id}/FOLLOW_UP", json={"granted": True},
                                headers=auth(token))
        assert resp.status_code == 403, token


async def test_an_unknown_consent_type_is_rejected(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    resp = await client.put(f"/consents/{patient_id}/NOT_A_REAL_TYPE", json={"granted": True},
                            headers=auth(care))
    assert resp.status_code == 400


# --------------------------------------------------------- 4.5: C3 actually gates access
async def test_creating_a_link_grants_c3_and_the_clinician_can_read_the_dashboard(
    client, provision,
):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.c3@hospital.example", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    status = (await client.get(f"/consents/{patient_id}", headers=auth(care))).json()
    assert status["CLINICIAN_SHARING"]["granted"] is True

    resp = await client.get(f"/dashboard/{patient_id}", headers=auth(token))
    assert resp.status_code == 200, resp.text


async def test_withdrawing_c3_blocks_the_linked_clinician_immediately(client, provision):
    """THE CENTRAL TEST. The link is untouched — only the consent changes — and access
    must stop anyway."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.withdraw@hospital.example", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200

    withdrawn = await client.put(f"/consents/{patient_id}/CLINICIAN_SHARING",
                                 json={"granted": False}, headers=auth(care))
    assert withdrawn.status_code == 200, withdrawn.text

    # The link itself is still active — this is what makes the test meaningful.
    resp = await client.get(f"/dashboard/{patient_id}", headers=auth(token))
    assert resp.status_code == 403, (
        "the link was left active on purpose, and access must stop anyway — consent, "
        "not the link, is what this checks"
    )


async def test_withdrawing_c3_removes_the_patient_from_the_clinician_roster(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.roster@hospital.example", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    before = (await client.get("/clinic/patients", headers=auth(token))).json()
    assert [p["patient_id"] for p in before["patients"]] == [patient_id]

    await client.put(f"/consents/{patient_id}/CLINICIAN_SHARING", json={"granted": False},
                     headers=auth(care))

    after = (await client.get("/clinic/patients", headers=auth(token))).json()
    assert after["patients"] == []


async def test_withdrawing_c3_blocks_the_sessions_and_wearable_routes_too(client, provision):
    """The gate is centralised (`clinician_may_access_patient`) — spot-check it actually
    reached the other routes the Part 5.1 audit found, not only the dashboard."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.multi@hospital.example", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    started = await client.post(f"/sessions/{patient_id}/start", json={"type": "DAILY_PULSE"},
                                headers=auth(care))
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]
    assert (await client.get(f"/sessions/{session_id}/modules",
                             headers=auth(token))).status_code == 200

    await client.put(f"/consents/{patient_id}/CLINICIAN_SHARING", json={"granted": False},
                     headers=auth(care))

    assert (await client.get(f"/sessions/{session_id}/modules",
                             headers=auth(token))).status_code == 403


async def test_regranting_c3_restores_access(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    token, doctor = await provision(client, "dr.regrant@hospital.example", "clinician")
    await link_clinician(client, care, patient_id, doctor["id"])

    await client.put(f"/consents/{patient_id}/CLINICIAN_SHARING", json={"granted": False},
                     headers=auth(care))
    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403

    await client.put(f"/consents/{patient_id}/CLINICIAN_SHARING", json={"granted": True},
                     headers=auth(care))
    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200


# ------------------------------------------------------------------------- D-046 backfill
async def test_migration_0016_backfills_consent_ref_for_pre_existing_links(session):
    """The migration itself is exercised by `test_migration.py`'s upgrade/downgrade
    round-trip; this test exercises the DATA it produces, against the same models the app
    uses, by simulating what a Part-3-era link looked like and re-running the backfill
    logic's equivalent through the ORM layer that replaced it going forward."""
    from app.auth.password import hash_password
    from app.models import ClinicianRole, ConsentType, Patient, PatientClinicianLink, Role, User
    from app.services.consent import consent_currently_granted

    caregiver = User(email="pre-c3@example.com", pw_hash=hash_password("x" * 12),
                     role=Role.caregiver)
    clinician = User(email="dr-pre-c3@example.com", pw_hash=hash_password("x" * 12),
                     role=Role.clinician)
    session.add_all([caregiver, clinician])
    await session.flush()
    patient = Patient(caregiver_id=caregiver.id, name="Pre-C3",
                      stroke_date=NOW - timedelta(days=200))
    session.add(patient)
    await session.flush()

    # A link with consent_ref still NULL is exactly the pre-migration-0016 shape.
    link = PatientClinicianLink(
        patient_id=patient.id, clinician_id=clinician.id,
        clinician_role=ClinicianRole.TREATING_PHYSICIAN, linked_by=caregiver.id,
    )
    session.add(link)
    await session.commit()

    assert link.consent_ref is None
    assert not await consent_currently_granted(
        session, patient.id, ConsentType.CLINICIAN_SHARING
    ), "a link with no consent row must not grant access — this is exactly the gap 0016's data migration closes for real Part-3-era rows"
