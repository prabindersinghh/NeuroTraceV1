# Data inventory — Part 5.3

Every table, what it stores, why, how long it is kept, and how it is deleted.

The governing split, implemented in `backend/app/services/erasure.py` and pinned by
`backend/tests/test_erasure.py`:

> **Clinical measurements are DELETED on erasure. Audit and consent records are RETAINED.**

A measurement describes a person's body. An audit entry describes an *access* — who read
this person's data and when — and a consent row describes a *decision*. Destroying the
second and third along with the first would mean a deployment could not answer "who saw
this data before it was removed", which is usually the question an erasure request arrives
attached to.

Last updated: 2026-08-28.

---

## The erasure mechanism, and why the patient row survives

`audit_log.patient_id` carries `ondelete="CASCADE"`. **This was verified by probing a real
database, not inferred from the schema**: one audit row before `DELETE FROM patients`, zero
after. So deleting the patient row outright destroys the audit trail.

Erasure therefore **tombstones** the row rather than removing it. Every clinical
measurement is genuinely deleted; the surviving `patients` row is stripped of `name`, `age`,
`sex`, `stroke_date`, `stroke_side`, `languages`, `education_band`, `consent_version`,
`consent_lang`, `asha_worker_id`, `user_id`, and `calibration_json` (which is where the
face-identity enrolment vector lives — the one stored value derived from the patient's
body). What remains is an id, `erased_at`, and a reason. It identifies nobody.

Rejected alternative: dropping the foreign key so the row could be deleted. That is a
constraint rewrite, on SQLite, on the table every other table references, to solve a problem
a nullable column solves additively. `ondelete="SET NULL"` was also rejected — it keeps the
audit row while destroying the linkage that makes it useful.

---

## Tables

### Identity and access

| Table | Holds | Retention | Deletion path |
|---|---|---|---|
| `users` | account: email, password hash, role, full name, language | Life of the account | Not touched by patient erasure — a caregiver may manage several patients. Account deletion is a separate operator action. |
| `patients` | enrolment, stroke details, deployment tier, exclusions, ASHA assignment, `calibration_json` (device calibration **and** the face-identity vector), `baseline_state`, `erased_at` | Until erasure, then a stripped tombstone kept indefinitely | `erase_patient_data()` clears every identifying field in place. |
| `clinician_profiles` | clinician's name, qualification, registration number, authority, specialty, affiliation | Life of the clinician account | Staff metadata, not patient data. Unaffected by patient erasure. |
| `patient_clinician_links` | who may see this patient, `linked_at`/`unlinked_at`, `consent_ref` | Indefinite — **revoked, never deleted** | Erasure sets `unlinked_at` with reason `patient data erased`. The row survives so the history of who could see this patient stays recoverable (INV-8). |
| `consents` | six independent consents: type, version, granted/withdrawn, actor, IP, device context | Indefinite | **Retained through erasure.** Evidence about a decision, carrying no measurement. |
| `audit_log` | who did what, when, to which patient ref | **Append-only, indefinite (INV-8)** | **Never deleted.** No code path anywhere deletes from this table. Erasure adds a `patient.erased` row to it. |

### Clinical measurements — all deleted on erasure

| Table | Holds | Why it exists |
|---|---|---|
| `sessions` | one exam sitting: timestamp, type, quality score, identity verdict, device info, offline flag | The unit the whole engine operates on. |
| `module_results` | extracted features per module — **numbers only** (INV-1) | What the device computed on-device. No media, ever; enforced structurally by `test_inv1_*`. |
| `baselines` | adaptive median/MAD/trajectory **and** the frozen reference snapshot | The two yardsticks (D-013). The frozen reference is written once, on clinician CONFIRM (INV-4, D-048). |
| `deviations` | per-module z, RCI, CUSUM, laterality. Keys on `session_id`, **not** `patient_id` | Per-module comparison against baseline. |
| `scores` | band, three gates, drivers, confounders, cumulative drift | One per scored session. |
| `alerts` | raised alerts, explanations, acknowledgement | One per episode, not per day. |
| `questionnaires` | PHQ-2/9, EAT-10, FSS, Barthel, DHI, HEARING | Patient-reported instruments. |
| `vitals` | BP, rhythm flag | TIER_2/3 only. |
| `adherence` | medication taken/not | |
| `safety_events` | acute symptom reports | Bypasses the engine entirely (INV-3). |
| `wearable_data` | vendor device readings | Logged and trended; never re-claimed as our measurement (INV-5). |
| `fall_events` | device-reported falls | Events, not trends — bypass the engine (INV-3). |
| `asha_visits` | one household visit, idempotent | Keyed on the worker, not the patient. |

### Awaaz — all deleted on erasure

| Table | Holds | Note |
|---|---|---|
| `awaaz_profiles` | speech profile, auto-speak settings | Gates INV-9 (nothing spoken for an aphasic patient without confirmation). |
| `phrase_cards` | the patient's phrase board | Patient-authored content. |
| `voice_samples` | **metadata only** — provenance, duration, status, consent, `audio_deleted_at` | The audio never enters this database. The clip lives in object storage as the single documented exception to INV-1 (D-014): single-purpose, consented, and destroyed after training — `audio_deleted_at` is the field that records that destruction. It never touches Neon and never touches the exam path. |
| `utterance_log` | what was spoken, whether it was confirmed first | The evidence for INV-9. |

### Baseline governance — deleted on erasure

| Table | Holds | Note |
|---|---|---|
| `baseline_reviews` | CONFIRM / EXTEND / FLAG_CONCERN, the snapshot reviewed, the clinician | Append-only **during a patient's life** (INV-8): no update or delete path exists in the application. It is removed by erasure because it embeds `baseline_snapshot_json` — a clinical measurement. The *fact* that reviews occurred survives in `audit_log`. |

---

## Retention periods

This deployment has **no time-based automatic deletion**. Nothing expires on a timer; data
is kept until an erasure is requested. That is a deliberate current-state statement, not a
policy recommendation — a production deployment carrying real patients should set explicit
retention periods per category, and this document is where they would be recorded.

The one exception already implemented is the Awaaz voice clip: destroyed after the voice
model is trained, with `voice_samples.audio_deleted_at` recording when.

## What is NOT stored, anywhere

- Raw audio, video, or image frames. No endpoint accepts an upload; no table has a binary
  column; no registered route declares a binary request body (INV-1, three separate tests).
- Any face embedding or anything invertible into a face. The identity vector is six ratios
  between bone-structure landmarks plus their spreads — not matchable outside this account.
- Patient identifiers in this repository (INV-11) — a different concern from this document,
  which covers the runtime database.
