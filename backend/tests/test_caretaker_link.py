"""The caretaker access boundary — the part of the feature that is not deferrable.

THIS FILE IS THE GATE. A caretaker reaching another patient's data is the same class of
defect as the six routes the Part 5.1 audit found: a scoping rule that existed in one place
and not the others. So the tests here are written the way `test_patient_clinician_link.py`
is — asserting the BAD behaviour is absent, not merely that the good path works.

Three of them are the ones that actually matter:

  1. `test_a_caretaker_linked_to_one_patient_is_refused_the_other` — the two-patient case.
     Proves this is scoping, not a blanket deny that would pass trivially.
  2. `test_withdrawing_c7_blocks_a_still_linked_caretaker_immediately` — the link is left
     ACTIVE on purpose, so consent is provably the thing doing the work.
  3. `test_caretaker_is_linked_has_exactly_one_caller` — a source assertion. It is the only
     thing that catches a NEW route calling the link check without the consent check, which
     is exactly how the clinician equivalent went wrong.
"""
from __future__ import annotations

import uuid as uuid_module
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

NOW = datetime.now(timezone.utc)
CAREGIVER = {"email": "family@example.com", "password": "correct-horse-battery",
             "role": "caregiver"}


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def register_caregiver(client, **overrides) -> str:
    resp = await client.post("/auth/register", json={**CAREGIVER, **overrides})
    assert resp.status_code == 201, resp.text
    return resp.json()["tokens"]["access_token"]


async def make_patient(client, token: str, name: str = "Harjit Kaur") -> str:
    resp = await client.post("/patients", json={
        "name": name, "age": 71, "sex": "female",
        "stroke_date": (NOW - timedelta(days=200)).isoformat(),
        "stroke_side": "right", "languages": ["pa", "en"], "preferred_hour": 9.0,
    }, headers=auth(token))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def add_caretaker(client, care_token: str, patient_id: str, email: str,
                        relationship: str = "SON") -> dict:
    resp = await client.post("/caretakers/links", json={
        "patient_id": patient_id, "email": email,
        "full_name": "Family Member", "relationship": relationship,
    }, headers=auth(care_token))
    assert resp.status_code == 201, resp.text
    return resp.json()


async def caretaker_token(client, session, email: str) -> str:
    """Log the caretaker in.

    The account is created DISABLED — no usable password hash — because invite and
    credential setup belong to the deferred auth pass. The boundary still has to be provably
    correct before anyone can sign in, so this sets a password directly and logs in, which
    is the same thing the auth pass will eventually do through an invite token.
    """
    from app.auth.password import hash_password
    from app.models import User

    user = await session.scalar(select(User).where(User.email == email))
    assert user is not None, f"no caretaker account for {email}"
    user.pw_hash = hash_password("correct-horse-battery")
    await session.commit()

    resp = await client.post("/auth/login", json={
        "email": email, "password": "correct-horse-battery",
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["tokens"]["access_token"]


# --------------------------------------------------------------- 1. THE BOUNDARY
#: Every patient-scoped route a caretaker must not reach on someone else's patient.
#: Parametrised so a NEW patient-scoped route added later without scoping fails HERE.
FOREIGN_ROUTES = [
    "/patients/{pid}",
    "/dashboard/{pid}",
    "/report/{pid}",
    "/audit/{pid}",
    "/wearable/{pid}",
    "/awaaz/{pid}/board",
    "/sessions/{pid}/history",
]


@pytest.mark.parametrize("route", FOREIGN_ROUTES)
async def test_an_unlinked_caretaker_is_refused_every_patient_scoped_route(
    client, session, route,
):
    """THE HEADLINE. A caretaker with no link to this patient gets 403, everywhere."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)

    # Linked to their OWN patient, so the account is a real caretaker — not merely a user
    # with no links, which would pass for the wrong reason.
    own_care = await register_caregiver(client, email="other-family@example.com")
    own_patient = await make_patient(client, own_care, name="Their Own Parent")
    await add_caretaker(client, own_care, own_patient, "sibling@example.com")
    token = await caretaker_token(client, session, "sibling@example.com")

    resp = await client.get(route.format(pid=patient_id), headers=auth(token))
    assert resp.status_code == 403, (
        f"{route} let a caretaker read a patient they are not linked to — {resp.text[:200]}"
    )


async def test_a_caretaker_linked_to_one_patient_is_refused_the_other(client, session):
    """The two-patient case. Without this, a blanket deny would pass every test above."""
    care = await register_caregiver(client)
    patient_a = await make_patient(client, care, name="Parent A")
    patient_b = await make_patient(client, care, name="Parent B")

    await add_caretaker(client, care, patient_a, "one@example.com")
    token = await caretaker_token(client, session, "one@example.com")

    assert (await client.get(f"/dashboard/{patient_a}",
                             headers=auth(token))).status_code == 200
    assert (await client.get(f"/dashboard/{patient_b}",
                             headers=auth(token))).status_code == 403, (
        "a caretaker reached a second patient under the same caregiver — this is scoping, "
        "not a per-caregiver grant"
    )


async def test_an_unlinked_caretaker_sees_an_empty_patient_list(client, session):
    care = await register_caregiver(client)
    await make_patient(client, care)

    own_care = await register_caregiver(client, email="other-family@example.com")
    own_patient = await make_patient(client, own_care, name="Their Own Parent")
    await add_caretaker(client, own_care, own_patient, "sibling@example.com")
    token = await caretaker_token(client, session, "sibling@example.com")

    rows = (await client.get("/patients", headers=auth(token))).json()
    assert [p["id"] for p in rows] == [own_patient], (
        "GET /patients returned a patient this caretaker is not linked to"
    )


# --------------------------------------------------------------- 2. THE FEATURE
async def test_a_linked_caretaker_reads_the_full_clinical_picture(client, session):
    """Family sees everything clinical — that is the point of the role."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com", "SON")
    token = await caretaker_token(client, session, "son@example.com")

    for route in (f"/patients/{patient_id}", f"/dashboard/{patient_id}",
                  f"/report/{patient_id}"):
        resp = await client.get(route, headers=auth(token))
        assert resp.status_code == 200, f"{route} -> {resp.status_code} {resp.text[:160]}"

    board = (await client.get(f"/dashboard/{patient_id}", headers=auth(token))).json()
    assert board["patient"]["name"] == "Harjit Kaur", "family sees the patient's real name"


async def test_link_creation_populates_consent_ref_at_once(client):
    """D-046 is not repeated: the link and its C7 row are written in one transaction, so
    there is never a cohort of consented-but-unreferenced links to backfill later."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")

    assert created["consent_ref"], "consent_ref is empty — the D-046 gap is back"
    assert created["login_enabled"] is False, (
        "the account must be disabled until the auth pass adds an invite flow"
    )


# --------------------------------------------------- 3. CONSENT IS LOAD-BEARING
async def test_withdrawing_c7_blocks_a_still_linked_caretaker_immediately(client, session):
    """THE CENTRAL CONSENT TEST. The link is deliberately left ACTIVE, so what is being
    proven is that consent — not the link — is doing the work."""
    from app.models import PatientCaretakerLink

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200

    withdrawn = await client.put(f"/consents/{patient_id}/CARETAKER_SHARING",
                                 json={"granted": False}, headers=auth(care))
    assert withdrawn.status_code == 200, withdrawn.text

    # The link is untouched — that is what makes this test mean something.
    link = await session.scalar(
        select(PatientCaretakerLink).where(
            PatientCaretakerLink.patient_id == uuid_module.UUID(patient_id)))
    assert link is not None and link.unlinked_at is None, "the test invalidated itself"

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403, (
        "C7 was withdrawn and a still-linked caretaker kept access"
    )


async def test_withdrawing_c7_removes_the_patient_from_the_caretakers_list(client, session):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    assert len((await client.get("/patients", headers=auth(token))).json()) == 1
    await client.put(f"/consents/{patient_id}/CARETAKER_SHARING", json={"granted": False},
                     headers=auth(care))
    assert (await client.get("/patients", headers=auth(token))).json() == [], (
        "the roster listed a patient the per-patient routes would now 403 on"
    )


async def test_regranting_c7_restores_access(client, session):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    await client.put(f"/consents/{patient_id}/CARETAKER_SHARING", json={"granted": False},
                     headers=auth(care))
    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403
    await client.put(f"/consents/{patient_id}/CARETAKER_SHARING", json={"granted": True},
                     headers=auth(care))
    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200


# --------------------------------------------- 4. THE OWNER'S CONTROLS STAY THE OWNER'S
async def test_a_caretaker_cannot_grant_or_withdraw_their_own_consent(client, session):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    resp = await client.put(f"/consents/{patient_id}/CARETAKER_SHARING",
                            json={"granted": True}, headers=auth(token))
    assert resp.status_code == 403, "a caretaker granted themselves access"
    assert (await client.get(f"/consents/{patient_id}",
                             headers=auth(token))).status_code == 403


async def test_a_caretaker_cannot_link_another_caretaker(client, session):
    """LOCKED decision 1. A caretaker minting caretakers voids the boundary the moment one
    account is compromised."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    resp = await client.post("/caretakers/links", json={
        "patient_id": patient_id, "email": "cousin@example.com",
        "full_name": "Cousin", "relationship": "OTHER",
    }, headers=auth(token))
    assert resp.status_code == 403, "a caretaker created another caretaker"


async def test_the_patient_cannot_link_a_caretaker_either(client, provision):
    """The same locked rule from the other side. A patient account is the least protected
    one in the system, so it must not be able to grant family access."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    patient_token, _ = await provision(client, "patient-self@example.com", "patient")

    resp = await client.post("/caretakers/links", json={
        "patient_id": patient_id, "email": "cousin@example.com",
        "full_name": "Cousin", "relationship": "OTHER",
    }, headers=auth(patient_token))
    assert resp.status_code == 403


async def test_a_caretaker_cannot_erase_the_patient(client, session):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    assert (await client.delete(f"/patients/{patient_id}",
                                headers=auth(token))).status_code == 403


async def test_a_caretaker_cannot_edit_the_patient(client, session):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    resp = await client.patch(f"/patients/{patient_id}", json={"name": "Changed"},
                              headers=auth(token))
    assert resp.status_code == 403


# ------------------------------------------ 5. LOCKED #2 — SEE, BUT DO NOT SILENCE
async def test_a_caretaker_may_acknowledge_a_fall(client, session):
    """LOCKED decision 2, the permissive half. They are the person in the house."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    reported = await client.post(f"/wearable/{patient_id}/fall", json={
        "source": "watch_accelerometer", "ts": NOW.isoformat(),
    }, headers=auth(care))
    assert reported.status_code == 201, reported.text
    fall_id = reported.json()["id"]

    resp = await client.post(f"/wearable/fall/{fall_id}/acknowledge", headers=auth(token))
    assert resp.status_code == 200, (
        f"a linked caretaker could not acknowledge a fall — {resp.text[:200]}"
    )


async def test_a_caretaker_cannot_acknowledge_an_alert_but_can_still_read_it(client, session):
    """LOCKED decision 2, and the PAIR is the point: "family sees everything" and "family
    cannot clear a clinical alert" must both hold at once, or the next person to read this
    code will collapse them into one rule."""
    from app.models import Alert, Band, ExamSession, Patient, Score

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    patient = await session.get(Patient, uuid_module.UUID(patient_id))
    exam = ExamSession(patient_id=patient.id)
    session.add(exam)
    await session.flush()
    score = Score(patient_id=patient.id, session_id=exam.id, band=Band.ALERT)
    session.add(score)
    await session.flush()
    alert = Alert(patient_id=patient.id, score_id=score.id, band=Band.ALERT,
                  explanation_en="Something changed across two areas.")
    session.add(alert)
    await session.commit()

    # SEES it.
    board = await client.get(f"/dashboard/{patient_id}", headers=auth(token))
    assert board.status_code == 200
    assert any(a["id"] == str(alert.id) for a in board.json()["alerts"]), (
        "family could not see the alert — 'sees everything' is the other half of this rule"
    )

    # Cannot SILENCE it.
    resp = await client.post(f"/clinic/alerts/{alert.id}/acknowledge", headers=auth(token))
    assert resp.status_code == 403, (
        "a caretaker acknowledged a clinical alert — a worried family member dismissing a "
        "real deterioration is exactly what this refuses"
    )


# ------------------------------------------------ 6. THE LINK IS A RECORD, NOT A TOGGLE
async def test_revoking_a_link_keeps_the_row_and_stops_access(client, session):
    from app.models import PatientCaretakerLink

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")
    token = await caretaker_token(client, session, "son@example.com")

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 200

    revoked = await client.delete(
        f"/caretakers/links/{created['id']}?reason=moved+abroad", headers=auth(care))
    assert revoked.status_code == 200, revoked.text

    link = await session.scalar(
        select(PatientCaretakerLink).where(
            PatientCaretakerLink.id == uuid_module.UUID(created["id"])))
    assert link is not None, "the link row was DELETED; revocation history is lost (INV-8)"
    assert link.unlinked_at is not None
    assert link.unlink_reason == "moved abroad"

    assert (await client.get(f"/dashboard/{patient_id}",
                             headers=auth(token))).status_code == 403


async def test_link_and_revoke_both_write_audit_rows(client, provision):
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")
    await client.delete(f"/caretakers/links/{created['id']}?reason=done", headers=auth(care))

    admin, _ = await provision(client, "ops@neurotrace.app", "admin")
    entries = (await client.get("/admin/audit?limit=200", headers=auth(admin))).json()
    actions = {e["action"] for e in entries["entries"]}
    assert "caretaker.link.granted" in actions
    assert "caretaker.link.revoked" in actions


# ------------------------------------------------------------------- 7. PII HANDLING
async def test_the_notification_destination_never_reaches_the_audit_trail(client, provision):
    """`audit_log` is append-only and survives erasure (D-050). A phone number written there
    would be un-erasable — the retention property becomes a liability."""
    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")

    added = await client.post("/caretakers/channels", json={
        "patient_id": patient_id, "caretaker_id": created["caretaker_id"],
        "channel": "WHATSAPP", "destination": "+919876500000",
    }, headers=auth(care))
    assert added.status_code == 201, added.text

    admin, _ = await provision(client, "ops@neurotrace.app", "admin")
    import json as json_module
    body = json_module.dumps(
        (await client.get("/admin/audit?limit=200", headers=auth(admin))).json())
    assert "+919876500000" not in body, "a destination reached the audit trail"
    assert "9876500000" not in body


async def test_no_admin_surface_exposes_a_notification_destination(client, provision):
    """D-041, extended. The leak-tempting shape — a real linked caretaker with a real
    channel — is in the fixture on purpose, the way the doctor census test was extended."""
    import json as json_module

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")
    await client.post("/caretakers/channels", json={
        "patient_id": patient_id, "caretaker_id": created["caretaker_id"],
        "channel": "WHATSAPP", "destination": "+919876500000",
    }, headers=auth(care))

    admin, _ = await provision(client, "ops@neurotrace.app", "admin")
    for route in ("/admin/overview", "/admin/identity", "/admin/audit", "/admin/doctors"):
        body = json_module.dumps((await client.get(route, headers=auth(admin))).json())
        assert "+919876500000" not in body, f"{route} leaked a caretaker destination"
        assert "Harjit" not in body, f"{route} leaked a patient name"
        assert patient_id not in body, f"{route} leaked an addressable patient id"


async def test_erasure_deletes_the_channel_and_revokes_the_link(client, session):
    from sqlalchemy import func

    from app.models import CaretakerChannel, PatientCaretakerLink

    care = await register_caregiver(client)
    patient_id = await make_patient(client, care)
    created = await add_caretaker(client, care, patient_id, "son@example.com")
    await client.post("/caretakers/channels", json={
        "patient_id": patient_id, "caretaker_id": created["caretaker_id"],
        "channel": "WHATSAPP", "destination": "+919876500000",
    }, headers=auth(care))

    pid = uuid_module.UUID(patient_id)
    assert await session.scalar(
        select(func.count()).select_from(CaretakerChannel)
        .where(CaretakerChannel.patient_id == pid)) == 1

    erased = await client.delete(f"/patients/{patient_id}?reason=withdrew",
                                 headers=auth(care))
    assert erased.status_code == 200, erased.text

    assert await session.scalar(
        select(func.count()).select_from(CaretakerChannel)
        .where(CaretakerChannel.patient_id == pid)) == 0, (
        "the destination survived an erasure — it is health-adjacent PII"
    )

    link = await session.scalar(
        select(PatientCaretakerLink).where(PatientCaretakerLink.patient_id == pid))
    assert link is not None, "the link row was deleted; revocation history is lost"
    assert link.unlinked_at is not None
    assert link.unlink_reason == "patient data erased"


# ---------------------------------------------------------- 8. THE SINGLE CHOKE POINT
def test_caretaker_is_linked_has_exactly_one_caller():
    """The property that would have prevented the six-route bug.

    `caretaker_is_linked` answers only half the question. If a route ever calls it directly
    it obtains the link check WITHOUT the consent check, and a C7 withdrawal silently stops
    working on that route alone. A source assertion is the only thing that catches a NEW
    call site — no behavioural test can, because the route would not exist yet.
    """
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    callers: list[str] = []
    for path in sorted((backend / "app").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "caretaker_is_linked" not in line:
                continue
            stripped = line.strip()
            if stripped.startswith(("#", "*", '"', "'")) or "async def" in stripped:
                continue
            callers.append(f"{path.relative_to(backend)}:{i}: {stripped[:100]}")

    assert len(callers) == 1, (
        "`caretaker_is_linked` must be called from exactly one place — inside "
        "`caretaker_may_access_patient`. Any other caller gets the link check without the "
        "consent check.\n  " + "\n  ".join(callers)
    )
    assert "auth/deps.py" in callers[0] or "auth\\deps.py" in callers[0], callers[0]


#: A branch enforces the boundary if it DELEGATES, or if it demonstrably applies both
#: conditions itself (an active-link join plus a C7 consent filter). The roster query in
#: `list_patients` is the second shape: it cannot call a per-patient boolean before it has a
#: row set, so it expresses the same pair set-wise. That is a deliberate second expression of
#: one rule and it is worth knowing about — if `caretaker_may_access_patient` ever grows a
#: third condition, the roster is where it will silently fail to appear.
_DELEGATES = "caretaker_may_access_patient"
_ENFORCES_INLINE = ("PatientCaretakerLink", "CARETAKER_SHARING")


def _grant_path_offenders(lines: list[str]) -> list[int]:
    """Line numbers where a `Role.caretaker` COMPARISON grants without checking consent."""
    out: list[int] = []
    for i, line in enumerate(lines, 1):
        if "Role.caretaker" not in line or line.strip().startswith("#"):
            continue
        # Only COMPARISONS gate access. An assignment writes a role, it does not read one.
        if not any(op in line for op in (" is ", " == ", " in ", "!=")):
            continue
        window = "\n".join(lines[i - 1:i + 14])
        if _DELEGATES in window:
            continue
        if all(marker in window for marker in _ENFORCES_INLINE):
            continue
        out.append(i)
    return out


def test_every_caretaker_grant_path_goes_through_the_consent_check():
    """No router may branch on `Role.caretaker` and then grant without checking consent.

    NARROWED TWICE, both times against real false positives rather than by exempting a file
    (the D-030 discipline):

      - Role ASSIGNMENT is not a grant. `role=Role.caretaker` in the account-creation
        constructor is the router deciding what to WRITE, not deciding who may READ.
      - The window is 14 lines, not 3. `list_patients` applies the link join and the consent
        filter eleven lines apart, and a short window called that a violation.
    """
    from pathlib import Path

    backend = Path(__file__).resolve().parents[1]
    offenders: list[str] = []
    for path in sorted((backend / "app" / "routers").rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for lineno in _grant_path_offenders(lines):
            offenders.append(
                f"{path.relative_to(backend)}:{lineno}: {lines[lineno - 1].strip()[:100]}")
    assert offenders == [], (
        "a router branches on Role.caretaker without either delegating to "
        "`caretaker_may_access_patient` or applying the link+consent pair inline — that is "
        "the six-route bug shape.\n  " + "\n  ".join(offenders)
    )


def test_the_grant_path_scanner_still_catches_a_real_violation():
    """Both directions. A scanner that has never been shown to fire is not yet a guard.

    The three negative cases are the two REAL false positives this scanner produced on its
    first run plus the correct delegation shape, so a future loosening that reintroduces
    them fails here.
    """
    # FIRES: a branch that grants on the link alone — the exact six-route bug shape.
    assert _grant_path_offenders([
        "    if user.role is Role.caretaker:",
        "        allowed = await caretaker_is_linked(db, user.id, patient.id)",
    ]), "the scanner missed a link-only grant"

    # DOES NOT FIRE: delegation.
    assert not _grant_path_offenders([
        "    if not allowed and user.role is Role.caretaker:",
        "        allowed = await caretaker_may_access_patient(db, user.id, patient.id)",
    ])

    # DOES NOT FIRE: role assignment (the real false positive, caretaker.py:94).
    assert not _grant_path_offenders([
        "    caretaker = User(",
        "        email=email,",
        "        role=Role.caretaker,",
        "    )",
    ]), "role assignment is not a grant path"

    # DOES NOT FIRE: the roster's inline link+consent pair (the real false positive,
    # patients.py:126) — the two halves sit eleven lines apart, which is why the window is 14.
    assert not _grant_path_offenders([
        "    elif user.role is Role.caretaker:",
        "        stmt = stmt.join(",
        "            PatientCaretakerLink, PatientCaretakerLink.patient_id == Patient.id,",
        "        ).where(",
        "            PatientCaretakerLink.caretaker_id == user.id,",
        "            PatientCaretakerLink.unlinked_at.is_(None),",
        "        )",
        "        rows = list(await db.scalars(stmt))",
        "        rows = [p for p in rows",
        "               if await consent_currently_granted(db, p.id,",
        "                                                  ConsentType.CARETAKER_SHARING)]",
        "        return rows",
    ]), "the roster's inline link+consent pair is correct enforcement, not a violation"
