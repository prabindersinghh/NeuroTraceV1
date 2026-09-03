# scripts/

Five scripts. Each carries its own rationale in its header — read that before running it.

| Script | What it does |
|---|---|
| [`preflight_push.sh`](preflight_push.sh) | **The privacy gate.** Seven checks that keep patient material out of the repository, run automatically on `git push`. If it fails, that is INV-11 working — never bypass it. |
| [`verify_deploy.sh`](verify_deploy.sh) | Verifies a **deployed** instance reproduces the local demo exactly. `./scripts/verify_deploy.sh https://your-app.up.railway.app` |
| [`seed_demo.sh`](seed_demo.sh) | Restores the 21-day demo on any instance in one command. |
| [`run_backend.sh`](run_backend.sh) | Symlink to `backend/run.sh`. Starts the backend on `localhost:8000`, falling back to SQLite if local Postgres is unreachable. |
| [`download_datasets.sh`](download_datasets.sh) | Fetches the openly downloadable training datasets. Three more need a human to request them — see [`../docs/DATASET_REQUESTS.md`](../docs/DATASET_REQUESTS.md). |

## hooks/

[`hooks/registry-guard.sh`](hooks/registry-guard.sh) re-runs the tier and invariant suites
whenever the exam registry changes. It is a development convenience, not a wired hook.

The wired hook is [`../.githooks/pre-push`](../.githooks/pre-push), which execs
`preflight_push.sh`. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

It lives in a hook rather than in your fingers because it was once invoked as
`preflight_push.sh | tail -3 && git push` — where the pipeline's exit code is `tail`'s, so a
**failing** gate returned 0 and the push proceeded. A control that depends on being invoked
correctly is not a control.
