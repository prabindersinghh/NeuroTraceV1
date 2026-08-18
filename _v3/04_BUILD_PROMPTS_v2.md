# NEUROTRACE v2 — CLAUDE CODE BUILD PROMPTS

## FILES TO ATTACH TO THE SESSION
  00_CONTEXT_BRIEF.md   ← why we're building this and what wins
  01_PRD_v2.md          ← product spec
  02_TRD_v2.md          ← technical spec (module definitions live here)
  03_DATASETS_v2.md     ← data + model strategy
  reference/ml/*.py     ← tested feature-extraction + scoring code to port and extend
Do NOT attach: the old Streamlit app, v1 PRD/TRD, or the research reports.

## SETUP
  cd D:\ ; mkdir neurotrace-v2 ; cd neurotrace-v2
  Expand-Archive <reference zip> -DestinationPath .\reference
  copy the four .md files here
  (fix or delete C:\Users\<you>\.claude\settings.json — it is malformed)
Open Claude Code IN neurotrace-v2.

════════════════════════════════════════════════
## P0 — SESSION RULES (paste once)
════════════════════════════════════════════════
Read 00_CONTEXT_BRIEF.md, 01_PRD_v2.md, 02_TRD_v2.md, 03_DATASETS_v2.md and
reference/ml/*.py in full before writing any code.

Rules for this entire session, no exceptions:
1. ON-DEVICE FIRST. Feature extraction runs in the browser/phone. Raw audio, video and
   frames NEVER leave the device — only derived features and scores sync.
2. SCREENING NOT DIAGNOSIS. The word "stroke" must never appear in a user-facing output.
   No output may assert wellness ("you are fine", "all clear", "normal"). Add a test that
   greps the built bundle for these strings and fails if found.
3. THE SLM WRITES TEXT ONLY. It never computes a score, threshold or alert. Enforce with
   a test asserting the rendered band always equals the deterministic engine's band.
4. SAFETY LAYER IS UNCONDITIONAL. FAST card at the end of every session and on every
   dashboard; one-tap emergency always reachable; acute-symptom report bypasses all logic.
5. DETERMINISTIC CLINICAL LOGIC. seed=42, reproducible, auditable. No ML in the decision path.
6. Every phase must end in something demonstrable on a phone. Print run + test commands
   and STOP for me to verify before continuing.
7. No placeholders, no TODOs, no mocked ML. Pin all dependencies. Secrets in .env.

Confirm you have read all four documents, then give me the folder structure and the
phase plan. No code yet.

════════════════════════════════════════════════
## P1 — Engine core (backend + the intelligence)
════════════════════════════════════════════════
Build the backend and the clinical engine — this is the defensible core.
1. FastAPI + async SQLAlchemy + Alembic + Postgres. All tables from TRD §3.
   Auth with roles patient|caregiver|clinician, JWT access+refresh, role guards.
2. Port reference/ml into backend/app/ml/ and EXTEND to TRD §5 and §6:
   - baseline.py: 14-21 day window, >=3 sessions/week, discard first 3 sessions per module,
     ±2h time-of-day window tagging, MEDIAN + MAD, quality/identity rejection, lock at n>=12,
     per-module independent baselines, expected practice/recovery trajectory fit.
   - deviation.py: robust_z = 0.6745*(x-median)/MAD, RCI per feature, modality deviation
     mean(|z|) clipped at 6, CUSUM (k=0.5, h=4.0).
   - gates.py: Gate 1 persistence (>=2 consecutive valid sessions), Gate 2 cross-modality
     (>=2 independent domains), bands STABLE/WATCH/ALERT, IMPROVING detection that never alerts.
   - confounders.py: attach recent_illness, poor_sleep, medication_change, phq_change,
     off_window_time, low_quality_capture, identity_uncertain to every score.
3. Implement ALL exam module feature extractors from TRD §4 in Python (authoritative
   version). Modules M1-M20. Each with docstring explaining the clinical rationale.
4. compute_session(session_id) service chaining the whole pipeline.
5. Tests per TRD §10 including the full 21-day simulation.
Print migrate/run/test commands. STOP.

════════════════════════════════════════════════
## P2 — API + safety layer
════════════════════════════════════════════════
Implement every endpoint in TRD §9.
Critical: /safety/acute/{pid} must bypass all scoring and return escalation immediately.
Add middleware ensuring every finalize response carries the FAST payload.
Add the wellness-assertion string test and the audit log.
Integration test: caregiver+patient → 14 baseline sessions → 4 stable → 3 decline
→ assert exactly one ALERT with correct drivers and confounder annotations. STOP.

════════════════════════════════════════════════
## P3 — On-device exam PWA (the demo)
════════════════════════════════════════════════
React 18 + Vite + TS + Tailwind + shadcn/ui, PWA, offline-first, service worker, IndexedDB queue.
Implement the DAILY session first (M1 facial, M4 dysarthria, M7 fine motor, M10 attention,
M13 PHQ-2, M19 adherence), ~90 seconds total.
- MediaPipe Tasks Web for FaceMesh/Hands running ON-DEVICE; extract features client-side
  and POST features only, never media.
- Web Audio + DSP for all speech features client-side. Mirror the Python math exactly;
  add a test comparing JS and Python outputs on the same fixture within tolerance.
- Guided UX: audio-delivered instructions, huge targets, icon-driven, EN/HI/PA toggle,
  one-hand operation, no reading required, NO score ever shown to the patient.
- Capture quality gating with re-prompt. Identity check (face+voice embedding) per TRD §5.
- Session ends with calm confirmation + FAST card + emergency button.
Then add weekly (M2,M5,M6,M8,M11,M14,M17,M18) and monthly (M3,M9,M12,M15,M16) sessions. STOP.

════════════════════════════════════════════════
## P4 — Dashboards
════════════════════════════════════════════════
CAREGIVER: band card, plain-language explanation (EN/HI/PA), per-domain trend charts with
baseline band shaded and threshold dashed, history, adherence streak, alert log.
CLINICIAN (B2B): patient list ranked by sustained deviation; per-domain sparklines vs
baseline; alert cards that state "2 domains, 3 sessions sustained, vs this patient's
baseline" with confounder annotations — never a bare number; PHQ/BP/adherence columns;
PDF exam report; audit log view. Alert-fatigue-aware: WATCH never notifies. STOP.

════════════════════════════════════════════════
## P5 — On-device SLM with guardrails
════════════════════════════════════════════════
Integrate a quantized SLM (Gemma 3 1B or Llama 3.2 1B, Q4_K_M) via WebLLM for the demo;
document the llama.cpp-android path for production.
Input strictly {band, top_drivers, confounders, language}. Output 2-3 caregiver sentences
+ 1 clinician line, in EN/HI/PA.
Implement the guardrail layer and its tests per TRD §7: band-match assertion, forbidden
token filter ("stroke", "diagnos*", wellness assertions), deterministic template fallback.
Show a visible "generated on this device · no data left your phone" indicator. STOP.

════════════════════════════════════════════════
## P6 — Model training (after the app runs)
════════════════════════════════════════════════
Implement backend/app/ml/train/ per 03_DATASETS_v2.md:
  voice_dysarthria_clf (TORGO vs LibriSpeech/CommonVoice, XGBoost/LogReg)
  rhythm_irregularity_clf (PhysioNet AF Challenge 2017)
  asymmetry_discriminator (mPower PD bilateral vs stroke asymmetry)
Each: reproducible (seed=42), saves model + metrics JSON (ROC-AUC, sensitivity,
specificity, confusion matrix) + a limitations note. Wire outputs as ADDITIONAL FEATURES
into the deterministic engine — never as a decision. Tell me exactly where to place
downloaded datasets and the commands to train. STOP.

════════════════════════════════════════════════
## P7 — Demo mode + deploy
════════════════════════════════════════════════
Seed: caregiver + clinician + patient "Ramesh, 67, left MCA infarct, 5 months post-discharge,
Punjabi speaker" with 21 days: 14 baseline, 4 stable, 3 decline (pause ratio up, right-sided
mouth asymmetry up, left-hand tap asymmetry up) producing STABLE → WATCH → ALERT.
DEMO MODE toggle loading it instantly. Write DEMO_SCRIPT.md with the exact 3-minute
click-path for the pitch, including the offline-mode moment (turn on airplane mode, run a
full exam, show it still works — this is the Samsung on-device proof point).
Deploy: Dockerfile, render.yaml, Vercel config (HTTPS required for camera/mic), CORS locked,
health endpoint. Numbered deploy checklist + public URLs. Verify the seeded demo works live.
