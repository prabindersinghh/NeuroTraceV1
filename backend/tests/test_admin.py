"""/admin — an operator surface that must not become a way to read patients.

The access tests matter, but the one that matters most is
`test_no_admin_response_contains_patient_identifying_data`: an admin panel is the obvious
place for "just show me everything" to creep in later, and in this product that would be a
backdoor around INV-11. This asserts the shape of what admin returns, so adding a
patient name to any of these payloads fails the build.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime.now(timezone.utc)
ADMIN = {"email": "ops@neurotrace.app", "password": "correct-horse-battery", "role": "admin"}


async def register(client, **overrides):
    """Self-service signup. Only caregiver and patient may use it — that is the point."""
    resp = await client.post("/auth/register", json={**ADMIN, "role": "caregiver", **overrides})
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


ADMIN_ROUTES = ["/admin/overview", "/admin/identity", "/admin/audit", "/admin/doctors"]


@pytest.mark.parametrize("route", ADMIN_ROUTES)
async def test_an_admin_can_read_the_operator_surface(client, provision, route):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    resp = await client.get(route, headers=auth(token))
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("route", ADMIN_ROUTES)
@pytest.mark.parametrize("role", ["caregiver", "clinician", "patient", "asha_worker"])
async def test_no_other_role_can_reach_it(client, provision, route, role):
    token, _ = await provision(client, f"{role}@example.com", role)
    resp = await client.get(route, headers=auth(token))
    assert resp.status_code == 403, f"{role} reached {route}"


@pytest.mark.parametrize("route", ADMIN_ROUTES)
async def test_anonymous_cannot_reach_it(client, route):
    resp = await client.get(route)
    assert resp.status_code in (401, 403)


async def test_no_admin_response_contains_patient_identifying_data(client, provision):
    """The design rule, enforced.

    An admin sees counts and events. A patient name, an email, a free-text note or a
    feature vector appearing in any of these payloads means the surface has drifted into a
    clinical read path, which is the thing it exists not to be.

    Part 3.7e added `/admin/doctors`, which DOES carry names — of clinicians, who are staff,
    not patients. That is the one thing this test has to be careful about: it must keep
    proving zero patient content leaks even now that a legitimate name-bearing roster
    exists on the same surface. So the doctor is deliberately LINKED to the patient here,
    which is exactly the shape that would tempt a future drill-down.
    """
    admin_token, _ = await provision(client, "ops@neurotrace.app", "admin")

    # Create real data through the normal path so the payloads are not trivially empty.
    care_token = await register(client, email="care@example.com")
    made = await client.post("/patients", json={
        "name": "Harjit Kaur", "age": 71, "sex": "female",
        "stroke_date": (NOW - timedelta(days=200)).isoformat(),
        "stroke_side": "right", "languages": ["pa", "en"], "preferred_hour": 9.0,
    }, headers=auth(care_token))
    assert made.status_code == 201, made.text
    patient_id = made.json()["id"]
    await client.post(f"/sessions/{patient_id}/start", json={"type": "DAILY_PULSE"},
                      headers=auth(care_token))

    # A real, profiled, LINKED clinician — so /admin/doctors has a populated row whose
    # patient count is non-zero, and any drift toward exposing WHICH patient would show up.
    doctor_token, doctor = await provision(client, "dr.census@hospital.example", "clinician")
    await client.put("/clinician/profile", json={
        "full_name": "Dr A Sharma", "qualification": "MD, DM (Neurology)",
        "registration_number": "PMC-12345", "registering_authority": "Punjab Medical Council",
        "specialty": "Neurology", "affiliation": "CMC Ludhiana",
    }, headers=auth(doctor_token))
    linked = await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care_token))
    assert linked.status_code == 201, linked.text

    for route in ADMIN_ROUTES:
        body = json.dumps((await client.get(route, headers=auth(admin_token))).json())
        assert "Harjit" not in body, f"{route} leaked a patient name"
        assert "Kaur" not in body, f"{route} leaked a patient name"
        assert "care@example.com" not in body, f"{route} leaked an email"
        # The full patient UUID is addressable; the audit trail deliberately truncates it.
        assert patient_id not in body, f"{route} leaked an addressable patient id"
        # Clinical content has no business on any admin payload either.
        assert "stroke_side" not in body, f"{route} leaked a clinical field"
        assert "features_json" not in body, f"{route} leaked a feature vector"


async def test_the_doctor_census_counts_patients_without_naming_them(client, provision):
    """Part 3.7e's whole boundary in one test: operational metadata about STAFF is fine,
    patient identity is not, and the patient dimension is a count with no drill-down."""
    admin_token, _ = await provision(client, "ops@neurotrace.app", "admin")
    care_token = await register(client, email="care@example.com")
    made = await client.post("/patients", json={
        "name": "Harjit Kaur", "age": 71, "sex": "female",
        "stroke_date": (NOW - timedelta(days=200)).isoformat(),
        "stroke_side": "right", "languages": ["pa", "en"], "preferred_hour": 9.0,
    }, headers=auth(care_token))
    patient_id = made.json()["id"]

    doctor_token, doctor = await provision(client, "dr.count@hospital.example", "clinician")
    await client.put("/clinician/profile", json={
        "full_name": "Dr B Singh", "registration_number": "PMC-999",
        "specialty": "Neurology", "affiliation": "DMC Ludhiana",
    }, headers=auth(doctor_token))
    await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care_token))

    body = (await client.get("/admin/doctors", headers=auth(admin_token))).json()
    row = next(d for d in body["doctors"] if d["id"] == doctor["id"])

    # Staff metadata: present and useful.
    assert row["full_name"] == "Dr B Singh"
    assert row["registration_number"] == "PMC-999"
    assert row["affiliation"] == "DMC Ludhiana"
    assert row["profile_complete"] is True

    # The patient dimension: a count, and only a count.
    assert row["patients_linked"] == 1
    assert isinstance(row["patients_linked"], int)
    assert not any(isinstance(v, (list, dict)) for v in row.values()), (
        "a nested structure on a doctor row is how a patient drill-down would arrive"
    )

    # And the honesty note travels with the registration number, everywhere.
    assert row["verification_status"] == "SELF_DECLARED"
    assert body["unverified"] == body["total"]


async def test_a_revoked_link_stops_counting_toward_a_doctors_patient_total(client, provision):
    """The count reflects ACTIVE links — a doctor who no longer has a patient should not
    still appear to carry them in the operator's load picture."""
    admin_token, _ = await provision(client, "ops@neurotrace.app", "admin")
    care_token = await register(client, email="care@example.com")
    made = await client.post("/patients", json={
        "name": "Harjit Kaur", "stroke_date": (NOW - timedelta(days=200)).isoformat(),
    }, headers=auth(care_token))
    patient_id = made.json()["id"]

    _, doctor = await provision(client, "dr.revoked@hospital.example", "clinician")
    link_id = (await client.post("/clinician/links", json={
        "patient_id": patient_id, "clinician_id": doctor["id"],
        "clinician_role": "TREATING_PHYSICIAN",
    }, headers=auth(care_token))).json()["id"]

    def _count(body):
        return next(d for d in body["doctors"] if d["id"] == doctor["id"])["patients_linked"]

    before = (await client.get("/admin/doctors", headers=auth(admin_token))).json()
    assert _count(before) == 1

    await client.delete(f"/clinician/links/{link_id}?reason=transferred", headers=auth(care_token))

    after = (await client.get("/admin/doctors", headers=auth(admin_token))).json()
    assert _count(after) == 0


async def test_a_clinician_without_a_profile_still_appears_as_onboarded(client, provision):
    """An operator asking "how many doctors do we have" must get everyone with an account,
    not only the ones who finished their profile — otherwise the census under-reports
    exactly the people who need chasing."""
    admin_token, _ = await provision(client, "ops@neurotrace.app", "admin")
    _, doctor = await provision(client, "dr.noprofile@hospital.example", "clinician")

    body = (await client.get("/admin/doctors", headers=auth(admin_token))).json()
    row = next(d for d in body["doctors"] if d["id"] == doctor["id"])
    assert row["profile_complete"] is False
    assert row["registration_number"] is None
    assert row["verification_status"] == "SELF_DECLARED"
    assert body["total"] >= 1
    assert body["with_profile"] < body["total"]


async def test_the_overview_reports_that_every_model_is_synthetic(client, provision):
    """An operator asking "can I trust this" must not get a number without that caveat."""
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    body = (await client.get("/admin/overview", headers=auth(token))).json()
    assert body["models"]["all_synthetic"] is True
    assert "ML_STATUS" in body["models"]["note"]


async def test_the_audit_tail_is_capped(client, provision):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    resp = await client.get("/admin/audit?limit=100000", headers=auth(token))
    assert resp.status_code == 200
    assert len(resp.json()["entries"]) <= 200
