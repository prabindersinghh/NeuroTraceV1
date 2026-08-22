# NEUROTRACE — CLINICAL AMENDMENT v3.0
## Derived from real anonymised post-stroke patient records

STATUS: Structural amendment. Read fully, write PLAN files, WAIT for approval
before building. Update PRD, TRD, ARCHITECTURE.md, DECISIONS.md and
CLINICAL_REFERENCE.md as part of this work.

═══════════════════════════════════════════════════════════════════
## 0. WHY THIS AMENDMENT EXISTS
═══════════════════════════════════════════════════════════════════
We obtained real, consented, anonymised medical records for a genuine
post-stroke patient assessed at a tertiary hospital seven months after
his stroke. The findings invalidate two assumptions in our current spec
and give us real clinical calibration values.

THE REFERENCE PATIENT (anonymised — no name, ID or hospital in any file):
  · Male, 82, Punjab, India
  · Ischemic stroke January 2026 → speech difficulty + right limb weakness
  · Assessed at tertiary vestibular/neuro-otology unit, August 2026 (~7 months post)

MRI FINDINGS:
  · Encephalomalacia with gliosis — LEFT CEREBELLAR HEMISPHERE
  · Encephalomalacia with gliosis — BILATERAL OCCIPITAL REGIONS
  · Chronic microangiopathic small-vessel disease (bilateral frontal
    paraventricular white matter, T2/FLAIR hyperintense, no diffusion restriction)
  · Generalised dilatation of ventricles and sulci
  · Cerebellar hemispheres and vermis otherwise normal; brainstem normal

→ This is POSTERIOR CIRCULATION territory. Our current PRD EXCLUDES this patient.

CLINICAL PRESENTATION AT 7 MONTHS:
  · Vertigo: 60 attacks, ~15 minutes each duration
  · Progress of symptoms: WORSE
  · Unsteadiness present
  · Hearing loss: worse BOTH sides (patient-reported and audiometry)
  · No tinnitus, no headaches

OBJECTIVE MEASUREMENTS (our calibration targets):
  Craniocorpography
    · Unterberger sway ...................... 17 cm      [ABNORMAL]
    · Tandem walking sway ................... 13 cm
    · Displacement (Unterberger) ............ 105 cm
    · Angular deviation ..................... 5° RIGHT
    · Body axis spin ........................ 1° left
    · Exposure time ......................... 48 sec
    · Tandem sway ........................... normal
    · Romberg ............................... normal
    · Body spin ............................. normal
  Oculomotor (VNG)
    · Saccade LATENCY ....................... ABNORMAL
    · Saccade VELOCITY ...................... ABNORMAL
    · Saccade precision ..................... normal
    · Nystagmus (all positions/manoeuvres) .. absent
    · Total SPV ............................. 14
  Subjective Visual Vertical
    · Static ................................ normal (avg 1.92°)
    · Dynamic clockwise ..................... ABNORMAL (avg 8.00)
    · Dynamic anti-clockwise ................ normal (avg -1.50)
  Bedside neurological examination
    · Finger-nose ........................... NORMAL both sides
    · Heel-knee-shin ........................ NORMAL both sides
    · Dysdiadochokinesia .................... NORMAL both sides
    · Joint-position ........................ NORMAL both sides
    · Toe-vibration ......................... ABNORMAL both sides
  Dizziness Handicap Inventory
    · Physical 6 · Emotional 8 · Functional 14 · TOTAL 28 (mild-moderate)
  Vitals
    · BP lying 109/60, standing 114/68 · Pulse 70/70 · BMI 22.48

═══════════════════════════════════════════════════════════════════
## 1. THE TWO FINDINGS THAT BREAK OUR CURRENT SPEC
═══════════════════════════════════════════════════════════════════
FINDING 1 — WE EXCLUDE THE PATIENT WE SHOULD SERVE
Our PRD scopes to anterior-circulation only. This patient is posterior
circulation (cerebellar + occipital). Posterior strokes are ~20-25% of
ischemic strokes and are misdiagnosed 2-3x more often than anterior ones —
cerebellar strokes are wrong at first presentation in 28-60% of cases.
They are the LEAST served and the MOST missed. Excluding them was a
defensible simplification; keeping the exclusion now that we can measure
balance and eye movement on a phone is not.

FINDING 2 — OUR COORDINATION MODULE WOULD HAVE FOUND NOTHING
Every classic cerebellar bedside test was NORMAL in this patient:
finger-nose, heel-knee-shin, dysdiadochokinesia, joint-position.
Yet he has 60 vertigo attacks, worsening unsteadiness, and objectively
abnormal Unterberger sway.

His deficits appear ONLY in:
  (a) BALANCE — the craniocorpography measures
  (b) OCULOMOTOR — saccade latency and velocity
  (c) SUBJECTIVE SYMPTOM BURDEN — vertigo frequency, DHI

All three are currently Tier 2 / deferred in our spec. Our M8 coordination
module, which we prioritised, would have returned "normal" on a
deteriorating patient. That is a false-negative in the exact population
that most needs monitoring.

═══════════════════════════════════════════════════════════════════
## 2. AMENDMENT A — WIDEN CLINICAL SCOPE
═══════════════════════════════════════════════════════════════════
ADD to IN SCOPE (PRD §3):
  · Posterior-circulation ischemic stroke survivors
    — cerebellar (PICA/AICA/SCA territory)
    — PCA / occipital territory
    — vertebrobasilar
  · Same qualifiers as before: >=3 months post-discharge, clinically
    stable, living at home, caregiver present
  · Residual deficit in >=1 of: aphasia, dysarthria, central facial palsy,
    cognitive slowing, IMBALANCE/VERTIGO, OCULOMOTOR ABNORMALITY

REMAINS OUT OF SCOPE (unchanged, restate in onboarding):
  ✗ Acute stroke of any kind — onset in seconds, our logic works over days
  ✗ Hemorrhagic stroke
  ✗ TIA
  ✗ Silent infarcts

RATIONALE FOR DECISIONS.md: posterior-circulation survivors are 20-25% of
ischemic strokes, are the most frequently misdiagnosed group, have no
existing home monitoring option, and their deficits ARE measurable with
phone camera pose and iris tracking. Widening scope increases both clinical
value and addressable population without adding hardware.

═══════════════════════════════════════════════════════════════════
## 3. AMENDMENT B — NEW DOMAIN: posterior_vestibular
═══════════════════════════════════════════════════════════════════
Create a new Gate-2 domain `posterior_vestibular` containing M3 and M9.

IMPORTANT: this domain HAS laterality (angular deviation direction,
pursuit/saccade left-right asymmetry, directional sway bias). It can
therefore satisfy the Gate 3 lateralised requirement. Register its
LATERAL_KEYS accordingly.

Update: Gate 2 domain counting, Gate 3 laterality registry, clinician
dashboard grouping, explanation templates, and the domain list in
ARCHITECTURE.md invariants.

═══════════════════════════════════════════════════════════════════
## 4. AMENDMENT C — M9 BALANCE (promote to core)
### Digital craniocorpography via MediaPipe Pose
═══════════════════════════════════════════════════════════════════
The reference hospital used a craniocorpography machine costing more than
most Indian district hospitals will ever spend, and the patient's family
had to drive him to a tertiary centre in another city to get these numbers.
We approximate it with a phone camera.

TASKS (caregiver films, or phone propped at ~1.5m, patient full-body in frame):
  T1 Romberg          — feet together, arms at sides, 30s eyes OPEN,
                        then 30s eyes CLOSED
  T2 Tandem stance    — heel-to-toe ("standing on a rope"), 30s
  T3 Tandem walking   — 10 heel-to-toe steps along a straight line
  T4 Unterberger      — march in place, eyes closed, 50 steps (~48s)

FEATURES TO EXTRACT (from MediaPipe Pose landmarks, 33 points):
  Per task:
    · sway_path_length_cm      — total centre-of-mass path
    · sway_area_cm2            — 95% confidence ellipse area
    · lateral_displacement_cm  — net left-right drift
    · anterior_displacement_cm — net forward drift
    · angular_deviation_deg    — body rotation from start heading (SIGNED,
                                 negative = left, positive = right)
    · body_axis_spin_deg       — trunk rotation about vertical axis
    · time_held_s              — before step-off or termination
    · step_off_count           — losses of position
    · arm_abduction_events     — arm raises for balance (a compensation marker)
  Romberg specifically:
    · romberg_ratio = sway_area(eyes closed) / sway_area(eyes open)
      ← the key proprioceptive measure; note our reference patient had
        ABNORMAL toe-vibration bilaterally, so this should be elevated
  Tandem walking:
    · midline_deviation_cm     — mean lateral error from the intended line
    · step_width_variability
  Unterberger:
    · displacement_cm          — net forward travel (reference: 105 cm)
    · sway_cm                  — lateral sway (reference: 17 cm, ABNORMAL)
    · rotation_deg             — net turn (reference: 5° right)

CALIBRATION: pixel-to-cm scaling from known patient height entered at
enrolment, using shoulder-to-ankle landmark distance as the reference scale.
Require a calibration step at first use; store scale factor per patient.

OUTPUT: a movement-trace visualisation in the same visual style as clinical
CCG output (top-down path plot) — this renders beautifully on the clinician
dashboard and in the demo.

QUALITY GATING: reject if <80% of frames have full-body pose detection,
if the subject leaves frame, or if lighting/motion blur degrades landmark
confidence below threshold. A bad capture is never a finding.

SAFETY: display a fall-risk warning before every balance task —
"Have someone stand beside them. Do this near a wall or chair."
Balance testing in an 82-year-old carries genuine fall risk. This is
non-negotiable and must be dismissible only by explicit caregiver confirmation.

SCHEDULE: weekly. Tier-3 ASHA sessions may run the full battery monthly.

═══════════════════════════════════════════════════════════════════
## 5. AMENDMENT D — M3 OCULAR (promote to core)
### Saccade and pursuit via MediaPipe FaceMesh iris landmarks
═══════════════════════════════════════════════════════════════════
The reference patient had NORMAL nystagmus on every VNG manoeuvre but
ABNORMAL saccade latency AND velocity. Saccades are the sensitive measure
here — this is what we must capture.

TASKS (phone held at ~40cm, face in frame, head still):
  T1 Horizontal saccades — target jumps left/right at randomised intervals,
                           20 trials, amplitudes 10°/20°/30°
  T2 Vertical saccades   — same, up/down, 10 trials
  T3 Smooth pursuit      — target moves sinusoidally, 0.2-0.5 Hz, 30s
  T4 Gaze holding        — hold gaze at 30° left, right, up, down, 10s each
                           (screens for gaze-evoked nystagmus)

FEATURES (from FaceMesh refined iris landmarks, per eye and per direction):
  Saccades:
    · saccade_latency_ms       — target onset to eye movement onset
                                 (SEPARATE leftward and rightward)
    · peak_velocity_deg_s      — main sequence peak velocity
    · saccade_accuracy_pct     — endpoint / target amplitude
    · hypometria_rate          — proportion undershooting
    · corrective_saccade_count
    · latency_asymmetry        — |left - right| ← LATERALITY SIGNAL
    · velocity_asymmetry       — |left - right| ← LATERALITY SIGNAL
  Smooth pursuit:
    · pursuit_gain             — eye velocity / target velocity
                                 (SEPARATE leftward and rightward)
    · gain_asymmetry           ← LATERALITY SIGNAL
    · catch_up_saccade_rate
  Gaze holding:
    · drift_velocity_deg_s     — per gaze position
    · nystagmus_present        — boolean, per position

TECHNICAL NOTES:
  · Use MediaPipe FaceMesh with refine_landmarks=True for iris points
    (468-477). Iris centre relative to eye corners gives gaze angle.
  · Frame rate is the limiting factor. Saccades peak at 400-600°/s;
    at 30fps we cannot resolve peak velocity accurately. Request 60fps
    capture where the device supports it, and RECORD THE ACTUAL FPS with
    every measurement. Report velocity with an explicit confidence caveat
    at low frame rates. Do not silently produce unreliable numbers.
  · Latency is more robustly measurable than velocity at consumer frame
    rates — weight it accordingly in scoring.
  · Head-movement compensation: reject or correct trials where head pose
    changes beyond threshold.

SCHEDULE: weekly.

═══════════════════════════════════════════════════════════════════
## 6. AMENDMENT E — SYMPTOM BURDEN INSTRUMENTS
═══════════════════════════════════════════════════════════════════
E1. VERTIGO ATTACK LOG  ← highest value-per-effort item in this amendment
  Caregiver logs each episode: timestamp, duration (minutes), severity 1-5,
  trigger (position change / standing / spontaneous / unknown),
  associated symptoms (nausea, hearing change, visual disturbance).
  Derived features: attacks_per_week, mean_duration_min, total_burden_min_per_week,
  trend slope over 4 and 12 weeks.
  WHY THIS MATTERS: our reference patient accumulated 60 attacks over months.
  That single number, logged weekly, would have shown deterioration long
  before the hospital visit. It costs nothing to implement and requires no
  sensor. Build it first.

E2. DIZZINESS HANDICAP INVENTORY (DHI)
  25 items, standard scoring (Yes=4, Sometimes=2, No=0).
  Subscales: Physical (7 items), Emotional (9), Functional (9). Total 0-100.
  Bands: 0-15 no handicap · 16-34 mild · 36-52 moderate · 54+ severe.
  Reference patient scored P6 / E8 / F14 / Total 28.
  Translate to Hindi and Punjabi. Monthly.

E3. AUDIOMETRY SELF-REPORT
  Reference patient had worsening bilateral hearing loss — a vestibulocochlear
  signal that accompanies posterior-circulation and inner-ear pathology.
  Simple monthly caregiver-reported change scale per ear (better/same/worse),
  plus optional in-app pure-tone screening if headphones are available.

═══════════════════════════════════════════════════════════════════
## 7. AMENDMENT F — CLINICAL_REFERENCE.md
═══════════════════════════════════════════════════════════════════
Create docs/CLINICAL_REFERENCE.md containing:
  · The anonymised reference-patient profile and every measurement in §0
  · A table mapping each clinical measure to our digital equivalent,
    with the clinical value as the calibration target
  · Explicit note: source is anonymised real-patient records, obtained with
    written consent, used for calibration only
  · A validation checklist: for each digital measure, does our output land
    in a plausible range relative to the clinical reference?

ABSOLUTE RULE: no patient name, patient ID, hospital ID, accession number,
referring physician, hospital name, or full date appears anywhere in this
repository, in any file, commit message, or log. Month-and-year granularity
only. Pin this with a test that greps the repo for the forbidden identifiers.

═══════════════════════════════════════════════════════════════════
## 8. AMENDMENT G — TEST FIXTURE: THE POSTERIOR PATIENT
═══════════════════════════════════════════════════════════════════
Add a synthetic test patient modelled on the reference case:
  · Coordination module (M8): ALL NORMAL — finger-nose, heel-shin,
    dysdiadochokinesia, joint-position
  · Balance (M9): progressively abnormal — Unterberger sway rising over
    weeks, angular deviation drifting right
  · Ocular (M3): saccade latency and velocity degrading
  · Vertigo log: attack frequency climbing week over week
  · Speech, facial, fine-motor, cognition: STABLE

REQUIRED ASSERTIONS:
  1. A system WITHOUT the posterior_vestibular domain produces NO alert
     on this patient — proving the gap this amendment closes.
  2. WITH the domain, an ALERT fires, driven by posterior_vestibular +
     vertigo burden.
  3. Gate 3 laterality is satisfied by directional angular deviation —
     not bypassed.
  4. The explanation names balance and eye-movement findings specifically,
     in plain language, in EN/HI/PA.

This test is the clinical proof of the amendment. It goes in the report.

═══════════════════════════════════════════════════════════════════
## 9. WHAT NOT TO DO
═══════════════════════════════════════════════════════════════════
  ✗ Do not claim to replace craniocorpography, VNG or caloric testing.
    We produce trends against a personal baseline, not clinical-grade
    vestibular diagnostics.
  ✗ Do not attempt caloric testing, Dix-Hallpike or head-impulse — these
    require an examiner and carry risk unsupervised.
  ✗ Do not diagnose BPPV, Meniere's, vestibular neuritis or any condition.
  ✗ Do not report saccade velocity without recording and surfacing the
    capture frame rate.
  ✗ Do not let a patient perform balance tasks without the fall-risk warning
    being acknowledged.

═══════════════════════════════════════════════════════════════════
## 10. DELIVERABLES FOR THIS AMENDMENT
═══════════════════════════════════════════════════════════════════
  1. PLAN_POSTERIOR_SCOPE.md — scope widening + new domain + gate changes
  2. PLAN_BALANCE_MODULE.md — M9 digital craniocorpography
  3. PLAN_OCULAR_MODULE.md — M3 saccade/pursuit
  4. Updated PRD (§3 scope, functional requirements)
  5. Updated TRD (§4 modules, §6 gates/domains, §10 tests)
  6. Updated ARCHITECTURE.md (new domain in invariants list)
  7. DECISIONS.md entries with dates and one-line rationale
  8. docs/CLINICAL_REFERENCE.md
  9. The posterior-patient test fixture and its four assertions

Write the PLAN files. WAIT for approval before building.
