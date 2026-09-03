# CHANGELOG

Dated entries per work session: what changed, what was verified, and how.

---

## 2026-09-03 — Consent and erasure got their UI; the Awaaz merge was driven, not read

Second slice of the same audit. Part 4's seven consents and Part 5.4's erasure had backends
and no callers; the Awaaz merge was verified against a running server.

### `/privacy/:patientId` — the seven consents and the erasure (D-082)

Consents were only ever WRITTEN, by enrolment and by `POST /clinician/links` (which grants C3
in the same transaction as the link). Nothing read them back, so a caregiver could grant
clinician sharing by adding a doctor and had no way to see it or take it back.
`DELETE /patients/{id}` had no caller at all.

The screen says only what is true. C3 and C7 have a runtime gate; the other five are recorded
decisions with nothing behind them, and their rows say so and point at erasure rather than
implying an enforcement that does not exist. "Never asked" is stated in words, because an
unchecked box could read as a chosen default — which matters immediately: the demo seed
grants C3 and leaves C1 and C2 with no row, so the demo patient is monitored with no recorded
consent to use the product.

Erasure is confirmed by a required reason plus an explicit acknowledgement, **not** by typing
the patient's name: names here are in Devanagari or Gurmukhi, the keyboard is often set to
English, and the confirming person is 55-75, so that gesture blocks the legitimate case far
more than the accidental one. Both halves of what erasure does are stated before the button —
what is deleted, and what is retained and why.

### The bug the UI work uncovered: one erasure bricked the whole roster

`erase_patient_data` sets `patient.name = ""`. `PatientBase.name` had `Field(min_length=1)`
and `PatientRead` inherited it, so every `response_model=PatientRead` route raised
`string_too_short` on that row — and since `GET /patients` validates the whole list, **a
single erasure returned 500 for that caregiver's entire roster, permanently**, including
patients never erased. Erasing one parent's data would have bricked the other's card.

It survived because `test_erasure.py` proves the deletion against the database directly and
nothing listed the roster over HTTP afterwards. Found by driving a real erasure against a
running server. Fixed on the read schema only; `test_erasure_roster.py` (3 tests) pins the
roster, the single-patient route, and that create/update still refuse an empty name.
`erased_at` is exposed on the same schema so a client can tell a tombstone from a patient
whose name failed to load — the roster used to render a permanently blank card.

### The Awaaz merge: driven end to end (D-083)

Migrations `0021`/`0022` clean to one head. Every Awaaz read route 200. The listener
capability mints, opens for an unauthenticated stranger, shows the caregiver's display name
and **not** the enrolled patient name, and 404s after revocation.

| Policy contract check | Result |
|---|---|
| decision without logging consent | **409** — explicit consent required |
| decision with `requires_confirmation: false` | **409** — no randomising where speech may go out unconfirmed |
| decision with both satisfied | 200, server-drawn `logged_action_probability` **0.92**, `randomised: true` (0.90/0.88 near-tie — D-063's 0.05 band, ≥0.84 floor) |
| outcome missing its evidence | 422 — a `selected` outcome requires `selected_action_id` |
| outcome replayed under the same `event_id` | 200 returning the **same row id**; one row in the table, not two |
| `awaaz_policy_events` columns | no patient column; `logged_on` is a DATE |

**A correction.** An earlier entry in this file said the RL logging loop had no producer. It
was wrong: it grepped components for `awaazPolicyDecision` and missed the indirection through
`lib/awaazPolicyLog.ts`, which `Awaaz.tsx` calls at ten sites. Corrected in place rather than
deleted, because that shape of wrong claim gets working code removed.

**The one seam that does not meet, and why it must stay that way.**
`/awaaz/{id}/speak` returns `candidates: list[str]` — unscored, and exactly one across five
probed inputs. `AwaazPolicyDecisionRequest` requires ≥2 candidates each carrying a `score`.
So `scoredSlateFromSpeakResult` returns `null` unconditionally: the pipeline is built, wired
and inert until the speak contract carries per-candidate scores. Inventing those scores would
manufacture the tie structure the exploration distribution is drawn over, making every
recorded propensity the probability of a draw across a ranking that does not exist — the
exact corruption "the server owns the randomisation" exists to prevent. `42ac6dc` stopped
short for this reason and so does this session. It needs a real ranker, which is product
work, not a merge defect.

**A second seam, and this one is a real collision.** Policy-logging consent is a
`localStorage` flag the client asserts and the server trusts. It is invisible to
`GET /consents/{id}`, not withdrawable on the privacy screen this session just built, lost on
a cache clear, and unprovable server-side. PRD_AWAAZ §10.2 is right that it is its own
purpose — which argues for an eighth `ConsentType`, not a weaker mechanism beside the seven.
Left alone deliberately: it needs a migration and an enum value.

### Verified

- `backend` — full suite exit 0, including the 3 new erasure-roster tests.
- `frontend` — vitest **237 passed** (189 before; +48 new), `tsc -b` clean, `npm run build`
  clean.
- Mutation checks, all three bite: renaming `api.erasePatient` → 1 failure; dropping C7 from
  the screen → 1 failure; restoring `min_length=1` on `PatientRead` → 2 failures.
- Consent, erasure and the whole Awaaz surface driven over HTTP against a running server on a
  scratch SQLite database migrated `0001 → 0022`, as tabulated above.
- **Not run:** the deployed instance, `verify_deploy.sh`, a physical phone, and no browser
  drive of the privacy screen — the wire contracts are proven, the rendering is not.

---

## 2026-09-03 — The baseline gate got its frontend, and two dead ML twins were deleted

**The headline is a live product defect that every suite was green through.** An audit of
backend-to-frontend coverage — all 82 routes against every path `frontend/src` actually
calls — found twelve routes with no client at all. One of them was load-bearing.

### A completed baseline was a permanent dead end

`_refresh_baseline_state` moves a patient to `DOCTOR_REVIEW_PENDING` the moment every module
locks. Bands and alerts are suppressed while the state is not `LOCKED`, and `record_review`
is the only exit. `record_review` is reachable from exactly one route,
`POST /clinician/baseline/{id}/review`, and **nothing in the frontend called it** — `api.ts`
carried no baseline method of any kind.

A real patient therefore completed twelve or more sessions, entered `DOCTOR_REVIEW_PENDING`,
and stayed there permanently: not monitored, not alerted on, with no screen able to move
them out. Their caregiver saw "baseline progress 12 / 12" with the bar at 100%, forever —
one card served every non-`LOCKED` state, so an `ABANDONED` baseline rendered identically.

The demo worked because `services/seed.py` calls `record_review` in Python. The only
exercised path skipped HTTP, so the route that mattered had tests and no caller. See D-080.

**What landed**

- `components/BaselineReviewPanel.tsx` — the clinician's decision. Per-module evidence
  including `cadence_note`, so a Comprehensive-only module's ~6 observations are not misread
  as thin data beside a Daily Pulse module's ~21 (D-043/D-044); the server's own
  synthetic-model disclosure verbatim; the append-only log of earlier decisions; and the
  three actions the server accepts. `CONFIRM` is the only one that states its consequence,
  because it is the only one that is irreversible and the only one that starts monitoring.
  A note is required for `EXTEND` and `FLAG_CONCERN`, optional for `CONFIRM` — matching
  `record_review` exactly.
- `BaselineStatusCard` — the caregiver's half. Awaiting-review and abandoned are now
  distinct from still-collecting, and say plainly that nothing is being compared yet.
  All three languages.
- `Clinic.tsx` — a roster badge for patients blocked on this clinician, and a corrected
  metric: it counted every non-`LOCKED` patient under an "awaiting review" caption, folding
  patients waiting on nobody into the clinician's own queue.
- `api.ts` — `baselineReview`, `submitBaselineReview`, `invalidateBaseline`. The last sends
  `reason` as a **query** parameter, which is how `routers/clinician.py:invalidate` declares
  it; as JSON it 422s with no obvious cause.

### The reachability test had to be rewritten before it was worth keeping

`frontend/src/lib/baselineGate.test.ts` (9 tests) pins the class of bug. Its first draft
asserted `toContain("submitBaselineReview")` against `api.ts` source — which **still passed**
after the method was renamed to `submitBaselineReviewXX`, because the rename is a superstring.
The client-method assertions now run against the exported `api` object. The mutation was run
both ways: 1 failed / 8 passed with the method renamed, 9 passed with it restored.

### `app/ml/scoring.py` and `app/ml/face.py` deleted

Zero callers outside their own tests, and both dangerous to read (D-081).

`scoring.py` was a **second, complete alert implementation with no laterality gate** — it
would raise an `ALERT` on precisely the symmetric Parkinsonian decline INV-2 and
`engine/gates.py` exist to exclude. Its test, `test_alert_gate_sim.py`, was labelled the
PRD §7 acceptance criterion and verified it against the dead path. `test_engine.py` and
`test_laterality.py` were checked first and already cover that criterion against the live
gate, so no coverage was lost.

`face.py` took a **video path** and opened it with OpenCV — the exact shape INV-1 forbids —
and was the only reason `mediapipe`, `opencv-python` and `protobuf` were runtime
dependencies, and therefore the only reason this backend was pinned to Python 3.11 and
numpy 1.x. Removing it makes INV-1 structural on the face path the way removing
`python-multipart` did on the upload path (D-052). `libgl1`/`libglib2.0-0` and the unused
writable `/app/media` directory are gone from the Dockerfile with it.

`requirements.lock.txt` is left **stale and labelled stale** rather than hand-pruned: it is a
transitive freeze, and editing it by hand produces a lock that is wrong invisibly. The
Dockerfile installs from `requirements.txt`, so deploys are correct now.

### Verified

- `backend` — full suite, exit 0 (`pytest -q`), after the deletions.
- `frontend` — vitest **189 passed** (180 before; +9 new), `tsc -b` clean, `npm run build`
  clean.
- The new test's mutation check, both directions, described above.
- **Every new client call driven over HTTP against a running server** — a scratch SQLite
  database migrated `0001 → 0022`, `POST /demo/seed`, then the patient forced back to
  `DOCTOR_REVIEW_PENDING` and each URL exercised exactly as `api.ts` builds it. The seed
  report named the bypass on its way past: `"baseline_confirmed_on_day": 19`.

  | Call | Result |
  |---|---|
  | `GET /clinician/baseline-review/{id}` | 200; all seven keys present, 17 modules, `cadence_note` and `capture_quality_rate` populated, `previous_reviews` non-empty |
  | `POST .../review` `EXTEND`, no note | **400** `EXTEND requires a note explaining why` — the server gate the UI mirrors |
  | `POST .../review` `FLAG_CONCERN` + note | 201; state **holds** at `DOCTOR_REVIEW_PENDING`, as designed |
  | `POST .../review` `CONFIRM` | 201; state → **`LOCKED`**. This is the exit that did not exist |
  | `POST .../invalidate?reason=…` | 200; state → `ABANDONED` |
  | `POST .../invalidate` with `reason` in the **body** | **422** `loc: ["query","reason"]` — the mistake the comment in `api.ts` exists to prevent |

- **Not run:** the deployed instance, `verify_deploy.sh`, a physical phone, and no browser
  drive of the panel itself — the wire contract is proven, the rendering is not. Nothing
  here has been pushed.

### Found and NOT fixed — the rest of the coverage audit

Eleven further routes still have no UI. Recorded so the next session starts from the list
rather than rediscovering it: `GET/PUT /consents/{id}` (**Part 4's six withdrawable consents
cannot be viewed or withdrawn by anyone**), `POST/DELETE /clinician/links` (a caregiver
cannot link a doctor — only the seed can), `DELETE /patients/{id}` (erasure, D-050),
`GET/PUT /clinician/profile`, `GET /admin/doctors` (Part 3.7e), `GET /audit/{patient_id}`.

Also open, and separate from the above:

- **`POST /awaaz/policy/retention/sweep` has never been invoked.** No cron, no startup task,
  no admin control — only tests. The 120-day retention policy has no mechanism to execute.
- **The RL logging loop IS wired, and an earlier draft of this entry said it was not.** The
  claim was made by grepping components for `awaazPolicyDecision` and missing the
  indirection through `lib/awaazPolicyLog.ts`, which `Awaaz.tsx` imports and calls at ten
  real sites — slate open, and all five outcomes. Corrected here rather than quietly, because
  "no component calls this" was wrong and someone would have deleted working code on it.
  What is genuinely dormant is the far end: nothing READS `awaaz_policy_events`, so
  `compare_policies` is never invoked by any route or job, and no ranker is fitted
  (`42ac6dc` stopped short of that deliberately).
- **Policy-logging consent does not go through Part 4.** It is a `localStorage` flag
  (`lib/awaazPolicyLog.ts:readPolicyLoggingConsent`) that the client asserts as
  `payload.policy_logging_consent`, and `routers/awaaz.py:policy_decision` trusts it. So it
  is invisible to `GET /consents/{id}`, not withdrawable from the new privacy screen, lost
  on a cache clear or a device change, and unprovable server-side. The Awaaz line and main's
  line each built a consent mechanism and neither knows about the other.
- **`PatientHome` dead-ends on "No check-ins yet."** for an account with no patient record,
  with no explanation and nothing to do next. Same shape for a caretaker with no links.
- `app/ml/baseline.py`, `explain.py`, `reaction.py` are the same dead-twin class as the two
  deleted here, kept only until their tests are ported.
- `GET /auth/clinician-check`'s docstring claims the frontend uses it. It does not.

---

## 2026-09-03 — Repository structure: a clean root, an indexed `docs/`, contributor scaffolding

**No functional change.** Every code edit in this session is a comment, a docstring, or a
test-scope constant. The full diff of changed lines under `backend/` and `frontend/src/` is
21 comment pairs plus two constants in `test_regulatory_claims.py`.

### The root is now eight visible entries, down from sixteen

Nine documents (200 KB) sat beside `README.md`. Five were executed build briefs and finished
run reports; three were live references; one was a superseded draft.

```
CLINICAL_AMENDMENT_v3.md            → docs/archive/     (executed brief)
FINAL_PRODUCT_SPEC_v4.md            → docs/archive/     (executed brief)
TASK_FINAL_TECHNICAL_COMPLETION.md  → docs/archive/     (executed brief, cited by live code)
COMPLETION_RUN_REPORT.md            → docs/archive/     (run report, unmerged branch)
UX-CHANGES.md                       → docs/archive/     (run report, cited by live code)
DESIGN_LANGUAGE.md                  → docs/            (live reference)
FRONTEND_ENGINEERING.md             → docs/            (live reference)
design.md                           → docs/LANDING_DESIGN_SPEC.md   (live, renamed to match its sibling)
content.md                          → deleted          (landing-copy revamp; it shipped into Landing.tsx)
```

All five archived files are cited by live code as provenance, so they are archived rather
than deleted — `docs/archive/README.md` says what each was and what replaced it, and carries
the old-path → new-path map so older entries in **this file** still resolve without any
history being rewritten.

### `docs/` got an index, not a reorganisation

**Deep-subfoldering `docs/` was considered and rejected.** 170 `docs/X.md` references exist
across the repo plus ~100 sibling mentions, and three tests depend on exact paths under
`docs/` (`test_regulatory_claims.py`, `test_privacy.py`, `test_train.py`). Rewriting all of
that, over the corpus a stranger is supposed to resume from, buys what a grouped index
delivers at no risk. So: **living reference flat, subdirectories for generated cards
(`models/`), unlanded work (`plans/`), and history (`archive/`).**

`docs/README.md` is new — all thirty-nine documents grouped by the question each answers,
with the doc contract and layout conventions stated at the bottom. **Verified**: a script
asserts every `docs/*.md` is linked from it and that every relative markdown link in
`docs/**`, `README.md` and `CLAUDE.md` resolves. Both clean.

### One invariant-test scope change, and why it is not a weakening

Moving the archive into `docs/` swept five files into `_claim_bearing_files()`, which
matches `docs/**.md`. Three tests failed on them — the ninety-second figure, a capability
overclaim, an unlabelled accuracy figure.

Every hit was the corrected claim being **recorded**, not asserted: `~~still say
"90-second"~~ **DONE**`; the original brief's own `DAILY PULSE — target 90 seconds` that
D-045 later corrected; "**diagnosing** an imaginary deadlock" (a software deadlock); and a
quoted *published* VNG reference range. Keeping them in scope would have meant deleting the
correction's own history to keep a test green — the exact thing
`STALE_DURATION_HISTORICAL_OK`'s comment says is "the opposite of what D-045 is for".

`docs/archive/` is therefore excluded from `_claim_bearing_files()`, and
`docs/LANDING_DESIGN_SPEC.md` added to `STALE_DURATION_HISTORICAL_OK` (its two hits are a
struck-through table row marked **REJECTED, D-045** and the paragraph saying the superseded
claims are "reproduced above on purpose").

**This preserves coverage rather than relaxing it.** All five files sat at the repository
root until today, where `_claim_bearing_files()` never reached them either — it matches
`docs/**.md`, `frontend/src/**`, and two named READMEs. Nothing that was scanned before
stops being scanned. **Verified** by evaluating both file sets: five of the six files in
`docs/archive/` remain under the strict INV-13 scan (`_scan` over `git ls-files`, honouring
only `DOCUMENTATION_ALLOWLIST`); the sixth,
`TASK_FINAL_TECHNICAL_COMPLETION.md`, was already allowlisted before this session and only
its path string changed.

### Contributor scaffolding — none of this existed

- **`CONTRIBUTING.md`** — the fourteen invariants, the verification commands, the privacy
  gate, commit and PR expectations. Links to `docs/DEVELOPMENT.md` for setup rather than
  duplicating it, so it cannot drift.
- **`.github/workflows/ci.yml`** — three jobs: invariants alone first (so a violation is
  legible in seconds), the full backend suite, and the frontend suite. Python 3.11, the four
  apt packages the Dockerfile needs for OpenCV/MediaPipe/librosa, pip and npm caching.
- **`.github/`** — PR template (exit codes, invariants touched, claims, living docs,
  privacy), two issue forms that refuse patient data in their first paragraph and route
  security to `docs/SECURITY.md`, and `CODEOWNERS` pinning the clinical, safety and
  invariant-test surfaces.
- **`.editorconfig`** — 2 spaces web, 4 Python, no tabs, matching what the tree already does.
- **`scripts/README.md`** — one line per script plus the hook-enabling command.

### Corrections and hygiene

- **`README.md` §Repository layout was stale** — it said `NeuroTraceV1/`, listed 7 of 39
  documents, and omitted `auth/`, `awaaz/`, `rl/`, `train/`, `motion/`, `landing/` and
  `brand/`. Rewritten from the real tree with counts read from the code: **21 exam modules,
  14 routers, 22 migrations, 42 test modules, 11 exam step components.** Added the
  `git config core.hooksPath .githooks` step to Quick start and a Contributing section.
- **The test count in `CLAUDE.md` was stale** — 1191 → **1456**, from `--collect-only`.
- **Four scripts were not executable** despite their own headers documenting
  `./scripts/x.sh` invocation: `download_datasets.sh`, `seed_demo.sh`, `verify_deploy.sh`
  (documented in `CLAUDE.md`) and `hooks/registry-guard.sh`.
- **`.gitignore`** gained `.remember/` and `.claude/settings.local.json`. `.remember/`
  self-ignores through its own file, but only where one exists — a stray copy had appeared
  under `frontend/` when a command ran from that directory.
- Removed from the working tree: `backend/neurotrace.db`, `backend/neurotrace-journey.db`
  (1.4 MB of local SQLite scratch, gitignored), three `.DS_Store`, and `frontend/.remember/`.

### Verified

| Check | Result |
|---|---|
| `pytest -q` (backend) | **1453 passed, 3 skipped, 0 failed — exit 0** |
| `vitest run` (frontend) | **180 passed, 20 files — exit 0** |
| `tsc -b` | exit 0 |
| `npm run build` | exit 0 |
| `oxlint` | exit 0 (9 pre-existing warnings, unchanged) |
| Link integrity | 0 broken relative links in `docs/**`, `README.md`, `CLAUDE.md`; all 39 docs linked from `docs/README.md` |
| `.github/**.yml` | parse clean |

`./scripts/verify_deploy.sh` was **not** run — nothing in this session can reach the
deployment. Nothing was pushed.

Git recorded all eight moves as renames, so `git log --follow` still works on every one.

---

## 2026-09-02 — Merge: the Awaaz contract-foundation branch, rebased onto main

`anish/awaaz-contract-foundation` (36 commits) merged into `main`. The branch forked at
`5f31ee2`, before ~90 commits of main's work, so this was a reconciliation rather than a
fast-forward. **Migration head moves 0020 -> 0022.**

### Two defects the merge would have shipped, found before committing

- **The backend would not have booted.** Both lines had independently used revisions
  `0012`, `0013` and `0014` for unrelated migrations. Alembic does not fail loudly on a
  duplicate id — it warns and leaves TWO HEADS, and `alembic upgrade head` is the
  container's start command (`railway.json`), so the deploy would have crash-looped. The
  branch's lineage was rebased onto main's head: `0013_on_device_audio_pairs` -> **0021**,
  `0014_awaaz_policy_events` -> **0022**.
- **Family access would have broken silently.** The branch's `0012_repair_role_constraint`
  rebuilds the `users.role` CHECK from a hardcoded list. It predates the `caretaker` role,
  so replaying it would have installed a constraint rejecting every caretaker account —
  D-054's whole feature — with no error until someone tried to sign in. The migration was
  **dropped, not renumbered**: main's `0018` already performs that repair, correctly and
  role-complete. Verified after the fact by running the full chain and inserting a
  caretaker row.

### Resolved by hand rather than by `-X ours/theirs`
- `backend/app/models.py` — both sides appended disjoint models; both kept.
- `backend/app/routers/awaaz.py` — listener revoke. Took the branch's version because it is
  a strict superset: it keeps main's Part-5.1 `get_patient_for_user` authorisation **and**
  adds a non-enumerable idempotent early return.
- `frontend/src/routes/Listen.tsx` — the branch localised the page but reverted the heading
  to a raw `text-2xl`. Kept **both** wins: the branch's `lang` attribute and `copy.*`
  lookups, main's `text-title-fluid` token.
- `content.md` — both lines had independently created a *different* document under that
  name. Main's (a landing-copy revamp) stays; the branch's (a spec of the deployed page) is
  now `docs/LANDING_CONTENT_SPEC.md`.
- `docs/DECISIONS.md` — both lines used D-054 and D-057..D-067 for different decisions. A
  naive merge produced 18 duplicate numbers. Main's numbering is authoritative; the
  branch's twelve were renumbered to **D-066..D-077** with a mapping table. D-061..D-065
  are left free for the unmerged `feat/journey-experience` branch.

### INV-1 held, and was checked rather than assumed
The branch re-adds `python-multipart` to `requirements.txt` — the dependency main deleted
so that a future `UploadFile` fails at import. **Git kept main's removal, and nothing on the
branch uses it**: no `UploadFile`/`File(`/`Form(`/multipart anywhere in `backend/app`, no
media column in the merged schema (checked column-by-column against the migrated database),
and audio stays in IndexedDB — only a capture id, duration, sha256, size and consent flag
are ever POSTed. The tar export is a local `<a download>`.

### Not changed
No new frontend route: everything lives under the existing `/awaaz/:patientId`,
`/listen/:token`, `/review/:patientId`. `App.tsx` is untouched by the branch. `i18n.tsx`
(+402) and `types.ts` (+104) are additive with no key or symbol collisions. The three
`api.ts` signatures the branch changes have no callers outside the two screens it rewrites.

### Verified
- **Backend: full suite exit 0**, from the merged worktree — but only after three
  failures the first run surfaced, none of which a `-X theirs` merge would have shown:
  - **Two were real, and mine to fix.** The branch has no `test_regulatory_claims.py`, so
    its documents were never scanned and had drifted. `design.md` and the content spec
    proposed a regulatory-classification disclaimer for the hero and footer, which INV-13
    forbids anywhere in the repository (D-042), and three files still promised a
    ninety-second session, which D-045 corrected to ~195s of raw task time. Both proposals
    are now marked rejected, with the reasoning, and the forbidden phrasing is not
    reproduced even to quote it — the scanner is a text scan and quoting trips it.
  - **One was pre-existing on `main` and is not caused by this merge**, proven by running it
    against a clean `main` worktree with no Awaaz code, where it fails identically:
    `test_wearable_readings_are_stored_with_their_source` pinned `NOW` to a literal
    2026-08-01, and the wearable route drops readings older than `MAX_BACKFILL_DAYS` (30),
    so it began failing with `stored == 0` on 2026-08-31 with nothing changed. Fixed here
    with the same relative clock already written on `feat/journey-experience` (`86c818e`),
    so the two branches carry an identical change and will not conflict over it.
- `alembic upgrade head` on a fresh database: clean, single head `0022`; `users.role`
  admits all six roles and a `caretaker` INSERT succeeds; `awaaz_policy_events` present;
  all 8 `utterance_log` receipt columns present; **no BLOB or media-capable column in any
  table**.
- Frontend: `tsc -b` exit 0, **vitest 180/180** (main's 139 + the branch's 41), `npm run
  build` exit 0, oxlint clean with zero warnings in the new files.
- Booted the merged backend and drove the app headlessly: sign-in, patient dashboard, the
  Awaaz board, and the review queue all render with **zero console errors**. The dashboard
  is visually unchanged. The board keeps the emergency button, the confirm-before-speaking
  line and the review entry point, and gains the `tel:108` link, the practice-capture,
  phrase-board and offline-voice panels, and an opt-in (unchecked) policy-logging consent.
- Phrase-card icons now render as icons. Main mapped `card.icon` straight into a `<span>`,
  so a card whose icon was `"water"` displayed the **word** "water"; all twelve seeded
  names are covered by the new map.

### Carried in dormant, deliberately
`app/ml/rl/*` and `app/ml/train/asr_runtime/*` are unreachable from any route — verified by
import trace; the only reference from request-serving code is a function-local import in a
helper with no decorator, called solely by tests. `services/whatsapp.py` returns `False` and
logs. `services/emergency_notifications.py` **is** wired into `POST /awaaz/{id}/emergency`
but fails closed: with `EMERGENCY_SMTP_HOST`/`_FROM` blank (the shipped default) it returns
`provider="unconfigured"` without touching the network. **Setting those two variables makes
it send real email containing the patient's name and GPS coordinates** — that is a live
behaviour change, not a dormant addition, and it is the one switch to think about before
configuring SMTP on a real deployment. `cryptography==43.0.1` is now a runtime requirement
(it gates the governance tests; without it they skip and a run reports green having
exercised none of the approval boundary).

### Left alone, on purpose
Cross-references inside the Awaaz planning documents still cite the branch's original
decision numbers; they resolve through the mapping table in `DECISIONS.md`. A blind sweep
was rejected because those same numerals name main's own decisions in the shared documents.
`docs/DECISIONS.md` also carries five duplicate numbers (D-014..D-017, D-055) that
**predate this merge** — the identical set exists on `main` — and were not touched.

## 2026-09-01 — Premium dashboards everywhere; the patient gets a calendar and a history

Committed to `main` and pushed by the owner; Railway healthy (`verify_deploy.sh` 7/7
against production) and Vercel confirmed serving the new bundle (live login at 1900px:
metrics row and week strips render, zero console/page errors). **No migration** — head
stays `0020`.

### The patient's calendar and history (new feature)
`GET /sessions/{patient_id}/history` returns `SessionRead` rows only — **no band, score,
deviation, z or drivers**, because this feeds the surface the patient looks at every
morning and a calendar that grades them is the "app says I am declining" experience this
product refuses to build. Authorised through `get_patient_for_user` like every scoped
route; added to `FOREIGN_ROUTES` so the cross-tenant boundary sweep covers it; a payload
test pins the banned keys absent and newest-first ordering; limit clamps to 1..366.

The patient home is now a two-column laptop dashboard: today's session + actions left,
a wall calendar + recent history right. Date logic is a pure module
(`frontend/src/lib/calendar.ts`, 8 tests): **local** day keys (00:30 IST is that date,
not UTC's yesterday), done-beats-stopped on retry days, Monday-first whole weeks, and a
streak that stays alive through yesterday so it never reads broken before today's
check-in. History rows say the session type; a first cut reused the "Today is…" string
and produced "31 Aug — Today is the short check-in".

### Dashboards instrumented ("still dashboards are basic")
- Caregiver roster: metrics row (people / check-ins this week / setup pending); each card
  gains a 7-day check-in strip and last check-in line. **Adherence only, no verdicts** —
  a colour-coded band on a roster card would read as a daily grade for someone's parent
  with no room to qualify it. Per-patient history fetch is non-fatal by design.
- Caregiver dashboard: four metrics above the narrative (check-ins recorded / last
  check-in / medicines with 30-day rate / personal baseline, amber only while learning).
  The duplicate medicines pill went.
- Operations: hand-rolled `Stat` now delegates to the shared `Metric`; five ad-hoc
  micro-labels became the `text-label` token.
- `PageHeader` (mono eyebrow, fluid title, hairline rule) on the caregiver dashboard,
  Operations, speech review, ASHA households, family home and family access. Onboarding
  and Enrol keep their step-flow headers on purpose; the printable report keeps its
  masthead.

### Verified
Backend: full suite exit 0 (background run, judged by exit code); targeted
history-endpoint tests 38 passed. Frontend: vitest 139 (14 files), `tsc -b` clean,
`npm run build` clean, oxlint 9 (baseline). Playwright local at 1900px: six screens with
correct eyebrow/title, no horizontal overflow, zero console errors; mobile 320/375/768:
no overflow, no sub-12px text. Live: `verify_deploy.sh` 7/7 (band sequence identical),
history endpoint on production returns 5 rows, banned keys none, newest-first true.

## 2026-08-31 — UX: leaving a session, choosing a language, and five defects only the running app showed

Branch `feat/ux-navigation-language`, off `main`. **Merged `--no-ff` and deployed**
as `25d856a` (Railway SUCCESS). **No migration** — head stays `0020`, no column added or
altered, `ExamSession.abandoned` is a property over existing `device_info` — so this went
out as code only and D-058's coordinated release did not apply.

### Mid-test navigation (Part 1)
A patient could not leave a check-in once it started. Exit now sits beside pause, always
visible, confirms with "You have completed X of Y steps", states that the work is kept, and
offers carrying on first. What was captured uploads; the session is marked abandoned, and
`completed=False` is what keeps it out of every baseline and score. Offline it queues with
the same marker and `syncPending` calls abandon rather than finalize — draining a partial
session through finalize would score it.

Back is **view-only**. `mayCapture()` is the single guard: no capture component exists in
the tree while an earlier step is shown, so a completed step cannot be discarded and
retaken. Unlimited retakes would teach a module's baseline the patient's best attempt
rather than their typical one.

No migration: `completed` already distinguished finished from unfinished, and the step
counts live in `device_info`.

### A pre-existing INV-14 hole, found on the way
`_module_history` — the query feeding every baseline — filtered `is_practice` but not
`completed`, while every other pipeline query pairs them. An unfinished session's results
were already reaching the baseline, reachable by closing the tab mid-session.

Fixing it also changed out-of-order offline replay: backwards drain used to produce a
*wrong, unrepairable* baseline and now produces *none*, with an in-order rescore converging
exactly. Visible and recoverable instead of silent and permanent. `test_offline_ordering`
was rewritten to pin the new behaviour after measuring field by field what still diverges —
the old assertion was replaced, not relaxed. Ordering is still required.

### Language (Part 2)
A language screen now precedes demo and login: three buttons, each in its own script, no
prompt sentence. Shown once, keyed on the *absence* of the stored value — "nobody chose" and
"chose English" must stay distinguishable.

The dictionary was already complete (219 keys × 3). The leaks were elsewhere: two hardcoded
`aria-label`s in the exam path — one on the SVV slider, which *is* the measurement — the
language toggle's own group label, `or` on the login screen, and no `lang` attribute on the
document until someone switched language.

`Landing.tsx` is **not** translated and is excluded deliberately, recorded in the test.

### Tour (Part 3) — in-house, not react-joyride
Measured: v3.2.0 is **26.8 KB gzipped**, 77.9 KB raw, ten transitive dependencies, against a
104 KB main bundle. Size was arguable. The architecture was not: Joyride's core mechanic is a
modal spotlight blocking everything except the highlighted element, and FAST/emergency must
stay reachable. This tour outlines and captions; the page stays interactive.

### Five defects found by driving the app
Every one passed `tsc`, `vitest` and `oxlint`.

| | defect |
|---|---|
| 1 | **Pause and Exit rendered as the same word** — रोकें / ਰੋਕੋ — two adjacent buttons, one recoverable, one not |
| 2 | **The demo doctor saw an empty roster** — the seed never created a clinician link or consent, so Part 3.2 silently removed every patient from the demo login |
| 3 | **Dates rendered `M08 31`** — trimmed ICU reports `pa-IN` as supported then leaks the raw CLDR field |
| 4 | **Two identical Skip buttons** — five steps render their own; the runner added another |
| 5 | **An `aria-label` contradicting its button** — WCAG 2.5.3, so voice control could not activate it |

Plus: **`PatientHome` had no emergency button at all** — it was on the caregiver, family and
dashboard surfaces but not the patient's own screen. And my own tour copy claimed "about
three minutes" while the screen behind it said 12 — D-045, in copy written the same hour.

### Verified
Live, in a real browser against a local stack, in Punjabi and Hindi: exit saves
`completed=0` with `abandoned{0 of 18}` and one audit row; in real airplane mode the same
exit queues to IndexedDB with `abandoned{1 of 18}`; back shows the step with **no capture
control present**; zero English leaks on the patient path in either language; a11y sweep
clean (one `h1`, one `main`, `lang` set, no unnamed controls, no unlabelled inputs, no
heading skips).

Frontend: `tsc` 0, `vitest` 113 passed (10 files), `oxlint` 9 warnings (unchanged baseline),
`build` 0.

Backend: **1100 passed, exit 0** (baseline 1091; +8 incomplete-session, +1 offline-ordering).

**In production, after deploy:** `verify_deploy.sh` **7 passed, 0 failed**; a session still
writes (start 201, module 200); the demo clinician roster returns **1 patient at ALERT**; and
an exited session is stored `completed=False` with its counts while the dashboard is
untouched — baseline byte-identical, history 21 → 21, latest unchanged, no band, no trend
point, no alert.

One correction: the first run of that last check compared `band` and `session_count`, which
the dashboard does not return. Both sides were `None`, so it passed while proving nothing —
the same vacuous-pass shape this branch spent its tests pinning against. Redone against the
fields the payload actually has, with a pin that fails if they are empty.

## 2026-08-30 — main reconciled and merged; the chain validated on a Neon branch, and it failed

### Merged to main
`feat/caretaker-onboarding` merged `--no-ff`. Reconciling `main` first hit a README conflict:
Deepesh's rewrite (742 insertions) replaced the engineering README with a fuller product
document. Taken as the base after checking it against the invariants — no accuracy claims,
`synthetic` labelled in five places, and both `medical device` / `clinically validated` hits
sit inside a "must not be presented as" negation list.

**It reintroduced the "90-second" Daily Pulse figure in four places** — the D-045 drift this
repo has already corrected once. Git flagged only one as a conflict; the other three merged
silently. All four corrected against `app/models.py:92` (~195s of capture, 3-4 min
wall-clock).

`.gitignore` gained an unconditional video rule: three recordings were sitting untracked in
the repo root, one named after a person, and `git add -A` would have staged all three.
Preflight's media checks look only for image extensions. **Verified:** all three now match
`check-ignore`, and `git add -An` stages zero video files.

### The branch run, which is the point of this entry
Production sits at **0011**, not 0013 as previously assumed — the undeployed chain is
0012 → 0020, nine migrations.

A Neon branch was cut from production (`predeploy-chain-*`, real rows) and `alembic upgrade
head` run against it. **The first run failed at 0016** with an asyncpg `DataError`: the
consent backfill bound a tz-aware datetime to a column its own insert literal declared naive.
See **D-056** — neither SQLite nor `--sql` rendering can see this class of bug, because the
render skips row-reading backfills entirely.

Fixed (one annotation, `sa.DateTime(timezone=True)`), and the branch re-cut and re-run.

**Verified on a fresh branch of production, `alembic upgrade head` exit 0:**

| check | result |
|---|---|
| 0015 patient count identical | 1 → 1, `baseline_state` `locked` → `LOCKED` |
| 0014 links cover every legacy `clinician_id` | table absent → 1 link, 1 patient with `clinician_id` |
| 0016 NULL `consent_ref` | 0 |
| users / scores / alerts preserved (INV-7) | 5 → 5, 21 → 21, 1 → 1 |
| all 5 roles insertable | real INSERT, rolled back — all pass |
| `PATTERN_ATYPICAL` in scores+alerts CHECK | present in both |
| doubled `ck_x_ck_x_` names | none |

Local `test_migration.py` + `test_migration_portability.py` after the fix: 50 passed, exit 0.

### Deployed
Neon `main` migrated **0011 → 0020**, `ALEMBIC_EXIT=0`, all ten row-level checks PASS:
patients 1 → 1 with `baseline_state` `locked` → `LOCKED`, users 5 → 5, scores 21 → 21,
sessions 21 → 21, `audit_log` 8 → 8 (INV-8), zero NULL `consent_ref`, all five roles
insertable, `PATTERN_ATYPICAL` present in both band CHECKs.

**Deploying the schema before the code broke the live API for ~15 minutes.** The old build's
`BaselineState` enum knows only lowercase `locked` and could not read its own migrated rows:
`/patients` and `/clinic/patients` went 200 → 500 while Railway was still building. They
recovered when the new build landed. "DB-ahead-of-code is harmless" holds for the eight
additive migrations in this chain and is false for the two that rewrite values (0012, 0015).

### D-057 — found in production, after a clean deploy
`verify_deploy.sh` still failed on `POST /demo/seed`. The Railway logs gave a
`CheckViolationError` on `ck_sessions_session_type_enum`: `SessionType` is the only enum in
`models.py` whose member NAME differs from its VALUE (`daily_pulse = "DAILY_PULSE"`), and
SQLAlchemy constrains on the name unless given `values_callable`. Migration 0012 wrote the
VALUES; the ORM sent the NAME; **the deployed API could not create a single session**, while
every test passed because the suite builds its schema from `create_all`.

Fixed with `values_callable` on the shared `_enum()` helper — measured, not assumed, to be a
no-op for all fourteen other enums.

### INV-13's scanner was blind to bulleted disclaimers
The merged README also failed `test_regulatory_claims.py` on **seven** lines — every one of
them the README stating what it does NOT claim. A bulleted disclaimer carries its negation
once, on the lead-in ("It must not be presented as:"), three or four lines above the bullet;
the scanner's negation window was one line. Widened to include the list lead-in rather than
exempting the file, which would have blinded INV-13 on the most claim-dense document in the
repo. Pinned both ways: `test_the_list_lead_in_window_still_catches_a_claim_in_a_list` builds
the same bullet shape under an ASSERTING lead-in and requires it to still fail.

Three guards this session turned out to be structurally blind to what they existed to catch —
`--sql` skipping row-reading backfills (D-056), a name-level constraint diff (D-057), and a
one-line window against a multi-line list. Each was narrowed, never exempted. `test_the_migrated_schema_matches_create_all` now
compares constraint VALUE SETS, not just names; the new regex was checked against a real
`create_all` schema to confirm it extracts values rather than matching nothing.

## 2026-08-29 — Caretaker onboarding: family access, scoped and pinned (backend)

Branch `feat/caretaker-onboarding`, off the merged `main`. **Backend only — frontend not
started**, per the agreed checkpoint.

### What a caretaker is
Family, **additional** to the caregiver who enrolled the patient: the second sibling, the
relative abroad (D-054, Reading A). The first family member to set the product up stays the
`caregiver`/owner and keeps consent management, linking and erasure. The caretaker sees
everything clinical about their own linked patient and holds none of the owner's controls.

Reading B — renaming the family role so `caregiver` became professional — was rejected before
any code: it would migrate every `caregiver` row and rewrite every "owning caregiver" check
across `patients.py`, `consent.py`, `erasure.py` and `clinician.py`, churning tested code in
the consent and erasure authorisation paths for no functional gain.

### The boundary, which was the whole point
`auth.deps.caretaker_may_access_patient` — an **active** `patient_caretaker_links` row **and**
current **C7 (`CARETAKER_SHARING`)**. Neither alone is sufficient, mirroring the clinician
rule exactly.

`caretaker_is_linked` is callable from **exactly one place**, inside that function, and a
source assertion pins it. That property is not decoration: it is what would have prevented the
six-route bug, and it is the only thing that catches a *new* route obtaining the link check
without the consent check, because no behavioural test can cover a route that does not exist
yet. A second source assertion checks that no router compares against `Role.caretaker` without
delegating within the next three lines.

Routes that inherit the boundary through `get_patient_for_user` needed nothing. The two that
resolve a patient *without* the dependency were updated in the same commit —
`sessions.py:_assert_can_access` and `wearable.py:acknowledge_fall` — because splitting that
across commits is precisely how the original gap survived.

### See everything; silence nothing
Family read the full clinical picture: dashboard, report, trends, confounders, the patient's
real name. They may acknowledge a **fall** — they are the person in the house and a fall needs
answering now. They may **not** acknowledge an **alert**: seeing one is right, silencing one is
a clinical action, and a worried family member dismissing a real deterioration is the failure
that split refuses. The test asserts both halves *in the same test*, because the next person to
read the code will otherwise collapse them into one rule.

Consent management, linking further family, editing and erasure all 403 for a caretaker.

### Consent reuses the existing machinery
One new `ConsentType` value. `services/consent.py` needed **no structural change** —
`CURRENT_VERSIONS` is a dict comprehension over the enum, so C7 picked up a version
automatically (verified: 7 versions for 7 types). Deliberately **not** default-OFF: C4/C5 are
opt-in because the product works without them, but a caretaker who can see nothing is not a
feature.

**`consent_ref` is populated at creation**, not nullable-then-backfilled. D-046 exists because
Part 3 shipped links whose consent lived only in an audit event and needed a later migration to
reference it; the consent table already exists now, so the link and its C7 row are written in
one transaction and that debt is simply not incurred.

### The WhatsApp number is health-adjacent PII
A phone number alone is contact metadata. Joined to a family link it says *this person is
caring for a stroke survivor* — a health inference about a named individual. So it is deleted
on erasure (the link is only revoked, as clinician links are), never returned by any admin
surface (D-041), and **never written into an `audit_log.meta_json`**: that table is append-only
and survives erasure by design (D-050), so a number there would be un-erasable — the retention
property becomes a liability. The audit row records `channel_id` and nothing else, and a test
asserts the destination string appears nowhere in the audit output.

Scoped per patient as well as per caretaker, so erasing one patient cannot take another
patient's routing with it.

### Auth deferred, authorisation not
Caretaker accounts are created **disabled** — `pw_hash` is a sentinel no password can match,
rather than an empty string, which would be a subtler thing to get wrong later. Invite and
credential setup belong to the auth pass. The boundary is built and tested now regardless,
because it has to be provably correct *before* the first real caretaker can sign in.

### Migrations
`0018_caretaker_links` (role widening + both tables + indexes) and `0019_caretaker_consent`
(the `consent_type_enum` widening) are **kept separate** — same discipline as 0014/0015, so the
constraint rewrite sits in one short reviewable file. Both pass the **bare** constraint name to
`batch_alter_table`; passing the rendered name doubles the prefix, the trap 0003, 0012 and 0015
all hit.

`0019`'s downgrade **deletes** C7 rows rather than relabelling them, and the reasoning is worth
recording: 0011 and 0018 *demote* users because deleting a person's account to satisfy a
constraint would lose data INV-7 protects. A consent row is different — relabelling a C7 grant
as `CLINICIAN_SHARING` would fabricate a consent the caregiver never gave, saying they agreed
to share with a doctor when they agreed to share with family. A false consent record is worse
than an absent one.

### A migration defect found by the new tests (D-055)

The caretaker migration tests are the first in this repo to insert a privileged user or a
patient into an **alembic-migrated** database — every functional test builds the schema with
`Base.metadata.create_all()` instead, so the migrated schema had never been exercised with
real rows. Two defects fell out immediately.

**`users` — fixed here.** Since 0005 the table carried `ck_users_ck_users_role_enum` (the
original three roles) beside `ck_users_role_enum` (the current set). Both enforced, so an
alembic-migrated SQLite database **could not create an `asha_worker`, `admin` or `caretaker`
account at all** — verified by inserting each role in turn. 0018 now drops the stale duplicate
under a SQLite-only guard; all five roles insert cleanly afterwards.

**`patients` — NOT fixed, and it is a pre-deploy blocker.** `baseline_state_enum` (lowercase,
from 0002) sits beside `ck_patients_baseline_state_enum` (uppercase, from 0015), and **no
value satisfies both**. Worse, rendering 0015 for Postgres emits a `DROP CONSTRAINT` for a
name that has never existed there, so **0015 should be expected to fail on the next Neon
deploy**. Nothing has shipped — 0014–0019 have never been deployed.

The mechanism is the third variant of D-014's trap: `sa.Enum(name=...)` inside a migration is
not attached to `Base.metadata`, so the naming convention never applies and the constraint
lands under the bare name — but `batch_alter_table` *does* apply the convention, so a later
`drop_constraint` targets a name that was never created.

The obvious fix (`naming_convention={"ck": "%(constraint_name)s"}`) **was tried and did not
work** — the duplicate survived on SQLite — so it was reverted rather than left in place
looking like a fix. `test_downgrading_0019_deletes_only_caretaker_consents` is
`xfail(strict=True)` naming the defect, so it becomes a hard failure the moment it is
repaired. Full diagnosis in D-055.

### Recovered from a session crash
A session teardown mid-write **corrupted `docs/SECURITY.md` and `docs/DATA_INVENTORY.md`**,
replacing them with fragments of compiled Python. Caught by inspecting the files rather than
trusting the "changed on disk" notice, restored from git, and the intended edits re-applied.
Worth recording because the corruption was silent and neither file is covered by a test.

---

## 2026-08-28 (final) — D-045 enforced everywhere, python-multipart removed, PWA install fixed

Three owner-directed actions closing out the autonomous run.

### D-045's carve-out closed: the true duration goes everywhere (D-051)
D-045 corrected Daily Pulse from 90s to ~195s of raw task time and deliberately left the
public-facing copy alone. That is now decided the other way, and it turned out the old figure
had survived in **eight** places — only one of which was the landing page D-045 named:

the shipped `<title>`, the meta description, the PWA manifest `description`, **both** landing
hero headlines ("Ninety seconds a day is more.", "Ninety seconds a day, they can."), the body
copy, the `NinetyDays` mark, and `docs/DEMO_SCRIPT.md`.

**Four of those I found only because I wrote the test.** I corrected what I could see by hand
first, then the scanner immediately failed on four more. A decision that is not enforced by a
test is a decision that drifts back — which is the actual lesson, and it is recorded in D-051
rather than left as a war story.

`docs/PRD.md` §7 keeps its `(Was "<=90s" ...)` note and is explicitly allowlisted: recording
that the figure used to be wrong is the opposite of asserting it.

### The Part 8 scanner's scope had a hole exactly where the miss was
It covered `frontend/src/**`, `docs/**` and both READMEs — and **not `frontend/index.html`**,
which is the browser tab and the text that appears when the link is shared. Nor
`frontend/vite.config.ts`, where the PWA manifest description is authored and from which it
ships. Both are now in scope, with a test asserting they stay there, because that scope gap is
the whole reason a corrected figure shipped for weeks.

New `STALE_DURATION` guard with self-tests in both directions, against the exact strings that
shipped.

### python-multipart removed — INV-1 is now structural (D-052)
Pinned, installed, and completely unused (zero matches in `app/`), and it is the one
dependency whose only purpose is accepting file uploads — precisely what INV-1 forbids.

Three tests already asserted no endpoint accepts media. Those catch a violation *after*
somebody writes it. With the library absent, a future `UploadFile` parameter fails at
**import**: the runtime cannot express the violation at all.

Removed from `requirements.txt` **and** `requirements.lock.txt` (leaving the lock entry would
restore it on the next byte-identical rebuild), and **actually uninstalled to verify rather
than assume** — the app imports, all 76 routes register, the OpenAPI document still
generates. New INV-1 test asserts neither manifest re-pins it, checked against the manifests
rather than the live interpreter so a transitively-installed copy is not a false failure.

`passlib` remains unmaintained (why `bcrypt` is held at 4.0.1) — logged in `docs/SBOM.md`,
deliberately not acted on.

### The PWA could not install, and the first fix was only half a fix
`/icon-192.png` and `/icon-512.png` had been declared in the manifest since it was written and
**neither file had ever existed**. Every load logged "Download error or resource isn't a valid
image": "Add to home screen" produced a blank icon, and some Android versions suppress the
install prompt outright when a manifest's icons cannot be fetched.

An earlier pass pointed the manifest at `favicon.svg`, which silenced the console but left it
half-fixed — that file is 48×46 and non-square, so a launcher's circular maskable crop would
have cut the mark.

**What happened next is worth recording.** I generated real PNGs, committed them, and
`test_privacy.py` failed: it treats every tracked image as a possible photograph of a real
patient's records. That scanner is deliberately blunt and it is **right** to be (INV-11). So
the commit was reset, the blobs purged from the object store (`git reflog expire` + `git gc`,
verified by re-running the privacy suite), and the need for a raster removed instead of the
test being weakened.

`public/icon-maskable.svg` is generated from the repo's own `favicon.svg`: square, opaque
ground (a maskable icon must not rely on transparency, or a launcher applying its own shape
shows the OS background through the corners), mark inset to 56% so it survives the crop.

`index.html` also declared no icon link at all, so every load probed `/favicon.ico` and 404'd.
Now declared, plus `apple-touch-icon`.

### Verified
- backend: `test_privacy.py`, `test_regulatory_claims.py`, `test_invariants.py` — exit 0
- frontend: `tsc -b` exit 0 · `vitest` 74 passed · `oxlint` exit 0 (9 pre-existing warnings,
  none new) · `npm run build` exit 0
- live, against the production build: title and both descriptions carry the corrected figure;
  both manifest icon entries return 200 as `image/svg+xml` and decode to **512×512 square**
  with an opaque ground; a maskable entry is present; favicon 200; console **0 errors, 0
  warnings**.

**One non-finding, stated because I nearly reported it as a bug.** `getRegistrations()`
returned 0 in the automated browser, which would mean no offline caching. Registering the
service worker manually in the same page succeeded, and the injected `registerSW.js` is
correct and standard — so that was a measurement artefact of the automated context, not a
defect. Part 7.4 (proving offline model loading with the network genuinely disabled) remains
outstanding and unverified either way.

### Noted, not acted on
`frontend/public/favicon.svg` is a purple gradient bolt — nothing like the blue medical brand
(`#173a7a` / `#1E5AA8`), and gradients are otherwise forbidden by the design system. It looks
like a template leftover. The new icon inherits it faithfully rather than inventing a logo,
because artwork is the owner's call.

---

## 2026-08-28 (later still) — Part 6, the beautification pass, and four bugs the browser found

Branch `finish/autonomous-completion`, continued.

### A stale lowercase enum had four surfaces lying at once
`frontend/src/lib/types.ts` still declared `BaselineState` as the three pre-0015 lowercase
values. Migration 0015 replaced them with five uppercase ones, so
`baseline_state !== "locked"` compared against a string the server can no longer send. The
caregiver home, clinic list, clinician report and dashboard therefore showed the "still
collecting" banner **permanently** — including for patients a clinician had confirmed.

TypeScript could not catch this: the type itself was the thing that was wrong, so every
comparison type-checked cleanly against a lie. Found by reading the Part 3 enum change back
against the frontend instead of assuming a backend migration had been propagated.

### Part 6.2 — what reaches a caregiver, and what deliberately does not
`frontend/src/lib/notify.ts`: pure, no React, no network, unit-tested — the same shape as
`taskFlow.ts`, and for the same reason. The rule worth pinning is a **negative**: WATCH does
not notify. WATCH is the band the engine sits in while it waits for a second corroborating
domain; pushing it to a family trains them to ignore the one that matters, and a rule like
that erodes silently inside a component when somebody widens a condition to "surface more".

A patient who is not being monitored — baseline collecting, awaiting a doctor, or abandoned —
produces no band-derived notification, keeping the caregiver surface consistent with the
Part 3 suppression rather than trusting it. Adherence and quality signals *do* survive that
suppression, because they are facts about the record rather than claims about the person.

No message reassures. "Everything looks fine" is a claim this product cannot make.

### Part 6.6 — the patient knows what they are starting
Before pressing begin: which check-in is due, roughly how many minutes, how many tasks, and
that they can pause. The duration is the server's own `estimated_seconds`, rounded **up** —
never a number typed into the frontend, which is exactly the drift D-045 records. Fetching it
is deliberately non-fatal: offline, the patient still gets their button.

### The beautification pass, within the locked design system
`index.css` and `tailwind.config.js` are **untouched**. No token, no `.patient-scale` rule and
no colour semantic changed. STABLE stays accent-blue; green stays forbidden.

- Every band now pairs its colour with a word **and an icon**, so a colour-blind reader, a
  screen in sunlight, or a greyscale print of the report reach the same conclusion.
- `aria-live="polite"` on the status line, so a band that changes while the page is open is
  announced rather than only re-painted. Polite, not assertive — a status change must not
  interrupt someone mid-sentence, and this is never the emergency path.

The broad spacing/typography/density sweep is **not** done.

### Two bugs found only by loading the built app in a browser
**The PWA could not install.** `vite.config.ts` declared `/icon-192.png` and `/icon-512.png`;
`public/` has only `favicon.svg` and `icons.svg`. Every load logged "Download error or
resource isn't a valid image", so "Add to home screen" produced a blank icon — and some
Android versions suppress the install prompt outright when a manifest's icons cannot be
fetched. For this product that is not cosmetic: the installed PWA *is* the airplane-mode
demo. Pointed at the brand asset that exists rather than inventing artwork.

**Login and register had no `main` landmark and started at `h3`.** Both render their own
shell rather than `AppShell`. `CardTitle` gained an `as` escape hatch (default `h3`
unchanged, so no other card is affected) and both screens declare their title as the `h1`.

### Verified
- frontend: `tsc -b` exit 0 · `vitest` **74 passed** (was 62) · `oxlint` exit 0, no new
  warnings · `npm run build` exit 0
- live, against the production build in a real browser: `/diagnostics` renders the new
  browser/OS/form-factor rows; the model probe completes (FaceMesh 496 ms, PoseLandmarker
  274 ms, both 100% detection on **Playwright's synthetic camera** — desktop, not a phone,
  and not a real face); the report JSON is copyable with zero probes run; `/login` now
  reports `main` and `heading [level=1]`; console clean, 0 errors 0 warnings.

### Not changed, deliberately
`frontend/index.html` still says "90-second" in its `<title>` and meta description. D-045
reserves the public-facing figure for the owner, so it was left alone and flagged in
`COMPLETION_RUN_REPORT.md` instead — that decision was recorded about `Landing.tsx`, and the
tab title may not have been in view when it was made.

---

## 2026-08-28 (later) — Parts 3.7e, 4, 5, 7, 8: an endpoint audit that found six real holes

Branch `finish/autonomous-completion`, **not merged** — left for review.

### The finding that mattered: Part 3.2's fix had landed in one place out of seven
Part 5.1 asked for an audit of every endpoint. Reading all 67 routes turned up that the
clinician-access fix from Part 3.2 lived in `get_patient_for_user` and nowhere else — six
other routes had each hand-rolled their own copy of "may this caller touch this patient",
and none of them had been updated.

| Route(s) | The gap |
|---|---|
| `POST /sessions/{id}/module/{code}`, `/finalize`, `GET /sessions/{id}/modules` | `_assert_can_access` still granted any `user.role is Role.clinician` unconditionally — an unlinked clinician could **read and write** another patient's raw module features |
| `GET /patients` | role dispatch had no `else`; clinician and **admin** accounts fell through with no `WHERE` and got every patient in the deployment |
| `POST /wearable/fall/{id}/acknowledge` | authorised via the legacy `Patient.clinician_id`, which revocation never clears — a revoked clinician kept the ability indefinitely |
| `PATCH /patients/{id}` | `clinician_id` settable to any user id with no check it names a clinician; this is what made the row above exploitable rather than merely stale |
| `POST /clinic/alerts/{id}/acknowledge` | role-gated but no check this clinician is linked to the alert's patient |
| `DELETE /awaaz/listener/{token}` | needed only *some* valid login — asymmetric with minting, which correctly required `get_patient_for_user` |

Each is pinned by a regression test asserting the **old** behaviour is gone, not that the new
behaviour works. The structural fix: every clinician access decision now routes through one
function, `auth.deps.clinician_may_access_patient`. Six copies is how a security fix
half-lands (D-049).

### Erasure: the audit trail was being destroyed by the thing meant to protect privacy
`audit_log.patient_id` carries `ondelete="CASCADE"`. **Probed rather than assumed** — a
throwaway database, one audit row before `DELETE FROM patients`, zero after. So the existing
delete route destroyed exactly the record an erasure request tends to arrive attached to:
who accessed this person's data before it was removed.

Erasure now tombstones (D-050, migration 0017). Every clinical measurement is genuinely
deleted; the surviving row keeps its id and loses name, age, sex, stroke details, languages
and `calibration_json` — which is where the face-identity enrolment vector lives, the one
stored value derived from the patient's body. Audit entries, consent history and revoked
clinician links are retained: they record decisions and access, not measurements.

Rejected: dropping the FK (a constraint rewrite on SQLite, on the table everything else
references, to solve what a nullable column solves additively) and `SET NULL` (which keeps
the row while destroying the linkage that makes it useful).

Two fields had to be RESET rather than nulled because they are NOT NULL — `stroke_side` to
`unknown`, `other_movement_disorder` to `False`. Found by a failing test, not by reading the
model. `unknown` is also the more honest value: after erasure we genuinely do not know.

### Part 4 — six consents, and C3 actually gates access
`consents` table (migration 0016), six independently grantable and withdrawable types, each
versioned and attributed with a server-observed IP. Withdrawing `CLINICIAN_SHARING` blocks a
**still-linked** clinician immediately and drops the patient from the roster — the central
test leaves the link deliberately active so that consent is provably what is doing the work.

D-046's obligation is discharged: 0016 materialises the historical consent for every
Part-3-era link from its own `linked_at`/`linked_by` and threads `consents.id` back onto
`consent_ref`. Going forward the link and its consent are created in one transaction, so no
unreferenced link can be created at all.

### Part 3.7e — admin doctor census
`/admin/doctors`: clinician count, a non-clinical roster (name, registration number +
`SELF_DECLARED`, specialty, affiliation) and a patient **count** per doctor. No drill-down
route exists anywhere. `test_no_admin_response_contains_patient_identifying_data` was extended
to link a real doctor to a real patient first — the exact shape that would tempt one — before
asserting zero patient content leaks.

### Part 8 — the overclaim scanner, and its own two false positives
Extends INV-13's regulatory-exemption scan with the capability-overclaim family: detect /
predict / diagnose / replace / clinically proven / medical-grade, plus accuracy figures with
no synthetic label, across user-facing source, docs, and the built bundle.

It produced two false positives on first run, both fixed by narrowing rather than exempting
(the D-030 discipline):

- **`README.md`** — "It does not detect strokes and does not / replace a clinician." The
  negation and the claim landed on different lines because the prose wraps. A scanner that
  flags a correct disclaimer pressures someone into weakening it, so the negation window now
  spans the previous line.
- **`CLINICAL_REFERENCE.md`** — "Saccade precision 94–112%" is a published VNG reference
  range for an eye, not a model metric. `precision` and `sensitivity` belong to both
  vocabularies, so an accuracy figure is now flagged only when a model-claim context is
  present.

Both false positives are now self-tests, so the scanner is pinned in both directions.

### Part 5.2 — INV-1 strengthened
The existing test greps app sources for three markers. Added a third check against the
**generated OpenAPI document** — every route as registered, plus every component schema — so
a `bytes` field or a custom media type is caught even though it spells nothing the grep looks
for.

### Part 5.6 — offline ordering verified (not built)
Automatic drain remains plan-only. What was verified is that the backend tolerates
out-of-order arrival: `test_offline_ordering.py` builds the same clinical history twice, once
submitted chronologically and once deliberately reversed, and asserts the two patients come
out identical in bands, gates, drift and baseline medians. Every history query orders on
`ExamSession.ts`, and a source assertion pins that it never becomes insertion order.

### Part 7 — phone-readiness prep
`/diagnostics` gained FaceMesh and PoseLandmarker init time, **detection rate** and median
per-frame cost (a model can initialise perfectly and still fail to see the subject), plus a
parsed browser/OS string. The JSON report is now always copyable — previously it appeared
only after a successful FPS run, so the device where nothing worked was the one device you
could not get a report from. `docs/PHONE_TEST_RESULTS.md` is a structured empty template.

**Nothing has run on a physical handset.** Every row in that template is blank on purpose.

### New documents
`ENDPOINT_DATA_AUDIT.md`, `DATA_INVENTORY.md`, `SECURITY.md`, `SBOM.md`,
`PHONE_TEST_RESULTS.md`, and `docs/plans/PLAN_offline_auto_drain.md`.

### Two findings recorded, not acted on
`python-multipart` is installed and **completely unused** — the one dependency whose only
purpose is what INV-1 forbids. Removing it would make the invariant structurally true rather
than only test-true. And `passlib` is unmaintained, which is the reason `bcrypt` is pinned at
4.0.1. Both are written up in `SBOM.md`; neither was changed, since dependency changes were
outside this run's scope.

---

## 2026-08-28 — Part 3: a baseline no longer locks itself

### The change
Meeting the baseline completion criteria used to lock the baseline and seal the frozen
reference, on session count alone. It now produces **DOCTOR_REVIEW_PENDING** — a request for
review. `patients.baseline_state` runs NOT_STARTED -> IN_PROGRESS -> DOCTOR_REVIEW_PENDING ->
LOCKED, with ABANDONED reachable throughout, and `session_pipeline` suppresses bands and
alerts whenever the state is not LOCKED. A patient waiting on a doctor is not being monitored
and is no longer told they are.

Three clinician actions, all appended to `baseline_reviews` with the snapshot the reviewer
saw: CONFIRM (locks, and writes the frozen reference), EXTEND (back to IN_PROGRESS, note
required), FLAG_CONCERN (records a worry and holds — it is not a rejection).

### An over-broad access path, found and closed
`get_patient_for_user` granted access to any patient as soon as `user.role is Role.clinician`,
and `/clinic/patients` ran an unscoped `select(Patient)`. `Patient.clinician_id` existed and
was never consulted for authorisation, so a provisioned clinician could read the entire
roster. Access now requires an active row in `patient_clinician_links` (`unlinked_at IS
NULL`), created by the **owning caregiver** — a clinician cannot link themselves, because a
doctor who could add themselves makes the link meaningless as a control. Revocation sets
`unlinked_at` and keeps the row (INV-8).

`test_patient_clinician_link.py` asserts the OLD behaviour is gone rather than the new one
working: unlinked clinician -> 403, and an empty roster.

### The frozen reference moved to CONFIRM (D-048), and the bug that creates
Writing at module lock made EXTEND cosmetic — INV-4 forbids correcting a reference already
sealed, so "that window isn't representative" would have arrived too late. The write is now
`freeze_reference()`, called from one place.

**The failure this introduces is a second write across EXTEND-then-CONFIRM**, and a test
asserting only "not written on EXTEND" would pass while it shipped.
`test_extend_then_confirm_writes_the_reference_exactly_once` drives the whole cycle — EXTEND,
values move to `{"k": 1.5}`, CONFIRM, then a second CONFIRM with post-lock drift to
`{"k": 9.9}` — and asserts the reference holds the FINAL window and a repeat call returns 0
newly frozen. Idempotence lives in the function (`reference_locked_at is not None` -> skip),
not in the caller.

### Expiry: extend once, then abandon (D-047)
Never a LIGHT downgrade. LIGHT changes which tasks run, which moves every module's position
on the fatigue curve, which corrupts the baseline being built — the exact confound INV-14 and
D-027 exist to prevent. `test_expiry_never_recommends_a_light_downgrade` asserts the string
is unreachable from any input combination, so the option cannot quietly return.

### Migrations
`0014_doctor_in_the_loop` (additive: three tables, backfills links from
`patients.clinician_id` with a dialect branch, does **not** drop `clinician_id`) and
`0015_baseline_phase_states` (widen -> rewrite -> narrow on the `baseline_state` CHECK) are
deliberately separate. 0015 passes the **bare** constraint name to `batch_alter_table` —
passing the rendered name doubles the prefix, the same trap 0003 and 0012 hit.

### Verified
- `tests/test_baseline_review.py` 16 passed, exit 0
- `tests/test_patient_clinician_link.py` 9 passed, exit 0
- `tests/test_baseline_phase.py` 15 passed, exit 0
- migration round-trip `upgrade head` -> `downgrade base`, 36 passed, exit 0
- Postgres render inspected by eye: `gen_random_uuid()` on the Postgres branch, and
  `DROP CONSTRAINT ck_patients_baseline_state_enum` with a single prefix
- demo seed drives the real gate: `bands: SSSSSSSSSSSSSSSSSSSAA -> ALERT`, confirmed on day
  19, final state LOCKED, 1 `baseline_reviews` row. A seed that skips the doctor gate now
  fails a test.

### Not done, deliberately
The clinician baseline-review **frontend**. Backend-first was the agreed order.

---

## 2026-08-24 (even later) — The "outside CDSCO" claim removed everywhere; INV-13

### Part 1 of TASK_FINAL_TECHNICAL_COMPLETION.md, done first because it was flagged urgent
The repo stated "Outside CDSCO device classification" — the project owner's own error,
propagated into the specs this codebase was built from. CDSCO's final Medical Device
Software guidance (21 July 2026) classifies by intended use, not business model; the claim
was never defensible and was a live credibility risk.

Swept the whole repo rather than trusting the two files named in the task. A blind grep for
"exempt" alone returned false positives in `DEVELOPMENT.md`/`frontend/README.md` (the
HTTPS/localhost note) and in `DECISIONS.md`/`CHANGELOG.md` (INV-11's own scanner history,
D-030) — reviewed each hit individually rather than pattern-matching blind. Five real sites
fixed: `docs/PRD.md` (the primary claim), `backend/app/safety/guards.py` (the guardrail's
docstring *rationale* implied word-avoidance kept the product unregulated — the guardrail's
actual behaviour was always correct and is unchanged), `Landing.tsx` (hero disclaimer and
footer tagline — both reworded to keep 100% of the safety warning while dropping the
self-classification), `Onboarding.tsx` (EN/HI/PA, the consent-screen line every caregiver
must acknowledge), `FINAL_PRODUCT_SPEC_v4.md` (historical spec, fixed anyway — a wrong
claim doesn't get a pass for being old).

New: `docs/INTENDED_USE.md` (the frozen statement everything else quotes),
`docs/CLAIMS_MATRIX.md` (ALLOWED / NEEDS EVIDENCE / PROHIBITED, seeded from Part 8), INV-13
in ARCHITECTURE.md, and `test_regulatory_claims.py` — which found a real near-miss on its
first run: `frontend/dist/` was a stale build still carrying the old wording after the
source fix, caught by the "check the shipped bundle, not just the source" test Part 8.1
asked for. Rebuilt; second run green.

**Verified:** `test_regulatory_claims.py` 9/9 passed, including against the freshly rebuilt
`frontend/dist/`. Scanner self-tests confirm it catches the six seeded historical-phrasing
variants and does not false-positive on the localhost/HTTPS exemption note, INV-11's own
history, or either replacement safety-disclaimer sentence.

---
## 2026-08-31 — Awaaz counterfactual logging, bounded near-tie randomisation, reward fix

Awaaz now produces events an offline policy comparison can actually use. `app/ml/rl/` could
compare candidate-ranking policies for a while and not one production event was eligible: the
product recorded no slate, no policy version, no propensity and no confirmation outcome, so
every importance weight had an unknown denominator. The new `awaaz_policy_events` table is
the missing half — append-only, one row per candidate-ranking decision, holding the opaque
event id (which doubles as the idempotency key), the behaviour policy id, the full offered
slate as opaque ids in rank order, the logged action, the probability the policy assigned to
the action it actually logged, the top-ranked action, a `randomised` flag, the coarse speech
profile, the three INV-9 confirmation booleans, the emergency flag, the feedback actor, the
outcome enum, the selected and rejected actions, and `logged_on` as a DATE. Two endpoints write
it, both idempotent in either direction; the decision endpoint refuses without a
purpose-specific `policy_logging_consent`, and the outcome endpoint can only close a decision
that already passed that check. D-062.

The table has no patient column and no foreign key of any kind, and `logged_on` is a day
rather than a timestamp because a microsecond timestamp joins one-to-one onto `audit_log.ts`
and `utterance_log.ts`, which do carry `patient_id`. The cost is stated rather than absorbed:
without a patient column there is no patient-level split before fitting, the repeated-speaker
dependence in `offline.LIMITATIONS` stays unaddressed, and cohort work on this table is not
possible. The audit rows the router writes omit the event id and every candidate id for the
same reason. The migration's revision id is `0014_awaaz_policy_events` rather than `0014`
because `main` already carries a different migration claiming `0014`; this branch and `main`
have independently used 0012, 0013 and 0014, and two revisions sharing an id do not merge.
That collision is an open merge hazard, not a resolved one.

The ranker now randomises, because IPS and SNIPS are unidentifiable under a deterministic
logger and refusing such logs (D-057) does not by itself produce good ones. Only candidates
scoring within 0.05 of the best are explorable, so a clearly-better candidate is never
displaced — a worse one is assigned probability zero and cannot be drawn. At most two
alternatives carry a flat 0.08 each and the top keeps at least 0.84. It is confined to the
confirmation path: reordering options a person reads and taps is a presentation change they
override, while reordering something spoken without confirmation would be exploration on a
disabled person's mouth. This is not online learning — nothing reads these rows at runtime,
no model is fitted from them, and no ranking adapts. D-063.

A reward-function bug was found by writing `docs/RESEARCH_OPE.md` and fixed. `score_logged_action`
charged repair cost for a `phrase_board_fallback` on top of the negative preference it already
earned, scoring the fallback at −1.0 against a plain rejection's −0.8 — so reaching the phrase
board was the most negative outcome the reward could assign, and the phrase board is the
designed safety fallback that PRD §20 names as a mitigation and §22 makes a condition of done.
The reward function was training the ranker to keep a patient wrestling with poor candidates
rather than let them reach the board that protects them. Repair cost now applies only to a
correction, where the patient engaged and then had to fix the result; fallback and rejection
both score −0.8. Nothing optimises this reward today and no test failed, which is why it took
a hand-trace to find. D-065.

Three estimator changes landed with it. Doubly-robust estimation is reachable only through a
`ValidatedOutcomeModel`, which cannot exist without an `OutcomeModelValidation` whose six
fields have no defaults; requesting DR without a model blocks the entire comparison rather
than serving SNIPS under a DR heading, and supplying a model without requesting DR blocks too.
SNIPS stays the headline structurally — `headline_estimator` is a read-only property and the
diagnostic's `role` is read-only `secondary_diagnostic_only`, neither a constructor parameter.
Support deficiency is now detected where `overlap_rate` cannot, since overlap measures whether
the candidate covers the logger and deficiency is the opposite question; it is gated at 2% by
default under a 10% ceiling and what it computes is a provable lower bound, so a zero means
"nothing provable" and never "nothing there". And the improvement criterion replaces a bare
`lower > minimum_effect` with three conditions: interval lower bound over the minimum effect,
point estimate over it too, and survival of deleting the single most influential logged event.
D-066.

Clustering was resolved by deliberately not fixing it. A grouping id stable across a speaker's
events is a pseudonymous patient identifier — the collisions that make it useful for a cluster
bootstrap are exactly what makes it a re-identification handle, and no salting separates the
two. So the bias is made unmissable instead: it is the first entry of `LIMITATIONS`, it names
its direction (the true interval is wider and the error runs toward a false "candidate
better"), it repeats in `does_not_guarantee`, and `clustered_uncertainty_available` is a
permanently-false read-only property. D-064.

What is still not true: nothing calls the new endpoints, so the frontend confirmation loop must
still mint event ids and report outcomes before a single row exists. No real product event has
ever been logged, no policy is authorised for anything, and deployment, online experiment and
clinical claim remain permanently false. `max_deterministic_event_rate` defaults to 0.10, which
means the whole log is refused if the ranker produces a clear winner more than a tenth of the
time, and nobody has measured how often real Awaaz slates are near-tied — that number needs
watching from the first day of logging. `no_explicit_signal` rows are logged but cannot become
feedback, so the skip rate is a figure a reviewer must inspect before believing any estimate.
There is no preregistration, no privacy review, no retention or deletion job for `logged_on`,
and no independent review. The literature supplies no fixed minimum event count — the governing
quantity is effective sample size — and `MINIMUM_EFFECT_FLOOR = 0.02` still advertises roughly
ten times more resolution than the sample floors deliver, since at ESS 25 the smallest
adjudicable delta is about 0.18. That is an open calibration question, not a solved one.

Verified: `backend/tests/test_awaaz_policy_logging.py` carries 24 tests and
`backend/tests/test_awaaz_offline_rl.py` 76, counted from their definitions. The full backend suite
after this work reports **1191 collected / 1188 passed / 3 expected skips / 0 failed**, exit
code 0; the frontend reports **51 tests passed** across 8 files with `tsc -b` and
`npm run build` both exiting 0. The claims above
about columns, gates, properties, bounds and reward values were read out of
`backend/app/models.py`, `backend/app/routers/awaaz.py`, `backend/app/ml/rl/*.py` and
`backend/alembic/versions/0014_awaaz_policy_events.py` rather than taken from a summary.


## 2026-08-31 — Governance-gated ASR training runtime and offline policy evaluation

Awaaz personalised ASR now has a real training runtime and still has no trained model.
`backend/app/ml/train/asr_runtime/` implements fail-closed LoRA/PEFT fine-tuning of an
MMS / Wav2Vec2 CTC base and refuses to start without a consented archive, local base-model
weights, a signed purpose-specific governance receipt and a GPU host — none of which exist
here. No adapter, WER, or intelligibility number exists for Awaaz anywhere in this
repository, and none should be written until a governed run has happened and been reviewed.
Torch, transformers and peft are lazily imported through `importlib` inside one function, so
the API never needs the GPU stack; the optional pins live in `backend/requirements-train.txt`,
which has never been installed or verified here and is deliberately outside
`requirements.lock.txt`. The runtime briefly carried a second, co-located requirements file
listing `accelerate`; it was removed in favour of the one at `backend/`, because two optional
dependency files is one ambiguity too many and `accelerate` has no reference in the runtime,
which runs its own optimisation loop rather than a `Trainer`. D-058, D-059.

`backend/app/ml/rl/` adds an offline-only, ranking-only policy-evaluation package. A logging
policy that did not randomise is now refused rather than estimated: more than 10% of events
at a logged probability of 0.999 or above returns the blocker
`logging_policy_is_deterministic` and no estimate. Before that gate the same log returned
`candidate_better_offline` with a tight interval, which is an unidentifiable comparison
presented as a strong positive. Every evaluation gate now has an absolute floor so a config
can only be made stricter, and `deployment_allowed`, `online_experiment_allowed` and
`clinical_claim_allowed` became read-only properties that always return false. The production
Awaaz schema records no slate, policy version, propensity or outcome, so no current product
event is eligible. D-057, `docs/PLAN_RL.md`.

Privacy and truthfulness work landed alongside. `.gitignore` inverted from a deny-list to an
allow-list for `data/*` and `artifacts/**` — `data/mpower/` had been stageable despite the
asymmetry trainer's own docstring pointing real records there, and a patient `.wav`,
`.gguf`, `tokenizer.json` or `notes.txt` had been stageable under `artifacts/**`. Only
`data/README.md` and the five reviewed `*.metrics.json` are named back in. `--patient` no
longer reaches a tracked artifact or the console, which mattered because the privacy guard's
label pattern was `patient\s+id` and `\s` does not match the underscore in `patient_id`, so
it was blind to the exact key the code writes. An INV-1 leak in the archive verifier was
fixed: its snapshot used `tempfile.mkstemp` with no `dir=`, copying every consented WAV into
the shared system temp directory, contradicting `awaaz_archive.py`'s own promise never to
write patient audio to disk; it now snapshots beside the archive. The five model cards are
genuinely generated from `artifacts/*.metrics.json` by `render_model_cards.py`, with only
the hand-written `## Purpose` section carried through between markers. D-060, D-061.

Seven findings from an adversarial audit of `asr_runtime` are recorded and not fixed:
symmetric-HMAC receipts an operator can mint for themselves, a synthetic-smoke path that
escapes the output-path guard, a split with no size floor or ceiling, an `epochs_completed`
counter that can overstate a truncated epoch, an orphan-adapter window between publishing
weights and publishing the manifest, a metadata sanitizer blind to `target_text`, and a
base-model snapshot written to shared temp. They are stated in full in
`COMPLETION_CHECKLIST.md` and `PLAN_AWAAZ.md`.

Verified: backend **1085 collected / 1082 passed / 3 expected skips / 0 failed**, exit code
0; frontend **51 tests passed** across 8 test files, with `tsc -b` and `npm run build` both
exiting 0. The previous committed baseline was 912 collected / 909 passed / 3 skips. New
coverage is `test_awaaz_offline_rl.py` (46 tests), `test_asr_runtime.py` (27 tests) and
`test_asr_runtime_gates.py` (45 test functions / 87 parametrised cases). Coverage was
measured by mutation rather than asserted: every `if` guard in `runtime.py` whose body raises
a refusal was neutered one at a time in a scratch copy, and the two ASR suites were re-run
against each. **35 of 78 guard sites are deletion-sensitive**, including every gate the
adversarial audit flagged as high-risk -- consent, corpus variety, the audio contract,
conflicting labels, receipt time-window integrity, subject binding, the dependency floor,
artifact privacy, and input re-verification. The 43 survivors are defensive checks on
malformed input that no fixture produces, plus the optimisation loop itself
(`non_finite_loss`, `training_step_failed`, `device_unavailable`), which cannot execute here
at all because torch is not installed. That second group is an environment limit, not a
test-quality one, and it will stay unmeasured until a real training host exists.
`.venv/bin/python -m app.ml.rl.simulate --events 60 --seed 42` returns
`candidate_better_offline`, delta 0.778, 95% interval [0.636, 0.883] on a made-up log; a
π₀=1.0 log returns `status=blocked`; `min_events=2` is refused and `min_events=500` accepted.
Importing `asr_runtime` and booting the FastAPI app were each checked to load zero heavy
modules, and the synthetic dry-run output directory was confirmed to contain exactly
`manifest.json`. Zero tracked files regressed under the new `.gitignore` rules.

## 2026-08-29 — Awaaz authenticated offline phrase board

After an authorized online load, Awaaz now keeps a metadata-only phrase-board snapshot in
an origin-scoped IndexedDB store bound to both the current user and patient. If the API is
unreachable, a reload recovers the saved Punjabi/Hindi/English phrase tiles instead of
collapsing the product to emergency-only mode. A 401, 403, or 404 never uses that snapshot,
so cache availability cannot revive revoked or unrelated access.

The offline screen clearly says that taps use the phone's installed browser voice and that
activity is not saved. Phrase tiles remain tappable; free text, practice capture, endpoint
settings, phrase management, and listener-link actions are disabled until reconnection.
Emergency recording, self-test, deletion, and playback retain their separate local-only
contract, and browser speech is not claimed as verified offline audio.

Verified: frontend **51 tests passed**; the new boundary tests pin transport-only fallback,
401/403/404 refusal, exact user/patient binding, and corrupt/cross-patient snapshot refusal.
TypeScript and the production Vite/PWA bundle passed; oxlint reported only the repository's
known warnings. In an isolated migrated SQLite demo, the board was loaded online, the
backend was stopped, and a full reload recovered all Punjabi tiles with Hindi offline copy.
Tapping `ਪਾਣੀ` immediately showed the selected phrase and the explicit unsaved-tap warning;
free-text and listener-link controls were disabled.

## 2026-08-28 — Awaaz leakage-safe cohort readiness

Multiple verified single-patient Awaaz archives can now be checked together without
extracting or pooling their media. The planner keeps every speaker whole and connects any
speakers who share an exact Unicode-normalised phrase in the same language, then assigns
only whole connected components to train, validation, or test. This prevents both speaker
leakage and repeated-board-prompt leakage.

If shared prompts leave fewer than three independent components, the artifact blocks and
omits capture IDs rather than manufacturing a clean split. A ready artifact includes only
deterministic seed-42 capture assignments and aggregate counts—never patient IDs, phrase
text, audio, or hashes. Its claims state that archives were not pooled and no model,
evaluation, clinical metric, or deployable artifact was produced. It also records that
local export consent is not consent for pooled research.

Verified: backend **912 collected / 909 passed / 3 expected skips / 0 failed** with an
explicit writable Numba cache for the repository's symlinked virtual environment. Thirteen
focused archive/planner tests pin input-order determinism, simultaneous speaker/phrase
isolation, duplicate patient and capture refusal, shared-default-prompt blocking, private
output, non-extracting multi-archive verification, and owner-only report permissions.

## 2026-08-28 — Awaaz personal phrase-board management

The existing add/delete card endpoints now power a collapsed, trilingual management panel
below the patient speaking surface. An authorized caregiver, linked patient, or clinician
can add the patient's everyday phrases in the board's language and remove any non-emergency
tile. Newly added phrases appear immediately as speakable cards; Enter and the explicit add
button follow the same path.

The server trims outer whitespace, rejects blank and Unicode-normalised duplicate phrases,
appends instead of jumping a new card to the first slot, and caps the board at 36 tiles so it
remains navigable. Emergency deletion remains blocked. Add and delete are audited without
placing phrase text in audit metadata, and deleting a tile does not silently delete a
separately consented local learning recording. The UI explicitly says tile customization is
not speech-recognition training.

Verified: backend **907 collected / 904 passed / 3 expected skips / 0 failed**. New API
tests pin normalized duplicate refusal, blank rejection, append ordering, the 36-card cap,
linked-patient deletion, and text-free add/delete audit events. Frontend **48 tests passed**;
TypeScript passed, oxlint reported only the repository's known warnings, and the production
PWA bundle built. On an isolated migrated SQLite demo, a Punjabi phrase added from the
English UI appeared immediately as a speakable tile, deleted cleanly through confirmation,
and the complete management surface localized to Punjabi. Privacy preflight passed **7/7**.

## 2026-08-28 — Awaaz privacy-safe corpus readiness

A verified local Awaaz archive can now produce a non-clinical readiness artifact without
extracting media or publishing patient identity, transcripts, audio hashes, or audio. The
artifact reports only aggregate corpus counts until both 50 pairs and 10 distinct
Unicode-normalised phrase groups are present; once ready it adds deterministic seed-42
capture-ID assignments that keep every exact phrase within a language in only one of train,
validation, or test.

The JSON marks model training, evaluation, clinical metrics, and deployment readiness false.
It records the 200-pair pilot target as non-hard, blocks speaker-disjoint claims from a
single-patient archive, and leaves listener intelligibility gain to an approved, consented
human study. The command refuses to overwrite an existing output and creates the report
with owner-only permissions.

Verified: backend **904 collected / 901 passed / 3 expected skips / 0 failed**. Eight focused
archive/planner tests pin non-extracting validation, aggregate-only small-corpus behavior,
normalised-phrase isolation, deterministic assignments, false claim flags, owner-only file
permissions, and overwrite refusal. Privacy preflight passed **7/7**.

## 2026-08-28 — Awaaz listener capability recovery

Refreshing or revisiting the Awaaz page no longer loses control of an already-shared
listener link. An authorized GET returns the one current active capability for that patient,
and the frontend reconstructs the same language-bearing URL before enabling the share
control. Unauthorized users receive the normal patient-access 403.

Minting a replacement now revokes any prior active link for that patient before returning
the new token. This enforces one live conversation capability per patient and prevents an
older, hidden URL from continuing to expose confirmed messages after the owner thinks they
replaced it. The mint audit records only the count of superseded links, never their tokens.

Verified: backend **900 collected / 897 passed / 3 expected skips / 0 failed**. The new test
pins authorized recovery, unauthorized refusal, language preservation, old-link 404 after
replacement, new-link availability, and current-token authority. Frontend remains **47
tests passed**; TypeScript and oxlint passed (known warnings only), and the production PWA
bundle built. In rendered QA, a full Awaaz reload recovered the exact same URL and
stop-sharing control; revocation still changed the live public page to the generic expired
view on its next poll. Cross-device replacement/supersession is pinned by the backend
integration test. Privacy preflight passed **7/7**.

## 2026-08-28 — Awaaz listener revocation closure

The Awaaz sharing panel now keeps an explicit stop-sharing control beside the active
listener URL, explains that new confirmed messages remain visible until expiry, and reports
created, copied, copy-failed, revoked, and revoke-failed states in English, Hindi, and
Punjabi. Successful revocation clears the local link immediately; a failed request leaves
the control available for retry.

The existing backend revoke route previously trusted any authenticated user who knew a
token. It now resolves the capability's patient and applies the same caregiver, linked
patient, or clinician access rule as other Awaaz patient operations. An unrelated caregiver
gets 403 and cannot interrupt the conversation. Owner retries are idempotent and create one
audit event; unknown tokens remain a generic success so the endpoint does not become a
token-existence oracle. The unauthenticated listener token remains read-only.

Verified: backend **899 collected / 896 passed / 3 expected skips / 0 failed**. The new API
test pins unauthorized refusal, continued listener availability after refusal, immediate
404 after owner revocation, and single-row audit behavior across retry. Frontend remains
**47 tests passed**; TypeScript and oxlint passed (known warnings only), and the production
PWA bundle built. The complete flow was rendered against an isolated migrated SQLite demo:
the owner created a live capability, saw the disclosure and stop-sharing action, revoked it,
received the success state, and the public page changed from live coaching to the generic
expired/unknown view on its next poll. Privacy preflight passed **7/7**.

## 2026-08-28 — Awaaz public listener localization

The unauthenticated listener page now renders its whole shell in the capability's English,
Hindi, or Punjabi language instead of surrounding localized server coaching with English
UI. Loading, transient-error, retry, expired, empty, TTL, and privacy states all follow the
same normalized language. The document and each recent utterance declare their language so
assistive technology can pronounce mixed-language conversation text correctly.

New share URLs carry the capability language in their query string, allowing first-load and
expired states to localize before any API response. Once loaded, the server's session
language is authoritative. No identity, health history, score, audio, or additional history
was added to the listener payload.

Verified: frontend **47 tests passed**; new tests pin complete copy for all three languages,
safe English fallback, and language-bearing share paths. TypeScript and oxlint passed
(known warnings only), and the production PWA bundle built. The unauthenticated Punjabi
connection-error state was rendered in the browser: copy and retry action were Punjabi and
both document and main language resolved to `pa`. Backend behavior remains unchanged from
the preceding **898 collected / 895 passed / 3 expected skips / 0 failed** run.

## 2026-08-28 — Awaaz emergency dial action

The connected Awaaz board and its emergency-only offline fallback now expose the same
explicit 108 action. It uses a pinned `tel:108` target to hand control to the device's phone
app; it does not auto-dial, report success, or treat opening the dialer as proof that a call
connected. The action is separate from the red speak-and-alert control, so activating one
cannot silently trigger the other, and the existing long-press detector excludes links.

The label is available in English, Hindi, and Punjabi. Direct caregiver calling remains
unimplemented because the product has no consented caregiver phone-number or contact-choice
contract; no number was inferred from email or other profile data.

Verified: frontend **44 tests passed**; the dial-contract test pins both `108` and
`tel:108`. TypeScript passed, oxlint reported only the repository's known warnings, and the
production PWA bundle built successfully. Backend behavior is unchanged from the preceding
**898 collected / 895 passed / 3 expected skips / 0 failed** run.

## 2026-08-28 — Awaaz archive verification and synthetic-trainer truthfulness

The backend now verifies a local Awaaz tar without extracting patient audio. It rejects
unsafe or duplicate paths, links, undeclared files, unsupported schemas/sources/languages,
invalid patient/capture/association UUIDs, pair and corpus size overruns, non-WAV payloads,
and SHA-256 or byte-size mismatches before returning an in-memory verified corpus.

The personalised-ASR command previously treated a data directory's existence as proof of a
real run even though it still generated synthetic pairs. That path is removed. Archive mode
now verifies the corpus and then exits before writing a model or non-synthetic metrics,
because LoRA fine-tuning and evaluation do not exist. The demonstration mode remains
runnable and unconditionally writes `synthetic: true`; its artifact and model card now say
that it is a simulation scaffold.

Verified: backend **898 collected / 895 passed / 3 expected skips / 0 failed**. New tests
pin successful non-extracting verification, corrupt-hash and undeclared-file refusal, and
the guarantee that archive mode creates no model directory or metrics. Frontend remains
**43 tests passed** with TypeScript, oxlint, and the production PWA build green from the
unchanged export milestone.

## 2026-08-28 — Awaaz verified local training export

Consented card and caregiver-reviewed-repeat pairs can now leave IndexedDB only through an
explicit local download. The control is hidden when no pairs exist and disabled until the
user acknowledges that the archive contains patient voice and verified words, leaves
protected app storage, and cannot be revoked by deleting the in-app copy.

Before building the POSIX tar, the browser recomputes every WAV's SHA-256 and refuses the
entire export on any mismatch. The archive contains a sensitive-data README, a versioned
manifest with source/label/integrity metadata, and the local WAVs. NeuroTrace performs no
upload and has no media endpoint; transfer to an authorised training environment remains a
separate human-controlled action.

Verified: frontend **43 tests passed**; the archive test parses the generated tar, verifies
the manifest and embedded WAV, and pins corrupt-audio refusal. TypeScript and oxlint passed,
and the production PWA bundle built. Backend remains **894 collected / 891 passed / 3
expected skips / 0 failed** from the preceding unchanged API milestone.

## 2026-08-28 — Awaaz caregiver-reviewed local repeats

The evening review can now remain text-only or, after an explicit patient-consent checkbox,
record one fresh repeat of the verified words. The 16 kHz WAV is previewable and stays in
the browser's IndexedDB vault. Only its UUID, duration, SHA-256/size, source and consent
receipt cross the API; no request field accepts media bytes.

The reviewed label locks to the WAV once local retention begins. Exact retries after a lost
response are idempotent, failed saves can restore the pair by utterance ID, and deletion
revokes both the local copy and its server receipt. Partial or unconsented receipts are
rejected, emergency events cannot become training pairs, and text-only review still needs
no microphone permission. This pairs a fresh reviewed repeat, not the original unclear
conversation, and makes no ASR or adapter-training claim.

Verified: backend **894 collected / 891 passed / 3 expected skips / 0 failed** (with Numba's
cache directed to writable `/tmp`); frontend **41 tests passed**; TypeScript and oxlint
passed; and the production PWA bundle built. The seeded caregiver route was exercised in
the browser in English and Hindi: recorder controls appeared only after consent, the
local-only disclosure rendered, and text-only correction still saved and cleared the
queue. Microphone permission and audio capture remain a physical-device field test.

## 2026-08-28 — Awaaz emergency activation and provider boundary

Holding non-interactive space for 1.2 seconds now activates the same fixed emergency path
as the red button. Interactive controls are excluded, finger movement beyond 14 px cancels
the timer, and the gesture is also available on the emergency-only offline screen, so
scrolling and ordinary taps cannot silently become alerts.

Location sharing is explicit, per-patient local consent. A location fix is requested only
after opt-in, kept in memory, bounded to 1.5 seconds on the critical path, and sent in the
emergency body with accuracy metadata; the audit stores only that it was shared. The server
rejects partial or unconsented body coordinates.

A configured SMTP adapter now emails the owning caregiver and sets `caregiver_notified`
only after the relay accepts that recipient. Missing configuration, provider failure, or
recipient refusal stay false. The old unused WhatsApp mock can no longer report success.
No recipient, patient name, message body, coordinates, or provider exception is logged.

Verified: backend **892 collected / 889 passed / 3 expected skips / 0 failed**; frontend
**40 tests passed**; TypeScript and oxlint passed; the production PWA bundle built; and the
rendered Awaaz route exposed the long-press guidance and explicit location gate, reported
an unconfigured provider truthfully, and logged no browser errors. Real-device location
permission and live SMTP delivery remain deployment field tests requiring user consent and
provider credentials.

## 2026-08-28 — Awaaz offline emergency voice

The persistent emergency control now starts a patient-specific WAV from IndexedDB before
making any network request. A quiet caregiver panel records the fixed phrase, makes its
local-only storage explicit, provides a visible self-test, supports re-recording and
deletion, and requests persistent browser storage as a best effort. The ordinary phrase
grid no longer duplicates the emergency card, so there is one safety path.

The API receives no audio—only `offline_audio_played`, set after the browser accepts local
playback. `works_offline` mirrors that event rather than the mere existence of a recording;
browser speech synthesis remains a clearly warned fallback and is never counted as offline.
Emergency audit rows pin the receipt and confirm speech recognition was not used. Caregiver
delivery remains false until a real provider accepts a notification. Offline startup also
keeps the last authenticated local identity instead of deleting it on a network error, so
the emergency-only fallback can render while invalid-session responses still sign out.

Verified: backend **886 collected / 883 passed / 3 expected skips / 0 failed**; frontend
**39 tests passed**; TypeScript and oxlint passed; the production PWA bundle built; and the
rendered Awaaz route retained its emergency control with the backend stopped and logged no
browser errors.

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
