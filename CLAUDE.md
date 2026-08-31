# NeuroTrace — start here

A post-stroke recovery ecosystem. A survivor runs a daily neurological exam on an ordinary
phone; the system learns what is normal **for that person** and flags deterioration before
anyone in the house can name it. Feature extraction runs in the browser; the server receives
numbers, never media.

Deployed: backend `neurotracev1-production.up.railway.app` (Neon Postgres),
frontend `neuro-trace-v1.vercel.app`. Demo login `clinician@neurotrace.app` /
`neurotrace-demo` (or `$DEMO_PASSWORD` on the instance).

---

## Read in this order

1. **`docs/PROGRESS.md`** — the living snapshot. Current state, what is built, what is
   pending, known risks. It carries a `Last updated:` stamp; if you change the state of the
   product, you update this file. A stranger should be able to continue from it alone.
2. **`docs/DECISIONS.md`** — why things are the way they are, newest at the bottom.
   Read before proposing a change that contradicts one. Superseded decisions are marked, not
   deleted.
3. **`docs/ARCHITECTURE.md` §6** — the INVARIANTS. These are not preferences.
4. **`docs/CHANGELOG.md`** — dated per-session entries. What changed, what was verified, how.

Then by need: `TRD.md` / `PRD.md` (requirements), `CLINICAL_REFERENCE.md` (the clinical
grounding and its sources), `ML_STATUS.md` (**every model is synthetic — read before making
any accuracy claim**), `DEPLOY.md` (runbook), `PLAN_AWAAZ.md` (the communication feature),
`COMPLETION_CHECKLIST.md` (line-by-line status).

`docs/CONTEXT_BRIEF.md` is competition strategy, not engineering context.

## Navigating the code: use the graph

A knowledge graph of this repo — 2751 nodes, 5321 edges, 189 communities — answers "where
does X happen" faster than grep. It is **generated, not tracked** (see below), so build it
once after cloning:

```bash
uv tool install graphifyy                                          # once; adds `graphify`
graphify update .                                                  # ~60s, no LLM needed
graphify query "how does a session become an ALERT? which gates"   # BFS over the graph
graphify explain "evaluate_gates"                                  # a node and its neighbours
graphify affected "compute_session"                                # what breaks if I change this
```

`graphify-out/GRAPH_REPORT.md` is the readable summary. The graph is a **snapshot** — if it
disagrees with the code, the code is right; re-run `graphify update .`.

**Why it is not committed.** The graph indexes tracked source, `test_privacy.py` included —
and that file necessarily quotes the identifier patterns it hunts for. Tracking the graph
therefore trips INV-11's text scan on the scanner's own bait. (Describing this in a tracked
doc trips it too, which is why this paragraph names no pattern literally.) A 5.5 MB artefact
that regenerates in a minute is not worth weakening a privacy invariant for, so
`graphify-out/` stays local.

## The invariants, in one line each

INV-1 raw media never leaves the device (no endpoint accepts an upload) · INV-2 no ALERT
without a lateralised finding · INV-3 acute symptoms and falls bypass the engine entirely ·
INV-4 the frozen reference is written once · INV-5 we own the trend, the vendor owns the
measurement · INV-6 server-side authorisation on every scoped route · INV-7 migrations never
lose rows · INV-8 audit data is append-only · INV-9 nothing is spoken for an aphasic patient
without confirmation · INV-10 every module has a declared tier placement · INV-11 **no
patient identifier anywhere in this repository** · INV-12 fall-risk tasks never appear in an
unsupervised schedule.

Each has a test. If one fails, that is the finding — do not route around it.

## Verifying your work

```bash
cd backend && .venv/bin/python -m pytest -q      # 1191 tests
cd frontend && npx vitest run && npx tsc -b && npm run build
./scripts/verify_deploy.sh                                 # against the live instance
```

**The backend suite takes longer than a 10-minute foreground timeout.** Run it in the
background and read the output file. Never run two pytest processes at once — they starve
each other on CPU and the contention looks exactly like a hang.

Judge success by **exit code**, never by grepping output for "error".

## Traps this repo has actually hit

- **Rendering a migration is not running it.** `alembic upgrade --sql` emits the text inside
  `op.execute` unchanged, so a SQLite-ism renders identically for Postgres and only fails
  when a real Postgres parses it. Two did, on the first Neon boot (`WHERE locked = 1`, then
  `PRAGMA foreign_keys=ON`). `backend/tests/test_migration_portability.py` guards this. D-014.
- **A deploy reporting SUCCESS is not a healthy app.** Always check `/health` for
  `database: up`, then run `verify_deploy.sh`.
- **`git push` runs a privacy preflight** (`scripts/preflight_push.sh`, 7 checks) because
  untracked real medical photos live under the git root. If it fails, that is INV-11 doing
  its job — never bypass it.
- **Tailwind tokens must exist.** `border-line` and `bg-surface` were used across the app and
  defined nowhere, so they silently rendered as nothing. Check `tailwind.config.js` before
  using a colour name.
- **Every ML model is trained on synthetic fixtures.** Say so in any claim, anywhere. The
  same applies to the face-identity threshold. `ML_STATUS.md` is the source of truth.
- **An executable training runtime is not a trained model.**
  `backend/app/ml/train/asr_runtime/` is a governance-gated LoRA/PEFT runtime for MMS /
  Wav2Vec2 CTC. It has never trained anything: no adapter exists, and no WER or
  intelligibility number exists for Awaaz ASR anywhere in this repository. Its synthetic
  dry-run writes a manifest and nothing else. Do not derive a metric, a model-card row, or
  an `ML_STATUS.md` cell from the existence of that code.

## House style

Write code that reads like the code around it. Comments explain **why**, especially where a
choice looks wrong until you know the reason — this codebase is dense with those and they are
load-bearing. Patient-facing text is English, Hindi and Punjabi, minimum 20px, 64px tap
targets. When you finish a session's work, update `PROGRESS.md` and add a `CHANGELOG.md`
entry with what you **verified**, not what you believe.
