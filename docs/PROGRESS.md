# PROGRESS

Current state of NeuroTrace. A stranger should be able to continue from this file alone.

**Last updated:** 2026-09-03 · **Repository structure only — no functional change, nothing
pushed, nothing deployed.** The root went from sixteen visible entries to eight: nine
documents moved into `docs/` (five of them to the new `docs/archive/`, which is history and
is not current), and `content.md` was deleted after its revamp shipped into `Landing.tsx`.
`docs/README.md` is new and indexes all thirty-nine documents — **start there rather than
guessing a filename.** `CONTRIBUTING.md`, `.github/` (CI, PR and issue templates,
CODEOWNERS), `.editorconfig` and `scripts/README.md` did not exist before and now do.

Every code edit was a comment, a docstring, or a test-scope constant. Two decisions came out
of it — **D-078** (why `docs/` stays flat) and **D-079** (why `docs/archive/` is excluded
from the claim-surface scan, and why that preserves coverage rather than relaxing it). Read
D-079 before trusting the invariant suite's scope; it names the check that verifies it.

Verified: backend **1453 passed, 3 skipped, exit 0** (1456 collected — the "1191 tests"
figure in `CLAUDE.md` was stale and is corrected); frontend **180 passed**, `tsc -b`, build
and `oxlint` all exit 0; zero broken relative links across `docs/**`, `README.md` and
`CLAUDE.md`. `verify_deploy.sh` was not run — nothing here can reach the deployment.

## TASK_FINAL_TECHNICAL_COMPLETION.md (now docs/archive/) — in progress

Nine-part build (`docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md`). Order per the task:
1 → 2 → 3 → 4 → 5 → 6 → 7, deploy, verify. Part 9's checklist is the definition of done.
Updated as each part closes; a stranger resuming this should read the task file itself
first, then this line, then `git log` since the last part closed.

- [x] **Part 1 — regulatory language.** Done and verified. `docs/INTENDED_USE.md`,
      `docs/CLAIMS_MATRIX.md`, INV-13, `test_regulatory_claims.py` (9/9, including the
      built bundle — caught a real stale-`dist/` near-miss on first run). D-042.
- [x] **Part 2 — two-layer session model.** Done and verified (commit `6739186`).
      Daily Pulse / Comprehensive Follow-up, cadence-aware baseline locking (D-043),
      INV-14 (a module's fatigue-curve position is identical across session types), and
      **honest timings** — Daily Pulse is 195s of raw task time, not 90s; `registry.py`'s
      per-module seconds had been reverse-engineered to hit the target and were corrected
      to match the numbers that actually drive the live timer (D-044, D-045). The
      fatigue-position question was **tested, not assumed**: the engine did blend modules
      appearing at different positions, which is why INV-14 exists.
- [x] **Part 3 — doctor-in-the-loop baseline. Backend green; frontend still to come.**
      A baseline no longer locks itself. See "Part 3, as built" below.
- [x] **Part 3.7e — admin doctor census.** `/admin/doctors`: how many clinicians are
      onboarded, their non-clinical roster, and a patient **count** per doctor. No
      drill-down exists anywhere. The D-041 privacy test was extended to link a real doctor
      to a real patient before asserting zero patient content leaks.
- [x] **Part 4 — consent architecture.** Six independent, versioned, withdrawable consents
      (migration 0016). C3 (`CLINICIAN_SHARING`) actually gates access — see D-049.
      D-046's backfill obligation is discharged: 0016 materialises the historical consent
      for every Part-3-era link and threads `consent_ref` back onto it.
- [x] **Part 5 — privacy, security, data.** `ENDPOINT_DATA_AUDIT.md` (all 67 routes;
      **six real access-control gaps found and fixed**), INV-1 re-verified and
      strengthened, `DATA_INVENTORY.md`, erasure (migration 0017, D-050), `SECURITY.md`,
      offline-ordering verification, `SBOM.md`.
- [~] **Part 6 — UX and session flow completion. PARTIAL.** 6.2 (caregiver notification
      rules, pure and unit-tested in `frontend/src/lib/notify.ts` — **WATCH does not
      notify**, and no message reassures) and 6.6 (the patient sees which check-in is due
      and roughly how long it takes, from the server's `estimated_seconds`, never a
      hardcoded number). **6.1, 6.3, 6.4 and 6.5 are not done.**
- [~] **Final beautification pass. PARTIAL.** Design tokens, `.patient-scale` and colour
      semantics untouched — `index.css` and `tailwind.config.js` are unmodified. Done:
      every band pairs colour + word + icon so colour is never the only carrier;
      `aria-live="polite"` on the status line; `main` landmark and `h1` on login/register;
      a PWA manifest that pointed at two non-existent icons, fixed. **The broad
      spacing/typography/density sweep is not done.**
- [x] **Part 7 — phone readiness PREP.** `/diagnostics` extended with FaceMesh /
      PoseLandmarker init time, detection rate and per-frame cost, plus parsed browser/OS;
      the JSON report is now always copyable, including when every probe failed.
      `PHONE_TEST_RESULTS.md` is a structured empty template. **The handset run itself is
      the owner's — nothing here has executed on a physical phone.**
- [x] **Part 8 — claims matrix enforcement.** The overclaim scanner: detect / predict /
      diagnose / replace / clinically-proven / medical-grade, plus unlabelled accuracy
      figures, across user-facing source, docs and the built bundle.
- [ ] Part 9 — completion checklist, deploy, verify live

### Part 3, as built (2026-08-28)

**The change in one line: meeting the completion criteria now produces a *request for
review*, not a lock.** `patients.baseline_state` runs NOT_STARTED → IN_PROGRESS →
DOCTOR_REVIEW_PENDING → LOCKED, with ABANDONED reachable throughout, and bands and alerts are
suppressed whenever the state is not LOCKED. A patient waiting on a doctor is not being
monitored, and is not told they are.

Three things landed that are worth a stranger's attention:

1. **An over-broad access path was closed.** `get_patient_for_user` granted access to any
   patient as soon as `user.role is Role.clinician`, and `/clinic/patients` ran an unscoped
   `select(Patient)`. `Patient.clinician_id` existed and was never consulted. Access now
   requires an active row in `patient_clinician_links`, created by the owning caregiver — a
   clinician cannot link themselves. `test_patient_clinician_link.py` asserts the *old*
   behaviour is gone: unlinked clinician → 403, and an empty roster.
2. **The frozen reference write moved to CONFIRM** (D-048). It used to be written at module
   lock, before any human saw it — which made EXTEND ("that window isn't representative")
   cosmetic, since INV-4 forbids correcting a reference already sealed. The bug this creates
   is a *second* write across EXTEND-then-CONFIRM;
   `test_extend_then_confirm_writes_the_reference_exactly_once` drives the full cycle and
   asserts a repeat `freeze_reference()` returns 0.
3. **Expiry extends once, then abandons** (D-047). Never a LIGHT downgrade — that changes
   which tasks run, which moves every module's position on the fatigue curve, which corrupts
   the very baseline being built. A second failure to complete is a finding about the
   patient, and goes in front of a person with a reason both caregiver and clinician can see.

**Migrations 0014 (additive) and 0015 (enum rewrite) are deliberately separate.** 0014 adds
the three tables and backfills links from `patients.clinician_id` with a dialect branch
(`lower(hex(randomblob(16)))` / `gen_random_uuid()`); `clinician_id` is **not** dropped. 0015
widens → rewrites → narrows the `baseline_state` CHECK constraint, using the **bare**
constraint name inside `batch_alter_table` (passing the rendered name doubles the prefix —
the same trap 0003 and 0012 hit). Both round-trip; both verified rendered for Postgres.

**`consent_ref` was nullable and Part 4 owed it a backfill** (D-046). **Discharged** —
migration 0016 materialises the historical consent for every Part-3-era link from its own
`linked_at`/`linked_by` and threads the new `consents.id` back onto `consent_ref`. Nothing
is invented: the evidence already existed as a `clinician.link.granted` audit event, and the
migration gives it a queryable home. Going forward `POST /clinician/links` creates the link
and the C3 consent in one transaction, so no unreferenced link can be created at all.

**~~Not done, deliberately: the clinician baseline-review frontend.~~ DONE 2026-09-03, and
it was not a follow-up — it was the difference between a demo and a product.** Leaving it
out made `DOCTOR_REVIEW_PENDING` terminal in practice: `record_review` is the only exit,
its one route had no caller in `api.ts`, and a real patient therefore finished their
baseline and was then never monitored, with the caregiver shown "progress 12 / 12" at 100%
forever. The demo hid it because `services/seed.py` calls `record_review` in Python. See
D-080 and the 2026-09-03 CHANGELOG entry. The ABANDONED reason surface is covered by
`BaselineStatusCard`; a queue entry beyond the roster badge is still not built.

---

### Parts 3.7e, 4, 5, 7, 8 — the autonomous completion run (2026-08-28)

Branch `finish/autonomous-completion`. **Not merged — left for review.**

**The headline is not a feature, it is six access-control gaps.** Part 5.1 asked for an
endpoint audit; reading all 67 routes found that Part 3.2's clinician-access fix had landed
in `get_patient_for_user` and nowhere else. Six routes had each hand-rolled their own copy of
"may this caller touch this patient" and never received it:

1. `sessions.py:_assert_can_access` — still granted **any** clinician account read AND write
   access to any patient's raw module features. Critical.
2. `GET /patients` — the role dispatch had no `else`, so clinician and **admin** accounts fell
   through with no `WHERE` clause and received every patient in the deployment. Critical, and
   an INV-11 breach for admin.
3. `POST /wearable/fall/{id}/acknowledge` — authorised via the legacy `Patient.clinician_id`
   column, which revocation never clears, so a revoked clinician kept the ability forever.
4. `PATCH /patients/{id}` — `clinician_id` settable to any user id with no check it names a
   clinician. This is what made (3) exploitable rather than merely stale.
5. `POST /clinic/alerts/{id}/acknowledge` — no check that this clinician is linked to the
   alert's patient.
6. `DELETE /awaaz/listener/{token}` — needed only *some* valid login, asymmetric with minting.

All six are pinned by regression tests that assert the **old** behaviour is gone. The
structural fix is that every clinician access decision now goes through one function,
`auth.deps.clinician_may_access_patient` (D-049) — six copies is how a security fix
half-lands.

**Erasure tombstones rather than deletes** (D-050). `audit_log.patient_id` cascades on
delete — verified by probing a real database, one audit row before and zero after — so
deleting a patient destroyed the record of who had accessed their data. Erasure now deletes
every clinical measurement and strips the surviving row of every identifying field including
the face-identity vector. Audit, consent history and revoked links are retained.

**Consent is six independent grants, and C3 really gates access.** Withdrawing
`CLINICIAN_SHARING` blocks a still-linked clinician immediately and removes the patient from
the roster — the central test leaves the link deliberately active to prove consent is doing
the work.

**New docs:** `ENDPOINT_DATA_AUDIT.md`, `DATA_INVENTORY.md`, `SECURITY.md`, `SBOM.md`,
`PHONE_TEST_RESULTS.md` (empty template), and three plan-only docs under `docs/plans/`.

**Two findings recorded, not acted on** (both in `SBOM.md`): `python-multipart` is installed
and completely unused — deleting it would make INV-1 structurally true rather than only
test-true; and `passlib` is unmaintained, which is why `bcrypt` is pinned at 4.0.1.

**Still outstanding:** Part 6's functional UX work, the whole-system beautification pass,
Part 9's deploy-and-verify, and the Part 3 clinician frontend.

---

### Caretaker onboarding — backend (2026-08-29)

Branch `feat/caretaker-onboarding`, off the merged `main`. **Backend only; the frontend has
not been started**, per the agreed checkpoint.

**A caretaker is family ADDITIONAL to the caregiver who enrolled the patient** (D-054,
Reading A) — the second sibling, the relative abroad. The first family member stays the
`caregiver`/owner and keeps consent management, linking and erasure.

**The boundary is the deliverable, not the feature.** `caretaker_may_access_patient` requires
an active `patient_caretaker_links` row AND current C7 consent; `caretaker_is_linked` is
callable from exactly one place, pinned by a source assertion. The two routes that resolve a
patient without `get_patient_for_user` — `sessions.py:_assert_can_access` and
`wearable.py:acknowledge_fall` — were updated in the same commit, because splitting that is
how the original six-route gap survived.

**Family see everything and silence nothing.** Full clinical read; may acknowledge a fall,
may not acknowledge an alert. Both halves asserted in one test so nobody collapses them.

**The WhatsApp destination is health-adjacent PII**: deleted on erasure (the link is revoked
and kept), invisible to admin, and never written into `audit_log.meta_json` — that table
survives erasure, so a number there would be un-erasable.

**Migrations 0018 (additive + role widening) and 0019 (consent enum) are separate**, and
0019's downgrade deletes C7 rows rather than relabelling them: relabelling would fabricate a
consent the caregiver never gave.

**Frontend: DONE.** `CaretakerHome` (family see everything — dashboard, report, emergency)
and `FamilyAccess` (owning-caregiver only; warns before the form that adding a member shares
the full picture, requires a reason to revoke, shows revoked links rather than hiding them,
and says plainly that a new member cannot sign in yet). Copy says "family", not "caretaker".

**Still to do:** the invite flow. The credentials half of the auth pass is done (2026-09-02,
below); family accounts are still created disabled until an invite can set a password.

**Recovered from a session crash:** a teardown mid-write corrupted `docs/SECURITY.md` and
`docs/DATA_INVENTORY.md` with fragments of compiled Python. Caught by inspecting the files,
restored from git, edits re-applied. Neither file is covered by a test, which is why it was
silent.

---

### D-055 resolved — the migrated schema now matches create_all (2026-08-29)

**It was three tables, not two.** The table-by-table diff that had never been run found
`patients`, `scores` and `alerts` diverging, on top of `users` (already fixed in 0018).

| Table | What it actually cost |
|---|---|
| `patients` | **No `baseline_state` value was insertable** — no patient could be created |
| `scores`, `alerts` | **`PATTERN_ATYPICAL` unstorable** — the band that keeps a Parkinson's patient out of the stroke-alert path (INV-2) |
| `users` | `asha_worker`, `admin`, `caretaker` uncreatable (fixed in 0018) |

**Root cause is reflection, not naming.** SQLAlchemy's SQLite CHECK reflection mis-parses
multi-constraint DDL, returning a name like `"pk_t PRIMARY KEY (id), CONSTRAINT state_enum"`.
Batch mode cannot match a name that was never parsed, so it re-emits the constraint mangled
beside the new one. Passing a naming convention was tried and failed for exactly that reason.
0020 uses `copy_from` instead, which skips reflection and rebuilds from the model.

**0015's deploy blocker is gone** — it dropped a constraint name that has never existed on
either dialect and would have failed the next Neon deploy.

**Two more caught by rendering, not running:** 0020's Postgres branch first emitted a bind
placeholder instead of SQL, and 0016's backfill raised under `--sql`, which had silently
disabled the Postgres portability check for every migration after it.

Guarded by `test_the_migrated_schema_matches_create_all` (the diff that never existed) and
`test_every_role_and_band_is_insertable_after_migration` (the behavioural half — a clean diff
can still be wrong). Migrations now run 0001–0020.

---

### Owner-directed close-out (2026-08-28, final)

Three actions after the run report, all verified:

1. **D-045 is enforced everywhere now (D-051).** The corrected Daily Pulse figure had
   survived in **eight** places, including the shipped `<title>`, the meta description, the
   PWA manifest and BOTH landing hero headlines. **Four were found by the new test, after I
   had already corrected what I could see by hand.** The Part 8 scanner's file scope did not
   include `frontend/index.html` or `frontend/vite.config.ts`; both are now in scope with a
   test that keeps them there. `docs/PRD.md` is allowlisted because its line records that
   90s *was* the old target.
2. **`python-multipart` removed (D-052).** INV-1 is now structural, not only tested: the
   library FastAPI needs to accept an upload at all is simply absent, so a future
   `UploadFile` fails at import. Removed from both manifests and actually uninstalled to
   verify. `passlib` stays (unmaintained, why bcrypt is pinned at 4.0.1) — logged only.
3. **PWA install fixed for real.** The manifest had declared two PNGs that never existed.
   Committing real PNGs tripped `test_privacy.py` — which treats any tracked image as a
   possible patient photograph, and is right to. The commit was reset, the blobs purged, and
   the need for a raster removed instead: `public/icon-maskable.svg`, square with an opaque
   ground, generated from the repo's own `favicon.svg`.

**Noted, not acted on:** `favicon.svg` is a purple gradient bolt, nothing like the blue
medical brand and using a gradient the design system otherwise forbids. Probably a template
leftover. The icon inherits it faithfully rather than inventing a logo — artwork is the
owner's call.

**Last updated:** 2026-09-03 (third slice) · **`feat/journey-experience` is merged into
`main`. Every UI/UX upgrade on that branch is back in the tree it was missing from. NOT
pushed, NOT deployed.**

**The reported symptom was "the 3D model does not show on the login page", and the cause was
not a rendering bug.** The login field is `components/auth/NeuralField.tsx` inside
`components/auth/AuthShell.tsx`, driven by `lib/neural.ts` (D-064). None of those three files
existed in the working tree. Nor did `landing/CortexField.tsx`, `landing/SignalScene.tsx`,
`landing/HeroConsole.tsx`, `lib/cortex.ts`, the six `journey/` components, `lib/authForm.ts`,
`lib/journey.ts`, `lib/journeyStore.ts`, `lib/haptic.ts` or `lib/prefs.ts` — **29 files in
total, none of them present.** `feat/journey-experience` had been pushed and a PR opened, but
never merged down; local `main` sat at the Awaaz merge `e1b8949`, which is an ancestor of the
branch. There was nothing to debug in WebGL: the component was absent, so `Login.tsx` was
main's plain form and the canvas was never mounted.

Restored as two merges rather than a cherry-pick, because `main` was an ancestor of the
branch and a fast-forward loses nothing: this session's uncommitted work was committed first
to `local/consent-and-doctor-review` (nothing was stashed and nothing was discarded), `main`
was fast-forwarded to `3be7a4d` — **zero conflicts, all 29 files back** — and the local
branch was merged back on top. Twelve of the fifteen overlapping files auto-merged; the three
that did not were `CHANGELOG.md`, `DECISIONS.md` and this file, all "both sides appended a
section". **One real collision:** both lines had independently issued **D-078 and D-079**.
Main's numbering stands and the branch's two are renumbered to **D-084** and **D-085**, the
same rule the Awaaz integration used, with a mapping table in `DECISIONS.md`.

The Awaaz merge was audited in the same pass and did **not** disturb the pre-existing UI:
`git diff 43c8006 e1b8949` has no deletion or rename, touches no file under
`components/ui/`, no `index.css`, no `tailwind.config.js`, and no dashboard; `Listen.tsx` and
`ReviewQueue.tsx` lost **zero** design classes, and `Awaaz.tsx` lost one — `text-3xl` on the
phrase-card emoji, replaced by a 32px lucide glyph. Erasure covers what Awaaz added:
`0021`'s audio-pair receipt columns live on `utterance_log`, already in `_PATIENT_SCOPED`,
and `awaaz_policy_events` carries no patient column by design (D-072) and ages out through
`services/policy_retention.py`.


**Last updated:** 2026-09-03 (second slice) · **Consent and erasure now have a UI, one live
500 was fixed, and the Awaaz merge was driven end to end. NOT pushed, NOT deployed.**

`/privacy/:patientId` lists all seven consents with their real state and carries the erasure
(D-082). It states only what is true: C3 and C7 have a runtime gate — **verified live**, a C3
withdrawal with the link still ACTIVE dropped the demo clinician's roster 1 → 0 and the
dashboard 200 → 403, and re-granting restored both — while the other five are recorded
decisions and say so. "Never asked" is spelled out, which immediately exposes that **the demo
seed grants C3 but leaves C1 and C2 with no row at all**, so the demo patient is monitored
with no recorded consent to use the product.

**A live 500 was found by driving it.** `erase_patient_data` sets `name = ""`;
`PatientRead` inherited `min_length=1`; so ONE erasure made `GET /patients` return **500 for
that caregiver's whole roster, permanently**, including patients never erased. Fixed on the
read schema only, with `test_erasure_roster.py` asserting create/update still refuse an empty
name. `erased_at` is now exposed so a tombstone is distinguishable from a failed load.

**The Awaaz merge is integrated and working** (D-083). Migrations 0021/0022 clean to one
head; every Awaaz route 200; the listener link mints, opens for a stranger, leaks no patient
name, and 404s after revocation; the policy contract enforces both gates (409 without logging
consent, 409 off the confirmation path), draws its own propensity (0.92 on a 0.90/0.88
near-tie), validates outcome evidence, and returns the SAME row on a replayed `event_id`. The
table has no patient column.

**One seam does not meet, deliberately.** `/awaaz/{id}/speak` returns `candidates: list[str]`
— unscored, exactly one — and the decision endpoint needs ≥2 scored. So
`scoredSlateFromSpeakResult` returns null and the whole logging pipeline is wired and inert.
Fabricating scores would manufacture the tie structure the propensity is drawn over; it needs
a real ranker, which is product work. **A second seam is a genuine collision:** policy-logging
consent is a `localStorage` flag outside Part 4, so it cannot be seen or withdrawn on the new
privacy screen and is unprovable server-side. It wants an eighth `ConsentType` — migration and
enum value, deliberately not done as a footnote.

Verified: backend suite exit 0 (incl. 3 new tests); frontend vitest **237** (was 189), `tsc`,
build; three mutation checks all bite; consent, erasure and Awaaz driven over HTTP against
`0001 → 0022`. **Not run:** deployed instance, `verify_deploy.sh`, a phone, a browser drive.

Previous: **Last updated:** 2026-09-03 · **The doctor-in-the-loop baseline gate now has a frontend,
and two dead ML twins are deleted. NOT pushed, NOT deployed.**

A route-coverage audit — all 82 backend routes against every path `frontend/src` calls —
found twelve routes with no client. One was load-bearing: **a patient who completed their
baseline entered `DOCTOR_REVIEW_PENDING` and stayed there permanently**, unmonitored, because
nothing in the app could call the one route that leaves that state. Every suite was green
throughout; the demo worked because `services/seed.py` calls `record_review` in Python and
skipped HTTP entirely. Fixed (D-080): `BaselineReviewPanel` for the clinician,
`BaselineStatusCard` so a caregiver is told what the wait is instead of reading a 100%
progress bar forever, a roster badge and a corrected queue metric on `Clinic.tsx`, and three
client methods. `baselineGate.test.ts` pins reachability — its assertions run against the
exported `api` object, because the first draft's source-text `toContain` still passed after
the method was renamed.

`app/ml/scoring.py` and `app/ml/face.py` deleted (D-081). `scoring.py` was a second complete
alert implementation **with no laterality gate** — an ALERT on the symmetric Parkinsonian
decline INV-2 exists to exclude — and its test was labelled the PRD §7 acceptance criterion
while verifying the dead path; `test_engine.py`/`test_laterality.py` were confirmed to cover
it against the live gate first. `face.py` opened a **video path with OpenCV** and was the
sole reason `mediapipe`/`opencv-python`/`protobuf` were runtime deps and the sole reason this
backend was pinned to Python 3.11 and numpy 1.x. INV-1 is now structural on the face path.

Verified: backend full suite exit 0; frontend vitest **189** (was 180), `tsc -b`, `npm run
build`; the new test's mutation check both directions. **Not run:** the deployed instance,
`verify_deploy.sh`, a physical phone.

**Still open, and now written down rather than rediscovered** — eleven routes with no UI, of
which the ones that matter are **`GET/PUT /consents/{id}`: Part 4's six withdrawable consents
cannot be viewed or withdrawn by anyone**, `POST/DELETE /clinician/links` (a caregiver cannot
link a doctor; only the seed can), and `DELETE /patients/{id}` (erasure has no UI). Plus:
`POST /awaaz/policy/retention/sweep` **has never been invoked** — no cron, no startup task,
no control — so the 120-day retention policy has no mechanism to execute; the RL logging loop
**is wired after all** — an earlier draft of this line said it was not, which was wrong:
`Awaaz.tsx` calls it through `lib/awaazPolicyLog.ts` at ten sites, and what is actually
dormant is that nothing READS the table; policy-logging consent is a `localStorage` flag
outside Part 4, so it cannot be seen or withdrawn on the new privacy screen; and `PatientHome`
dead-ends on "No check-ins yet." for an account with no patient record. Full list in the
2026-09-03 CHANGELOG entry.

Previous: **2026-09-03** · **The signed-out landing page was rebuilt around one
point cloud, on branch `feat/journey-experience` — merged into `main` on 2026-09-03, NOT pushed, NOT deployed.** The page now
opens with a six-act overture (`SignalScene`) in which a single cloud of points is *moved*
between six arrangements as the section scrolls — scatter, seven domain lanes, a folded
cortex, a ninety-day ribbon, a five-node ecosystem, a thin wide distribution — because the
continuity is the argument: the point that was an unmeasured morning is the same point that
becomes a reading, a day, and a household. Geometry is `frontend/src/lib/cortex.ts` (pure,
14 tests); the renderer is `components/landing/CortexField.tsx`, **raw WebGL2 and no
library** — D-039 (no GSAP) and D-064 (no three.js) were re-examined and upheld, and the
signed-out entry chunk grew 100.17 → 108.32 kB gzipped with **no dependency added**. Two
sections the page genuinely lacked were written: `#reach`, which names the six assumptions a
deployment is normally allowed to make and what this one does instead, and the overture
itself. The Parkinson's confound merged into `#gates`. D-085.

**The bug worth remembering** is that the WebGL fallback was rendering *everywhere*, on every
device, with nothing in the console: `ResizeObserver` fires on `observe()`, so the still
plate took a 2D context on the canvas before WebGL was ever requested, and a canvas can only
ever hold one context type. Found by counting `getContext` calls in a headless probe, not by
looking at the page — the fallback is a real picture, so it looked fine.

Verified: `vitest run` 222/222, `tsc -b`, `oxlint`, `npm run build`,
`pytest tests/test_regulatory_claims.py` 41/41 (including the sweep over the fresh `dist/`),
and headless Chromium at 320/390/768/1440/1920 with no horizontal overflow and no console
errors across the hero, all six acts and all eight following sections. Each fallback was
asserted rather than assumed: reduced motion, no WebGL2, and a two-core device all reach the
still plate; six round trips through `/login` leave a fresh GL context obtainable with zero
context-loss errors. Long tasks on a full scroll are entirely GL shader compilation — the
same pass with WebGL blocked records **zero**, so D-039's architecture claim holds — but that
was measured under a software rasteriser and **no real-GPU or physical-phone measurement
exists**. `Landing.tsx` and `components/landing/` remain outside the i18n scan, so the new
English copy makes that gap larger, not smaller.

**Previously:** 2026-09-02 · **The language choice now holds across the whole
app, on branch `feat/journey-experience` — merged into `main` on 2026-09-03, NOT pushed, NOT deployed.** The reported symptom
was the red FAST card at the foot of the dashboard staying in the previous language after a
toggle: it is rendered server-side and was keyed on `patient.languages[0]`, so it followed
the record and not the reader. `safety/fast.resolve_lang()` now prefers the caller's
`?lang=` (added to `/dashboard/{id}`, `/sessions/{id}/finalize`, `/report/{id}`; the report
was passing `"en"` literally), and `Dashboard`/`ClinicianReport` refetch on a language
change. That was the visible corner of a wider gap: `hardcodedStrings.test.ts` globbed only
the exam path and the journey, so the caregiver dashboard, balance comparison, ASHA field
view, listener page, operator console and printed clinician report were all English under a
translated header and the test passed. The glob is now `routes/**` + `components/**` with a
written exclusion list, ~150 keys were added, and `formatDate` was routed through
`usableLocale` (it printed "M08 31" on trimmed-ICU devices while `formatDateTime` beside it
read "31 ਅਗ"). D-084. Still English on purpose: `Landing`, `LanguageGate`, `Diagnostics`,
and `Score.reason` on the clinician report. Verified: backend `pytest -q` exit 0, frontend
`tsc -b` + `vitest run` (208) + `build`, and a Chrome walkthrough at 430×900 toggling
pa → en → hi with the FAST card and emergency-number labels following each time.

**Previously (2026-09-02, later):** **Authentication hardened and redesigned, on branch
`feat/journey-experience` — merged into `main` on 2026-09-03, NOT pushed, NOT deployed.** Server: refresh tokens rotated and
revocable (migration `0023`, `refresh_tokens`), `POST /auth/logout`, `POST /auth/password`,
in-memory rate limits on login/register/refresh, a common-password check, the dev JWT
secret refused outside development/test, security headers (D-065). Client: three real
defects fixed — a rejected refresh never signed the shell out, an offline reload signed the
patient out, the demo button hard-reloaded — plus return-to-path, cross-tab sign-out, a
request timeout, and every auth error as an EN/HI/PA sentence rather than the server's
text. New sign-in and sign-up screens (`components/auth/*`): a canvas neural field that
responds to the form and is gated for vertigo and reduced motion (D-064), blur validation,
eye toggle, strength meter, two-role group. `vercel.json` now carries a CSP verified with
MediaPipe loading under it. Verified: backend full suite exit 0, vitest 208/208, tsc, build,
oxlint baseline, a headless walkthrough of every flow at seven widths, the CSP against
`dist/` (see the CHANGELOG entry). **Not run: a physical phone, the deployed instance.**
To ship: merge `--no-ff`, deploy backend (migrations `0021`, `0022` and `0023` run at boot), deploy frontend,
run `verify_deploy.sh`. **Remaining, honestly:** no self-service password reset or email
verification — there is no email provider in this system, and a fake "forgot password"
link would be worse than none; family accounts still await the invite flow; bearer tokens
remain in `localStorage` behind the CSP rather than in HttpOnly cookies (D-065 says why).

Previous: 2026-09-02 · **The patient journey is built on branch
`feat/journey-experience` — merged into `main` on 2026-09-03, NOT pushed, NOT deployed.** The check-in is one path of lights
with chapters (D-063): welcome + warm-up, chapter intros with a rest offer, a spoken
repeatable instruction card, the light in place of the circle, a ring in place of every
countdown numeral, comfort switches (read aloud / less movement / bigger text), a neutral
ending, and **resume after a reload** (`lib/journeyStore.ts`). The protocol, positions,
timings, stimuli and scorers are untouched. Two live defects were found and fixed on the
way: **a Comprehensive session ended at step 5 of 18** because the questionnaire step
submitted the whole session after D-044 moved it to position 5 (D-061), and the five recall
words were spoken and immediately cancelled. Design proposal:
`docs/superpowers/specs/2026-09-02-journey-experience-design.md`. Verified: vitest
181/181, tsc, build, oxlint baseline, the backend copy scanners, and a full 18-of-18
Comprehensive session driven in headless Chromium at seven widths including a mid-session
reload (see the 2026-09-02 CHANGELOG entry). **Not run on a physical phone.** To ship:
merge `--no-ff`, deploy the frontend, run `verify_deploy.sh`; no migration.

**Previously:** 2026-09-02 · **Awaaz contract-foundation merged into `main` — NOT
pushed, NOT deployed.** 36 commits reconciled onto main after a ~90-commit divergence.
**Migration head is now `0022`** (`0021` on-device audio receipts, `0022` Awaaz policy
events). Two defects were caught before the commit and are the reason this was not a
`-X theirs` merge: duplicate revision ids `0012`/`0013` across the two lines would have left
Alembic with two heads and **crash-looped the container at boot**, and the branch's
`0012_repair_role_constraint` would have rebuilt the `users.role` CHECK without
`caretaker`, **silently breaking family access** — it was dropped, because main's `0018`
already does that repair correctly.

What the merge adds, all inside the existing `/awaaz/:patientId`, `/listen/:token` and
`/review/:patientId` routes (no new route; `App.tsx` untouched): a `tel:108` link and
long-press activation on the emergency path, an on-device recorded emergency phrase, an
offline board snapshot in IndexedDB, consented on-device practice capture with a local tar
export, personal phrase management, listener-link recovery and revocation, a Hindi/Punjabi
listener page, and an opt-in policy-event log with no patient column and a 120-day sweep.
Plus a dormant ML/RL and ASR-governance subsystem that no route can reach.

**INV-1 re-verified, not assumed:** no upload endpoint, no media column in the migrated
schema, audio never leaves IndexedDB, and main's deletion of `python-multipart` survived
the merge.

**Watch before deploying:** `services/emergency_notifications.py` is wired into
`POST /awaaz/{id}/emergency`. It fails closed while `EMERGENCY_SMTP_HOST`/`_FROM` are blank,
but setting them makes it send real email containing a patient name and GPS coordinates.
`cryptography==43.0.1` is a new runtime requirement.

Verified: backend full suite exit 0; `alembic upgrade head` clean to a single head with a
caretaker INSERT proven to still work; frontend `tsc`, **vitest 180/180**, build, oxlint;
and a headless drive of sign-in, dashboard, Awaaz board and review queue with zero console
errors and the dashboard visually unchanged. **Not run:** a physical phone, the deployed
instance, `verify_deploy.sh`.

**Interacts with `feat/journey-experience`** (unmerged, carries the journey + auth work):
that branch adds its own migration `0023_refresh_tokens` and decisions D-061..D-065. Its
migration must be renumbered to `0023` before it merges; its decision numbers were
deliberately left free here.

Previous: 2026-09-01 · **Frontend revamp + dashboard instrumentation DEPLOYED**
(pushed to `main`, Railway `verify_deploy.sh` 7/7, Vercel serving the new bundle — verified
live at 1900px with zero console errors). This session's slice: a serious "software chrome"
design language app-wide (mono eyebrow / fluid title / hairline rule via `PageHeader`,
one `Metric` readout, one `.tactile` spring press system, traced in-repo SVG of the
supplied logo per INV-11); the patient home is a two-column laptop dashboard with a
check-in **wall calendar** and history list fed by the new **verdict-free**
`GET /sessions/{patient_id}/history` (no band/score/deviation — pinned by test, route in
the FOREIGN_ROUTES authz sweep); the caregiver roster and patient dashboard carry metrics
rows and 7-day adherence strips (adherence only — bands stay one click away on the
dashboard). **No migration** — head stays `0020`. Backend suite green (exit 0), frontend
vitest 139 / tsc / build / oxlint-baseline green. Known gaps, deliberate: Onboarding/Enrol
keep step-flow headers; the printable report keeps its masthead; `Landing.tsx` is still
English-only; `GET /patients` carries no band so the roster card shows none (not fabricated
client-side).

Previous state (2026-08-31): **The UX branch is merged to `main` and DEPLOYED**
(`25d856a`, Railway SUCCESS, `verify_deploy.sh` 7/7). Mid-test exit and view-only back,
a language screen before demo/login, and a first-run tour. **No migration** — head stays
`0020` and no column changed, so this deployed as code only and D-058's coordinated release
did not apply.

Two live defects were fixed that nothing local could see. `_module_history` fed
**unfinished sessions into every baseline** (INV-14), reachable by closing the tab
mid-session; fixing it also turned out-of-order offline replay from producing a *wrong,
unrepairable* baseline into producing *none*, recoverable by an in-order rescore. And the
demo seed never created a clinician link or consent, so after Part 3.2 the **demo doctor
saw an empty roster** — on the surface shown to judges. Both confirmed fixed in production:
roster returns 1 patient at ALERT, and an exited session leaves the baseline byte-identical
with history 21 → 21 and no band, trend or alert.

Six further defects came from driving the app in Punjabi and Hindi, none visible to `tsc`,
`vitest` or `oxlint` — including **Pause and Exit rendering as the same word** in both
languages, and **`PatientHome` having no emergency button at all**. See D-059, D-060 and the
2026-08-31 CHANGELOG entry.

**Still open:** Part 4's broad visual restyling was not attempted, and `Landing.tsx` remains
English-only, so choosing Hindi or Punjabi still lands on an English page.

· Earlier: **`feat/caretaker-onboarding` is merged to `main` and
pushed** (`--no-ff`), together with the D-055 repair. The reconcile also caught Deepesh's
README rewrite reintroducing the "90-second" Daily Pulse figure in four places — three of
which git merged silently — corrected against `app/models.py:92` (~195s).

**Deploy status: DEPLOYED.** Neon production migrated **0011 → 0020** (nine migrations),
`ALEMBIC_EXIT=0`, every row-level check green — see the 2026-08-30 CHANGELOG entry. Two
defects were found by deploying that nothing local could see: **D-056** (0016 bound a
tz-aware datetime to a naive column — the chain died mid-deploy) and **D-057** (the ORM
constrained on the enum NAME while the migration used the VALUE, so the deployed API could
not create a single session). The historical note below predates that. The chain has now been run end to end against a **Neon
branch of production with real rows**: the first attempt FAILED at 0016 (D-056 — a tz-aware
datetime bound to a naive column, invisible to both SQLite and `--sql` rendering); after the
one-line fix, the branch run passes all nine checks with `alembic upgrade head` exit 0,
including patients 1 → 1 with `baseline_state` mutated `locked` → `LOCKED`. Running it
against Neon `main` is the owner's call and has not been done. Production is currently
self-consistent (old code, old schema, `/health` `database: up`).

· Earlier: Part 3 (doctor-in-the-loop baseline) backend complete —
see "Part 3, as built" above. Before it, Part 2 (`6739186`) and a **whole-system frontend UX
pass** (`d40ae6f`, branch `ux/system-upgrade`) landed: an offline/sync strip on the caregiver
surfaces, clinical status colours moved onto the token palette, and `frontend/src/lib/
taskFlow.ts` extracted so the session's retry/confirm rules are pure and testable — which
immediately exposed **two live retry bugs and one stale-closure bug that mislabelled every
Daily Pulse session** (caught by oxlint, not by any test). `docs/archive/UX-CHANGES.md` carries the
deferred items; **automatic offline drain is flagged there as a data-integrity fix, not
polish** — an offline queue that never drains loses sessions silently. ·
Earlier: two independent sessions landed the same day
**Last updated:** 2026-08-31 · Awaaz now records the events an offline policy comparison
needs, and has never recorded one. The new append-only `awaaz_policy_events` table stores one
row per candidate-ranking decision — opaque event id (also the idempotency key), behaviour
policy id, the full offered slate as opaque ids in rank order, the logged action, the
probability the policy assigned to the action it actually logged, the top-ranked action, a
`randomised` flag, the coarse speech profile, the three INV-9 confirmation booleans, the
emergency flag, the feedback actor, the outcome enum, the selected and rejected actions, and
`logged_on` as a DATE. It has no patient column and no foreign key at all, and the date is a
day rather than a timestamp because a microsecond timestamp would join one-to-one onto
`audit_log.ts` and `utterance_log.ts`, which do carry `patient_id`. The cost is real: no
patient-level split before fitting is possible, so repeated-speaker dependence stays
unaddressed and cohort work on this table cannot be done. The ranker now randomises among
candidates within 0.05 of the best score — at most two alternatives at a flat 0.08 each, top
keeps at least 0.84, confirmation path only — because IPS and SNIPS are unidentifiable under a
deterministic logger. It is not online learning: nothing reads these rows at runtime and no
ranking adapts. Nothing calls the two endpoints yet — the decision endpoint refuses without a
purpose-specific logging consent and the outcome endpoint only closes a decision that passed
it — so the frontend confirmation
loop must still mint event ids and report outcomes before any row exists; no real product event
has ever been logged and no policy is authorised for anything. A reward bug found by writing
`docs/RESEARCH_OPE.md` is fixed: `phrase_board_fallback` was charged repair cost on top of its
negative preference and scored −1.0 against a plain rejection's −0.8, making the designed
safety fallback the worst outcome the reward could assign; repair cost now applies only to a
correction and both score −0.8. Doubly-robust estimation is reachable only through a validated
outcome model and blocks the whole comparison on a mismatch in either direction, with SNIPS
kept as the headline by read-only property; support deficiency is detected as a provable lower
bound gated at 2%; and the improvement criterion now needs the interval lower bound, the point
estimate, and survival of deleting the most influential event. Clustering was resolved by
deliberately not adding a cluster key — a grouping id stable across a speaker's events is a
pseudonymous patient identifier — so the bias is instead the first entry of `LIMITATIONS`,
names its direction (the true interval is wider, the error favours "candidate better"), and
`clustered_uncertainty_available` is permanently false. Still open:
`max_deterministic_event_rate` defaults to 0.10 and nobody has measured how often real slates
are near-tied, so the whole log
could be refused from day one; `no_explicit_signal` rows are logged but cannot become feedback
and their skip rate must be inspected; there is no preregistration, privacy review, retention
or deletion job for `logged_on`, or independent review; and `MINIMUM_EFFECT_FLOOR = 0.02`
promises about ten times more resolution than the sample floors deliver, since at ESS 25 the
smallest adjudicable delta is roughly 0.18. ·
2026-08-31 · Awaaz personalised ASR now has a real training runtime that
has trained nothing. `backend/app/ml/train/asr_runtime/` implements fail-closed,
governance-gated LoRA/PEFT fine-tuning of an MMS / Wav2Vec2 CTC base
(`SUPPORTED_MODEL_TYPES = {"wav2vec2"}`), and no adapter, WER, or intelligibility number
exists for Awaaz anywhere in this repository. Its synthetic dry-run writes exactly one file,
a private `manifest.json`, and no clinical metric. Reaching real training additionally
requires a consented archive, local base-model weights, a signed purpose-specific governance
receipt, a GPU host, and held-out human intelligibility evaluation, none of which exist
here — so the blocker moved from missing code to missing governance and evidence, which is a
smaller change than it sounds. Torch, transformers and peft are lazily imported through
`importlib` inside one function; importing the runtime and booting the FastAPI app both load
zero heavy modules, and the optional GPU pins live in `backend/requirements-train.txt`,
which has never been installed or verified here and is deliberately outside
`requirements.lock.txt`. An adversarial audit of that module left seven findings open —
symmetric-HMAC receipts an operator can mint for themselves, a smoke path that escapes the
output-path guard, a split with no size floor, an `epochs_completed` counter that can
overstate a truncated epoch, an orphan-adapter window between two publish steps, a sanitizer
blind to `target_text`, and a base-model snapshot in shared temp. They are written down in
`COMPLETION_CHECKLIST.md` and `PLAN_AWAAZ.md` rather than fixed. `backend/app/ml/rl/` adds
an offline-only, ranking-only policy-evaluation package with hard floors on every gate and
read-only `deployment_allowed` / `online_experiment_allowed` / `clinical_claim_allowed`
properties that always return false; a logging policy that did not randomise is now refused
outright instead of returning a confident interval, and the production Awaaz schema records
no slate, policy version, propensity, or outcome, so no current product event is eligible
(`PLAN_RL.md`). The five model cards are now genuinely generated from
`artifacts/*.metrics.json` by `render_model_cards.py`, with only the hand-written
`## Purpose` section carried through between markers. Privacy work inverted `.gitignore`
from a deny-list to an allow-list for `data/*` and `artifacts/**`, stopped `--patient` from
reaching a tracked artifact or the console, and fixed an INV-1 leak where the archive
verifier snapshotted consented WAVs into the shared system temp directory. ·
2026-08-29 · An authenticated online Awaaz load now saves a user-and-
patient-bound phrase-board snapshot. On a genuine network failure the saved tiles remain
visible and tappable with an explicit unsaved/browser-voice disclosure; authorization
responses never use the cache, and network-dependent actions remain disabled. Awaaz also
has single-patient phrase-disjoint and multi-patient speaker/phrase-disjoint readiness
planners, both planning-only with all model/evaluation claims false. Awaaz captures
explicitly-consented 16 kHz practice WAVs
into a browser-only IndexedDB vault and pairs them with the exact phrase card the patient
taps. The API receives metadata receipts only, retries are idempotent, deletion is recorded,
and optional silence auto-stop honours a patient-set 0.5–4.0 s pause. The fixed emergency
phrase can now be caregiver-recorded, self-tested, and deleted locally; it starts before the
network request, stays reachable on an offline boot with the last authenticated local identity,
and the server records only the actual playback result. Long-press activation now ignores
controls and scrolling, location is explicitly opt-in, and a configured-only SMTP adapter
reports caregiver delivery only after provider acceptance. Production remains unconfigured
until real SMTP credentials are installed and field-tested. Caregiver review can now add an
explicitly consented fresh patient repeat: the 16 kHz WAV is previewable and retained only
in local IndexedDB, its verified label is locked across retry, and the API receives only a
complete integrity/consent receipt. Awaaz remains partial: there is no patient-speech ASR,
original conversational-audio capture, adapter deployment, provider field test, or consented
caregiver-number calling. A visible `tel:108` action now opens the phone app from both the
connected and emergency-only offline Awaaz states without claiming that a call connected.
The public listener capability now keeps its EN, HI, or PA language through share URL,
loading/error/expired states, server-localized coaching, privacy copy, and per-utterance
assistive-technology language. The active sharing URL now has a visible stop-sharing
control; only a user authorized for that patient may revoke it, retry creates one audit row,
and the public capability is immediately dead. Reload retrieves the current active link,
while minting a replacement kills the prior link and preserves one active capability per
patient. Consented local pairs can now be SHA-256 verified into a versioned tar only after the user acknowledges that the voice archive leaves protected app
storage; NeuroTrace does not upload it. The backend can verify that tar without extraction and rejects unsafe paths,
undeclared files, invalid associations, oversized/non-WAV data and hash mismatches. The
adapter command then exits without writing a model or non-synthetic metrics. Previous
project history follows. ·
2026-08-24 (later still) · Two independent sessions landed the same day
and were merged: an **admin console** (`/admin` — counts and the audit trail, never patient
records) and a **privilege-escalation fix** (`/auth/register` let a stranger self-assign
`clinician` and read every patient's name; registration is now caregiver/patient only,
D-040/D-041) on the backend side; on the frontend, the **signed-out landing page rebuilt as
the product's argument** with its own motion system (`frontend/src/lib/motion.ts`, one rAF
ticker — no animation library, 0 long tasks across a full-page scroll), route-level code
splitting (first chunk 800 kB → 225 kB), and three real bugs fixed by driving the app end to
end (`GET /report/{id}` 500'd on any patient with a scored session — `Score.lateralised` is
actually a column on `Deviation`; `Diagnostics` rendered duplicate React keys; `StepRecall`
called a hook conditionally). **A `git pull` rebase during that session dropped a merge
commit and briefly broke `App.tsx`** — see CHANGELOG 2026-08-24 (later); this merge used
`git merge`, not rebase, precisely because of that incident. ·
**DEPLOYED ON NEON POSTGRES** — backend
`neurotracev1-production.up.railway.app` (`database: up`), frontend
`neuro-trace-v1.vercel.app`, `verify_deploy.sh` 7/7. The demo is seeded on Postgres and
**survives redeploys**: `/clinic/patients` returns `Ramesh | band: ALERT` after a subsequent
deploy. The exam runs the 21-step protocol (18 web-runnable) with the fall gate, fatigue
fields, and raw-point server extraction. Face identity, the Awaaz listener page, the
caregiver review queue, onboarding-on-the-actual-path, and an admin console that sees counts
and never patients are all built. See CHANGELOG 2026-08-23 (later) for the two dialect bugs
the first Neon boot found, and CHANGELOG 2026-08-24 for a privilege-escalation hole closed
(D-040) and for the landing page rebuilt as a scroll-driven argument with its own motion
system (`frontend/src/lib/motion.ts`) and route-level code splitting. ·
FINAL_PRODUCT_SPEC_v4 built; see [COMPLETION_CHECKLIST.md](COMPLETION_CHECKLIST.md) for
line-by-line status (verified-live vs verified-in-tests vs pending).

---

### The authentication pass — credentials half, as built (2026-09-02)

What a stranger needs to know before touching `/auth`:

- **Tokens.** Access (30 min) + refresh (14 days), both JWT HS256, both in the browser's
  `localStorage` under `neurotrace.tokens`. Every refresh token's `jti` is a row in
  `refresh_tokens`; `/auth/refresh` rotates (old row gets `revoked_at` + `replaced_by_jti`)
  and a replay of a rotated token revokes the account's whole live set. `/auth/logout`
  takes the refresh token in the body, no bearer. `/auth/password` revokes every OTHER
  session. Rows cascade with the user (erasure unchanged).
- **Rate limits** live in `app/auth/ratelimit.py`, in memory. Correct for one replica; the
  `ponytail:` comment there names Redis as the upgrade when `numReplicas` > 1.
- **The client** (`lib/api.ts`) tells `AuthProvider` when a refresh is REJECTED
  (`AUTH_EVENTS` / `SESSION_EXPIRED`) and stays signed in when a refresh cannot reach the
  server. Only a 401 from `/auth/me` on boot signs out. `lib/authForm.ts` maps every status
  to a string key; the server's `detail` text is never shown.
- **The screens** are `routes/Login.tsx` and `routes/Register.tsx` inside
  `components/auth/AuthShell.tsx`; the visual is `components/auth/NeuralField.tsx` over
  `lib/neural.ts`. Add a string to `STRINGS` in all three languages or `i18n.test.ts` fails.
- **Not built:** password reset by email, email verification, the family invite flow. All
  three need an email provider the system does not have; none is faked in the UI.

## CLINICAL_AMENDMENT_v3 — ALREADY IMPLEMENTED. DO NOT RE-EXECUTE.

Verified against the running code on 2026-08-22, amendment by amendment:

| | Amendment | Status |
|---|---|---|
| A | Widen scope to posterior circulation | ✅ PRD out-of-scope list updated |
| B | New `posterior_vestibular` domain, lateralisable | ✅ in `DOMAINS`, not in `NON_LATERALISABLE_DOMAINS` |
| C | M9 balance promoted to core | ✅ weekly, `posterior_vestibular` |
| D | M3 ocular promoted to core | ✅ weekly, `posterior_vestibular`, runs on `phone` |
| E | Symptom-burden instruments | ✅ `DHI` in `SCORERS`, `score_vertigo_log` present |
| F | `docs/CLINICAL_REFERENCE.md` | ✅ present, rebuilt from source images |
| G | Posterior test fixture | ✅ `test_posterior_circulation.py`, 31 tests |

| H | E3 audiometry self-report | ✅ built 2026-08-22, `score_hearing_change` |

**CLINICAL_AMENDMENT_v3 is complete.** E3 was the last open item and is now closed.

---

## What the product is

A daily neurological check-in for stroke survivors. The patient's phone runs a short battery
of tasks, extracts features **on the device**, and posts numbers. A deterministic engine
compares each session to that patient's own baseline and reports one of four bands with a
plain-language explanation in English, Hindi or Punjabi. A caregiver sees a band and what
changed. A clinician sees a ranked roster. An ASHA worker sees a household list.

It watches for change over days. **It cannot detect an acute stroke**, and says so on every
screen.

---

## The daily session

21 steps, ~11m35s, five blocks: cognitive → ocular → **standing** → motor → close, with a
fall-risk gate before the standing block. `backend/app/exam/session_plan.py`.

Ordering is fixed on purpose: constant task position lets each personal baseline absorb its
own fatigue offset. Two things break that after lock — an intensity change and a pause — and
**both bias toward masking decline**, so both are recorded per result rather than prevented.

Intensities: FULL (21) · STANDARD (18) · LIGHT (core + one rotating physical block) ·
RESEARCH (FULL + supervised balance). Stepping **down** is auto-offered after repeated
abandonment; stepping **up** never happens automatically.

---

## Built and verified

### Engine — done
- Personal baseline: median/MAD over a 12-session lock window, robust z, RCI, CUSUM.
- **Three gates.** Persistence → cross-modality → **laterality**. Every ALERT needs a
  one-sided finding.
- **`PATTERN_ATYPICAL`** band for symmetric progressive change across face/motor/voice —
  the parkinsonian pattern, reported rather than alerted on.
- **Frozen reference baseline.** Snapshot at lock, never updated; every session scored
  against both it and the adaptive baseline. Catches a slow decline the adaptive yardstick
  absorbs.
- **Nine domains**, including `motor_speech` / `language` split and `posterior_vestibular`.
- Confounder detection (off-window, poor sleep, short baseline, quality) with confidence.

### Exam modules — 21 (2 rewritten, 1 new)
- M1 facial, M4 dysarthria, M7 fine motor, M10 attention, M13 mood, M19 medication (daily).
- **M3 oculomotor** — rewritten: saccade latency/velocity/precision per direction, pursuit
  gain and asymmetry. Weekly, phone.
- **M9 craniocorpography** — rewritten: Romberg (eyes open/closed), tandem stance, tandem
  walk, Unterberger. Outputs sway path (cm), sway area, angular deviation (°), lateral
  displacement, plus a clinical-format movement trace. Weekly, and routed to an ASHA visit
  because it needs floor space and a carer standing close.
- **M21 SVV (Sense of upright)** — NEW. Static + dynamic clockwise/anti-clockwise, six
  trials each. Reproduces all three of the reference patient's printed averages exactly,
  including the drift slope that averaging destroys. Monthly, `posterior_vestibular`,
  carries laterality.
- Instruments: PHQ-2/9, EAT-10, FSS, Barthel, **DHI**, **vertigo attack log**,
  **hearing change self-report** (amendment v3 E3).

### Safety — done
- FAST card, unauthenticated, in three languages.
- Acute symptom report → bypasses the engine entirely.
- **Fall events** → bypass the engine entirely, immediate caregiver notification.
- Enrolment refuses < 3 months post-stroke, Parkinson's, other movement disorders.

### Platform — done
- Roles: patient / caregiver / clinician / **asha_worker**, enforced server-side.
- **Deployment tiers** gating module availability by hardware.
- **Wearable ingestion** with the claim boundary enforced in every response.
- **ASHA visit sync**, idempotent on `client_visit_id` for offline rounds.
- Clinician roster with typed cards: `deviation`, `atypical_pattern`, `cumulative_drift`,
  `routine`.

### On-device capture — verified in a real browser
`npm run verify:ondevice` loads FaceMesh from locally staged assets, runs inference on
generated frames, and prints landmark-derived features. Confirmed 6/6 faces detected, 478
landmarks, and that the asymmetry features rise with a simulated droop (`corner_drop`
0.0016 → 0.0267).

---

## Verified live vs verified in tests

**Verified against the running system:**
- Backend boots; login, dashboard, session run, finalize, safety bypass, clinician roster
  all exercised over HTTP against a seeded demo patient.
- **Full engine re-verified live after every change above** (2026-08-22): the 21-day demo
  still produces `SSSSSSSSSSSSSSSSSSWAA`, final band ALERT, all three gates passing,
  lateralised in `cranial_nerves` + `motor`. The persistent-domain list now reads
  `motor_speech` rather than `speech_language`, which is how we know the domain split is
  live in the running engine and not just in the registry. `cumulative_drift` computed
  (6.0) and correctly NOT flagged — the adaptive comparison is elevated too, so this is a
  visible decline rather than a masked one.
- Migrations 0003–0006 applied to a real database with row counts compared before and
  after each one. Zero rows lost; foreign-key integrity clean.
- MediaPipe capture in headless Edge/Chrome.

**Verified only in tests:**
- Wearable ingestion, fall bypass, ASHA sync — exercised via the ASGI test client, not a
  deployed instance.
- Posterior-circulation modules — synthetic captures only; no real patient video has been
  processed.
- Frozen-reference drift over 60 days — simulated decline.

---

### Roles, and a privilege-escalation hole that was open until 2026-08-24
`/auth/register` used the `role` from the request body, so anyone could sign up as a
clinician and read `/clinic/patients` — every patient's name and age, across all caregivers.
Verified against the running app before fixing. Registration is now caregiver/patient only;
clinician, ASHA worker and admin are provisioned by `POST /admin/users` (admin-only,
audited) or by the seed. D-040.

### Admin — an operator console that cannot read patients
`/admin` for the new `admin` role: census, the three-gate funnel, identity flag rate, and
the append-only audit trail with patient references truncated. No names, no emails, no
features — asserted by a test, so adding one fails the build. D-041.

### Face identity — the confounder that finally has an input
`identity_uncertain` and `identity_verified` existed from the start with nothing computing
them. Six ratios between bone-structure landmarks, on device, compared to an enrolment
vector in `calibration_json`. Not the M1 expression features — those move with every task
and with the facial weakness the product measures. Flags a session, never blocks it;
unenrolled is stored as verified. Threshold calibrated on synthetic geometry only and says
so in the source. D-015, D-017.

### Awaaz — partial foundation across D1 through D5
- **D1** phrase board and the INV-9 server gate exist. Candidate taps now complete a
  distinct confirmation request and audit row. Emergency uses a fixed phrase without ASR;
  a caregiver-recorded local WAV, visible self-test, deletion, and playback receipt now make
  speech offline after setup. A 1.2-second blank-space hold reaches the same path, scroll
  movement cancels it, and exact location is opt-in. A configured SMTP adapter reports true
  only after acceptance; the deployed provider still needs credentials and a field test.
  A localized, collapsed board manager now adds duplicate-safe personal phrases and removes
  non-emergency tiles while keeping the patient-facing speaking surface uncluttered. A
  successfully authorized board is cached against that exact user/patient pair so its
  phrase tiles survive an offline reload; stale authorization cannot be recovered from it.
- **D2** expiring listener capability and localized public screen exist. A link sees only
  confirmed utterances created after it was minted, and the sharing UI can revoke it through
  a patient-authorized, retry-idempotent endpoint. The active capability recovers after
  reload and a replacement supersedes the previous URL. There is no live patient-speech
  recognition source yet.
- **D3** a real LoRA/PEFT training runtime for MMS / Wav2Vec2 CTC exists
  (`backend/app/ml/train/asr_runtime/`) and has trained nothing; no adapter, WER, or
  intelligibility number exists and no model runs in the product. It is unreachable without
  a signed purpose-specific governance receipt, local base weights and a GPU host, and its
  synthetic dry-run writes only a private manifest.
- **D4** explicitly-consented card/audio pairs now stay in an on-device IndexedDB vault;
  the server retains only UUID/duration/integrity/consent/deletion receipts. Worst-first text review
  remains retryable, and an explicitly consented fresh repeat can pair the verified label
  with a local WAV. Original unclear conversational audio is still not captured.
- **D5** feature-routing and frozen-adapter drift algorithms exist as tested scaffolding;
  there is no production audio ingestion or adapter lifecycle behind them.

### Frontend
`CcgTrace` (clinical CCG layout), `DhiForm`, `VertigoLog`, `WearableLanes`, `AshaHome`
(offline-first, idempotent sync), `StepSvv` (rotating-field SVV capture with abort).
`npm run typecheck` = `tsc -b`; `npm run build` verified exit 0.

---

## Pending

- **Voice cloning** is specified and validated (clip length, backend choice, safeguards)
  but does not train a voice.
- **Awaaz ASR and learning loop** — card-tap audio association and consented local retention
  now exist, as does caregiver-reviewed fresh-repeat audio association, and so does an
  executable governance-gated LoRA/PEFT training runtime. Patient-speech recognition,
  original conversational-audio capture, an actually trained adapter, adapter deployment,
  and production inference do not. Nothing has been trained: there is no adapter file and no
  WER or intelligibility number for Awaaz ASR anywhere in this repository, and there must
  not be a model card for one until a governed run has happened and been reviewed. The
  optional GPU stack (`backend/requirements-train.txt`) has never been installed or verified
  here.
- ~~**Seven open findings against `asr_runtime`**~~ — **ALL SEVEN FIXED.** Governance
  receipts are Ed25519 with public halves pinned in tracked config (D-067 supersedes D-059);
  the synthetic-smoke path now goes through the same containment funnel; splits carry a size
  floor and ceiling and publish achieved fractions beside target ones; `epochs_completed`
  counts only an exhausted epoch and the manifest distinguishes a truncated run; an
  `.incomplete` sentinel closes the orphan-adapter window; the sanitizer screens
  `target_text`; and the base-model snapshot no longer passes through shared temp. Each fix
  is pinned by a test verified to fail when the fix is reverted. `PRD_AWAAZ.md` §9.3 carries
  the table.
- **Offline policy evaluation has no eligible input.** `backend/app/ml/rl/` runs offline and
  synthetic only; the production Awaaz schema records no slate, policy version, logged
  propensity, or outcome, so no current product event can be used. `docs/PLAN_RL.md`.
- **Awaaz emergency completion** — configure and field-test the SMTP caregiver provider,
  then add a consented caregiver phone/contact contract if direct caregiver dialing is
  required. The explicit 108 dialer action exists. Offline playback and provider delivery
  are reported successful only when the local WAV starts and SMTP accepts the recipient
  respectively; opening a dialer is never reported as a completed call.
- **ML models run on synthetic fixtures only.** All five. `docs/ML_STATUS.md` states this
  per model, and the model cards are rendered from `artifacts/*.metrics.json` by
  `python -m app.ml.train.render_model_cards`, so the generated body cannot quietly claim
  otherwise — `--check` exits 1 on a stale card and a test re-renders each one and compares
  it byte-for-byte. The hand-written `## Purpose` section, delimited by
  `<!-- hand-written: purpose -->` markers, is carried through untouched and is the one part
  that can still drift. Three datasets need a human to request access.
- **Clinician PDF export** — built as a browser print-to-PDF view, not as server-side
  generation. `frontend/src/routes/ClinicianReport.tsx` carries the print layout and tells
  the clinician to use the browser print dialog and choose Save as PDF; there is no PDF
  endpoint in any router and none is needed for that approach. This entry previously read
  "not built", which was true only of server-side rendering.
- **CCG baseline side-by-side** — the trace renders; comparison against the patient's own
  earlier trace does not.
- **Task demo videos** — `TaskShell` displays them and the flow is built around them, but
  no clips have been recorded. Needs a person to film.
- **Nothing has run on a physical phone.** Camera framing, pose scaling at 1.5 m and the
  handset-tilt SVV path are desktop-browser only. This is the largest untested surface in
  the product.
- ~~No deployment to Railway or Neon yet~~ — **DONE.** Both live; Postgres is the
  production database and the seed persists across deploys.
- ~~Migrations have never been executed against Postgres, only rendered~~ — **DONE, and the
  prediction was right.** The first Neon boot was the real test and it failed twice:
  `WHERE locked = 1` in migration 0004, then an unconditional `PRAGMA foreign_keys=ON` in
  `env.py`. Both invisible to `--sql` rendering, because the text inside `op.execute` renders
  identically for either dialect. Fixed and pinned by `test_migration_portability.py`; D-014.
- Dataset requests not yet sent — `docs/DATASET_REQUESTS.md` has the exact emails and forms.
- Real-device validation of M3/M9 against the clinical values in `CLINICAL_REFERENCE.md`.

---

## Known risks

1. **One reference patient is not a validation set.** The calibration targets are a sanity
   bound, nothing more.
2. **M9 needs a carer to film and stand close.** The patient is being deliberately made
   unsteady with their eyes shut. If that supervision does not happen, the module is a fall
   risk, not a measurement.
3. **The frozen reference assumes the baseline window was itself representative.** A patient
   already declining during baseline collection has a compromised reference.
4. **On TIER_1, balance cannot establish a side.** M9's low-motion subset runs on a
   caregiver-filmed phone and measures how unsteady someone is, but every one of its
   laterality features lives in the deferred walking and stepping tests. M3 oculomotor
   carries laterality for those patients. If M3 capture quality turns out to be poor in the
   field, phone-only patients lose posterior laterality entirely — that is the risk to watch.
5. **A governance receipt now proves approval, but nobody can issue one yet.** The scheme
   is Ed25519: verifying no longer confers the ability to sign, the signing function is gone
   from the shipped package, and public halves are pinned in tracked config rather than read
   from operator-set environment variables. Both halves were needed — asymmetric crypto alone
   would have left the operator free to pin their own public key. What remains open is
   custody, not code: `governance_public_keys.json` ships empty, so the runtime refuses every
   real command, and it stays that way until a clinical owner generates a keypair offline and
   someone other than the training operator commits the public half. `GOVERNANCE_KEYS.md`.
6. **Saccade velocity is undersampled at phone frame rates.** At 30 fps a saccade spans one
   to three frames, so peak velocity is an average that understates the true peak. Recorded
   and flagged (`velocity_confidence` 0.00 at 30 fps) rather than corrected. Latency is
   usable for trending; velocity is not comparable to published normative values.
