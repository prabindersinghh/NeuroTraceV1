# NEUROTRACE — TECHNICAL REQUIREMENTS DOCUMENT v2.0

## 1. STACK
FRONTEND (the product — PWA, mobile-first, offline-first)
  React 18 · Vite · TypeScript · Tailwind · shadcn/ui · Recharts
  MediaPipe Tasks Web (FaceMesh, Pose, Hands) — ON-DEVICE
  Web Audio API + custom DSP — ON-DEVICE speech features
  WebLLM (demo) / llama.cpp-android (production) — on-device SLM
  IndexedDB for offline session queue + local encrypted store
  Service worker for full offline operation

BACKEND (sync + B2B dashboard only; the D2C core works without it)
  FastAPI (Python 3.11) · async SQLAlchemy 2.x · Alembic · PostgreSQL 15
  JWT access+refresh · bcrypt · role guards
  Stores FEATURE VECTORS AND SCORES ONLY — never raw media

DEPLOY: backend Railway · frontend Vercel (HTTPS required for camera/mic) · DB Supabase

## 2. REPO
neurotrace/
  frontend/src/
    exam/          # one module per exam component (see §4)
    engine/        # baseline, RCI, CUSUM, gates — MIRRORED from backend, deterministic
    slm/           # on-device model load + prompt + guardrail
    safety/        # FAST card, emergency, acute bypass
    identity/      # face + voice embedding match
    quality/       # capture quality gating
    ui/ routes/ api/ store/
  backend/app/
    ml/            # authoritative feature extraction + scoring (Python)
    routers/ auth/ services/ models.py schemas.py
    ml/train/      # offline training + validation scripts
  docs/

## 3. DATA MODEL
users(id, email, pw_hash, role, lang, created_at)
patients(id, caregiver_id, clinician_id, name, age, sex, stroke_side, stroke_date,
         enrolment_date, baseline_state, languages)
sessions(id, patient_id, ts, type[daily|weekly|monthly], device_info, quality_score,
         identity_verified bool, completed bool)
module_results(id, session_id, module_code, features_json, quality_flag)
baselines(id, patient_id, module_code, median_json, mad_json, n_sessions, window_start,
          window_end, locked bool)
deviations(id, session_id, module_code, rci_json, mean_abs_z, cusum_stat, flagged bool)
scores(id, session_id, domain_devs_json, band, gate1_passed, gate2_passed,
       confounders_json, created_at)
alerts(id, patient_id, score_id, band, drivers_json, explanation_en, explanation_hi,
       acknowledged_by, created_at)
questionnaires(id, patient_id, instrument[PHQ2|PHQ9|EAT10|FSS|BARTHEL], score, responses_json, ts)
vitals(id, patient_id, bp_sys, bp_dia, rhythm_flag, ppg_features_json, ts)
adherence(id, patient_id, taken bool, ts)
audit_log(id, actor_id, action, patient_id, ts, meta_json)

## 4. EXAM MODULES — implement each as a self-contained module
Each module = { id, domain, tasks[], extract(raw)->features, scoringKeys[],
                LATERAL_KEYS[], gatesAlerts, schedule }

LATERAL_KEYS — REQUIRED, added v2.1. The subset of a module's features that express
LEFT-RIGHT ASYMMETRY rather than overall level. This is the discriminator between a focal
lesion and a diffuse process:
  · a stroke damages one hemisphere -> one-sided deficit -> asymmetry features move
  · Parkinson's / vascular parkinsonism -> symmetric -> only absolute levels move
Modules with no left/right axis (M4 speech, M10 attention, M11 memory) declare an empty
tuple and can NEVER establish laterality. See §6 Gate 3.

  M1  lateral: mouth_corner_symmetry, corner_drop, nasolabial_ratio,
               forehead_movement_symmetry, ear_asymmetry, eye_closure_asymmetry,
               blink_asymmetry
      NOT lateral: eye_aperture_L/R, landmark_tremor (masked facies moves these bilaterally)
  M2  lateral: tongue_deviation_abs
  M6  lateral: drift_asymmetry, pronation_asymmetry
  M7  lateral: tap_asymmetry_ratio, tap_cv_asymmetry
      NOT lateral: tap_rate_L, tap_rate_R, tap_rate_mean (bradykinesia slows both hands)
  M12 lateral: omission_asymmetry, bisection_deviation_abs
  M4, M10, M11, M13-M20: no laterality.

  POSTERIOR CIRCULATION (added v2.2) - M3 and M9 rewritten, promoted to WEEKLY core:
  M3  app/exam/vestibular.py::extract_oculomotor
      saccade_latency_{left,right,up,down}, saccade_velocity_*, saccade_precision_*,
      pursuit_gain, pursuit_gain_{left,right}
      lateral: pursuit_gain_asymmetry, saccade_latency_asymmetry,
               saccade_velocity_asymmetry
  M9  app/exam/vestibular.py::extract_craniocorpography
      {test}_sway_path_cm, {test}_sway_area_cm2, {test}_lateral_cm,
      {test}_sway_velocity_cm_s, {test}_angular_deviation_deg, romberg_quotient
      tests: romberg_eyes_open, romberg_eyes_closed, tandem_stance, tandem_walk,
             unterberger
      lateral: unterberger_angular_deviation_abs_deg, unterberger_lateral_abs_cm,
               tandem_walk_angular_deviation_abs_deg, tandem_walk_lateral_abs_cm
      Scale: normalised pose coords are converted to cm using head width as the ruler,
      because the phone's distance varies between sessions and raw units are not
      comparable week to week.

DOMAIN A · CRANIAL NERVES
  M1 facial_motor        tasks: smile, FOREHEAD RAISE, tight eye closure, cheek puff
                         features: mouth_corner_symmetry, nasolabial_ratio,
                           forehead_movement_symmetry (CENTRAL vs PERIPHERAL discriminator),
                           eye_aperture_L, eye_aperture_R, ear_asymmetry, blink_asymmetry,
                           landmark_tremor
                         maps to: NIHSS item 4                          [DAILY]
  M2 tongue_palate       tasks: tongue protrusion, sustained "ahh"
                         features: tongue_deviation_angle, palate_elevation  [WEEKLY]
  M3 ocular              tasks: follow-the-dot pursuit, 4-quadrant field check
                         features: pursuit_smoothness, saccade_latency, field_defect [MONTHLY]

DOMAIN B · SPEECH & LANGUAGE
  M4 dysarthria          tasks: sustained /a/ 5s, "pa-ta-ka" DDK 5s, sentence read
                         features: jitter, shimmer, hnr, max_phonation_time, ddk_rate,
                           ddk_regularity, articulation_rate, mfcc1..13 mean+std,
                           f0_mean, f0_cv, pause_ratio, voice_onset_time
                         maps to: NIHSS item 10                         [DAILY]
  M5 aphasia             tasks: picture description, 10-item naming, 3-phrase repetition,
                           4-item yes/no comprehension, semantic fluency 60s
                         features: words_per_min, type_token_ratio, mean_length_utterance,
                           word_finding_latency, naming_accuracy, repetition_accuracy,
                           comprehension_score, fluency_count
                         maps to: NIHSS item 9                          [WEEKLY]

DOMAIN C · MOTOR
  M6 pronator_drift      task: arms out, palms up, eyes closed 10s (camera + Pose)
                         features: vertical_drift_L/R, pronation_angle_L/R, drift_asymmetry
                         maps to: NIHSS item 5                          [WEEKLY]
  M7 fine_motor          tasks: finger tapping L and R hand 10s each, drag-target test
                         features: tap_rate_L/R, inter_tap_cv_L/R, decrement_slope,
                           ASYMMETRY_RATIO  ← the stroke signal; bilateral slowing = PD
                                                                        [DAILY]

DOMAIN D · COORDINATION & GAIT
  M8 coordination        tasks: finger-to-nose (camera), rapid alternating movements
                         features: endpoint_accuracy, movement_smoothness, dysdiadochokinesia
                         maps to: NIHSS item 7                          [WEEKLY]
  M9 gait_balance        tasks: Timed Up & Go (phone in pocket), 30s standing sway
                         features: tug_seconds, cadence, step_symmetry, sway_area [MONTHLY]

DOMAIN E · COGNITION
  M10 attention_speed    tasks: simple RT 12 trials, choice RT, Trail Making A
                         features: rt_median, RT_COV (most sensitive marker), rt_iqr,
                           lapse_rate, attention_decay_slope, tmt_a_seconds  [DAILY]
  M11 memory_executive   tasks: 5-word recall (immediate+delayed), digit span fwd/bwd,
                           Trail Making B, clock drawing
                         features: recall_immediate, recall_delayed, span_forward,
                           span_backward, tmt_b_minus_a, clock_score        [WEEKLY]
                         NOTE: education-stratified cut-offs (literate vs illiterate)
  M12 neglect            tasks: line bisection, star cancellation
                         features: bisection_deviation, left_omissions, right_omissions
                         maps to: NIHSS item 11                          [MONTHLY]

DOMAIN F · MOOD, FATIGUE, FUNCTION
  M13 depression         PHQ-2 daily → PHQ-9 if positive                 [DAILY/WEEKLY]
  M14 fatigue            Fatigue Severity Scale                          [WEEKLY]
  M15 function           Barthel Index / mRS self-report (caregiver)     [MONTHLY]
  M16 dysphagia          EAT-10                                          [MONTHLY]

DOMAIN G · VITALS & SECONDARY PREVENTION
  M17 rhythm             PPG via phone camera + flashlight, 60s
                         features: mean_hr, rmssd, pnn50, rr_irregularity_index,
                           poincare_sd1/sd2
                         output: "irregular rhythm detected — please get an ECG"
                         NEVER: "you have atrial fibrillation"           [WEEKLY]
  M18 blood_pressure     manual entry / connected cuff                   [WEEKLY]
  M19 adherence          2-tap medication confirmation                   [DAILY]
  M20 symptom_log        structured + free-text caregiver notes          [ANY TIME]

## 5. BASELINE ENGINE
  · Enrolment gate: patient must be >=3 months post-stroke. Block otherwise.
  · Window: 14-21 days, >=3 sessions/week, per module independently.
  · Discard first 3 sessions per module (learning/practice effect).
  · Require session time within ±2h of the patient's chosen window; else tag off-window.
  · Statistics: MEDIAN and MAD per feature (NOT mean/SD).
  · Reject sessions failing quality gate or identity check from baseline computation.
  · Baseline locks when n>=12 valid sessions; store window_start/window_end.
  · Model an expected practice/recovery curve per module; deviation is measured against
    the TRAJECTORY, not a flat line.

## 6. CHANGE DETECTION
  robust_z(x) = 0.6745 * (x - median) / MAD
  RCI per feature; modality deviation d_m = mean(|robust_z|) clipped at 6.
  CUSUM: S_t = max(0, S_{t-1} + (d_m - k)), k=0.5, alarm at h=4.0.
  GATE 1 persistence: d_m > threshold on >=2 consecutive valid sessions.
  GATE 2 cross-modality: >=2 INDEPENDENT domains (A-G) both pass Gate 1.
  GATE 3 laterality (REQUIRED, added v2.1): >=1 persistent domain must show a ONE-SIDED
    change, sustained across the whole persistence window.
      lateral_d_m = mean(|robust_z|) over that module's LATERAL_KEYS only, clipped at 6.
      A module is lateralised when lateral_d_m > LATERAL_THRESHOLD (2.0).
      is_lateralised(module) = computed AND gateable AND has_lateral_keys AND lateralised.
    posterior_vestibular DOES carry laterality: Unterberger angular deviation names the
    lesioned side, and pursuit/saccade metrics are direction-dependent. The EYE is the
    primary source: in the reference patient the Unterberger angular deviation was NORMAL
    and the lateralised finding was M3 saccade velocity asymmetry ~0.37 (GAP_ANALYSIS D-2).
    A posterior-circulation patient can therefore reach ALERT on balance and eye movement
    alone, with no limb or facial sign.
  Speech may CORROBORATE a lateralised finding. Speech plus a symmetric domain must
    NEVER satisfy the alert condition.
    Laterality is required across the whole window, not just today: a single session's
    asymmetry can come from head tilt or an awkward grip on the phone.

  WHY GATE 3 EXISTS. Parkinson's disease produces bradykinesia, hypophonia/monotone speech
  and masked facies with reduced blink SIMULTANEOUSLY. PD is common in the 55-75 band, and
  post-stroke patients can develop vascular parkinsonism. Under Gates 1+2 alone a PD patient
  trips face, motor and voice together and generates the system's HIGHEST-CONFIDENCE ALERT
  for a condition it does not monitor and cannot help with. Stroke is lateralised;
  Parkinson's is symmetric. That anatomical fact is the discriminator.

  BANDS: STABLE (logged only)
       · WATCH (one domain, or two domains with no lateralised finding; clinician-visible)
       · ALERT (all three gates)
       · PATTERN_ATYPICAL (symmetric progressive change across the parkinsonian triad)

  PATTERN_ATYPICAL — detect_symmetric_pattern(window, persistent). Emitted when ALL of:
    · all three of {cranial_nerves, motor, speech_language} persistently deviating
    · NO lateralised finding on ANY session in the window
    · the triad's mean deviation is not shrinking (progressive, not a resolving dip)
  Message, verbatim: "Changes seen are not consistent with a focal (one-sided) deficit.
  Please discuss other neurological causes with your doctor."
  Checked BEFORE any alert is emitted. Writes NO alert row. Surfaced on the clinician
  dashboard as a distinct card type, not as a deviation alert.
  CONFOUNDERS attached to every score: recent_illness, poor_sleep, medication_change,
    phq_change, off_window_time, low_quality_capture, identity_uncertain.
    Any active confounder downgrades confidence and is printed on the alert.
  IMPROVEMENT: if trajectory slope is positive beyond RCI, mark IMPROVING — never alert.

## 7. ON-DEVICE SLM — GUARDRAILED
  Model: Gemma 3 1B or Llama 3.2 1B, Q4_K_M (~0.5-0.8GB).
  Input: {band, top_drivers[], confounders[], language}. NOTHING ELSE.
  Output: 2-3 caregiver sentences + 1 clinician line.
  HARD RULES (enforce with a unit test):
    - SLM never receives raw features or computes any number.
    - Rendered band must equal engine band. Test asserts this.
    - Forbidden output tokens: "stroke", "diagnos*", "you are fine", "normal, no action".
    - On load failure or guardrail violation → fall back to deterministic templates.
  UI shows: "generated on this device · no data left your phone".

## 8. SAFETY LAYER
  · FASTCard component rendered at the end of EVERY session and on every dashboard.
  · Persistent one-tap emergency call button.
  · /safety/acute endpoint + UI path: any acute symptom report SKIPS scoring entirely
    and returns immediate emergency escalation.
  · Global lint rule / test: no user-facing string may assert wellness ("fine", "all clear",
    "no problem", "healthy").
  · Onboarding screen explicitly lists what the system cannot detect.

## 9. API
  POST /auth/{register,login,refresh}
  POST /patients · GET /patients/{id} · GET /clinic/patients
  POST /sessions/{pid}/start · POST /sessions/{sid}/module/{code}  (features JSON only)
  POST /sessions/{sid}/finalize   → {band, drivers, confounders, explanation_en/hi}
  POST /questionnaire/{pid} · POST /vitals/{pid} · POST /adherence/{pid}
  POST /safety/acute/{pid}        → bypasses everything, returns escalation
  GET  /dashboard/{pid} · GET /clinic/patient/{pid} · GET /report/{pid}.pdf
  GET  /audit/{pid}

## 10. TESTS (required)
  · Each extractor on a fixture (synthesize if no sample available).
  · Baseline: MAD math, first-3 discard, quality rejection, lock condition.
  · RCI + CUSUM math.
  · Gate logic: single-domain sustained → WATCH not ALERT; two-domain sustained → ALERT.
  · Improvement trajectory → never alerts.
  · Confounder annotation appears on alert.
  · SLM guardrail: band match + forbidden-token absence + fallback path.
  · Safety: acute report bypasses scoring; no wellness-assertion strings anywhere.
  · Full 21-day simulation: baseline + stable (0 alerts) + decline (exactly 1 alert).
  · LATERALITY (added v2.1):
      - symmetric change raises d_m but NOT lateral_d_m
      - a module with no LATERAL_KEYS is never lateralised, however deviant
      - two domains WITH a lateralised finding -> ALERT
      - two domains WITHOUT one -> WATCH, not ALERT
      - speech + symmetric face -> Gate 2 does not satisfy the alert condition
      - speech + lateralised face -> ALERT (speech may corroborate)
      - laterality present only on today's session -> Gate 3 fails
  · PD PATTERN (added v2.1):
      - simulated PD: symmetric bilateral decline across face, motor and voice for 5
        sessions -> NO ALERT, band == PATTERN_ATYPICAL, zero alert rows
      - simulated stroke: lateralised decline, same magnitudes -> ALERT fires normally
      - any lateralised finding rules the pattern out
      - a resolving symmetric dip is not the pattern
  · ENROLMENT EXCLUSION (added v2.1): pd_diagnosis=true or other_movement_disorder=true
      -> enrolment blocked, both at the engine and over HTTP.
