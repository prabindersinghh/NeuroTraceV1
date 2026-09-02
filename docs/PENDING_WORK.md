# PENDING_WORK — everything unfinished, and whether you can actually finish it

**Compiled:** 2026-08-31, against commit `b87d6d1` on `codex/awaaz-contract-foundation`,
**plus an uncommitted working tree** (see P-0). Every claim below was checked against the
code, not against the document that made it. Where a doc and the code disagree, the code
wins and the doc is named.

**Read this file as a work queue, not as a status report.** `PROGRESS.md` and
`COMPLETION_CHECKLIST.md` describe what exists; this describes what does not, and who is
capable of changing that.

> **Addendum, written minutes after the rest of this file: the tree moved underneath it.**
> Commit `2af4274` *"docs: write the governance-key procedure, and settle three stale claims"*
> landed during compilation. It creates **`docs/GOVERNANCE_KEYS.md`**, which closes **P-2**,
> and commits the three doc corrections listed under P-0. A new `docs/CODEBASE_MAP.md`
> appeared with it. In the same window `frontend/src/lib/awaazPolicyLog.ts` acquired a test
> file and is now imported by `Awaaz.tsx:95` — **P-7 is in flight**, not untouched, and
> `backend/tests/test_awaaz_policy_retention.py` now exists, which closes the testing half of
> **P-11**. Re-check P-0, P-2, P-7 and P-11 against `git status` before starting any of them.
> Everything else below was verified at `b87d6d1` and is unaffected.

## Classification key

| Label | Means |
|---|---|
| **BUILDABLE NOW** | An engineer with this repo and no external dependency can finish it today. |
| **BLOCKED — EXTERNAL FACT** | Needs consented data, a checkpoint, a GPU host, a signature, a cohort, a key, credentials, or a physical device. |
| **BLOCKED — DECISION** | Needs a judgement call from the project owner. Options are stated. |
| **STALE / ALREADY DONE** | A doc says pending; the code says otherwise. Cited. |

Sizes: **S** ≈ under a day · **M** ≈ a few days · **L** ≈ a week or more.

---

# 0 · Read this first

## P-0 · The working tree is dirty and contains unreviewed in-flight work · BUILDABLE NOW · S

`git status` is not clean. Four tracked files are modified and **two new files are
untracked and therefore in no commit, no PR, and no backup**:

| Path | State | What it is |
|---|---|---|
| `backend/app/services/policy_retention.py` | **untracked**, 265 lines | The `awaaz_policy_events` retention sweep that every doc says does not exist (P-19) |
| `frontend/src/lib/awaazPolicyLog.ts` | **untracked**, 354 lines | The frontend policy-logging client that every doc says does not exist (P-18) |
| `backend/app/routers/awaaz.py` | modified, +51 | Adds `POST /awaaz/policy/retention/sweep`, admin-only, at `awaaz.py:1207` |
| `docs/PROGRESS.md` | modified | Corrects the "Clinician PDF export — not built" line (P-S3) |
| `docs/COMPLETION_CHECKLIST.md` | modified | Corrects item 17's "SQLite bridge" note (P-S2) |
| `docs/DEVELOPMENT.md` | modified | Corrects "M1–M20" to 21 (P-S4) |

Two of the four contradictions this document was asked to settle were *already being
settled in the working tree* when it was written. That is good, and it is also why nothing
here should be trusted from the committed docs alone.

**Done looks like:** the two untracked files are committed with tests (P-19 has none), the
doc corrections land, and PR #1 is updated. Until then this work is one `rm -rf` from gone.

**Depends on:** nothing. Do this before anything else on this list.

---

# 1 · STALE / ALREADY DONE — stop treating these as pending

## P-S1 · The seven `asr_runtime` audit findings are ALL FIXED · code verified

**Claimed open in four places, all wrong:**
`PROGRESS.md:328-334` ("deliberately not fixed in this session"), `PROGRESS.md:388-393`
(Known risk 5, "proves possession of a key, not approval"), `COMPLETION_CHECKLIST.md:58-76`
("Seven findings … are open"), `PLAN_AWAAZ.md:214-249` (risks 4–10, each "Found by audit,
not fixed").

**Correct in one place:** `PRD_AWAAZ.md:272-296` (§9.3, "all seven resolved"), and
`DECISIONS.md:799-820` (D-067 supersedes D-059).

Verified line by line in `backend/app/ml/train/asr_runtime/runtime.py`:

| # | Finding | Fix, in code |
|---|---|---|
| 1 | Symmetric HMAC receipts, env-var trust root | Ed25519 (`runtime.py:83`); trust root is a module constant (`:81`) loaded by `_load_pinned_governance_keys` (`:432-488`) which takes no argument, refuses symlinks (`:446-450`) and group-writable files (`:453-457`); signing helper deleted from the package (`:345-348`); `_verify_ed25519_signature` at `:506-541` |
| 2 | `run_synthetic_smoke` escaped the output guard | Containment moved into `_assert_output_location_contained` (`:976-1027`), called unconditionally from `_create_staging_directory` (`:1479`) — the one funnel every writer uses |
| 3 | Split had no size floor | `MINIMUM_SPLIT_SAMPLES` / share bounds (`:97-99`), `_assert_split_adequate` (`:732-754`) raising `split_too_small` / `split_unbalanced` |
| 4 | `epochs_completed` overstated a truncated epoch | `_optimise_lora` increments only on a genuinely exhausted epoch (`:2210-2222`); status `truncated_before_completion` (`:2305`) |
| 5 | Orphan-adapter window | `.incomplete` sentinel fsynced before the first move, `manifest.json` moved last, sentinel cleared after (`:1550-1594`); `verify_published_artifact` refuses a sentinel (`:1531-1547`) |
| 6 | Sanitizer blind to `target_text` | `_screened_phrases` (`:2016-2040`) + `_contains_screened_phrase` (`:2043-2051`), enforced at `:2137-2140` |
| 7 | Base-model snapshot in shared temp | `dir=` now passed (`:1866-1871`); staging likewise (`:1481`) |

**Two deliberate residual gaps remain and are documented in code, not open findings:**
utterances under 12 characters / 2 words are excluded from screening (`runtime.py:97-103`),
and tensor payloads are not inspected (`:2093-2095`).

**Action:** correct the four stale passages (P-1). Do not re-do the work.

## P-S2 · Neon Postgres is live; there is no "SQLite bridge" · code verified

`config.py:30` defaults to `postgresql+asyncpg://…`. The validator at `config.py:64-97`
exists specifically to repair a pasted Neon URL (`channel_binding` dropped at `:89-90`,
`sslmode` → `ssl=require` at `:91-94`), pinned by `test_config_urls.py:38-39`. Production
`/health` returns `database: up`. `DEPLOY.md:12-15` describes two migrations that **failed
on a real Neon boot** — which is proof Neon was used.

`COMPLETION_CHECKLIST.md:30` (item 17) has **already been corrected in the working tree**.
The one remaining wrong sentence in the repository is **`DEPLOY.md:7-8`**: *"Database is
container-local SQLite until Neon."* That is the stale doc. Fix in P-3.

SQLite support in `db.py:31-47` and `alembic/env.py:79-132` is not a bridge — it is the
deliberate dual-dialect path the whole test suite runs on (`conftest.py:36,42`).

## P-S3 · The clinician PDF export is built · code verified

`ClinicianReport.tsx:53-196`, routed at `App.tsx:103`, lazy-imported at `App.tsx:24`,
linked from `Dashboard.tsx:332`. `window.print()` at `ClinicianReport.tsx:82`; the print
stylesheet is two Tailwind `print:` variants at `:76` and `:78`. Fed by
`GET /report/{patient_id}` (`clinical_data.py:115`) via `api.examReport`
(`api.ts:264-265`), which writes an audit row `report.export` (`clinical_data.py:136`).

There is **no** server-side PDF generation anywhere — zero hits for
`reportlab|weasyprint|puppeteer|pdfkit|jspdf`. That is D-032 (`DECISIONS.md:225-229`), a
decision, not a gap. `PROGRESS.md:350` said "not built"; it has **already been corrected in
the working tree**. `COMPLETION_CHECKLIST.md:24` and `:40` were right all along.

## P-S4 · The registry holds 21 modules, and `DEVELOPMENT.md` already says so

`registry.py:194-435` registers M1…M21. `DEVELOPMENT.md:83` has **already been corrected in
the working tree** to "each of the 21 modules … counted, not assumed".

**But two stale strings and a real coverage hole survive** — see P-9 and P-10:
- `registry.py:3` still says "all twenty modules".
- `test_exam_modules.py:1` still says "Exam modules M1-M20".
- The per-extractor tests in that file cover M1, M5–M8, M10–M20. **M2, M3, M9 and M21 are
  not covered by it**; M3/M9/M21 are covered by `test_posterior_circulation.py:110-151,
  171-419, 506-536`, and **M2 (`extract_tongue_palate`) is tested nowhere in the repo**.

## P-S5 · CCG baseline side-by-side is built and reachable

`PROGRESS.md:355` says "comparison against the patient's own earlier trace does not
[render]". **False.** `CcgComparison.tsx:59` renders two `CcgTrace`s (`:99`, `:112`) and is
mounted at `Dashboard.tsx:325` (imported `:21`). `COMPLETION_CHECKLIST.md:22` and `:43` are
correct, including the caveat that it is unavailable until a balance baseline locks (D-033,
`DECISIONS.md:220-223`). Fix the PROGRESS line in P-1.

## P-S6 · "PLAN_AWAAZ D3 adapter shipment / model registry" is NOT delivered by `asr_runtime`

This one is **not** stale — the resolution goes the other way. `PLAN_AWAAZ.md:164` promises
"per-patient LoRA adapters, trained nightly server-side, **shipped back for local
inference**". The runtime that now exists is a **trainer only** and says so:

- CLI has exactly three subcommands — `synthetic-smoke`, `preflight`, `train`
  (`runtime.py:2418,:2425,:2431`). Nothing registers, versions, promotes or ships.
- The manifest states it: `runtime.py:2285` — *"The adapter is not registered, shipped, or
  deployment-ready."*
- `verify_published_artifact` (`runtime.py:1531`) has **no caller outside tests**
  (`test_asr_runtime_gates.py:2174,2183,2188`).
- **No adapter is loaded at inference anywhere.** No file under `backend/app` outside
  `asr_runtime/` imports it; `app/ml/speech.py` is librosa/parselmouth feature extraction
  with no model loading; `routers/awaaz.py` has zero adapter hits.

`PRD_AWAAZ.md:211` (AWA-FR-012, on-device inference) correctly reads PLANNED, and
`ML_RECOVERY.md:30-44` specifies the registry as a *contract*, not an implementation.
**PLAN_AWAAZ D3's shipment bullet should be re-labelled PLANNED so the two documents stop
disagreeing** (part of P-1). The registry itself is P-25 (blocked).

---

# 2 · BUILDABLE NOW

## P-1 · Reconcile the four stale doc passages · S
**Where claimed:** `PROGRESS.md:328-334`, `:355`, `:388-393`; `COMPLETION_CHECKLIST.md:58-76`;
`PLAN_AWAAZ.md:164`, `:214-249`.
**Done looks like:** the seven-findings passages replaced by a pointer to `PRD_AWAAZ.md:272-296`
and D-067; PROGRESS Known-risk 5 struck (superseded); the CCG line corrected;
PLAN_AWAAZ D3's shipment bullet re-labelled PLANNED. Nothing else in those files touched.
**Depends on:** P-0 (land the tree first so you are not editing over uncommitted edits).

## P-2 · Write `docs/GOVERNANCE_KEYS.md` · S
**Where claimed:** referenced from three places and **does not exist** —
`DECISIONS.md:820`, `asr_runtime/__init__.py:5`, `governance_public_keys.json:15`.
**Done looks like:** a procedure a non-engineer clinical owner can follow: generate an
Ed25519 keypair offline, keep the private half off every training host, publish only the
64-char hex public half, and the exact entry shape (`key_id`, `algorithm`, `public_key`,
`not_before`, `not_after`, `holder`) already specified in `governance_public_keys.json`.
Must state the separation-of-duties rule: whoever runs training must not be the person who
commits the key.
**Depends on:** nothing. **Unblocks:** P-22 (a human can act on it).

## P-3 · Delete the "SQLite until Neon" sentence in `DEPLOY.md:7-8` · S
**Done looks like:** the STATUS banner says Neon Postgres is the production database, which
the rest of the same banner already implies at `:12-15`.

## P-4 · Route `AshaHome` — the ASHA interface is unreachable · M
**Where claimed done:** `COMPLETION_CHECKLIST.md:25` (item 12, "ASHA interface complete"),
`PROGRESS.md:223`.
**What is actually true:** `AshaHome.tsx` (296 lines) is **never imported**. There is no
`/asha` route in `App.tsx:98-114` and no lazy import at `:22-36`. `Home()` at
`App.tsx:81-85` falls through to `<CaregiverHome />` for `asha_worker`, so an ASHA worker
lands on the wrong screen. `Register.tsx:96-98` does not offer the role either — correct,
since D-040 makes it admin-provisioned — but nothing then routes the provisioned user.
The backend half is live and tested: `GET /asha/households` (`asha.py:59`),
`POST /asha/session` (`asha.py:92`), called from `AshaHome.tsx:103,133`.
**Done looks like:** a guarded `/asha` route, `Home()` dispatching `asha_worker` to it, and
a test asserting an `asha_worker` session lands on the household list.
**Depends on:** nothing.

## P-5 · Reach `DhiForm`, `VertigoLog`, `WearableLanes` — three orphan components · M
**Where claimed done:** `PROGRESS.md:308-310` lists all three as built frontend;
`PROGRESS.md:222` claims wearable ingestion; the DHI and vertigo log are claimed complete
as CLINICAL_AMENDMENT_v3 item E (`PROGRESS.md:160`).
**What is actually true:** none of the three is imported anywhere.
- `DhiForm.tsx:71` is the **only** DHI producer in the product. The scorer exists
  (`questionnaires.py:185`, registered `:259`) but `ProtocolRunner.tsx:275` submits only
  `"PHQ2"`. **No patient can ever complete a DHI in the app.**
- `VertigoLog.tsx:60` — same shape; backend scorer exists at `questionnaires.py:215+`.
- `WearableLanes.tsx:64` is the only consumer of `api.wearableSeries` / `api.falls` /
  `api.acknowledgeFall` (`api.ts:230,234,237`), so the **entire wearable feature is dead in
  both directions**: `routers/wearable.py` has 5 routes, 14 test references, and no live
  client.
**Done looks like:** DHI and the vertigo log reachable from the caregiver or exam surface
on their registered schedules (DHI is a `posterior_vestibular` instrument; M20 symptoms is
`schedule=ANY`); `WearableLanes` mounted on the dashboard for TIER_2/3 patients, or the
wearable feature explicitly marked deferred in the checklist rather than "complete".
**Depends on:** nothing. Note this is the item where the checklist is most misleading.

## P-6 · `TaskShell` is dead code; the checklist cites it as the evidence · S
**Where claimed:** `COMPLETION_CHECKLIST.md:19` (item 6) — *"`TaskShell` enforces the full
sequence"*.
**What is actually true:** `TaskShell.tsx` (289 lines) is referenced **only in comments**
(`demoClips.ts:13,49`, `ProtocolRunner.tsx:178`). `ProtocolRunner.tsx` reimplemented the
demo/instruct/capture flow inline (`:366-388`). The behaviour may be equivalent; the cited
evidence is not.
**Done looks like:** either `ProtocolRunner` uses `TaskShell`, or `TaskShell` is deleted and
item 6's evidence is re-pointed at `ProtocolRunner.tsx:366-388`. Do not leave both.

## P-7 · Wire the Awaaz confirmation loop to the policy-logging endpoints · M
**Where claimed:** `PROGRESS.md:335-337`, `COMPLETION_CHECKLIST.md:86-88`,
`PLAN_RL.md:216-219` (step 1), `PRD_AWAAZ.md:213` (AWA-FR-014), `ML_STATUS.md:64-70`,
`PRD_AWAAZ.md:366-370`.
**What is actually true, and better than the docs say:** the backend is complete —
`POST /awaaz/{pid}/policy/decision` (`awaaz.py:995`), `POST /awaaz/{pid}/policy/outcome`
(`awaaz.py:1083`), `BEHAVIOUR_POLICY_ID` (`awaaz.py:779`), migration
`0014_awaaz_policy_events.py`, 24 tests. The **API client already exists** —
`api.awaazPolicyDecision` (`api.ts:288`), `api.awaazPolicyOutcome` (`api.ts:292`), types at
`types.ts:437-476`. And `frontend/src/lib/awaazPolicyLog.ts` (354 lines) is written —
**but untracked** (P-0) and **not imported by `Awaaz.tsx`**.
**Done looks like:** `Awaaz.tsx`'s candidate-confirmation path mints an event id, calls
`policyDecision`, renders exactly the returned order, and reports the outcome; a vitest
asserting that a decision failure leaves the confirmation loop behaviourally identical
(the best-effort contract in `awaazPolicyLog.ts:12-18`); the first real row in
`awaaz_policy_events`.
**Depends on:** P-0. **Unblocks:** P-8 — and it is the single gate on every number
`backend/app/ml/rl/` can ever produce from real data.

## P-8 · Measure the near-tie rate · S (once P-7 lands)
**Where claimed:** `PROGRESS.md` header, `COMPLETION_CHECKLIST.md:89-91`,
`PRD_AWAAZ.md:657-659` (open decision 11), `RESEARCH_OPE.md:607-611`, `PLAN_RL.md:223`.
`max_deterministic_event_rate` defaults to `0.10` (`offline.py:121`) and is enforced at
`offline.py:742`. Nobody has measured how often a real slate has a clear winner. If it is
above 10%, **the whole log is refused as deterministic from day one** and P-7 bought
nothing.
**Done looks like:** the fraction of logged events with `randomised=false`, read off the
first few hundred real rows, recorded in `PLAN_RL.md`. This is the first quantity to read.
**Depends on:** P-7.

## P-9 · Test `extract_tongue_palate` (M2) — untested anywhere in the repo · S
**Where claimed covered:** `DEVELOPMENT.md:83` (as corrected) implies all 21.
**What is actually true:** M2's registered extractor (`registry.py:210`, defined
`speech_tasks.py:218`) has no test in `backend/tests/`. It is the only registry module with
none. M4's registered `extract_dysarthria` is also only tested through its sub-functions
(`test_exam_modules.py:221-250`).
**Done looks like:** a fixture test for `extract_tongue_palate`, and one for
`extract_dysarthria` itself.

## P-10 · Remove two dead extractors and fix two stale docstrings · S
`extract_gait_balance` (`coordination.py:116`) and `extract_ocular` (`cognition.py:250`) are
imported into the registry (`registry.py:42`, `:37`) but **assigned to no module**, and
`test_exam_modules.py:366,425` tests them — coverage of code the product never runs.
Also `registry.py:3` ("all twenty modules") and `test_exam_modules.py:1` ("M1-M20").
**Done looks like:** the two extractors deleted or assigned; the two docstrings say 21.

## P-11 · Commit and test the retention sweep · S
**Where claimed missing:** `COMPLETION_CHECKLIST.md:95-97`, `PROGRESS.md` header,
`PLAN_RL.md:230-231` (step 5, "**no such job exists**"), `PRD_AWAAZ.md:660-661` (open
decision 12), `DECISIONS.md:658-663` (D-062 indexed `logged_on` for exactly this).
**What is actually true:** `backend/app/services/policy_retention.py` exists, untracked, and
`POST /awaaz/policy/retention/sweep` is wired admin-only at `awaaz.py:1207`. **There is no
test for either** — `grep policy_retention backend/tests` returns nothing.
**Done looks like:** committed, with tests for idempotence (a repeat call deletes 0), the
`complete: false` continuation contract, the admin-only guard, and the negative test that
the sweep cannot be pointed at `audit_log` (INV-8). Docs updated in the four places above.
**Depends on:** P-0. **Note:** the retention *period* is P-33 (a decision).

## P-12 · Close the open `RESEARCH_OPE.md` §8 rows that are code changes · M
**Where claimed:** `RESEARCH_OPE.md:528-542`, dispositions summarised at `:544-549`.
Still OPEN and each names its landing site:

| Row | Change | Lands on |
|---|---|---|
| 3 | Document that SNIPS's translation-equivariance is the only thing holding a mid-scale zero reward together, and that `ips_reward` does not share it | `rewards.RewardBreakdown` |
| 8 | `ips_reward == snips_reward * weight_mass` identically — correct the docstring so nobody reads agreement as corroboration | `offline._estimate` |
| 9 | Make `MAX_IMPORTANCE_WEIGHT_CEILING` relative: block when `max_importance_weight > 0.1·Σw` in addition to the absolute 20.0 (`offline.py:58`) | `offline._estimate_blockers` |
| 10 | Add position-bias to `LIMITATIONS` as a presentation-confounded proxy | `offline.LIMITATIONS` |
| 11 | Document `inconclusive` as the HCPI *No Solution Found* success | `offline.ComparisonStatus` |
| 13 | Gate or document a rule against sweeping many candidates through `compare_policies` | `compare_policies` API |
| 14 | Add effort-driven satisficing to `LIMITATIONS` | `rewards.RewardConfig` |

Rows 4, 6 and 7 are **decisions**, not builds — see P-30 and P-31.
**Done looks like:** each row's disposition flips from OPEN to FIXED with the cite.
**Depends on:** nothing. None of this needs data.

## P-13 · Automate `verify_deploy.sh` step 7 · S
`scripts/verify_deploy.sh:97-98` prints *"needs a clinician login; see DEPLOY.md step 7 for
the manual check"* and asserts nothing. The "7 passed" figure is honest — there are exactly
7 `ok()` calls across steps 1–6 — but **gate states and laterality have never been verified
against the deployed instance**, only locally.
**Done looks like:** the script authenticates as the seeded clinician and asserts the three
gate booleans and the lateralised domain list, making it 8+ assertions across 7 steps.

## P-14 · Document `DEMO_PASSWORD`, or stop defaulting it · S
`services/seed.py:49` reads `os.environ.get("DEMO_PASSWORD", "neurotrace-demo")`; it becomes
the password of every seeded account (`seed.py:61`) and is returned in the API response
(`seed.py:133`). It is **absent from `backend/.env.example`, `railway.json` and
`DEPLOY.md`** — it appears only in `CLAUDE.md:10` and `scripts/seed_demo.sh:29`. Every
deployment therefore ships a publicly-known password unless an operator happened to read
`CLAUDE.md`.
**Done looks like:** `DEMO_PASSWORD` in `.env.example` and `DEPLOY.md`'s variable table,
and either a random default or a refusal to seed when `DEMO_MODE` is true in a
non-development `env`. Related decision: P-34.

## P-15 · Fix the `/auth/clinician-check` docstring, or delete the endpoint · S
`auth.py:115-121` claims it is used *"by the frontend to confirm a session can open the
dashboard"*. Zero frontend references. Its only callers are tests.
While there: `api.report` (`api.ts:405`) is a dead duplicate of `api.examReport`
(`api.ts:264`) on the same path.

## P-16 · Audit EN/HI/PA key parity outside Awaaz · S
**Where claimed:** `COMPLETION_CHECKLIST.md:31` (item 18, PARTIAL).
`i18n.tsx` carries 248 `en:` keys against 245 each for `hi:` and `pa:`. A three-key gap is
small enough to close statically today; the *physical-device* language QA the row also
names is P-27 (blocked on a phone).
**Done looks like:** a test asserting every key has all three languages, and the three
missing translations supplied.

## P-17 · Download PhysioNet AF 2017 and retrain `rhythm_irregularity_clf` · M
**Where claimed:** `ML_STATUS.md:22` — *"openly downloadable, no excuse"*; `:98`
(`./scripts/download_datasets.sh physionet`); `DATASET_REQUESTS.md:92-95`.
This is the **only** one of the five models whose real data needs no human at all — ODC-BY,
one `curl`. The training script exists (`ml/train/rhythm_irregularity_clf.py`, 208 lines)
and currently has **zero test coverage and zero importers**.
**Done looks like:** `data/raw/physionet_af2017/` populated, the script run on it,
`artifacts/rhythm_irregularity_clf.metrics.json` carrying `"synthetic": false` with a real
confusion matrix, the model card regenerated by `render_model_cards.py`, and `ML_STATUS.md`
row 2 flipped to REAL DATA.
**Depends on:** nothing. **This is the highest-value fully-unblocked item in the repo.**

## P-18 · Cover the SMTP transport that has never executed · S
`emergency_notifications.py:98-126` (`_send_smtp`) — TLS negotiation, the
`starttls`/`ssl`/`none` branching at `config.py:54`, recipient-refusal handling — is
monkeypatched away in the only test that reaches it
(`test_emergency_notifications.py:27-53`). The unmocked assertions are refusals only
(`:22-23`, `:71`).
**Done looks like:** the three security modes exercised against a local `aiosmtpd` or
equivalent, including a recipient refusal. This does **not** replace the field test (P-26),
which needs real credentials.

## P-19 · Resolve the migration revision-id collision with `main` · M
**Where claimed:** `COMPLETION_CHECKLIST.md:103-105`, `DECISIONS.md:677-684` (D-062).
**Verified, and worse than recorded.** `upstream/main` is **50 commits ahead** of this
branch (which is 31 ahead of it) and carries migrations `0012_session_type_daily_pulse`
through `0020_repair_stale_check_constraints`. This branch carries a *different*
`0012_repair_role_constraint`, `0013_on_device_audio_pairs` and `0014_awaaz_policy_events`.
D-062's descriptive id for 0014 **does not fix the problem**: that file's
`down_revision = "0013"` (`0014_awaaz_policy_events.py:41`) still points at an id both
branches define.
**Done looks like:** a rebuilt migration chain whose revision ids are unique across both
branches and whose `down_revision` pointers are unambiguous, with
`test_migration_portability.py` green on both dialects.
**Depends on:** P-32 (rebase vs merge) — you cannot renumber until you know which side moves.

## P-20 · Re-measure the backend suite total · S
`COMPLETION_CHECKLIST.md:32` (item 19) admits its own number is stale: *"measured before the
policy-logging and offline-evaluation work landed; the post-change total is not yet
recorded."* Two files added 100 tests since.
**Done looks like:** a fresh collected/passed/skipped/failed line, taken **after** P-0,
P-7 and P-11 land, since all three add tests.
**Depends on:** P-0, P-7, P-11.

## P-21 · Trivial dangling references · S
- `scripts/preflight_push.sh:20` pins a SHA-256 for `frontend/public/og.png`, and that file
  does not exist (`frontend/public/` holds only `favicon.svg`, `fonts/`, `icons.svg`,
  `mediapipe/`). Harmless — the allow-list simply matches nothing — but it and
  `test_privacy.py`'s `REVIEWED_NON_CLINICAL_IMAGES` claim to be in lockstep about a file
  that isn't there.
- `COMPLETION_CHECKLIST.md:127-129` item 2 ("open `/hooks` once so the INV-10 registry guard
  loads") is an operator action in a local Claude Code session, not repository work. `.claude/`
  now exists with `settings.json`; the item can be struck or verified.

---

# 3 · BLOCKED — EXTERNAL FACT

## P-22 · A governance public key · blocks everything downstream of it
`backend/app/ml/train/asr_runtime/governance_public_keys.json` ships `"keys": []`, and an
empty list is a **refusal**, not a default (`runtime.py:483-487`): every real command exits
`governance_trust_root_missing`. The package cannot even mint a receipt to test against —
pinned by `test_asr_runtime_gates.py:1254`.
**Missing thing:** an Ed25519 keypair generated offline by a **named accountable clinical
owner** (the `holder` field wants "Dr A. N. Other, stroke neurologist"), with only the public
half committed — **by someone who is not the person who can run training**.
**Who supplies it:** the clinical owner named in PRD Phase 1 (`PRD_AWAAZ.md:498`), who does
not yet exist (P-35).
**Depends on:** P-2 (they need the procedure), P-35 (someone has to be the owner).

## P-23 · A consented, clinically characterised cohort and approved protocol
`PRD_AWAAZ.md:210` (AWA-FR-011 BLOCKED), `:506-514` (Phase 2 BLOCKED), `:615` (dataset
registry, "Local Awaaz cohort — MISSING/BLOCKED"), `:670`, `PLAN_AWAAZ.md:170-176`.
**Missing thing:** recruited patients, an approved protocol, consent/capacity process for
aphasia, SLP oversight, secure storage. **Who:** clinical partner + ethics/governance body.

## P-24 · An approved local base checkpoint
`SUPPORTED_MODEL_TYPES = {"wav2vec2"}`; the runtime demands a local `safetensors`
checkpoint whose SHA-256 is bound into the receipt. `PRD_AWAAZ.md:647-648` (open decision 5)
asks which MMS/Wav2Vec2 checkpoint and language adapter may be stored and distributed under
acceptable terms — unanswered.
**Missing thing:** the weights, plus a license review. **Who:** ML owner + legal.

## P-25 · A GPU host, the training stack installed, and an artifact registry
`backend/requirements-train.txt:3-8` states it has **never been installed or verified here**.
Its six pins (`torch==2.4.1`, `transformers==4.44.2`, `peft==0.12.0`, `accelerate==0.34.2`,
`safetensors==0.4.5`, `numpy==1.26.4`) mirror `PINNED_DEPENDENCY_VERSIONS`
(`runtime.py:111-121`) exactly and are enforced as equality (`runtime.py:1238`), pinned by
`test_asr_runtime_gates.py:1815` — but they are **absent from `requirements.lock.txt`**, so
this is a declaration, not a lock, and CUDA wheel selection is punted to the operator
(`requirements-train.txt:42-44`). The encrypted immutable registry and restore drill
(`ML_RECOVERY.md:30-71`) do not exist, and `ML_RECOVERY.md:70-71` makes a failed or
unrecorded drill a **hard block** on real training.
**Missing thing:** a GPU host, a verified install, encrypted object storage in a separate
account, and one completed restore drill. **Who:** infrastructure owner.
**Consequence:** the whole training loop consequently has **zero execution coverage** —
`_load_ml_runtime()` (`runtime.py:1720-1731`) is monkeypatched to bare `object()`s in every
test that reaches it (`test_asr_runtime.py:709,758`, `test_asr_runtime_gates.py:1033`), so
`_resolve_device`, `_seed_runtime` and the optimiser loop at `:2162-2168` have never run.

## P-26 · A held-out human-listener intelligibility evaluation
`PRD_AWAAZ.md:416-426` (§12.3 outline), `:672-674`, `ML_STATUS.md:24`, `:46`.
**Missing thing:** unfamiliar listeners, a pre-registered transcription protocol, and
pre-registered improvement thresholds (`PRD_AWAAZ.md:651-652`, open decision 8).
**Who:** SLP + field-study owner. **Depends on:** P-23.

## P-27 · Nothing has run on a physical phone
`PROGRESS.md:359-361` and `COMPLETION_CHECKLIST.md:115-117` both call this *"the largest
untested surface in the product"*. `FIELD_TEST_PROTOCOL.md` is a complete, ready-to-execute
protocol with four questions (Q1 camera fps, Q2 pose at 1.5 m, Q3 framing time, Q4 fatigue),
a `/diagnostics` page that needs no login, and an observation sheet.
**Missing thing:** a person, a cheap Android, and an afternoon. **Who:** anyone with a phone.
**Consequences named in the protocol itself** (`FIELD_TEST_PROTOCOL.md:139-149`): Q1 decides
whether saccade peak velocity is trendable on TIER_1 at all — and on TIER_1, **M3 is the sole
source of posterior laterality** (`PROGRESS.md:383-387`, Known risk 4).
**Related:** P-28 (M3/M9 against `CLINICAL_REFERENCE.md` values), item 1's "physical-handset
run still pending" (`COMPLETION_CHECKLIST.md:14`), and item 18's device language QA.

## P-28 · Real-device validation of M3 and M9 against the clinical reference
`PROGRESS.md:372`. Posterior-circulation modules are `PROGRESS.md:257` "synthetic captures
only; no real patient video has been processed." **Who:** a clinic with the reference
device. **Depends on:** P-27.

## P-29 · SMTP credentials and a caregiver-delivery field test
`config.py:49-55` are blank in `.env.example:27-33`, so `smtp_config()`
(`emergency_notifications.py:40-44`) returns `None` on every deployment and
`deliver_emergency` returns `("unconfigured")` at `:136`. Correct by design
(`PLAN_AWAAZ.md:116-117`), and **the caregiver-notification feature has never been on**.
**Missing thing:** a provider account. **Who:** the operator. **See also** P-18 (the
transport code itself is testable today).

## P-30 · Task demo videos
`demoClips.ts:24+` builds 21 URLs of the form `/demo/<MODULE>-<task>.mp4`;
**`frontend/public/demo/` does not exist**, so all 21 404 and every exam step silently skips
the demo phase (`ProtocolRunner.tsx:366-388`; fail-soft by design, `demoClips.ts:12-16`).
`docs/DEMO_CLIPS.md` is a complete shot list for footage never shot.
**Missing thing:** a person to film. **Who:** anyone. **Related:** P-6.

## P-31 · UASpeech, TORGO and mPower dataset access
`DATASET_REQUESTS.md:12-90` carries the exact emails and forms; `ML_STATUS.md:21,23`.
- **UASpeech** — needs an **institutional signature** and a work email; 1–3 weeks. The long
  pole; `DATASET_REQUESTS.md:37-39` warns against signing as an institution you are not in.
- **TORGO** — an email, days.
- **mPower** — a Synapse account plus a self-service certification quiz, **no human
  approval step**; `ML_STATUS.md:99-101` says it can be done in an afternoon. It is the
  empirical basis for Gate 3 and `ML_STATUS.md:103` names it **the highest priority** of the
  three.
**Missing thing:** a signatory and an affiliation. **Who:** whoever can sign.
**Note:** `DATASET_REQUESTS.md:113-114` is right that neither is on the critical path to a
*working* product, only to *defending* it. `voice_dysarthria_clf.py` (202 lines) meanwhile
has zero test coverage and zero importers.

## P-32 · A consented 2-minute voice clip — and there is no upload path at all
`PROGRESS.md:317-318`, `ML_STATUS.md:25`, `PLAN_AWAAZ.md:105-109`,
`PRD_AWAAZ.md:215` (AWA-FR-016 PLANNED).
`VoiceSample` exists as a table (`models.py:674-682`) and **nothing writes to it**: there is
no upload endpoint, no `UploadFile` anywhere in `backend/app`, and
`scripts/verify_deploy.sh:64` actively asserts *"no multipart endpoint in the live schema"*.
`voice_clone.py:142` exits with *"Voice-clone training is not implemented"* on any real path.
So this is blocked on a consented clip **and** on P-36 (whether to build the feature at all)
**and**, if both clear, on building the single-purpose object-storage upload D-014 specifies
(`PLAN_AWAAZ.md:57-62`) — which would be a genuine M-sized build.

## P-33 · Enrolment face pairs from real households
`ML_STATUS.md:26`, `:90-94`. `VERIFY_THRESHOLD = 0.45` was calibrated on **synthetic
geometry only** — three cases in `identity.test.ts`. The separation between "same person in
worse light" and "different person" is unmeasured. It flags, never blocks, so a
miscalibration costs a confounder rather than a locked-out patient. **Who:** pilot households.

## P-34 · Preregistration, privacy review, retention owner, independent review for OPE
`COMPLETION_CHECKLIST.md:95-97`, `PLAN_RL.md:224`, `:230-233` (steps 3, 5, 6, 7),
`PRD_AWAAZ.md:660-663` (open decisions 12 and 13), `RESEARCH_OPE.md:583-589`.
Four separate human artifacts, **none of which exists**. Note `PLAN_RL.md:225-229` (step 4,
patient-level split) is **deliberately impossible from this repo** by D-062 — it must happen
in a governed environment holding the patient key, and the offline package receives only an
attestation (`OutcomeModelValidation`).
**Who:** privacy/security reviewer + an independent reviewer, neither named.

## P-35 · Named owners for product, clinical, privacy, security, ML and field study
`PRD_AWAAZ.md:496-504` (Phase 1), `:643-644` (open decision 2), `:678`.
**This is the root blocker.** P-22, P-23, P-26, P-34 and every Phase-3 sign-off gate all
terminate here. Nothing in the repository can name them.

## P-36 · PR #1 merge
`COMPLETION_CHECKLIST.md:33`. Verified: PR #1 *feat(awaaz): establish safe interaction
contract* is OPEN against `prabindersinghh/NeuroTraceV1`, head
`anish/awaaz-contract-foundation` at `b87d6d1` — identical to local HEAD. `PRD_AWAAZ.md:494`
makes merge the Phase 0 exit. **Who:** the upstream repository owner.
**Depends on:** P-19 and P-37.

---

# 4 · BLOCKED — DECISION

## P-37 · Rebase vs merge against `upstream/main`
**Options:** (a) `git merge` — what `PROGRESS.md:270-274` explicitly recommends, because a
rebase during a `git pull` on 2026-08-24 dropped a merge commit and broke `App.tsx`;
(b) rebase, for a linear history; (c) cherry-pick the Awaaz work onto a fresh branch off
`main`.
**Facts to decide on:** `upstream/main` is 50 commits ahead and this branch 31 ahead;
main carries nine migrations (0012–0020) this branch has never seen, including a
`0020_repair_stale_check_constraints`, a consent architecture (0016), and caretaker links
(0018/0019). Three revision ids collide (P-19). Main has also independently used decision
numbers D-055/D-056/D-057 (`DECISIONS.md:552-558`) — and its own D-057 is *not* this
branch's D-057.
**Blocks:** P-19, P-36.

## P-38 · `MINIMUM_EFFECT_FLOOR` — raise it, or compute the MDE at runtime
`RESEARCH_OPE.md:531` (row 4, the only one of the three meaning-changing rows still OPEN),
`PLAN_RL.md:202-212`, `PRD_AWAAZ.md:390-392`, `COMPLETION_CHECKLIST.md:98-100`.
`MINIMUM_EFFECT_FLOOR = 0.02` (`offline.py:70`) promises roughly **ten times** the
resolution `MIN_EVENTS_FLOOR = 50` (`:46`) and `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR = 25.0`
(`:49`) can deliver — at ESS 25 the smallest adjudicable delta is about **0.18**.
**Options:** (a) raise the floor to ≈0.15; (b) compute the achievable MDE from the realised
ESS inside `compare_policies` and block when the configured effect falls below it.
`RESEARCH_OPE.md:547-549` warns this is the one most likely to be forgotten because nothing
fails because of it. **Who:** whoever owns the offline-evaluation contract.

## P-39 · Whether to add a second, conservative interval bound
`RESEARCH_OPE.md:533-534` (rows 6 and 7). Bootstrap intervals have no finite-sample
guarantee and SNIPS's O(1/n) bias is unaccounted for. **Options:** (a) add a
self-normalised empirical-Bernstein or SN lower bound alongside the bootstrap and require
**both** to clear `minimum_effect`; (b) accept and document. Raising replicate counts does
not help — it is bias, not noise. **Depends on:** P-38 (same owner, same decision surface).

## P-40 · The retention period for `awaaz_policy_events`, and who owns the job
`PRD_AWAAZ.md:660-661` (open decision 12). P-11 builds the mechanism; **nobody has chosen
the number of days**, and `policy_retention.py`'s `DEFAULT_RETENTION_POLICY` currently
carries a value no reviewer has approved. Note the module's own limitation: with no patient
column, **time-based expiry is the only deletion this table can ever offer** — a subject
erasure request cannot be honoured against it.

## P-41 · `DEMO_MODE` on a deployment that holds real data
`config.py:44` defaults `demo_mode: bool = True`, which exposes unauthenticated
`POST /demo/seed` (`demo.py:22`). `.env.example:22-23` says *"Set to false on any deployment
holding real data."* The current production instance is a demo, so this is correct today and
becomes a hard defect the moment P-23's cohort arrives. **Options:** leave it, or make a
non-`development` `env` refuse `demo_mode=true`. **Related:** P-14.

## P-42 · Whether `AshaHome` and the wearable lanes ship at all
P-4 and P-5 assume the answer is yes. If it is no, the honest move is to mark items 12 and
the wearable claim as deferred in `COMPLETION_CHECKLIST.md` rather than leaving "complete"
next to unreachable code. **Options:** wire them (P-4, P-5), or re-label. Do not leave both.

## P-43 · The PRD's ten standing open decisions
`PRD_AWAAZ.md:642-656`, restated here so they are countable: pilot language and code-switch
pattern (1); clinical partner and SLP (2); intended use and regulatory classification (3);
consent/capacity/proxy process for aphasia and cloning (4); which checkpoint (5); Android
device floor and latency/memory/battery budget (6); where keys, archives, adapters and
tombstones live (7); the release-gate thresholds (8); **whether openSMILE is worth a
commercial licence or should be replaced** (9, and `PRD_AWAAZ.md:549` flags the open-source
version as not freely licensed for a commercial product); **whether voice cloning is
necessary at all or should stay out of scope until a stock-voice pilot succeeds** (10 — this
one governs P-32).

## P-44 · GAP_ANALYSIS §3.5's five recommendations, none built
`GAP_ANALYSIS.md:107-171`. Recommended order at `:163-169`: (1) positional symptom questions
appended to the vertigo log — trivial; (2) hearing-change self-report — **already built**,
`score_hearing_change`, `COMPLETION_CHECKLIST.md:29`; (3) SVV — **already built** as M21,
`registry.py:435`; (4) postural BP at TIER_2/3; (5) CCG displacement + exposure time,
already derivable from the captured trace. Items (2) and (3) are done, so this reduces to
**three unbuilt recommendations**, of which (1) and (5) are small and touch `registry.py`.
`GAP_ANALYSIS.md:170-171` requires a PLAN before any registry change, which is why this sits
under DECISION rather than BUILDABLE: the decision is whether to open that plan.

---

# 5 · Things genuinely done, so nobody re-does them

- The deterministic engine, three gates, frozen reference, nine domains, `PATTERN_ATYPICAL`,
  confounders — re-verified live (`PROGRESS.md:240-250`).
- All 21 exam modules registered, M21 SVV reproducing all three printed reference averages.
- Deploy: Railway + Neon Postgres + Vercel, demo surviving redeploys, 7 assertions green.
- CLINICAL_AMENDMENT_v3, all eight amendments (`PROGRESS.md:150-165`).
- The privilege-escalation fix (D-040) and the admin console that cannot read patients (D-041).
- Awaaz D1/D2/D4 as scoped: board, INV-9 confirmation, offline board snapshot, revocable
  trilingual listener capability, consented local card/audio pairs, caregiver-reviewed
  repeats, verified local export, offline emergency WAV, `tel:108`.
- All seven `asr_runtime` audit findings (P-S1).
- The reward-function inversion (D-065): fallback and rejection now both score −0.8.
- Model cards generated from `artifacts/*.metrics.json`, `--check` failing on a stale card.
- **Zero `TODO`/`FIXME`/`NotImplementedError` markers in `backend/` or `frontend/src`.** The
  only refusals are deliberate: `voice_clone.py:142`, `personalised_asr_adapter.py:198,206`,
  `whatsapp.py:14-24` (self-declared deprecated, always returns `False`).

---

# 6 · Prioritised execution plan

Start at the top and work down. Sequenced by dependency; sizes are rough.

### Phase A — stop losing work and stop lying (half a day)

| # | Item | Size | Why here |
|---|---|---|---|
| 1 | **P-0** commit the two untracked files | S | 619 lines of real work exist only on one disk |
| 2 | **P-1** reconcile the four stale doc passages | S | Four documents currently claim seven fixed security findings are open |
| 3 | **P-3** delete `DEPLOY.md:7-8` | S | Trivial, and the last "SQLite" claim in the repo |
| 4 | **P-2** write `docs/GOVERNANCE_KEYS.md` | S | Three files point at it; unblocks a human on P-22 |
| 5 | **P-10** dead extractors + two docstrings | S | Removes coverage of code the product never runs |
| 6 | **P-15**, **P-21** dangling refs and duplicates | S | Sweep them together |

### Phase B — the one model you can make real today

| # | Item | Size | Why here |
|---|---|---|---|
| 7 | **P-17** PhysioNet AF → real `rhythm_irregularity_clf` | M | The only model with no external blocker at all. Flips one row of `ML_STATUS.md` from SYNTHETIC to REAL, which is the row nobody can dispute |

### Phase C — make the product's own surfaces reachable

Do P-42 first if the answer might be "no".

| # | Item | Size | Why here |
|---|---|---|---|
| 8 | **P-4** route `AshaHome` | M | A whole role currently lands on the wrong screen |
| 9 | **P-5** reach `DhiForm`, `VertigoLog`, `WearableLanes` | M | DHI is claimed complete and no patient can complete one |
| 10 | **P-6** `TaskShell` — use it or delete it | S | Item 6 cites dead code as its evidence |
| 11 | **P-9** test M2; **P-18** SMTP transport | S | Two real coverage holes, both closable offline |
| 12 | **P-16** i18n key parity | S | Three missing keys; the device QA half stays blocked |
| 13 | **P-13** automate `verify_deploy` step 7 | S | Gate states have never been checked on the deployed instance |
| 14 | **P-14** document `DEMO_PASSWORD` | S | Every deployment ships a known password |

### Phase D — give the RL package something to eat

Strictly ordered: nothing after step 15 is meaningful without it.

| # | Item | Size | Why here |
|---|---|---|---|
| 15 | **P-7** wire `Awaaz.tsx` → `awaazPolicyLog.ts` | M | The single gate on every real number `app/ml/rl/` can produce. Depends on P-0 |
| 16 | **P-8** measure the near-tie rate | S | If it exceeds 10%, step 15 bought nothing and you need to know immediately |
| 17 | **P-11** commit + test the retention sweep | S | Depends on P-0; the period itself is P-40 |
| 18 | **P-12** close the seven code-change `RESEARCH_OPE` rows | M | None needs data; row 9 (relative weight ceiling) is the one that changes a verdict |

### Phase E — the merge, once someone decides

| # | Item | Size | Why here |
|---|---|---|---|
| 19 | **P-37** rebase vs merge — *decision* | — | Blocks 20 and 21 |
| 20 | **P-19** renumber the migration chain | M | Three colliding ids; `0014`'s `down_revision` still ambiguous |
| 21 | **P-20** re-measure the suite | S | After everything above, since all of it adds tests |
| 22 | **P-36** merge PR #1 | — | Phase 0 exit; needs the upstream owner |

### Not in this plan, and deliberately

Everything in §3 and §4. The largest single item in the product — **P-27, nothing has run on
a physical phone** — needs an afternoon and a cheap Android, not an engineer, and
`FIELD_TEST_PROTOCOL.md` is ready to hand to whoever has one. The Awaaz ASR chain
(P-22 → P-23 → P-24 → P-25 → P-26) is five external facts deep and its root is **P-35: no
owner has been named.** No amount of code moves it.
