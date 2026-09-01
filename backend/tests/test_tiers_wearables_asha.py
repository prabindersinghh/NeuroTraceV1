"""Deployment tiers, wearable ingestion, the fall bypass, and ASHA sync.

Also pins INV-7 (migrations never lose rows), which exists because migration 0005 silently
deleted every patient, session, score and baseline the first time it was run. See
`alembic/env.py` for the mechanism.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.auth.password import hash_password
from app.exam.registry import (
    MODULES,
    TIER_CAPABILITIES,
    modules_deferred_for_tier,
    modules_for_tier,
)
from app.models import (
    AshaVisit,
    DeploymentTier,
    FallEvent,
    Patient,
    Role,
    StrokeSide,
    User,
    WearableData,
    WearableMetric,
)

# Relative, not a fixed date: the wearable route drops readings older than
# MAX_BACKFILL_DAYS, so a literal date here became "too old" thirty days after it was
# written and the test failed with stored == 0 on 2026-08-31, with nothing changed.
NOW = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)


# --------------------------------------------------------------- tier-gated modules
def test_deep_assessment_modules_need_more_than_a_phone():
    """Line bisection on a 6-inch screen measures the screen, not the patient.

    M3 deliberately does NOT appear here any more. When scope widened to posterior
    circulation it was rewritten around saccades and pursuit — which a front camera CAN
    measure — and moved to the phone, because gating it behind an ASHA visit meant checking
    the patients who most need it least often.
    """
    assert MODULES["M12"].requires_device == "tablet"       # neglect / line bisection
    assert MODULES["M3"].requires_device == "phone"         # promoted, see D-006
    # M9 runs on a phone for its low-motion tasks and defers the rest PER TASK, so
    # module-level gating no longer describes it. See test_the_visit_workload_is_task_aware.
    assert MODULES["M9"].requires_device == "phone"
    assert MODULES["M9"].task_devices["unterberger"] == "floor_space"
    # ...and the daily battery must stay runnable on the base tier.
    for code in ("M1", "M4", "M7", "M10", "M13", "M19"):
        assert MODULES[code].requires_device == "phone", code


def test_tier_one_is_not_offered_modules_it_cannot_run_validly():
    assert "M12" not in modules_for_tier("monthly", "TIER_1_PHONE")
    # M3 and M9 ARE offered — both run on a phone now, M9 partially.
    assert "M3" in modules_for_tier("weekly", "TIER_1_PHONE")
    assert "M9" in modules_for_tier("weekly", "TIER_1_PHONE")


def test_a_watch_does_not_unlock_tablet_modules():
    """TIER_2 adds passive sensing, not a bigger screen. This is the easy mistake."""
    assert modules_for_tier("monthly", "TIER_2_WATCH") == \
        modules_for_tier("monthly", "TIER_1_PHONE")
    assert TIER_CAPABILITIES["TIER_2_WATCH"] == TIER_CAPABILITIES["TIER_1_PHONE"]


def test_the_asha_tier_unlocks_everything():
    assert "M12" in modules_for_tier("monthly", "TIER_3_ASHA")
    assert "M9" in modules_for_tier("weekly", "TIER_3_ASHA")
    assert modules_deferred_for_tier(None, "TIER_3_ASHA") == []


def test_deferred_modules_are_reported_not_silently_dropped():
    """A clinician has to be able to see what is missing and why."""
    assert modules_deferred_for_tier(None, "TIER_1_PHONE") == ["M12"]


def test_the_visit_workload_is_task_aware():
    """This has now been got wrong twice, in opposite directions.

    First: the ASHA list asked only about MONTHLY modules, so weekly M9 never appeared and
    the module a posterior-circulation patient most needs a visit for was missing.

    Then: making M9 phone-runnable for its low-motion subset removed it from module-level
    deferral entirely, and the walking and stepping tests that STILL need someone present
    became invisible again — the same gap, one level down.

    The visit workload must therefore be expressed in TASKS.
    """
    from app.exam.registry import visit_workload_for_tier

    workload = visit_workload_for_tier("TIER_1_PHONE")
    assert "M9" in workload, (
        "the balance tests that need someone present must reach the ASHA worker")
    assert set(workload["M9"]) == {"tandem_walk", "unterberger"}
    # ...and NOT the three the family already did this week.
    assert "romberg_eyes_open" not in workload["M9"]
    assert "tandem_stance" not in workload["M9"]

    assert "M12" in workload
    assert visit_workload_for_tier("TIER_3_ASHA") == {}


def test_the_daily_battery_is_identical_across_tiers():
    base = modules_for_tier("daily", "TIER_1_PHONE")
    assert base == modules_for_tier("daily", "TIER_3_ASHA")
    assert base, "the daily check-in is the base product and must never be empty"


# --------------------------------------------------------------- fixtures
async def _caregiver(session) -> User:
    user = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com",
                pw_hash=hash_password("a-real-password"), role=Role.caregiver)
    session.add(user)
    # Commit, not flush: the HTTP client runs on its own session and cannot see
    # uncommitted work.
    await session.commit()
    return user


async def _patient(session, caregiver, *, tier=DeploymentTier.TIER_2_WATCH,
                   asha_id=None) -> Patient:
    patient = Patient(
        caregiver_id=caregiver.id, name="Ramesh", age=67,
        stroke_date=NOW - timedelta(days=200), stroke_side=StrokeSide.left,
        languages=["en"], deployment_tier=tier, asha_worker_id=asha_id,
    )
    session.add(patient)
    await session.commit()
    return patient


async def _token(client, provision, role: str) -> tuple[str, dict]:
    """`asha_worker` is a privileged role now provisioned server-side, not self-registered
    via `/auth/register` (D-040) — this delegates to the same `conftest.provision` fixture
    every other privileged-role test uses, rather than routing around the fix."""
    token, _ = await provision(client, f"u-{uuid.uuid4().hex[:8]}@example.com", role)
    return token, {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------- wearable ingestion
async def test_wearable_readings_are_stored_with_their_source(session, client):
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver)

    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}

    body = {
        "source": "samsung_health",
        "device_id": "galaxy-watch-6-abc",
        "readings": [
            {"metric": "heart_rate", "value": 78.0, "unit": "bpm",
             "ts": NOW.isoformat()},
            {"metric": "sleep_quality", "value": 0.62, "unit": "score",
             "ts": NOW.isoformat()},
            {"metric": "step_count", "value": 2400, "unit": "steps",
             "ts": NOW.isoformat()},
        ],
    }
    r = await client.post(f"/wearable/{patient.id}", json=body, headers=headers)
    assert r.status_code == 201, r.text
    payload = r.json()
    assert payload["stored"] == 3

    rows = list(await session.scalars(
        select(WearableData).where(WearableData.patient_id == patient.id)))
    assert len(rows) == 3
    assert {r.source for r in rows} == {"samsung_health"}
    assert {r.device_id for r in rows} == {"galaxy-watch-6-abc"}


async def test_we_never_claim_the_measurement_only_the_trend(session, client):
    """The claim boundary, enforced in the response an integrator actually reads."""
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}

    r = await client.post(f"/wearable/{patient.id}", json={
        "source": "samsung_health",
        "readings": [{"metric": "heart_rate", "value": 78.0, "ts": NOW.isoformat()}],
    }, headers=headers)
    notice = r.json()["claim_notice"].lower()
    assert "no measurement claim" in notice
    assert "manufacturer" in notice


async def test_a_phone_only_patient_cannot_receive_device_data(session, client):
    """If the dashboard says phone-only, device data arriving is a configuration error,
    not something to quietly accept."""
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver, tier=DeploymentTier.TIER_1_PHONE)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}

    r = await client.post(f"/wearable/{patient.id}", json={
        "source": "samsung_health",
        "readings": [{"metric": "heart_rate", "value": 78.0, "ts": NOW.isoformat()}],
    }, headers=headers)
    assert r.status_code == 409
    assert "phone-only" in r.text


# --------------------------------------------------------------- the fall bypass
async def test_a_fall_bypasses_the_deviation_engine_entirely(session, client):
    """A fall is an event, not a trend.

    Routing it through the gates would mean waiting for a second corroborating domain
    across two sessions while somebody is on the floor.
    """
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}

    r = await client.post(f"/wearable/{patient.id}/fall", json={
        "source": "samsung_health", "ts": NOW.isoformat(),
        "device_id": "galaxy-watch-6-abc", "device_confidence": 0.91,
    }, headers=headers)
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["scoring_bypassed"] is True
    assert body["caregiver_notified"] is True
    assert "108" in body["message"]
    # No engine fields anywhere in the response.
    assert not ({"band", "domain_deviations", "confidence", "gate1_passed"} & set(body))
    # ...and nothing was scored.
    from app.models import Score
    assert await session.scalar(select(func.count()).select_from(Score)) == 0


async def test_the_fall_claim_sits_with_the_device(session, client):
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}
    r = await client.post(f"/wearable/{patient.id}/fall", json={
        "source": "samsung_health", "ts": NOW.isoformat()}, headers=headers)
    notice = r.json()["claim_notice"].lower()
    assert "device" in notice
    assert "does not itself detect falls" in notice


async def test_a_fall_the_patient_dismissed_is_still_recorded(session, client):
    """They may have dismissed it because they are embarrassed, or confused."""
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}
    r = await client.post(f"/wearable/{patient.id}/fall", json={
        "source": "samsung_health", "ts": NOW.isoformat(),
        "dismissed_by_patient": True}, headers=headers)
    assert r.status_code == 201
    assert r.json()["dismissed_by_patient"] is True
    assert await session.scalar(select(func.count()).select_from(FallEvent)) == 1


# --------------------------------------------------------------- ASHA
async def test_an_asha_worker_sees_only_their_own_households(session, client, provision):
    token, headers = await _token(client, provision, "asha_worker")
    worker = await session.scalar(select(User).where(User.role == Role.asha_worker))

    caregiver = await _caregiver(session)
    mine = await _patient(session, caregiver, tier=DeploymentTier.TIER_3_ASHA,
                          asha_id=worker.id)
    await _patient(session, caregiver, tier=DeploymentTier.TIER_3_ASHA)  # someone else's

    r = await client.get("/asha/households", headers=headers)
    assert r.status_code == 200, r.text
    ids = [h["patient_id"] for h in r.json()["households"]]
    assert ids == [str(mine.id)]
    assert r.json()["total"] == 1


async def test_the_household_list_says_what_the_visit_is_for(session, client, provision):
    token, headers = await _token(client, provision, "asha_worker")
    worker = await session.scalar(select(User).where(User.role == Role.asha_worker))
    caregiver = await _caregiver(session)
    await _patient(session, caregiver, tier=DeploymentTier.TIER_3_ASHA, asha_id=worker.id)

    household = (await client.get("/asha/households", headers=headers)).json()["households"][0]
    assert set(household["due_modules"]) == {"M9", "M12"}
    assert set(household["due_tasks"]["M9"]) == {"tandem_walk", "unterberger"}, (
        "the worker must be told which balance tests to run, not to repeat the whole module")


async def test_a_caregiver_cannot_reach_the_asha_surface(session, client):
    caregiver = await _caregiver(session)
    resp = await client.post("/auth/login", json={
        "email": caregiver.email, "password": "a-real-password"})
    headers = {"Authorization": f"Bearer {resp.json()['tokens']['access_token']}"}
    assert (await client.get("/asha/households", headers=headers)).status_code == 403


async def test_asha_sync_is_idempotent_across_a_retry(session, client, provision):
    """A worker on a bad connection will retry. Duplicates in a baseline silently reweight
    the median, so a retry must land on the same visit."""
    token, headers = await _token(client, provision, "asha_worker")
    worker = await session.scalar(select(User).where(User.role == Role.asha_worker))
    caregiver = await _caregiver(session)
    patient = await _patient(session, caregiver, tier=DeploymentTier.TIER_3_ASHA,
                             asha_id=worker.id)

    body = {
        "patient_id": str(patient.id),
        "client_visit_id": "visit-2026-08-01-0007",
        "ts": NOW.isoformat(),
        "device_id": "asha-tablet-12",
        "modules": {"M12": {"omission_asymmetry": 0.1, "bisection_deviation_abs": 0.02,
                            "valid": 1.0}},
    }
    first = await client.post("/asha/session", json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert first.json()["created"] is True
    assert first.json()["modules_stored"] == ["M12"]

    second = await client.post("/asha/session", json=body, headers=headers)
    assert second.status_code == 201
    assert second.json()["created"] is False
    assert second.json()["visit_id"] == first.json()["visit_id"]

    assert await session.scalar(select(func.count()).select_from(AshaVisit)) == 1


async def test_an_asha_worker_cannot_submit_for_another_workers_household(session, client, provision):
    token, headers = await _token(client, provision, "asha_worker")
    caregiver = await _caregiver(session)
    not_mine = await _patient(session, caregiver, tier=DeploymentTier.TIER_3_ASHA)

    r = await client.post("/asha/session", json={
        "patient_id": str(not_mine.id), "client_visit_id": "v1",
        "ts": NOW.isoformat(), "modules": {}}, headers=headers)
    assert r.status_code == 403
    assert "not on your list" in r.text


# --------------------------------------------------------------- INV-7
def test_migrations_never_delete_rows():
    """INV-7, pinned because it was broken.

    `alembic/env.py` must not build its engine with foreign-key enforcement on. SQLite
    cannot ALTER a constraint, so Alembic's batch mode rebuilds a table by dropping the
    original — and dropping a PARENT table with enforcement on cascades the delete into
    every child. Migration 0005 rebuilds `users`; the first run of it emptied the database.
    """
    env = Path(__file__).resolve().parents[1] / "alembic" / "env.py"
    source = env.read_text(encoding="utf-8")
    assert "create_async_engine" in source, "env.py must build its own engine"
    # Check the code, not the prose: the docstring names make_engine to explain why it
    # is NOT used, so a bare substring search would pass or fail for the wrong reason.
    assert "make_engine(" not in source, (
        "env.py must NOT call app.db.make_engine - it enables PRAGMA foreign_keys, "
        "which makes every batch migration on a parent table destructive"
    )
    assert "import Base, make_engine" not in source, (
        "env.py must not import make_engine")
    assert "foreign_key_check" in source, (
        "env.py must verify integrity after migrating")