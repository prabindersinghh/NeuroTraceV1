# ARCHITECTURE

The system as it **is**, not as planned. If this file and the code disagree, the code is
right and this file is a bug.

---

## 1. Shape

```
  Patient's phone (PWA, offline-first)
    camera / mic / touch  ──► MediaPipe + DSP, ON DEVICE
                                    │
                              raw media discarded here ◄── INV-1
                                    │
                              features (numbers only)
                                    │
                                    ▼
  FastAPI backend (Railway) ──► deterministic engine ──► Neon Postgres
                                    │                     (features, scores, audit)
                                    ▼
                            guardrailed SLM (explanations)
                                    │
        ┌───────────────────────────┼────────────────────────────┐
        ▼                           ▼                            ▼
   Caregiver view            Clinician view                ASHA worker view
   band + plain text         roster, drift lanes,          household list,
   + FAST card               typed cards                   offline visit sync

  Batch GPU (Modal / RunPod, rented by the hour) ──► nightly / weekly training only
                                                     NO always-on inference (D-004)

  *** DO NOT ADD A CLOUD INFERENCE SERVICE. ***
  It would require uploading the raw signal, which breaks INV-1, and would put a
  per-request cost on users with intermittent data. Inference is on-device. This
  note exists because "just add an inference endpoint" is the obvious next step
  for anyone who has not read INV-1.
```

**Inference is on the device.** There is no cloud inference service and there must never be
one — it would require uploading the raw signal, which breaks INV-1, and it would add a
per-request cost to users with intermittent data.

---

## 2. Stack

| Layer | Choice | Decision |
|---|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 async, Python 3.11 | — |
| Hosting | Railway | D-001 |
| Database | Neon serverless Postgres, branch-per-feature | D-002 |
| Local dev DB | SQLite via aiosqlite | — |
| Migrations | Alembic, additive only | D-009 |
| Frontend | React + Vite + TypeScript, PWA | — |
| On-device vision | MediaPipe Tasks Vision 1.0.1, wasm from `node_modules` | D-010 |
| ML training | Batch GPU by the hour, nightly/weekly | D-004 |

---

## 3. Data model (summary — full field notes in `FIELD_REFERENCE.md`)

| Table | Holds |
|---|---|
| `users` | accounts; role ∈ patient / caregiver / clinician / asha_worker |
| `patients` | enrolment, stroke details, `deployment_tier`, exclusions, ASHA assignment |
| `sessions` | one exam sitting |
| `module_results` | extracted features per module — **numbers only** |
| `baselines` | adaptive median/MAD/trajectory **and** the frozen reference snapshot |
| `deviations` | per-module z, RCI, CUSUM, laterality |
| `scores` | band, gates, drivers, confounders, cumulative drift |
| `alerts` | raised alerts and acknowledgement |
| `wearable_data` | vendor device readings — logged and trended, never re-claimed |
| `fall_events` | device-reported falls; bypass the engine entirely |
| `asha_visits` | one household visit, idempotent on (worker, client_visit_id) |
| `questionnaires` | PHQ-2/9, EAT-10, FSS, Barthel, **DHI**, **HEARING** |
| `awaaz_profiles` | speech profile and auto-speak settings — gates INV-9 |
| `phrase_cards` | the patient's phrase board |
| `voice_samples` | voice-clone **metadata only**; the audio never enters this database |
| `utterance_log` | what was spoken, and whether it was confirmed first |
| `audit_log` | append-only |

---

## 4. Roles and permissions

| Role | Can see | Can do |
|---|---|---|
| patient | own exam | run the battery |
| caregiver | own patients: band, explanation, trends, FAST | enrol, run exams, log symptoms and vertigo, acknowledge falls |
| clinician | all patients: roster, deviations, drift, typed cards | acknowledge alerts, export reports |
| asha_worker | **only assigned households**: name, age, due modules | run deep assessment, sync visits |

Enforced server-side on every route (INV-6). UI hiding is never the boundary.

---

## 5. The engine

Three gates, all of which must hold for an ALERT:

1. **Persistence** — deviation held ≥ 2 consecutive valid sessions.
2. **Cross-modality** — ≥ 2 independent domains passed gate 1.
3. **Laterality** — ≥ 1 persistent domain shows a *one-sided* change, sustained across the
   window.

Domains: `cranial_nerves`, `motor_speech`, `language`, `motor`, `coordination_gait`,
`posterior_vestibular`, `cognition`, `mood_fatigue_function`, `vitals_prevention`.

`posterior_vestibular` holds M3 (oculomotor), M9 (craniocorpography) and M21 (SVV). Its
laterality comes primarily from **M3 saccade asymmetry** — see D-024.

Domains that **can** establish laterality: `cranial_nerves`, `motor`, `coordination_gait`,
`posterior_vestibular`. Speech, language and cognition can corroborate, never establish.

Bands: `STABLE`, `WATCH`, `ALERT`, `PATTERN_ATYPICAL`.

Migrations applied: 0001–0006.

**Two yardsticks, every session.** The adaptive baseline answers "is today unlike recently";
the frozen reference answers "how far from the normal we established". A slow decline keeps
the first quiet and drives the second up (D-013).

---

## 6. INVARIANTS

Numbered. Each has a test in `backend/tests/test_invariants.py`. A failure here means a rule
the product depends on has been broken.

**INV-1 · Raw media never leaves the device.** No endpoint accepts a file upload; no table
has a binary column. Audio, video and frames are converted to numbers on the phone and
discarded. *This is the product's central privacy claim.*

**INV-2 · No ALERT without a lateralised finding.** Stroke is lateralised; Parkinson's is
symmetric. Without this a PD patient generates our highest-confidence alert.

**INV-3 · Acute symptoms and falls bypass the engine entirely.** Both are events, not
trends. Neither may call `evaluate_gates` or compute a deviation.

**INV-4 · The frozen reference is written once.** Snapshot at baseline lock, never updated.
An adaptive yardstick cannot see a decline it has been following.

**INV-5 · We own the trend; the device vendor owns the measurement.** Every wearable
response carries the claim boundary explicitly.

**INV-6 · Server-side authorisation on every scoped route.** The UI is never the boundary.

**INV-7 · Migrations never lose rows.** `alembic/env.py` must not enable foreign-key
enforcement — SQLite batch mode drops the original table, and a parent-table drop cascades.
Broken once, on migration 0005. See D-009.

**INV-8 · Audit data is append-only.** Corrections are new records, never edits or deletes.

**INV-12 · Fall-risk tasks never appear in an unsupervised schedule.** Unterberger (50
eyes-closed steps) and tandem walking (10 heel-to-toe steps) are ASHA-visit only, as are the
tablet-area neglect tasks. They are excluded from the daily protocol but NOT deleted — every
one of M9's laterality features comes from them, so removing them would un-lateralise the
posterior domain.

**INV-11 · No patient identifier exists anywhere in this repository.** No tracked image, no
identifier label in tracked text, no day-level date in clinical documents, nothing in git
history. The source photographs sit INSIDE the working tree — the brief assumed otherwise —
so being gitignored is the only thing between them and a commit.

**INV-10 · Every exam module has a declared tier placement and task-level assignment; no
module is reachable by zero tiers.** A module no tier can reach is offered to nobody and
fails silently — no error, no empty battery, just a measurement that never happens. Where a
module splits by task, every task must be assigned, and any task a tier cannot run must
appear on the ASHA visit workload rather than disappearing. Tasks that destabilise the
patient (eyes closed, narrowed base, stepping) may never be assigned to an unsupervised
device: "runs on a phone" describes the camera, not whether it is safe to do alone.

*Module placement has drifted three times, each as a side effect of a clinical amendment
rather than a tier decision. The last one nearly removed the two tasks that carry every one
of M9's laterality features — which would have silently converted `posterior_vestibular`
into a domain that can never satisfy Gate 3, breaking the amendment's core mechanism rather
than merely reducing coverage.*

*Enforced three ways: five tests in `test_invariants.py`; a comment at the definition site
in `registry.py`; and a `PostToolUse` hook (`scripts/hooks/registry-guard.sh`) that re-runs
the tier and invariant suites on any edit to `registry.py`. Any PLAN that touches exam
modules must list the tier suite as required verification.*

**INV-9 · Nothing is ever spoken on an aphasic patient's behalf without confirmation.**
`app/awaaz/safety.py::may_auto_speak` is the only path to speech-without-confirmation, and
it returns False for any profile other than dysarthria-dominant, at every confidence.
Auto-completing an aphasic patient's sentence puts words in their mouth that neither they
nor the listener can distinguish from their own.

---

## 6b. The daily protocol

21 ordered steps, ~11m35s of task time, five blocks: cognitive → ocular → **standing** →
motor → close. A fall-risk gate sits before the standing block.

**Ordering is part of the measurement.** Fixed position means each module's baseline absorbs
its own place on the fatigue curve, so fatigue becomes a constant rather than a confound.
Two things break that constant after a baseline locks, both biasing toward *masking
decline*: an intensity change (fewer preceding tasks → less fatigued → better score) and a
mid-session pause (tasks performed rested). Both are recorded per result —
`session_position`, `elapsed_seconds_at_task_start`, `intensity`, `paused_before_task`.

Intensities: `FULL` (21 steps) · `STANDARD` (18, drops SVV / vertical saccades / rapid
alternating) · `LIGHT` (core daily + one rotating physical block) · `RESEARCH` (FULL plus
supervised balance). A step **down** is auto-offered on repeated abandonment; a step **up**
is never automatic.

---

## 7. Deployment tiers

| Tier | Hardware | Modules |
|---|---|---|
| `TIER_1_PHONE` | phone + caregiver | daily + weekly, incl. the low-motion balance tasks |
| `TIER_2_WATCH` | + Galaxy Watch | same modules, plus passive data. **A watch is not a screen** |
| `TIER_3_ASHA` | + shared ASHA kit | everything, including tablet and floor-space tasks |

Capabilities are `phone` · `caregiver` · `tablet` · `floor_space`. **`caregiver` is distinct
from `phone`**: a propped phone and a held phone are not the same thing when the patient is
about to close their eyes and narrow their base. Every tier has a caregiver — the product is
caregiver-mediated by design — but tasks that destabilise the patient must say so.

A module appears when the hardware to run it *validly* is present. A nine-point gaze task on
a 6-inch phone measures the phone. Deferred modules are reported, never silently dropped.
