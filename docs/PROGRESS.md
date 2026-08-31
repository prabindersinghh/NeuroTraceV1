# PROGRESS

Current state of NeuroTrace. A stranger should be able to continue from this file alone.

## TASK_FINAL_TECHNICAL_COMPLETION.md — in progress

Nine-part build (`TASK_FINAL_TECHNICAL_COMPLETION.md`, repo root). Order per the task:
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

**Not done, deliberately:** the clinician baseline-review *frontend*. Backend first was the
agreed order; the review view, the queue entry, and the ABANDONED reason surface are a
follow-up commit.

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

**Still to do:** the auth pass (invite flow, credentials — accounts are created disabled
until then).

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

**Last updated:** 2026-08-31 · **The UX branch is merged to `main` and DEPLOYED**
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
Daily Pulse session** (caught by oxlint, not by any test). `UX-CHANGES.md` carries the
deferred items; **automatic offline drain is flagged there as a data-integrity fix, not
polish** — an offline queue that never drains loses sessions silently. ·
Earlier: two independent sessions landed the same day
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

### Awaaz — D1 through D5
- **D1** phrase board, emergency mode, auto-speak gate (INV-9).
- **D2** listener mode: expiring revocable link, display name only, context-aware coaching
  in three languages. **Screen built** — `Listen.tsx` at `/listen/:token`, no auth because
  the unguessable token is the capability, and no name, band or history for a stranger.
- **D4** passive learning: card taps give free labelled pairs; caregiver evening queue is
  worst-first and capped at 12. **Screen built** — `ReviewQueue.tsx` at `/review/:patientId`;
  "nothing to review" is shown as success, not emptiness. Both screens were unreachable
  until Awaaz got quiet caregiver entry points below the speaking surface.
- **D5** convergence: conversational features route into M4/M5; prompted-only features
  (DDK, sustained phonation) are deliberately *not* inferred from free speech. Frozen
  day-30 adapter catches decline the live adapter hides.

### Frontend
`CcgTrace` (clinical CCG layout), `DhiForm`, `VertigoLog`, `WearableLanes`, `AshaHome`
(offline-first, idempotent sync), `StepSvv` (rotating-field SVV capture with abort).
`npm run typecheck` = `tsc -b`; `npm run build` verified exit 0.

---

## Pending

*(Awaaz D2–D5 and the ASHA / wearable / CCG / DHI / vertigo frontend surfaces were listed
here and are now built — see the sections above. Left as a note because a Pending list that
never shrinks is a list nobody reads.)*

- **Voice cloning** is specified and validated (clip length, backend choice, safeguards)
  but does not train a voice.
- **ML models run on synthetic fixtures only.** All five. `docs/ML_STATUS.md` states this
  per model, and the model cards are generated from the artifact metrics so they cannot
  quietly claim otherwise. Three datasets need a human to request access.
- **Clinician PDF export** — not built. The data endpoint it would render exists.
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
5. **Saccade velocity is undersampled at phone frame rates.** At 30 fps a saccade spans one
   to three frames, so peak velocity is an average that understates the true peak. Recorded
   and flagged (`velocity_confidence` 0.00 at 30 fps) rather than corrected. Latency is
   usable for trending; velocity is not comparable to published normative values.
