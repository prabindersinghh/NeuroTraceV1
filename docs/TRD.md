# NeuroTrace — Technical Requirements Document (TRD)
**Version:** 1.0 · Companion to PRD v1.0

## 1. Architecture (Tier 1)
Browser (React) ── HTTPS ──> FastAPI backend ──> ML services (in-process) ──> PostgreSQL
                                             └──> file storage (audio/video temp) 
- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Recharts.
- Backend: FastAPI (Python 3.11), Pydantic v2, SQLAlchemy 2.x async, Uvicorn.
- DB: PostgreSQL 15 (Supabase or Render Postgres). Redis optional (rate limit/cache) — skip if tight.
- Auth: JWT (access + refresh), passlib/bcrypt.
- Deploy: backend on Render/Railway; frontend on Vercel; DB on Supabase.

## 2. Repo Structure
neurotrace/
  backend/
    app/
      main.py                # FastAPI app + routers
      config.py              # settings (env)
      db.py                  # async engine/session
      models.py              # SQLAlchemy tables
      schemas.py             # Pydantic models
      auth/                  # jwt, password, deps
      routers/               # auth, patients, checkin, dashboard
      ml/
        speech.py            # feature extraction (librosa/parselmouth)
        face.py              # mediapipe landmarks -> features
        reaction.py          # reaction stats
        baseline.py          # per-patient baseline build/update
        scoring.py           # z-score fusion -> stability score
        explain.py           # SHAP / contribution -> text
        train/               # offline training scripts (Tier 1 classical)
      services/whatsapp.py   # mock sender (logs) — real later
    tests/
    requirements.txt
    Dockerfile
  frontend/
    src/ (routes, components, api client, charts)
    package.json
  infra/ (render.yaml, vercel.json, .env.example)
  README.md

## 3. Data Model (Postgres)
- users(id, email, pw_hash, role[patient|caregiver|clinician], created_at)
- patients(id, caregiver_id->users, name, age, sex, language, baseline_ready bool, created_at)
- daily_samples(id, patient_id, ts, audio_path, video_path, reaction_json, status[done|processing])
- feature_vectors(id, sample_id, modality[voice|face|reaction], features_json)
- baselines(id, patient_id, modality, mean_json, std_json, n_days, updated_at)
- scores(id, patient_id, sample_id, voice_dev, face_dev, reaction_dev, stability_score, band, created_at)
- alerts(id, patient_id, score_id, band, explanation, whatsapp_sent bool, created_at)

## 4. ML — Tier 1 (real features, classical models, pretrained backbones)
### Voice (speech.py)
- Libraries: librosa, parselmouth (Praat), numpy.
- Features: MFCC(13) mean/std, jitter, shimmer, HNR, pause ratio, speaking rate, F0 mean/std.
- Optional embedding: SpeechBrain ECAPA-TDNN speaker embedding (pretrained) for voice-quality drift.
### Face (face.py)
- Library: MediaPipe FaceMesh (468 landmarks) — pretrained, runs in-process.
- Features: mouth symmetry index, eye-aspect-ratio L/R, blink rate, brow asymmetry,
  smile symmetry (compare left/right displacement), landmark jitter/tremor variance.
### Reaction (reaction.py)
- From JS game: array of stimulus->tap latencies (ms), misses, variance.
- Features: median RT, IQR, coefficient of variation, lapse rate, attention-decay slope.
### Baseline (baseline.py)
- First N (3–5) valid days: per-feature mean & std per modality, stored in baselines.
- Update rule: freeze baseline after N days (Tier 1); rolling update = Tier 2.
### Scoring (scoring.py)
- Per modality deviation d_m = mean(|z|) over that modality's features, z = (x-mean)/std.
- Stability score S = 100 * sigmoid_scaled( w_v*d_v + w_f*d_f + w_r*d_r ), weights default equal.
- Bands: Stable 0–39, Watch 40–69, Alert 70–100.
- ALERT gate: band=Alert requires >=2 modalities with d_m above 2.0 sustained >=3 days
  (use last-3-day rolling to avoid single-day noise).
### Explainability (explain.py)
- Tier 1: feature-contribution = ranked z-scores; map top-3 to plain sentences
  ("speech pauses longer than usual", "left-side smile weaker than baseline").
- Optional: SHAP KernelExplainer over the scoring function if a classifier is added.

## 5. Optional Tier 1+ classifier (nice-to-have)
- Train a small classifier (XGBoost/LogReg) on public datasets to output a "dysarthria/decline
  likelihood" per modality, as an extra feature into scoring. See datasets doc.

## 6. API (FastAPI)
- POST /auth/register, /auth/login, /auth/refresh
- POST /patients  (caregiver creates)   GET /patients/:id
- POST /checkin/:patientId/audio   (multipart)   -> features
- POST /checkin/:patientId/video   (multipart)   -> features
- POST /checkin/:patientId/reaction (json)        -> features
- POST /checkin/:patientId/finalize -> builds/updates baseline, computes score, returns band+explanation
- GET  /dashboard/:patientId -> latest band, trends (per modality series), history, alerts

## 7. Non-Functional
- Latency: finalize < 5s server-side on CPU.
- Privacy: store features, delete raw audio/video after extraction (configurable). No PII in logs.
- Security: JWT, HTTPS, CORS locked to frontend origin, rate-limit auth.
- Reproducibility: seed=42; pinned requirements; Dockerfile.

## 8. Deployment
- Dockerfile for backend; render.yaml (web + postgres).
- Frontend env: VITE_API_URL. Vercel deploy.
- .env.example: DATABASE_URL, JWT_SECRET, FRONTEND_ORIGIN, DELETE_RAW_MEDIA=true.

## 9. Test Plan
- Unit: feature extractors on 1 sample file each; scoring math; alert gate logic.
- Integration: full check-in flow with a fixture patient.
- Simulation: seed a stable week (no alert) + a decline week (alert by day 6–8).
