"""An erased patient must not break the surfaces that still list them — Part 5.4.

THE BUG THIS PINS. `erase_patient_data` sets `patient.name = ""` on the tombstone, which is
the honest value: after an erasure we hold no name. `PatientBase.name` carried
`Field(min_length=1)`, and `PatientRead` inherited it. So every route with
`response_model=PatientRead` raised `string_too_short` on that row — and because
`GET /patients` validates the whole list, ONE erasure returned **500 for that caregiver's
entire roster, permanently**, including the patients that were never erased.

It survived because `test_erasure.py` proves the data is gone by querying the database
directly, and nothing ever listed the caregiver's patients over HTTP afterwards. Found by
driving a real erasure against a running server while building the consent/erasure UI.

The fix is on the READ schema only. The last test here is the half that keeps it honest:
`PatientCreate` and `PatientUpdate` must still refuse an empty name.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

NOW = datetime.now(timezone.utc)


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def register_caregiver(client, email: str = "roster@example.com") -> str:
    resp = await client.post("/auth/register", json={
        "email": email, "password": "correct-horse-battery", "role": "caregiver",
    })
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


async def make_patient(client, token: str, name: str) -> str:
    resp = await client.post("/patients", json={
        "name": name, "age": 68, "sex": "female",
        "stroke_date": (NOW - timedelta(days=200)).isoformat(),
        "stroke_side": "left", "languages": ["pa", "en"],
    }, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
async def test_the_roster_survives_an_erasure(client):
    """One erased patient must not take an unrelated patient's card down with it."""
    token = await register_caregiver(client)
    erased_id = await make_patient(client, token, "Erased Person")
    kept_id = await make_patient(client, token, "Still Here")

    resp = await client.delete(f"/patients/{erased_id}?reason=test", headers=auth(token))
    assert resp.status_code == 200, resp.text

    resp = await client.get("/patients", headers=auth(token))
    assert resp.status_code == 200, f"an erasure broke the whole roster: {resp.text}"

    rows = {p["id"]: p for p in resp.json()}
    assert kept_id in rows, "an erasure removed an unrelated patient from the roster"
    assert rows[kept_id]["erased_at"] is None

    tombstone = rows[erased_id]
    assert tombstone["name"] == "", "the tombstone should carry no name"
    assert tombstone["erased_at"] is not None, (
        "without erased_at a client cannot tell a tombstone from a patient whose name "
        "failed to load, so the roster renders a blank card with no explanation"
    )


@pytest.mark.asyncio
async def test_the_single_patient_route_survives_an_erasure(client):
    """`GET /patients/{id}` returns the same schema and failed the same way."""
    token = await register_caregiver(client, "roster-one@example.com")
    patient_id = await make_patient(client, token, "Erased Person")
    await client.delete(f"/patients/{patient_id}?reason=test", headers=auth(token))

    resp = await client.get(f"/patients/{patient_id}", headers=auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["name"] == ""
    assert resp.json()["erased_at"] is not None


@pytest.mark.asyncio
async def test_a_patient_still_cannot_be_created_or_renamed_nameless(client):
    """Relaxing the READ schema must not relax the write path."""
    token = await register_caregiver(client, "roster-write@example.com")

    resp = await client.post("/patients", json={
        "name": "", "stroke_date": (NOW - timedelta(days=200)).isoformat(),
    }, headers=auth(token))
    assert resp.status_code == 422, "an empty name must still be rejected on create"

    patient_id = await make_patient(client, token, "Real Name")
    resp = await client.patch(
        f"/patients/{patient_id}", json={"name": ""}, headers=auth(token))
    assert resp.status_code == 422, "an empty name must still be rejected on update"
