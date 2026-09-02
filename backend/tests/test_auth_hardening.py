"""Auth hardening: the secret guard, rate limits, refresh rotation/revocation, logout,
password change, password quality, security headers."""
from __future__ import annotations

import pytest

from app.auth import ratelimit
from app.auth.password import password_problem
from app.config import Settings, settings

USER = {"email": "hardening@example.com", "password": "correct-horse-battery-staple",
        "role": "caregiver"}


async def _register(client, **overrides) -> dict:
    resp = await client.post("/auth/register", json={**USER, **overrides})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- 1. secret
def test_a_dev_secret_is_refused_outside_development():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(env="production", jwt_secret="change-me-in-env-file", _env_file=None)
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(env="staging", jwt_secret="short", _env_file=None)


def test_a_dev_secret_is_tolerated_in_development():
    assert Settings(env="development", jwt_secret="change-me-in-env-file", _env_file=None)
    assert Settings(env="production", jwt_secret="x" * 32, _env_file=None)


# --------------------------------------------------------------------------- 2. limits
@pytest.fixture
def limited(monkeypatch):
    ratelimit.reset_all()
    monkeypatch.setattr(settings, "auth_rate_limit", True)
    yield
    ratelimit.reset_all()


async def test_five_failed_logins_lock_the_account_from_that_address(client, limited):
    await _register(client)
    bad = {"email": USER["email"], "password": "not-the-password"}
    for _ in range(5):
        assert (await client.post("/auth/login", json=bad)).status_code == 401
    resp = await client.post("/auth/login", json=bad)
    assert resp.status_code == 429, resp.text
    assert "Retry-After" in resp.headers
    assert "Try again in" in resp.json()["detail"]
    # The right password is refused too — that is what a lockout means.
    good = {"email": USER["email"], "password": USER["password"]}
    assert (await client.post("/auth/login", json=good)).status_code == 429


async def test_a_successful_login_clears_the_failure_count(client, limited):
    await _register(client)
    bad = {"email": USER["email"], "password": "not-the-password"}
    good = {"email": USER["email"], "password": USER["password"]}
    for _ in range(4):
        await client.post("/auth/login", json=bad)
    assert (await client.post("/auth/login", json=good)).status_code == 200
    for _ in range(4):
        await client.post("/auth/login", json=bad)
    assert (await client.post("/auth/login", json=good)).status_code == 200


async def test_register_is_limited_per_address_and_reads_x_forwarded_for(client, limited):
    for i in range(10):
        await _register(client, email=f"r{i}@example.com")
    resp = await client.post("/auth/register", json={**USER, "email": "r10@example.com"})
    assert resp.status_code == 429
    # A different client behind the same proxy is a different budget.
    resp = await client.post("/auth/register", json={**USER, "email": "r11@example.com"},
                             headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.1"})
    assert resp.status_code == 201, resp.text


def test_the_window_slides():
    w = ratelimit.SlidingWindow(limit=2, window=1000)
    w.record("k"); w.record("k")
    assert w.retry_after("k") is not None
    w.clear("k")
    assert w.retry_after("k") is None


# --------------------------------------------------------------------------- 3. refresh
async def test_refresh_rotates_and_the_old_token_dies(client):
    body = await _register(client)
    old = body["tokens"]["refresh_token"]
    resp = await client.post("/auth/refresh", json={"refresh_token": old})
    assert resp.status_code == 200, resp.text
    new = resp.json()["refresh_token"]
    assert new != old
    assert (await client.get("/auth/me", headers=_auth(resp.json()["access_token"]))).status_code == 200
    # The replacement works — one rotation, one live session — and the original does not.
    # Order matters: replaying `old` is reuse, which ends the family (next test).
    newer = await client.post("/auth/refresh", json={"refresh_token": new})
    assert newer.status_code == 200
    assert (await client.post("/auth/refresh", json={"refresh_token": old})).status_code == 401


async def test_reusing_a_rotated_token_revokes_the_whole_family(client):
    body = await _register(client)
    first = body["tokens"]["refresh_token"]
    second = (await client.post("/auth/refresh", json={"refresh_token": first})).json()["refresh_token"]
    third = (await client.post("/auth/refresh", json={"refresh_token": second})).json()["refresh_token"]
    # Someone presents `first` again: `third`, the only live token, must die with it.
    assert (await client.post("/auth/refresh", json={"refresh_token": first})).status_code == 401
    assert (await client.post("/auth/refresh", json={"refresh_token": third})).status_code == 401


async def test_a_refresh_token_the_server_never_issued_is_refused(client):
    from app.auth.jwt import create_refresh_token
    body = await _register(client)
    forged = create_refresh_token(body["user"]["id"], "caregiver")  # valid signature, no row
    assert (await client.post("/auth/refresh", json={"refresh_token": forged})).status_code == 401


async def test_logout_revokes_and_is_idempotent(client):
    body = await _register(client)
    token = body["tokens"]["refresh_token"]
    assert (await client.post("/auth/logout", json={"refresh_token": token})).status_code == 204
    assert (await client.post("/auth/refresh", json={"refresh_token": token})).status_code == 401
    assert (await client.post("/auth/logout", json={"refresh_token": token})).status_code == 204
    assert (await client.post("/auth/logout", json={"refresh_token": "garbage"})).status_code == 204


# --------------------------------------------------------------------------- 4. password
async def test_password_change_signs_out_every_other_session(client):
    body = await _register(client)
    phone = (await client.post("/auth/login", json={"email": USER["email"], "password": USER["password"]})).json()
    laptop_access = body["tokens"]["access_token"]

    wrong = await client.post("/auth/password", headers=_auth(laptop_access),
                              json={"current_password": "nope-nope-nope", "new_password": "a-brand-new-passphrase"})
    assert wrong.status_code == 401

    resp = await client.post("/auth/password", headers=_auth(laptop_access),
                             json={"current_password": USER["password"], "new_password": "a-brand-new-passphrase"})
    assert resp.status_code == 200, resp.text
    fresh = resp.json()["tokens"]
    # The laptop's fresh token is alive; the phone's is dead. Alive first — replaying the
    # dead one is reuse and revokes the family, which would mask the check.
    assert (await client.post("/auth/refresh", json={"refresh_token": fresh["refresh_token"]})).status_code == 200
    assert (await client.post("/auth/refresh", json={"refresh_token": phone["tokens"]["refresh_token"]})).status_code == 401
    login = await client.post("/auth/login", json={"email": USER["email"], "password": "a-brand-new-passphrase"})
    assert login.status_code == 200


async def test_password_change_requires_a_session(client):
    resp = await client.post("/auth/password", json={"current_password": "x", "new_password": "y" * 8})
    assert resp.status_code == 401


# --------------------------------------------------------------------------- 5. quality
def test_password_problem():
    assert password_problem("correct-horse-battery", "a@b.com") is None
    assert "email" in password_problem("A@B.com", "a@b.com")
    assert "email" in password_problem("someone", "someone@example.com")
    assert "common" in password_problem("Password123", "a@b.com")


async def test_register_refuses_a_common_password(client):
    resp = await client.post("/auth/register", json={**USER, "password": "password123"})
    assert resp.status_code == 422
    assert resp.json()["detail"] == "That password is too common"


async def test_admin_provisioning_refuses_the_email_as_password(client, provision):
    token, _ = await provision(client, "ops@neurotrace.app", "admin")
    resp = await client.post("/admin/users", headers=_auth(token), json={
        "email": "doctor@example.com", "password": "doctor@example.com", "role": "clinician"})
    assert resp.status_code == 422
    assert "email" in resp.json()["detail"]


# --------------------------------------------------------------------------- 6. headers
async def test_security_headers_and_no_store_on_auth(client):
    body = await _register(client)
    resp = await client.get("/auth/me", headers=_auth(body["tokens"]["access_token"]))
    assert resp.headers["cache-control"] == "no-store"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["referrer-policy"] == "no-referrer"
    health = await client.get("/health")
    assert "cache-control" not in health.headers
    assert health.headers["x-frame-options"] == "DENY"
