# DECISIONS

Every locked decision, with its date and the one-line reason. Nothing here is relitigated
or silently reversed. If a decision needs to change, add a new dated entry that supersedes
the old one — do not edit history.

---

## Infrastructure

**D-001 · 2026-08-22 · Backend hosting: Railway.**
Single-service deploy with managed TLS and no infrastructure work; the backend is a
stateless FastAPI app so hosting is not where the difficulty lives.

**D-002 · 2026-08-22 · Database: Neon (serverless Postgres), branch-per-feature.**
A database branch per schema change means a migration is tested against a real copy of the
data before it reaches the trunk. Given that migration 0005 emptied the development
database on its first run (see D-009), this is a safety mechanism, not a convenience.

**D-003 · 2026-08-22 · Raw media never leaves the device. HARD INVARIANT (INV-1).**
Audio, video and camera frames are captured, converted to features, and discarded on the
phone. Only derived numbers and scores reach Neon. This is the privacy claim the product
rests on, and it stops being true the moment one endpoint accepts an upload "just for
debugging" — so it is enforced structurally by `tests/test_invariants.py::test_inv1_*`,
which fails if any route accepts a file at all, and by there being no binary column
anywhere in the schema.

**D-004 · 2026-08-22 · ML training: batch GPU rented by the hour (Modal or RunPod).**
Nightly and weekly jobs only. **We do not host always-on inference.** Inference runs on the
device. A cloud inference service would undo D-003 by requiring the raw signal to be
uploaded, and would add a per-request cost to a product whose users have intermittent data.
Recorded in `ARCHITECTURE.md` so nobody later adds one helpfully.

---

## Clinical scope

**D-005 · 2026-08-22 · Scope widened to posterior-circulation and cerebellar ischemic
stroke.**
They are 20-25% of ischemic strokes, misdiagnosed two to three times more often than
anterior ones, and served by nobody. Acute detection, hemorrhagic stroke and TIA remain out
of scope. Driven by the reference case in `CLINICAL_REFERENCE.md`, whose limb coordination
was entirely normal — our M8 module would have found nothing in a patient with an
MRI-confirmed cerebellar infarct.

**D-006 · 2026-08-22 · M3 (oculomotor) and M9 (balance) promoted to core, weekly.**
They were monthly and tier-gated. For a posterior-circulation patient they are the only
modules that see anything, so gating them behind an ASHA visit meant checking the patients
who most need it least often. M3 runs on a phone; M9 needs a carer to film and stand close.

**D-007 · 2026-08-22 · `posterior_vestibular` is its own domain, and it HAS laterality.**
Kept separate from `coordination_gait` because limb ataxia and vestibular/oculomotor failure
fail independently — merged, it could never corroborate the other under Gate 2. It carries laterality, so these patients can reach ALERT without any limb or facial sign.

*Corrected 2026-08-22 (see GAP_ANALYSIS D-2).* The original wording said laterality comes
from Unterberger angular deviation "by construction". In the reference patient that measure
was classified **normal** (5° right is inside the device's range), and the finding that
actually carries a side is **M3 saccade velocity asymmetry (~0.37 — leftward slower and
later than rightward)**. Both M3 and M9 contribute `lateral_keys`; the eye is the more
reliable source and the one evidenced in the only real patient we have.

**D-008 · 2026-08-21 · Enrolment refuses Parkinson's and other movement disorders.**
They degrade face, movement and voice symmetrically and simultaneously — the exact
combination the alert gate reads as deterioration — and they progress on their own course,
so the personal baseline is itself moving. Superseded nothing; added alongside Gate 3.

**D-011 · 2026-08-22 · Dysarthria and aphasia are separate domains.**
`motor_speech` (M4) and `language` (M5). Different lesions, different meanings, and merged
they could never corroborate each other under Gate 2 — two modules in one domain count once.

---

## Engineering

**D-009 · 2026-08-22 · `alembic/env.py` builds its own engine WITHOUT foreign-key
enforcement.**
SQLite cannot ALTER a constraint, so Alembic's batch mode rebuilds a table by dropping the
original. With `PRAGMA foreign_keys` on, dropping a parent table cascades the delete into
every child. Migration 0005 rebuilds `users`; run with enforcement on, it deleted every
patient, session, score and baseline and left a structurally valid, empty database. Pinned
by INV-7. Integrity is verified explicitly after each migration instead.

**D-010 · 2026-08-22 · MediaPipe wasm is copied from `node_modules`, not fetched from a
CDN.**
`@mediapipe/tasks-vision` is already a dependency and ships the wasm. Copying from the
lockfile means the build works offline and the runtime cannot drift from the bindings. The
previous script pinned `@0.10.22` — a version that was never published — so every fetch
404'd. The FaceMesh model itself is the one remaining download, pinned by SHA-256.

**D-012 · 2026-08-21 · Every ALERT requires a lateralised finding (Gate 3).**
Stroke is lateralised; Parkinson's is symmetric. Without this, a PD patient trips face,
motor and voice together and generates the system's highest-confidence alert for a
condition it does not monitor.

**D-014 · 2026-08-22 · The Awaaz voice-cloning clip is a documented exception to INV-1.**
Cloning cannot run on a phone, so the 2-minute family-archive clip is the one piece of raw
audio that reaches a server. It is handled as a separate, explicitly consented,
single-purpose upload to object storage — never into Neon, never through the exam path,
deleted once the adapter is trained with the deletion timestamped. Recorded here rather
than quietly folded into INV-1, because an undocumented exception to a privacy invariant is
how the invariant stops being true.

**D-015 · 2026-08-22 · Auto-speak requires a dysarthria-dominant profile AND high
confidence. INV-9.**
Dysarthria is a transmission fault — the message exists and recovering it is legitimate.
Aphasia means the message may not exist, so completing it generates content and attaches
the patient's name and cloned voice to it. A mixed profile is treated as aphasia; an
unassessed profile is treated as aphasia. `may_auto_speak` is the only path to speech
without confirmation and is swept across the full confidence range in tests.

**D-016 · 2026-08-22 · Enum columns added in a migration use a plain string plus ONE
explicitly named CHECK.**
Adding a constrained `sa.Enum` in an Alembic batch operation creates the check twice — once
from the type, once from the naming convention — and the second copy makes the downgrade
impossible on SQLite. Downgrades that drop columns use `copy_from` so batch mode does not
reflect. Every migration must round-trip `upgrade head` → `downgrade base` cleanly.

**D-017 · 2026-08-22 · Frontend typecheck is `npm run typecheck` (`tsc -b`), never
`tsc -p tsconfig.json`.**
The root `tsconfig.json` has `"files": []` and only *references* the sub-projects, so
`tsc --noEmit -p tsconfig.json` checks nothing and exits 0 unconditionally. Several
"frontend typechecks clean" claims in this project's history were made with that command
and were worthless; the first real run surfaced a syntax error that would have broken the
build outright. Build mode walks the references.

**D-018 · 2026-08-22 · Module tier placement is enforced, not remembered (INV-10).**
Every module declares its hardware and every task in a split module declares its own; no
module may be reachable by zero tiers; a deferred task must appear on the ASHA visit
workload; and a task that destabilises the patient may never be assigned to an unsupervised
device. Enforced by tests, a comment at the definition site, and a PostToolUse hook on
`registry.py`. Any PLAN touching exam modules lists the tier suite as required verification.

**D-019 · 2026-08-22 · `caregiver` is a distinct capability from `phone`.**
A propped phone and a held phone are not the same thing when the patient is about to close
their eyes and narrow their base. Every tier has a caregiver — the product is
caregiver-mediated by design — but tasks that destabilise the patient must say so, or a
one-word change reads as a convenience improvement and becomes a fall risk. Found by
probing whether the INV-10 guards actually fire; they did not catch this until it was added.

**D-020 · 2026-08-22 · Patient identifiers are forbidden repo-wide and enforced (INV-11).**
The source photographs live INSIDE the working tree, not outside as assumed. They are
gitignored and pinned by tests. Identifier *labels* and day-level dates in clinical docs are
what the test greps for; the literal identifiers live in a gitignored `.privacy-denylist`,
because writing them into the test that forbids them would put them in the repository
permanently.

**D-021 · 2026-08-22 · The test database is per-process.**
Keyed on PID plus xdist worker. Concurrent pytest runs previously shared one SQLite file
while the `engine` fixture dropped and recreated the schema. Prerequisite for the registry
hook: a guard that emits spurious failures is a guard somebody disables.

**D-022 · 2026-08-22 · Clinical classifications come from the instrument, not from us.**
`CLINICAL_REFERENCE.md` records the report's own normal/abnormal labels. Where we disagree
we say so explicitly rather than silently re-labelling — this is what surfaced that the
angular deviation we had been citing as our Gate 3 mechanism was classified normal.

**D-023 · 2026-08-22 · The repository has a remote; unreachable is not gone.**
`origin` is a GitHub repo and has been pushed. 22 source images were in the local object
store but unreachable from any ref, so never committed and never pushed — established by
reachability analysis, not assumption. Purged anyway: recoverable-by-anyone-with-disk-access
is a weaker guarantee than absent. Two tests pin it.

**D-024 · 2026-08-22 · Laterality in `posterior_vestibular` comes primarily from the EYE.**
Supersedes the wording in D-007. M3 saccade velocity asymmetry is the evidenced lateral
source (~0.37 in the reference patient); M9 angular deviation was classified NORMAL in that
patient and is treated as corroborating. Both remain `lateral_keys`.

**D-025 · 2026-08-22 · Reproduce a device's own averaging convention before calibrating
against it.**
The clinical SVV "Average" is a MEDIAN for dynamic conditions and a MEAN OF ABSOLUTES for
static. Discovered by failing to reproduce the printed numbers. We emit both forms; a
calibration target we cannot reproduce is not a calibration target.

**D-026 · 2026-08-22 · Invariant tests assert behaviour, not source text.**
`inspect.getsource` grepping produced a false INV-2 failure from a stale `.pyc`. An
invariant that cries wolf gets disabled, which is worse than not having it.

**D-037 · 2026-08-23 · Everything in the container writes to stderr.**
This runtime's stdout is a dead pipe: writes to it fail, and they fail silently from the
outside — a start command died at an `echo` for six consecutive deploys with nothing in
any log. Rather than remember which tools default where (uvicorn's access log: stdout;
its error log: stderr; alembic: stderr), the start command redirects wholesale. A rule
that requires remembering is a rule that gets broken.

**D-036 · 2026-08-23 · The Railway healthcheck gate is removed; verify_deploy.sh is the
control.** The private-network probe could not reach an app the public edge served, so
the gate killed provably healthy containers 90 seconds before anyone could look at them.
Its job is done better by `scripts/verify_deploy.sh`, which checks that the deployed
engine reproduces the exact local band sequence — clinical output, not liveness. Cost
accepted: a broken build replaces a good one ungated; the script runs after every deploy.

**D-035 · 2026-08-23 · Web only — laptop browsers for development, Chrome on Android and
Safari on iOS for patients.** What degrades on iOS Safari, checked against the code, and
degraded honestly:
- `getUserMedia` / camera: fine (14.3+). The exam path uses NO MediaRecorder at all —
  PCM via Web Audio and per-frame landmarks — so codec differences never arise.
- `requestVideoFrameCallback`: present since 15.4. Older WebKit falls back to rAF, and
  every fps result now carries `timing_source` — an rAF number is display rate, labelled
  as such in /diagnostics rather than reported as camera rate.
- `DeviceOrientationEvent`: gated behind `requestPermission()` FROM A USER GESTURE. The
  SVV task asks on its first tap; denied or absent, the result says
  `device_tilt_compensated: false` instead of pretending the handset was level.
- Camera torch: no web API on iOS at all. M17 records `torch_available` and works on
  ambient light through the finger.
- The legacy video path (unused by the exam) already falls back to `video/mp4`.

**D-034 · 2026-08-23 · The dark identity is the landing; the product stays light.**
> **SUPERSEDED the same day by D-016.** The reasoning below still holds for why the product
> surfaces are light; what did not survive is the split. Running a dark landing against a
> light product meant maintaining two identities, and the landing was rebuilt in the light
> editorial treatment. Kept because the accessibility argument is the load-bearing part and
> is still the reason the product is not dark.
The owner pointed at a reference landing (near-black, mint/sky, Inter + monospace) and
said "exactly, or even better". Adopted — for the signed-out surface, where identity is
the job. The in-product surfaces stay on the light high-contrast clinical palette because
their users are post-stroke patients in their sixties, often outdoors in Indian daylight,
where a dark theme is an accessibility regression dressed as taste. Identity where
identity matters; legibility where measurement happens.

**D-033 · 2026-08-22 · The CCG reference is the earliest capture in the LOCKED window.**
Not the earliest ever. A first-ever attempt is where the patient is still working out what
is being asked of them, so comparing today against it manufactures an improvement that never
happened. No locked baseline -> 409, not a substitute.

**D-032 · 2026-08-22 · The clinician report is printed by the browser, not generated on the
server.** Server-side rendering would assemble a patient's full history into a binary on a
shared host, write it to a temp file, and hand it back through a download URL - three more
places for it to linger on infrastructure we do not control. `/report/{id}` still returns
JSON, so a server-side renderer remains possible if scheduled exports are ever needed.

**D-031 · 2026-08-22 · PATTERN_ATYPICAL gets its own colour token, off the severity scale.**
Putting it between WATCH and ALERT would say it is a worse WATCH. It is not; it is a
different finding pointing at a different referral, and the caregiver wording ("Worth a
doctor's appointment") has to match.

**D-030 · 2026-08-22 · INV-11 flags a label only when a value follows it.**
The guard fired on seven lines that were *prohibitions* — the rule naming the labels it
forbids. Exempting those files was the wrong fix: a check that fires on the sentence
forbidding the thing gets muted, and a muted check is worse than no check because it reads
as coverage. The detector now requires a value shape after the label (separator, or a token
containing a digit, or a capitalised proper noun); prose continues in lowercase or a comma.
Pinned in both directions by 11 parametrised cases, because narrowing a safety check is
precisely when that check needs tests of its own.

**D-027 · 2026-08-22 · The daily session is 12 minutes with FIXED task ordering.**
A clinic follow-up runs 30 minutes; 12 at home is proportionate and gives denser physical
sampling, which is exactly what balance and oculomotor deficits need. Safety comes from
fixed ordering, not omission: constant position lets each personal baseline absorb the
fatigue offset. **Flagged to the owner:** intensity changes and mid-session pauses both move
a task's position after its baseline is locked, biasing toward masking decline. Instrumented
rather than prevented — `session_position`, `elapsed_seconds_at_task_start`, `intensity`,
`paused_before_task` on every result.

**D-028 · 2026-08-22 · Ordering conflicts are flagged, not silently rearranged.**
Two raised with the owner and left as specified: M17 PPG sits ~1.5 min after the standing
block when rhythm analysis conventionally wants ~5 min seated rest; and M6 pronator drift
(arms out, eyes closed) runs standing immediately after two other eyes-closed balance tasks,
the peak fall-risk moment, when it is clinically valid seated.

**D-029 · 2026-08-22 · The demo password is environment-overridable.**
It ships in a public repository. Harmless against seeded fixtures, not harmless the moment a
real patient is enrolled on an instance with `DEMO_MODE=true`. Caught by
`scripts/preflight_push.sh`, which runs before every push.

**D-013 · 2026-08-22 · The baseline is snapshot at lock and never updated (frozen
reference).**
The adaptive expectation is `intercept + slope × days` — a recovery trajectory extrapolated
forward. A patient declining along that line is invisible to it forever. Every session is
scored twice: adaptive for "unlike recently", frozen for "far from established normal".

**D-014 · 2026-08-23 · Rendering a migration against Postgres is not running it.**
Migration 0004 contained `WHERE locked = 1`. SQLite stores booleans as integers and accepts
it; Postgres rejects `boolean = integer` with UndefinedFunctionError. It passed CI for weeks
and broke the first Neon boot. `alembic upgrade --sql` could never have caught it — the
statement is literal text inside `op.execute`, so it renders identically for both dialects
and only fails when a real Postgres parses it. The next boot then failed again on
`PRAGMA foreign_keys=ON`, which env.py ran unconditionally. Two dialect bugs, one root
cause: the claim "migrations verified against Postgres" was doing work the evidence did not
support. `backend/tests/test_migration_portability.py` now scans raw SQL for both classes.

**D-015 · 2026-08-23 · Identity is a same-person check, and it never blocks a session.**
The engine has had an `identity_uncertain` confounder and an `identity_verified` column
since the beginning, with nothing computing either. The realistic threat is not an attacker
— it is a daughter who does the tapping task herself because her father is tired, whose
measurements then enter his baseline. Data poisoning by kindness. So: six ratios between
bone-structure landmarks, computed on device, compared to an enrolment vector in
`calibration_json`. Never an image, never an embedding, nothing invertible.

Two rules follow from the population. It uses STRUCTURAL geometry, not the M1 expression
features — reusing those would flag a patient for smiling, or for the facial weakness the
product exists to measure. And a failed check flags the session as a confounder; it never
refuses to run. Locking a stroke survivor out of their own check-in because the light
changed is worse than a flagged measurement. An unenrolled patient is recorded as verified,
because "never checked" must not read to a clinician as "checked and failed".

**D-016 · 2026-08-23 · The landing sells the ecosystem; Awaaz is a section inside it.**
Awaaz demos well and had drifted to the top of the page. It is one capability of a
post-stroke recovery ecosystem, not the product. The page now leads with the seven body
systems, the 21-task protocol, the on-device pipeline, the models we actually run (labelled
synthetic where they are synthetic), and the three-gate engine; Awaaz appears as §04.

The hero mesh runs the real pinned FaceLandmarker on a portrait and draws the 468 landmarks
it returns — and renders nothing if the model cannot load. A marketing page that draws a
pretend mesh is claiming a capability, which is the exact failure this product argues
against. Unsplash imagery is hotlinked: acceptable on a page with no offline promise and no
patient on it, and nowhere else in the product.

**D-017 · 2026-08-23 · The identity threshold is uncalibrated, and says so.**
`VERIFY_THRESHOLD = 0.45` and the `z / 12` scaling were set against synthetic geometry —
a same-person case, a facial-weakness case, a different-face case. No real enrolment pairs
exist yet, so the field separation between "same person in worse light" and "different
person" is unmeasured. Recorded here and in the source rather than left to look tuned: the
same rule the synthetic classifiers are held to. It errs loose on purpose, because the
cheap mistake is letting a session through unflagged and the expensive one is accusing a
patient.

**D-040 · 2026-08-24 · Privileged roles are provisioned, never self-assigned.**
`/auth/register` took `role` from the request body and used it. A stranger could sign up as
`clinician` and read `/clinic/patients`, which returns every patient's name and age across
every caregiver. Verified before fixing: a fresh self-registered clinician got 200 and a
real patient row belonging to an unrelated family.

It survived because the frontend only ever offered caregiver and patient, so nothing in the
product exercised the hole — and because `test_register_accepts_every_role` asserted it as
though it were a feature. A passing test is what made it look intentional. That is the more
useful lesson than the fix: INV-6 says the UI is never the boundary, and here the UI was
doing all the work.

Registration now accepts `caregiver` and `patient` only. Clinician, ASHA worker and admin
are minted by `POST /admin/users` (admin-only, audited) or by the seed — both server-side.
Tests must not route around it: `conftest.provision` writes the row directly, the way
production does.

**D-041 · 2026-08-24 · The admin sees counts, not patients.**
An operator console is the obvious place for "just let me look at the data" to creep in, and
in a product whose entire argument is that raw data never leaves the device, an admin who
can read patient records would be the loudest possible contradiction — a backdoor around
INV-11 with a friendlier name.

So `/admin` returns aggregates (census, band distribution, the three-gate funnel, identity
flag rate) and the append-only audit trail with the patient reference truncated to eight
characters — enough to see repeated activity on one record, not enough to address it. No
names, no emails, no features, no free text.
`test_no_admin_response_contains_patient_identifying_data` asserts the shape, so adding a
name to any admin payload fails the build. If someone needs one patient's clinical data,
that is a clinician's path, where it is authorised and logged.

**D-038 · 2026-08-24 · The landing page argues; the product surfaces stay calm.**
The signed-out page carries the immersive treatment — a scroll-scrubbed run, parallax, a
smooth-scroll damper — and the clinical surfaces get none of it. Two reasons, and the second
is the binding one. Identity is the landing page's job and legibility is the product's
(D-034 revised). And this product measures vestibular function: inertial scrolling and
parallax are a documented trigger for people with vertigo, who are exactly the users
in scope. So `useSmoothScroll` is gated on `(pointer: coarse)` and
`prefers-reduced-motion`, and lives only on `/` when signed out. Supersedes nothing; it
scopes D-034.

**D-039 · 2026-08-24 · Motion is one rAF ticker, not an animation library.**
GSAP + ScrollTrigger is ~90 kB of transfer for effects that `IntersectionObserver`, CSS
transitions and one `requestAnimationFrame` loop produce natively, on a page that shares a
service worker with a clinical PWA precaching a 4 MB model. What the page DID need was to
stop putting scroll position into React state: the 21-day section reconciled a canvas and
three paragraphs sixty times a second. Scroll-linked effects now write to the DOM or the
canvas directly and quantise anything React must see (the day number changes 20 times, not
60 times a second). Measured: 0 long tasks over a full-page scroll. Lenis IS a dependency,
for damped wheel scrolling only, dynamically imported — it is 5.4 kB gzipped and replacing
it with hand-rolled wheel interception would break keyboard scrolling, scrollbar dragging
and find-in-page, which is not a trade worth making to avoid one small package.

**D-042 · 2026-08-24 · The "outside CDSCO" claim was wrong and is removed everywhere.**
The repo stated, in PRD.md and propagated from there into the safety-guardrail rationale,
the Onboarding consent screen, the landing page (hero disclaimer and footer), and
docs/archive/FINAL_PRODUCT_SPEC_v4.md: "D2C — Recovery Companion — Outside CDSCO device classification."
That is the project owner's own error, introduced into the specs this codebase was built
from, and it is a live credibility risk in front of any doctor, investor, or regulator —
not a documentation nit.

CDSCO published final Medical Device Software guidance on 21 July 2026. Under the Medical
Devices Rules 2017 framework, software is classified by INTENDED USE, not business model.
A system whose stated purpose is monitoring neurological change in identified post-stroke
patients is much closer to SaMD than to wellness software; "outside CDSCO because it is
D2C" was never a defensible reading of the rules.

Fixed at the source, not patched at the symptom: `docs/INTENDED_USE.md` is now the single
frozen statement every surface must quote, `docs/CLAIMS_MATRIX.md` classifies every
public-facing sentence ALLOWED / NEEDS EVIDENCE / PROHIBITED, INV-13 codifies the rule, and
`test_regulatory_claims.py` fails the build if the phrasing reappears — including in the
built frontend bundle, which caught a stale `frontend/dist/` still carrying the old wording
after the source was already fixed. Every genuine safety disclaimer ("it cannot detect a
stroke happening now, call 108") was reworded to carry the same warning without using any
of the banned phrases, so the ban costs nothing safety-relevant.

**D-043 · 2026-08-24 · Baseline lock thresholds are cadence-aware, not a flat 12.**
Task 2.4 asked explicitly: does the baseline engine handle modules measured at different
frequencies, or does it silently mix them? Tested rather than assumed
(`test_mixed_cadence_baseline.py`). Two different answers to two different questions:

Per-module isolation was already correct. `build_baseline` is called once per
`module.code`, and `_module_history` fetches only that module's own `ModuleResult` rows —
no cross-module pooling, no conflation of observation index with elapsed calendar time.
Proven with an interleaved daily module and a twice-weekly module over ten weeks: the
twice-weekly module's n_sessions, window and trajectory come out byte-identical whether or
not the daily module's data exists in the same account.

The aggregate lock timeline was not. `_refresh_baseline_state` sets the WHOLE patient's
`baseline_state` to `locked` only when every module's own `BaselineRow` is individually
locked, and every module was locked with the same flat `LOCK_AT_N_SESSIONS = 12` regardless
of cadence. At twice-weekly (the Part 2 default for Comprehensive Follow-up), 12
observations is six calendar weeks — not the ~21-day window Part 3 positions as core. This
was invisible until now because every module has run daily since the product existed;
"12 observations" and "12 days" were the same number by coincidence, not by design.

Fixed with `lock_threshold_for_schedule` and `discard_count_for_schedule`
(`engine/baseline.py`), both wired into `session_pipeline.py`'s live `build_baseline` call
via `_CADENCE_BUCKET`.

**The first set of numbers was wrong, and the demo caught it.** Initially: twice_weekly
locked at 6 retained with the flat discard of 3 — 9 sessions, 4.5 weeks. But
`_refresh_baseline_state` gates the WHOLE patient on the slowest module, and Part 3
positions a 21-day doctor-reviewed baseline as core; 21 days at twice weekly is only SIX
sessions. So the patient-level baseline could never lock in the promised window. This did
not show up in the isolated cadence tests (each module's own numbers were correct) — it
showed up when the 21-day demo seed came back with `baseline.state == "collecting"`
instead of `locked`. Chosen because it was checked against the product's actual promise
rather than against lock-time in the abstract.

Final: daily locks at 12 retained after 3 discarded (~15-18 days, unchanged); twice_weekly
at 4 after 2 discarded (exactly 6 sessions = 3 weeks); weekly at 3 after 2; monthly at 3
after 1. The discard count is now cadence-aware too — the practice effect is real and
cadence does not remove it, so it is reduced rather than dropped, and 2 keeps the sharpest
learning gain (1st→2nd administration) out of the baseline. 4 retained for twice_weekly is
not an arbitrary remainder: `fit_trajectory` returns a FLAT slope below 4 points, and a
flat trajectory on a still-recovering patient reads their genuine recovery as deviation.

**D-044 · 2026-08-24 · The two-layer session model: derived, not retyped; and a real
duration discrepancy found while building it.**
Task 2.1/2.2. `SessionType` renamed `daily/weekly/monthly` → `DAILY_PULSE/COMPREHENSIVE/
MONTHLY/ASHA_VISIT` (migration 0012) — the old values described a MODULE's measurement
schedule, not a SESSION, and never actually differentiated live content: every session ran
the full 21-step battery under `type="daily"` regardless of what `weekly`/`monthly` were
meant to mean; the frontend never sent them.

`exam/registry.py` already tagged each module DAILY/WEEKLY/MONTHLY, and that tagging maps
almost exactly onto the task's Daily Pulse / Comprehensive content lists — M1/M4/M7/M10/
M13/M19 were already DAILY. One real correction: M21 (SVV) was tagged MONTHLY though the
task lists it inside Comprehensive; moved to WEEKLY so the whole posterior/vestibular
domain (M3, M9, M21) shares one cadence instead of splitting its evidence across two.

**Daily Pulse's six steps land at IDENTICAL positions (1-6) in both protocols, not
independently ordered.** This is not cosmetic. `SessionObservation` (engine/baseline.py)
carries a module's raw feature values into its baseline with no position-adjustment — if
M7 genuinely performs differently late in a session than early (which
`within_session_fatigue_slope` exists specifically to say it does), then a baseline mixing
M7 captured at position 4 in Daily Pulse with M7 captured at position 15 in the old flat
protocol would silently blend two different physiological states into one "normal" — the
same silent-corruption shape 2.4 asked to rule out for cadence, here for fatigue position
instead. Both protocols are DERIVED from the single existing `PROTOCOL` tuple (partition by
module, renumber) rather than retyped by hand, so there is exactly one place a task's
wording or duration can be edited and it is structurally impossible for the two protocols
to describe a module differently. `test_session_type_protocols.py` pins the position match.

**A real discrepancy, found rather than assumed away: Daily Pulse's six modules do not sum
to 90 seconds of raw task time — they sum to 195.** `registry.py`'s `seconds` field per
module (M1=16, M4=20, M7=22, M10=20, M13=8, M19=4) was clearly reverse-engineered to hit
`DAILY_BUDGET_SECONDS = 90` exactly; `session_plan.py`'s `Step.seconds` for the SAME six
modules (the numbers that actually drive the live protocol timer) are M10=60, M4=40, M1=40,
M7=25, M13=20, M19=10 — 195s. This was invisible before Part 2 because nothing ever
computed "these six modules, alone" — the flat protocol ran everything together. Decision:
keep `session_plan.py`'s durations. They are what a patient actually experiences, and
shortening a reaction-time or speech task without a clinical basis to make a target number
true would be worse than admitting the target was optimistic. The "~90 seconds" claim is
corrected wherever it appears in product copy to the real figure — raw task time ~195s,
realistically 3-4 minutes wall-clock once instructions and framing are included, per
`planned_seconds`'s own docstring ("Task time only. Real sessions run longer"). Flagged to
the project owner as an open question: either accept "under four minutes" as Daily Pulse's
honest positioning, or decide which of the six tasks' durations can be shortened on
clinical grounds — that decision is not this session's to make unilaterally.

Cadence-aware baseline locking (D-043) is wired through session_type: DAILY_PULSE modules
use the `daily` threshold, COMPREHENSIVE-only modules use `twice_weekly` by default
(configurable per patient), MONTHLY modules use `monthly`.

**D-045 · 2026-08-24 · registry.py's per-module seconds were reverse-engineered; corrected
to the real timings.**
Two files described how long each module takes and disagreed. `exam/registry.py`'s
per-module `seconds` summed to exactly `DAILY_BUDGET_SECONDS = 90` for the six DAILY
modules (M1=16, M4=20, M7=22, M10=20, M13=8, M19=4) — a target, reverse-engineered.
`exam/session_plan.py`'s `Step.seconds` for the same six, which are the numbers that
actually drive the live session timer, sum to 195 (M10=60, M4=40, M1=40, M7=25, M13=20,
M19=10). Nothing ever computed "these six modules alone" before the Daily Pulse /
Comprehensive split, so the contradiction stayed invisible for the product's whole life.

**Decision: keep session_plan's durations, correct registry to match.** These durations ARE
the measurement — sustained phonation needs its seconds to show stability, tapping needs its
window to show rate and asymmetry — so trimming a clinical task to make a number true would
degrade what the product measures in order to protect a claim about it. That is backwards.
Owner decision, 2026-08-24.

Nine modules were understating: M1 16→40, M2 15→20, M3 45→140, M4 20→40, M7 22→25,
M8 30→55, M10 20→60, M13 8→20, M19 4→10. `DAILY_BUDGET_SECONDS` 90→195.

**M9, M11 and M21 were deliberately NOT changed** even though their registry numbers exceed
their protocol sums (180 vs 90, 180 vs 60, 180 vs 60). Those three own tasks the daily
protocol does not run — M9's Unterberger and tandem walk are ASHA-visit only (INV-12), M11
has three cognition tasks beyond word encoding and recall, M21 has its dynamic SVV
variants. Their larger numbers are honest. So the rule pinned by
`test_registry_matches_session_plan_timings` is an inequality, not equality: a module may
claim MORE time than the daily protocol spends on it, never less. Claiming less is the
direction that under-promises the patient's real burden, and is how the 90s figure survived.

`session_plan.py`'s own `DAILY_PULSE_BUDGET_SECONDS` — added earlier the same day and also
hardcoded to 90, in the very file whose steps sum to 195 — is now derived
(`sum(s.seconds for s in DAILY_PULSE_STEPS)`) rather than asserted. A second hand-written
constant is precisely how the first drift happened.

Corrected in: README, PRD (FR2, §7, §8), DEVELOPMENT, frontend/README, models.py,
main.py's OpenAPI description, migration 0012's docstring, and the test that certified the
wrong number (`test_the_daily_battery_fits_the_ninety_second_budget` → `..._fits_its_capture_budget`).
**Pitch and landing-page copy deliberately untouched** — the owner is handling the
public-facing figure separately, and `frontend/src/routes/Landing.tsx` keeps its wording.

---

**D-046 · 2026-08-28 · `consent_ref` is nullable in Part 3, and Part 4 owes it a backfill.**
`patient_clinician_links` carries a `consent_ref` column that Part 3 never populates. The
consent tables it will point at do not exist yet; they are Part 4. The alternative — hold
the doctor-in-the-loop gate until Part 4 lands — would leave the far worse defect in place
(any account with the clinician role could read any patient) for the sake of a foreign key.

Consent is not, however, unrecorded. Every link writes an audit event
(`clinician.link.granted`) carrying `{"consent": "caregiver_granted", "consent_ref": null}`,
and the link is created by the owning caregiver, never by the clinician. So the *fact* of
consent has a durable, append-only record from day one; what it lacks is a reference into a
structured consent store.

**The obligation this creates, stated so Part 4 cannot forget it:** Part 4's migration must
backfill `consent_ref` for every link created before its consent tables existed, sourcing
the grant time and actor from those audit rows. Without that backfill, Part 3's links become
a cohort of consented-but-unreferenced records — consent that happened, evidenced only in a
log nobody joins against. `test_the_link_records_consent_now_for_part_4_to_reference` exists
to make the audit event a contract rather than an implementation detail, so the backfill has
something guaranteed to read.

Owner decision, 2026-08-28: ship nullable now, do not wait.

---

**D-047 · 2026-08-28 · A baseline that does not complete auto-extends exactly once, then
ABANDONS. It is never downgraded to LIGHT.**
The 21-day baseline window can expire with modules still unlocked — a patient who misses
sessions, or whose comprehensive-only modules never reach their retained-session count. Three
options were on the table: extend, downgrade the protocol to LIGHT so fewer modules need to
lock, or stop and involve a human.

**Downgrading was rejected outright.** LIGHT changes which tasks run, which changes where
each remaining module sits on the fatigue curve. `SessionObservation` stores raw values with
no position adjustment, so a module measured at position 2 of a LIGHT session and position 6
of a COMPREHENSIVE one is two different physiological states written to one baseline. That is
the exact confound INV-14 and D-027 exist to prevent, and doing it *while building the
baseline* would corrupt the yardstick every later comparison is measured against. A shortcut
that damages the reference is not a shortcut.

So: `expiry_decision(days_elapsed, extensions_used)` returns `continue` → `extend` (once, to
35 days) → `abandon`. The second failure is not a second silent extension. It is a finding
about this patient's ability to complete the protocol — possibly a deterioration, possibly a
phone they cannot use, possibly a caregiver who has stopped — and it belongs in front of a
person. ABANDONED carries a reason, visible to both caregiver and clinician, and suppresses
bands and alerts like every non-LOCKED state.

`test_expiry_never_recommends_a_light_downgrade` asserts the string is not reachable from any
combination of inputs, so the option cannot quietly return later.

Owner decision, 2026-08-28.

---

**D-048 · 2026-08-28 · The frozen reference is written on the doctor's CONFIRM, not on
module lock.**
INV-4 says the frozen reference is written once and never updated: it is the permanent
yardstick, and every later comparison — every band, every alert — is measured against it.
Until Part 3 it was written by `_upsert_baseline` at the moment a module's adaptive baseline
locked, i.e. purely on session count. No human had seen it.

Part 3 introduces a clinician who can say "that window is not representative — keep
collecting" (EXTEND). If the reference is already sealed by then, that judgement is
cosmetic: the yardstick was set against the window the clinician just rejected, permanently,
and INV-4 forbids correcting it. The write therefore moved to `freeze_reference()`, called
from exactly one place — the CONFIRM branch of `record_review`.

**The failure mode this creates is new, and is the thing actually worth testing.** With the
write on CONFIRM, an EXTEND-then-CONFIRM cycle has two moments that look like completion. A
naive implementation snapshots at each, so the reference gets written twice and the second
write silently replaces a value that was supposed to be permanent. A test asserting only
"not written on EXTEND" passes while that ships.
`test_extend_then_confirm_writes_the_reference_exactly_once` drives the full cycle — EXTEND,
values move, CONFIRM, then a second CONFIRM with post-lock drift — and asserts the reference
captures the FINAL window, and that a repeat `freeze_reference()` returns 0 newly frozen.
The guard is in the function itself: rows with `reference_locked_at is not None` are skipped,
so idempotence does not depend on the caller.

Consequence worth noting: a patient in DOCTOR_REVIEW_PENDING has locked modules and no frozen
reference. That is correct — they are not being monitored yet, and `baseline_phase` is now
computed from `patient.baseline_state is not LOCKED` rather than from the modules, so bands
and alerts stay suppressed until a human confirms.

Owner decision, 2026-08-28.

---

**D-049 · 2026-08-28 · A clinician needs BOTH an active link and current C3 consent. Neither
alone grants access.**
Part 3.2 made an active `patient_clinician_links` row the thing that grants a clinician
access. Part 4 adds a second, independent condition: `CLINICIAN_SHARING` (C3) consent must
currently be in force.

These answer different questions and can change independently. A link answers *is there a
care relationship*; consent answers *may it see data right now*. A caregiver who withdraws
C3 has not ended the relationship with the doctor — they have withdrawn permission to share
measurements, and that must take effect immediately without anyone having to also remember
to revoke the link. Conversely, revoking a link ends the relationship without implying
anything about consent.

**The implementation detail that matters more than the rule:** both conditions are checked
in exactly one function, `app.auth.deps.clinician_may_access_patient`. That is not tidiness.
The Part 5.1 endpoint audit found **six** routes that had each hand-rolled their own version
of "may this caller touch this patient" and never received the Part 3.2 fix — including
`sessions.py:_assert_can_access`, which still granted any account with the clinician role
read *and write* access to any patient's raw module features. Six separate copies is how a
security fix half-lands. Every call site now delegates to the single function, so a future
change to the rule reaches all of them or none.

Consequence worth stating: `/clinic/patients` and `GET /patients` filter on consent as well
as on the link, so a withdrawn patient disappears from the roster rather than appearing
there and 403-ing when opened.

---

**D-050 · 2026-08-28 · Erasure tombstones the patient row instead of deleting it.**
Part 5.4 asked for real deletion of clinical measurements with the audit trail retained
(INV-8). Those two requirements are in direct conflict in the current schema, and the
conflict was found by probing rather than by reading: `audit_log.patient_id` carries
`ondelete="CASCADE"`, so `DELETE FROM patients` destroys every audit row for that patient.
A probe against a real SQLite database confirmed it — one audit row before, zero after.

So erasure strips the row instead of removing it. Every clinical measurement is genuinely
deleted (sessions, module results, baselines, deviations, scores, alerts, questionnaires,
vitals, adherence, wearable readings, falls, and all Awaaz content). The surviving row keeps
its id and loses everything else: name, age, sex, stroke details, languages, and
`calibration_json` — which is where the face-identity enrolment vector lives, the one stored
value derived from the patient's body. What remains identifies nobody.

**Rejected: dropping the foreign key** so the row could be deleted outright. That is a
constraint rewrite, on SQLite (which rebuilds the whole table under `batch_alter_table`), on
the table every other table references — to solve a problem a nullable column solves
additively. **Rejected: `ondelete="SET NULL"`**, which keeps the audit row while destroying
the linkage that makes it useful; correlating one former patient's access history is the
main thing an auditor wants after an erasure.

Clinician links are revoked rather than deleted, and consent history is retained, both for
the same reason as the audit trail: they are records of decisions and access, not
measurements of a body.

Two fields had to be RESET rather than nulled because they are NOT NULL —
`stroke_side` (to `unknown`) and `other_movement_disorder` (to `False`). Found by a failing
test, not by reading the model; `unknown` is also the more honest value, since after erasure
we genuinely do not know.

---

**D-051 · 2026-08-28 · The corrected Daily Pulse figure goes everywhere, including the
browser tab. D-045's carve-out for public-facing copy is closed.**
D-045 corrected Daily Pulse from 90s to ~195s of raw task time and deliberately left
pitch and landing copy alone, because the public-facing figure was the owner's to decide.
That carve-out has now been decided the other way: **the true number goes everywhere.**

It turned out the old figure had survived in **eight** places, and only one of them was
the landing page D-045 actually named: the shipped `<title>`, the meta description, the PWA
manifest `description`, both landing hero headlines, the body copy, the `NinetyDays` mark,
and `docs/DEMO_SCRIPT.md`. Four of those were found by the scanner rather than by hand,
after I had already "finished" correcting them manually.

`docs/PRD.md` §7 keeps its `(Was "<=90s" …)` note and is explicitly allowlisted. Recording
that the figure used to be wrong is the opposite of asserting it, and deleting it would
erase the correction's own history.

**The lesson recorded, because it is more general than this number:** a decision that is not
enforced by a test is a decision that drifts back. D-045 was made, written down, and
partially applied — and the wrong figure then shipped in the browser tab for weeks. The new
`STALE_DURATION` guard in `test_regulatory_claims.py` is what makes D-045 real rather than
aspirational.

---

**D-052 · 2026-08-28 · `python-multipart` is removed, so INV-1 is structural rather than
only tested.**
It was pinned, installed, and completely unused — zero matches anywhere in `app/`. It is
also the single dependency whose *only* purpose is accepting file uploads, which is exactly
what INV-1 forbids.

Three tests already asserted that no endpoint accepts media (a source scan, a schema scan,
and an OpenAPI scan). Those catch a violation *after* somebody writes it. With the library
absent, a future `UploadFile` parameter fails at **import** — the runtime cannot express the
violation at all. That is a different and stronger kind of guarantee, and it cost one
deleted line.

Removed from `requirements.txt` **and** `requirements.lock.txt` — leaving the lock entry
would have restored it on the next byte-identical rebuild. Verified by actually
uninstalling it and confirming the app imports, all 76 routes register, and the OpenAPI
document still generates. A new INV-1 test asserts neither manifest re-pins it, checked
against the manifests rather than the live interpreter so a transitively-installed copy
does not produce a false failure.

`passlib` remains unmaintained and is why `bcrypt` is held at 4.0.1. Recorded in
`docs/SBOM.md`; deliberately not acted on, because migrating password hashing is a
security-relevant change that deserves its own reviewed piece of work.


---

**D-053 · 2026-08-29 · OPEN — should a consent that depends on C2 (`DATA_PROCESSING`) be
treated as moot when C2 is withdrawn?**

**Status: OPEN. Not resolved, and deliberately not resolved inside the caretaker feature.**

The six consents (Part 4, D-049) are independent by construction: `set_consent` writes and
withdraws each type on its own, and `consent_currently_granted` reads exactly one type. That
independence is right for most pairs — C4 (research) and C5 (media) genuinely have nothing to
do with each other.

But C2 is not like the others. `DATA_PROCESSING` is consent to process personal and health
data *at all*. If it is withdrawn while C3 (`CLINICIAN_SHARING`) remains granted, the current
code will happily keep serving a linked clinician this patient's measurements — sharing data
whose processing the caregiver has just refused. Nothing in the system flags the combination.

**This is a property of the existing consent model, not something the caretaker feature
introduces.** It applies to C3 today, in production code, and it would apply identically to a
future C7 (`CARETAKER_SHARING`). The caretaker work therefore inherits the question rather
than creating it, and resolving it there would fix half the problem in the wrong place — C3
would keep the gap while C7 did not, which is worse than a consistent gap because nobody
would expect the asymmetry.

**To be resolved for C3 and C7 together, in one place**, when it is picked up. The options
worth weighing at that point:

- **Dependency at read time** — `consent_currently_granted` returns False for any dependent
  type when C2 is not in force. One change, applies everywhere, but makes a "granted" row
  read as not-granted, which the consent status surface must then explain honestly rather
  than showing a confusing toggle.
- **Cascade at write time** — withdrawing C2 withdraws its dependents as real, attributed
  withdrawal rows. More explicit and fully auditable, but it puts words in the caregiver's
  mouth: they withdrew one thing and the record shows them withdrawing three.
- **Block the withdrawal** — refuse to withdraw C2 while dependents are active, and require
  them to be withdrawn first. Honest, but refusing to let someone withdraw consent is a bad
  posture for a consent system to take.
- **Surface only** — leave enforcement alone and warn in the UI. Cheapest, and the weakest:
  it leaves the actual access path unchanged, which is the thing that matters.

No recommendation is recorded here on purpose. Whoever picks this up should decide it with
the consent surface in front of them, because the right answer depends as much on what the
caregiver is shown as on what the server enforces.

---

**D-054 · 2026-08-29 · The caretaker is ADDITIONAL family, on its own link table, behind the
same link-plus-consent rule as a clinician.**

Four owner decisions, locked before any code:

1. **Only the owning caregiver creates a caretaker.** Not the patient, not another
   caretaker. A caretaker able to mint caretakers voids the boundary the moment one account
   is compromised — the same reasoning that stops a clinician linking themselves.
2. **A caretaker may acknowledge a FALL but not an ALERT.** They are the person in the house
   and a fall needs answering now; an alert is a clinical loop to close. Family *see*
   everything, including the alert — they simply cannot silence it.
3. **Caretaker is a COMMON role**, and onboarding leads with *"I'm setting this up for my
   parent"*.
4. **Reading A**: the first family member to enrol the patient stays the `caregiver`/owner;
   every family member after them is a caretaker.

**Why Reading A rather than renaming the family role.** Decision 3 makes the enrolling person
the son or daughter — who is therefore already the `caregiver`, with full access, consent
control and erasure. That raised a genuine fork: is "caretaker" additional family, or does it
replace `caregiver`? Replacing it would migrate every `caregiver` row and rewrite every
"owning caregiver" check in `patients.py`, `consent.py`, `erasure.py` and `clinician.py` —
churning tested code across the consent and erasure authorisation paths, the two places where
a mistake is worst, for no functional gain. Renames that cross authorisation boundaries are
how the six-route bug happened. Reading A delivers family transparency scoped per patient and
touches none of it.

**A separate `patient_caretaker_links` table, not a reuse.** Reusing `caregiver` fails
immediately: `Patient.caregiver_id` is a single non-nullable FK, so a second one has nowhere
to live and every "owning caregiver" check would silently start admitting them to consent
changes and erasure — a privilege widening disguised as a reuse. Reusing
`patient_clinician_links` fails differently and more quietly: that table is *queried* as
clinician linkage, and the admin doctor census counts its rows, so family would be reported
as doctors on an operator surface.

The SHAPE is copied field for field, because it already encodes lessons this feature would
otherwise re-learn — `unlinked_at IS NULL` as the access rule, revocation that retains the
row (INV-8). **One deliberate difference: `consent_ref` is populated at creation, not
nullable-then-backfilled.** D-046 exists because Part 3 shipped links whose consent lived
only in an audit event and needed a later migration to reference it. The consent table
already exists now, so the link and its C7 row are written in one transaction and that debt
is simply not incurred.

**C7 reuses the consent machinery rather than adding a parallel one.** No
`caretaker_can_view` boolean anywhere: a second mechanism answering the same question is how
the two end up disagreeing. C7 is deliberately not default-OFF — C4/C5 are opt-in because the
product works without them, but a caretaker who can see nothing is not a feature.

**The WhatsApp destination is health-adjacent PII, not contact metadata.** A number on its own
is a number; joined to a family link it says *this person is caring for a stroke survivor* — a
health inference about a named individual. So it is deleted on erasure (the link is only
revoked, as clinician links are), invisible to admin (D-041), and **never written into an
`audit_log.meta_json`**: the audit trail is append-only and survives erasure by design
(D-050), so a number there would be un-erasable — the retention property becomes a liability.
The audit row records `channel_id` and nothing else.

**Auth is deferred; authorisation is not.** Caretaker accounts are created disabled — the
password hash is a sentinel no password can match — because invite and credential setup
belong to the auth pass. The boundary is built and tested now regardless, because it has to
be provably correct *before* the first real caretaker can sign in, not after.


---

**D-055 · 2026-08-29 · OPEN — a migrated SQLite schema carries stale duplicate CHECK
constraints, and `patients` is un-insertable because of it.**

**Status: RESOLVED 2026-08-29. Three tables were affected, not two. Fixed in 0018 and 0020,
with 0015's Postgres deploy blocker removed and a regression test that compares the two
schema paths directly.**

Found while writing the caretaker migration tests — the first tests in this repo that insert
a privileged user or a patient into an **alembic-migrated** database rather than one built by
`Base.metadata.create_all()`. Every functional test uses `create_all` (see `conftest.py`), so
the migrated schema had effectively never been exercised with real rows.

### The mechanism
`sa.Enum(..., name="x", native_enum=False, create_constraint=True)` used inside a migration
is **not attached to `Base.metadata`**, so the `ck_%(table_name)s_%(constraint_name)s`
convention never applies and the CHECK lands under the **bare** name `x`.
`batch_alter_table`, however, **does** apply the convention. So a later migration that says
`drop_constraint("x")` actually targets `ck_<table>_x` — a name that has never existed.

On **SQLite** the batch rebuild then keeps the real (old) constraint and adds a correctly
named new one, leaving two. On **Postgres** the same statement renders as
`ALTER TABLE ... DROP CONSTRAINT ck_<table>_x`, which errors on a constraint that is not
there. This is the third distinct variant of the trap D-014 records, and the first one that
arrives from *reflection* rather than from a hand-passed name.

### Half A — `users`, FIXED in 0018
Since 0005 the table carried `ck_users_ck_users_role_enum` (the original three roles) beside
`ck_users_role_enum` (the current set). Both enforced, so the effective rule was their AND:
an alembic-migrated SQLite database **could not create an `asha_worker`, `admin` or
`caretaker` account at all**. Verified by inserting each role. 0018 now drops the stale
duplicate under a SQLite-only guard, and all five roles insert cleanly.

### Half B — `patients`, OPEN
`baseline_state_enum` (lowercase `not_started/collecting/locked`, from 0002) sits beside
`ck_patients_baseline_state_enum` (uppercase five, from 0015). **No value satisfies both** —
`NOT_STARTED` fails the first, `not_started` fails the second — so a migrated SQLite database
cannot insert a patient row at all. Verified directly with both values.

**And the Postgres consequence is worse than the SQLite one.** Rendering 0015 for Postgres
emits `ALTER TABLE patients DROP CONSTRAINT ck_patients_baseline_state_enum`, which does not
exist there either — so **0015 should be expected to fail on the next Neon deploy**. 0014–0019
have never been deployed, so this has not shipped; it is a pre-deploy blocker, not an
incident.

**Why it is not fixed here.** The obvious fix — passing
`naming_convention={"ck": "%(constraint_name)s"}` to `batch_alter_table` so the real name is
targeted — **was tried and did not work**: the duplicate survived on SQLite. The mechanism
resists a one-line correction and needs someone to work through alembic's batch reflection
semantics properly, against a real Postgres as well as SQLite. Doing that unattended, on the
table every other table references, is exactly what the plan-first rule exists to prevent, so
the attempt was reverted rather than left in place looking like a fix.

`test_downgrading_0019_deletes_only_caretaker_consents` is marked `xfail(strict=True)` naming
this defect, so it converts to a hard failure the moment the defect is repaired rather than
being quietly forgotten.

**Not affected:** every functional test and the running application, which build the schema
from `Base.metadata` where the convention applies uniformly and only one constraint exists.
The bug lives strictly in the migration path.

---

### D-055, RESOLVED — the full account

**It was three tables, not two.** A table-by-table diff of a migrated database against a
`create_all` database — the check that had never been run — found `patients`, `scores` and
`alerts` diverging, on top of the `users` case already fixed in 0018. What each divergence
actually cost:

| Table | Consequence on a migrated database |
|---|---|
| `patients` | **No `baseline_state` value was insertable.** No patient could be created at all. |
| `scores`, `alerts` | **`PATTERN_ATYPICAL` was unstorable** — the band that keeps a Parkinson's patient out of the stroke-alert path (INV-2). |
| `users` | `asha_worker`, `admin`, `caretaker` could not be created (fixed in 0018). |

**The root cause was not naming — it was reflection.** The tempting diagnosis is a prefix
mismatch between the bare `sa.Enum(name=...)` constraint and the convention-prefixed one, to
be fixed by passing a naming convention to `batch_alter_table`. That was tried and it failed,
because one layer down **SQLAlchemy's SQLite CHECK reflection mis-parses multi-constraint
DDL**: asked to reflect `CONSTRAINT pk_t PRIMARY KEY (id), CONSTRAINT state_enum CHECK (...)`
it returns the name as `"pk_t PRIMARY KEY (id), CONSTRAINT state_enum"`. Batch mode cannot
match a name that was never parsed, so it re-emits the constraint mangled and alongside the
new one. No naming convention repairs that.

**The fix** is `batch_alter_table(..., copy_from=...)`, which skips reflection and rebuilds
from the Table it is given — `Base.metadata.tables[...]`, the same definition `create_all`
uses, so the migrated schema converges on the model by construction rather than by drops that
guess at names. Three details had to be right, each found by testing:

1. The copy must be **detached** (`to_metadata`), or the live application metadata is mutated.
2. The **naming convention must be carried onto the copy**, or the constraints land bare.
3. The **enum type's own `name` is what becomes the constraint name** under `copy_from` — a
   table-level `CheckConstraint` is ignored entirely. Prefixing the type name is what makes
   the rebuild match `create_all`.

And `copy_from` **does not carry indexes**: `patients` went from three to none, and the next
downgrade failed on `DROP INDEX ix_patients_asha_worker_id`. They are recreated from the same
model definition.

**0015's deploy blocker is removed.** It emitted
`ALTER TABLE patients DROP CONSTRAINT ck_patients_baseline_state_enum` — a name that has never
existed on either dialect — which would have failed the next Neon deploy outright. Both
candidate spellings are now dropped with `IF EXISTS`, and the SQLite path leaves constraint
work to 0020, which is the only mechanism that converges there.

**Two further defects were caught by rendering rather than by running:**

- `0020`'s Postgres branch first emitted `CHECK (col IN (__[POSTCOMPILE_param_1]))` — a bind
  placeholder, not SQL. It would have rendered happily and failed the moment Postgres parsed
  it, which is precisely what D-014 exists to catch. The CHECK text is now built from the
  enum values literally.
- `0016`'s consent backfill raised `AttributeError` under `alembic upgrade --sql`, because
  `bind.execute` returns None with no live connection. That stopped the Postgres render at
  0016 and silently took the portability check for every later migration with it. It now
  skips with a visible marker in offline mode.

**Verified:** the schema diff reports **no mismatches on any table**; every previously-blocked
value inserts against the migrated schema (five roles, five baseline states, all four bands in
both `scores` and `alerts`); `upgrade head` → `downgrade base` round-trips clean (INV-7); and
the chain renders valid literal SQL for Postgres.

**Guarded by two new tests** in `test_migration.py`:
`test_the_migrated_schema_matches_create_all` (the diff that never existed, comparing names as
well as presence) and `test_every_role_and_band_is_insertable_after_migration` (the
behavioural half — a clean constraint diff can still be wrong).


---

### D-056 — the consent backfill bound a tz-aware datetime to a naive column

**2026-08-30. Found by running the chain on a Neon branch of production, not by rendering.**

`0016` creates `consents.granted_at` as `sa.DateTime(timezone=True)` — correct. But the
lightweight `sa.table()` literal it uses for the backfill INSERT declared the same column as
`sa.DateTime()`, naive. `granted_at` is copied from `patient_clinician_links.linked_at`, a
`timestamptz`, so the value arrives tz-AWARE. SQLAlchemy therefore bound the parameter as
`$6::TIMESTAMP WITHOUT TIME ZONE` and asyncpg refused it:

```
asyncpg.exceptions.DataError: invalid input for query argument $6:
  datetime.datetime(2026, 8, 29, 20, 8, 16, tzinfo=utc)
  (can't subtract offset-naive and offset-aware datetimes)
```

The chain died at 0016 and would have taken the production deploy with it.

**Why neither existing guard could see it.** This is D-014's lesson with a new face — and this
time *rendering could not have caught it either*:

- **SQLite** is permissive about datetime binding, so the round-trip test passes.
- **`alembic upgrade --sql`** SKIPS this backfill entirely. It reads existing rows, so it is
  guarded by the offline-mode check added while fixing D-055 — meaning the statement never
  appears in the rendered SQL at all.

Both of this repo's migration guards are structurally blind to a bug in a data backfill's
*parameter binding*. Only executing the chain against real Postgres rows surfaces it.

**The rule this establishes:** a migration that writes rows is not verified by rendering or by
SQLite. It is verified by running it on a Neon branch of production. `DEPLOY.md` step 4 already
said to do this; D-056 is the first time it caught something, and it caught a total deploy
failure.

**Verified on branch `predeploy-chain-20260829-201241`, copied from production main:**
`alembic upgrade head` 0011 → 0020 exit 0; patients 1 → 1 with `baseline_state` mutated
`locked` → `LOCKED`; users 5 → 5; scores 21 → 21; alerts 1 → 1; zero NULL `consent_ref`; all
five roles insertable by real INSERT; `PATTERN_ATYPICAL` present in both band CHECKs; no
doubled `ck_x_ck_x_` names.

---

### D-057 — the ORM constrained on the enum NAME, the migration on the enum VALUE

**2026-08-30. Found in production, by a 500 on `POST /demo/seed`, after a clean deploy.**

`SessionType` is the only enum in `models.py` whose member name differs from its value:

```python
daily_pulse = "DAILY_PULSE"
```

SQLAlchemy's `sa.Enum(PyEnum, ...)` persists and constrains on the member **NAME** unless
given `values_callable`. Nothing here gave it one. So the three halves of the system each
picked a different string and all three looked right in isolation:

| | what it used | result |
|---|---|---|
| migration 0012 | the **VALUE** | rows and CHECK both `'DAILY_PULSE'` |
| the ORM | the **NAME** | every INSERT sent `'daily_pulse'` |
| pydantic | the **VALUE** | the HTTP contract has always been uppercase |

A **migrated** database therefore rejected every session the application tried to create,
while a **`create_all`** database — built from the NAMES — accepted them happily. The entire
test suite runs on `create_all`, so 1089 tests passed against a schema that does not exist in
production.

**Why D-055's guard did not catch it.** `test_the_migrated_schema_matches_create_all` compared
constraint **names** and presence. `ck_sessions_session_type_enum` is present, and identically
named, on both schemas — carrying different values. The test is now value-aware, and its
regex was checked against a real `create_all` schema to confirm it extracts values rather than
matching nothing and passing vacuously.

**The fix** is one argument on the shared `_enum()` helper — `values_callable` — making
SQLAlchemy use the value everywhere. The blast radius was measured, not assumed: `SessionType`
is the **only** enum in the module where name and value differ, so this is a no-op for all
fourteen others and changes exactly the one that was wrong. No data migration is needed:
production already holds the uppercase values, which is what the ORM now writes.

**Order of discovery matters here.** Deploying the schema before the code was safe for the
eight additive migrations and unsafe for the two that rewrite values (0012, 0015): the old
build could not read `LOCKED`, and `/patients` 500'd until the new build landed. "DB-ahead-of-
code is harmless" is true only for additive migrations, and both of this chain's
value-rewriting migrations disprove it.

---

### D-058 — value-rewriting migrations must ship WITH their code; additive ones need not

**2026-08-30. Learned by taking production down for about fifteen minutes.**

Migrations in this repo fall into two classes, and they have opposite deploy requirements.
Until this deploy the distinction was never written down, and the reasoning that felt obvious
at the time — "the database being ahead of the code is the safe direction" — is true for one
class and false for the other.

**ADDITIVE** — new tables, new nullable columns, widened CHECK constraints. `0013`, `0014`,
`0017`, `0018`, `0019`, `0020`. Old code does not select the new columns and does not write
the new values, so a database ahead of its code is genuinely harmless. Deploy in either
order.

**VALUE-REWRITING** — migrations that change the strings already stored in existing rows.
`0012` (`daily|weekly|monthly` → `DAILY_PULSE|COMPREHENSIVE|MONTHLY|ASHA_VISIT`) and `0015`
(`locked` → `LOCKED`). **These must deploy together with the code that understands the new
values.** Either order alone breaks the running application:

- **schema first** — the old build cannot READ its own rows. This is what happened: the
  deployed `BaselineState` enum knew only `locked`, the migrated rows said `LOCKED`, and
  `/patients` and `/clinic/patients` returned 500 until the new build landed. `/health` stayed
  green throughout, because it only pings the connection.
- **code first** — the new build cannot WRITE. It sends values the old CHECK rejects.

**The rule.** Before deploying, classify every migration in the chain. If any rewrites values,
the deploy is not "run migrations, then push" — it is a coordinated release, and the window
between the two halves is an outage. Either take the brief outage deliberately and knowingly,
or stage the change across two releases (widen the constraint to accept BOTH spellings, deploy
code that reads both, migrate the data, then narrow) — which is what `0012` and `0015` already
do internally for the constraint, and what neither does for the application.

`/health` returning `database: up` is not evidence the application works. It proves a
connection, nothing more. The check that would have caught this in seconds is one authenticated
read of a patient-scoped route.

See also **D-057**, found immediately afterwards: the same deploy was still broken for session
CREATION for a completely independent reason, which the recovered `/patients` route did not
reveal.

---

### D-059 — leaving a session keeps the data and forfeits the score; going back is view-only

**2026-08-31.** Patients could not exit a check-in once it started, and could not look back
at what they had done. Both are now possible, with semantics that are not negotiable.

**EXITING.** The session is stored with everything captured so far — the family should see a
check-in was started, and adherence should count the attempt — and it is excluded from every
baseline and from scoring. `completed=False` is the whole mechanism; the pipeline already
filters on it, so exiting is not a special case the engine has to know about. It is just a
session that never finished.

The reason it must be excluded is INV-14. `session_position` and
`elapsed_seconds_at_task_start` exist because a module's baseline absorbs its own place on
the fatigue curve. A truncated session is a different measurement condition, and blending
the two widens a module's normal range until real drift stops standing out. `is_practice`
(0009) already establishes exactly this shape for a different reason.

**GOING BACK is view-only, and the restriction is the feature.** A patient who feels they
performed badly wants another go. Allowing it freely would teach each module's baseline the
patient's BEST attempt rather than their typical one, so genuine decline would have to be
worse than their best-ever day before anything fired. That is the same reasoning that caps
retries at two and discards the first three sessions. The "I did that wrong" need is already
met inside the step, by the two-retry rule, at the moment the capture actually failed its
quality check.

`taskFlow.mayCapture()` is the single guard: no capture component exists in the tree while
an earlier step is on screen, so there is no code path by which a completed step can be
discarded and retaken.

**No migration.** `completed` already distinguished finished from unfinished; the step counts
live in `device_info`. A real `abandoned_at` column is the right move if anything ever needs
to FILTER on abandonment — JSON is the right place for it exactly as long as nothing does.

### D-060 — the guided tour is in-house, and not because of bundle size

**2026-08-31.** `react-joyride` was evaluated properly: v3.2.0 bundles to **26.8 KB gzipped**
(77.9 KB raw, React excluded) and brings **ten transitive dependencies**, measured by
bundling it rather than quoting a figure. Against a 104 KB main bundle that is a quarter
again, and ten more packages in the SBOM of a medical PWA. Arguable either way.

What settled it is architectural. Joyride's central mechanic is a **modal spotlight** — a
full-screen overlay that blocks everything except the highlighted element. This product
guarantees that the FAST and emergency paths are always reachable. Someone having a second
stroke during a first-run tour must be able to hit the emergency button. Making Joyride safe
here would mean overriding its main abstraction on every screen it appears on, and a safety
guarantee that depends on successfully fighting a library is not one to rely on.

The in-house tour never blocks anything: it outlines the target and captions it in a bar
while the page underneath stays fully interactive. It is markedly less capable — no scroll
management, no repositioning — and it cannot fail in the way that matters.

(If this is revisited: v3 removed the default export, so most Joyride examples in
circulation are v2 and will not compile against it.)

### D-061 — the questionnaire is recorded at its positions and submitted at the end

**2026-09-02.** `StepQuestions` asked the two PHQ-2 questions and the medicines question in
one component and then called `submit()`, which finalised the whole session. Under the
original 21-step order those were positions 19-20, so the cost was one skipped step (PPG at
21). D-044 then moved the six Daily Pulse modules to positions 1-6 in BOTH session types —
correct for the fatigue curve — and the same component at position 5 now ended every
Comprehensive session with twelve steps left. Nothing local could see it: the plan parity
test checks the step list, not what the runner does with it, and the demo data is seeded.

The answers are now recorded into the session store at positions 5 and 6, each at its own
protocol position, and submitted with the modules at the end (`submitQuestionnaire`,
`submitAdherence`, then `finalizeSession`). Only what was actually answered is sent: a
skipped question is not "never", and a skipped medicines check is not "not taken" — the
old skip path posted `[]` and `false`. The offline queue carries the answers the same way.

No schema change. Sessions finalised before this are unaffected; they simply contain
fewer positions.

### D-062 — the session clock starts at the first chapter, not at plan load

**2026-09-02.** `elapsed_seconds_at_task_start` is recorded on every module so a task's
place on the fatigue curve is visible. It was measured from the moment the plan loaded,
which included the time the patient spent reading the first instruction and, now, the
welcome and warm-up. The warm-up records nothing and is skippable, so its length varies;
counting it would put the same physiological moment at different elapsed times on
different days for no clinical reason.

The clock now starts when the first chapter begins (`beginSession`). Reading time between
steps — the chapter intros — still counts, as instruction-reading time always has. After a
reload the clock resumes from the saved ACTIVE time and the next task is recorded
`paused_before_task`, exactly as the pause button records it (`lib/journeyStore.ts`).

### D-063 — the check-in is presented as one path with chapters; the protocol is untouched

**2026-09-02.** Five concepts were scored against clinical appropriateness, cognitive load,
accessibility, cost, scalability across eighteen heterogeneous tasks, emotional comfort,
older-adult fit, mobile, performance and consistency with the blue/white no-gradient
system (`docs/superpowers/specs/2026-09-02-journey-experience-design.md`, §D–F). A path of
lights won: it is static (this product screens for vertigo, so no parallax and no drift),
abstract and adult, draws with one SVG and at most eighteen circles, and the dark
oculomotor field — already the most striking screen — becomes its centrepiece instead of an
anomaly. The tasks that respond to a stimulus *are* lights: tap it, follow it, hold it.

What the journey is: screens shown between and around positions (welcome and warm-up,
chapter intros with a rest offer, welcome-back after a reload, the end), a shell that stays
put while the scene inside changes, an instruction that is spoken and repeatable, and
three comfort switches the patient owns. Chapters are derived from the runnable steps BY
TASK (`lib/journey.ts`), not by clinical block — the six Daily Pulse modules span three
blocks — and a chapter boundary is a screen, never a change to a position.

What it is not: no stimulus, timing, randomisation, threshold, scorer or position changed.
Two behavioural changes came with it and are D-061 and D-062. The two-retry rule, the
neutral ending, the always-visible pause and exit, view-only back (D-059) and the
structural fall gate are unchanged and still pinned by `taskFlow.test.ts`.

Deliberately not done: sound design beyond speech (no audio assets — a tracked binary trips
INV-11's scanner, and a required sound would exclude the people speech already serves),
WebGL or canvas of any kind, and a countdown that reads as a deadline — the ring fills.

### D-064 — the sign-in screen's neural field is a canvas, not a WebGL library

**2026-09-02.** The authentication screens were rebuilt around a neuroscience visual: a
network of nodes on a brain-shaped shell in three dimensions, joined to their nearest
neighbours, with signals travelling the joins and the whole thing responding to the form —
attentive when a field has focus, structured on the password, busy while the server checks,
converging once signed in. It is drawn with `CanvasRenderingContext2D` and a
four-multiplication perspective projection (`frontend/src/lib/neural.ts`, tested;
`components/auth/NeuralField.tsx` draws). Three.js was considered and rejected on the same
grounds as D-039 rejected GSAP: ~150 kB gzipped for a hundred dots and a few hundred
lines, on a bundle that shares a service worker with a clinical PWA precaching a 4 MB model.

The gating is clinical, not taste. D-038 already says parallax is a documented trigger for
people with vertigo, who are in scope; the sign-in screen is a signed-out surface but a
patient uses it every morning. So: no pointer tilt on coarse pointers, one static frame under
`prefers-reduced-motion`, at most 30 fps on a phone, nothing drawn off-screen or in a
background tab, and zero nodes on ≤2 cores or Data Saver. The palette is the token blue on
white — alpha and radius carry depth, no gradient, no shadow (index.css's rule holds). It is
`aria-hidden`, the caption says it measures nothing, and the form never depends on it: with
`getContext` returning null the page is the same form without a picture.

### D-065 — sessions stay bearer tokens; the refresh token is now rotated and revocable

**2026-09-02.** Moving to HttpOnly cookies was considered and not done. The API and the
app are on different origins (Railway, Vercel), so a cookie session means `SameSite=None`,
credentialed CORS, and a CSRF token on every mutating route — a second authentication
architecture, for a gain that a CSP mostly delivers on its own. The tokens stay in
`localStorage` behind a `Content-Security-Policy` that allows scripts from the app's origin
only (`frontend/vercel.json`; MediaPipe needs `wasm-unsafe-eval` and blob workers, verified
under the policy with both models loading and zero violations).

What changed instead, server-side (`backend/app/routers/auth.py`, migration `0023`): every
refresh token is recorded by `jti`; `/auth/refresh` rotates it and refuses a token already
used — a replay revokes every live token of that account, because a token presented twice
has been copied; `/auth/logout` revokes; `/auth/password` re-hashes and revokes every other
session. Login, register and refresh are rate-limited in memory (correct for
`railway.json`'s single replica; Redis when that changes). The dev JWT secret refuses to
boot outside `development`/`test`. Client-side, a refresh the server rejects now tells the
provider (`AUTH_EVENTS`), so the shell signs out instead of failing every request until a
reload; a refresh that cannot reach the server does NOT sign out — an offline patient stays
signed in, which the airplane-mode demo depends on.

---

## Awaaz contract-foundation branch — decisions D-066 … D-077

Merged from `anish/awaaz-contract-foundation` on 2026-09-02. **These twelve decisions were
renumbered on integration.** The branch was cut before `main` reached D-057, and both lines
then used D-054 and D-057..D-067 for entirely different decisions — `main`'s D-057 is the
ORM/migration enum split, the branch's D-057 was the logging-policy refusal. Keeping both
would have put two different decisions under one number, which is the one thing this file
cannot afford.

`main`'s numbering is authoritative and unchanged. The branch's decisions were moved up:

| on the branch | here |
|---|---|
| D-054 | **D-066** |
| D-057 | **D-067** |
| D-058 | **D-068** |
| D-059 | **D-069** |
| D-060 | **D-070** |
| D-061 | **D-071** |
| D-062 | **D-072** |
| D-063 | **D-073** |
| D-064 | **D-074** |
| D-065 | **D-075** |
| D-066 | **D-076** |
| D-067 | **D-077** |

D-061 … D-065 are deliberately left free: the unmerged `feat/journey-experience` branch
already carries decisions under those numbers, and renumbering the branch being integrated
is cheaper than renumbering one that is already written and verified.

Cross-references inside the Awaaz planning documents (`PENDING_WORK.md`, `PRD_AWAAZ.md`,
`PLAN_RL.md`, `RESEARCH_OPE.md`, and the model cards) still cite the ORIGINAL branch
numbers. They are resolvable through the table above; they were left alone deliberately,
because those same numerals also name `main`'s own decisions in the shared documents and a
blind sweep would have silently rewritten the wrong ones.

---
**D-066 · 2026-08-29 · Offline board access is a user-bound snapshot, not stale authorization.**
Emergency speech already survives a dead backend, but normal phrase tiles disappeared and
left a person with only the red crisis path. A successfully authenticated board load now
saves its text/profile snapshot in a separate origin-scoped IndexedDB store keyed by both
the authorized user and patient. Only a transport failure (`status=0`) may recover it. A
401, 403, or 404 is an authoritative access decision and clears the board even when an
older snapshot exists; patient ID alone is never treated as possession of the cache.

The snapshot does not make network state changes offline. Phrase taps remain available
because the person explicitly chose those words, but the UI states that browser speech was
only attempted and the tap was not saved. Free text, practice capture, settings, phrase
editing, and listener-capability actions are disabled until reconnection, while local
emergency setup and deletion remain local. The installed browser voice is not promoted to
the same guarantee as the caregiver-recorded emergency WAV: only the latter has a playback
receipt and self-test proving it started on that device.

*The five entries below were first written as D-055 through D-069 and renumbered to
D-067 through D-071 once `main` was fetched and found to have already taken D-055 and D-056.
The commit messages on this branch were already pushed and still cite the original numbers:
their D-055 is this D-067, their D-056 is D-068, and their D-067 — the governance-receipt
decision — is D-069. Recorded because a reader following a commit reference would otherwise
land on somebody else's decision.*

**D-067 · 2026-08-31 · A logging policy that did not randomise is refused, not estimated.**
The offline comparison in `app/ml/rl/` previously accepted a log in which the behaviour
policy assigned probability 1.0 to the action it took, and returned
`candidate_better_offline` with a tight confidence interval. That answer was not merely
optimistic, it was unidentifiable: under π₀(a|x)=1 no alternative action was ever
observable, positivity fails, the importance weight collapses to π(a|x), and
self-normalised inverse propensity scoring reduces to a re-weighted average of the same
logged actions, so the bootstrap interval measures reward noise and nothing
counterfactual. An unidentifiable comparison presented as a strong positive is the worst
failure this module can have, because it looks like evidence.

The gate is a rate rather than an any-1.0 test. A genuinely randomising logger can
legitimately emit a certainty — a slate that screening left with one option, a hard
tie-break — and an occasional certain event carries no information without invalidating the
log. More than `max_deterministic_event_rate` (default 10%) of events at or above
`deterministic_probability_threshold` (default 0.999) now returns the blocker
`logging_policy_is_deterministic` and no estimate at all.

The same reasoning made two other things non-negotiable. `EvaluationConfig` remains tunable
but only toward strictness: absolute floors in `__post_init__` mean a reviewer can demand
more events or a larger minimum effect, and nobody can construct a config that accepts a
two-event comparison. And `deployment_allowed`, `online_experiment_allowed` and
`clinical_claim_allowed` became read-only properties that always return false rather than
fields, so no caller and no `dataclasses.replace` can produce a result object that appears to
grant deployment.

**D-068 · 2026-08-31 · The ASR training stack is optional and never an API dependency.**
`app/ml/train/asr_runtime/` needs torch, transformers and peft. Putting those in
`requirements.txt` would make roughly 2.5 GB of wheels a dependency of a web server that
never calls them and would couple every Railway deploy to a stack only an offline training
host uses. They live in `requirements-train.txt`, which is deliberately not part of
`requirements.lock.txt` and has never been installed or verified in this repository — the
pins there satisfy the minimums the runtime enforces, and are a starting point to be checked
on the first real training host rather than a tested lock.

The separation is enforced in code, not by convention. The heavy packages are pulled in
through `importlib` inside `_load_ml_runtime()`, which runs only after every governance and
data gate has passed, so importing `app.ml.train.asr_runtime` and booting the FastAPI app
both load zero heavy modules. numpy is deliberately absent from the training requirements: it
is pinned at 1.26.4 for the mediapipe 0.10.14 wheels on the numpy 1.x ABI, and a resolver
that upgraded it to satisfy a torch build would break FaceMesh in a way that surfaces as a
segfault in the face pipeline rather than as anything about training.

**D-069 · 2026-08-31 · Training is gated on a receipt that does not yet prove governance.**
Real adapter training refuses to start without a signed, purpose-specific receipt naming the
patient, the archive hash and the base-model hash, and every one of those is compared with a
constant-time check before any media is read. This is the right shape: the expensive mistake
is training on a corpus nobody approved, and the cheap one is a job that will not start.

The receipt is a symmetric HMAC, `governance_receipt_signature` is exported public API, and
the pinned trust root comes from environment variables the same operator sets. So an
operator can mint their own approval, and what the signature actually proves is possession
of a key the training host already holds — not that a reviewer looked at anything. This is
recorded here rather than quietly relied upon, because the entire fail-closed design leans
on that one artifact. The fix is an asymmetric scheme, Ed25519 with the public key pinned in
tracked config, so signing authority and running authority are different capabilities. Until
then no receipt should be described anywhere as evidence of approval.

**D-070 · 2026-08-31 · Private corpora and model artifacts are gitignored by allow-list.**
The rules for `data/` and `artifacts/` were deny-lists, and a deny-list of a category this
open fails the moment someone adds a filename nobody thought of. It already had:
`data/raw/` and `data/exports/` were ignored while `data/mpower/` was not, even though the
asymmetry trainer's own docstring tells you to put real mPower records there; and under
`artifacts/**` a rule that enumerated weight extensions left a patient `.wav`, a `.gguf`, a
`tokenizer.json` and any README stageable inside a per-patient adapter directory. A patient
WAV under `artifacts/` is precisely the INV-1 failure this repository exists to prevent.

Both directories are now ignored wholesale and the reviewed files are named back in:
`data/README.md`, and the five `*.metrics.json` fixtures. Subdirectories stay ignored
entirely, because git does not descend into an excluded directory, so a per-patient adapter
directory cannot be re-admitted by accident. Awaaz export matching was widened at the same
time, since a rule that knew only about `.tar` let `.tar.gz`, `.tgz` and `.zip` through. The
inversion was checked against the tracked file list so that no file already under version
control was dropped.

**D-071 · 2026-08-31 · Model cards are generated except one hand-written section.**
The claim that the model cards could not drift was written in this repository before any
generator existed, which is exactly the kind of unsupported statement the documents are
supposed to catch. `python -m app.ml.train.render_model_cards` now renders each card from
its `artifacts/<model>.metrics.json`, `--check` exits 1 on a stale card, and a test
re-renders all five and compares byte-for-byte, so every number, split description and
limitation in a card comes from the artifact rather than from someone's memory of it.

Purpose could not be generated, because it is the one part of a card that explains what the
model is for and why it is allowed to exist, and a metrics file does not contain that. It is
hand-written between `<!-- hand-written: purpose -->` markers and carried through untouched;
a card missing the markers fails closed rather than being regenerated without its prose. The
honest statement is therefore narrower than the one it replaces: the generated body cannot
drift, and the Purpose section still can, because nothing generates it.

**D-072 · 2026-08-31 · The policy-event log has no patient column and no foreign key.**
`awaaz_policy_events` is the first table in this schema that does not hang off `patients.id`.
That is the decision, not an omission. A row that can be joined to a patient is a per-person
record of what that person tried to say and which of the machine's guesses they refused, and
an offline UX estimate does not justify keeping one. The cost is real and is stated wherever
the table is described: without a patient column there is no patient-level split before
fitting, so the repeated-speaker dependence in `offline.LIMITATIONS` cannot be addressed from
this log, and cohort or subgroup work on this table is not possible at all.

The same reasoning fixes the time column. `logged_on` is a DATE rather than a timestamp
because a microsecond timestamp would join effectively one-to-one onto `audit_log.ts` and
`utterance_log.ts`, both of which do carry `patient_id`; the join would hand back the exact
identifier the table was built without, and no column of this table would have had to name a
patient for that to happen. A day is the coarsest granularity that still supports a retention
or deletion sweep, and it is indexed for that purpose only. For the same reason the two audit
rows the router writes record the actor, the patient, the policy id and the consent fact but
deliberately omit the event id and every candidate id, so the audit trail stays a many-to-many
neighbour of the log rather than an exact join key into it.

The table is append-only (INV-8): the sampled decision waits in process memory until the
interaction finishes, so the outcome is known before the single INSERT and no code path
updates or deletes a row. A restart drops pending decisions and those events are never
logged, which is the correct direction to fail — losing an observation is recoverable,
inventing one is not. The decision endpoint refuses without a purpose-specific
`policy_logging_consent` flag per PRD §10.2, and the outcome endpoint carries no consent field
of its own because it can only close a decision that already passed that check; both are
idempotent in either direction.

One merge hazard is recorded here rather than discovered later. The migration's revision id
is the descriptive `0014_awaaz_policy_events` rather than `0014`, because `main` already
carries a different migration claiming revision `0014`, and this branch and `main` have
independently used 0012, 0013 and 0014 for unrelated changes. Two revisions sharing an id do
not merge; alembic resolves one and silently loses the other's ordering. A unique id makes
this a branch point that can be told to merge instead of a collision nothing can see. The
overlapping ids on the other three numbers are still unresolved and will need attention when
this branch meets `main`.

**D-073 · 2026-08-31 · Randomisation is bounded to near-ties and confined to confirmation.**
IPS and SNIPS are unidentifiable under a deterministic logger, and `compare_policies` refuses
such a log outright (D-067). Refusing bad logs is not the same as being able to produce good
ones, so the ranker now samples which near-tied candidate it shows first and records the
probability of the action it actually showed. That is the only way a product event can ever
carry a usable denominator, and it is a change to what a patient sees, so it is bounded three
ways rather than tuned.

A candidate is explorable only when its score is within `NEAR_TIE_MARGIN` (0.05) of the best
score. A clearly-better candidate is therefore never displaced — not rarely, never, because a
worse candidate is assigned probability zero and cannot be drawn. Each of at most two
alternatives carries a flat `EXPLORATION_EPSILON` of 0.08 and the top-ranked candidate keeps
the remainder, so it holds at least 0.84 in the widest configuration the bound permits and
`ExplorationBound` refuses any configuration leaving it below 0.75. Flat-per-alternative
rather than epsilon-split-k is deliberate: a split shrinks as the slate grows and would push
propensities under the estimator's own `MIN_LOGGED_PROBABILITY_FLOOR`, where a single event
becomes a hundredfold weight.

The third bound is where the safety argument actually lives. The decision endpoint refuses to
randomise unless the caller declares the slate goes to the confirmation loop. Reordering
options a person is about to read and choose between is a presentation change they override
with a tap; reordering something that will be spoken without confirmation would be
exploration on a disabled person's mouth, which INV-9 forbids and which no offline estimate
is worth. The emergency flow is never ranked and never reaches this code.

This is not online learning and must not be described as such. Nothing reads the logged rows
at runtime, no model is fitted from them, and no ranking adapts from feedback. The
distribution is a fixed function of scores the ranker already produced, and the rows exist so
that a human can later run an offline comparison.

**D-074 · 2026-08-31 · No cluster key is added; the clustering bias is made unmissable.**
The reported interval comes from an event-level i.i.d. bootstrap, and Awaaz events are not
i.i.d.: one speaker contributes many correlated events, so under positive intra-cluster
correlation the true interval is wider than the printed one and the error runs in the
optimistic direction — towards declaring the candidate better, which is the one direction
this package exists to prevent. The textbook repair is a cluster bootstrap, which needs a
per-speaker key. `docs/RESEARCH_OPE.md` §3.2 makes the case for one.

We are not adding one, and the reason is not convenience. A grouping id that is stable across
one speaker's events IS a pseudonymous patient identifier. The property that makes it useful
for clustering — that all of one person's events collide — is exactly the property that makes
it a re-identification handle, and no hashing, salting or truncation separates the two, since
a per-event salt would destroy the very collisions the cluster bootstrap exists to exploit.
"Opaque but stable per person" is a distinction of presentation, not of function, and INV-11
is about function.

So the limitation is not repaired; it is made impossible to skip. It is the FIRST entry of
`offline.LIMITATIONS`, it names the direction of the bias rather than hedging, it is repeated
in `IMPROVEMENT_DOES_NOT_GUARANTEE` so it travels on the decision object a reviewer reads,
`UNCERTAINTY_BASIS` states the resampling scheme on every result, and
`clustered_uncertainty_available` is a read-only property that is permanently false. A reader
cannot obtain the verdict without the terms. Correcting this properly is a logging-contract
and governance decision — `PLAN_RL.md` steps 3 to 5 — and not a change the estimator may make
on its own authority.

**D-075 · 2026-08-31 · The phrase board is a safety fallback, not the worst reward available.**
`rewards.score_logged_action` charged the repair cost for a `phrase_board_fallback` on top of
the negative preference the fallback already earned, so a fallback scored −1.0 while a plain
rejection scored −0.8. Using the phrase board was therefore the single most negative outcome
the reward function could assign. The phrase board is the designed safety route: PRD §20
lists it as the mitigation for the device-performance risk and §22 makes offline phrase-board
operation a condition of done. The reward function was pointing the ranker at keeping a
patient wrestling with poor candidates rather than letting them reach the board that exists
to protect them — optimising against the product's own safety design.

Repair cost now applies only to a correction, where the patient engaged with the candidate
and then had to fix it, which is real interaction cost that the reward should see. Fallback
and rejection both score −0.8. This is a correctness fix, not a weight change: no tuning of
`RewardConfig` could have removed the inversion, because both terms fired on the same event.

It is recorded as a decision rather than a bugfix line because of how it was found. Nothing
optimises this reward today, so nothing had exploited it and no test failed. It surfaced only
from writing the literature brief in `docs/RESEARCH_OPE.md` and tracing the reward by hand
for each outcome value (§7.4). A reward function nobody is currently optimising is exactly
the kind of code that is never read adversarially, and that is the argument for reading it
adversarially before something does.

**D-076 · 2026-08-31 · Doubly robust is opt-in in both directions and never the headline.**
PRD §11 defers doubly-robust estimation until a separately validated outcome model exists.
That deferral is now enforced by the type system rather than by prose. The doubly-robust path
accepts an outcome model only as a `ValidatedOutcomeModel`, which cannot be constructed
without an `OutcomeModelValidation` whose six fields all lack defaults, so
`OutcomeModelValidation()` is not a sentence anyone can write by accident; the gate then
refuses a non-grouped split, a model fitted on the evaluation events, a holdout below fifty
events, and a calibration error above 0.25, and those two constants take no configuration
because there is no reviewer who may reasonably demand less evidence before a reward model is
allowed to stand in for observed rewards.

The request is symmetric and a mismatch blocks the whole comparison. Asking for doubly robust
without a model must not quietly return a SNIPS number under a DR heading, and supplying a
model without asking must not switch the estimator underneath a caller who did not request
it; neither confusion has a safe default, so neither gets one. SNIPS stays the headline
structurally rather than by convention: `headline_estimator` is a read-only property
returning `snips` and the diagnostic's `role` is a read-only `secondary_diagnostic_only`.
Neither is a constructor parameter, so no caller and no `dataclasses.replace` can promote the
diagnostic. If the two numbers disagree, that disagreement is the finding, and the response
is to improve the outcome model and re-review rather than to relabel which number was
primary.

Two related tightenings landed under the same reasoning. Support deficiency is now detected
rather than assumed absent — `overlap_rate` measures whether the candidate covers the logger,
which is the opposite question, so a separate quantity flags candidate mass sitting where the
log provably could not have looked, gated at 2% by default under a 10% ceiling. What it
computes is a provable lower bound on support deficiency, not a measurement of it: a zero
means "nothing provable", never "nothing there", and the exact quantity needs slate-wide
propensities the contract does not yet record. And the improvement criterion is no longer the
single inequality `lower > minimum_effect`. It now requires the interval's lower bound to
clear the minimum effect, the point estimate to clear it too, and the improvement to survive
deleting the single most influential logged event — because a self-normalised ratio with one
dominant weight is that event's reward with extra steps, and a bootstrap that redraws that
event in most replicates carries its influence in the body of the distribution rather than in
the tail where anyone would look for it.

**D-077 · 2026-08-31 · Supersedes D-069: the governance receipt is Ed25519, not an HMAC.**
D-069 recorded that training was gated on a receipt that did not actually prove governance,
because the scheme was a symmetric HMAC, the signing function shipped with the package that
verified it, and the pinned trust root arrived in environment variables the training operator
set. It closed by saying no receipt should be described anywhere as evidence of approval
until that changed. It has now changed, and D-069 is superseded rather than edited.

Receipts are Ed25519. Verifying no longer confers the ability to sign, and
`governance_receipt_signature` is gone from the shipped package entirely — the thing that
checks an approval no longer carries the thing that mints one. The public halves live in a
tracked `governance_public_keys.json` located by a module constant, never an environment
variable and never a command-line argument, so the trust root cannot be swapped without a
reviewed commit. Both halves were necessary: Ed25519 alone would have left the operator free
to generate a keypair and point the runtime at their own public key, which is the same bypass
in a better algorithm.

The file ships with no keys, so the runtime refuses every real command with
`governance_trust_root_missing`. That is the correct state and not a placeholder to be
cleared casually: adding a key is a governance act, and whoever can run training must not be
the person who commits it, or the boundary the file exists to create is defeated. The
procedure for a clinical owner to generate a keypair offline and publish only the public half
is in `docs/GOVERNANCE_KEYS.md`. What remains open is custody, not code.

**D-078 · 2026-09-03 · `docs/` stays flat. The index is the navigation, not the directory
tree.** Thirty-nine documents in one directory is a fair complaint, and the obvious fix —
group them into `product/`, `clinical/`, `engineering/`, `ml/` — was measured and rejected.
The cost is 170 `docs/X.md` references across the repository plus roughly a hundred sibling
mentions inside the documents themselves, and three tests that depend on exact paths under
`docs/`: `test_regulatory_claims.py` (its allowlists and its `docs/**.md` scan scope),
`test_privacy.py` (`CLINICAL_DOCS`) and `test_train.py` (model cards). Mechanically
rewriting all of that is possible; doing it across the corpus a stranger is meant to resume
from, to gain what a grouped index gives for free, is not a trade worth making.

So the rule is: **living reference documents sit flat in `docs/`, and a subdirectory means
one specific thing** — `plans/` is work not yet landed, `models/` is generated output,
`archive/` is history. `docs/README.md` carries the grouping instead, as an index of what
each document answers. If you are adding a document and it is none of those three things, it
goes flat.

The reason to record this rather than leave it implicit: a flat directory of thirty-nine
files reads like neglect, so the next person to look at it will reach for exactly the
reorganisation rejected here. It was not neglect, and the index is where the effort went.

**D-079 · 2026-09-03 · `docs/archive/` is not a claim-bearing surface, and that is a
preservation, not a relaxation.** Moving five executed briefs and run reports from the
repository root into `docs/archive/` swept them into `_claim_bearing_files()`, which matches
`docs/**.md`. Three tests failed immediately — the ninety-second figure (D-045), a
capability overclaim, and an unlabelled accuracy figure.

Every hit was the corrected claim being *recorded*: `~~still say "90-second"~~ **DONE**`;
the original brief's own `DAILY PULSE — target 90 seconds`, which is the line D-045 later
corrected; "*diagnosing* an imaginary deadlock", about a software deadlock; and a quoted
*published* VNG reference range. Keeping the archive in scope would mean deleting the
correction's own history to keep a test green, which is what `STALE_DURATION_HISTORICAL_OK`
already calls "the opposite of what D-045 is for" when it allowlists `docs/PRD.md` §7.

`docs/archive/` is excluded from `_claim_bearing_files()`, and `docs/LANDING_DESIGN_SPEC.md`
(previously `design.md`, at the root) joins `STALE_DURATION_HISTORICAL_OK`.

**The coverage is unchanged.** All five files were at the repository root until today, where
`_claim_bearing_files()` never reached them either — it matches `docs/**.md`,
`frontend/src/**`, and two named READMEs, and nothing else. No file that was scanned before
stops being scanned. The strict INV-13 scan is untouched and still walks every tracked file
honouring only `DOCUMENTATION_ALLOWLIST`: five of the six files under `docs/archive/` remain
in it, and the sixth was already allowlisted before this session for quoting the banned
phrasing in order to forbid it.

This is written down because "a refactor made three invariant tests fail, so the invariant
tests were narrowed" is the shape of a genuinely bad change, and the only thing separating
this from that shape is the fact that the files were never in scope to begin with. Check
that claim before trusting this entry — the two file sets are cheap to evaluate.

**D-080 · 2026-09-03 · The doctor-in-the-loop baseline gate needed a frontend before it was
a gate. Without one it was a trap.** Part 3.3 made a completed baseline produce a *request
for review* rather than a lock, and the backend implements that correctly:
`_refresh_baseline_state` moves a patient to `DOCTOR_REVIEW_PENDING` once every module
locks, bands and alerts are suppressed while the state is not `LOCKED`, and `record_review`
is the only exit. `PROGRESS.md` recorded the missing review UI as "a follow-up commit".

It was not a follow-up. It was the difference between a demo and a product. `record_review`
is reachable from exactly one route, `POST /clinician/baseline/{id}/review`, and **nothing
in the frontend called it** — `api.ts` had no baseline method of any kind. So a real patient
completed twelve or more sessions, entered `DOCTOR_REVIEW_PENDING`, and stayed there
permanently: never monitored, never alerted on, with no screen anywhere able to move them
out. The caregiver's dashboard rendered every non-`LOCKED` state through one card, so what
they saw was "baseline progress 12 / 12" with the bar pinned at 100% — forever — and the
identical card for a baseline that had been `ABANDONED`.

**Every suite was green throughout, and the demo worked.** It worked because
`services/seed.py` calls `record_review` in Python. The only exercised path skipped HTTP
entirely, so the one route that mattered was covered by route tests and reachable by nobody.
That is the shape worth remembering: a route with no caller is invisible to `tsc`, to
`vitest`, and to `pytest` at once, and no amount of green says otherwise.

What landed: `BaselineReviewPanel` (the three actions the server accepts, the per-module
evidence including `cadence_note` so a Comprehensive-only module's ~6 observations are not
misread as thin data against a Daily Pulse module's ~21 — D-043/D-044, the server's own
synthetic-model disclosure, and the previous-decision log), the caregiver-facing
`BaselineStatusCard` that separates awaiting-review and abandoned from still-collecting in
all three languages, and a roster badge plus a corrected metric on `Clinic.tsx` — that
metric counted every non-`LOCKED` patient under an "awaiting review" caption, folding
patients who were waiting on nobody into a clinician's own queue.

`CONFIRM` is the only action whose consequence is spelled out, because it is the only one
that is irreversible and the only one that starts monitoring. A note is required for
`EXTEND` and `FLAG_CONCERN` and optional for `CONFIRM`, matching `record_review` exactly —
demanding prose for the common action is how a clinical gate becomes a box someone types
"ok" into.

`frontend/src/lib/baselineGate.test.ts` pins reachability. Its client-method assertions run
against the **exported `api` object**, not the source text: the first draft used
`toContain("submitBaselineReview")`, which still passed after the method was renamed to
`submitBaselineReviewXX` — a reachability test that cannot detect the method disappearing
is decoration. The mutation was run both ways before the test was kept.

**D-081 · 2026-09-03 · `app/ml/scoring.py` and `app/ml/face.py` are deleted, and INV-1 is
now structural on the face path too.** Both had zero callers outside their own tests, and
both were actively dangerous to read.

`scoring.py` was a second, complete alert implementation — bands, a sustained-deviation
window, a cross-modality requirement — with **no laterality gate at all**. It would raise an
`ALERT` on exactly the symmetric Parkinsonian decline that INV-2 and `engine/gates.py`
exist to keep out, and it did so in seventy well-commented lines that read like the product.
Its acceptance test, `test_alert_gate_sim.py`, was labelled the PRD §7 criterion — zero
false alerts across a stable week — and verified it against the dead implementation.
`test_engine.py` and `test_laterality.py` already cover the same criterion against the live
gate (`test_quiet_sessions_are_stable`, `test_two_domains_sustained_is_alert`,
`test_two_domains_sustained_without_laterality_is_not_an_alert`), which is why deleting the
sim test loses no coverage. This was checked before it was deleted, not after.

`face.py` took a **video path** and opened it with OpenCV. Server-side media processing is
the exact shape INV-1 forbids, and it was the sole reason `mediapipe`, `opencv-python` and
`protobuf` were runtime dependencies — and therefore the sole reason this backend was pinned
to Python 3.11 and numpy 1.x. Removing it does for the face path what removing
`python-multipart` did for uploads (D-052): the libraries required to process media on the
server are simply absent, so a future attempt fails at import rather than at review. `libgl1`
and `libglib2.0-0` are gone from the Dockerfile for the same reason, and so is its unused
writable `/app/media` directory.

`requirements.lock.txt` is left **stale and labelled stale** rather than hand-pruned. It is
a transitive freeze; editing it by hand to drop mediapipe's pulls without regenerating it
from a clean environment produces a lock that is wrong in a way nobody can see. The
Dockerfile installs from `requirements.txt`, so deploys are already correct.

`baseline.py`, `explain.py` and `reaction.py` are the same class of dead twin — superseded
by `app/engine/` — and are kept for now only because tests still exercise them. They are
labelled in `app/ml/__init__.py`. Do not build on them.

**D-082 · 2026-09-03 · Consent and erasure got the surfaces they were always missing, and
`PatientRead` had to stop rejecting its own tombstones.** Part 4 shipped seven independently
withdrawable consents and Part 5.4 shipped a real erasure. Neither had a caller. Consents
were only ever WRITTEN — by enrolment and by `POST /clinician/links`, which grants C3 in the
same transaction as the link — so a caregiver could grant clinician sharing by adding a
doctor and then had no way to see it, let alone withdraw it. `DELETE /patients/{id}` had no
caller at all.

`/privacy/:patientId` now lists all seven with their real state, and carries the erasure.
Three things it deliberately gets right:

**It does not claim enforcement it does not have.** Only C3 and C7 have a runtime gate —
`consent_currently_granted` is read by `clinician_may_access_patient` and
`caretaker_may_access_patient` on every scoped route, so a withdrawal bites immediately and
independently of whether the link row is still active. This was verified against a running
server, not assumed: withdrawing C3 with the link still ACTIVE dropped the demo clinician's
roster from 1 to 0 and turned `GET /dashboard/{id}` from 200 into 403, and re-granting
restored both. The other five are recorded decisions with nothing behind them, so their rows
say so and point at erasure, which is the control that actually removes data. Telling a
caregiver that switching off `DATA_PROCESSING` stops the processing would be a lie.

**Never asked is not consent.** `consent_currently_granted` returns false for a missing row.
An unchecked box alone could read as a default someone chose, so the absence is stated in
words. The demo seed makes this concrete: it grants C3 and leaves C1 and C2 with no row at
all, so the demo patient is monitored with no recorded consent to use the product. The screen
now says that rather than hiding it.

**The erasure confirmation is two deliberate acts, not a typed name.** "Type the patient's
name to confirm" is hostile to this cohort specifically: names are in Devanagari or Gurmukhi,
the phone keyboard is frequently set to English, and the person confirming is 55-75. It would
block the legitimate case far more often than the accidental one. A required reason plus an
explicit acknowledgement is two considered acts with no script trap, and the reason is stored
on the tombstone and in the audit row.

**The bug this work found is worse than the missing UI.** `erase_patient_data` sets
`patient.name = ""` — correct, because the honest value after an erasure is nothing rather
than a fabricated placeholder. `PatientBase.name` carried `Field(min_length=1)` and
`PatientRead` inherited it, so every route with `response_model=PatientRead` raised
`string_too_short` on that row. Because `GET /patients` validates the whole list, **one
erasure returned 500 for that caregiver's entire roster, permanently** — including patients
who were never erased. Erasing one parent's data would have bricked the other's card.

It survived because `test_erasure.py` proves the deletion by querying the database directly
and nothing ever listed the caregiver's patients over HTTP afterwards. It was found by
driving a real erasure against a running server. The constraint is right for input and wrong
for output — a read schema has to represent what the database legitimately holds — so it is
overridden on `PatientRead` only; `PatientCreate` and `PatientUpdate` still refuse an empty
name, and `test_erasure_roster.py` asserts all three. `erased_at` is exposed on the same
schema for the same reason: without it a client cannot tell a tombstone from a patient whose
name failed to load, and the roster rendered a permanently blank card.

**D-083 · 2026-09-03 · The Awaaz merge is integrated and working, except at one seam — and
the seam is deliberate.** Asked to confirm that main's line and the merged
`anish/awaaz-contract-foundation` actually work together, the whole surface was driven
against a running server rather than read.

**What works.** Migrations `0021`/`0022` apply clean to a single head. Every Awaaz read route
returns 200. The listener capability mints, is openable by an unauthenticated stranger,
carries the caregiver's chosen display name and **not** the enrolled patient name, and 404s
after revocation. The policy contract enforces both of its gates — 409 without explicit
logging consent, and 409 when `requires_confirmation` is false, because randomising a slate
that may be spoken unconfirmed is exploration on a patient's mouth. With both satisfied the
server draws the propensity itself (0.92 on a 0.90/0.88 near-tie, matching D-063's 0.05 band
and its ≥0.84 floor), the outcome write validates its own evidence, and a replayed outcome
returns the SAME row id rather than a second observation. The written row carries no patient
column and `logged_on` is a DATE, as designed.

**An earlier audit note in this session claimed the client never calls any of it. That was
wrong** — it grepped components for `awaazPolicyDecision` and missed the indirection through
`lib/awaazPolicyLog.ts`, which `Awaaz.tsx` imports and calls at ten sites covering slate open
and all five outcomes. The claim is corrected in `PROGRESS.md` and `CHANGELOG.md` rather than
quietly removed, because "no component calls this" is the kind of wrong that gets working
code deleted.

**The seam.** `/awaaz/{patient_id}/speak` returns `candidates: list[str]` — unscored, and in
practice exactly one, confirmed across five different inputs. `AwaazPolicyDecisionRequest`
requires two or more candidates each carrying the ranker's `score`. So
`scoredSlateFromSpeakResult` returns `null` unconditionally and no slate is ever opened:
the entire pipeline is built, wired, and inert, and `awaaz_policy_events` will not receive a
real product event until the speak contract carries per-candidate scores.

**This must not be "fixed" by inventing scores**, and the commit that built it (`42ac6dc`)
stopped short for the same reason. The near-tie exploration distribution is defined entirely
in terms of those scores, so a client that supplied all-equal values or a decay by position
would be manufacturing the tie structure the propensity is drawn over, and every recorded
propensity would be the probability of a draw across a ranking that does not exist. That is
precisely the corruption the "server owns the randomisation" rule exists to prevent. The
integration is therefore correct as it stands; what is missing is a real ranker producing
alternatives, which is product work and not a merge defect.

**A second seam, and this one is a genuine collision.** Policy-logging consent is a
`localStorage` flag (`readPolicyLoggingConsent`) that the client asserts as
`payload.policy_logging_consent`, and the server trusts it. It is therefore invisible to
`GET /consents/{patient_id}`, cannot be withdrawn from the privacy screen D-082 just built,
is lost on a cache clear or a change of device, and is unprovable server-side. The two lines
each built a consent mechanism and neither knows the other exists. PRD_AWAAZ §10.2 is right
that analytics logging is its own purpose and must not ride on another consent — but "its own
purpose" argues for an eighth `ConsentType`, not for a different storage mechanism with
weaker guarantees than the seven beside it. Not changed here: it needs a migration and an
enum value, and it is worth doing deliberately rather than as a footnote to a UI commit.

## `feat/journey-experience` branch — decisions D-084 … D-085

Both lines independently reached D-078 and D-079. Main's numbering stands and this
branch's two are renumbered, the same rule the Awaaz integration used at D-066…D-077.
The branch's own history and `CHANGELOG.md` entries below were written under the old
numbers; the mapping is:

| written as | now |
|---|---|
| D-078 — the reader's language wins over the patient record | **D-084** |
| D-079 — the landing page is one point cloud in six arrangements | **D-085** |

D-064 already covers the sign-in screen's field and is unaffected by either.

### D-084 — the reader's language wins over the patient record, everywhere

**2026-09-02.** The FAST card was rendered server-side from `patient.languages[0]`, so a
caregiver who switched the app to English kept reading a Punjabi emergency card and a
Punjabi household reading an English one — the app said one language and the one section
that has to be understood under panic said another. `safety/fast.resolve_lang()` now takes
the caller's `?lang=` first and falls back to the record only for callers that cannot
express a preference. `/dashboard/{id}`, `/sessions/{id}/finalize` and `/report/{id}` all
carry it, and `Dashboard`/`ClinicianReport` list `lang` as an effect dependency so a toggle
refetches rather than leaving the emergency card in the language just switched away from.
The emergency-number labels are translated too: "Ambulance (India)" under a Gurmukhi
heading was the last English string on that card.

The scope was never only that card. `hardcodedStrings.test.ts` globbed the exam path and
the journey and nothing else, so it passed while the caregiver dashboard, the balance
comparison, the ASHA field view, the listener page, the operator console and the printed
clinician report were English under a translated header — outside the scan, therefore
invisible. The glob is now `routes/**` plus `components/**`, and the exclusions are a
written list: `LanguageGate` (untranslated on purpose), `Landing` and `components/landing/`
(an open content gap, not a passing file), `Diagnostics` (a device readout whose content is
browser identifiers). ~150 keys were added, and `formatDate` was routed through
`usableLocale` like `formatDateTime` already was — half the date callers skipped the guard,
so the trend axis and the history list rendered "M08 31" beside dates reading "31 ਅਗ".

**What is deliberately still English.** `Score.reason` — "3 independent domains (…)
deviating across 3 consecutive sessions" — is generated by `engine/gates.py` and stored on
the row. It appears only on the clinician's report. Translating it means either a template
key plus parameters on the Score (a migration, and INV-8 says audit data is append-only, so
old rows would keep the old rendering anyway) or parsing the English back out. Both are
engine changes rather than a language-toggle fix, and neither is on a patient surface.

### D-085 — the landing page is one point cloud in six arrangements, drawn in raw WebGL2

**2026-09-03.** The signed-out page was rebuilt around a single visual spine: `SignalScene`
holds one cloud of points and *moves* it between six arrangements as the section scrolls —
scatter, seven domain lanes, a folded cortex, a ninety-day ribbon, a five-node ecosystem, and
a thin wide distribution. Nothing is swapped or cross-faded, because the continuity is the
claim: the point that was an unmeasured morning is the same point that becomes a reading, a
day, and a household. Geometry is `lib/cortex.ts` (pure, tested in Node); the renderer is
`components/landing/CortexField.tsx`.

Both **D-039** and **D-064** are upheld here, not overridden. The brief that prompted this asked for
three.js and GSAP by name. Both were declined for the reasons already written down: ~150 kB
and ~90 kB gzipped on a signed-out page that shares a service worker with a clinical PWA
already precaching 45 MB of models, for a page whose own argument is that this product runs
on a cheap phone in a district with no neurologist. What the brief actually wanted — real GPU
rendering and scroll-driven storytelling — is a `gl.POINTS` draw call and the rAF ticker that
has been in `lib/motion.ts` since D-039. **Measured: the signed-out entry chunk went from
100.17 kB to 108.32 kB gzipped, and no dependency was added.**

Three things in the renderer are worth a stranger's attention, because each was a bug first:

1. **A `<canvas>` can only ever hand out one kind of context.** `ResizeObserver` delivers a
   first entry as soon as you observe, so the still-plate fallback took a 2D context *before*
   the intersection observer asked for WebGL — and every `getContext("webgl2")` afterwards
   returned null, on every device. The symptom was not an error in the console: it was the
   fallback rendering everywhere, silently, which is exactly the shape of failure that ships.
   `CortexField`'s `mode` flag exists solely so nothing touches the canvas before the
   renderer has been chosen.
2. **One camera cannot serve six arrangements.** A three-quarter view gives the cortex its
   volume and turns the ecosystem — a diagram of four people around a record — into four
   clusters scattered at random. `STATE_VIEW` gives each arrangement a yaw and pitch, blended
   with the same weights as the positions, so the viewpoint rotates *into* each act.
3. **Nor can one zoom.** The arrangements differ by 3× in width, so a fixed fit either shrank
   the cortex to a speck or threw the ninety-day ribbon off both edges of the screen.
   `Field.extent` is measured at build time rather than declared, because the arrangements
   are generated and a hand-written bound would be one edit away from being wrong.

**What it costs, and what remains unmeasured.** Every arrangement lives on the GPU at once as
six position attributes, so scrolling changes six floats and nothing else — eighteen thousand
points scrub for the same cost as five hundred, and `createField(18000)` measures 12.8 ms.
The expensive part is shader compilation: 2 canvases × 2 programs. `linkProgram` is issued
without querying `LINK_STATUS`, and completion is polled on later frames through
`KHR_parallel_shader_compile`, so the driver's compile never blocks the frame the visitor is
scrolling in. Under the software rasteriser used for verification this produced no measurable
improvement — SwiftShader blocks inside `linkProgram` itself and does not expose the
extension — and **the real-GPU path is therefore unexercised**; it is kept because it is the
standard mitigation and is a no-op where unsupported. With WebGL blocked entirely the same
scroll pass records **zero** long tasks, which is D-039's claim still holding.

**Refusals are first-class.** `particleBudget` returns zero on Data Saver, ≤2 cores or ≤2 GB;
`prefers-reduced-motion`, no WebGL2 and a declined device all fall through to the same still
plate, which is the cortex arrangement drawn once with the 2D context — a real picture, not a
degraded one. The field is built lazily, the loop stops off-screen and in a background tab,
and teardown deletes every buffer, VAO and program before losing the context.

**Content.** The page keeps the beats that were already honest (own-baseline versus
population, the three gates, the twenty-one-day run, the on-device argument, the limits) and
adds the two the brief was right that it lacked: `#reach`, which names the six assumptions a
deployment is normally allowed to make and what this one does instead, and the six-act
overture that states the whole argument before the evidence for it. The Parkinson's confound
was merged into `#gates`, because it is the only reason the third gate exists and separating
them made Gate 3 read as fussiness. `Landing.tsx` and `components/landing/` remain outside
the i18n and type-scale scans (D-084) — this work did not close that gap.
