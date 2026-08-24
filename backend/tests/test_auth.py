"""Auth: register -> login -> protected route -> refresh -> role guard."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.auth.jwt import TokenError, create_access_token, create_refresh_token, decode_token
from app.auth.password import hash_password, verify_password

CAREGIVER = {
    "email": "Asha.Caregiver@Example.com",
    "password": "correct-horse-battery-staple",
    "role": "caregiver",
    "full_name": "Asha K.",
}


async def _register(client, **overrides) -> dict:
    payload = {**CAREGIVER, **overrides}
    resp = await client.post("/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# --------------------------------------------------------------------------- register
async def test_register_returns_user_and_tokens(client):
    body = await _register(client)
    assert body["user"]["email"] == "asha.caregiver@example.com"  # normalised to lowercase
    assert body["user"]["role"] == "caregiver"
    assert "id" in body["user"]
    assert body["tokens"]["token_type"] == "bearer"
    assert body["tokens"]["access_token"] and body["tokens"]["refresh_token"]
    assert body["tokens"]["expires_in"] > 0
    assert "password" not in body["user"] and "pw_hash" not in body["user"]


async def test_register_rejects_duplicate_email(client):
    await _register(client)
    resp = await client.post("/auth/register", json=CAREGIVER)
    assert resp.status_code == 409


async def test_register_rejects_short_password(client):
    resp = await client.post("/auth/register", json={**CAREGIVER, "password": "short"})
    assert resp.status_code == 422


@pytest.mark.parametrize("role", ["patient", "caregiver"])
async def test_register_accepts_the_self_service_roles(client, role):
    """This once read `test_register_accepts_every_role` and included clinician.

    It was asserting the privilege-escalation hole as though it were a feature: a stranger
    choosing `clinician` at signup could then read /clinic/patients. The test passing is
    what made the hole look intentional, which is the more useful lesson than the fix.
    """
    body = await _register(client, email=f"{role}@example.com", role=role)
    assert body["user"]["role"] == role


async def test_register_rejects_unknown_role(client):
    """A role outside the enum is a validation error (422), not an authorisation one.

    This used "admin" as its example of an unknown role, which stopped being unknown when
    the admin role was added — it is now a real role that registration refuses, and that
    refusal is a 403 covered below. Kept distinct because the two failures mean different
    things: 422 is "no such role", 403 is "that role is not yours to take".
    """
    resp = await client.post("/auth/register", json={**CAREGIVER, "role": "superuser"})
    assert resp.status_code == 422


# --------------------------------------------------------------------------- login
async def test_login_succeeds_and_is_case_insensitive_on_email(client):
    await _register(client)
    resp = await client.post(
        "/auth/login",
        json={"email": "ASHA.CAREGIVER@example.com", "password": CAREGIVER["password"]},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["tokens"]["access_token"]


async def test_login_rejects_wrong_password(client):
    await _register(client)
    resp = await client.post(
        "/auth/login", json={"email": CAREGIVER["email"], "password": "not-the-password"}
    )
    assert resp.status_code == 401


async def test_login_rejects_unknown_email(client):
    resp = await client.post(
        "/auth/login", json={"email": "nobody@example.com", "password": "whatever-123456"}
    )
    assert resp.status_code == 401


# --------------------------------------------------------------------------- protected route
async def test_protected_route_requires_a_token(client):
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_protected_route_rejects_a_garbage_token(client):
    resp = await client.get("/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert resp.status_code == 401


async def test_protected_route_returns_the_current_user(client):
    body = await _register(client)
    token = body["tokens"]["access_token"]
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == body["user"]["id"]
    assert resp.json()["email"] == body["user"]["email"]


async def test_protected_route_rejects_a_refresh_token(client):
    """A refresh token must not be usable as an access token."""
    body = await _register(client)
    refresh = body["tokens"]["refresh_token"]
    resp = await client.get("/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert resp.status_code == 401


# --------------------------------------------------------------------------- refresh
async def test_refresh_issues_a_working_access_token(client):
    body = await _register(client)
    resp = await client.post(
        "/auth/refresh", json={"refresh_token": body["tokens"]["refresh_token"]}
    )
    assert resp.status_code == 200, resp.text
    new_access = resp.json()["access_token"]
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200


async def test_refresh_rejects_an_access_token(client):
    body = await _register(client)
    resp = await client.post(
        "/auth/refresh", json={"refresh_token": body["tokens"]["access_token"]}
    )
    assert resp.status_code == 401


# --------------------------------------------------------------------------- role guards
async def test_role_guard_allows_caregiver_and_clinician(client, provision):
    for role in ("caregiver", "clinician"):
        token, _ = await provision(client, f"{role}-guard@example.com", role)
        resp = await client.get(
            "/auth/clinician-check",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, f"{role}: {resp.text}"


async def test_role_guard_blocks_patient(client):
    body = await _register(client, email="patient-guard@example.com", role="patient")
    resp = await client.get(
        "/auth/clinician-check",
        headers={"Authorization": f"Bearer {body['tokens']['access_token']}"},
    )
    assert resp.status_code == 403


# --------------------------------------------------------------------------- primitives
def test_bcrypt_hashing_roundtrip():
    h = hash_password("a-real-password-123")
    assert h != "a-real-password-123"
    assert h.startswith("$2")
    assert verify_password("a-real-password-123", h)
    assert not verify_password("a-real-password-124", h)


def test_bcrypt_tolerates_passwords_over_72_bytes():
    long_pw = "ü" * 200
    h = hash_password(long_pw)
    assert verify_password(long_pw, h)


def test_verify_password_on_a_malformed_hash_is_false_not_an_error():
    assert verify_password("anything", "not-a-bcrypt-hash") is False


def test_token_type_is_enforced():
    access = create_access_token("11111111-1111-1111-1111-111111111111", "caregiver")
    refresh = create_refresh_token("11111111-1111-1111-1111-111111111111", "caregiver")

    assert decode_token(access, "access")["typ"] == "access"
    assert decode_token(refresh, "refresh")["typ"] == "refresh"
    assert decode_token(access)["role"] == "caregiver"

    with pytest.raises(TokenError):
        decode_token(access, "refresh")
    with pytest.raises(TokenError):
        decode_token(refresh, "access")
    with pytest.raises(TokenError):
        decode_token("clearly.not.a.token", "access")


def test_tokens_are_unique_per_issue():
    a = create_access_token("11111111-1111-1111-1111-111111111111", "patient")
    b = create_access_token("11111111-1111-1111-1111-111111111111", "patient")
    assert decode_token(a)["jti"] != decode_token(b)["jti"]


# --------------------------------------------------------------------------- health
async def test_health_endpoint(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# --------------------------------------------------------- privilege escalation via role
# `role` arrives in the registration body. Before this was closed, a stranger could sign up
# as a clinician and read /clinic/patients — every patient's name and age, across every
# caregiver. The frontend only ever offered caregiver and patient, which is exactly why it
# went unnoticed: INV-6 says the UI is never the boundary, and here the UI was the boundary.

PRIVILEGED = ["clinician", "asha_worker", "admin"]


@pytest.mark.parametrize("role", PRIVILEGED)
async def test_a_stranger_cannot_register_themselves_a_privileged_role(client, role):
    resp = await client.post("/auth/register", json={
        "email": f"impostor-{role}@example.com",
        "password": "correct-horse-battery",
        "role": role,
    })
    assert resp.status_code == 403, resp.text


@pytest.mark.parametrize("role", ["caregiver", "patient"])
async def test_self_service_roles_still_work(client, role):
    resp = await client.post("/auth/register", json={
        "email": f"real-{role}@example.com",
        "password": "correct-horse-battery",
        "role": role,
    })
    assert resp.status_code == 201, resp.text


async def test_the_roster_is_unreachable_without_a_provisioned_account(client):
    """The concrete exposure this closed, asserted end to end."""
    care = (await client.post("/auth/register", json={
        "email": "family@example.com", "password": "correct-horse-battery",
        "role": "caregiver"})).json()["tokens"]["access_token"]
    made = await client.post("/patients", json={
        "name": "Harjit Kaur", "age": 71, "sex": "female",
        "stroke_date": (datetime.now(timezone.utc) - timedelta(days=200)).isoformat(),
        "stroke_side": "right", "languages": ["pa"], "preferred_hour": 9.0,
    }, headers={"Authorization": f"Bearer {care}"})
    assert made.status_code == 201, made.text

    blocked = await client.post("/auth/register", json={
        "email": "stranger@example.com", "password": "correct-horse-battery",
        "role": "clinician"})
    assert blocked.status_code == 403, "a stranger just became a clinician"


async def test_an_admin_can_provision_a_real_clinician(client, provision):
    """Blocking self-assignment must not make legitimate clinicians unprovisionable."""
    admin_token, _ = await provision(client, "ops@neurotrace.app", "admin")
    resp = await client.post("/admin/users", json={
        "email": "dr.real@hospital.example", "password": "correct-horse-battery",
        "role": "clinician", "full_name": "Dr Real",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["role"] == "clinician"

    login = await client.post("/auth/login", json={
        "email": "dr.real@hospital.example", "password": "correct-horse-battery"})
    assert login.status_code == 200
    assert login.json()["user"]["role"] == "clinician"


async def test_a_caregiver_cannot_provision(client):
    care = (await client.post("/auth/register", json={
        "email": "care2@example.com", "password": "correct-horse-battery",
        "role": "caregiver"})).json()["tokens"]["access_token"]
    resp = await client.post("/admin/users", json={
        "email": "self.promoted@example.com", "password": "correct-horse-battery",
        "role": "clinician"}, headers={"Authorization": f"Bearer {care}"})
    assert resp.status_code == 403
