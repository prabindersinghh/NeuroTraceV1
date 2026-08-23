"""The identity endpoints and what a session records about them.

The check itself runs on the device (`frontend/src/lib/ondevice/identity.ts`, tested there
in both directions). What the server owes is narrower and tested here: store the vector,
hand it back only to someone authorised, and record the verdict on the session WITHOUT
ever letting it reject a measurement.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime.now(timezone.utc)
CAREGIVER = {"email": "asha@example.com", "password": "correct-horse-battery",
             "role": "caregiver"}

SIGNATURE = {
    "values": {"interocular_over_height": 0.6, "jaw_width_over_height": 0.8},
    "spread": {"interocular_over_height": 0.01, "jaw_width_over_height": 0.02},
    "frames": 40,
    "enrolled_at": NOW.isoformat(),
}


async def register(client, **overrides):
    resp = await client.post("/auth/register", json={**CAREGIVER, **overrides})
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def make_patient(client, token):
    resp = await client.post("/patients", json={
        "name": "Ramesh", "age": 67, "sex": "male",
        "stroke_date": (NOW - timedelta(days=150)).isoformat(),
        "stroke_side": "left", "languages": ["hi", "en"], "preferred_hour": 9.0,
    }, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def test_a_patient_who_never_enrolled_returns_null_not_an_error(client):
    """Unenrolled is an ordinary state, not a failure — most patients will be here."""
    token = await register(client)
    pid = await make_patient(client, token)
    resp = await client.get(f"/patients/{pid}/identity", headers=auth(token))
    assert resp.status_code == 200
    assert resp.json()["signature"] is None


async def test_the_signature_round_trips(client):
    token = await register(client)
    pid = await make_patient(client, token)
    saved = await client.post(f"/patients/{pid}/identity",
                              json={"signature": SIGNATURE}, headers=auth(token))
    assert saved.status_code == 200, saved.text
    got = await client.get(f"/patients/{pid}/identity", headers=auth(token))
    assert got.json()["signature"] == SIGNATURE


async def test_a_later_calibration_patch_does_not_wipe_the_enrolment(client):
    """Enrolment and device calibration share one column and have different owners.

    `PatientUpdate.calibration_json` replaces the stored dict — correct for the caller
    that owns device calibration, fatal for the enrolment vector written by a different
    endpoint. Without the carry-over in `update_patient`, a routine calibration PATCH
    silently un-enrols the patient and the same-person check stops running with nothing
    reporting that it had.
    """
    token = await register(client)
    pid = await make_patient(client, token)
    await client.post(f"/patients/{pid}/identity", json={"signature": SIGNATURE},
                      headers=auth(token))
    patched = await client.patch(f"/patients/{pid}",
                                 json={"calibration_json": {"screen_dpi": 411}},
                                 headers=auth(token))
    assert patched.status_code == 200, patched.text

    still_there = await client.get(f"/patients/{pid}/identity", headers=auth(token))
    assert still_there.json()["signature"] == SIGNATURE, "enrolment was silently wiped"


async def test_an_explicit_identity_in_the_patch_still_wins(client):
    """The carry-over is a safety net, not a lock: a caller that means to set it, can."""
    token = await register(client)
    pid = await make_patient(client, token)
    await client.post(f"/patients/{pid}/identity", json={"signature": SIGNATURE},
                      headers=auth(token))
    await client.patch(f"/patients/{pid}",
                       json={"calibration_json": {"identity": None}},
                       headers=auth(token))
    resp = await client.get(f"/patients/{pid}/identity", headers=auth(token))
    assert resp.json()["signature"] is None


async def test_another_caregiver_cannot_read_the_signature(client):
    token = await register(client)
    pid = await make_patient(client, token)
    await client.post(f"/patients/{pid}/identity", json={"signature": SIGNATURE},
                      headers=auth(token))
    other = await register(client, email="someone.else@example.com")
    resp = await client.get(f"/patients/{pid}/identity", headers=auth(other))
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.parametrize("verified,score", [(True, 0.9), (False, 0.2)])
async def test_a_failed_check_is_recorded_but_never_rejects_the_session(
    client, verified, score
):
    """The whole design rests on this: flag, do not block.

    A stroke survivor locked out of their own check-in because the light changed is a
    worse outcome than a measurement carrying a confounder.
    """
    token = await register(client)
    pid = await make_patient(client, token)
    resp = await client.post(f"/sessions/{pid}/start", json={
        "type": "daily", "identity_verified": verified, "identity_score": score,
    }, headers=auth(token))
    assert resp.status_code == 201, resp.text  # accepted either way


async def test_a_session_that_says_nothing_about_identity_is_not_marked_suspect(client):
    """Omitted means 'not checked'. It must not read as 'checked and failed'."""
    token = await register(client)
    pid = await make_patient(client, token)
    resp = await client.post(f"/sessions/{pid}/start", json={"type": "daily"},
                             headers=auth(token))
    assert resp.status_code == 201, resp.text


async def test_the_score_must_be_a_probability(client):
    token = await register(client)
    pid = await make_patient(client, token)
    resp = await client.post(f"/sessions/{pid}/start", json={
        "type": "daily", "identity_score": 42.0,
    }, headers=auth(token))
    assert resp.status_code == 422
