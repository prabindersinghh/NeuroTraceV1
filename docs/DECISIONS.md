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

**D-049 · 2026-08-28 · A listener capability is read-only; revocation follows patient access.**
The public token intentionally authorizes a bounded view of new confirmed utterances without
login. It does not authorize writes, including killing its own session. Revocation therefore
requires authentication and resolves the session's patient through the same access rule as
the board: owning caregiver, linked patient account, or clinician. An authenticated stranger
who obtains the URL can read exactly what the capability already grants until expiry, but
cannot interrupt it by revoking the link.

The sharing UI exposes stop-sharing beside the active URL rather than hiding revocation in a
backend-only endpoint. A successful request immediately removes the link from the UI and
makes the public view 404 indistinguishably from expiry. Retrying is safe and audits only the
first state change. Unknown tokens still return the generic success response so revocation
cannot be used to enumerate live capability tokens.

**D-050 · 2026-08-28 · One patient has one recoverable active listener capability.**
A revoke control that disappears on page refresh is not meaningful revocability, and letting
each refresh mint a second token creates invisible read capabilities the owner cannot see.
The authenticated patient-scoped GET therefore returns the current active session, allowing
the sharing screen to recover its control without persisting another capability secret in
browser storage.

Minting a new listener link first marks every older active link for that patient revoked.
The replacement is then the sole current capability; old public pages receive the same 404
as expiry. This is an in-memory conversation boundary, not durable history: a server restart
still revokes every link by design. The audit stores the expiry and number of superseded
links, not any token.

**D-051 · 2026-08-28 · Corpus readiness is not model evaluation.**
A verified Awaaz archive can now produce a local readiness artifact before any training is
attempted. It reports aggregate language, source, duration and diversity counts, and emits
capture-ID assignments only after the archive reaches both 50 pairs and 10 distinct
Unicode-normalised phrase groups. Assignment is deterministic at seed 42 and keeps an exact
normalised phrase within one language wholly in train, validation, or test, preventing the
same board phrase from inflating held-out results.

The artifact is deliberately typed as `awaaz_corpus_readiness`, not metrics. It explicitly
sets model-trained, evaluation-run, clinical-metrics and deployment-ready claims to false;
contains no patient ID, transcript, audio or audio hash; and is created with owner-only file
permissions. The 200-pair pilot target is reported as a planning target, not a hard quality
claim. A single-patient archive cannot support speaker-disjoint shared-model evaluation,
and word error rate cannot substitute for the primary human outcome of listener
intelligibility gain. Both remain blocked on separately consented research protocols.

**D-052 · 2026-08-28 · Personal phrases change the board; they do not train recognition.**
The dormant phrase-card endpoints are now a localized management surface at the quiet end
of the Awaaz screen. An authorized caregiver, linked patient, or clinician can append the
words this person actually uses and remove non-emergency tiles. New phrases inherit the
patient's supported board language, trim outer whitespace, reject blank or
Unicode-normalised duplicates, append after the existing layout, and stop at 36 total
cards so the board remains navigable. The fixed emergency phrase cannot be removed.

Adding or deleting a tile is audited without copying its text into the audit metadata.
Removing a card does not delete a previously consented local learning recording or rewrite
its locked target; those have their own explicit revocation path. The UI says plainly that
board customization changes tiles only and is not speech-recognition training, preventing
a useful personalization control from becoming an unsupported model claim.

**D-053 · 2026-08-28 · Shared phrases bind speakers before a cohort can be split.**
A shared-model evaluation must isolate both people and prompts. Assigning each patient to a
different split is insufficient when the same default board phrases occur in train and
test: the model can benefit from phrase familiarity while appearing to generalize to a new
speaker. The cohort planner therefore builds a bipartite relationship in memory. Speakers
sharing an exact Unicode-normalised phrase within a language become one indivisible
connected component, and only whole components may enter train, validation, or test.

This topology has an inconvenient but honest consequence. Three or ten patient archives
may still form a single component because everyone used the same board. If fewer than three
independent components remain, the readiness artifact blocks and omits capture IDs rather
than claiming a leakage-safe split. It reports only aggregate topology and limitations; no
patient ID, phrase, audio, or hash is published. Exact matching does not catch paraphrases
or translations, and archive schema v1 cannot check severity or demographic diversity.
Those are stated limitations, not inferred away. Verification does not pool media, and the
local export receipt is not consent for pooled research; governance approval remains a
separate prerequisite.

**D-054 · 2026-08-29 · Offline board access is a user-bound snapshot, not stale authorization.**
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

*The five entries below were first written as D-055 through D-059 and renumbered to
D-057 through D-061 once `main` was fetched and found to have already taken D-055 and D-056.
The commit messages on this branch were already pushed and still cite the original numbers:
their D-055 is this D-057, their D-056 is D-058, and their D-057 — the governance-receipt
decision — is D-059. Recorded because a reader following a commit reference would otherwise
land on somebody else's decision.*

**D-057 · 2026-08-31 · A logging policy that did not randomise is refused, not estimated.**
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

**D-058 · 2026-08-31 · The ASR training stack is optional and never an API dependency.**
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

**D-059 · 2026-08-31 · Training is gated on a receipt that does not yet prove governance.**
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

**D-060 · 2026-08-31 · Private corpora and model artifacts are gitignored by allow-list.**
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

**D-061 · 2026-08-31 · Model cards are generated except one hand-written section.**
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

**D-062 · 2026-08-31 · The policy-event log has no patient column and no foreign key.**
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

**D-063 · 2026-08-31 · Randomisation is bounded to near-ties and confined to confirmation.**
IPS and SNIPS are unidentifiable under a deterministic logger, and `compare_policies` refuses
such a log outright (D-057). Refusing bad logs is not the same as being able to produce good
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

**D-064 · 2026-08-31 · No cluster key is added; the clustering bias is made unmissable.**
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

**D-065 · 2026-08-31 · The phrase board is a safety fallback, not the worst reward available.**
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

**D-066 · 2026-08-31 · Doubly robust is opt-in in both directions and never the headline.**
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

**D-067 · 2026-08-31 · Supersedes D-059: the governance receipt is Ed25519, not an HMAC.**
D-059 recorded that training was gated on a receipt that did not actually prove governance,
because the scheme was a symmetric HMAC, the signing function shipped with the package that
verified it, and the pinned trust root arrived in environment variables the training operator
set. It closed by saying no receipt should be described anywhere as evidence of approval
until that changed. It has now changed, and D-059 is superseded rather than edited.

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
