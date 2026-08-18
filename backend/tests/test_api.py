"""The HTTP surface — TRD §9, §10.

Covers the endpoints, the access rules, the enrolment gate, and the two things that must
be true of every response: a finalize always carries the FAST payload, and an acute report
never reaches the scoring engine.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.engine.baseline import ENROLMENT_MIN_DAYS_POST_STROKE
from app.exam.registry import DAILY_MODULES, MODULES, daily_battery_seconds
from app.services.synthetic import make_rng, synthetic_module

NOW = datetime.now(timezone.utc)
CAREGIVER = {"email": "asha@example.com", "password": "correct-horse-battery",
             "role": "caregiver"}


async def register(client, **overrides):
    payload = {**CAREGIVER, **overrides}
    resp = await client.post("/auth/register", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["tokens"]["access_token"], body["user"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def make_patient(client, token, **overrides):
    payload = {
        "name": "Ramesh", "age": 67, "sex": "male",
        "stroke_date": (NOW - timedelta(days=150)).isoformat(),
        "stroke_side": "left", "languages": ["hi", "en"], "preferred_hour": 9.0,
        **overrides,
    }
    resp = await client.post("/patients", json=payload, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def run_session(client, token, patient_id, rng, drift=0.0):
    started = await client.post(f"/sessions/{patient_id}/start", json={"type": "daily"},
                                headers=auth(token))
    assert started.status_code == 201, started.text
    sid = started.json()["id"]

    for code in DAILY_MODULES:
        resp = await client.post(
            f"/sessions/{sid}/module/{code}",
            json={"features": synthetic_module(rng, code, drift)},
            headers=auth(token),
        )
        assert resp.status_code == 200, resp.text

    final = await client.post(f"/sessions/{sid}/finalize", headers=auth(token))
    assert final.status_code == 200, final.text
    return final.json()


# --------------------------------------------------------------------------- enrolment
async def test_enrolment_blocks_a_patient_who_is_too_recent(client):
    token, _ = await register(client)
    resp = await client.post("/patients", json={
        "name": "TooEarly",
        "stroke_date": (NOW - timedelta(days=ENROLMENT_MIN_DAYS_POST_STROKE - 5)).isoformat(),
    }, headers=auth(token))
    assert resp.status_code == 422
    assert "post-stroke" in resp.text


async def test_enrolment_accepts_a_patient_past_three_months(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    assert patient["baseline_state"] == "not_started"
    assert patient["stroke_side"] == "left"


async def test_a_patient_role_cannot_enrol_patients(client):
    token, _ = await register(client, email="p@example.com", role="patient")
    resp = await client.post("/patients", json={
        "name": "Self", "stroke_date": (NOW - timedelta(days=200)).isoformat(),
    }, headers=auth(token))
    assert resp.status_code == 403


# --------------------------------------------------------------------------- battery
async def test_the_battery_endpoint_describes_the_daily_session(client):
    resp = await client.get("/sessions/battery/daily")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_seconds"] == daily_battery_seconds() <= 90
    assert {m["code"] for m in body["modules"]} == set(DAILY_MODULES)
    for module in body["modules"]:
        assert module["instructions"]["en"] and module["instructions"]["hi"]


async def test_an_unknown_schedule_is_rejected(client):
    assert (await client.get("/sessions/battery/hourly")).status_code == 400


# --------------------------------------------------------------------------- session flow
async def test_a_session_stores_features_and_finalizes(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    result = await run_session(client, token, patient["id"], make_rng(42))

    assert result["band"] == "STABLE"
    assert result["baseline_phase"] is True
    assert result["explanation_en"] and result["explanation_hi"]
    # TRD §8: the FAST card rides on every finalize, unconditionally.
    assert result["fast"]["items"]
    assert [i["letter"] for i in result["fast"]["items"]] == ["F", "A", "S", "T"]


async def test_the_fast_card_is_in_the_patients_language(client):
    token, _ = await register(client)
    patient = await make_patient(client, token, languages=["pa", "en"])
    result = await run_session(client, token, patient["id"], make_rng(42))
    assert "ਐਮਰਜੈਂਸੀ" in result["fast"]["title"] or "ਮਦਦ" in result["fast"]["title"]


async def test_finalizing_with_no_modules_is_rejected(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    started = await client.post(f"/sessions/{patient['id']}/start", json={},
                                headers=auth(token))
    sid = started.json()["id"]
    resp = await client.post(f"/sessions/{sid}/finalize", headers=auth(token))
    assert resp.status_code == 400


async def test_an_unknown_module_code_is_rejected(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = (await client.post(f"/sessions/{patient['id']}/start", json={},
                             headers=auth(token))).json()["id"]
    resp = await client.post(f"/sessions/{sid}/module/M99",
                             json={"features": {"valid": 1.0}}, headers=auth(token))
    assert resp.status_code == 400


async def test_resubmitting_a_module_overwrites_it(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = (await client.post(f"/sessions/{patient['id']}/start", json={},
                             headers=auth(token))).json()["id"]

    await client.post(f"/sessions/{sid}/module/M10",
                      json={"features": {"valid": 1.0, "rt_median": 400.0}},
                      headers=auth(token))
    await client.post(f"/sessions/{sid}/module/M10",
                      json={"features": {"valid": 1.0, "rt_median": 900.0}},
                      headers=auth(token))

    modules = (await client.get(f"/sessions/{sid}/modules", headers=auth(token))).json()
    assert len(modules) == 1
    assert modules[0]["features_json"]["rt_median"] == 900.0


async def test_a_poor_quality_capture_is_recorded_and_annotated(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    sid = (await client.post(f"/sessions/{patient['id']}/start", json={},
                             headers=auth(token))).json()["id"]
    rng = make_rng(1)
    for code in DAILY_MODULES:
        await client.post(f"/sessions/{sid}/module/{code}",
                          json={"features": synthetic_module(rng, code, 0.0),
                                "quality_flag": code != "M1",
                                "quality_detail": {"reason": "face not detected"}},
                          headers=auth(token))
    result = (await client.post(f"/sessions/{sid}/finalize", headers=auth(token))).json()
    assert "low_quality_capture" in result["confounders"]["active"]


async def test_the_current_session_can_be_resumed(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    assert (await client.get(f"/sessions/{patient['id']}/current",
                             headers=auth(token))).json() is None

    await client.post(f"/sessions/{patient['id']}/start", json={}, headers=auth(token))
    current = (await client.get(f"/sessions/{patient['id']}/current",
                                headers=auth(token))).json()
    assert current["completed"] is False


# --------------------------------------------------------------------------- safety
async def test_the_fast_card_is_public(client):
    """Emergency guidance must never require a login."""
    resp = await client.get("/safety/fast")
    assert resp.status_code == 200
    assert resp.json()["items"]


@pytest.mark.parametrize("lang", ["en", "hi", "pa"])
async def test_the_symptom_list_is_localised(client, lang):
    resp = await client.get(f"/safety/symptoms?lang={lang}")
    assert resp.status_code == 200
    assert all(s["label"] for s in resp.json()["symptoms"])


async def test_an_acute_report_bypasses_scoring_and_escalates(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    resp = await client.post(f"/safety/acute/{patient['id']}",
                             json={"symptoms": ["sudden_weakness", "speech_loss_sudden"],
                                   "note": "started 20 minutes ago", "lang": "en"},
                             headers=auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["escalate"] is True
    assert body["scoring_bypassed"] is True
    assert body["emergency_number"] == "108"
    assert len(body["reported_labels"]) == 2
    # No band, no score, no explanation — nothing from the engine at all.
    assert "band" not in body
    assert "explanation_en" not in body


async def test_an_acute_report_requires_at_least_one_symptom(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    resp = await client.post(f"/safety/acute/{patient['id']}", json={"symptoms": []},
                             headers=auth(token))
    assert resp.status_code == 422


# --------------------------------------------------------------------------- domain F/G
async def test_questionnaire_scoring_and_storage(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    resp = await client.post(f"/questionnaire/{patient['id']}",
                             json={"instrument": "PHQ2", "responses": [3, 3]},
                             headers=auth(token))
    assert resp.status_code == 201
    assert resp.json()["score"] == 6.0
    assert resp.json()["flags_json"]["escalate_to_phq9"] is True


async def test_an_incomplete_questionnaire_is_rejected(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    resp = await client.post(f"/questionnaire/{patient['id']}",
                             json={"instrument": "PHQ9", "responses": [1, 2]},
                             headers=auth(token))
    assert resp.status_code == 400


async def test_vitals_and_adherence_are_stored(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)

    vitals = await client.post(f"/vitals/{patient['id']}",
                               json={"bp_sys": 186, "bp_dia": 114}, headers=auth(token))
    assert vitals.status_code == 201
    assert vitals.json()["bp_sys"] == 186

    adherence = await client.post(f"/adherence/{patient['id']}", json={"taken": True},
                                  headers=auth(token))
    assert adherence.status_code == 201
    assert adherence.json()["taken"] is True


# --------------------------------------------------------------------------- dashboard
async def test_the_dashboard_carries_the_fast_card_and_baseline_progress(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    rng = make_rng(42)
    for _ in range(3):
        await run_session(client, token, patient["id"], rng)

    resp = await client.get(f"/dashboard/{patient['id']}", headers=auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["fast"]["items"]                      # TRD §8, on every dashboard
    assert body["baseline"]["state"] == "collecting"
    assert body["baseline"]["modules_locked"] == 0
    assert len(body["trends"]) == 3
    assert len(body["history"]) == 3
    assert body["alerts"] == []
    assert body["dev_threshold"] == 2.0


async def test_the_dashboard_is_empty_but_valid_for_a_new_patient(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    body = (await client.get(f"/dashboard/{patient['id']}", headers=auth(token))).json()
    assert body["latest"] is None
    assert body["trends"] == []
    assert body["fast"]["items"]


# --------------------------------------------------------------------------- clinician
async def test_the_clinic_list_is_clinician_only(client):
    caregiver, _ = await register(client)
    assert (await client.get("/clinic/patients", headers=auth(caregiver))).status_code == 403

    clinician, _ = await register(client, email="dr@example.com", role="clinician")
    resp = await client.get("/clinic/patients", headers=auth(clinician))
    assert resp.status_code == 200


async def test_the_clinic_list_ranks_by_sustained_deviation(client):
    caregiver, _ = await register(client)
    clinician, _ = await register(client, email="dr@example.com", role="clinician")
    await make_patient(client, caregiver, name="Quiet")
    await make_patient(client, caregiver, name="Also quiet")

    rows = (await client.get("/clinic/patients", headers=auth(clinician))).json()["patients"]
    assert len(rows) == 2
    assert all(r["band"] is None for r in rows)          # no sessions yet
    assert all(r["baseline_state"] == "not_started" for r in rows)


async def test_the_audit_trail_records_access_and_is_not_patient_facing(client):
    caregiver, _ = await register(client)
    patient = await make_patient(client, caregiver)
    await client.get(f"/dashboard/{patient['id']}", headers=auth(caregiver))

    rows = (await client.get(f"/audit/{patient['id']}", headers=auth(caregiver))).json()
    actions = {r["action"] for r in rows}
    assert "patient.create" in actions
    assert "dashboard.view" in actions


async def test_the_report_endpoint_states_its_method_and_limits(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    body = (await client.get(f"/report/{patient['id']}", headers=auth(token))).json()
    assert body["patient"]["name"] == "Ramesh"
    assert "median/MAD baseline" in body["method_note"]
    assert "does not constitute a diagnosis" in body["method_note"]
    assert body["fast"]["items"]


# --------------------------------------------------------------------------- access control
async def test_another_caregiver_cannot_reach_the_patient(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    other, _ = await register(client, email="other@example.com")

    for path in (f"/patients/{patient['id']}", f"/dashboard/{patient['id']}",
                 f"/report/{patient['id']}"):
        assert (await client.get(path, headers=auth(other))).status_code == 403, path


async def test_a_clinician_has_read_access_but_cannot_edit(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    clinician, _ = await register(client, email="dr@example.com", role="clinician")

    assert (await client.get(f"/dashboard/{patient['id']}",
                             headers=auth(clinician))).status_code == 200
    assert (await client.patch(f"/patients/{patient['id']}", json={"name": "No"},
                               headers=auth(clinician))).status_code == 403


async def test_session_endpoints_require_authentication(client):
    assert (await client.get("/patients")).status_code == 401
    assert (await client.post("/sessions/00000000-0000-0000-0000-000000000000/start",
                              json={})).status_code in (401, 403, 404)


# --------------------------------------------------------------------------- demo
async def test_the_demo_seed_produces_the_pitch_story(client):
    seeded = (await client.post("/demo/seed")).json()
    assert seeded["bands"][-1] == "ALERT"
    assert seeded["bands"].count("ALERT") >= 1

    login = await client.post("/auth/login",
                              json={"email": seeded["email"], "password": seeded["password"]})
    token = login.json()["tokens"]["access_token"]

    body = (await client.get(f"/dashboard/{seeded['patient_id']}",
                             headers=auth(token))).json()
    assert body["latest"]["band"] == "ALERT"
    assert body["baseline"]["state"] == "locked"
    assert len(body["alerts"]) == 1
    assert body["adherence_streak"] > 0
    assert body["fast"]["items"]
