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

**D-042 · 2026-08-28 · Awaaz practice audio is consented local state, not an upload.**
Board-tap pairing needs the patient's attempted speech, but adding a media endpoint would
break INV-1 before the compliance and object-storage lifecycle exists. The browser therefore
keeps a 16 kHz WAV in origin-scoped IndexedDB and sends only a UUID, duration, SHA-256/size, exact tapped
target, consent actor/time and deletion state. Manual push-to-talk is the default; optional
silence auto-stop honours 0.5–4.0 seconds and cannot fire before speech. The person can
delete every local recording, and the receipt records that revocation. This produces real
card/audio pairs on one device without claiming cross-device review, ASR, or training.

**D-043 · 2026-08-28 · Emergency delivery is a provider result, never an intention.**
The old WhatsApp helper logged a message and returned `True` without contacting a provider.
It was unused, but wiring it would make the most safety-critical boolean in the product a
lie. It now always returns `False`. Awaaz uses a configured-only SMTP adapter instead and
sets `caregiver_notified` only after the relay accepts the caregiver's address. Host or
sender missing means unconfigured and false; provider exceptions are PII-free failures,
not 500s. SMTP acceptance still does not prove a human read the message, so deployment
credentials and a real-device field test remain a release gate.

Location follows the same discipline. The caregiver/patient explicitly enables it; exact
coordinates are requested only for an emergency, kept in browser memory, included in the
provider message, returned to the initiating client, and not written to the audit log.
The audit retains only whether location was shared and which contract supplied it.

**D-044 · 2026-08-28 · A reviewed label becomes an audio pair only with a fresh, consented repeat.**
The evening queue previously saved corrected text but had no audio association. Treating
that text as training data would manufacture a pair: there was no recording proving what
the patient said. The caregiver may now ask the patient to repeat the verified words once,
but only after an explicit per-recording consent checkbox. The 16 kHz WAV stays in the same
origin-scoped IndexedDB vault as card practice; the API accepts only the UUID, duration,
SHA-256/size, consent actor/time and deletion state.

The verified target is locked once the local WAV is saved. An exact retry after a lost
response is idempotent, and a failed submission is restored from IndexedDB by utterance ID
instead of silently orphaning or relabelling the recording. Text-only review remains the
default and keeps working without microphone permission. This closes reviewed-repeat
pairing; it does not claim the original unclear conversation was recorded, uploaded, or
recoverable, and it does not claim ASR or adapter training.

**D-045 · 2026-08-28 · Training handoff is an explicit verified download, not an upload.**
Local audio pairs cannot train the existing server-side scaffold while they are trapped in
one browser, but adding a media API would silently reverse INV-1. The interim boundary is a
user-initiated POSIX tar: before download the browser recomputes every WAV's SHA-256, then
packages a versioned manifest, the consented WAVs, and a sensitive-data README. One corrupt
pair aborts the whole export instead of producing an incomplete training corpus.

The control appears only when local pairs exist and remains disabled until the user
acknowledges that patient voice and labels will leave protected app storage, that the file
cannot be revoked from NeuroTrace, and that it must go only to an authorised workflow. The
app does not upload or transmit it. This enables a deliberate offline handoff; it does not
provide an importer, trainer, registry, deployment channel, or personalised model claim.

**D-046 · 2026-08-28 · An archive's existence can never turn a synthetic run into a real one.**
The personalised-ASR scaffold used to set `synthetic = not data_path.exists()`, but it did
not read that path: every WER still came from generated phrase substitutions. Creating an
empty directory could therefore write `synthetic: false` around synthetic metrics. That is
the exact silent claim failure `ML_STATUS` exists to prevent.

Real-archive mode now verifies the tar without extracting it: safe/declared paths only,
schema and association UUIDs, pair and total size limits, supported languages/sources,
RIFF/WAVE headers and exact SHA-256/size matches. It then exits non-zero before creating an
adapter or metrics because LoRA fine-tuning and held-out evaluation are not implemented.
Synthetic simulation remains runnable and always writes `synthetic: true`. A verified
corpus is an input; it is not evidence that a model trained, evaluated, or shipped.

**D-047 · 2026-08-28 · Opening a dialer is an action, not a call receipt.**
The Awaaz emergency surface now exposes India's 108 number through an explicit `tel:` link
in both connected and emergency-only offline states. The link hands control to the device's
phone app. NeuroTrace cannot observe whether the person confirms the call, whether the
network connects, or whether an operator answers, so it stores and displays no success
claim. It is deliberately separate from the speak-and-notify control and is excluded from
the blank-space long-press gesture.

There is no caregiver phone field, contact selector, or phone-specific consent contract in
the current data model. The product therefore does not infer a number from email/profile
data or pretend that SMTP delivery enables calling. Caregiver dialing can be added only
after that contact and consent boundary is designed; 108 is the sole pinned dial target.

**D-048 · 2026-08-28 · Listener language belongs to the capability, not the stranger's browser.**
A public listener may open the link on a device whose stored NeuroTrace language is unrelated
to the conversation. The session language selected when the caregiver mints the capability
therefore controls the shell and server coaching. New URLs repeat that non-sensitive
language code so loading, outage, and expired states can localize before the server returns;
after a successful response the server session is authoritative. Unsupported or missing
codes fail safely to English.

This changes presentation only. The capability remains a short-lived token exposing a
caregiver-chosen display name, recent confirmed text after mint time, and one coaching line.
No patient identity, clinical history, score, audio, or wider transcript window is added.
Each utterance declares its own language separately so assistive technology does not assume
the shell language for mixed-language speech.
