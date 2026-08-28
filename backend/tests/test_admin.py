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


ADMIN_ROUTES = ["/admin/overview", "/admin/identity", "/admin/audit"]


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

    for route in ADMIN_ROUTES:
        body = json.dumps((await client.get(route, headers=auth(admin_token))).json())
        assert "Harjit" not in body, f"{route} leaked a patient name"
        assert "Kaur" not in body, f"{route} leaked a patient name"
        assert "care@example.com" not in body, f"{route} leaked an email"
        # The full patient UUID is addressable; the audit trail deliberately truncates it.
        assert patient_id not in body, f"{route} leaked an addressable patient id"


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
