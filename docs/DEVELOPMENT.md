# NeuroTrace v2

A 45-second daily neurological check-in for stroke survivors at home. It captures **voice**,
**facial movement** and **reaction time**, learns each patient's *personal* baseline over the
first four valid days, and raises an alert only when **two or more signals deviate together
for three consecutive days**. Every verdict comes with a plain-language explanation in
English and Hindi.

No population thresholds. No black box. No wearable.

---

## Status — complete, end to end

| Area | State |
|---|---|
| Repo structure (TRD §2) | done |
| All 7 tables (TRD §3) — models, Pydantic schemas, Alembic migration | done |
| Auth — register / login / refresh, JWT access+refresh, bcrypt, roles, guards | done |
| ML core ported from the verified reference, logic unchanged (SHA256-identical) | done |
| `compute_checkin()` — features → baseline → deviations → score → alert gate → explanation → persist | done |
| Routers — `/patients`, `/checkin/*`, `/dashboard`, `/demo` (TRD §6) | done |
| Frontend — React 18 + Vite + TS + Tailwind + Recharts | done |
| Patient check-in — mic, webcam, tap game, EN/HI, mobile-first | done |
| Caregiver dashboard — status card, 3 trend charts, history, alert log | done |
| Demo seed + one-click demo mode + `DEMO_SCRIPT.md` | done |
| Deploy — Dockerfile, `render.yaml`, `vercel.json`, health check | done |
| Tests — 105 passing, including a real-media HTTP journey | done |

---

## Layout

```
NeuroTraceV1/
  backend/
    app/
      main.py            FastAPI app, CORS, /health
      config.py          settings from .env (pydantic-settings), seed=42
      db.py              async engine / session / declarative Base
      models.py          SQLAlchemy tables — TRD §3
      schemas.py         Pydantic v2 request/response models
      seed.py            CLI demo seeder — python -m app.seed
      auth/              password.py (bcrypt) · jwt.py (access+refresh) · deps.py (current_user, role guards)
      routers/           auth · patients · checkin · dashboard · demo
      ml/                speech · face · reaction · baseline · scoring · explain   (ported verbatim)
        train/           offline training scripts (empty in Tier 1 — scoring is unsupervised)
      services/
        checkin.py       compute_checkin() — the daily pipeline
        media.py         temp upload storage, deleted after extraction
        seed.py          the ten-day demo dataset
        synthetic.py     feature generator behind the demo (seed=42)
        whatsapp.py      mock sender (logs, PII-free)
    alembic/             async migration environment + 0001_initial_schema
    tests/               pytest suite (+ real WAV/WebM fixture generators)
    requirements.txt · requirements.lock.txt · Dockerfile · .env.example · pytest.ini
  frontend/
    src/
      lib/               api.ts (JWT + refresh) · auth.tsx · i18n.tsx (EN/HI) · recording.ts · types.ts
      components/        AppShell · BandCard · DeviationChart · LanguageToggle · ui/
      routes/            Login · Register · CaregiverHome · PatientHome · Checkin · Dashboard
        checkin/         StepAudio · StepVideo · StepReaction
    vercel.json · tailwind.config.js · .env.example
  infra/                 render.yaml · deployment .env.example
  docs/
    PRD.md               product requirements
    TRD.md               technical requirements
    DEVELOPMENT.md       this file
    DEMO_SCRIPT.md       3-minute live pitch script
    BUILD_PLAN.md        the phased plan this was built from
  legacy/v1/             the original Streamlit prototype, superseded
  README.md              project landing page
```

---

## How the intelligence works

1. **Feature extraction** (per modality, server-side, CPU only)
   - *voice* — `librosa` + Praat: MFCC 1–13 mean/std, jitter, shimmer, HNR, pause ratio,
     pauses/sec, articulation rate, F0 mean/std/CV, spectral centroid.
   - *face* — MediaPipe FaceMesh (468 landmarks): mouth symmetry, corner drop, eye aspect
     ratio L/R, eye & brow asymmetry, landmark tremor, blink rate.
   - *reaction* — from the browser tap game: median RT, IQR, coefficient of variation,
     lapse rate, attention-decay slope, fatigue delta, miss rate.
2. **Baseline** — the first **4** valid days per modality are averaged into a personal
   mean/std, then **frozen** (Tier 1; rolling update is Tier 2). Standard deviation is
   floored so a flat feature cannot explode a z-score.
3. **Deviation** — `d_m = mean(|z|)` over that modality's scoring features, each `|z|`
   clipped at 6 so one broken feature cannot dominate.
4. **Stability score** — `S = 100 / (1 + e^(-1.6·(d̄ - 2.0)))` where `d̄` is the
   quality-weighted mean deviation. Modalities whose capture failed are dropped and the
   remaining weights renormalised, so a dead webcam does not look like a perfect day.
   Bands: **STABLE** 0–39 · **WATCH** 40–69 · **ALERT** 70–100.
5. **Alert gate** — the part that kills false alarms. `ALERT` requires **≥2 modalities**
   with `d_m > 2.0` on **every one of the last 3 days**. A high score without that
   cross-validation is capped at **WATCH**.
6. **Explanation** — the top-3 z-scores, filtered to the clinically meaningful direction,
   rendered as sentences in English and Hindi (`"pauses while speaking are longer than
   usual"`, `"the smile is less even on both sides"`).

Tuning knobs live in `app/ml/scoring.py`: `DEV_THRESHOLD`, `SUSTAIN_DAYS`,
`MIN_MODALITIES`, and the sigmoid slope (1.6) / centre (2.0).

---

## Run it

Requires **Python 3.11** (mediapipe 0.10.14 publishes no 3.12/3.13 wheels) and
**PostgreSQL 15**.

### 1. Create the database

```powershell
# Local Postgres
psql -U postgres -c "CREATE USER neurotrace WITH PASSWORD 'neurotrace';"
psql -U postgres -c "CREATE DATABASE neurotrace OWNER neurotrace;"
```

Or with Docker instead of a local install:

```powershell
docker run -d --name neurotrace-db -p 5432:5432 `
  -e POSTGRES_USER=neurotrace -e POSTGRES_PASSWORD=neurotrace -e POSTGRES_DB=neurotrace `
  postgres:15
```

### 2. Install

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

macOS / Linux: `python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

> **Slow or flaky link?** `pip install -r requirements.lock.txt` installs the exact
> transitive set the test suite was verified against and skips ~200 MB of jax / jaxlib /
> opencv-contrib-python. MediaPipe declares those three but FaceMesh never imports them
> (`cv2` comes from the pinned `opencv-python`). Both files pass all 88 tests.

> If `praat-parselmouth` refuses to build, delete that line and reinstall. `speech.py`
> detects the missing import and returns `0.0` for jitter / shimmer / HNR — everything else
> keeps working. (It installed cleanly here, so jitter/shimmer/HNR are real.)

### 3. Configure

```powershell
copy .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(64))"   # paste into JWT_SECRET
```

### 4. Migrate

```powershell
alembic upgrade head
```

Useful: `alembic current` · `alembic history` · `alembic downgrade base`.

### 5. Start the server

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API docs: http://localhost:8000/docs
- Health:   http://localhost:8000/health

### 6. Run the tests

```powershell
pytest
```

```
105 passed
```

The suite runs on SQLite, so it needs **no** Postgres server. To run the identical suite
against Postgres:

```powershell
$env:TEST_DATABASE_URL = "postgresql+asyncpg://neurotrace:neurotrace@localhost:5432/neurotrace_test"
pytest
```

### Docker

```powershell
cd backend
docker build -t neurotrace-api .
docker run --rm -p 8000:8000 --env-file .env neurotrace-api
```

The container runs `alembic upgrade head` before starting uvicorn.

---

## Run the frontend

```powershell
cd frontend
npm install
copy .env.example .env.development     # VITE_API_URL=http://localhost:8000
npm run dev                            # http://localhost:5173
```

`npm run build` type-checks and produces `dist/`. The dev server binds `0.0.0.0`, so a phone
on the same network can reach it — but **mic and camera need HTTPS**, so real capture on a
phone must go through the deployed URL, not a LAN IP.

Routes: `/login` `/register` `/` (caregiver or patient home) `/checkin/:pid` `/dashboard/:pid`

---

## Load the demo

Either press **Open the demo** on the login screen, or from the backend:

```powershell
cd backend
python -m app.seed
```

Creates `demo@neurotrace.app` / `neurotrace-demo` and a patient "Ramesh, 67" with ten days
of history — 4 baseline, 3 stable, 3 declining — ending in an ALERT. Re-running replaces
the demo patient, so the story always starts clean. See [DEMO_SCRIPT.md](DEMO_SCRIPT.md)
for the 3-minute pitch walkthrough.

---

## API

Send the access token as `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/register` | — | Create an account (`patient` \| `caregiver` \| `clinician`) → user + tokens |
| `POST` | `/auth/login` | — | Email + password → tokens |
| `POST` | `/auth/refresh` | — | Refresh token → new token pair |
| `GET`  | `/auth/me` | any | Current user |
| `GET`  | `/auth/clinician-check` | caregiver / clinician | Role-guard probe |
| `GET`  | `/auth/config` | — | Token lifetimes and available roles |
| `POST` | `/patients` | caregiver | Create a patient record |
| `GET`  | `/patients` | any | Patients you can see (scoped by role) |
| `GET`  | `/patients/{id}` | owner / linked patient / clinician | One patient |
| `PATCH`| `/patients/{id}` | owning caregiver | Update |
| `DELETE`| `/patients/{id}` | owning caregiver | Delete, cascading to all history |
| `POST` | `/checkin/{pid}/audio` | patient access | multipart WAV → voice features |
| `POST` | `/checkin/{pid}/video` | patient access | multipart WebM → face features |
| `POST` | `/checkin/{pid}/reaction` | patient access | JSON tap data → reaction features |
| `POST` | `/checkin/{pid}/finalize` | patient access | Score the open sample → band + explanation |
| `GET`  | `/checkin/{pid}/current` | patient access | Resume an interrupted check-in |
| `GET`  | `/dashboard/{pid}?days=30` | patient access | Status, trends, history, alerts |
| `POST` | `/demo/seed` | — (gated by `DEMO_MODE`) | Build the demo dataset |
| `GET`  | `/health` | — | Liveness + database reachability |

"patient access" = the owning caregiver, the linked patient account, or any clinician.

```bash
curl -X POST localhost:8000/auth/register -H 'content-type: application/json' \
  -d '{"email":"asha@example.com","password":"correct-horse-battery","role":"caregiver"}'

curl localhost:8000/auth/me -H "Authorization: Bearer $ACCESS_TOKEN"

curl -X POST localhost:8000/checkin/$PID/audio -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@day1.wav;type=audio/wav"
```

Interactive docs at `/docs`.

---

## Tests

| File | Tests | Covers |
|---|---|---|
| `tests/test_auth.py` | 24 | register, duplicate email, login, wrong password, protected route, refresh-token misuse, refresh flow, role guards, bcrypt, JWT type enforcement |
| `tests/test_scoring.py` | 37 | baseline build + std floor, z-scores, deviation clipping, quality weights, sigmoid score, band boundaries, every branch of the alert gate, explainer direction filtering |
| `tests/test_alert_gate_sim.py` | 10 | `ml/test_sim.py` ported to assertions: no alert across the stable days, WATCH on decline days 1–2, **ALERT on the third sustained decline day**, bilingual explanation |
| `tests/test_checkin_pipeline.py` | 14 | the same ten days through `compute_checkin()` and a real database — baseline rows, frozen baseline, score rows, the single alert row, idempotent recompute, failed-capture handling |
| `tests/test_api_checkin.py` | 13 | the whole thing over HTTP with **real media** — generated WAVs through librosa + Praat, generated WebM through MediaPipe, ten days ending in ALERT; plus access control, upload limits, corrupt-file handling, raw-media deletion |
| `tests/test_demo_seed.py` | 4 | the demo dataset produces STABLE → WATCH → ALERT, lands on consecutive days, and reseeds idempotently |
| `tests/test_migration.py` | 3 | `alembic upgrade head` produces exactly the models' schema, and downgrades cleanly |

`tests/fixtures_media.py` generates the real media: voiced audio with controllable jitter,
shimmer, breath noise and pause structure, and a drawn face MediaPipe reliably detects whose
mouth corner sags as the drift dial rises. Nothing in the API test is stubbed — the only
thing the fixtures control is how degraded the input is.

Observed ten-day run through `compute_checkin()` (seed=42):

```
Day  1-4  baseline   dev 0.00/0.00/0.00   score   3.9   STABLE   (building personal baseline)
Day  5    stable     dev 1.40/1.07/1.84   score  28.8   STABLE
Day  6    stable     dev 1.18/1.24/0.91   score  19.4   STABLE
Day  7    stable     dev 1.20/1.61/0.91   score  22.9   STABLE
Day  8    decline    dev 6.00/5.41/6.00   score  99.8   WATCH    (unsustained -> capped)
Day  9    decline    dev 6.00/5.52/6.00   score  99.8   WATCH    (unsustained -> capped)
Day 10    decline    dev 6.00/5.62/6.00   score  99.8   ALERT    (3 signals deviating 3+ days)
```

Day 10, English: *"Please check on them today: more attention lapses during the test, pitch
is more variable than usual and the eyes are opening unevenly. These changes have continued
for several days across more than one signal."*

---

## Decisions taken where the spec was ambiguous

- **The repo root is the v2 app** (`backend/`, `frontend/`, `infra/`), matching TRD §2. The v1 Streamlit prototype was moved to `legacy/v1/`.
- **Primary keys are UUIDs** (`sa.Uuid`), which maps to native `UUID` on Postgres and
  `CHAR(32)` on SQLite, so tests need no database server.
- **JSON columns use `sa.JSON`**, not `JSONB` — nothing queries inside these documents in
  Tier 1, and it keeps the schema dialect-neutral.
- **Enums are `VARCHAR` + `CHECK`** rather than native Postgres enum types, so migrations
  stay reversible and portable.
- **JWT via `PyJWT`** rather than `python-jose` — smaller, actively maintained, same HS256.
- **Login takes JSON**, not an OAuth2 form body — the React client posts JSON everywhere else.
- **`scores` carries four extra columns** beyond TRD §3 (`explanation_en`, `explanation_hi`,
  `reason`, `modalities_flagged`, plus `z_scores_json` and `baseline_day`). The TRD §6
  `finalize` and `dashboard` contracts both return an explanation; storing it avoids
  recomputing on every dashboard read. `alerts` likewise gains `explanation_hi`.
- **`patients.user_id`** was added so a patient can hold their own login (PRD G1) while the
  caregiver still owns the record.
- **A baseline day is not scored.** While a modality has fewer than 4 prior valid days,
  today feeds the baseline and its deviation is recorded as `0.0` — the patient has no
  personal normal to be measured against yet.
- **`compute_checkin` is idempotent**: recomputing a sample replaces its score and alert rows.
- **Test deps ship in `requirements.txt`** rather than a separate dev file — one install,
  one pinned set.
- **`app/ml/train/`** exists per TRD §2 but is empty by design: Tier 1 scoring is
  unsupervised, so there is no model to train. The optional classifier is TRD §5, Tier 1+.
- **`ml/__init__.py` does not import `speech`/`face`** — those pull in librosa and MediaPipe.
  `compute_checkin` imports them lazily per modality, so a missing capture-time dependency
  degrades one modality instead of taking down the API.
- **The browser encodes WAV in JavaScript**, rather than shipping MediaRecorder's
  `webm/opus`. libsndfile reads WAV directly; decoding Opus would need an `ffmpeg` binary on
  the server, which is one more thing to break on a deploy. Video *does* use MediaRecorder
  (`webm/vp8`) — OpenCV's bundled FFmpeg decodes that, which I verified before relying on it.
- **One open sample at a time.** A check-in stays `processing` until `finalize` closes it, so
  the three capture steps can arrive in any order or be retried. Tier 1 assumes one check-in
  per day; a second one the same day is treated as a separate day.
- **Every capture step is skippable.** A dead webcam must not block the voice and tap data —
  `quality_weights` renormalises around whichever modalities actually captured, so a failed
  step is dropped rather than scored as a perfect day.
- **`/demo/seed` is unauthenticated but gated by `DEMO_MODE`.** The demo button has to work
  before anyone has an account; set `DEMO_MODE=false` on any deployment holding real data.
- **SQLite gets `PRAGMA foreign_keys=ON`.** Without it SQLite ignores `ON DELETE CASCADE`,
  and the test database would behave more laxly than production. This was not theoretical —
  it let orphaned score rows survive a patient delete until it was caught.
- **A patient-role account cannot create patients.** The caregiver owns the record and links
  the patient's login to it (PRD §5 onboarding); a patient signing up alone sees an empty home
  until a caregiver links them.
- **No `/patients/{id}/baseline/reset` endpoint.** It is not in the TRD, and it would fight
  the frozen-baseline design — `compute_checkin` rebuilds from the first N valid days, so
  clearing the row would silently rebuild the same baseline. Proper support needs a
  `baseline_reset_at` column; that is Tier 2 alongside rolling baselines.

---

## Deploy

### Backend → Render

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → select the repo → it picks up [infra/render.yaml](infra/render.yaml).
   That provisions `neurotrace-api` (Docker) plus a Postgres 15 instance, wires `DATABASE_URL`
   from the database, and generates `JWT_SECRET`.
3. First deploy will fail its health check until `FRONTEND_ORIGIN` is set — that is expected,
   you fill it in at step 6.
4. The container runs `alembic upgrade head` on boot, so the schema converges by itself.
5. Confirm `https://neurotrace-api.onrender.com/health` returns `{"status":"ok","database":"up"}`.

### Frontend → Vercel

6. Vercel → **New Project** → same repo → **Root Directory** `frontend`.
   [vercel.json](frontend/vercel.json) supplies the build, the SPA rewrite, and a
   `Permissions-Policy` that allows camera and microphone on the app's own origin.
7. Set `VITE_API_URL` to the Render URL. Deploy.
8. Back on Render, set `FRONTEND_ORIGIN` to the Vercel URL (comma-separated if you also want
   preview deploys) and redeploy. CORS is locked to exactly this list.

### Verify

9. Open the Vercel URL → **Open the demo** → you should land on Ramesh's dashboard in ALERT.
10. Start a check-in on a **phone** using the Vercel URL — mic and camera need HTTPS, which
    Vercel gives you free. Confirm all three steps upload and you reach "All done ✓".
11. Set `DEMO_MODE=false` if the deployment will hold anything real.

---

## Privacy & security notes (TRD §7)

- Raw audio/video is deleted after feature extraction when `DELETE_RAW_MEDIA=true`; only
  numeric feature vectors persist.
- No PII in logs — the WhatsApp mock logs a patient UUID and a message length, never a name
  or a phone number.
- Secrets come from `.env` only. `JWT_SECRET` has an obviously-invalid default so a
  misconfigured deploy is noticed immediately.
- CORS is locked to `FRONTEND_ORIGIN` (comma-separated for multiple origins).
- `seed=42` is applied at application start and in every test.
