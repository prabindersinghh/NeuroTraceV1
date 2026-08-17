"""End-to-end over HTTP: patients -> capture -> finalize -> dashboard.

The ten-day journey uploads real WAV files and real WebM videos and runs them through
librosa + Praat and MediaPipe FaceMesh. Nothing here is stubbed; the only thing the
fixtures control is how degraded the media is on each day.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.config import settings

from .fixtures_media import reaction_payload, write_face_video, write_wav

CAREGIVER = {"email": "asha@example.com", "password": "correct-horse-battery", "role": "caregiver"}

BASELINE_DAYS = 4
PLAN = [0.0] * BASELINE_DAYS + [0.0, 0.0, 0.0] + [1.0, 1.6, 2.2]


async def register(client, **overrides) -> tuple[str, dict]:
    body = {**CAREGIVER, **overrides}
    resp = await client.post("/auth/register", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return data["tokens"]["access_token"], data["user"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def make_patient(client, token: str, **overrides) -> dict:
    payload = {"name": "Ramesh", "age": 67, "sex": "male", "language": "hi", **overrides}
    resp = await client.post("/patients", json=payload, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def run_day(client, token, patient_id, tmp_path, day: int, drift: float) -> dict:
    """One complete check-in: audio + video + reaction + finalize."""
    rng = np.random.default_rng(1000 + day)
    wav = write_wav(tmp_path / f"d{day}.wav", rng, drift)
    webm = write_face_video(tmp_path / f"d{day}.webm", rng, drift)

    with wav.open("rb") as fh:
        r = await client.post(
            f"/checkin/{patient_id}/audio",
            files={"file": (wav.name, fh.read(), "audio/wav")},
            headers=auth(token),
        )
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is True, "voice extraction produced valid=0"

    with webm.open("rb") as fh:
        r = await client.post(
            f"/checkin/{patient_id}/video",
            files={"file": (webm.name, fh.read(), "video/webm")},
            headers=auth(token),
        )
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is True, "face extraction produced valid=0"

    r = await client.post(
        f"/checkin/{patient_id}/reaction",
        json=reaction_payload(rng, drift),
        headers=auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is True

    r = await client.post(f"/checkin/{patient_id}/finalize", headers=auth(token))
    assert r.status_code == 200, r.text

    wav.unlink(missing_ok=True)
    webm.unlink(missing_ok=True)
    return r.json()


# --------------------------------------------------------------------------- the journey
async def test_ten_day_journey_over_http(client, tmp_path):
    """Ten real check-ins: 4 baseline, 3 stable, 3 declining.

    One test rather than seven because every day runs librosa, Praat and MediaPipe for
    real — re-running the journey per assertion would multiply the cost with no extra
    coverage.
    """
    token, _ = await register(client)
    patient = await make_patient(client, token)
    results = [
        await run_day(client, token, patient["id"], tmp_path, day, drift)
        for day, drift in enumerate(PLAN, start=1)
    ]

    # --- every modality really extracted, every day ---
    for day, result in enumerate(results, start=1):
        assert result["valid_modalities"] == {"voice": True, "face": True, "reaction": True}, day

    # --- days 1-4: baseline is built, not judged ---
    for result in results[:BASELINE_DAYS]:
        assert result["baseline_day"] is True
        assert result["band"] == "STABLE"
        assert result["alert_id"] is None
    assert results[0]["baseline_ready"] is False
    assert results[BASELINE_DAYS - 1]["baseline_ready"] is True

    # --- days 5-7: stable, and no false alert (PRD §7 acceptance) ---
    for result in results[BASELINE_DAYS:BASELINE_DAYS + 3]:
        assert result["baseline_day"] is False
        assert result["band"] == "STABLE", result["reason"]
        assert result["alert_id"] is None
        assert max(result["deviations"].values()) < 2.0

    # --- days 8-9: deviating but not yet cross-validated ---
    assert results[7]["band"] == "WATCH", results[7]["reason"]
    assert results[8]["band"] == "WATCH", results[8]["reason"]

    # --- day 10: the alert ---
    final = results[9]
    assert final["band"] == "ALERT", final["reason"]
    assert len(final["modalities_flagged"]) >= 2
    assert "3+ days" in final["reason"]
    assert final["alert_id"] is not None
    assert final["explanation_en"].startswith("Please check on them today:")
    assert "आज उनका हाल" in final["explanation_hi"]
    assert final["top_drivers"]

    # --- TRD §7: only features persist, raw media is gone ---
    assert settings.delete_raw_media is True
    leftovers = [p.name for p in settings.media_dir.glob("*") if p.is_file()]
    assert leftovers == [], f"raw media left on disk: {leftovers}"

    # --- the caregiver dashboard ---
    r = await client.get(f"/dashboard/{patient['id']}", headers=auth(token))
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["patient"]["id"] == patient["id"]
    assert body["baseline_ready"] is True
    assert body["baseline_days_recorded"] == BASELINE_DAYS
    assert body["baseline_days_required"] == BASELINE_DAYS
    assert body["dev_threshold"] == 2.0
    assert body["band_thresholds"] == {"STABLE": 0.0, "WATCH": 40.0, "ALERT": 70.0}

    assert len(body["trends"]) == len(PLAN)
    assert [t["band"] for t in body["trends"]][-3:] == ["WATCH", "WATCH", "ALERT"]
    assert all(k in body["trends"][0] for k in ("voice_dev", "face_dev", "reaction_dev"))

    assert body["latest"]["band"] == "ALERT"
    assert body["latest_explanation_en"] and body["latest_explanation_hi"]

    assert len(body["history"]) == len(PLAN)
    assert body["history"][0]["band"] == "ALERT"          # newest first

    assert len(body["alerts"]) == 1
    assert body["alerts"][0]["whatsapp_sent"] is True
    assert body["alerts"][0]["explanation"]


# --------------------------------------------------------------------------- access control
async def test_a_different_caregiver_cannot_see_the_patient(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    other, _ = await register(client, email="other@example.com")

    for path in (f"/patients/{patient['id']}", f"/dashboard/{patient['id']}"):
        r = await client.get(path, headers=auth(other))
        assert r.status_code == 403, path


async def test_a_clinician_has_read_access(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    clinician, _ = await register(client, email="dr@example.com", role="clinician")

    r = await client.get(f"/dashboard/{patient['id']}", headers=auth(clinician))
    assert r.status_code == 200
    # ...but cannot edit
    r = await client.patch(
        f"/patients/{patient['id']}", json={"name": "Nope"}, headers=auth(clinician)
    )
    assert r.status_code == 403


async def test_a_patient_role_cannot_create_patients(client):
    token, _ = await register(client, email="ramesh@example.com", role="patient")
    r = await client.post("/patients", json={"name": "Self"}, headers=auth(token))
    assert r.status_code == 403


async def test_a_linked_patient_account_can_run_its_own_checkin(client, tmp_path):
    caregiver, _ = await register(client)
    patient_token, patient_user = await register(client, email="ramesh@example.com", role="patient")
    patient = await make_patient(client, caregiver, user_id=patient_user["id"])

    result = await run_day(client, patient_token, patient["id"], tmp_path, 1, 0.0)
    assert result["baseline_day"] is True


async def test_linking_a_non_patient_account_is_rejected(client):
    caregiver, caregiver_user = await register(client)
    r = await client.post(
        "/patients",
        json={"name": "X", "user_id": caregiver_user["id"]},
        headers=auth(caregiver),
    )
    assert r.status_code == 400


# --------------------------------------------------------------------------- patients CRUD
async def test_patient_crud_roundtrip(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)

    listed = await client.get("/patients", headers=auth(token))
    assert [p["id"] for p in listed.json()] == [patient["id"]]

    patched = await client.patch(
        f"/patients/{patient['id']}", json={"name": "Ramesh K.", "age": 68}, headers=auth(token)
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Ramesh K." and patched.json()["age"] == 68

    deleted = await client.delete(f"/patients/{patient['id']}", headers=auth(token))
    assert deleted.status_code == 200
    gone = await client.get(f"/patients/{patient['id']}", headers=auth(token))
    assert gone.status_code == 404


async def test_patient_endpoints_require_authentication(client):
    assert (await client.get("/patients")).status_code == 401
    assert (await client.post("/patients", json={"name": "X"})).status_code == 401


# --------------------------------------------------------------------------- finalize guards
async def test_finalize_without_a_checkin_in_progress(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    r = await client.post(f"/checkin/{patient['id']}/finalize", headers=auth(token))
    assert r.status_code == 409


async def test_finalize_with_only_invalid_captures_is_stable(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    # an empty reaction payload opens a sample but yields valid=0 features
    await client.post(f"/checkin/{patient['id']}/reaction", json={"latencies_ms": []}, headers=auth(token))
    r = await client.post(f"/checkin/{patient['id']}/finalize", headers=auth(token))
    assert r.status_code == 200
    assert r.json()["valid_modalities"]["reaction"] is False
    assert r.json()["band"] == "STABLE"


async def test_an_unreadable_upload_is_recorded_as_an_invalid_capture(client):
    """A corrupt file must degrade that modality, not 500 the whole check-in."""
    token, _ = await register(client)
    patient = await make_patient(client, token)
    r = await client.post(
        f"/checkin/{patient['id']}/audio",
        files={"file": ("broken.wav", b"this is not audio at all", "audio/wav")},
        headers=auth(token),
    )
    assert r.status_code == 200, r.text
    assert r.json()["valid"] is False


async def test_an_empty_upload_is_rejected(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)
    r = await client.post(
        f"/checkin/{patient['id']}/audio",
        files={"file": ("empty.wav", b"", "audio/wav")},
        headers=auth(token),
    )
    assert r.status_code == 400


async def test_current_checkin_reports_the_open_sample(client):
    token, _ = await register(client)
    patient = await make_patient(client, token)

    assert (await client.get(f"/checkin/{patient['id']}/current", headers=auth(token))).json() is None

    await client.post(
        f"/checkin/{patient['id']}/reaction",
        json=reaction_payload(np.random.default_rng(42), 0.0),
        headers=auth(token),
    )
    body = (await client.get(f"/checkin/{patient['id']}/current", headers=auth(token))).json()
    assert body["status"] == "processing"
    assert body["reaction_json"]["latencies_ms"]
