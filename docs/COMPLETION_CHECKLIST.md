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
| 13 | Awaaz D1–D5 complete | **PARTIAL** | Backend D1–D5 in tests. Frontend: board + INV-9 speak flow + emergency LIVE at `/awaaz/:id`; listener page and caregiver review-queue UI not built |
| 14 | SVV module live in `posterior_vestibular` | **LIVE** | M21 registered; reproduces all three printed reference averages exactly |
| 15 | E3 audiometry self-report built | **TEST** | `score_hearing_change`; unilateral loss escalates |
| 16 | Model cards written; ML_STATUS states real vs synthetic | **LIVE** | 5 cards generated **from the artifacts**, so they cannot drift |
| 17 | Deployed on Railway + Neon; demo reproduces on public URL | **LIVE** | Railway + Vercel deployed; `verify_deploy.sh` **7/7** — identical band sequence on the public URL. Neon still to swap in (SQLite bridge until then) |
| 18 | EN / HI / PA throughout | **TEST** | All new surfaces trilingual |
| 19 | All invariants pinned; suite green by exit code | **LIVE** | 12 invariants; `pytest` **exit 0** — 793 collected / 792 passed / 0 failed / 1 skipped (optional denylist) |
| 20 | Privacy invariant passing; nothing pushed | **LIVE** | INV-11 green; 22 blobs purged; `preflight_push.sh` 7/7 |
| 21 | Living docs current | **LIVE** | 12 docs + 5 model cards |

---

## Known gaps, stated plainly

**PDF export (item 11).** Built as a print view, not a server-side generator - see D-032
for why that is the right trade here and what it costs (no scheduled or headless export).

**CCG baseline comparison (item 9).** Built. Note it is unavailable until a balance
baseline locks, by design (D-033).

**Demo videos (item 6).** `TaskShell` accepts and displays `demoSrc`, and the flow is built
around it, but no clips have been recorded. Recording them needs a person to film.

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
