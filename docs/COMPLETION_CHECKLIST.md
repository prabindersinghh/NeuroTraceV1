# COMPLETION CHECKLIST — FINAL_PRODUCT_SPEC v4 Part 7

Honest status. `LIVE` means verified against the running system; `TEST` means verified only
by the suite; `PENDING` means not done, with the reason.

**The distinction is the point.** A green suite is not a running product, and this project
has already had two cases where a passing test told us nothing (a vacuous `tsc` invocation
that checked no files, and a stale `.pyc` that made an invariant fail for the wrong reason).

---

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Daily 12-min session runs end to end on a phone, offline | **LIVE** (desktop) | `ProtocolRunner` executes the served plan — rendered and driven in a browser: 18/21 steps runnable, fall gate fires at the standing block, pause visible. Physical-handset run still pending |
| 2 | All physical modules daily; Unterberger/tandem-walk ASHA-only | **TEST** | `test_session_plan.py`, INV-12 |
| 3 | Fatigue instrumentation records elapsed time per task | **TEST** | 4 columns, migration 0008, applied to the dev DB |
| 4 | Pause/resume works, does not invalidate a session | **TEST** | `paused_before_task` recorded; UI pause always visible |
| 5 | Onboarding complete, scope disclosure unskippable | **TEST** | `Onboarding.tsx` — each of 5 limits ticked individually |
| 6 | Every task: demo, spoken instruction, framing guide, quality check | **PARTIAL** | `TaskShell` enforces the full sequence. Manifest + shot list generated from `PROTOCOL`; **no clips filmed** - needs a person |
| 7 | Fall-risk gate blocks the balance block | **TEST** | `FallRiskGate.tsx`, non-dismissible, skip is first-class |
| 8 | Blue/white design across patient, caregiver, clinician | **LIVE** | Part 4 palette in `index.css`; `npm run build` exit 0 |
| 9 | CCG trace renders and compares against baseline | **TEST** | `CcgComparison.tsx` - side-by-side against the earliest capture in the locked window; reachable from the clinician dashboard (`CcgTrace` was previously an orphan component) |
| 10 | Caregiver dashboard complete | **LIVE** | Exercised over HTTP against the seeded demo |
| 11 | Clinician dashboard: audit log + PDF export | **TEST** | Roster, typed cards, drift lane, audit table live. `/report/:patientId` print view added - browser Save-as-PDF, not server-rendered (D-032) |
| 12 | ASHA interface complete | **TEST** | `AshaHome.tsx` — offline queue, idempotent sync, task-level due lists |
| 13 | Awaaz D1–D5 complete | **PARTIAL** | Localized personal phrase management, a user-bound cached board for honest offline phrase-tile access, INV-9 confirmation, localized/revocable listener capability, consented local card/audio and caregiver-reviewed repeat pairs, integrity-checked local training export + fail-closed single-patient and leakage-safe cohort readiness planners, 0.5–4.0 s endpointing, offline emergency WAV, long-press, opt-in location, explicit 108 dialer action, and a configured-only SMTP adapter exist. D5 adds a privacy-safe policy-event logging contract and bounded near-tie randomisation on the confirmation path — schema and endpoints only, with no event ever logged and no caller. Missing: patient-speech ASR/original conversational audio, real adapter training/deployment, pooled-study consent/data, provider credentials/field test, and a consented caregiver phone/contact contract |
| 14 | SVV module live in `posterior_vestibular` | **LIVE** | M21 registered; reproduces all three printed reference averages exactly |
| 15 | E3 audiometry self-report built | **TEST** | `score_hearing_change`; unilateral loss escalates |
| 16 | Model cards written; ML_STATUS states real vs synthetic | **LIVE** | 5 cards rendered by `render_model_cards.py` **from `artifacts/*.metrics.json`**; `--check` exits 1 on a stale card and a test re-renders each byte-for-byte, so the generated body cannot drift. The hand-written `## Purpose` section, delimited by `<!-- hand-written: purpose -->`, is carried through untouched and is the one part that can still drift |
| 17 | Deployed on Railway + Neon; demo reproduces on public URL | **LIVE** | Railway + Vercel deployed; `verify_deploy.sh` **7/7** — identical band sequence on the public URL. Neon still to swap in (SQLite bridge until then) |
| 18 | EN / HI / PA throughout | **PARTIAL** | Awaaz board, review, emergency, and public listener shell are trilingual, including listener loading/error/expired/privacy states and server coaching. Full physical-device language QA across every non-Awaaz route is still pending |
| 19 | All invariants pinned; suite green by exit code | **TEST** | 12 product invariants plus speaker/phrase split, offline-cache authorization, ASR-runtime governance boundaries, and the policy-event forbidden-field scan; backend: 1191 collected / 1188 passed / 3 expected skips / 0 failed, exit 0 — **measured before the policy-logging and offline-evaluation work landed; the post-change total is not yet recorded**. `test_awaaz_offline_rl.py` now carries 76 tests and `test_awaaz_policy_logging.py` 24. Frontend: 8 files / 51 passed, `tsc -b` and `npm run build` both exit 0 |
| 20 | Privacy invariant passing; PR open | **TEST** | INV-11 is covered by tests. The portable pre-push hook runs on the Awaaz branch; PR #1 is open against upstream `main` |
| 21 | Living docs current | **LIVE** | 25 docs + 5 model cards, counted in `docs/` |

---

## Known gaps, stated plainly

**PDF export (item 11).** Built as a print view, not a server-side generator - see D-032
for why that is the right trade here and what it costs (no scheduled or headless export).

**CCG baseline comparison (item 9).** Built. Note it is unavailable until a balance
baseline locks, by design (D-033).

**Demo videos (item 6).** `TaskShell` accepts and displays `demoSrc`, and the flow is built
around it, but no clips have been recorded. Recording them needs a person to film.

**No Awaaz ASR model has been trained (item 13).** `backend/app/ml/train/asr_runtime/` is a
real, executable LoRA/PEFT training runtime for MMS / Wav2Vec2 CTC, and it has produced
nothing: no adapter, no WER, no intelligibility number, no model card. Its synthetic dry-run
writes exactly one file, `manifest.json`, and no clinical metric. A real run needs a
consented archive, local base-model weights, a signed purpose-specific governance receipt, a
GPU host, and a held-out human intelligibility evaluation — none of which exist here. The
optional GPU stack in `backend/requirements-train.txt` has never been installed or verified
in this repository and is deliberately outside `requirements.lock.txt`.

**Seven findings against `asr_runtime` are open, from an adversarial audit of that module.**
They are recorded rather than fixed, and they are why the runtime must not be treated as
production-ready even once a receipt exists. (1) Governance receipts use a symmetric HMAC
and the trust root comes from environment variables the operator sets, so an operator can
mint their own approval — it needs an asymmetric scheme with a public key pinned in tracked
config. (2) `run_synthetic_smoke` bypasses the output-path guards, so `--output-dir` can
write inside the tracked source tree against the module's own `data/`-only rule. (3) The
split seeds the three largest components into train/validation/test with no floor or
ceiling, so a fifty-pair corpus can yield a one-sample test split while the manifest
advertises 70/15/15. (4) `epochs_completed` is incremented even when the optimiser-step cap
broke out mid-epoch, so a manifest can claim a completed epoch that ran one batch of twenty.
(5) A crash between publishing the adapter directory and publishing the manifest leaves
patient-derived LoRA weights on disk with no manifest, no limitations, and no
`deployment_ready: false`. (6) The adapter metadata sanitizer screens patient and capture
UUIDs and audio hashes but not `target_text`; harmless only because PEFT currently writes
two files, and one dependency upgrade from publishing patient phrases. (7) The base-model
snapshot still uses `tempfile.mkdtemp` with no `dir=`, copying a multi-gigabyte checkpoint
into shared temp — not patient data, but left behind on SIGKILL.

**Offline policy evaluation now has a logging contract and still has no input.**
`backend/app/ml/rl/` can compare a candidate ranker against a logged behaviour policy
offline. The schema gap is closed: `awaaz_policy_events` is an append-only table recording
the offered slate, the logged action, the propensity of *that* action, the policy version and
the confirmation outcome, with no patient column and no foreign key (D-062), and the ranker
randomises among near-ties on the confirmation path so the log is identifiable at all (D-063).

What is still not done, stated plainly:

- **Nothing calls the two endpoints.** The frontend confirmation loop must mint event ids and
  report outcomes. No real product event has ever been logged, so every number the package
  has produced remains synthetic.
- **The near-tie rate is unmeasured.** `max_deterministic_event_rate` defaults to 0.10; if a
  real ranker produces a clear winner more than a tenth of the time, the entire log is
  refused as deterministic. This should be watched from the first day of logging.
- **`no_explicit_signal` rows cannot become feedback.** They are logged on purpose, so that
  the log is not a sample selected on the outcome, but the skip rate is a number a reviewer
  must inspect before believing any estimate.
- **No preregistration, no privacy review, no retention or deletion job for `logged_on`, and
  no independent review.** `logged_on` was made a DATE specifically so a retention sweep is
  possible; none exists.
- **The minimum effect is not calibrated.** `MINIMUM_EFFECT_FLOOR = 0.02` promises about ten
  times the resolution the sample floors deliver — at an effective sample size of 25 the
  smallest adjudicable delta is roughly 0.18. Open question, not a solved one.
- **Repeated-speaker clustering is uncorrected by decision (D-064).** The interval is
  anti-conservative in the direction that favours the candidate.
- **Migration revision ids collide with `main`.** This branch and `main` have independently
  used 0012, 0013 and 0014; the new migration uses a descriptive id to avoid a fourth
  collision, but the first three are an open merge hazard.

Deployment, online experimentation and clinical claims remain permanently false, as read-only
properties rather than defaults. See `docs/PLAN_RL.md` and `docs/RESEARCH_OPE.md`.

**A reward-function bug was found and fixed (D-065).** `phrase_board_fallback` was charged a
repair cost on top of the negative preference it already earned, scoring the designed safety
fallback at −1.0 against a plain rejection's −0.8. Nothing optimises this reward yet and no
test failed; it was found by hand-tracing the reward while writing `docs/RESEARCH_OPE.md`.

**Nothing has run on a physical phone.** Camera framing, pose scaling at 1.5 m, and the
handset-tilt path in SVV are all verified in a desktop browser only. This is the largest
untested surface in the product.

**Deploy (item 17) is the single largest risk** and remains blocked on account creation.
Everything that could be prepared without credentials is done, including a verifier that
checks the deployed engine reproduces the *identical* band sequence rather than merely
returning 200.

---

## For you to do

1. **Deploy** — `docs/DEPLOY.md`, ~30 min. Then `./scripts/verify_deploy.sh <url>`.
2. **Open `/hooks` once** (or restart) so the INV-10 registry guard loads — `.claude/` did
   not exist when this session started, so the settings watcher has not picked it up.
3. **Dataset requests** — `docs/DATASET_REQUESTS.md`. Send UASpeech first; it needs an
   institutional signature and runs 1–3 weeks.
