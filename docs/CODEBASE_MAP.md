# CODEBASE MAP

Written by reading the code, not the docs. Where this file and the code disagree, the
code is right and this file is a bug — same contract as `ARCHITECTURE.md`. Where this
file and *another doc* disagree, that disagreement is recorded deliberately, and the
worst of them are collected in "Things that surprised me" at the end.

Everything below carries a `file:line` so you can check it. Nothing here was inferred
from a filename or a docstring; several docstrings turn out to be wrong.

**Scale as measured** (`wc -l`, excluding `__pycache__`, `node_modules`, `dist`):
backend Python 34,965 lines across 129 files (`backend/app` + `backend/tests` +
`backend/alembic` + `backend/tools`); frontend TypeScript 18,252 lines across 98 files
under `frontend/src`; 26 files in `docs/` plus 5 model cards in `docs/models/`;
14 Alembic migrations.

---

## 1. The directory tree, annotated

```
backend/
  app/
    main.py              FastAPI app, CORS, /health, router registration (11 routers)
    config.py            settings + apply_seed(); DATABASE_URL normalisation for asyncpg
    db.py                async engine; SQLite gets PRAGMA foreign_keys=ON at RUNTIME
    models.py            21 ORM tables + the enums the API mirrors (880 lines)
    schemas.py           every Pydantic wire model; no field anywhere accepts a file
    seed.py              thin CLI wrapper over services/seed.py

    engine/              THE CLINICAL ENGINE. Deterministic, no model in the path.
      baseline.py        median/MAD/trajectory, enrolment gate, off-window rule
      deviation.py       robust z, RCI, CUSUM, per-module + lateral deviation
      gates.py           the three gates, the bands, the parkinsonian pattern
      confounders.py     confidence multiplier; never suppresses, only annotates

    exam/                21 modules M1..M21, their extractors and their tier placement
      registry.py        the MODULES table, TIER_CAPABILITIES, task-level deferral
      session_plan.py    the ordered 21-step daily PROTOCOL and intensity levels
      facial/motor/coordination/cognition/language/speech_tasks/vestibular/vitals/
      questionnaires.py  the per-domain extractors imported by registry.py

    awaaz/               The second product: assistive communication.
      safety.py          may_auto_speak — the whole of INV-9, one pure function
      listener.py        shareable read-only transcript links + listener coaching
      convergence.py     review queue, conversational-feature routing, frozen-adapter drift

    safety/              Unconditional. FAST card, acute escalation, forbidden language.
    slm/                 Templates (guaranteed), prompt construction, output guardrail.
    services/            session_pipeline.py (compute_session), seed, synthetic, email
    routers/             HTTP surface; awaaz.py is 1245 lines and is half the surface
    auth/                JWT, bcrypt, require_roles, get_patient_for_user
    ml/
      face/speech/scoring/baseline/reaction/explain.py   v1 implementations; see §5
      train/             five "training-stage" scripts + planners + model-card renderer
        artifacts/       five *.metrics.json, every one "synthetic": true
        asr_runtime/     2469-line governance-gated LoRA runtime that has never run
      rl/                offline-only policy comparison; SNIPS; no deployment path
  alembic/versions/      0001..0014, chained
  tests/                 29 test files, 703 test functions, ~1191 collected
  tools/gen_parity_fixture.py   emits the fixture the frontend parity test pins against

frontend/src/
  App.tsx                every route; RequireAuth checks presence of a user, not a role
  routes/                Landing, Login, Dashboard, Clinic, Awaaz, Listen, Admin, ...
    exam/                ProtocolRunner + one Step*.tsx per capture task
  lib/
    api.ts               the only place a fetch happens; token refresh de-duplication
    offline.ts           IndexedDB queue for sessions captured with no network
    ondevice/            browser-side feature extraction (MediaPipe + Web Audio DSP)
    awaaz*.ts            phrase board cache, audio vault, emergency audio, tar export
    i18n.tsx             en / hi / pa strings for the whole app
  components/            TaskShell, FastCard, EmergencyButton, FallRiskGate, charts
docs/                    26 documents; PROGRESS.md is the living snapshot
scripts/                 preflight_push.sh (7 privacy checks), verify_deploy.sh, hooks/
```

---

## 2. Request lifecycles

### 2.1 A daily exam, end to end

The device runs the battery, extracts features locally, and posts numbers. There is no
media-upload endpoint anywhere in the API, by construction (`routers/sessions.py:1-6`).

**1 · The plan comes from the server.** `GET /sessions/plan/{intensity}`
(`routers/sessions.py:59`) resolves the string to `Intensity`, calls
`exam/session_plan.py::steps_for` (`:150`) and returns the ordered steps plus
`fall_gate_before_position`, computed as the position of the first `C_` block step
(`routers/sessions.py:79-80`). The comment at `:62-66` is load-bearing: ordering is part
of the measurement, so it ships from the server rather than from a constant edited in one
place and forgotten in the other. The frontend mirror is `frontend/src/lib/protocol.ts`
and `test_protocol_runtime.py` pins the wire format against it.

**2 · Capture and extraction happen in the browser.** Each `Step*.tsx` is a pure capture
component that hands results upward through an `onDone(features, quality)` callback; only
`ProtocolRunner.tsx` ever touches `api`. Feature extraction:

| Module | Browser file | What it computes | Library |
|---|---|---|---|
| M1 face | `lib/ondevice/face.ts:152-219` | corner symmetry/drop, nasolabial ratio, forehead excursion, blink asymmetry, `central_pattern_index` | MediaPipe `FaceLandmarker` |
| M4 speech | `lib/ondevice/speech.ts:146-317` | F0 + F0-CV, jitter/shimmer proxies, MPT, DDK rate/regularity, pause ratio, articulation rate | Web Audio only, hand-written DSP |
| M7 tapping | `lib/ondevice/motor.ts:52-112` | `tap_asymmetry_ratio`, inter-tap CV, decrement slope | plain arithmetic |
| M10 attention | `lib/ondevice/attention.ts:69-95` | RT median, `rt_cov`, lapse rate | `performance.now()` |
| M3 ocular | `lib/ondevice/ocular.ts:42-54` | normalised gaze coordinates **only** | MediaPipe iris landmarks |
| M9 balance | `lib/ondevice/pose.ts:49-63` | head centroid + head width (the cm ruler) | MediaPipe `PoseLandmarker` |
| M17 PPG | `lib/ondevice/ppg.ts:30-45` | per-frame red-weighted brightness | canvas pixels |
| identity | `lib/ondevice/identity.ts:42-186` | six bone-structure ratios, `VERIFY_THRESHOLD = 0.45` | FaceMesh geometry |

`lib/capture.ts:1-11` is where INV-1 is actually true for the exam: there is no
`MediaRecorder` and no `Blob` in the exam path at all. Audio becomes Float32 PCM fed
straight to the DSP; video becomes per-frame landmark arrays and the frames are dropped.

M3, M9, M21, M6 and M17 send `raw` — points and per-trial numbers — and the *server* runs
the extractor, so there is one implementation of the harder maths and no JS drift
(`routers/sessions.py:141-145`). M7 and M10 extract in JS, and
`frontend/src/lib/ondevice/__tests__/parity.test.ts:18-55` pins them feature-for-feature
against the Python implementations at a relative tolerance of 1e-9, using a fixture
generated by `backend/tools/gen_parity_fixture.py`.

**3 · Three HTTP calls, in order** (`routes/exam/ProtocolRunner.tsx:247-291`):

```
api.startSession   -> POST /sessions/{patient_id}/start      routers/sessions.py:93
api.submitModule   -> POST /sessions/{session_id}/module/{code}  routers/sessions.py:120
api.finalizeSession-> POST /sessions/{session_id}/finalize    routers/sessions.py:187
```

`start_session` writes an `ExamSession` row and an `AuditLog` row. `identity_verified`
comes from the client and is **recorded, never enforced** (`routers/sessions.py:105-108`):
a failed same-person check makes the session a confounder, not a locked door.

`submit_module` resolves the module through `exam/registry.py::get_module`, merges
client features with any server-side extraction, and stores the row. A poor capture is
still stored — `quality_flag=False` keeps it out of the baseline and raises the
`low_quality_capture` confounder rather than silently contaminating the statistics
(`routers/sessions.py:125-130`). Session quality is the worst module quality seen so far
(`:174-175`).

**4 · `finalize` calls the engine.** `routers/sessions.py:187` refuses an empty session,
short-circuits a practice run without ever touching the engine (`:200-224`), then calls
`services/session_pipeline.py::compute_session` (`:196`).

**5 · `compute_session` (`services/session_pipeline.py:196-485`) is the whole pipeline.**
Per module:

- `_module_history` (`:65`) pulls every prior non-practice result for that module with
  the metadata the baseline needs.
- If no baseline row exists or it is not locked, today **feeds** the baseline and is not
  judged: `build_baseline` (`engine/baseline.py:211`) then `_upsert_baseline` (`:113`),
  and `baseline_phase = True`.
- If the baseline is locked, `compute_module_deviation` (`engine/deviation.py:135`) scores
  today against it: robust z per feature, RCI per feature, mean |z| clipped at 6, a
  separate mean over `lateral_keys` only, and CUSUM carried forward from the previous
  session's stored `cusum_stat` (`session_pipeline.py:274-282`).
- **Then a second, independent comparison against the frozen reference** (`:295-312`).
  Same features, same maths, different yardstick.

`_recent_sessions` (`:159`) reconstructs the last four sessions' persisted deviations,
today is appended, and `evaluate_gates` (`engine/gates.py:244`) runs over the lot. If the
baseline is still forming the result is overwritten with a flat STABLE (`:319-321`).

**6 · What is persisted.** One `Deviation` row per scored module, one `Score` row, and an
`Alert` row **only when** the band is ALERT *and* `_is_episode_onset` (`:500`) says today
starts a new episode rather than continuing one. The band correctly stays ALERT for as
long as it is true; the notification fires once per episode. Recompute is idempotent —
the existing score, its alert and the session's deviations are deleted first (`:373-378`).

**7 · What comes back.** `SessionFinalizeResponse` — band, reason, the three gate
booleans, persistent and lateralised domains, per-domain deviations, drivers, confounders,
confidence, cumulative drift, both explanations, the clinician line, and unconditionally
a FAST card (`routers/sessions.py:229-232`; TRD §8).

**Offline variant.** If any of the three calls fails, `ProtocolRunner.tsx:280-286` writes
the whole session into IndexedDB via `enqueueSession` (`lib/offline.ts:84`). See §8 for
what happens next, which is: nothing.

### 2.2 An Awaaz phrase tap

The shortest path in the product, and deliberately so.

```
Awaaz.tsx::speakCard (:416-481)
  -> api.awaazSpeak -> POST /awaaz/{patient_id}/speak   routers/awaaz.py:257
     card branch (:270-274, :349-388): increments card.use_count, writes an
     UtteranceLog with mode="auto", confirmed=True
  -> response speak_now=True, reason "the person chose these exact words themselves"
  -> Awaaz.tsx::voice() (:163-171) speaks it via SpeechSynthesisUtterance
```

A tapped card **bypasses the auto-speak gate entirely** and that is correct: the patient
selected those exact words, so nothing is being inferred on their behalf
(`routers/awaaz.py:1-5`, `:263-266`). `may_auto_speak` is not consulted.

If the tap carries a consented on-device recording, the receipt path runs first
(`:276-348`): a capture id is required for any capture metadata; the capture must be
paired with a **card**, never with free text, because until ASR exists only a card tap
supplies an exact target and pairing free text would manufacture a training label
(`:283-287`); explicit consent, duration, SHA-256 and byte size are all mandatory; and a
replayed capture id returns the original row rather than double-counting
(`:311-334`). The WAV itself lives in `frontend/src/lib/awaazAudioVault.ts`
(IndexedDB `neurotrace-awaaz-vault`) and never crosses the wire.

**Free text is the other half.** `Awaaz.tsx::submitFree` (`:639-662`) posts the recognised
text; the server calls `awaaz/safety.py::decide` (`:145` in the router, `safety.py:116`).
If `decision.auto` the utterance is spoken and logged unconfirmed; otherwise the response
carries `candidates` and **no text at all** (`routers/awaaz.py:412-419`), and the UI
renders the candidates as tap targets under the line "Nothing is spoken until you choose"
(`Awaaz.tsx:1216-1231`). Choosing one calls `confirmCandidate` (`:664-684`), which re-posts
with `confirmed_candidate: true` (`lib/awaaz.ts:19-30`) and only then speaks. The client
makes no local auto-speak decision; it branches on the shape of the server's response
(`Awaaz.tsx:12-16`).

### 2.3 An emergency activation

Two distinct paths, and it matters which one you mean.

**The engine-bypass path** — `POST /safety/acute/{patient_id}`
(`routers/safety.py:44`). The escalation payload is built *first*, before the database is
touched, so a DB problem cannot delay it reaching the caller (`:51-54`). It writes a
`SafetyEvent` and an `AuditLog` and returns. There is intentionally no code path from
this endpoint into `compute_session` (`routers/safety.py:1-6`,
`safety/acute.py:1-9`). Unknown symptom codes still escalate: if the caregiver ticked
something we do not recognise, the safe reading is that something is wrong
(`safety/acute.py:96-98`). `GET /safety/fast` is deliberately unauthenticated —
emergency guidance must never 401 (`routers/safety.py:30`).

**The Awaaz path** — `POST /awaaz/{patient_id}/emergency` (`routers/awaaz.py:449`). The
frontend starts its locally-stored WAV *before* awaiting the request
(`lib/awaazEmergencyAudio.ts`, DB `neurotrace-awaaz-emergency`), so the phrase plays with
no network. The server picks a fixed phrase by language, attempts caregiver delivery via
`services/emergency_notifications.py::deliver_emergency`, writes an `UtteranceLog` and an
`AuditLog` recording `used_speech_recognition: False`, and returns. ASR is never used:
a person in crisis is the least intelligible they will ever be
(`test_awaaz.py:619-621`). Location is opt-in and consent-bearing (`:465-478`), and
`caregiver_notified` is true only when a provider actually accepted the message — the
delivery boundary reports unavailable rather than mock success.

---

## 3. The engine

`backend/app/engine/` is four files and about a thousand lines, and it is where the
product's claims live. The package docstring states the rule plainly: no machine-learned
model sits anywhere in this decision path (`engine/__init__.py:3-5`).

### 3.1 What each module computes

| File | Key functions | What it does |
|---|---|---|
| `baseline.py` | `check_enrolment` (:120), `build_baseline` (:211), `mad_of` (:179), `fit_trajectory` (:197), `expected_value` (:291), `is_off_window` (:160) | Per-module median/MAD/trajectory over a 14-21 day window; locks at 12 retained sessions |
| `deviation.py` | `robust_z` (:105), `reliable_change_index` (:118), `compute_module_deviation` (:135), `cusum_series` (:225) | Three complementary instruments: how unusual is today, is the move bigger than instrument error, and has a small drift been accumulating |
| `gates.py` | `evaluate_gates` (:244), `is_lateralised` (:157), `detect_symmetric_pattern` (:203), `rank_drivers` (:358) | The three gates and the four bands |
| `confounders.py` | `detect_confounders` (:109), `describe` (:144) | Eight confounder codes, each a multiplicative confidence penalty |

Ordering inside `build_baseline` is deliberate and commented: reject unusable captures
**first**, then discard the practice sessions from what remains — discarding first would
let three rejected captures consume the practice allowance and leave learning effects in
the baseline (`baseline.py:221-223`).

`mad_of` floors MAD three ways — `MIN_MAD`, and 1% of the centre's magnitude
(`baseline.py:194`). The floor converts a previously-flat feature into "any movement is a
large movement", which is the clinically correct reading, and stops division by zero.

Confounders never suppress: `detect_confounders` returns an `active` list and a
`confidence` multiplier floored at 0.05 (`confounders.py:137-141`). Suppression would hide
real change.

### 3.2 How a session becomes a band

`evaluate_gates` (`gates.py:244-355`), in the order the code actually runs:

1. Drop invalid sessions. A rejected capture neither breaks a run nor extends it — it is
   simply not a session for gating purposes (`:252-258`).
2. **IMPROVING short-circuits everything.** If every domain flagged today is also
   improving, return STABLE immediately (`:267-273`). Nothing below this line executes.
3. **Gate 1 · persistence.** Over `window = valid[-2:]`, a domain qualifies when its
   deviation exceeds 2.0 on *every* session in the window (`:275-283`). A separate
   backward scan computes `sustained_sessions` for the clinician line (`:288-296`).
4. **Gate 3 · laterality.** The intersection of `lateralised_domains()` across the whole
   window, intersected with the persistent domains (`:301-308`). Required across the
   window, not just today: one session's asymmetry can come from head tilt or an awkward
   grip on the phone.
5. **Gate 2 · cross-modality.** `len(persistent_domains) >= 2` (`:311`).
6. **The parkinsonian pattern, checked before any alert can be emitted** (`:314-323`).
7. Band assignment (`:325-353`).

Domain deviation is the **max** over that domain's modules, not the mean: a domain with
five modules where one is clearly abnormal should not have that signal averaged away
(`gates.py:121-138`).

`is_lateralised` requires four things at once — computed, gateable, `has_laterality`, and
`lateralised` (`gates.py:157-168`). A module with an empty `lateral_keys` tuple has
`has_laterality = False` (`deviation.py:167`) and can never establish a focal deficit,
however deviant it is.

### 3.3 Exactly which gates can produce an ALERT

Only one combination, at `gates.py:325`:

```python
if result.gate1_passed and result.gate2_passed and result.gate3_passed:
    result.band = BAND_ALERT
```

There is no other assignment of `BAND_ALERT` in the engine. Everything else is WATCH,
STABLE or PATTERN_ATYPICAL:

| Condition | Band | Line |
|---|---|---|
| improving supersets everything flagged today | STABLE | `gates.py:271` |
| parkinsonian triad persistent, nothing lateralised, not shrinking | PATTERN_ATYPICAL | `gates.py:318` |
| gates 1 + 2 + 3 | **ALERT** | `gates.py:326` |
| gates 1 + 2, no laterality | WATCH | `gates.py:336` |
| gate 1 only | WATCH | `gates.py:342` |
| something moved today only | WATCH | `gates.py:349` |
| otherwise | STABLE | `gates.py:352` |

`detect_symmetric_pattern` (`:203-241`) requires all three of
`("cranial_nerves", "motor", "motor_speech")` persistent, **no** lateralised domain on
**any** session in the window, and `series[-1] >= series[0]` so a resolving dip does not
qualify. It is checked before the ALERT branch and returns early, so an atypical pattern
can never be re-read as an alert.

The five domains that can *establish* laterality are everything not in
`NON_LATERALISABLE_DOMAINS` (`gates.py:99-105`): `cranial_nerves`, `motor`,
`coordination_gait`, `posterior_vestibular`. Speech (both halves), cognition, mood and
vitals may corroborate under Gate 2 and can never satisfy Gate 3.

### 3.4 Where the frozen reference enters

Two places, both in `services/session_pipeline.py`, and neither in `engine/`.

**Written** at `_upsert_baseline:136-140`, guarded on being unset:

```python
if row.locked and row.reference_locked_at is None:
    row.reference_median_json = dict(built.median)
```

**Read** at `_reference_baseline:144-156`, which returns an `EngineBaseline` with
`trajectory={}` — deliberately empty, because a frozen reference does not adapt.

**Used** at `:295-312`: `compute_module_deviation` runs a second time with
`days_since_window_start=0.0`, and the worst per-domain result goes into
`reference_dev`. Then `:398-404`:

```python
drift_flagged = (worst_drift > DEV_THRESHOLD
                 and adaptive_worst <= DEV_THRESHOLD
                 and not baseline_phase)
```

That combination — the frozen yardstick alarmed while the adaptive one is quiet — is the
signature of a decline the rolling baseline has been absorbing. Note what it does **not**
do: `drift_flagged` is stored on the `Score` row and returned in the response, but it is
not an input to `evaluate_gates` and cannot raise a band by itself.

---

## 4. Exam modules

### 4.1 The registry

`backend/app/exam/registry.py` is one table, `MODULES` (`:192-456`), of frozen
`ExamModule` dataclasses (`:115-190`). Each declares: domain, schedule, tasks, extractor,
`scoring_keys`, `bad_direction`, `lateral_keys`, `requires_device`, optional
`task_devices`, `gates_alerts`, spoken instructions in en/hi, and capture seconds.

**There are 21 modules, counted.** M1..M21. The docs disagree with each other and with
the code: `registry.py:3` says "all twenty modules", `exam/__init__.py:1` says
"Exam modules M1-M20", and `docs/DEVELOPMENT.md:83` says 21 and notes that it used to say
M1-M20 and was corrected by counting. The registry is the authority: `M21` "Sense of
upright" (SVV) exists at `registry.py:435`.

| Code | Name | Domain | Schedule | Lateral? | Gates? | Device |
|---|---|---|---|---|---|---|
| M1 | Facial movement | cranial_nerves | daily | yes (7 keys) | yes | phone |
| M2 | Tongue and palate | cranial_nerves | weekly | yes (1) | yes | phone |
| M3 | Eye movement | posterior_vestibular | weekly | yes | yes | phone |
| M4 | Speech clarity | motor_speech | daily | no | yes | phone |
| M5 | Language | language | weekly | no | yes | phone |
| M6 | Arm strength | motor | weekly | yes (2) | yes | phone |
| M7 | Hand speed | motor | daily | yes (2) | yes | phone |
| M8 | Coordination | coordination_gait | weekly | no | yes | phone |
| M9 | Balance and stepping | posterior_vestibular | weekly | yes | yes | phone + task split |
| M10 | Attention and speed | cognition | daily | no | yes | phone |
| M11 | Memory and planning | cognition | weekly | no | yes | phone |
| M12 | Visual attention | cognition | monthly | yes (2) | yes | **tablet** |
| M13 | Mood (PHQ-2) | mood_fatigue_function | daily | no | **no** | phone |
| M14 | Fatigue (FSS) | mood_fatigue_function | weekly | no | **no** | phone |
| M15 | Daily function (Barthel) | mood_fatigue_function | monthly | no | **no** | phone |
| M16 | Swallowing (EAT-10) | mood_fatigue_function | monthly | no | **no** | phone |
| M17 | Heart rhythm (PPG) | vitals_prevention | weekly | no | yes | phone |
| M18 | Blood pressure | vitals_prevention | weekly | no | yes | phone |
| M19 | Medication | vitals_prevention | daily | no | **no** | phone |
| M20 | Symptoms | vitals_prevention | any | no | **no** | phone |
| M21 | Sense of upright (SVV) | posterior_vestibular | monthly | yes | yes | **caregiver** + task split |

`gates_alerts=False` on M13-M16, M19 and M20 for two stated reasons
(`registry.py:176-190`): you do not z-score a PHQ-2 against a personal median when the
instrument ships with published cut-offs; and a module with one or two features has no
internal averaging, so its mean |z| *is* a single z-score and crosses threshold by chance
about once in twenty sessions. `MIN_FEATURES_TO_GATE = 3` in `deviation.py:40` enforces
the second reason independently, so a module can be `gates_alerts=True` and still be
`gateable=False` on a given session (`deviation.py:200`).

### 4.2 Tier placement (INV-10)

`TIER_CAPABILITIES` (`registry.py:501-511`) maps three tiers onto four capabilities:

```
TIER_1_PHONE  {phone, caregiver}
TIER_2_WATCH  {phone, caregiver}   # a watch is passive data, not a screen
TIER_3_ASHA   {phone, caregiver, tablet, floor_space}
```

`caregiver` is a distinct capability from `phone` on purpose (`registry.py:503-508`): a
propped phone and a held phone are not the same thing when the patient is about to close
their eyes and narrow their base.

Placement resolves through four functions:

- `modules_for_tier(schedule, tier)` (`:514`) — module-level: `requires_device in have`.
- `tasks_for_tier(code, tier)` (`:555`) — task-level, falling back to the module default.
- `tasks_deferred_for_tier(code, tier)` (`:567`) — the complement, surfaced so a partial
  capture is never mistaken for a complete one.
- `visit_workload_for_tier(tier)` (`:575`) — `{module: [tasks]}` for the ASHA visit. Its
  docstring records two real failures: `modules_deferred_for_tier` was asked only about
  the monthly battery so weekly M9 never reached the worker's list; then M9 was made
  phone-runnable for its low-motion subset and dropped off module-level deferral
  entirely, taking the two tasks that carry every one of its laterality features with it.

That is why M9's `task_devices` block (`registry.py:300-329`) carries a 19-line comment in
capitals. `unterberger` and `tandem_walk` are `floor_space` (`registry.py:327-328`);
`romberg_eyes_closed` and `tandem_stance` are `caregiver` (`:307-308`); only
`romberg_eyes_open` is bare `phone` (`:305`).

INV-10 is enforced three ways, all of which exist: five tests in `test_invariants.py`
(`:199, :233, :258, :287, :318`); the comment at the definition site; and a `PostToolUse`
hook, `scripts/hooks/registry-guard.sh`.

### 4.3 Scheduling away from fall risk (INV-12)

Two independent mechanisms, in two files, that do not agree on their scope.

**In the registry** — `SUPERVISED_TASKS` (`registry.py:536-544`) names six tasks that must
never run unsupervised, and `SUPERVISED_DEVICES = {"caregiver", "floor_space"}`
(`:552`). `test_invariants.py:318` asserts that every task in `SUPERVISED_TASKS` is
assigned a device in `SUPERVISED_DEVICES`. This holds today.

**In the daily protocol** — `SUPERVISED_ONLY` (`session_plan.py:142-144`) names four
tasks: `unterberger`, `tandem_walk`, `line_bisection`, `star_cancellation`.
`test_session_plan.py:76-80` asserts the 21-step `PROTOCOL` contains none of them.

The two sets differ, and the difference is the point: `romberg_eyes_closed` and
`tandem_stance` are in `SUPERVISED_TASKS` but **not** in `SUPERVISED_ONLY`, and both are
in the daily protocol at positions 12 and 13 (`session_plan.py:109-113`). See §11.

The protocol's safety mechanism is `fall_gate_before_position` (`routers/sessions.py:79`)
plus `FallRiskGate` in the UI, which blocks the standing block until it is passed or
explicitly skipped (`ProtocolRunner.tsx:329-343`).

---

## 5. Awaaz

### 5.1 The phrase board

`GET /awaaz/{patient_id}/board` (`routers/awaaz.py:118`) seeds a 12-card default board on
first use, translated to the patient's first language (`_seed_board:105`,
`DEFAULT_CARDS:59-72`). The default set is chosen to cover the things that cannot wait —
toilet, pain, wanting company — "because a board that needs configuring before it is
useful will not be there on the first bad day" (`:56-58`). Cap: 36 cards. Duplicate
prevention uses an NFKC-casefolded comparison form that is never stored in place of the
patient's own text (`_normalise_card_text:88`).

### 5.2 The confirmation gate (INV-9)

`backend/app/awaaz/safety.py` is 145 lines and is the whole invariant. The reasoning at
`:5-31` is worth reading in full; the mechanism is `may_auto_speak` (`:81-113`), which
returns `False` unless **all** of:

- the profile parses as a known `SpeechProfile` — an unrecognised value is not a reason
  to guess, it is a reason to confirm (`:94-98`);
- the profile is in `AUTO_SPEAK_ELIGIBLE`, which is `{dysarthria_dominant}` and is
  deliberately an **allow-list** so a profile added later is safe by default (`:52-54`);
- `enabled` is true;
- confidence is a finite float in `[0, 1]`;
- confidence ≥ `max(threshold, MIN_AUTO_SPEAK_THRESHOLD)` where the floor is 0.70 and
  cannot be configured lower (`:60-61, :105`).

`mixed` is treated as aphasia, explicitly: when both are present the language impairment
governs what is safe (`:46, :28-31`). `unassessed` is the default for a new profile row
(`routers/awaaz.py:99-101`).

`decide` (`:116-145`) wraps it and adds a human-readable reason for the UI and the audit
log. Every recognised-speech path goes through it (`routers/awaaz.py:404-408`). Cards and
confirmed candidates bypass it because the patient chose those words directly.

### 5.3 Listener mode

`awaaz/listener.py`. A listener link is a **capability**: `create_listener_session`
(`:166`) mints a 32-hex-char token with a TTL capped at 480 minutes (`:40-41`), granting a
live view of one patient's utterances and nothing else — no history, no enrolled name
(only a display name the caregiver picks), no other patient, no write access. Sessions are
held in **process memory** on purpose (`routers/awaaz.py:527-531`): a server restart
revoking every outstanding link errs the right way for something showing a live
transcript. `GET /awaaz/listen/{token}` (`:606`) is unauthenticated by design; the
frontend `Listen.tsx` polls it every 3s and renders only the display name, one coaching
line, and recent confirmed utterances.

`coaching_line` (`listener.py:116-137`) returns exactly one line, ordered by the urgency of
the mistake it prevents: long pause → word-finding → low confidence → flowing → default. A
listener reads one line, so it should be the one that matters most at this instant.

### 5.4 Emergency path

Covered in §2.3. The two structural facts: ASR is never used
(`used_speech_recognition: False`, hard-coded at `routers/awaaz.py:521`), and
`works_offline` reflects an actual client playback receipt rather than an inference that
a recording might exist somewhere (`test_awaaz.py:625-627`).

### 5.5 Audio receipts

`utterance_log` carries `audio_capture_id` (unique), duration, SHA-256, size,
`audio_consent_by`, `audio_consent_at`, `audio_retained_on_device`, `audio_deleted_at`
(migration `0013_on_device_audio_pairs.py`). No blob, no path, no upload target.
`DELETE /awaaz/audio-pairs/{capture_id}` (`routers/awaaz.py:422`) records revocation after
the browser has deleted its local WAV, and is idempotent so a retry after a lost response
is not an error. The export path (`lib/awaazTrainingExport.ts`) builds an uncompressed tar
in memory for manual download, verifying each file's SHA-256 first, and never uploads it.

### 5.6 Policy-event logging (the new part)

`routers/awaaz.py:759-1259`, added for AWA-FR-014. The problem it solves is stated at
`:760-764`: `app/ml/rl/` could compare candidate-ranking policies offline for a while, and
not one production event was eligible, because Awaaz recorded no slate, no policy version,
no propensity and no confirmation outcome — so every importance weight had an unknown
denominator.

`rank_and_sample` (`:896-967`) is a pure function: sort by score descending with a UUID
tie-break for reproducibility, take everything within `NEAR_TIE_MARGIN = 0.05` of the top
up to `MAX_EXPLORED_CANDIDATES = 3`, give each non-top member a flat
`EXPLORATION_EPSILON = 0.08`, and give the top the rest. Three bounds do separate work
(`:781-808`): near-tie-only means a clearly-worse candidate has probability zero and
cannot be drawn; flat-per-alternative rather than epsilon-split-k keeps propensities above
the estimator's floor; and confirmation-only means nothing on a speak-without-confirmation
path is ever reordered. `ExplorationBound.__post_init__` (`:871-894`) refuses any
configuration that would leave the top candidate below 0.75.

Two endpoints, deliberately split:

- `POST /awaaz/{pid}/policy/decision` (`:995`) refuses without
  `policy_logging_consent` **and** refuses unless `requires_confirmation` is true. It
  draws, stores the draw in `_PENDING_POLICY_DECISIONS` (process memory, TTL 30 min,
  capped at 1024), and returns an ordering. Retries return the *same* draw — resampling
  would mean the propensity eventually written was not the probability of the action the
  patient was shown (`:1026-1029`).
- `POST /awaaz/{pid}/policy/outcome` (`:1083`) closes it with one INSERT, then immutable.
  It re-enforces the INV-9 consistency conditions at write time (`:1131-1145`) —
  a confirmation with no selection is not a confirmation; nothing is spoken before the
  person confirms — because an append-only row that contradicts the gate can never be
  corrected and would sit in the log looking like evidence.

The audit rows written alongside carry actor, patient, policy id and the consent fact, and
deliberately omit the event id and every candidate id (`:1066-1069`): `audit_log` has a
`patient_id` and a microsecond timestamp, so an event id there would be an exact join key
back onto a table built to have no patient link.

Nothing calls these endpoints yet. `docs/PROGRESS.md` states it directly: no real product
event has ever been logged.

---

## 6. ML

**Every model in this repository is trained on synthetic fixtures. Every committed
metrics artifact carries `"synthetic": true`. No trained weights of any kind are
committed — no `.joblib`, no adapter, no audio asset.** Verified by listing
`backend/app/ml/train/artifacts/`, which contains exactly five `*.metrics.json` files.

### 6.1 The five training-stage models

| Script | What it actually does | What it refuses | Real output? |
|---|---|---|---|
| `asymmetry_discriminator.py` | Builds two synthetic cohorts of 120 (`synthetic_cohort`, `:79-109`) — rate-matched bilateral vs unilateral-lesion — through the real `extract_fine_motor`, and compares `tap_rate_mean` against `tap_asymmetry_ratio` as discriminators. It is "not really a classifier… the evidence for a design decision" (`:6`) | `--mpower` verifies real records then `raise SystemExit` without writing metrics (`:158-173`) | metrics only, synthetic, AUC ≈ 0.976 |
| `rhythm_irregularity_clf.py` | Synthetic fallback (`_run_synthetic`, `:99-130`, n=300 Gaussian-offset scores). A real PhysioNet/CinC-2017 path exists and would write a LogisticRegression `.joblib` (`:176-179`) if `--data` pointed at a dataset | `choose_threshold` (`:81-96`) requires sensitivity ≥ 0.85 before optimising Youden's J; output text never asserts AF, only "please arrange an ECG" | metrics only, `"dataset": "SYNTHETIC FIXTURES (no PhysioNet data present)"` |
| `voice_dysarthria_clf.py` | Synthetic fallback (n=240) that says outright "the number means nothing" (`:110-111`). Real path reads TORGO/LibriSpeech trees grouped by speaker | Limitations record that a TORGO/Hindi-Punjabi population mismatch cannot be trained away (`:112-114`); "The output is ONE feature into a deterministic engine. It never decides." (`:117`) | metrics only, synthetic |
| `voice_clone.py` | A **planning script**, not a trainer. Emits an XTTS-v2/Indic-TTS spec as JSON | `validate_clip` (`:99-114`) rejects clips outside 90-600s or unsupported languages; supplying a real `--data` path raises `SystemExit("Voice-clone training is not implemented…")` (`:140-144`) | a plan; no audio asset, by design |
| `personalised_asr_adapter.py` | Docstring says it outright: "this executable is a synthetic drift/spec simulation, not a LoRA trainer" (`:3-6`). `word_error_rate` (`:137-150`) is a genuine Levenshtein WER, run only against fabricated pairs | `--archive` verifies a real export then `raise SystemExit("Real LoRA training is not implemented…")` (`:202-208`); `build_spec` requires ≥ 50 pairs | metrics only, fabricated drift figures |

`common.py::Metrics.save` (`:88-96`) refuses to write a metrics file whose `limitations`
list is empty — "an unqualified number is the thing this project exists not to produce".
`grouped_cv_predict` (`:142`) enforces speaker-grouped CV and never a random split.
`render_model_cards.py` regenerates `docs/models/*.md` mechanically from the artifacts and
refuses to invent the hand-written `## Purpose` section (`:60-76`); `--check` fails CI on a
stale card.

### 6.2 `asr_runtime`

`backend/app/ml/train/asr_runtime/runtime.py`, 2469 lines. This is a real, fail-closed
LoRA/PEFT fine-tuning runtime over an MMS / Wav2Vec2 CTC base — the training code is
genuinely there (`run_training:2317-2376` calls `_apply_lora`, `_optimise_lora`, and
`model.save_pretrained`). It has never trained anything.

The gates, in the order `run_training` hits them:

| Gate | Function | Line |
|---|---|---|
| trust root present | `_load_pinned_governance_keys` | `:432`, raises `governance_trust_root_missing` at `:483-487` |
| key within validity window | `_resolve_pinned_governance_key` | `:491` |
| Ed25519 signature | `_verify_ed25519_signature` | `:506` |
| receipt approved, purpose-bound, archive/base-model/patient SHA-256-bound, consent scopes, ≤24 h validity | `verify_governance_receipt` | `:544-694` |
| archive integrity | `_stable_verify_archive` → `awaaz_archive.py:54` | `:1030` |
| speaker/phrase-disjoint splits, ≥50 pairs, ≥10 components | `build_group_phrase_disjoint_split`, `_assert_split_adequate` | `:757`, `:732` |
| pinned dependency versions | `_check_dependencies` | `:1222` |
| output path containment | `_assert_output_location_contained` | `:976` |
| TOCTOU re-hash of every input | `_assert_inputs_unchanged` | `:1691` |
| patient text kept out of saved metadata | `_sanitize_adapter_metadata` | `:2082` |

**The decisive fact: `governance_public_keys.json` ships with `"keys": []`.** The file's
own comment says so and says why — with no key pinned the runtime refuses every real
command, "which is the correct state until a clinical owner exists", and adding a key is a
governance act rather than a configuration change. So `run_training` cannot succeed in
this repository, and the heavy ML modules are never even imported (`_load_ml_runtime` is
called only after preflight passes, `:1720-1731`).

`run_synthetic_smoke` (`:1610-1677`) builds a 12-phrase / 24-row fixture set with
`audio_present: False`, runs it through the real split code, and writes exactly one file:
a `manifest.json` with `"status": "synthetic_smoke_completed_no_model"` and limitations
reading "SYNTHETIC METADATA SMOKE ONLY: no acoustic model or adapter was instantiated or
trained." No WER or intelligibility number for Awaaz ASR exists anywhere in this
repository.

### 6.3 `ml/rl`

Offline policy evaluation for Awaaz candidate ranking. The package docstring
(`rl/__init__.py:3-6`) enumerates what it does not do: no online training, no exploration
on patients, no change to the confirmation gate, no language generation, no speech, no
clinical claim.

- `contracts.py` — dataclasses with `__post_init__` validation. No transcript or audio
  field exists anywhere in them (`:3-6`). `MAX_CANDIDATES = 8`.
- `offline.py` — **SNIPS is the headline estimator** (`HEADLINE_ESTIMATOR = "snips"`,
  `:104`). Raw IPS is computed as a diagnostic. A doubly-robust estimator exists
  (`_doubly_robust:466-489`) but its `role` is a read-only property returning
  `"secondary_diagnostic_only"` (`:294-296`) and it never decides a status
  (`:834-835`). Hard floors: `MIN_EVENTS_FLOOR = 50`, `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR
  = 25.0`, `MIN_OVERLAP_RATE_FLOOR = 0.80`, `MAX_IMPORTANCE_WEIGHT_CEILING = 20.0`
  (`:36-100`). A deterministic logger is refused outright with the blocker
  `logging_policy_is_deterministic` (`:737-743`).
- `safety.py` — `gate_policy` (`:43-64`) is an allow-list, so a future capability starts
  blocked until deliberately reviewed. `gate_logged_feedback` (`:67-90`) admits only
  passive observation, dysarthria-dominant, non-emergency, confirmation-required events
  from the **patient** actor: `caregiver_label_is_not_patient_preference` (`:79`).
  `gate_outcome_model` (`:94-118`) refuses any DR outcome model not validated by
  patient-grouped holdout.
- **There is no deployment path.** `OfflineComparison.deployment_allowed`,
  `.online_experiment_allowed` and `.clinical_claim_allowed` are read-only properties
  that always return `False` (`offline.py:353-363`), written that way specifically so no
  caller and no `dataclasses.replace` can forge an authorisation (`:326-333`).
- `simulate.py:222-223` uses a fabricated validation attestation and says so: "No real
  model has ever produced one."

The single production touchpoint is `routers/awaaz.py:1185::logged_feedback_from`, which
maps a stored row into a `LoggedFeedback`. It lives beside the writer rather than in
`ml/rl/` so the row shape and the wire shape cannot drift apart unnoticed. It does not
call `compare_policies` and nothing wires a policy back into the speech path.

### 6.4 `ml/` top level

`face.py`, `speech.py`, `scoring.py`, `baseline.py`, `reaction.py`, `explain.py` — the
v1 implementations, described as "ported byte-for-byte from the verified reference
implementation" (`ml/__init__.py:3-4`). Only one has a production caller:
`ml/speech.py::extract_speech_features`, used by `exam/speech_tasks.py:153,183`. The rest
are reachable only from tests. See §11.

---

## 7. Safety and SLM

### 7.1 Template-guaranteed vs model-generated

The split is clean, and the guaranteed side is larger than you might expect.

**Guaranteed by template, no model involved:**

- The FAST card. `safety/fast.py::fast_card` returns a fixed dict in en/hi/pa, including
  a `limitation_notice` stating that the app watches slow change and cannot detect a
  stroke as it happens. It is attached to *every* finalize response unconditionally
  (`routers/sessions.py:230-231`) and every acute escalation.
- Acute escalation text. `safety/acute.py::_ESCALATION_TEXT` (`:62-69`), nine symptom
  codes with labels in three languages.
- **The Hindi explanation.** `session_pipeline.py:362-365` calls `render_template`
  directly for `hi`. The SLM is only ever asked for English.
- The clinician line. `render_clinician_line` (`slm/templates.py`), called at
  `session_pipeline.py:366`.
- Every fallback. `guardrail.py:106-117` and `:129-141`.

**Model-generated, and only ever the English caregiver sentence:**
`session_pipeline.py:359` calls `slm_explain(payload_en, generate=generate)`. When
`generate is None` — which is the server's normal state — `explain` returns the template
immediately (`guardrail.py:129-141`). In the PWA `generate` is WebLLM on the device.

### 7.2 What the model is allowed to see

`SLMInput` (`slm/prompt.py:48-71`) is the entire input, and `build_slm_input`
(`:74-107`) discards the z-score attached to each driver on the way in: the model is told
*which* observations changed, never *by how much*, "because 'by how much' is exactly the
kind of quantity it might restate incorrectly" (`:84-88`). It receives band, up to three
English driver phrases, confounder codes, a language and three booleans. No feature value,
no threshold, no number.

### 7.3 The guardrail

`slm/guardrail.py::validate_generation` (`:94-119`) runs four checks and returns the
deterministic template on **any** violation:

1. **Forbidden language** via `safety/guards.py::contains_forbidden`. Two categories
   for two different reasons (`guards.py:5-13`): diagnostic terms because we are not a
   diagnostic device, and wellness assertions because telling somebody they are fine on
   the morning they are having a stroke is the single worst output this product could
   produce. Substring matching on purpose — "a clever regex that 'understands context' is
   exactly the kind of thing that fails open. These fail closed" (`:15-16`).
2. **Band contradiction** — `_BAND_CONTRADICTIONS` (`:36-45`) maps each band to phrases
   that would mean the model overrode the engine. `PATTERN_ATYPICAL` has its own entry
   including `"stroke"`, because there is no stroke finding there and saying otherwise
   inverts the message.
3. **Fabricated numbers** — the model was given no numbers, so any digit is invented.
   `108` and `112` are the only allowed numerics (`:49`).
4. **Length** — ≤ 600 chars, ≤ 4 sentences.

A generation failure of any kind (model missing, OOM, timeout) degrades the same way
(`:145-151`). Partially-repaired output is never shown; `scrub` exists (`guards.py:103`)
but is documented as a last resort, because a scrubbed sentence reads as nonsense and
nonsense in a health app destroys trust as fast as a wrong claim.

---

## 8. Data model

21 tables in `backend/app/models.py`. No `LargeBinary` and no `BLOB` column exists
anywhere in the schema, asserted by `test_invariants.py:73`.

| Table | Class:line | Purpose | Foreign keys |
|---|---|---|---|
| `users` | `User:129` | accounts; role ∈ patient/caregiver/clinician/asha_worker/admin | — |
| `patients` | `Patient:146` | enrolment, stroke details, tier, exclusions, calibration/identity | caregiver_id, clinician_id, user_id, asha_worker_id → users.id |
| `sessions` | `ExamSession:230` | one exam sitting; quality, identity, practice flag | patient_id |
| `module_results` | `ModuleResult:264` | features per module, numbers only, + fatigue instrumentation | session_id |
| `baselines` | `Baseline:311` | adaptive median/MAD/trajectory **and** the frozen reference | patient_id |
| `deviations` | `Deviation:358` | per-module z, RCI, CUSUM, laterality | session_id |
| `scores` | `Score:385` | band, gates, drivers, confounders, cumulative drift | patient_id, session_id |
| `alerts` | `Alert:428` | raised alerts and acknowledgement | patient_id, score_id, acknowledged_by |
| `questionnaires` | `Questionnaire:452` | PHQ/EAT-10/FSS/Barthel/DHI/HEARING | patient_id, session_id |
| `vitals` | `Vital:468` | BP, rhythm flag, PPG features | patient_id, session_id |
| `adherence` | `Adherence:483` | medication confirmation | patient_id |
| `safety_events` | `SafetyEvent:493` | acute symptom reports; never scored | patient_id, reported_by |
| `audit_log` | `AuditLog:509` | append-only trail | actor_id, patient_id |
| `wearable_data` | `WearableData:525` | vendor readings; trended, never re-claimed | patient_id |
| `fall_events` | `FallEvent:555` | device-reported falls; bypass the engine | patient_id |
| `asha_visits` | `AshaVisit:585` | one household visit, idempotent per worker + client id | asha_worker_id, patient_id, session_id |
| `awaaz_profiles` | `AwaazProfile:618` | speech profile + auto-speak settings; gates INV-9 | patient_id |
| `phrase_cards` | `PhraseCard:652` | the phrase board | patient_id |
| `voice_samples` | `VoiceSample:674` | voice-clone **metadata only** | patient_id, consent_by |
| `utterance_log` | `UtteranceLog:701` | what was spoken, whether confirmed, + audio receipt | patient_id, card_id, audio_consent_by |
| `awaaz_policy_events` | `AwaazPolicyEvent:818` | one candidate-ranking decision + its propensity | **none** |

### 8.1 Which tables carry `patient_id`

Seventeen do. Four do not, and only one of those is a deliberate design decision.

| Table | `patient_id`? | Link | Deliberate? |
|---|---|---|---|
| `users` | no | n/a — an account is not a patient record | n/a |
| `module_results` | no | via `session_id → sessions.patient_id` | incidental; ordinary normalisation |
| `deviations` | no | via `session_id → sessions.patient_id` | incidental |
| `awaaz_policy_events` | **no, and no FK at all** | none — there is no path from a row to a patient | **deliberate**, `models.py:755-761` |

The comment is worth quoting because the trade is unusual (`models.py:755-761`): "Every
other table in this schema hangs off `patients.id`; this one must not, because a row that
can be joined to a patient is a per-person record of what they tried to say… That is the
correct trade — an offline UX estimate does not justify a re-identifiable log."
`logged_on` is a `Date` rather than a timestamp for the same reason (`models.py:880`): a
microsecond timestamp would join effectively one-to-one onto `audit_log.ts` and
`utterance_log.ts`, both of which do carry `patient_id`.

The cost is written down beside it and is real: with no patient column there is no
patient-level split before fitting, so repeated-speaker dependence in the offline
estimator cannot be corrected from this log, and cohort analysis on this table is
impossible.

### 8.2 Migrations

Chained 0001 → 0014. All additive except three:

- **0002** (`0002_v2_exam_schema.py:87-91`) drops five v1 tables — `daily_samples`,
  `feature_vectors`, and the v1 `baselines` / `scores` / `alerts` — plus two
  `patients` columns. Justified in its own docstring: no production data existed yet.
  Note that the dropped `daily_samples` carried `audio_path` and `video_path`
  `String(512)` columns (`0001_initial_schema.py:79-80`) — paths, not bytes, and gone
  before anything used them, but the only media-adjacent columns this schema has ever had.
- **0004** contains data migrations via raw `op.execute` UPDATE
  (`0004_domain_split_and_frozen_reference.py:46-60, :73-74`): backfilling the frozen
  reference for already-locked baselines, and renaming `speech_language` to
  `motor_speech` / `language` on existing deviations. This is the migration whose
  `WHERE locked = 1` broke the first Neon boot.
- **0012** is a pure repair migration: it discovers and drops every stray or duplicated
  CHECK constraint left on `users.role` by 0005 and 0011's SQLite double-prefix naming
  bug, and installs one canonical `ck_users_role_enum`. No schema shape change.

0014's revision id is the non-integer string `"0014_awaaz_policy_events"`, deliberately, to
avoid colliding with a differently-numbered 0014 on another branch (`:34-41`).

**INV-7's mechanism lives in two files that deliberately disagree.** `app/db.py:37-45`
turns `PRAGMA foreign_keys=ON` for SQLite at *runtime*, so the app behaves like Postgres
for `ON DELETE CASCADE`. `alembic/env.py:53-68` explicitly does **not** use
`app.db.make_engine`, because SQLite cannot ALTER a constraint and Alembic's batch mode
rebuilds a table by copy-move-**drop**-rename — and with enforcement on, dropping a parent
cascades into every child. Migration 0005 rebuilds `users`; run with enforcement on, it
took every patient, session, score and baseline with it and left a structurally valid,
entirely empty database. After migrating, `env.py:74-87` runs `PRAGMA foreign_key_check`
and raises on any dangling row. `test_invariants.py:176` asserts both facts textually.

---

## 9. Frontend

### 9.1 Routes

All defined in one `<Routes>` block, `App.tsx:95-115`. Everything except `Landing` and
`Login` is lazy.

| Path | Component | Guard |
|---|---|---|
| `/` | `LandingOrHome` (`App.tsx:62-71`) — Landing when signed out; `/admin` when role is admin; else `Home` | inline |
| `/login`, `/register` | Login, Register | none |
| `/diagnostics` | Diagnostics | **none** — meant to run on a strange phone with no patient data (`App.tsx:98`) |
| `/listen/:token` | Listen | **none** — opened by a stranger with no account (`App.tsx:105`) |
| `/exam/:patientId`, `/exam/:patientId/practice` | Exam, ExamPractice | `RequireAuth` |
| `/dashboard/:patientId`, `/clinic`, `/report/:patientId` | Dashboard, Clinic, ClinicianReport | `RequireAuth` |
| `/awaaz/:patientId`, `/review/:patientId` | Awaaz, ReviewQueue | `RequireAuth` |
| `/onboarding/:patientId`, `/enrol/:patientId` | Onboarding, Enrol | `RequireAuth` |
| `/admin` | Admin | `RequireAuth` |

`RequireAuth` (`App.tsx:73-78`) checks only that a user exists. Role routing in `Home()`
(`:81-86`) is convenience, not a boundary — INV-6 is enforced server-side and the UI is
never the boundary.

### 9.2 The offline / IndexedDB layer

Four separate IndexedDB databases, deliberately separate:

| DB | Store | File | Holds |
|---|---|---|---|
| `neurotrace` | `pending_sessions` (key `localId`) | `lib/offline.ts:16-18` | whole exam sessions captured with no network |
| `neurotrace-awaaz-vault` | `audio_pairs` (key `capture_id`) | `lib/awaazAudioVault.ts:9-13` | consented practice WAVs |
| `neurotrace-awaaz-emergency` | `phrases` (key `patient_id`) | `lib/awaazEmergencyAudio.ts:10-12` | one pre-recorded emergency phrase, its own DB so the practice vault's schema upgrades cannot break it (`:4-7`) |
| `neurotrace-awaaz-board` | `boards` (key `userId:patientId`) | `lib/awaazOfflineBoard.ts:15-31` | cached phrase board, scoped to the user who fetched it |

`syncPending` (`lib/offline.ts:125-171`) replays in `capturedAt` order and **stops on the
first failure** (`:167`), because continuing would push later sessions ahead of the failed
one and break the consecutive ordering the persistence gate depends on. It is a good
function. Nothing calls it — see §11.

The board cache falls back only on `ApiError.status === 0`, never on 401/403/404
(`awaazOfflineBoard.ts:34-36`): an authorisation answer is never served from a cache.

The service worker is real — `vite.config.ts` configures `VitePWA` with
`registerType: "autoUpdate"`, precaches the MediaPipe WASM and the ~4 MB face model from
our own origin, and raises the cache-size cap to 12 MB because the default 2 MB would
silently skip the model and the offline claim would fail in the one place it matters
(`vite.config.ts:24-30`). API responses are `NetworkOnly` — a stale dashboard showing
yesterday's band as today's is worse than showing nothing (`:31-36`).

### 9.3 Where the confirmation loop lives

`frontend/src/routes/Awaaz.tsx`:

- `submitFree` (`:639-662`) — posts free text, speaks only if the server said
  `speak_now`, otherwise stores `candidates` and speaks nothing.
- candidate rendering (`:1216-1231`) — tap targets under "Nothing is spoken until you
  choose".
- `confirmCandidate` (`:664-684`) — re-posts with `confirmed_candidate: true` and speaks
  only when the second response says `speak_now`.
- `speakCard` (`:416-481`) — speaks immediately; INV-9 does not apply to a phrase the
  patient authored and tapped.

The file's own header comment is the accurate summary (`:12-16`): "The server is the
authority on that gate (`may_auto_speak`, pinned by tests). This UI never routes around
it."

### 9.4 Auth and API

`lib/api.ts:44` — `BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000"`.
Tokens in `localStorage` under `neurotrace.tokens` (`:45`). On a 401, `request()` refreshes
once and retries with `retry:false` (`:167-171`); concurrent 401s share a single in-flight
refresh via `refreshInFlight` (`:95, :101-123`) so a dashboard firing four requests does
not burn four refresh tokens.

`lib/auth.tsx:41-49` — if `api.me()` fails while offline, the session is **not** cleared;
`shouldKeepStoredIdentity` decides whether to preserve the last known identity so the
local-only safety surfaces (the Awaaz emergency phrase) stay reachable with no network.

---

## 10. Test topology

29 test files under `backend/tests/`, **703 `def test_` functions**, expanding to
roughly the ~1191 collected tests `CLAUDE.md` cites once parametrisation is applied. The
gap is concentrated in a few files.

`conftest.py` builds a fresh SQLite database per **pytest process**, keyed by PID
(`:19-37`) — documented as having caused three real incidents when two concurrent runs
shared a file. `TEST_DATABASE_URL` can point the same suite at Postgres. Env vars are set
by `os.environ.setdefault` before `app.config` is imported (`:40-46`), which must happen
first. The `provision` fixture (`:108-134`) writes privileged `User` rows directly rather
than going through `/auth/register`, because that endpoint deliberately refuses to let a
client self-assign a privileged role — that is intentional, not a workaround.

| File | Covers | `def test_` | Collected |
|---|---|---|---|
| `test_admin.py` | `/admin` surface returns counts and events only; no clinical content | 6 | ~20 |
| `test_alert_gate_sim.py` | seeded 10-day simulation, baseline → stable → WATCH → ALERT | 10 | 10 |
| `test_api.py` | HTTP surface, access rules, enrolment gate, FAST on finalize | 32 | ~34 |
| `test_asr_runtime.py` | happy path + first refusals of the ASR runtime | 15 | ~20-25 |
| `test_asr_runtime_gates.py` | deletion-sensitive audit of every ASR governance gate | 74 | 150-250+ |
| `test_auth.py` | register/login/refresh/role guard; privileged self-registration blocked | 27 | ~32 |
| `test_awaaz.py` | phrase board, auto-speak gate across the full confidence range, emergency | 57 | ~360 |
| `test_awaaz_archive.py` | archive verification fails closed; cohort-plan dedup | 11 | ~13 |
| `test_awaaz_offline_rl.py` | offline RL safety and reproducibility | 76 | 76 |
| `test_awaaz_policy_logging.py` | AWA-FR-014 logging contract; cites INV-1/6/8/9/11 | 24 | 24 |
| `test_config_urls.py` | `DATABASE_URL` normalisation for asyncpg | 4 | 4 |
| `test_domains_and_reference.py` | the speech domain split and the frozen reference | 14 | ~16 |
| `test_emergency_notifications.py` | delivery never claims success when unconfigured | 4 | 4 |
| `test_engine.py` | baseline, deviation, gates, confounders maths | 39 | 39 |
| `test_exam_modules.py` | every module's extractor on a fixture; the 90s daily budget | 47 | 47 |
| `test_identity.py` | identity vector stored, verdict recorded, capture never refused | 8 | ~9 |
| `test_invariants.py` | INV-1..INV-8 and INV-10 — see below | 15 | 15 |
| `test_laterality.py` | Gate 3 and the PD exclusion | 30 | ~32 |
| `test_migration.py` | Alembic output equals `Base.metadata`, via a real CLI subprocess | 4 | 4 |
| `test_migration_portability.py` | no boolean-vs-integer comparison, no SQLite-only function, in any `op.execute` | 5 | ~31 |
| `test_posterior_circulation.py` | oculomotor, CCG, DHI, vertigo log, against the reference patient | 42 | 42 |
| `test_privacy.py` | INV-11 across the working tree, the index, and git history | 13 | ~26 |
| `test_protocol_runtime.py` | `/sessions/plan/{intensity}` wire format vs the TS mirror | 9 | 9 |
| `test_safety_slm.py` | forbidden language, band match, fallback, FAST localisation | 35 | ~70 |
| `test_scoring.py` | the v1 scoring maths pinned against its reference | 32 | 32+ |
| `test_session_pipeline.py` | the PRD acceptance run: 14 baseline, 4 stable → 0 alerts, 3 declining → exactly 1 | 18 | 18 |
| `test_session_plan.py` | recall delay, session length, fall-risk tasks out of the daily protocol | 16 | 16+ |
| `test_tiers_wearables_asha.py` | tiers, wearables, fall bypass, ASHA sync; the full INV-7 account | 19 | 19 |
| `test_train.py` | training utilities and the tap-asymmetry claim | 17 | 17 |

Frontend: `vitest.config.ts`, `environment: "node"`, `include: src/**/*.test.ts`. **8 test
files, 51 cases, no parametrisation.** The most load-bearing is
`lib/ondevice/__tests__/parity.test.ts` (10 cases), which pins JS against Python at 1e-9
and additionally asserts no missing and no invented feature.

`test_privacy.py` is the strongest file in the suite. It checks tracked content, the local
working tree, **the git object store including unreachable blobs** (`:304` — a regression
for 22 staged-then-abandoned JPEGs found once), and `origin/main` (`:352`). It also
self-tests its own detector in both directions (`:400-410`), and runs the trainer modules
as subprocesses to confirm a `--patient` argument never reaches a written artifact or
stdout (`:444`).

---

## 11. Invariant enforcement map

The most useful table in this document, and the one where the docs are most optimistic.
`ARCHITECTURE.md` §6 and `CLAUDE.md` both say every invariant has a test in
`test_invariants.py`. Three do not.

| # | Rule | Enforced in code at | Tested at | Enforcement strength |
|---|---|---|---|---|
| **INV-1** | Raw media never leaves the device | Structural: no `UploadFile`/`File(`/multipart anywhere; `ModuleSubmit.raw: dict\|None` (`schemas.py:151`); `capture.ts:1-11` has no MediaRecorder in the exam path; audio receipts are UUID + hash + duration only (`routers/awaaz.py:276-348`) | `test_invariants.py:33` (source scan for 3 markers), `:60`, `:73` (no binary column); `test_privacy.py` for the tree | **Strong for the shapes it scans.** The scan is 3 literal markers over `app/**.py` only — a `bytes` field or a base64 string would pass |
| **INV-2** | No ALERT without a lateralised finding | `gates.py:325` — the only `BAND_ALERT` assignment, requiring `gate3_passed` | `test_invariants.py:87` — drives the engine and checks the answer, deliberately not a source grep (`:90-94`) | **Strong.** Behavioural, single code path |
| **INV-3** | Acute symptoms and falls bypass the engine | `routers/safety.py` imports nothing from `engine`; `safety/acute.py` computes the payload before any DB write (`:51-54`) | `test_invariants.py:132` — asserts `"evaluate_gates"` and `"compute_module_deviation"` are absent from `acute.py` and `wearable.py` | **Medium.** A textual absence check over two named files; `routers/safety.py` itself is not in the list |
| **INV-4** | The frozen reference is written once | `session_pipeline.py:136` — `if row.locked and row.reference_locked_at is None` | `test_invariants.py:145` — asserts the literal string `"row.reference_locked_at is None"` is present in the file | **Weak as tested.** The check is a substring match on source, not behaviour; the code itself is correct |
| **INV-5** | We own the trend, the vendor owns the measurement | `routers/wearable.py:98, :155, :177` — `claim_notice` on every response | `test_invariants.py:157` — `claim_notice` appears ≥ 2 times in `wearable.py` | **Weak as tested.** Counts occurrences in one file; says nothing about content |
| **INV-6** | Server-side authorisation on every scoped route | `auth/deps.py:60::get_patient_for_user` and `:45::require_roles`, applied per router | `test_invariants.py:166` (3 named routers contain one of the two strings); `test_auth.py:219`; `test_awaaz_policy_logging.py:381` (real unauthenticated + wrong-user probes) | **Medium.** The invariant test samples three files; the genuine coverage is in the two behavioural files |
| **INV-7** | Migrations never lose rows | `alembic/env.py:53-68` does not enable FK enforcement; `:74-87` runs `PRAGMA foreign_key_check` and raises on dangling rows | `test_invariants.py:176` (asserts `make_engine(` absent, `foreign_key_check` present); `test_tiers_wearables_asha.py:352-354` is the real regression test | **Strong**, via `env.py`'s own post-migration check |
| **INV-8** | Audit data is append-only | No `updated_at` on `AuditLog`; no `delete(AuditLog)` anywhere; `policy_outcome` refuses a differing retry rather than correcting (`routers/awaaz.py:1092-1112`) | `test_invariants.py:188`; `test_awaaz_policy_logging.py:481` | **Medium.** `AuditLog` rows are ordinary mutable ORM objects — nothing prevents `row.action = ...` at runtime; the guarantee is by convention plus a source scan |
| **INV-9** | Nothing spoken for an aphasic patient without confirmation | `awaaz/safety.py:81::may_auto_speak` — one pure function, allow-list of one profile, floor of 0.70, invalid input returns False. Re-enforced at write time on policy outcomes (`routers/awaaz.py:1131-1145`) and at read time by `rl/safety.py:67` | **Not in `test_invariants.py`.** `test_awaaz.py` sweeps 101 confidence values × 3 non-eligible profiles; `test_awaaz.py:603` audits the confirmed flag; `test_awaaz_offline_rl.py:665`; `test_awaaz_policy_logging.py:535` | **Strong in code, well tested — but not where the docs say.** The claim "each has a test in `test_invariants.py`" is false for this one |
| **INV-10** | Every module has a declared tier placement | `registry.py:501-511` capabilities, `:514/:555/:567/:575` placement functions, plus the comment at the definition site and `scripts/hooks/registry-guard.sh` | `test_invariants.py:199, :233, :258, :287, :318` — five tests, all behavioural | **Strongest in the repo.** Three independent mechanisms |
| **INV-11** | No patient identifier anywhere in this repository | `.gitignore` as an allow-list for `data/*` and `artifacts/**`; `scripts/preflight_push.sh` (7 checks) on push; `ml/train/common.py::redact_patient_label` | **Not in `test_invariants.py`.** `test_privacy.py` is the real test: tracked files, working tree, git object store, `origin/main`, subprocess trainer runs | **Strong, and tested thoroughly — but not by an invariant test.** Note `ARCHITECTURE.md` §3 admits the scan covers *tracked repository content*, not schema shape |
| **INV-12** | Fall-risk tasks never appear in an unsupervised schedule | Two mechanisms that do not agree: `registry.py:536-544` `SUPERVISED_TASKS` (6 tasks) with `SUPERVISED_DEVICES` (`:552`); and `session_plan.py:142-144` `SUPERVISED_ONLY` (4 tasks) governing the daily `PROTOCOL` | **Nowhere by name.** The literal string "INV-12" does not appear anywhere under `backend/`, `frontend/` or `scripts/`. Its substance is covered by `test_session_plan.py:76` and, mislabelled, by `test_invariants.py:318` | **Weakest of the twelve.** See the note below |

**On INV-12.** The test at `test_invariants.py:318`,
`test_inv10_a_task_needing_supervision_can_never_be_marked_unsupervised`,
is, by `CLAUDE.md`'s own one-line description, the INV-12 rule — but it is named and
numbered INV-10. Separately, `SUPERVISED_TASKS` and `SUPERVISED_ONLY` are two disjoint
authorities on the same question, and `romberg_eyes_closed` and `tandem_stance` sit in the
gap: the registry says they need a supervised device, the daily protocol runs them anyway
at positions 12 and 13 (`session_plan.py:109-113`). The registry-side reconciliation is
that both are assigned `"caregiver"` (`registry.py:307-308`) and every tier has the
`caregiver` capability, so the constraint is satisfied *by declaration* — the system never
verifies a caregiver is actually present. The `FallRiskGate` before the standing block
(`ProtocolRunner.tsx:329-343`) is the only runtime check, and it can be explicitly skipped.

---

## Things that surprised me

Nine findings, all verified against the code.

**1 · Three invariants have no test in the file the docs say holds them.**
`ARCHITECTURE.md` §6 opens with "Each is numbered. Each has a test in
`backend/tests/test_invariants.py`", and `CLAUDE.md:67` says "Each has a test."
`test_invariants.py` contains tests for INV-1 (×3), 2, 3, 4, 5, 6, 7, 8 and 10 (×5) —
fifteen functions, and **nothing for INV-9, INV-11 or INV-12**. INV-9 and INV-11 are
genuinely and heavily tested elsewhere (`test_awaaz.py`, `test_privacy.py`), so the
substance is fine; the navigational claim is not. INV-12 is not tested by that name
anywhere in the repository — `grep -rn "INV-12" backend frontend scripts` returns nothing.

**2 · `SUPERVISED_TASKS` and `SUPERVISED_ONLY` disagree, and the daily protocol sits in
the gap.** `registry.py:536-544` lists six tasks that "must never run unsupervised".
`session_plan.py:142-144` lists four that are "never in the unsupervised daily rotation".
`romberg_eyes_closed` and `tandem_stance` are in the first and not the second, and both
run daily at positions 12 and 13. The reconciliation — they are assigned `"caregiver"`,
and every tier grants `caregiver` — means the guarantee is that *the tier model declares a
caregiver exists*, not that anyone checked. `test_session_plan.py:80` asserts against the
weaker four-task set, so this passes cleanly. The stated guarantee "fall-risk tasks never
appear in an unsupervised schedule" is, for two eyes-closed / narrow-base tasks, held by
the definition of `TIER_1_PHONE` rather than by an observation.

**3 · Two entries in `SUPERVISED_TASKS` are dead.** `"timed_up_and_go"` and
`"standing_sway"` (`registry.py:541-542`) are not tasks of any module in `MODULES` —
`grep -rn` finds them nowhere else in `backend/`. They are leftovers from the pre-v2.2 M9
("Timed Up & Go, 30s standing sway", still described that way in `TRD.md` §4). They are
harmless, but they make the supervised set look larger than it is: the guard at
`test_invariants.py:318` iterates `module.task_devices`, so a task no module declares is
never checked against anything.

**4 · `Intensity.RESEARCH` is documented as adding supervised balance tasks and adds
nothing.** `session_plan.py:49-50` says "FULL plus the supervised balance tasks. ASHA visit
only." `steps_for` at `:163-164` reads `if intensity in (Intensity.FULL,
Intensity.RESEARCH): return list(PROTOCOL)` — byte-identical output to FULL. The Unterberger
and tandem-walk steps the docstring promises are not in `PROTOCOL` at all. A RESEARCH
session is a FULL session. `test_session_plan.py` parametrises over `list(Intensity)` and
only asserts each produces a runnable session, so this passes.

**5 · The offline session queue has no drain.** `lib/offline.ts:125::syncPending` is a
careful function — replays in capture order, stops on the first failure to preserve the
consecutive ordering the persistence gate depends on. `grep -rn "syncPending"` across
`frontend/src` returns exactly one hit: its own definition. `onConnectivityChange`
(`:173-181`) is likewise defined and never called. `ProtocolRunner.tsx:281` enqueues on
failure, so a session captured offline is written to IndexedDB and, on the evidence in
this tree, stays there. Given that Gate 1 is a function of *consecutive* sessions, a
silently-stranded session is not a cosmetic bug: it is a gap in the persistence window
that neither the patient nor the clinician can see.

**6 · Six `ml/` modules are alive only in their own tests.** `ml/baseline.py`,
`ml/scoring.py`, `ml/explain.py`, `ml/reaction.py` and `ml/face.py` have no importer
anywhere in `app/` — the production equivalents are `engine/baseline.py`,
`engine/gates.py` and `slm/guardrail.py`, which are separate implementations of the same
ideas. `ml/baseline.py::build_baseline` and `engine/baseline.py:211::build_baseline` are
different functions with the same name; only the second is wired to
`session_pipeline.py:30`. `test_scoring.py` (32 tests) and `test_alert_gate_sim.py` (10)
exercise the v1 versions exclusively. That is 30-odd tests and ~250 lines pinning code the
running product does not execute — which is fine as a reference implementation, but the
`ml/__init__.py:3-4` framing ("do not change their logic") reads as though they were the
live path.

**7 · `docs/GOVERNANCE_KEYS.md` does not exist.** `governance_public_keys.json` says
"See docs/GOVERNANCE_KEYS.md for the procedure", and the file is not in `docs/`. Since the
empty key list is the single fact that makes "the ASR runtime has never trained anything"
true, the procedure for changing that state is the most consequential missing document in
the repository. (`asr_runtime/requirements.txt` also exists separately from
`backend/requirements-train.txt`, which `ARCHITECTURE.md` §2 names as the split.)

**8 · Two stale cross-references in load-bearing docstrings.**
`exam/__init__.py:1` says "Exam modules M1-M20" and `registry.py:3` says "all twenty
modules"; there are 21, and `docs/DEVELOPMENT.md:83` already records that this row was
wrong and was fixed by counting — the code comment was not. `exam/__init__.py:4` says the
JS/Python parity is pinned by `tests/test_js_python_parity.py`; that file does not exist.
The parity test is real but lives in the frontend, at
`frontend/src/lib/ondevice/__tests__/parity.test.ts`, consuming a fixture from
`backend/tools/gen_parity_fixture.py`. A reader following the docstring finds nothing and
could reasonably conclude parity is unpinned.

**9 · `has_laterality` is reconstructed by inference when reading history, and can be
wrong.** `session_pipeline.py:190` rebuilds prior sessions' `ModuleDeviation` objects from
the `deviations` table with
`has_laterality=row.lateral_abs_z > 0.0 or row.lateralised`. But `deviations` has no
`has_laterality` column, so a module that *does* have `lateral_keys` and happened to score
exactly 0.0 on all of them — the case where the patient is perfectly symmetric — is
reconstructed as a module with no laterality at all. In practice `is_lateralised` would
return False either way, so no ALERT can be manufactured by this; the effect is confined
to `SessionDeviations.lateral_deviation()` on historical sessions. It is worth knowing
about because it is the one place in the pipeline where a persisted fact is re-derived by
heuristic rather than read.

**Two smaller notes.** `_recent_sessions` fetches `limit=4` prior sessions
(`session_pipeline.py:160`) while `PERSISTENCE_SESSIONS = 2` — harmless slack, but the
`detect_symmetric_pattern` "progressive, not resolving" check (`gates.py:241`) therefore
only ever compares two sessions, since `window = valid[-2:]`. And `get_patient_for_user`
(`auth/deps.py:70-74`) admits the owning caregiver, the linked patient account and any
clinician — **not** `asha_worker` or `admin`. That is deliberate for admin
(`ARCHITECTURE.md` §4: an admin who can read patient records is a backdoor around INV-11
with a friendlier name) and it means an ASHA worker reaches patients only through
`routers/asha.py`'s own `require_roles`-guarded surface, never through
`/dashboard/{pid}`. Worth stating explicitly, because the role table in `ARCHITECTURE.md`
§4 does not make that routing visible.
