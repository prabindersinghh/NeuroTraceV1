# CHANGELOG

Dated entries per work session: what changed, what was verified, and how.

---

## 2026-08-22 (spec v4) — the daily protocol, fatigue instrumentation, deploy readiness

### The 21-step protocol is now a data structure, not a convention
`backend/app/exam/session_plan.py`. Five blocks, fixed order, 11m35s of task time at FULL.
Four intensities (FULL / STANDARD / LIGHT / RESEARCH). `SUPERVISED_ONLY` is a frozenset that
the daily protocol filters against, so fall-risk tasks cannot reach an unsupervised schedule
by anybody forgetting — pinned as INV-12.

### Two pushbacks delivered rather than silently complied with
**Session length: agreed, with a caveat that mattered.** 12 minutes is proportionate. But
fixed ordering is what makes fatigue a constant rather than a confound, and two mechanisms
break that constant *after* a baseline locks — an intensity change and a mid-session pause.
Both move a task earlier, both make the patient less fatigued at that task, and both
therefore bias **in the direction that masks decline**. That is the dangerous direction.
Instrumented rather than prevented: `session_position`, `elapsed_seconds_at_task_start`,
`intensity`, `paused_before_task` on every module result (migration 0008).

**Task ordering: two conflicts flagged, not rearranged.** M17 PPG sits ~1.5 min after the
standing block when resting-rhythm analysis conventionally wants ~5 min seated; and M6
pronator drift (arms out, eyes closed) is scheduled standing right after two other
eyes-closed balance tasks — the peak fall-risk moment of the session — when the test is
clinically valid seated. Left as specified; D-028.

### Deploy moved off the end of the queue
Everything possible without credentials is done. `scripts/verify_deploy.sh` does not check
for HTTP 200 — it posts a known session series and asserts the deployed engine returns the
**identical band sequence** the local suite produces. A deploy that returns 200 and the
wrong band is the failure mode that matters.

### Also built
M21 SVV wired into the frontend (`StepSvv.tsx`); E3 audiometry self-report (closing the last
v3 gap); Awaaz D2–D5; `TaskShell` (DEMO→INSTRUCT→POSITION→COUNTDOWN→PERFORM→QUALITY→CONFIRM,
never shows a score, stops asking after two retries); `FallRiskGate`; `Onboarding` with five
individually-ticked scope limits; Part 4 palette; `docs/ML_STATUS.md` and five model cards
generated **from the artifact metrics**, so they cannot drift from the models they describe.

### Near-misses, recorded because they were near
- **A hardcoded demo password** (`seed.py`) would have gone to a public repo. Caught by
  `preflight_push.sh` step 6, not by review. Now environment-overridable (D-029).
- **A stale `.pyc` made INV-2 fail for the wrong reason** — `inspect.getsource` returned a
  neighbouring function. Had I trusted the failure I would have "fixed" working code. INV-2
  is now behavioural (D-026).
- **The privacy regex produced two false positives** — it read "Patient not found" as an
  identifier and the DHI subscore triple `6/8/14` as a date. A guard that cries wolf gets
  disabled, which is how the real thing gets through.

### Full suite
`pytest` → **EXIT CODE 0**. 793 collected, 793 progress marks emitted, 792 passed, 0 failed,
1 skipped — the optional `.privacy-denylist` exact-string check, which is gitignored by
design so the real identifiers never enter the repository. The counts reconcile, which is
the check that the run was whole: a suite that collects 782 and reports on 700 has swallowed
something.

### The privacy guard fired on the way to the commit
Staging the three spec documents made INV-11 fail on seven lines — and all seven were the
sentences *forbidding* identifier labels, not lines carrying one. The tempting fix is to
exempt the files. That is how a guard dies: it cries wolf, someone mutes it, and the real
one goes through. Fixed the detector instead — a label now counts only when followed by
something value-shaped (a separator, a digit-bearing token, or a capitalised proper noun),
because prose continues in lowercase or a comma. Narrowing a safety check is exactly when
that check needs tests of its own, so the distinction is now pinned by 11 parametrised cases
covering both directions.

### Merge with a collaborator's parallel fix
`origin/main` had moved: another contributor had independently fixed the same MediaPipe
bug (the script pointed at `@mediapipe/tasks-vision@0.10.22`, a version that was never
published, so every fetch 404'd). Both fixes copy the wasm out of `node_modules`.

Merged, not force-pushed — their commit stays in history. The file resolved to our version,
and the difference is worth recording because it is the same hazard twice: theirs keeps a
CDN fallback behind a hand-written `TASKS_VISION_VERSION = "1.0.1"` string. A hand-pinned
version *is* what broke: it is a second source of truth that can disagree with the lockfile
and only fails at runtime. Ours resolves the package with `require.resolve`, reads the
installed version, and has no version literal to drift.

Also kept from ours and absent from theirs: SHA-256 + byte-size verification of the model
(a silently swapped landmarker moves every patient baseline), `NEUROTRACE_MODEL_PATH` /
`_URL` for fully-offline or mirrored installs, size-difference re-copy so bumping the
dependency actually restages, and an assertion that both the SIMD and non-SIMD builds are
present — `FilesetResolver` picks between them at load time from what the browser reports,
so a missing one breaks capture on exactly the low-end devices this product targets.

Verified from a clean slate — `rm -rf public/mediapipe && node scripts/fetch-mediapipe.mjs`
→ exit 0, 6 wasm files staged from `@mediapipe/tasks-vision@1.0.1`, model checksum matched.

### Verification
Frontend `npm run build` exit 0. `preflight_push.sh` **7 passed, 0 failed**. Full backend
suite result recorded below by exit code.

---

## 2026-08-22 (final) — remote audit, SVV, E3, Awaaz D2–D5, frontend

### THE REPOSITORY HAS A REMOTE, AND THE IMAGES WERE ONE STEP FROM IT
`origin` is a GitHub repo and `origin/main` exists, so this project HAS been pushed. The
brief said the source photographs were outside the repository; they were inside the working
tree.

Audit, in order:
- `git rev-list --objects --all` → **no image path in any reachable commit**
- object-store scan by magic bytes → **22 JPEG blobs present**, i.e. they had been
  `git add`ed at some point
- reachability comparison → **0 of 22 reachable from any ref**
- `origin/main` tree → **0 image paths**; local and remote at the identical SHA

**Conclusion: never committed, therefore never pushed.** Push transfers only reachable
objects. But unreachable is not gone — the blobs were recoverable by anyone with filesystem
access and revivable by a stray `git add -A`. Purged via
`git reflog expire --expire-unreachable=now --all && git gc --prune=now`, verified: 0 image
blobs remain, HEAD unchanged, 294 reachable objects and 157 tracked files unchanged.

Pinned by two new tests: no image blob in the object store, and no image on `origin/main`.

### D-2 corrected everywhere
Our docs claimed `posterior_vestibular` satisfies Gate 3 via Unterberger angular deviation.
In the reference patient that measure was **classified normal**; the lateralised finding was
**M3 saccade velocity asymmetry ~0.37** (leftward slower and later). Corrected in
`gates.py`, `vestibular.py`, `TRD.md`, `DECISIONS.md` D-007 and the posterior test docstring.
The eye establishes; the feet corroborate.

### M21 — Subjective Visual Vertical (new module)
Static + dynamic CW/ACW, six trials each. Reproduces **all three printed averages exactly**.

Building it exposed the device's averaging convention: dynamic "Average" is the **MEDIAN**
of signed trials (CW mean 9.08 but printed 8.00, median exactly 8.00; ACW mean −1.67,
printed −1.50, median exactly −1.50), while static "Absolute Average" is the **mean of
absolutes** (1.9167 → 1.92). A calibration target we cannot reproduce is not a calibration
target, so we emit both.

Also emits `svv_dynamic_cw_drift_slope`, because the reference patient's clockwise trials
rose monotonically 3.5 → 17.5° and a mean reports 8.00 while hiding the accumulation
entirely. Capture screen randomises the start angle, gives no between-trial feedback,
compensates for handset tilt where the browser allows it and declares when it cannot, and
keeps an abort button permanently visible — an aborted run is invalid, never zero.

### E3 — hearing change self-report
Per-ear three-option monthly question. Bilateral worse (the reference patient) is recorded;
**unilateral** worse escalates, because sudden one-sided loss can be an AICA-territory
infarct with a treatment window. Makes no measurement claim about hearing level.

### Awaaz D2–D5
- **D2 listener mode.** Expiring, revocable capability link; display name only, never the
  enrolled name. Coaching is context-aware — long pause → "give them 10 more seconds";
  low confidence → "try a yes/no question" (not "speak louder"); word-finding → "do not
  guess it for them", the same error as auto-speak made by a human.
- **D4 passive learning.** Card taps yield free labelled pairs and are excluded from the
  review queue; the caregiver's evening list is worst-first and capped at 12, because the
  proposition is two minutes and a list of forty is a chore that gets abandoned.
- **D5 convergence.** Conversational features route into M4/M5. DDK and sustained phonation
  are deliberately NOT inferred from free speech — they need a prompted task, and letting
  them through would put unsupported values into M4's baseline. Frozen day-30 adapter
  flags decline the live adapter has absorbed.

### Frontend
`AshaHome` (offline-first, idempotent, task-level due lists), `WearableLanes` (vendor data
visually separated, falls as their own card type), `VertigoLog` (two taps, duration ranges
not free text, positional question), `StepSvv`. `npm run build` exit 0.

### NEAR MISS — an invariant test that cried wolf
`test_inv2_an_alert_always_has_a_lateralised_finding` failed the full suite. It was not a
broken invariant: the test grepped `inspect.getsource(evaluate_gates)` for "gate3_passed",
and a **stale .pyc** left the code object's line numbers pointing into a reshuffled file, so
`getsource` returned a neighbouring function entirely. Rewritten to drive the engine and
assert the answer. Same lesson as the registry hook — an invariant that cries wolf is one
somebody disables.

### NEAR MISS — a privacy regex that flagged clinical scores
`test_clinical_documents_use_month_and_year_only` fired on "6/8/14" — the DHI subscores,
which parse as a date. Rather than weaken a privacy guard I changed the notation to
"phys 6, emo 8, func 14", which reads better anyway. An earlier version of the same regex
had matched "Patient not found" via `no\.?` → "not".

---

## 2026-08-22 (later) — clinical source review

### PRIVACY — the source images were inside the repository
The task brief stated the 22 photographs sat outside the repo. They did not: `D:
eurotrace`
IS the git root, so all 22 photographs of a real person's hospital records were sitting
untracked in the working tree, one `git add -A` from being published. Confirmed never
committed (0 in history), now gitignored, and pinned by **INV-11**
(`backend/tests/test_privacy.py`): no tracked image, folder ignored, nothing in history, no
identifier labels in tracked text, month-and-year granularity in clinical docs, plus an
optional gitignored `.privacy-denylist` for literal checking — the literals deliberately do
not live in the test, since writing them there is the outcome the test prevents.

### CLINICAL_REFERENCE.md rebuilt from the source
All 22 images read in place. The previous version held ~8 values; the rebuild holds the
full 17-page battery plus both MRI reports: SVV per-trial, CCG (including displacement,
body-axis spin, exposure time), smooth-pursuit gains per eye and frequency, the full random
saccade table, caloric SPVs, every nystagmus battery, bedside examination both sides, DHI
subscales, and a calibration-mapping table that says NO where a phone cannot do the test.

### 16 DISCREPANCIES against the transcribed values — see GAP_ANALYSIS §3.4
The four that matter:
- **DHI subscales were inverted.** We had 12/4/12; the real values are **6/8/14**. Same
  total, nearly opposite clinical picture — this patient's burden is predominantly
  FUNCTIONAL. A total-only assertion could never have caught it. Fixture corrected and a
  test added for the *shape* of the score.
- **Angular deviation is classified NORMAL** (5° right is within this device's norms). Our
  documentation presented it as the mechanism by which `posterior_vestibular` satisfies
  Gate 3. The domain does fire one-sidedly for this patient — but via **M3 saccade velocity
  asymmetry (~0.37)**, not the feet. Design holds; our explanation of it did not.
- **We had no saccade numbers at all**, only "abnormal". Now: latency 309–370 ms, velocity
  184–304 °/s, precision 94–112%, with leftward slower and later than rightward.
- **Caloric and SVV were entirely absent** from our reference. Left caloric areflexia
  (both irrigations 0) and an abnormal dynamic-clockwise SVV rising monotonically
  3.5→17.5° are two of only three abnormalities on the whole battery.

### A narrative correction
Our reference asserted "every deficit this man had lives in balance and oculomotor
function". The history records **speech difficulty and right-limb weakness** from the
January stroke. The true, narrower lesson: the four cerebellar bedside tests were normal, so
a coordination-only module finds nothing. That is still the failure the amendment closes,
now stated truthfully.

### False-negative check, run mechanically
M8 alone on the real bedside profile → `STABLE`, nothing persistent. Pre-amendment system →
`STABLE`. Current system → `ALERT`, lateralised via `posterior_vestibular`, with
`coordination_gait` never entering the persistent set.

### P1 — test-DB contention fixed
Each pytest process now gets its own SQLite file keyed on PID (plus xdist worker id). Two
concurrent runs previously raced on one file while the `engine` fixture dropped and
recreated the schema, producing "no such table" in whichever lost. It happened three times,
cost an investigation each time, and once was misdiagnosed as a conftest fixture bug.
**Proven:** two concurrent suites now both exit 0. This was a prerequisite for the INV-10
registry hook — a guard that emits spurious failures gets switched off.

---

## 2026-08-22 — posterior circulation, tiers, wearables, ASHA, living docs

### Scope widened to posterior-circulation and cerebellar stroke (D-005)
Driven by anonymised real records (`CLINICAL_REFERENCE.md`): an 82-year-old with an
MRI-confirmed left cerebellar and bilateral occipital infarct whose finger–nose,
heel–knee–shin, dysdiadochokinesia and joint-position were **all normal**. Our M8 module
tests exactly those four things and would have reported him stable.

- New `backend/app/exam/vestibular.py`:
  - **M3 oculomotor** — saccade latency, velocity and precision *per direction*; pursuit
    gain and left/right asymmetry. Promoted monthly → **weekly**, tablet → **phone**.
  - **M9 craniocorpography** — Romberg (eyes open/closed), tandem stance, tandem walk,
    Unterberger. Sway path (cm), sway area (cm²), angular deviation (°), lateral
    displacement, plus a clinical-format movement trace. Promoted monthly → **weekly**.
- New domain **`posterior_vestibular`**, which **carries laterality** — Unterberger angular
  deviation names the side, so these patients can reach ALERT with no limb or facial sign.
- New instruments: **DHI** (25 items, three subscales, published bands) and **vertigo
  attack log**.
- `docs/CLINICAL_REFERENCE.md` records the calibration targets. No identifying information.

**Verified in tests** (21/21 in `test_posterior_circulation.py`): 5° angular deviation
reproduced to 0.3°; DHI total 28 → "mild"; 60 attacks × 15 min; and the decisive one — the
reference patient reaches ALERT while limb coordination stays normal.

### Speech split into two domains (D-011)
`speech_language` → `motor_speech` (M4 dysarthria) + `language` (M5 aphasia). Two modules in
one domain could never corroborate each other under Gate 2. Caregiver text now distinguishes
"speech sounded less clear" from "finding words was harder" in all three languages.

### Frozen reference baseline (D-013)
Baseline snapshot at lock, never updated. Every session scored against both it and the
adaptive baseline; `cumulative_drift` persisted and surfaced as its own clinician lane and
card type. **Verified in tests:** a 60-day gradual decline whose per-day change is
unremarkable still drives drift past threshold.

*Correction to an earlier assumption:* the adaptive **median** does not move after lock —
the adaptive part is the recovery **trajectory** (`intercept + slope × days`), extrapolated
forward. That is what can absorb a decline, and what the frozen reference removes.

### Deployment tiers, wearables, ASHA (prompt C)
- `deployment_tier` on patients; `modules_for_tier` / `modules_deferred_for_tier`. A watch
  is **not** a screen — TIER_2 unlocks passive data, not tablet modules.
- `wearable_data`, `fall_events`, `asha_visits` tables. `POST /wearable/{pid}`,
  `/wearable/{pid}/fall`, `/asha/households`, `/asha/session`.
- Falls **bypass the engine entirely**, like the acute path.
- ASHA sync idempotent on `client_visit_id` — a retry after a dropped connection lands on
  the same visit.
- Claim boundary enforced in every wearable response: we own the trend, the vendor owns the
  measurement.

**18/18 tests pass.**

### NEAR MISS — migration 0005 emptied the database (D-009, INV-7)
`alembic/env.py` used `app.db.make_engine`, which enables `PRAGMA foreign_keys`. SQLite
cannot ALTER a constraint, so Alembic's batch mode rebuilds a table by **dropping the
original** — and dropping `users` cascaded into patients, sessions, scores and baselines.
The result was a structurally valid, completely empty database.

Caught only because a backup was taken first and row counts were compared after. Two further
mistakes on the way to the fix, both worth recording: my first attempt set the pragma inside
the migration connection, which opened a transaction before Alembic's and made the whole
migration a silent no-op that still reported success; and I read `exit=$?` after a `tail`,
so I was checking the wrong process's exit code. `env.py` now builds its own engine without
enforcement and runs `PRAGMA foreign_key_check` afterwards. Pinned by INV-7.

### MediaPipe blocker fixed (D-010)
`npm run fetch:mediapipe` 404'd because it pinned `@mediapipe/tasks-vision@0.10.22` — **a
version that was never published** (0.10.21 is followed by 0.10.32). The package is already
a dependency at 1.0.1 and ships the wasm, so the runtime is now **copied from
`node_modules`**: no network, and it cannot drift from the bindings. The FaceMesh model is
the one remaining download, pinned by SHA-256.

**Verified live in a real browser** (`npm run verify:ondevice`, headless Edge/Chrome):
FaceLandmarker init 492 ms, 6/6 faces detected, 478 landmarks/face, and all three mouth-and-
fold asymmetry features rose with a simulated droop.

### Awaaz D1 — the communication assistant (prompt D)
Phrase board that works on day one with no setup, seeded in the patient's own language.
Emergency mode that speaks a fixed phrase, works offline, and **never touches speech
recognition** — a person in crisis is the least intelligible they will ever be.

**INV-9, the load-bearing constraint:** `app/awaaz/safety.py::may_auto_speak` is the only
path to speech without confirmation, and returns False for any profile other than
dysarthria-dominant. Mixed and unassessed profiles are treated as aphasia. Tested by
sweeping confidence 0.00-1.00 across all three non-eligible profiles — 303 assertions.
Turning auto-speak on for an aphasic patient is refused with 409 rather than accepted and
ignored. Migration 0006. **325 tests pass.**

### ML layer (prompt E)
All five pipelines run end-to-end today: `voice_dysarthria_clf`, `rhythm_irregularity_clf`,
`asymmetry_discriminator`, `personalised_asr_adapter`, `voice_clone`. Each emits a model
card with a limitations note — the harness refuses to write metrics without one — and marks
`"synthetic": true` when no real corpus is present, so a synthetic run can never be mistaken
for evidence.

The ASR adapter implements the frozen-adapter drift metric: in the demo run, live WER 0.183
(indistinguishable from the day-30 reference of 0.171) while the frozen adapter shows 0.297.
That +0.126 gap is objective speech deterioration the live model was compensating away.

`scripts/download_datasets.sh` and `data/README.md` document source, licence and consent for
every dataset, and state plainly what we do NOT have: no dysarthric speech from stroke
survivors, none in Hindi or Punjabi, no Indian post-stroke cohort, no labelled deterioration
trajectories.

### BUG — the ASHA visit omitted the balance module
Caught by the full suite, not by the per-file runs. Four tier tests written for prompt C
encoded the module placement from *before* the posterior-circulation amendment, and I never
re-ran that file after promoting M3 and M9.

Updating them surfaced a real defect rather than a stale assertion. `modules_deferred_for_tier`
was only ever asked about the **monthly** battery, but M9 balance is **weekly** and needs
floor space and a carer — so it never appeared on the ASHA worker's due list. The one
module a posterior-circulation patient most needs someone to come and run was missing from
the one visit that could have run it. `schedule=None` now spans every cadence, and
`test_deferred_modules_span_every_schedule_not_just_monthly` pins it.

### BUG — migration 0005 could not be rolled back
`alembic downgrade` failed with "no such column: deployment_tier". Two causes stacked:
adding the column as a constrained `Enum` created its CHECK **twice** under two names
(`deployment_tier_enum` from the type, `ck_patients_deployment_tier_enum` from the naming
convention), and SQLite batch mode carries a reflected CHECK into the rebuilt table while
the column it references is being dropped. The upgrade now adds a plain string with one
explicitly named check, and the downgrade uses `copy_from` so batch mode does not reflect at
all. Full `upgrade head` → `downgrade base` round-trip now exits 0.

A migration that cannot be rolled back is a migration that cannot be safely deployed, so
this was worth stopping for.

### NEAR MISS — the frontend typecheck was checking nothing
`tsc --noEmit -p tsconfig.json` exits 0 unconditionally in this repo: the root config has
`"files": []` and only references sub-projects. Every "frontend typechecks clean" I reported
was vacuous.

The first real run (`-p tsconfig.app.json`) found **Python-style implicit string
concatenation** — `("a" "b")` — that I had written into `i18n.tsx` when adding the
posterior-circulation scope text. That is a syntax error in TypeScript. The frontend would
not have built at all, and it would have been discovered at deploy time.

`npm run typecheck` (`tsc -b`) is now the command, recorded as D-017. `npm run build` also
verified end to end, exit 0.

### TIER_1 balance gap closed (D-006 amended)
M9 was gated on `floor_space`, so a phone-only patient got no balance measurement at all —
and phone-only is most of the people posterior-circulation monitoring exists for, which made
the widening inert for them. Per-task device requirements now let M9 run its low-motion
subset (Romberg eyes open/closed, tandem stance) on a caregiver-filmed phone, while tandem
walking and Unterberger stay deferred to a visit.

Degradation is explicit, not silent: the extractor reports `tests_captured` and
`laterality_available`, a new `partial_capture` confounder lowers confidence, and the trace
component prints the caveat on the face of the chart.

**The honest consequence, surfaced rather than buried:** every one of M9's laterality
features lives in the deferred tasks. On TIER_1, M9 measures *how unsteady* someone is and
cannot say *which side*. M3 oculomotor carries laterality for those patients — saccade and
pursuit asymmetry, on a phone — so the domain can still reach ALERT.

### NEAR MISS — the TIER_1 fix reopened the ASHA gap one level down
Making M9 phone-runnable removed it from module-level deferral, so it vanished from the ASHA
worker's due list again — and with it the tandem-walking and Unterberger tests, which are
the two that carry the *direction* of deviation. Same gap as before, one level down, created
by the fix for the first one. Caught only by the full suite: the test written to pin the
original bug failed, which is what a regression test is for.

The visit workload is now expressed in TASKS (`visit_workload_for_tier`), so a worker is
told to run the two tests the family cannot do alone rather than to repeat the three they
already did this week. `test_the_visit_workload_is_task_aware` documents both directions of
the mistake so the next module move does not repeat either.

**Pattern worth naming:** `test_tiers_wearables_asha.py` has now gone stale three times, each
time because a clinical amendment moved a module. Tier tests assert module placement, and
placement is exactly what clinical work changes. That file should be re-run on any change to
`registry.py`, not just when tiers are touched.

### M3 records its capture conditions
Frame rate was used but never recorded, and no caveat was emitted. A saccade lasts 30-80 ms,
so at 30 fps it spans one to three frames and the measured "peak" velocity is an average
across the whole movement that **understates** the true peak — worse for fast saccades than
slow ones, which compresses exactly the difference that matters. Now emits `capture_fps`,
`frame_interval_ms`, `saccade_latency_resolution_ms`, `saccade_frames_median`,
`velocity_confidence` and `velocity_undersampled`, plus `velocity_caveat()`.

Sample: at 30 fps, `velocity_confidence` is **0.00**; at 120 fps it is 1.00.

### CCG trace and DHI form
`CcgTrace.tsx` reproduces the clinical craniocorpography layout — centimetre grid, path as
walked, deviation wedge from straight-ahead — because a specialist reads that picture before
any number. `DhiForm.tsx` asks 25 items in the patient's language with three large targets,
and reports the score **with its own measurement error attached**: a change under 18 points
is inside the instrument's noise and is labelled as such rather than shown as movement.

Backed by `module_results.trace_json` (migration 0007) — derived coordinates in centimetres,
not media, so INV-1 is unchanged.

### Living documentation stood up
`ARCHITECTURE.md` (with 9 numbered invariants), `PROGRESS.md`, `CHANGELOG.md`,
`DECISIONS.md`, `FIELD_REFERENCE.md`, `CLINICAL_REFERENCE.md`. Every invariant has a test in
`backend/tests/test_invariants.py`, including **INV-1: no endpoint may accept raw media**.

### Tech stack locked
Railway · Neon (branch-per-feature) · raw media on-device only · batch GPU by the hour, **no
always-on inference**. See `DECISIONS.md` D-001 to D-004.

---

## 2026-08-21 — Gate 3, laterality, Parkinson's exclusion

Closed a clinical hole: Parkinson's degrades face, movement and voice simultaneously and
symmetrically, so under persistence + cross-modality alone a PD patient generated the
system's **highest-confidence ALERT** for a condition it does not monitor.

- Every module declares `lateral_keys` — the features expressing left/right asymmetry.
- **Gate 3**: every ALERT needs ≥ 1 persistent domain showing a one-sided change, sustained.
- `detect_symmetric_pattern` → **`PATTERN_ATYPICAL`**, with its own clinician card.
- Enrolment refuses `pd_diagnosis` / `other_movement_disorder`, asked at enrolment in three
  languages.
- SLM gained its own instruction for the new band — it had been falling through to STABLE
  and producing calm reassurance for a progressive finding.

**32 tests.** Migration 0003. Demo story preserved (still ALERT, now with Gate 3 satisfied).
