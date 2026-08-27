# PROGRESS

Current state of NeuroTrace. A stranger should be able to continue from this file alone.

**Last updated:** 2026-08-28 · Awaaz now captures explicitly-consented 16 kHz practice WAVs
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
and the public capability is immediately dead. Consented local pairs can now be SHA-256
verified into a versioned tar only after the user acknowledges that the voice archive leaves protected app
storage; NeuroTrace does not upload it. The backend can verify that tar without extraction and rejects unsafe paths,
undeclared files, invalid associations, oversized/non-WAV data and hash mismatches. The
adapter command then exits without writing a model or non-synthetic metrics: real LoRA
training is still unimplemented. Previous project
history follows. ·
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
- **D2** expiring listener capability and localized public screen exist. A link sees only
  confirmed utterances created after it was minted, and the sharing UI can revoke it through
  a patient-authorized, retry-idempotent endpoint. There is no live patient-speech
  recognition source yet.
- **D3** adapter pipeline is synthetic scaffolding only; no model runs in the product.
- **D4** explicitly-consented card/audio pairs now stay in an on-device IndexedDB vault;
  the server retains only UUID/duration/integrity/consent/deletion receipts. Worst-first text review
  remains retryable, but reviewed free speech has no associated audio yet.
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
  now exist. Patient-speech recognition, caregiver-reviewed audio association, adapter
  training/deployment, and production inference do not.
- **Awaaz emergency completion** — configure and field-test the SMTP caregiver provider,
  then add a consented caregiver phone/contact contract if direct caregiver dialing is
  required. The explicit 108 dialer action exists. Offline playback and provider delivery
  are reported successful only when the local WAV starts and SMTP accepts the recipient
  respectively; opening a dialer is never reported as a completed call.
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
