# NeuroTrace — build, run, test, deploy

Companion to [PRD.md](PRD.md) and [TRD.md](TRD.md). For what the product is and why it is
shaped this way, start at the [project README](../README.md).

---

## Requirements

| | Version | Why pinned |
|---|---|---|
| Python | **3.11** | MediaPipe 0.10.14 publishes no 3.12/3.13 wheels |
| Node | 18+ | Vite 8, `import.meta.dirname` |
| PostgreSQL | 15 | production only — the test suite runs on SQLite |

---

## Backend

```bash
cd backend
py -3.11 -m venv .venv
.venv/Scripts/activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.lock.txt
```

`requirements.lock.txt` is the exact verified set. `requirements.txt` pins the direct
dependencies and additionally pulls jax/jaxlib/opencv-contrib (~200 MB) that MediaPipe
declares but FaceMesh never imports. Both pass the suite.

> If `praat-parselmouth` will not build, drop that line. `app/ml/speech.py` detects the
> missing import and returns 0.0 for jitter/shimmer/HNR rather than failing.

```bash
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(64))"   # -> JWT_SECRET
alembic upgrade head
uvicorn app.main:app --reload      # http://localhost:8000/docs
```

### Database

```bash
docker run -d --name neurotrace-db -p 5432:5432 \
  -e POSTGRES_USER=neurotrace -e POSTGRES_PASSWORD=neurotrace -e POSTGRES_DB=neurotrace \
  postgres:15
```

Migration `0001` created the original schema; `0002` replaces it with the v2 exam model
(sessions, module results, deviations, questionnaires, vitals, adherence, safety events,
audit log). `alembic downgrade base` works in both directions and is covered by a test.

---

## Frontend

```bash
cd frontend
npm install
npm run fetch:mediapipe            # the on-device face model, ~4 MB, gitignored
cp .env.example .env.development
npm run dev                        # http://localhost:5173
```

`npm run fetch:mediapipe` is not optional. The FaceMesh runtime and model are served from
our own origin so the exam works offline; without them the face module cannot load.

**Camera and microphone need HTTPS.** `localhost` is exempt; a LAN IP is not. Test mobile
capture through the deployed URL.

---

## Tests

```bash
cd backend  && pytest        # engine, modules, safety, SLM, pipeline, API, migration
cd frontend && npm test      # JS <-> Python parity
```

| Suite | Covers |
|---|---|
| `test_engine.py` | median/MAD robustness, practice-session discard, quality rejection, lock condition, robust z, RCI, CUSUM accumulation and decay, both gates, IMPROVING, every confounder |
| `test_exam_modules.py` | each of M1–M20 on a fixture; the forehead-sparing discriminator; that the asymmetry ratio separates unilateral from bilateral slowing; the Daily Pulse capture budget |
| `test_safety_slm.py` | FAST in three languages, acute bypass, forbidden-language sweep over the shipped source, band-match assertion, no-numbers-to-the-model assertion, guardrail fallback |
| `test_session_pipeline.py` | the 21-day simulation; single-domain never alerts; two domains do; improvement never alerts; quality and identity annotation; a rogue model cannot change the band |
| `test_api.py` | every endpoint, the enrolment gate, access control, FAST on every finalize, the acute bypass over HTTP |
| `test_train.py` | the metrics contract (refuses to write without limitations), grouped CV, and the asymmetry claim as a regression test |
| `test_migration.py` | `alembic upgrade head` produces exactly the models' schema, and downgrades cleanly |
| `parity.test.ts` | the on-device extractors match Python feature-for-feature to 1e-9 relative |

### Regenerating the parity fixture

After changing either the TypeScript or the Python extractors:

```bash
cd backend  && python -m tools.gen_parity_fixture
cd ../frontend && npm test
```

---

## Demo data

```bash
cd backend && python -m app.seed
```

Creates `demo@neurotrace.app` / `neurotrace-demo`, a clinician account, and Ramesh — 67,
left MCA infarct, five months post-discharge, Punjabi speaker — with 21 days producing
STABLE → WATCH → ALERT and exactly one alert row. Also exposed as `POST /demo/seed`, gated
by `DEMO_MODE`.

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for the pitch walkthrough.

---

## Training the optional classifiers

None of these makes a decision. Each produces a per-modality likelihood that enters the
deterministic engine as one additional *feature*.

```bash
cd backend
python -m app.ml.train.asymmetry_discriminator                        # needs no data
python -m app.ml.train.voice_dysarthria_clf --data data/torgo --controls data/librispeech
python -m app.ml.train.rhythm_irregularity_clf --data data/physionet_af
```

Place downloaded corpora under `backend/data/`. Access notes are in [DATASETS.md](DATASETS.md);
TORGO needs registration and mPower needs a Synapse account.

Each run writes `app/ml/train/artifacts/<model>.metrics.json` with ROC-AUC, sensitivity,
specificity, confusion matrix, split method and a limitations note. `Metrics.save` refuses
to write a file without limitations — an unqualified number is the thing this project exists
not to produce.

---

## API

Send the access token as `Authorization: Bearer <token>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/{register,login,refresh}` | — | JWT access + refresh |
| `GET` | `/auth/me` | any | Current user |
| `POST` | `/patients` | caregiver | Enrol — **rejects < 3 months post-stroke** |
| `GET` | `/patients`, `/patients/{id}` | scoped by role | Patient records |
| `GET` | `/sessions/battery/{schedule}` | — | Modules, tasks, spoken instructions |
| `POST` | `/sessions/{pid}/start` | patient access | Open a session |
| `POST` | `/sessions/{sid}/module/{code}` | patient access | **Features only** — no media route exists |
| `POST` | `/sessions/{sid}/finalize` | patient access | Score → band, drivers, confounders, explanation, **FAST** |
| `GET` | `/sessions/{pid}/current` | patient access | Resume an interrupted session |
| `POST` | `/questionnaire/{pid}` | patient access | PHQ-2/9, FSS, Barthel, EAT-10 |
| `POST` | `/vitals/{pid}`, `/adherence/{pid}` | patient access | BP, rhythm, medication |
| `GET` | `/safety/fast`, `/safety/symptoms` | **none** | Emergency guidance must never 401 |
| `POST` | `/safety/acute/{pid}` | patient access | **Bypasses scoring entirely** |
| `GET` | `/dashboard/{pid}` | patient access | Band, trends, history, alerts, FAST |
| `GET` | `/clinic/patients` | clinician | Ranked by sustained deviation |
| `POST` | `/clinic/alerts/{id}/acknowledge` | clinician | |
| `GET` | `/report/{pid}` | non-patient | Structured exam report + method note |
| `GET` | `/audit/{pid}` | non-patient | Access trail |
| `POST` | `/demo/seed` | — (gated) | Build the demo dataset |
| `GET` | `/health` | — | Liveness + database |

"patient access" = the owning caregiver, the linked patient account, or any clinician.
Interactive docs at `/docs`.

---

## Deploy

Backend on Railway, database on Neon, frontend on Vercel — the whole procedure, with
the failure modes each step actually hit, is in [DEPLOY.md](DEPLOY.md).

---

## Decisions taken where the specs were ambiguous

- **The baseline length is derived, not written down.** A module locks at 12 *retained*
  sessions after discarding 3 for practice effect, so scoring cannot begin until 15 daily
  sessions exist. The build plan says "14 baseline days", which would leave the first
  "stable" days still baselining and the demo silently showing no verdict where the script
  promises one. `DEMO_PLAN` computes it from the engine constants so the two cannot drift.
- **Questionnaires and adherence do not drive the alert gate.** You do not z-score a PHQ-2 —
  it ships with published cut-offs from large validation cohorts, and comparing a 0–6 integer
  to a personal median throws that away. Separately, a module with one or two features has no
  internal averaging, so its mean|z| *is* a single z-score and crosses threshold by chance
  roughly one session in twenty. A domain that flags at random is not corroboration, so
  `MIN_FEATURES_TO_GATE = 3` and `gates_alerts=False` on M13–M16, M19, M20. They are still
  captured, trended and shown; mood additionally feeds the confounder layer, which is where a
  PHQ shift belongs — explaining other domains rather than competing with them.
- **The band persists but the notification does not.** Once two domains are sustained the band
  correctly stays ALERT — the patient has not improved because we already said so. But a fresh
  alert every day of a continuing episode is how a product trains a family to ignore it. One
  alert per episode, until the band returns to WATCH/STABLE and later rises again.
- **MFCCs and Praat jitter/shimmer are not computed on-device.** A JS reimplementation would
  drift from librosa and parselmouth in the third decimal, and a feature that differs between
  device and server is worse than one that is absent — it corrupts the baseline silently. The
  on-device set is limited to features where both implementations agree within the parity
  tolerance.
- **HRV magnitudes carry no "worse" direction.** Low SDNN indicates cardiac risk, but a high
  RMSSD in this setting indicates the irregularity we are screening for. Assigning either a
  direction would encode a claim we cannot defend, so the directional signal in M17 comes from
  `rr_irregularity_index` alone.
- **`patients.language` became `languages` (ordered JSON).** Patients in this population are
  commonly multilingual, and the order matters for which language the app speaks first.
- **SQLite gets `PRAGMA foreign_keys=ON`.** Without it SQLite ignores `ON DELETE CASCADE` and
  the test database behaves more laxly than production. Not theoretical — it let orphaned
  score rows survive a patient delete until it was caught.
- **`copy_from` in migration 0002's downgrade.** SQLite batch mode rebuilds a table from its
  reflected definition, and reflection does not reliably recover the enum CHECK constraint
  names, leaving the rebuilt table referencing a column the downgrade just dropped.
- **Test dependencies ship in `requirements.txt`** rather than a separate dev file — one
  install, one pinned set.
