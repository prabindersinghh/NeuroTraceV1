# DEPLOY — Railway + Neon

> **STATUS 2026-08-23 — DEPLOYED.**
> Backend: `https://neurotracev1-production.up.railway.app` (`/health` → `database: up`).
> Frontend: `https://neuro-trace-v1.vercel.app`.
> `verify_deploy.sh`: **7 passed, 0 failed** — the deployed engine reproduces the local
> band sequence exactly. Database is container-local SQLite until Neon: data survives a
> restart, NOT a redeploy. Swapping in Neon is changing `DATABASE_URL` and redeploying —
> the migrations render clean on the Postgres dialect.
>
> Four facts this deploy taught, now baked into config (details in CHANGELOG 2026-08-23):
> the container gets NO injected `PORT` and the domain's `targetPort` must be set;
> migrations run on the sync sqlite3 driver because aiosqlite's worker thread blocks
> process exit; **the container's stdout is a dead pipe** — everything is redirected to
> stderr, uvicorn's access log included; and the healthcheck gate is REMOVED (D-036)
> because its private-network probe kills containers the public edge serves fine —
> run `verify_deploy.sh` after every deploy instead.

A runbook. Follow it in order; every step is checkable.

**Why this matters more than anything else outstanding:** the product currently works on one
machine and nowhere else. A demo that depends on a laptop being awake is not a demo.

**What I could not do:** provisioning needs your accounts and browser sign-in, and Docker
Desktop's daemon is not running on this machine so I could not execute migrations against a
real Postgres. Everything that could be prepared without credentials is done — Dockerfile,
`railway.json`, the full migration chain rendered and read against the Postgres dialect, and
`scripts/verify_deploy.sh`, which checks the deployed engine produces the *identical* band
sequence rather than merely returning 200.

---

## 0 · Before you start

| | |
|---|---|
| Cost | Railway ~$5/month hobby; Neon free tier covers a demo |
| Time | ~30 minutes |
| Risk | Migrations have been **rendered** for Postgres, never **executed**. Step 3 is the first real test — run it against a Neon *branch*, not `main` |

Rendering already caught one deploy-breaking bug: migration 0003 emitted
`DROP CONSTRAINT ck_scores_ck_scores_band_enum`, a doubled prefix naming a constraint that
does not exist. SQLite swallowed it (batch mode rebuilds the table instead of issuing the
DROP); Postgres would have failed on first boot with a container that simply would not
start. Fixed, and `alembic upgrade head --sql` against the production dialect is now part of
this runbook.

---

### Order, if you are doing Vercel first

The three services depend on each other in one direction only, and neither dependency
blocks you from starting:

```
Neon ──DATABASE_URL──► Railway ──VITE_API_URL──► Vercel
                          ▲                         │
                          └──── FRONTEND_ORIGIN ────┘
```

Deploying Vercel first is fine. It builds and serves without a backend — it will just fail
every API call until `VITE_API_URL` points somewhere real. Because that value is baked in at
**build** time, setting it later requires a **redeploy**, not a restart. So the shortest path
is: Vercel now (get the URL) → Neon → Railway (set `FRONTEND_ORIGIN` to the Vercel URL) →
redeploy Vercel with `VITE_API_URL`. Two Vercel deploys, no waiting.

---

## 1 · Neon

1. Create a project at **https://neon.tech**.
2. Region: **AWS ap-south-1 (Mumbai)** — closest to the users.
3. Copy the connection string. It looks like
   `postgresql://USER:PASS@ep-xxx.ap-south-1.aws.neon.tech/neondb?sslmode=require`.
   Paste it as-is; the app rewrites `postgresql://` to `postgresql+asyncpg://` itself.
4. **Create a branch called `migrate-test`** off `main`. This is the whole point of choosing
   Neon (D-002): the first execution of an untested migration happens on a throwaway copy.

**Cold starts.** Neon's free tier suspends a compute after ~5 minutes idle, and the first
query afterwards takes **2–8 seconds**. Before any live demo, warm it:

```bash
curl -s https://<your-app>.up.railway.app/health >/dev/null   # ~10 min before you present
```

Keep a browser tab on the dashboard during the demo — every request keeps it warm. If you
cannot risk it, Neon's paid tier disables suspend.

## 2 · Railway

1. New project at **https://railway.app** → *Deploy from GitHub repo* → this repo.
2. **Set Root Directory to `backend` BEFORE the first deploy.**
   *Service → Settings → Source → Root Directory → `backend`* → then *Redeploy*.

   > **If you skipped this, the first build fails and the log looks like:**
   > ```
   > [railway] prepare railpack-v0.37.0
   >     ├── scripts/
   >     ├── .gitignore
   >     ├── CLINICAL_AMENDMENT_v3.md
   >     ├── FINAL_PRODUCT_SPEC_v4.md
   >     ├── README.md
   >     └── TASK_CLINICAL_SOURCE_REVIEW.md
   > Failed to build an image.
   > ```
   > That list is the whole diagnosis: Railway is looking at the repository **root**, where
   > there is no `requirements.txt` and no `Dockerfile`, so railpack cannot tell what this
   > project is. `backend/Dockerfile` and `backend/railway.json` are never read, because
   > Railway only reads build config from the service root. Nothing is wrong with the code
   > — it is a one-field setting, and a redeploy after setting it is all that is needed.
   >
   > The `Dockerfile` does `COPY requirements.txt .`, so its build context **must** be
   > `backend/`. Do not try to fix this by pointing a root-level config at
   > `backend/Dockerfile` — the context would be the repo root and every `COPY` would miss.
3. Set these variables. **Names only — never paste values into chat, tickets, or docs:**

| Variable | What goes in it |
|---|---|
| `DATABASE_URL` | the Neon **branch** string, for the first deploy |
| `JWT_SECRET` | generate fresh: `openssl rand -hex 32`. Never the dev default |
| `ENV` | `production` |
| `FRONTEND_ORIGIN` | your frontend URL. Comma-separate if several. **This is what locks CORS** |
| `DEMO_MODE` | `true` for the pitch. `false` for anything holding real data |

`PORT` is injected by Railway — do not set it.

## 3 · First deploy — the real migration test

The container runs `alembic upgrade head` before uvicorn, so the deploy either converges or
fails loudly.

```bash
railway logs | grep -iE "alembic|Running upgrade|Error"
```

**Expected:** `Running upgrade` for 0001 → 0008, then uvicorn starting.
**If a migration fails:** the container will not start, which is correct. The Neon branch is
disposable — read the error, fix locally, redeploy. Do not point at `main` until clean.

## 4 · Point at the real database

Change `DATABASE_URL` to the `main` Neon string and redeploy. **Take a Neon snapshot first**
— one click, and it is the difference between a mistake and an incident.

## 5 · Verify — the step that actually matters

```bash
./scripts/verify_deploy.sh https://<your-app>.up.railway.app
```

It checks, in order: health; that the FAST card serves in Punjabi (app + DB + i18n all
live); that CORS does not echo an arbitrary origin; that the **live OpenAPI schema
advertises no multipart endpoint** (INV-1 verified against production, not just the repo);
seeds the demo; and then the one that matters —

```
local   : SSSSSSSSSSSSSSSSSSWAA -> ALERT
deployed: SSSSSSSSSSSSSSSSSSWAA -> ALERT
```

A deployed instance that returns 200 and a *different* band sequence is a broken deploy that
looks healthy. That is the failure this script exists to catch.

Exit 0 = every check passed.

## 6 · Frontend

### Vercel (recommended)

*New Project* → this repo → then **three settings, all of which matter**:

| Setting | Value | Why |
|---|---|---|
| **Root Directory** | `frontend` | same trap as Railway — the repo root is not the app |
| **Framework Preset** | Vite | `frontend/vercel.json` already pins build/output/install |
| **Environment Variable** | `VITE_API_URL` = your Railway URL, no trailing slash | baked in at build time, so changing it later needs a **redeploy**, not a restart |

Then set `FRONTEND_ORIGIN` on the **backend** to the Vercel URL and redeploy the backend, or
CORS rejects every request and the app looks broken in a way the browser console explains
and the UI does not.

**The MediaPipe assets are fetched at build time, not committed.** `frontend/public/mediapipe`
is gitignored, so a fresh clone has zero of those files. `npm run build` triggers `prebuild`
→ `fetch-mediapipe.mjs`, which copies the wasm out of `node_modules` and downloads the
FaceMesh model with a SHA-256 check.

> This is worth understanding rather than trusting. Before the `prebuild` hook existed,
> `npm ci && npm run build` on a clean checkout **succeeded** and produced a `dist` with no
> wasm and no model — a green build and a dead camera on the deployed site. If you ever see
> the exam load but the camera never initialise, check `dist/mediapipe/` first.

Verified on a clean slate (`rm -rf public/mediapipe dist && npm run build`): exit 0,
`dist/mediapipe/face_landmarker.task` 3,758,596 bytes, 6 wasm files, model precached by the
service worker.

### Manual / static host

```bash
cd frontend
npm ci
VITE_API_URL=https://<your-app>.up.railway.app npm run build   # prebuild stages MediaPipe
```

Deploy `frontend/dist` to any static host.

**HTTPS is mandatory** — `getUserMedia` (camera and microphone) is refused on plain HTTP by
every modern browser, so the entire exam is dead without it. Both Railway and Vercel give
you HTTPS by default; do not proxy it away.

Then set `FRONTEND_ORIGIN` on the backend to that URL and redeploy, or CORS will reject it.

## 7 · Manual check (one minute, needs a login)

Register a clinician, open the roster, confirm for the seeded patient:

| Field | Expected |
|---|---|
| band | `ALERT` |
| gates | `gate1` `gate2` `gate3` all true |
| persistent domains | `cranial_nerves`, `motor`, `motor_speech` |
| lateralised domains | `cranial_nerves`, `motor` |
| card type | `deviation` |

If the bands match but the **gates** differ, the engine is running but a domain is being
computed differently — check that migrations reached 0008 and that `motor_speech` appears
rather than `speech_language`.

## 8 · Rollback

```bash
railway rollback                 # previous container
alembic downgrade <revision>     # schema, if a migration is the problem
```

Every migration 0003–0008 round-trips `upgrade head` → `downgrade base` on SQLite. On
Postgres the downgrades are rendered but, like the upgrades, unexecuted until step 3.

---

## Notes

**No always-on inference service.** Inference runs on the device. A cloud inference service
would require uploading the raw signal, which breaks INV-1, and would add a per-request cost
to users with intermittent data. ML training is batch GPU rented by the hour (D-004).

**Environment variables are documented by name only** here and everywhere else. If a value
has ever appeared in a chat, a ticket, or a screenshot, rotate it.
