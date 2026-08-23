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
