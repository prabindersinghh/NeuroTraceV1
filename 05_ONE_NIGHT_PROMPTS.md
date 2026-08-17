# NeuroTrace — ONE-NIGHT BUILD (condensed prompts, Opus 4.8 Max)

Setup: new empty folder `neurotrace-v2`. Attach 01_PRD.md, 02_TRD.md, and the
NeuroTrace_Reference_ML.zip (unzipped) to the session. Six prompts, not ten.
Run each, confirm it starts, move on. Target: working deployed app by morning.

═══════════════════════════════════════════════════
## SESSION RULES — paste this first, once
═══════════════════════════════════════════════════
You are building NeuroTrace end-to-end tonight. Read the attached PRD + TRD and the reference ML
modules in ml/. Rules for this whole session:
- Tier 1 scope only. Working > perfect. No TODOs, no placeholder logic, no mocked ML.
- The reference modules in ml/ are TESTED and CORRECT — port them, don't reinvent them.
- After each phase: print the exact commands to run + test, then STOP so I can verify.
- Pin all deps. Secrets in .env. seed=42 everywhere.
- If something is ambiguous, pick the simplest option that works and tell me what you chose.

═══════════════════════════════════════════════════
## P1 — Backend: scaffold + DB + auth + ML port  (~90 min)
═══════════════════════════════════════════════════
Build the entire backend in one pass:
1. Structure per TRD §2. FastAPI + async SQLAlchemy + Alembic + Postgres.
2. All tables from TRD §3 as models + Pydantic schemas + initial migration.
3. Auth: register/login/refresh, JWT access+refresh, bcrypt, roles (patient|caregiver|clinician),
   current_user dependency + role guards.
4. Port the attached ml/ reference modules into backend/app/ml/ UNCHANGED in logic
   (speech, face, reaction, baseline, scoring, explain). Add a compute_checkin() service that chains:
   features -> baseline (build if <4 days, else z-scores) -> deviations -> stability score ->
   alert_decision over last 3 days -> explanation -> persist score + alert row.
5. pytest: auth flow, scoring math, and the alert gate (port ml/test_sim.py into a real test that
   asserts no alert on stable days and ALERT by the 3rd sustained decline day).
6. requirements.txt pinned, Dockerfile, .env.example, README run instructions.
Give me the commands to migrate, run, and test. STOP.

═══════════════════════════════════════════════════
## P2 — Backend: API routers + check-in pipeline  (~45 min)
═══════════════════════════════════════════════════
Add all routers per TRD §6:
- /patients (caregiver CRUD)
- /checkin/{pid}/audio, /video, /reaction  (multipart + json, 25MB limit, temp storage,
  extract features immediately, delete raw media if DELETE_RAW_MEDIA=true)
- /checkin/{pid}/finalize -> runs compute_checkin, returns {score, band, explanation_en, explanation_hi}
- /dashboard/{pid} -> latest band, per-modality deviation time series, history, alerts
- services/whatsapp.py: mock sender that logs + sets whatsapp_sent=true
Integration test: caregiver + patient, 4 baseline check-ins from fixtures, then 3 decline check-ins,
assert ALERT with a non-empty explanation. Update README with the full API. STOP.

═══════════════════════════════════════════════════
## P3 — Frontend: scaffold + patient check-in  (~90 min)
═══════════════════════════════════════════════════
React 18 + Vite + TS + Tailwind + shadcn/ui. API client with JWT + refresh interceptor.
Routes: /login /register /caregiver /checkin/:pid /dashboard/:pid
Patient check-in (mobile-first, huge touch targets, minimal words, EN/HI toggle):
 step 1: record 10s audio via MediaRecorder (show a sentence to read aloud)
 step 2: record 10s webcam video (show a "smile, then blink twice" instruction)
 step 3: reaction mini-game — 12 trials, random 1-3s delay, log stimulus->tap latency, misses, false starts
 step 4: POST all three -> finalize -> calm "All done ✓" screen. NEVER show risk/score to the patient.
Handle permission denial and unsupported-browser gracefully. STOP.

═══════════════════════════════════════════════════
## P4 — Frontend: caregiver dashboard  (~60 min)
═══════════════════════════════════════════════════
Dashboard: big status card (STABLE green / WATCH amber / ALERT red), today's plain-language
explanation (EN/HI toggle), and 3 Recharts line charts (voice/face/reaction deviation over time)
with the baseline normal band shaded and the alert threshold as a dashed line.
Below: history table + alert log. Clinician read-only view reuses the components.
Loading/empty/error states everywhere. Aesthetic: clean clinical, navy + blue, high contrast. STOP.

═══════════════════════════════════════════════════
## P5 — Seed + demo mode  (~30 min)
═══════════════════════════════════════════════════
Seed script creating demo caregiver + patient "Ramesh, 67" with a 10-day history:
4 baseline days, 3 stable days, 3 decline days (voice pauses up, smile asymmetry up, RT variability up)
so the dashboard shows a clean STABLE -> WATCH -> ALERT progression.
Add a DEMO MODE button that loads it instantly. Write DEMO_SCRIPT.md: exactly what to click,
in what order, for a 3-minute live pitch demo. STOP.

═══════════════════════════════════════════════════
## P6 — Deploy  (~45 min)
═══════════════════════════════════════════════════
Dockerize backend, render.yaml (web service + postgres), Vercel config for frontend,
CORS locked to the Vercel origin, env wiring, health check endpoint.
Give me a numbered deploy checklist and the final public URLs. Verify the seeded demo works
on the deployed URL end-to-end.

═══════════════════════════════════════════════════
## If you get stuck at 3am
═══════════════════════════════════════════════════
- MediaPipe install failing -> pin mediapipe==0.10.14, python 3.11 (not 3.12).
- parselmouth failing -> pip install praat-parselmouth; if it won't build, the speech module already
  falls back gracefully (jitter/shimmer/HNR return 0) — ship it and fix later.
- Browser won't give mic/camera on deployed site -> must be HTTPS. Vercel gives this free.
- Score always 99 or always 0 -> tune DEV_THRESHOLD + sigmoid slope/centre in scoring.py (see README).
- Running out of time -> cut P6, demo from localhost. A working local demo beats a broken deployed one.
