# Endpoint data audit — Part 5.1

Every route in the API, what it returns, who may call it, and why that return is minimal.
Produced by reading all 13 router files end to end (70 routes), not by sampling.

**Six real access-control gaps were found and fixed during this audit.** They are listed
first, because the point of the exercise was to find them, and a table of green rows would
have buried the finding.

Last updated: 2026-08-28.

---

## What the audit found and fixed

Every one of these is the same underlying mistake: Part 3.2 fixed clinician access in
`get_patient_for_user`, but several routes had their own hand-rolled copy of "may this
caller touch this patient", and the fix was never propagated to the copies.

| # | Route(s) | The gap | Severity |
|---|---|---|---|
| 1 | `POST /sessions/{id}/module/{code}`, `POST /sessions/{id}/finalize`, `GET /sessions/{id}/modules` | `sessions.py:_assert_can_access` still granted any `user.role is Role.clinician` unconditionally — an unlinked clinician could **read and write** another patient's raw module features and trigger scoring | **Critical** |
| 2 | `GET /patients` | Role dispatch only special-cased caregiver/patient; every other role fell through with **no `WHERE` clause at all** and received every patient in the deployment (name, age, sex, stroke details). For an admin account this is a direct INV-11 breach | **Critical** |
| 3 | `POST /wearable/fall/{id}/acknowledge` | Authorised via the legacy `Patient.clinician_id` column, which link revocation never clears — a **revoked** clinician kept the ability indefinitely | High |
| 4 | `PATCH /patients/{id}` | `clinician_id` was settable to **any** user id with no check it names a clinician (unlike `POST /patients`, which validates). This is what made #3 actually exploitable rather than merely stale | High |
| 5 | `POST /clinic/alerts/{id}/acknowledge` | Role-gated to `clinician` but with no check that *this* clinician is linked to the alert's patient | Medium |
| 6 | `DELETE /awaaz/listener/{token}` | Required only *some* valid login — no tie between caller and the token's patient. Asymmetric with minting, which correctly required `get_patient_for_user` | Medium (availability) |

All six are pinned by regression tests in `backend/tests/test_patient_clinician_link.py`,
each asserting the **old** behaviour is gone rather than that the new behaviour works.

**The structural fix**, so this class of bug cannot recur one route at a time: every
clinician access decision now routes through a single function,
`app.auth.deps.clinician_may_access_patient`, which checks the active link *and* (Part 4)
that `CLINICIAN_SHARING` consent is currently in force. The hand-rolled copies in
`sessions.py`, `wearable.py` and `dashboard.py` now call it instead of reimplementing it.

---

## The rules this audit judged against

- **INV-1** — raw media never leaves the device. Verified structurally: **no router
  anywhere accepts `UploadFile`, `File(...)`, or multipart.** Zero matches across all 13
  files. `ModuleSubmit.raw` carries numbers (gaze coordinates, per-frame scalars already
  derived from landmarks on-device), never a blob.
- **INV-6** — server-side authorisation on every scoped route. Two documented exceptions,
  both deliberate, both listed below.
- **INV-11** — no patient identifier anywhere. Admin surfaces return counts and events only.

---

## admin.py — 5 routes

All gated by `Depends(require_roles(Role.admin))`.

| Route | Returns | Minimal because |
|---|---|---|
| `GET /admin/overview` | counts by role, patient/session/module totals, band distribution, three-gate funnel, baseline-state counts, synthetic-models note | Pure aggregates. Nothing addressable. |
| `GET /admin/identity` | flagged/scored session counts, enrolled patient count | Counts only — never *which* patient was flagged. |
| `GET /admin/audit` | `{ts, action, actor_id, patient_ref}`, `patient_ref` truncated to 8 chars | Actions and actors, not payloads. The truncated ref lets an operator see repeated activity on one record without identifying whose. |
| `GET /admin/doctors` **(new, 3.7e)** | clinician name, registration number + `SELF_DECLARED`, specialty, affiliation, `patients_linked` **count** | Operational metadata about **staff**, not patients. The patient dimension is an integer with no drill-down anywhere. See below. |
| `POST /admin/users` | `{id, email, role}` of the account just created | The privileged account the admin just minted, not a patient. |

**On `/admin/doctors` specifically.** This is the one admin route that returns names, and
the boundary is worth stating precisely: a clinician's name and registration number are
metadata about a person who works on the deployment, which an operator legitimately needs.
A patient's name is clinical data, which an operator never needs. `patients_linked` is a
count and there is deliberately **no route anywhere** that takes a clinician id and returns
their patients — an admin who could expand a doctor into a patient list would have exactly
the backdoor D-041 refuses, wearing an org-chart costume. `test_no_admin_response_contains_
patient_identifying_data` was extended to link a real doctor to a real patient before
asserting zero patient content leaks, so the tempting shape is covered.

## auth.py — 6 routes

`POST /auth/register` and `POST /auth/login` are public by necessity; `/auth/config` returns
static config. All others return only the caller's own record. Registration
**server-enforces** `role in {caregiver, patient}` — a client-supplied `clinician` or
`admin` is rejected, which is the D-040 fix.

## patients.py — 7 routes

| Route | Gate | Note |
|---|---|---|
| `POST /patients` | `require_roles(Role.caregiver)` | Creator owns it. Validates `clinician_id` names a real clinician. |
| `GET /patients` | `CurrentUser`, scoped per role | **FIXED (#2).** Caregiver → own; patient → own; clinician → linked **and** C3-consented; every other role → `[]`. |
| `GET /patients/{id}` | `get_patient_for_user` | |
| `PATCH /patients/{id}` | `get_patient_for_user` + owning-caregiver check | **FIXED (#4).** Now validates `clinician_id` names a clinician. Carries `calibration_json["identity"]` across a replacement so a routine PATCH cannot silently un-enrol the face check. |
| `DELETE /patients/{id}` | owning caregiver | |
| `POST/GET /patients/{id}/identity` | `get_patient_for_user` | Six bone-structure ratios. Non-invertible, no image, nothing matchable outside this account. |

## sessions.py — 9 routes

`GET /sessions/battery/{schedule}`, `/plan/{intensity}`, `/plan-v2/{type}` are public and
carry **no patient data at all** — static protocol definitions.

`/sessions/{patient_id}/due`, `/start`, `/current` use `get_patient_for_user` correctly.

`POST /{session_id}/module/{code}`, `POST /{session_id}/finalize`, `GET /{session_id}/modules`
resolve the patient from an already-fetched session rather than a path parameter, so they
cannot use the dependency directly. They call `_assert_can_access` — **FIXED (#1)**, now
mirroring `get_patient_for_user` exactly and delegating the clinician branch to
`clinician_may_access_patient`.

## dashboard.py — 4 routes

| Route | Gate | Note |
|---|---|---|
| `GET /dashboard/{id}` | `get_patient_for_user` | Full clinical picture for one's own/linked patient. |
| `GET /clinic/patients` | `require_roles(Role.clinician)` + join on active links + C3 consent | This is the route Part 3.2 fixed from a bare `select(Patient)`. Part 4 added the consent filter so the roster matches what the per-patient routes will actually permit. |
| `POST /clinic/alerts/{id}/acknowledge` | `require_roles(Role.clinician)` + link/consent check | **FIXED (#5).** |
| `GET /audit/{patient_id}` | `get_patient_for_user`, plus explicit `patient` role → 403 | Per-patient audit view, deliberately not patient-facing. |

## clinician.py — 9 routes

Profile routes return the caller's own profile; `verification_status` is **server-forced**
to `SELF_DECLARED` and never read from the request body. `POST /clinician/links` is
restricted to the **owning caregiver** — a clinician who could link themselves would make
the link meaningless as an access control. Baseline-gate routes are double-gated (patient
authorisation *and* clinician role). Revocation is a soft delete (`unlinked_at`), never a
row deletion (INV-8).

## caretaker.py — 5 routes (new, family access)

| Route | Gate | Returns / why minimal |
|---|---|---|
| `POST /caretakers/links` | **owning caregiver only** | Creates the family account, the link and the C7 consent in ONE transaction. Neither the patient nor another caretaker may call it — a caretaker minting caretakers voids the boundary. Returns ids and `login_enabled: false`; the account is created disabled until the auth pass. |
| `DELETE /caretakers/links/{id}` | owning caregiver only | Sets `unlinked_at`; the row is retained (INV-8). |
| `GET /caretakers/links/{patient_id}` | owning caregiver only | Who has family access. A caretaker does not get the roster of other caretakers — it is not theirs to audit. |
| `POST /caretakers/channels` | owning caregiver only | Registers a WhatsApp/SMS destination. The audit row records `channel_id` and **never** the destination, because `audit_log` survives erasure (D-050) and a number there would be un-erasable. |
| `DELETE /caretakers/channels/{id}` | owning caregiver only | Sets `revoked_at`. |

**Caretaker read access is not in this table** because it adds no routes: family read through
the *existing* patient-scoped routes, gated by `get_patient_for_user` →
`caretaker_may_access_patient` (active link **and** current C7). The two routes that resolve a
patient without the dependency — `sessions.py:_assert_can_access` and
`wearable.py:acknowledge_fall` — were updated in the same commit, which is the lesson from the
six-gap audit above. `dashboard.py:acknowledge_alert` was deliberately **not**: family may see
an alert, never silence it.

## consent.py — 2 routes (new, Part 4)

`GET /consents/{patient_id}` and `PUT /consents/{patient_id}/{consent_type}`, both restricted
to the **owning caregiver**. A linked clinician deliberately cannot read this surface: they
do not need C4/C5 to do their job, and if C3 is withdrawn they find out the honest way, by
losing access. `ip_address` is server-observed, never client-asserted.

## clinical_data.py — 5 routes

All use `get_patient_for_user`. `GET /report/{patient_id}` returns a full clinical export
including name, age, sex and stroke details — appropriate for its stated purpose (the PDF
renderer consumes it) and strictly gated to the owning caregiver, patient account, or an
actively-linked, C3-consented clinician.

## awaaz.py — 12 routes

Eight use `get_patient_for_user`. `DELETE /awaaz/listener/{token}` — **FIXED (#6)**.

**Documented INV-6 exception: `GET /awaaz/listen/{token}` has no auth dependency.** This is
deliberate and reasoned, not an oversight: the unguessable 128-bit token *is* the
capability. It is TTL-capped, revocable, returns a **caregiver-chosen alias** rather than
the enrolled patient name, and exposes at most 5 recent confirmed utterances from the last
24h. A stranger helping an aphasic person speak cannot be asked to create an account. The
mitigation is that the page never carries patient identity, so a forwarded link leaks a
first name the caregiver chose and nothing else.

`DELETE /awaaz/cards/{card_id}` uses a hand-rolled caregiver-only check rather than
`get_patient_for_user`. This is **more** restrictive, not less (it excludes clinicians and
the patient account by design) — noted as an inconsistency to watch rather than a gap,
since a future change to the shared dependency would not reach it.

## safety.py — 3 routes

`GET /safety/fast` and `GET /safety/symptoms` are **public by design** — emergency guidance
must never return 401. Both are static and carry no patient data. `POST /safety/acute/{id}`
is scoped and deliberately bypasses the scoring engine (INV-3).

## wearable.py — 5 routes

Four use `get_patient_for_user`. `POST /wearable/fall/{id}/acknowledge` — **FIXED (#3)**.
Every response carries `claim_notice`: the device vendor owns the measurement claim, we own
only the trend (INV-5).

## asha.py — 2 routes

Both gated to `require_roles(Role.asha_worker)` and scoped by
`Patient.asha_worker_id == worker.id`. Returns a name, age, village and which modules are
due — deliberately **not** bands, explanations or history. ASHA-worker scoping is a
different relationship than `get_patient_for_user` models, so the explicit check is correct
here rather than a gap.

## demo.py — 1 route

`POST /demo/seed` is public but gated behind `settings.demo_mode`. It returns demo
credentials in plaintext, which is intentional for the demo flow. **It seeds a synthetic
patient ("Ramesh") — no real patient data is involved.** `DEMO_MODE=false` is the real
control and must be set in any deployment carrying real patients.
