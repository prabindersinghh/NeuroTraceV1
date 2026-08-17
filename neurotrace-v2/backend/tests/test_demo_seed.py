"""The demo dataset must tell the pitch story: STABLE -> WATCH -> ALERT, every time."""
from __future__ import annotations

import uuid

from sqlalchemy import func, select

from app.models import Alert, DailySample, Patient, Score, User
from app.services.seed import DEMO_EMAIL, DEMO_PASSWORD, DEMO_PATIENT_NAME, seed_demo
from app.services.synthetic import DEMO_PLAN


async def test_seed_builds_the_ten_day_story(session):
    result = await seed_demo(session)

    assert result["email"] == DEMO_EMAIL
    assert result["days"] == len(DEMO_PLAN) == 10
    assert result["bands"][:7] == ["STABLE"] * 7          # 4 baseline + 3 stable
    assert result["bands"][7:9] == ["WATCH", "WATCH"]
    assert result["bands"][9] == "ALERT"

    patient = await session.get(Patient, uuid.UUID(result["patient_id"]))
    assert patient is not None
    assert patient.name == DEMO_PATIENT_NAME
    assert patient.age == 67
    assert patient.baseline_ready is True

    assert await session.scalar(select(func.count()).select_from(Score)) == 10
    assert await session.scalar(select(func.count()).select_from(DailySample)) == 10
    assert await session.scalar(select(func.count()).select_from(Alert)) == 1


async def test_seed_days_land_on_consecutive_calendar_days(session):
    result = await seed_demo(session)
    stamps = list(
        await session.scalars(
            select(DailySample.ts)
            .where(DailySample.patient_id == uuid.UUID(result["patient_id"]))
            .order_by(DailySample.ts)
        )
    )
    assert len(stamps) == 10
    gaps = {(b - a).days for a, b in zip(stamps, stamps[1:])}
    assert gaps == {1}


async def test_seeding_twice_is_idempotent(session):
    first = await seed_demo(session)
    second = await seed_demo(session)

    assert first["patient_id"] != second["patient_id"]      # the old demo patient is replaced
    assert first["bands"] == second["bands"]                 # ...and the story is identical

    assert await session.scalar(select(func.count()).select_from(User)) == 1
    assert await session.scalar(select(func.count()).select_from(Patient)) == 1
    assert await session.scalar(select(func.count()).select_from(Score)) == 10
    assert await session.scalar(select(func.count()).select_from(Alert)) == 1


async def test_demo_endpoint_seeds_and_the_credentials_work(client):
    seeded = (await client.post("/demo/seed")).json()
    assert seeded["bands"][-1] == "ALERT"

    login = await client.post(
        "/auth/login", json={"email": seeded["email"], "password": DEMO_PASSWORD}
    )
    assert login.status_code == 200, login.text
    token = login.json()["tokens"]["access_token"]

    dash = await client.get(
        f"/dashboard/{seeded['patient_id']}", headers={"Authorization": f"Bearer {token}"}
    )
    assert dash.status_code == 200, dash.text
    body = dash.json()
    assert body["latest"]["band"] == "ALERT"
    assert len(body["trends"]) == 10
    assert len(body["alerts"]) == 1
    assert body["latest_explanation_en"] and body["latest_explanation_hi"]
