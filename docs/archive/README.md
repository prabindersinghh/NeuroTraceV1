# Archive — documents that did their job

Nothing here is current. These are **executed build briefs** and **run reports**: the
instructions a past session was given, and the account it wrote afterwards. Their
conclusions have all been absorbed into the living documents, which are the ones you
should read instead:

| If you came looking for | Read this instead |
|---|---|
| What the product does and why | `docs/PRD.md`, `docs/TRD.md`, `docs/ARCHITECTURE.md` |
| Why a decision was made | `docs/DECISIONS.md` |
| What is built and what is pending | `docs/PROGRESS.md`, `docs/PENDING_WORK.md` |
| What changed in a session | `docs/CHANGELOG.md` |

They are kept, rather than deleted, for one reason: **live code cites them as provenance.**
A comment that says "D-044 moved this from MONTHLY to WEEKLY" is only checkable if the
document that ordered the move still exists.

## What is here

| File | What it was | Status |
|---|---|---|
| `CLINICAL_AMENDMENT_v3.md` | Structural amendment derived from a real anonymised post-stroke record. Recalibrated the clinical assumptions. | Executed 2026-08-22. Absorbed into `docs/CLINICAL_REFERENCE.md`, `docs/PRD.md`, `docs/TRD.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`. |
| `FINAL_PRODUCT_SPEC_v4.md` | Build spec for the two-layer session model. | Executed 2026-08-28. Superseded by `TASK_FINAL_TECHNICAL_COMPLETION.md`. Cited by D-044 in `docs/DECISIONS.md` as the source of a since-removed regulatory claim (INV-13). |
| `TASK_FINAL_TECHNICAL_COMPLETION.md` | Nine-part completion brief. Removed the outside-CDSCO claim (INV-13), introduced Daily Pulse vs Comprehensive Follow-up. | Executed 2026-08-28. **Cited by live code** — `app/models.py`, `app/exam/registry.py`, `app/engine/baseline.py`, migration `0012`, and three tests. Also on the INV-13 allowlist in `backend/tests/test_regulatory_claims.py`, because it quotes the banned phrasing in order to forbid it. |
| `COMPLETION_RUN_REPORT.md` | Report on branch `finish/autonomous-completion` (thirteen commits, never merged). | Historical. Its blocked items are tracked in `docs/SBOM.md` and `docs/PENDING_WORK.md`. |
| `UX-CHANGES.md` | Report on branch `ux/system-upgrade`, including deferred items that never got their own PLAN. | **Cited by live code** — `TaskShell.tsx`, `ui/card.tsx`, `ui/SyncStatus.tsx`, `lib/taskFlow.test.ts` point here for known, deliberate gaps. |

## Moved from the repository root

All five sat at the repository root until 2026-09-03. Older `CHANGELOG.md` entries refer to
them by their old bare filenames:

```
CLINICAL_AMENDMENT_v3.md            → docs/archive/CLINICAL_AMENDMENT_v3.md
FINAL_PRODUCT_SPEC_v4.md            → docs/archive/FINAL_PRODUCT_SPEC_v4.md
TASK_FINAL_TECHNICAL_COMPLETION.md  → docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md
COMPLETION_RUN_REPORT.md            → docs/archive/COMPLETION_RUN_REPORT.md
UX-CHANGES.md                       → docs/archive/UX-CHANGES.md
```

Two more root files moved in the same pass but are **not** archived — they are live
references: `DESIGN_LANGUAGE.md` and `FRONTEND_ENGINEERING.md` are now in `docs/`, and
`design.md` is now `docs/LANDING_DESIGN_SPEC.md`.

## The rule

**Do not edit anything in this directory.** These files record what was asked and what
happened. If one contradicts the code, the code is right and the living document should
say so — fix the living document, not the archive.
