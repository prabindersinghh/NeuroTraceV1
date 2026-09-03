## What changed

<!-- One paragraph. What this does, and why it is the right shape. -->

## Why

<!-- The problem. If it fixes a bug, what the failure actually was — not just the symptom. -->

Closes #

---

## Verified

Paste what you ran and the **exit code you saw**. Success is the exit code, never a grep of
the output for "error".

```
cd backend  && .venv/bin/python -m pytest -q          # exit:
cd frontend && npx vitest run                         # exit:
cd frontend && npx tsc -b && npm run build            # exit:
cd frontend && npx oxlint                             # exit:
```

- [ ] Backend suite passes
- [ ] Frontend tests, typecheck, lint and build pass
- [ ] I ran `./scripts/verify_deploy.sh`, or this change cannot affect the deployment

## Invariants

Which of the fourteen does this touch? (`docs/ARCHITECTURE.md` §6, listed in
`CONTRIBUTING.md` §3.) Write **none** if none.

<!-- e.g. INV-6 — adds a scoped route, authorisation asserted in test_api.py -->

- [ ] No invariant test was weakened, skipped, or allow-listed to make this pass

## Claims

- [ ] No new user-facing sentence, or every new one is covered by `docs/CLAIMS_MATRIX.md`
- [ ] No accuracy, lead-time or outcome number is stated — or if one is, `docs/ML_STATUS.md`
      says it comes from real data. **Every model here is trained on synthetic fixtures.**

## Living documents

- [ ] `docs/PROGRESS.md` updated, or the state of the product did not change
- [ ] `docs/CHANGELOG.md` entry added, recording **what I verified, not what I believe**
- [ ] `docs/DECISIONS.md` entry added, or nothing here would puzzle a future reader

## Privacy

- [ ] `scripts/preflight_push.sh` passed (it runs automatically if
      `git config core.hooksPath .githooks` is set)
- [ ] No patient identifier, no real medical media, no secret **value** anywhere in the diff
