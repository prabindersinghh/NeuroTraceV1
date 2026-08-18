# NeuroTrace — Product Requirements Document (PRD)
**Version:** 1.0 · **Owner:** Team NeuroTrace · **Target:** Samsung SFT 2026 National Pitch (Sep 7)

## 1. Problem
After a stroke, the highest-risk phase is at home, where no one monitors the patient between monthly
doctor visits. Silent neurological decline (speech, facial control, cognition) is missed until it
becomes an emergency. India has ~1.8M strokes/year; 1 in 4 survivors has a second stroke.

## 2. Product
NeuroTrace is a web app (later mobile) that runs a **45-second daily check-in** capturing three
signals — voice, facial movement, reaction time — learns each patient's **personal baseline**, and
flags **sustained multi-day deviation** from it. A caregiver gets a plain-language status
(Stable / Watch / Alert) with an explanation. No wearable, works on any phone browser.

## 3. Goals & Non-Goals
### Goals (Tier 1 — for the pitch)
- G1: Patient can register, log in, and complete a daily check-in in the browser.
- G2: System extracts real features from voice, face, and reaction time.
- G3: System builds a personal baseline over 3–5 days and computes a Neurological Stability Score (0–100).
- G4: Alert fires only when >=2 signals deviate together (cross-validation).
- G5: Caregiver dashboard shows trend charts + an explainable summary per day.
- G6: Runs end-to-end on the web, live-demoable, deployed on a public URL.

### Non-Goals (Tier 2 — after pitch)
- Training custom deep neural nets from scratch.
- Native Android/iOS app.
- Real patient data / clinical trial.
- WhatsApp integration (mock/simulated for the demo is fine).

## 4. Users
- **Patient (end user):** 55–75, post-stroke, low digital literacy. Needs a dead-simple check-in.
- **Caregiver (buyer):** adult child, remote. Needs the dashboard + alerts.
- **Clinician (secondary):** optional read-only view of trends.

## 5. Core User Flows
1. **Onboarding:** caregiver creates patient profile → patient does 3–5 baseline check-ins.
2. **Daily check-in:** login → speak one sentence (record) → 10s face capture → tap-reaction test →
   see "done, all good" (never shows raw risk to patient).
3. **Caregiver dashboard:** status card (Stable/Watch/Alert) + 3 trend charts (voice/face/reaction) +
   today's explanation + history.
4. **Alert:** when score crosses threshold with >=2 signals, dashboard shows Alert + (mock) WhatsApp sent.

## 6. Functional Requirements
- FR1 Auth: email/password, patient vs caregiver roles, JWT sessions.
- FR2 Capture: browser mic + webcam recording; reaction test as a JS mini-game.
- FR3 Feature extraction: server-side, per modality (see TRD §4).
- FR4 Baseline: rolling per-patient mean/std over first N days; stored per patient.
- FR5 Scoring: weighted z-score fusion → 0–100; status bands Stable/Watch/Alert.
- FR6 Explainability: SHAP (or feature-contribution fallback) top-3 drivers per decision, in plain English/Hindi.
- FR7 Storage: patients, daily_samples, feature_vectors, baselines, scores, alerts.
- FR8 Dashboard: charts + status + history; caregiver-only.
- FR9 Deploy: public URL (Render/Railway backend, Vercel frontend).

## 7. Success Metrics (demo acceptance)
- Full check-in completes in < 90s in the browser.
- Zero false alerts across a simulated "stable" week.
- An injected "decline" (degraded voice/face on day 6–8) is flagged within one check-in.
- Every alert shows an explanation a non-medical person understands.

## 8. Risks
- Browser mic/webcam permissions & cross-device quirks → test on Chrome mobile early.
- Feature extraction latency → keep models lightweight, cache.
- Over-scoping → follow Tier 1 strictly until it runs end-to-end.
