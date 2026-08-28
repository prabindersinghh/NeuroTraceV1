"""The protocol as the RUNNING SYSTEM serves and consumes it.

test_session_plan.py pins the plan's internal logic. These tests pin the three seams the
frontend rebuild introduced, because each one is a place where a quiet drift would produce
sessions that look complete and are wrong:

  1. `/sessions/plan/{intensity}` — the wire format the runner executes.
  2. The TypeScript mirror — the OFFLINE protocol must be the online protocol.
  3. Raw-point submission — server-side extraction, fatigue fields, practice exclusion.
"""
from __future__ import annotations

import math
import re
from pathlib import Path

import numpy as np
import pytest

from tests.test_api import auth, make_patient, register

REPO = Path(__file__).resolve().parents[2]


# ------------------------------------------------------------------ 1 · the plan endpoint
async def test_the_plan_endpoint_serves_the_full_protocol(client):
    res = await client.get("/sessions/plan/full")
    assert res.status_code == 200
    body = res.json()
    assert len(body["steps"]) == 21
    assert body["planned_seconds"] == sum(s["seconds"] for s in body["steps"])
    # The gate must sit exactly at the standing block's entrance.
    first_c = next(s["position"] for s in body["steps"] if s["block"].startswith("C_"))
    assert body["fall_gate_before_position"] == first_c
    # Positions are canonical and strictly increasing — reordering is a spec change,
    # not something a serializer is allowed to do.
    positions = [s["position"] for s in body["steps"]]
    assert positions == sorted(positions)


async def test_an_unknown_intensity_is_a_400_not_a_default(client):
    """Silently serving FULL to a typo'd intensity would run a fatigued patient through
    twenty-one steps because of a spelling mistake."""
    res = await client.get("/sessions/plan/maximum")
    assert res.status_code == 400


# ------------------------------------------------------------- 2 · the TypeScript mirror
def test_the_typescript_mirror_matches_the_python_protocol():
    """The offline mirror IS the protocol, or the airplane-mode session runs a fork.

    Parsed with a regex rather than a JS runtime — crude, but the mirror is a literal
    array precisely so that this test can read it. If the format changes, this failing
    is the reminder that the mirror and the parser move together.
    """
    from app.exam.session_plan import PROTOCOL

    ts = (REPO / "frontend/src/lib/protocol.ts").read_text(encoding="utf-8")
    rows = re.findall(
        r'\{ position: (\d+), module: "([^"]+)", task: "([^"]+)", block: "([^"]+)", '
        r"seconds: (\d+),",
        ts,
    )
    assert rows, "PROTOCOL_MIRROR not found in protocol.ts — did its shape change?"
    mirror = [(int(p), m, t, b, int(sec)) for p, m, t, b, sec in rows]
    truth = [(s.position, s.module, s.task, s.block.value, s.seconds) for s in PROTOCOL]
    assert mirror == truth, "frontend PROTOCOL_MIRROR has drifted from session_plan.PROTOCOL"


def test_every_web_runnable_task_exists_in_the_protocol():
    from app.exam.session_plan import PROTOCOL

    ts = (REPO / "frontend/src/lib/protocol.ts").read_text(encoding="utf-8")
    block = ts[ts.index("export const WEB_RUNNABLE") : ts.index("export const WEB_EXCLUDED")]
    runnable = set(re.findall(r'"([a-z0-9_]+)"', block))
    protocol_tasks = {s.task for s in PROTOCOL}
    unknown = runnable - protocol_tasks
    assert not unknown, f"WEB_RUNNABLE names tasks the protocol does not have: {unknown}"


# ------------------------------------------------- 3 · raw submission and its side effects
async def _start(client, token, patient_id, **kw):
    res = await client.post(f"/sessions/{patient_id}/start", json={"type": "DAILY_PULSE", **kw},
                            headers=auth(token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def test_raw_ppg_is_extracted_server_side(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = await _start(client, token, patient["id"])

    # A clean 72 bpm synthetic pulse at 30 Hz — the extractor should find the rhythm.
    fs, seconds = 30.0, 60.0
    t = np.arange(0, seconds, 1 / fs)
    ppg = (100 + 10 * np.sin(2 * math.pi * 1.2 * t)).round(2).tolist()

    res = await client.post(
        f"/sessions/{sid}/module/M17",
        json={"features": {}, "raw": {"ppg": ppg, "fs": fs},
              "session_position": 21, "elapsed_seconds_at_task_start": 640.0,
              "intensity": "full", "paused_before_task": False},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    feats = res.json()["features_json"]
    assert feats.get("valid") == 1.0, feats
    assert "rr_mean_ms" in feats or any(k.startswith("rr_") for k in feats), feats


async def test_raw_balance_fills_the_trace_the_clinician_reads(client):
    """M9 raw points must produce trace_json — the /trace endpoint was reading a column
    nothing wrote, which made the CCG view an endpoint over an empty field."""
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = await _start(client, token, patient["id"])

    rng = np.random.default_rng(7)
    def wander(n):
        steps = rng.normal(0, 0.002, size=(n, 2))
        return (0.5 + np.cumsum(steps, axis=0)).round(4).tolist()

    res = await client.post(
        f"/sessions/{sid}/module/M9",
        json={"features": {}, "raw": {
            "fps": 30.0, "head_width_norm": 0.11, "head_width_cm": 15.0,
            "tests": {"romberg_eyes_open": wander(300),
                      "romberg_eyes_closed": wander(300),
                      "tandem_stance": wander(300)},
        }},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    feats = res.json()["features_json"]
    assert "romberg_quotient" in feats, feats

    trace = (await client.get(f"/trace/{patient['id']}", headers=auth(token))).json()
    assert trace["traces"], "trace_json still empty after an M9 raw submission"
    assert "romberg_eyes_closed" in trace["traces"]


async def test_fatigue_fields_survive_to_the_row(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = await _start(client, token, patient["id"])

    res = await client.post(
        f"/sessions/{sid}/module/M7",
        json={"features": {"valid": 1.0, "taps_per_s_R": 4.0},
              "session_position": 15, "elapsed_seconds_at_task_start": 402.5,
              "intensity": "standard", "paused_before_task": True},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_position"] == 15
    assert body["elapsed_seconds_at_task_start"] == 402.5
    assert body["intensity"] == "standard"
    assert body["paused_before_task"] is True


# ------------------------------------------------------------------- 4 · practice runs
async def test_a_practice_session_is_stored_but_never_scored(client):
    """The patient is learning the tasks. A learning attempt inside the baseline would
    manufacture a week of false improvement that is really just familiarity."""
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = await _start(client, token, patient["id"], is_practice=True)

    await client.post(f"/sessions/{sid}/module/M7",
                      json={"features": {"valid": 1.0, "taps_per_s_R": 4.2}},
                      headers=auth(token))
    res = await client.post(f"/sessions/{sid}/finalize", headers=auth(token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["reason"] == "practice"
    assert body["band"] == "STABLE"
    assert body["confidence"] == 0.0
    # And the FAST card still rides along — TRD §8 is unconditional.
    assert body["fast"]["items"]


async def test_patient_settings_patch_round_trips(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    res = await client.patch(
        f"/patients/{patient['id']}",
        json={"intensity": "STANDARD", "aphasia_mode": True,
              "consent_version": "2026-08-v4", "onboarding_complete": True},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["intensity"] == "STANDARD"
    assert body["aphasia_mode"] is True
    assert body["consent_version"] == "2026-08-v4"
    assert body["onboarding_complete"] is True
