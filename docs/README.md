# NeuroTrace documentation

Thirty-nine documents. This page is the map, so you never have to guess which one answers
your question.

> **The contract every document here obeys.** These files describe the system as it **is**.
> Where a document and the code disagree, **the code is right and the document is a bug** —
> fix the document, do not route around it. Where a document is a plan, its status line says
> so on the first line.

---

## Start here — in this order

Four documents carry the state of the project. Read them in order and you can continue the
work from a cold start.

| # | Document | What it answers |
|---|---|---|
| 1 | [PROGRESS.md](PROGRESS.md) | **The living snapshot.** What is built, what is pending, known risks. Carries a `Last updated:` stamp. If you change the state of the product, you update this file. |
| 2 | [DECISIONS.md](DECISIONS.md) | **Why things are the way they are.** Newest at the bottom. Read before proposing a change that contradicts one. Superseded decisions are marked, never deleted. |
| 3 | [ARCHITECTURE.md](ARCHITECTURE.md) | The system as it is. **§6 is the INVARIANTS** — those are not preferences, and each has a test. |
| 4 | [CHANGELOG.md](CHANGELOG.md) | Dated per-session entries: what changed, what was **verified**, and how. |

New to the repository entirely? Start at the [project README](../README.md) for what
NeuroTrace is, then [DEVELOPMENT.md](DEVELOPMENT.md) to get it running.

---

## Product and requirements

| Document | What it is |
|---|---|
| [PRD.md](PRD.md) | Product requirements v2.0 — the problem, the users, the product. |
| [TRD.md](TRD.md) | Technical requirements v2.0 — stack, contracts, constraints. |
| [INTENDED_USE.md](INTENDED_USE.md) | **Frozen source of truth** for what NeuroTrace is and what tier it belongs to. Every other document, UI string and slide must quote this. Pinned by INV-13. |
| [CLAIMS_MATRIX.md](CLAIMS_MATRIX.md) | Every public-facing sentence sorted into one bucket. **Check here before writing any copy.** A new claim is NEEDS EVIDENCE until it is added. |
| [PRD_AWAAZ.md](PRD_AWAAZ.md) | Awaaz — the communication assistant. Requirements and delivery plan. |
| [PLAN_AWAAZ.md](PLAN_AWAAZ.md) | Awaaz build plan and current status. |

## Clinical grounding

| Document | What it is |
|---|---|
| [CLINICAL_REFERENCE.md](CLINICAL_REFERENCE.md) | Calibration targets for the digital equivalents of clinical tests, from a consented anonymised neuro-otology assessment and two MRI reports. **The source of every clinical number in the product.** |
| [GAP_ANALYSIS.md](GAP_ANALYSIS.md) | What the implementation would and would not have caught in that reference patient. |
| [FIELD_REFERENCE.md](FIELD_REFERENCE.md) | Every table and field, in plain language. |
| [FIELD_TEST_PROTOCOL.md](FIELD_TEST_PROTOCOL.md) | How to turn one afternoon with a real phone into evidence. |
| [PHONE_TEST_RESULTS.md](PHONE_TEST_RESULTS.md) | **Empty template — nothing has run on a physical handset.** The largest untested surface in the project. |

## Build, run, ship

| Document | What it is |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Build, run, test, deploy. **Start here to get a local environment.** |
| [DEPLOY.md](DEPLOY.md) | Deployment runbook — Railway, Neon, Vercel, and the traps each one has actually sprung. |
| [CODEBASE_MAP.md](CODEBASE_MAP.md) | The tree annotated with `file:line`, written by reading the code rather than the docs. Includes "Things that surprised me". |

## Security, privacy and data

| Document | What it is |
|---|---|
| [SECURITY.md](SECURITY.md) | Auth model, role matrix, CORS, secrets, backup/recovery, incident response. |
| [ENDPOINT_DATA_AUDIT.md](ENDPOINT_DATA_AUDIT.md) | All 70 routes: what each returns, who may call it, why the return is minimal. Six real access-control gaps were found and fixed writing it. |
| [DATA_INVENTORY.md](DATA_INVENTORY.md) | Every table — what it stores, why, retention, and how it is deleted. |
| [SBOM.md](SBOM.md) | Software bill of materials for both halves, with advisory notes. |
| [GOVERNANCE_KEYS.md](GOVERNANCE_KEYS.md) | The approval boundary for ASR training. **No key is pinned; the runtime refuses every real training command.** That is the correct state until a clinical owner exists. |

## Machine learning

> **Read [ML_STATUS.md](ML_STATUS.md) before making any accuracy claim, anywhere.**
> Every model in this repository is trained on synthetic fixtures.

| Document | What it is |
|---|---|
| [ML_STATUS.md](ML_STATUS.md) | One table, every model, one unambiguous REAL DATA / SYNTHETIC column. |
| [ML_RECOVERY.md](ML_RECOVERY.md) | Data and adapter recovery runbook. |
| [PLAN_ML.md](PLAN_ML.md) | Models, datasets and the training pipeline. Status: PLANNED. |
| [PLAN_RL.md](PLAN_RL.md) | Awaaz offline policy evaluation. Offline-only; the logging contract has never been written to. |
| [RESEARCH_OPE.md](RESEARCH_OPE.md) | Literature brief on off-policy evaluation. A research note — **not** a decision record and **not** an authorisation. |
| [DATASETS.md](DATASETS.md) | Dataset and model strategy. |
| [DATASET_REQUESTS.md](DATASET_REQUESTS.md) | The three datasets that need a human to request them, and what to send. Calendar time nobody can compress later. |
| [models/](models/) | Generated model cards, one per model. Rendered by `backend/app/ml/train/render_model_cards.py` — **edit the generator, not the cards.** |

## Frontend and design

| Document | What it is |
|---|---|
| [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) | What the product looks and feels like — principles, tokens, components, copy. Cited directly from `tailwind.config.js`, `index.css` and `components/ui/`. |
| [FRONTEND_ENGINEERING.md](FRONTEND_ENGINEERING.md) | How it is built to that standard — stack, patterns, guard-rails. Companion to the above. |
| [LANDING_CONTENT_SPEC.md](LANDING_CONTENT_SPEC.md) | The words on the deployed landing page. |
| [LANDING_DESIGN_SPEC.md](LANDING_DESIGN_SPEC.md) | How that page looks and behaves. *(Was `design.md` at the repository root.)* |

## Status and work queue

| Document | What it is |
|---|---|
| [COMPLETION_CHECKLIST.md](COMPLETION_CHECKLIST.md) | Line-by-line status. `LIVE` = verified against the running system; `TEST` = verified by the suite only; `PENDING` = not done, with the reason. **The distinction is the point.** |
| [PENDING_WORK.md](PENDING_WORK.md) | The work queue: everything unfinished, and whether you can actually finish it. Every claim checked against the code, not against the doc that made it. |

## Demo and positioning

| Document | What it is |
|---|---|
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | The 3-minute live demo. Nothing in it is faked. |
| [DEMO_CLIPS.md](DEMO_CLIPS.md) | Shot list for the per-task instructional clips — an accessibility requirement, not polish. |
| [CONTEXT_BRIEF.md](CONTEXT_BRIEF.md) | Competition strategy. **Not engineering context** — do not build from it. |

## Subdirectories

| Directory | What is in it |
|---|---|
| [plans/](plans/) | Feature plans written before implementation. A plan is superseded by `DECISIONS.md` once the work lands. |
| [models/](models/) | Generated model cards. See the ML section above. |
| [archive/](archive/) | Executed build briefs and run reports. **Nothing here is current** — see [archive/README.md](archive/README.md) for what each was and what replaced it. |

---

## Conventions

**Layout.** Living reference documents sit flat in `docs/`. Subdirectories mean one of three
specific things: `plans/` is work not yet landed, `models/` is generated output, `archive/`
is history. If you are adding a document and it is none of those, it goes flat.

**Naming.** `SCREAMING_SNAKE_CASE.md` for reference documents, `PLAN_*.md` for plans.

**Cross-references** are written repo-root-relative in prose (`docs/ML_STATUS.md`) so they
resolve identically from a code comment, a test, and another document. Three tests depend
on exact paths under `docs/` — `test_regulatory_claims.py`, `test_privacy.py` and
`test_train.py` — so **run the backend suite after moving or renaming anything here.**

**Status lines.** A document that describes something unbuilt says so on its first line.
`PHONE_TEST_RESULTS.md` and `GOVERNANCE_KEYS.md` are the pattern to copy: state the absence
plainly rather than leaving the reader to infer it.
