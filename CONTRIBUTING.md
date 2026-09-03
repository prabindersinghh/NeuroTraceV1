# Contributing to NeuroTrace

NeuroTrace measures neurological change in stroke survivors from an ordinary phone. A bug
here does not corrupt a shopping cart — it can produce a false reassurance for somebody who
needed to call an ambulance, or leak a patient's medical data. The rules below exist because
of that, and a few of them exist because this repository has already been bitten.

**New here?** Read the [project README](README.md), then
[`docs/README.md`](docs/README.md) — it maps all thirty-nine documents so you never have to
guess which one answers your question.

---

## 1 · Get it running

Setup lives in **[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)** — Python 3.11 (MediaPipe
publishes no 3.12 wheels), Node 18+, PostgreSQL 15 in production and SQLite for the suite.
It is not repeated here so it cannot drift.

```bash
cd backend  && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.lock.txt
cd frontend && npm install && npm run fetch:mediapipe
```

## 2 · Read before you change

| Before you… | Read |
|---|---|
| change anything | [`docs/PROGRESS.md`](docs/PROGRESS.md) — the current state |
| do something the code seems to argue against | [`docs/DECISIONS.md`](docs/DECISIONS.md) — it is probably deliberate and recorded |
| touch the engine, safety gates or schema | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) **§6, the invariants** |
| write any user-facing sentence | [`docs/CLAIMS_MATRIX.md`](docs/CLAIMS_MATRIX.md) |
| state any accuracy number | [`docs/ML_STATUS.md`](docs/ML_STATUS.md) — **every model is trained on synthetic fixtures** |

## 3 · The invariants

Fourteen rules are not preferences. **Each one has a test. If a test fails, that is the
finding — do not route around it.**

| | |
|---|---|
| **INV-1** | Raw media never leaves the device. No endpoint accepts an upload. |
| **INV-2** | No ALERT without a lateralised finding. |
| **INV-3** | Acute symptoms and falls bypass the engine entirely. |
| **INV-4** | The frozen reference is written once. |
| **INV-5** | We own the trend, the vendor owns the measurement. |
| **INV-6** | Server-side authorisation on every scoped route. |
| **INV-7** | Migrations never lose rows. |
| **INV-8** | Audit data is append-only. |
| **INV-9** | Nothing is spoken for an aphasic patient without confirmation. |
| **INV-10** | Every module has a declared tier placement. |
| **INV-11** | **No patient identifier anywhere in this repository.** |
| **INV-12** | Fall-risk tasks never appear in an unsupervised schedule. |
| **INV-13** | No regulatory-exemption claim anywhere. [`docs/INTENDED_USE.md`](docs/INTENDED_USE.md) is the frozen statement. |
| **INV-14** | A module holds the same session position in every session type (fatigue-curve confound). |

## 4 · Verify

```bash
cd backend  && .venv/bin/python -m pytest -q          # 1456 tests
cd frontend && npx vitest run && npx tsc -b && npm run build && npx oxlint
./scripts/verify_deploy.sh                            # against the live instance
```

Three things this repository learned the hard way:

- **The backend suite outlives a 10-minute foreground timeout.** Run it in the background
  and read the output file.
- **Never run two pytest processes at once.** They starve each other on CPU and the
  contention looks exactly like a hang.
- **Judge success by exit code, never by grepping output for "error".**

## 5 · The privacy gate

`git push` runs [`scripts/preflight_push.sh`](scripts/preflight_push.sh) — seven checks,
because untracked real medical photographs live under the git root and the working tree is
one `git add -A` away from publishing somebody's medical records permanently.

```bash
git config core.hooksPath .githooks     # once per clone — do this now
```

**If the preflight fails, that is INV-11 working. Never bypass it.** It was once invoked as
`preflight_push.sh | tail -3 && git push`, where the pipeline's exit code is `tail`'s — so a
failing gate returned 0 and the push proceeded. That is why it now lives in a git hook,
where no invocation can get it wrong.

## 6 · House style

**Code.** Write code that reads like the code around it. Comments explain **why**, and
especially so where a choice looks wrong until you know the reason — this codebase is dense
with those and they are load-bearing. Do not delete one you do not yet understand.

**Patient-facing text.** English, Hindi and Punjabi. Minimum 20px type, 64px tap targets.
Every string goes through `frontend/src/lib/i18n.tsx`; a hardcoded one fails
`hardcodedStrings.test.ts`.

**Tailwind.** Check `tailwind.config.js` before using a colour name. `border-line` and
`bg-surface` were used across the whole app and defined nowhere, so they silently rendered
as nothing.

**Migrations.** Rendering a migration is not running it — `alembic upgrade --sql` emits
whatever is inside `op.execute` unchanged, so a SQLite-ism renders identically for Postgres
and only fails when a real Postgres parses it. Two did, on the first Neon boot.
`backend/tests/test_migration_portability.py` guards this.

**Claims.** Every model is trained on synthetic fixtures — say so in any claim, anywhere.
An executable training runtime is not a trained model: `backend/app/ml/train/asr_runtime/`
has never trained anything, and no WER or intelligibility figure for Awaaz ASR exists
anywhere in this repository. Do not derive one from the existence of that code.

## 7 · Commits and pull requests

Commit messages say what changed and what was **verified**, in the imperative mood:

```
fix: reject a session whose laterality flips mid-window

The gate read the sign from the first module only, so a right-sided finding
followed by a left-sided one still passed INV-2. Reproduced in
test_laterality.py::test_flip_within_window, which failed before this change.
```

A pull request should:

1. **Pass every check in §4**, and say so with the exit codes you saw.
2. **Name the invariants it touches**, if any.
3. **Update the living documents.** If you changed the state of the product, update
   [`docs/PROGRESS.md`](docs/PROGRESS.md) and add a [`docs/CHANGELOG.md`](docs/CHANGELOG.md)
   entry recording **what you verified, not what you believe**.
4. **Record the reasoning** in [`docs/DECISIONS.md`](docs/DECISIONS.md) if you decided
   something a future reader would otherwise undo. Newest at the bottom; supersede, never
   delete.

## 8 · Reporting a security or privacy issue

Do **not** open a public issue. See [`docs/SECURITY.md`](docs/SECURITY.md) for the reporting
path and the incident-response procedure.

If you believe patient-identifying material has reached the repository, treat it as an
incident immediately: it is not fixed by a delete, because the blob stays reachable in the
object store. `scripts/preflight_push.sh` step 3 is what detects that state, and its failure
message carries the remediation.
