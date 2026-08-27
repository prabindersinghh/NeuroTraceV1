# CHANGELOG

Dated entries per work session: what changed, what was verified, and how.

---

## 2026-08-28 — Awaaz on-device learning pairs

The phrase board can now capture a 16 kHz practice WAV, preview it, and pair it with the
exact card the patient taps. Retention is explicitly consented and entirely local to the
browser's IndexedDB vault; the API has no media input and stores only UUID, duration,
SHA-256/size, target, consent and deletion receipts. A delete-all control removes the local recordings
and records revocation server-side.

Push-to-talk/manual stop remains the default. Optional silence auto-stop uses the patient's
saved 0.5–4.0 second threshold, never starts the silence clock before speech is heard, and
always bounds a capture at 30 seconds. Pair registration is idempotent, so retrying after a
lost response cannot duplicate a training example or increment card usage twice.

This closes the board-tap half of D4. It does **not** claim ASR, caregiver-reviewed audio,
adapter training/deployment, voice cloning, or cloud audio storage.

Verified: backend **885 collected / 882 passed / 3 expected skips / 0 failed**; frontend
**35 tests passed**; TypeScript, oxlint, migration round-trip, browser interaction checks,
and the production Vite/PWA build passed.

## 2026-08-28 — Awaaz contract foundation

The aphasia confirmation flow now has an explicit second-step contract: the candidate tap
is sent as `confirmed_candidate`, the server records one confirmed utterance, and the UI
speaks only after that acknowledgement. Previously it spoke locally and sent the same
candidate request again, which produced another confirmation prompt and no audit row.

Listener capabilities now exclude every utterance from before link creation. Transient
poll failures retain the last confirmed view instead of falsely declaring the link expired.
Caregiver review saves are retryable and no longer remove an item after an API failure.
Phrase-card icon identifiers now render as accessible Lucide symbols instead of literal
words such as “water” and “toilet.”

Emergency responses no longer claim that a caregiver was notified or that speech works
offline when neither delivery provider nor pre-rendered audio exists. The UI speaks its
fixed local phrase first and explicitly tells the family to call directly when delivery is
unavailable. Living docs now mark D1–D5 partial instead of done.

Verified: full backend suite **878 collected / 875 passed / 3 skipped / 0 failed**; frontend
**30 tests passed**, TypeScript and oxlint passed, and a production Vite/PWA bundle built.

The rendered-app pass then found a migration-only regression the model-created test schema
could not expose: revisions 0005/0011 left the original three-role CHECK beside the widened
one on SQLite, so a fresh database rejected `asha_worker` and `admin`. Revision 0012 now
replaces every stale role check with one canonical constraint, and the migration test inserts
every role emitted by the ORM.

## 2026-08-24 (later still) — Admin console, and a privilege-escalation hole closed

*Merged with DEEPESH-845's frontend session below — this backend work and that
frontend work happened independently the same day and landed via `git merge`.*

### The hole
`/auth/register` used the `role` from the request body. A stranger could sign up as a
clinician and read `/clinic/patients`, which returns every patient's name and age across
every caregiver. **Verified against the running app before fixing:** a freshly self-registered
clinician got 200 and a real patient row belonging to an unrelated family.

It survived because the frontend only ever offered caregiver and patient, so nothing in the
product exercised it — and because a test named `test_register_accepts_every_role` asserted
it as though it were intended. The passing test is what made it look deliberate. INV-6 says
the UI is never the boundary; here the UI was the whole boundary.

Registration is now caregiver/patient only. Clinician, ASHA worker and admin come from
`POST /admin/users` (admin-only, audited) or the seed. `conftest.provision` creates them the
way production does, so tests cannot route around the fix. D-040.

Closing self-registration for `asha_worker` (correctly, alongside clinician and admin — it
is just as privileged) broke `test_tiers_wearables_asha.py`, which self-registered ASHA
workers via `/auth/register` in four places. A pre-push verification workflow caught it as
a real pytest failure (`KeyError: 'tokens'`, because `/auth/register` now returns 403 for
that role) rather than something noticed after merging. Fixed the same way as the clinician
sites: through `conftest.provision`.

### The console
New `admin` role (migration 0011, `batch_alter_table` so it works on both dialects — the
rendered Postgres SQL was checked against what 0001 and the asha_worker migration actually
named the constraint, `ck_users_role_enum`, rather than assumed). `/admin` shows census, the
three-gate funnel, baseline and band distributions, the identity flag rate, and the audit
trail.

It shows **no patient records**, by construction: counts and events only, patient references
truncated to eight characters. `test_no_admin_response_contains_patient_identifying_data`
creates a real patient and asserts their name, email and full id appear in no admin payload,
so adding one fails the build. D-041.

Demo login `admin@neurotrace.app` / `neurotrace-demo`, in the README with the others.

### Onboarding
The 7-step flow existed, was routed, and nothing navigated into it — including step 3, the
scope disclosure the file itself calls a safety control. Creating a patient now enters it;
an unfinished setup shows on the patient card and demotes the check-in button. Face
enrolment moved into step 5, where the camera is already being set up.

**Verified:** migration + privacy + invariants green; auth and admin suites green;
frontend 18 passed, `tsc -b` and build exit 0; Postgres render of 0011 matches the
constraint name in the deployed schema.

---

## 2026-08-24 (later) — Three bugs found by driving the app; and a rebase that broke it

### GET /report/{id} was 500ing on any patient who had a session
`Score.lateralised` does not exist. `lateralised` is a column on `Deviation` (per module);
`Score` is per session. Both the clinician report and the caregiver review queue presented
in the browser as **CORS failures**, which is the misleading part worth remembering: an
unhandled exception bypasses `CORSMiddleware`, so the 500 arrives with no
`Access-Control-Allow-Origin` header and the browser reports the missing header rather than
the crash. Now derived from `lateralised_domains` — the list printed beside it — so the flag
cannot contradict what the clinician is reading.

Two tests already hit this endpoint and both stayed green, because both report on a patient
who has never run a session: `body["sessions"]` was always `[]`, so the comprehension
holding the bad attribute never executed. Added `test_the_report_renders_a_row_for_a_scored_session`,
and **verified it fails with the old line and passes with the new one** rather than assuming.

### Two frontend bugs
`Diagnostics` appended "Storage quota" from an unguarded async `storage.estimate()`, and
StrictMode runs effects twice in development — two rows, same React key. Guarded, and the
append made idempotent. `StepRecall` called `useMemo` below the `mode === "encode"` early
return, so the hook count changed with the prop; `ProtocolRunner` renders the two modes from
different slots so it never fired, but it is a latent crash and it failed `npm run lint`.
Hoisted.

### The blank page, and what caused it
`pull.rebase = true`, so `git pull` rebases — and **rebase drops merge commits**. The merge
that integrated origin/main held both the conflict resolutions and unique work, so
discarding it resurfaced every conflict. The rebase was then completed with resolutions
that kept BOTH sides of each import conflict, leaving `App.tsx` declaring `Awaaz`,
`Onboarding`, `Exam` and `ExamPractice` twice. In dev the browser evaluates that module as
native ESM, so it is a SyntaxError, the module never evaluates, React never mounts, and
`#root` has zero children — nothing rendered and nothing could.

The same rebase reverted the motion work wholesale: `PipelineFlow.tsx` and
`SymmetryDiagram.tsx` deleted outright, `index.css` stripped of the route-in, scroll-cue and
narration keyframes, and NinetyDays, RunTimeline, GateBoard, Landing, button, card and
states all returned to pre-animation versions. `frontend/src` was restored from the verified
commit; nothing outside it had differed.

`npm run typecheck` catches the duplicate immediately — confirmed by putting the broken file
back and running it. It was simply never run after the rebase finished. **If a rebase
touches this repo, run the verification before trusting the result**, and prefer
`git config pull.rebase merges` so a merge commit is preserved rather than dropped.

**Verified:** `tsc -b --force` clean · `vitest` 27/27 · `oxlint` 0 errors · `vite build`
clean · backend `pytest` exit 0, 0 failures · landing mounts with 9/9 sections and zero
console errors · 0 long tasks across a full-page scroll · the run section's `sticky` pins at
top 0 through 20/50/80% with the day advancing 08 → 17 → 20 · no mobile overflow at 390px ·
reduced motion leaves only the three intentionally-hidden elements · `/`, `/clinic`,
`/dashboard`, `/report`, `/review`, `/enrol`, `/awaaz`, `/diagnostics` all render against a
seeded backend with no page errors.

---

## 2026-08-24 — The landing page becomes the argument; scroll motion off the render path

### The signed-out page was a feature list; it is now one argument
The old landing stated the product in four card grids. What it never did was make the case,
and the case has two turns in it that a visitor cannot reconstruct from a feature list:

1. A population threshold cannot monitor a stroke survivor, because a survivor sits outside
   the population's normal range on the day they come home and every day after. Set it to
   catch deterioration and it fires every morning until someone mutes it; widen it until it
   is quiet and it can no longer see what it was for.
2. A personal baseline is still not enough. Three domains agreeing looks like overwhelming
   evidence, and Parkinson's produces exactly that — persistently, in face, voice and hand.
   So the deviation also has to have a side.

The page is now those beats in order, carried by ONE visual primitive — a lane, a band, a
trace — that changes state rather than being redrawn as a new kind of picture per section.
The domain table, pipeline, care network, Awaaz and limits hang off the beats.

Every figure comes from the README, `engine/gates.py` or `exam/registry.py`.
`traceData.test.ts` runs the illustrated 21-day verdicts through the engine's own gate rules
(9 assertions), so the seeded run cannot drift out of agreement with the story the page
tells: edit the series and the test fails before the page can ship a claim the gates would
not have produced.

### Motion, and why there is no GSAP
One `requestAnimationFrame` ticker in `lib/motion.ts`, running only while a scene is near
the viewport. Scroll-linked effects write to the DOM or a canvas directly; `TraceLanes`
takes its day and its focus column through an imperative handle. The naive version — scroll
listener per effect, `setState` per frame — reconciled three paragraphs and a canvas sixty
times a second in the 21-day section, and that is what made it feel cheap.

Smooth scrolling is Lenis, dynamically imported so only the signed-out page pays the 5.4 kB,
and **off on coarse pointers and under `prefers-reduced-motion`**. That exclusion is
clinical, not aesthetic: this product measures vestibular function and its users have
vertigo, so inertial scrolling and parallax stay on the marketing page.

New teaching visuals, each carrying a specific claim: the ninety-day field fills in as you
scroll (states the problem, then answers it); a symmetry diagram carries Gate 3 — the same
three domains, matched sides against split; the on-device steps became a flow with a signal
travelling down them; the gate board grew a marker that travels to the gate that stops the
run.

### Bugs found underneath it
- **Every route was statically imported.** A visitor downloaded the exam, recharts and the
  MediaPipe wrapper to read marketing copy — one 800 kB chunk. Route-split: the landing
  entry is 225 kB, Dashboard/Exam/face are separate.
- **`FaceMeshShowcase` released the camera from the rAF loop**, which stops firing once the
  tab is hidden or the component unmounts, so navigating away mid-capture left the camera
  on. Upstream's rewrite had the same shape (release only from the button handler); fixed in
  both by holding the stream in a ref and releasing on unmount.
- **The session length was wrong in every shipped string.** `DAILY_BUDGET_SECONDS` is 90 and
  test-enforced; the HTML meta, PWA manifest, API description and frontend README all said
  45.
- **`--atypical` was declared twice** in `index.css`; the first pair was dead.
- **`font-feature-settings: cv02 cv03 cv04 cv11`** named Inter's character variants with no
  Inter loaded — four no-ops. Inter is now self-hosted (48 kB, latin), which is also why it
  is not a `fonts.gstatic.com` link on a page whose argument is that we have no third-party
  dependencies.
- **Anchor jumps landed under the sticky header** — no `scroll-margin-top`.
- **No `prefers-reduced-motion` support anywhere.**
- **`text-${tone}` in the symmetry diagram** was a runtime-assembled Tailwind class, which
  Tailwind cannot see. It rendered only because both literals happen to appear in other
  files. Replaced with a lookup of literal names — the trap CLAUDE.md already documents.

### Merged with origin/main
Took upstream's landing decisions where they are the better call. **No stock portrait
anywhere**: an identifiable person's face under a medical overlay, on a page about stroke,
is a claim nobody in a photo library consented to. That also retired a vendored-JPEG problem
this work had walked into — `*.jpg` is gitignored precisely because the working tree holds
photographs of a real patient's records, and `test_no_source_image_is_tracked` fails the
build on any tracked raster image. `FaceMeshShowcase` is upstream's labelled schematic plus
opt-in camera; `App.tsx` keeps the route splitting and gained Enrol, Listen and ReviewQueue
as lazy chunks.

App-wide: a page transition that replays a CSS animation on a stable wrapper rather than
keying the router outlet on pathname (which remounts and refetches); press feedback on
`Button`; a loading state held back 200 ms so a fast lazy chunk does not flash a spinner.

**Verified:** `npx tsc -b` clean · `npx vitest run` 27/27 · `npm run build` clean ·
backend `pytest` exit 0, 0 failures · **0 long tasks (>50 ms) across a full-page scroll** ·
`position: sticky` still pins with Lenis active (sticky top = 0) · no horizontal overflow at
1440/1280/1024/768/390 · no console errors on any route · reduced motion leaves nothing
hidden and drops the pin · anchor jumps clear the header (88px vs 65px header) · tab order
starts at the skip link with focus rings on every stop · the gate board is operable by
keyboard.

---

## 2026-08-23 (later) — Neon boots for real; identity, listener UI, honest imagery

### Two dialect bugs that only a real Postgres could find
The Neon swap deployed SUCCESS and served 502. Migration 0004's `WHERE locked = 1` is valid
SQLite (booleans are integers) and rejected by Postgres with `UndefinedFunctionError`. Fixed
it; the next boot failed on `PRAGMA foreign_keys=ON`, which `alembic/env.py` ran
unconditionally — a SQLite compensation Postgres neither understands nor needs.

Both had passed CI for weeks. `alembic upgrade --sql` cannot catch either: the statements
are literal text inside `op.execute`, so they render identically for both dialects. "Rendered
against Postgres" was never the same claim as "run against Postgres" — D-014.
`test_migration_portability.py` now scans raw SQL (inside `op.execute`, tracked by paren
depth) for booleans-as-integers and SQLite-only functions. Its first version flagged
`sa.DateTime(` as the SQLite `datetime(` and failed two innocent migrations, so the scanner
is scoped and pinned by its own tests in both directions.

**Verified:** `/health` `database: up`, demo seeded on Postgres, `/clinic/patients` returns
`Ramesh | band: ALERT`, and the seed survives a subsequent redeploy — which is the entire
reason for leaving SQLite.

### Identity: the confounder that had nothing computing it
`identity_uncertain` and `identity_verified` have existed since the beginning, unfed. The
realistic threat is not an attacker but a family member "helping" with a task, whose
measurements then enter the patient's baseline.

- Six ratios between **bone-structure** landmarks, on device. Deliberately NOT the M1
  expression features — those change with every task and with the facial weakness the
  product exists to measure.
- `Enrol.tsx`, optional and skippable. No image, no embedding, nothing invertible.
- **Flags, never blocks.** Unenrolled is recorded as verified, so "never checked" cannot
  read to a clinician as "checked and failed". D-015.
- Threshold is calibrated on synthetic geometry only and says so in the source — D-017.
- Found while testing: `PatientUpdate.calibration_json` REPLACES the dict, so a routine
  calibration PATCH silently wiped enrolment and the check stopped running with nothing
  reporting that it had. `update_patient` now carries the `identity` key across.

### The listener and review screens existed only as endpoints
D2 and D4 shipped as backend earlier; both were unreachable from the UI. `Listen.tsx` (no
auth — the unguessable token is the capability; no name, no bands, no history for a
stranger) and `ReviewQueue.tsx` (worst-first, capped, "nothing to review" shown as success).
Awaaz now carries quiet caregiver-only entry points, placed below the speaking surface so
nothing competes with the emergency card.

### Landing rebuilt, and why there is no stock portrait on it
Repositioned around the recovery ecosystem — seven systems, the 21-task protocol, the
pipeline, the models (labelled synthetic where they are), the three gates — with Awaaz as
§04 rather than the headline. D-016.

The hero mesh runs on the **visitor's own camera**, opt-in, or shows a labelled diagram. A
stock portrait was written first and then actually looked at: a studio shot of a young
bearded Western man. Checking the other three found two more wrong — `hands` is clasped
hands, captioned as a tapping task, and `home` was an office. But the deciding issue is that
an identifiable person's face under a medical overlay on a stroke page reads as "this is a
patient"; the Unsplash licence covers the photograph, not that likeness for implying a
neurological condition.

### Docs
README duration claims now match `steps_for()`: 90 seconds is the daily core, ~11m35s the
21-step FULL protocol. D-014 through D-017 recorded.

**Verified:** backend 841 passed exit 0; frontend 18 passed exit 0; `tsc -b` and production
build exit 0; preflight 7 passed.

---

## 2026-08-23 — LIVE on Railway and Vercel; the exam becomes the 21-step protocol

### Deployed, and verified the only way that counts
- **Backend**: https://neurotracev1-production.up.railway.app — `/health` 200, `database: up`.
- **Frontend**: https://neuro-trace-v1.vercel.app — model asset served at full size
  (3,758,596 bytes), the API URL baked into the shipped bundle.
- **`verify_deploy.sh`: 7 passed, 0 failed.** The deployed engine reproduces the exact
  local band sequence — `SSSSSSSSSSSSSSSSSSWAA -> ALERT` — band for band. A deploy that
  returns 200 with different bands is a broken deploy that looks healthy; this is the
  check that would have caught it.

### What the deploy actually took: four stacked faults, each masking the next
1. **`DATABASE_URL` defaulted to localhost Postgres** — locally a gitignored `.env`
   overrides it; in the container nothing did. asyncpg's `Connect call failed
   ('127.0.0.1', 5432)` was the one failure the logs API deigned to show.
2. **`alembic upgrade head` never exited on aiosqlite** — every connection lives on a
   worker thread, and a thread alive at interpreter shutdown blocks process exit. Printed
   its last migration and hung; on Windows dev the same code exits by timing luck.
   Migrations now run on the stdlib sqlite3 driver — one connection, sequential DDL,
   deterministic exit — with Postgres staying on asyncpg.
3. **The service domain was created with `targetPort: null` and no PORT variable** — the
   edge and the healthcheck had no port to reach. Pinned to 8000 on both sides.
4. **The container's stdout is a dead pipe** — no app stdout line ever reached the logs
   from any deploy, and a WRITE to stdout fails. `echo MIGRATIONS_DONE` (stdout) was
   killing the `&&` chain right after alembic (stderr, visible), so uvicorn never
   started, invisibly. Diagnosed by making the app report on itself: a start command
   where every stage appends to a file behind timeouts that always end in a file server,
   then reading `boot.log` over the public URL — `ALEMBIC_EXIT=0`, uvicorn up on
   `[::]:8000` in seconds, killed only by the diagnostic's own timeout. The permanent
   start command routes every byte to stderr, uvicorn's stdout access log included.

The Railway healthcheck gate is REMOVED, deliberately: its private-network probe could
not see an app the public edge served fine, and a gate that kills provably healthy
containers is worse than no gate. `verify_deploy.sh` after every deploy is the
compensating control — it checks clinical output, which no HTTP probe can.

The temporary diagnostic file server was flagged by the security review as a public file
read — correctly — and lived for exactly one read of boot.log before removal.

### The exam now runs the protocol
`ProtocolRunner` replaces the v1 five-step battery: plan served by
`GET /sessions/plan/{intensity}` (offline TS mirror pinned to `session_plan.PROTOCOL` by
a parity test), FallRiskGate structurally in front of the standing block, pause/resume
that never invalidates, and all four fatigue fields recorded per result and accepted by
the API — the columns existed since 0008, but the submission schema never carried them,
so the instrumentation was theater at the API boundary until today.

**18 of 21 steps have real web capture.** New engines this session: M3 oculomotor (iris
landmarks; saccades, pursuit, gaze-holding), M9 balance + M6 pronator (PoseLandmarker,
staged and SHA-pinned like the face model), M17 fingertip PPG (torch where the platform
has an API for it, honest `torch_available` where it does not), M11 word memory
(recognition variant, features named `recognition_*` because it is NOT free recall).
Excluded, stated, not faked: M2 tongue deviation (no tongue landmarks exist), M8 x2
(needs hand tracking). A step without a capture engine is skipped, never rendered as a
timer that measures nothing.

**M3/M9/M6/M17/M21 submit raw landmark-derived POINTS and the server runs the extractor
the test suite pins.** Numbers, never media — INV-1 is about media. One implementation,
no JS parity drift. Side effect: M9 submissions now fill `trace_json`, which the /trace
endpoint had been reading as an always-empty column — the CCG view was an endpoint over
a field nothing wrote.

### Onboarding is functional, not descriptive
Versioned trilingual consent (2026-08-v4) recorded on the patient; real calibration
(measured fps with `timing_source` honesty, mic probe, height for the balance scale)
stored in `calibration_json`; practice session launched from step 6 and excluded from
scoring server-side (`sessions.is_practice`, migration 0009 — stored so the family sees
it happened, never scored because a learning attempt inside a baseline manufactures a
week of false improvement).

### Awaaz has a face
`/awaaz/:patientId` — emergency-first board, tap-to-speak cards (voiced immediately: the
patient chose those exact words), and the free-text path that renders INV-9: dysarthria
above threshold speaks, aphasia only ever gets candidates and NOTHING is voiced before a
tap. The gate stays server-side; the UI cannot route around it.

### Landing
Signed-out `/` is a landing page in the reference's dark identity (near-black ground,
mint/sky accents, monospace details). Scoped to that page alone — D-034.
**Superseded later the same day** by the light editorial treatment (D-016): the product
surfaces were already light for legibility, and two identities was one too many.

### Post-deploy additions, verified against the live instances
Trilingual instructions for all 21 tasks (keyed by TASK so a reorder cannot attach the
wrong wording); `SessionSettings` on the caregiver dashboard — intensity with the
position-shift warning printed beside the control, and the aphasia-mode toggle, which the
runner consumes (larger on-screen wording; everything already speaks). Gendered copy in
the gate and onboarding corrected to they/them.

Live probes after the auto-deploy of this commit: `/sessions/plan/full` on the PUBLIC
backend serves 21 steps with the gate before position 11; the pose model ships from the
public frontend at its full 5,777,746 bytes.

### Verification
Backend: 9/9 new protocol-runtime tests; full suite in `final12.log` by exit code.
Frontend: `tsc -b` exit 0; production build exit 0. Deploys: verify_deploy 7/7 as above.

---

## 2026-08-22 (deploy + PENDING closeout) - Railway/Vercel, three gaps closed, one crash found

### The Railway build failure was a one-field setting, and the log said so
Railpack listed `scripts/`, `.gitignore` and four `.md` files - the repository **root**,
where there is no `requirements.txt` and no `Dockerfile`. `backend/railway.json` and
`backend/Dockerfile` are never read, because Railway reads build config from the *service*
root. Root Directory `backend` was already step 2 of the runbook; the build failed at
exactly the step the runbook warns about, so the runbook now carries the failing log
verbatim - which is the form the reader will actually be searching for.

### A green build that would have shipped a dead camera
`frontend/public/mediapipe` is gitignored, and `npm run build` never fetched it. On Vercel,
`npm ci && npm run build` would have **succeeded** and produced a `dist` with no wasm and no
face model - the exam deploys and the camera never initialises. Fixed with a `prebuild`
hook, verified on a clean slate: `rm -rf public/mediapipe dist && npm run build` -> exit 0,
`face_landmarker.task` 3,758,596 bytes, 6 wasm files, model precached by the service worker.

### The privacy rule was matching directories only
`*stroke report*/` - with a trailing slash. So `real stroke report.zip`, an archive of all
22 photographs, was ignored **only** by `*.zip`, a build-artifact rule. Narrow that rule to
keep a release archive and somebody's hospital records become stageable, silently. Two
independent privacy rules now cover it, and a new test asserts the **attribution**, not just
the outcome: whatever rule catches source material must itself be about source material.
Probed against the old rule - it fails, naming `.gitignore:43:*.zip`.

### PATTERN_ATYPICAL crashed the caregiver dashboard
The frontend `Band` union was still `STABLE | WATCH | ALERT`. `BAND_STYLE[band]` returned
undefined and `style.ring` threw - **for exactly the patient the laterality gate was built
to protect.** Found by widening the union, which then immediately surfaced the same
omission in the clinician roster. Both fixed, both now fall back rather than index blindly,
and the band gets its own violet token: it is not a louder WATCH, it is a different finding
pointing at a different referral, and putting it on the stable->watch->alert scale would say
otherwise. Caregiver wording is "Worth a doctor's appointment", not "Please check on them".

`DOMAIN_COLOURS` still keyed `speech_language`, dead since the domain split, so
`motor_speech`, `language` and `posterior_vestibular` all fell through to the same default
blue - a two-domain cross-modality finding drew as one line.

### The clinician report described a two-gate engine
It returned `gate1` and `gate2` and a method note that never mentioned laterality,
PATTERN_ATYPICAL or the frozen reference. In a clinician-facing document that is not a
cosmetic gap. All three gates are now returned per session with `lateralised_domains`, and
the method note states the full rule.

### Three PENDING items closed
- **Clinician report** (`/report/:patientId`) - print-optimised, browser Save-as-PDF.
  Deliberately not server-rendered: a patient's full history assembled into a binary on a
  shared host is three more places for it to linger. The endpoint still returns JSON, so
  server-side rendering stays available if a clinic ever needs scheduled exports.
- **CCG baseline comparison** - `?reference=true` returns the earliest capture inside the
  **locked** window, not the earliest ever: a first-ever attempt is where the patient was
  still working out the task, and comparing against it manufactures an improvement. 409
  when no baseline is locked, rather than substituting something plausible. Deltas show
  direction and magnitude, never green/red - a smaller sway area can mean bracing.
- **Demo clips** - manifest generated from `PROTOCOL` so filenames cannot drift from the
  protocol, plus a shot list. A missing file resolves to `undefined` and the task still
  runs, so clips can arrive one at a time.

`CcgTrace` had never been rendered on any page. It and the new comparison are now reachable
from the clinician dashboard.

### Field-test kit
`/diagnostics` (no login) measures what a phone actually delivers rather than what its spec
sheet claims - camera fps at 60 and 30 requested via `requestVideoFrameCallback`, worst
frame gap, wasm SIMD, sensors, storage - and emits copyable JSON with no identifier in it.
`docs/FIELD_TEST_PROTOCOL.md` is the protocol around it.

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

---
