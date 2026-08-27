# NEUROTRACE — FINAL PRODUCT SPECIFICATION v4.0
## The completion spec. Build everything in this file. No approval gates.

RATIONALE FOR THE SCHEDULE CHANGE: a real post-stroke clinic follow-up runs
~30 minutes. We are replicating that examination. A 10-12 minute daily
session at home is proportionate, and denser physical sampling materially
improves trend detection — balance and oculomotor deficits are exactly what
weekly-only sampling misses.

═══════════════════════════════════════════════════════════════════
## PART 1 — DAILY SESSION, 10-12 MINUTES
═══════════════════════════════════════════════════════════════════
Every physical module now runs DAILY. Fatigue is controlled by ORDERING and
by measurement, not by omission.

### FIXED ORDER — this order is clinically deliberate, do not rearrange
Rule: cognitively demanding and fatigue-sensitive tests run EARLY.
Standing/balance tests run in the middle, while alert but after warm-up.
Passive and seated tests run LAST.

  BLOCK A · SEATED, COGNITIVE FIRST (~3 min)
   1. M10  Attention / reaction    12 trials simple RT + choice RT
   2. M11a Memory encoding         present 5 words (recall comes at the end)
   3. M4   Dysarthria              sustained /a/ 5s · pa-ta-ka 5s · sentence
   4. M1   Facial motor            smile · forehead raise · eye closure · cheek puff
   5. M2   Tongue & palate         protrusion · "ahh"

  BLOCK B · SEATED, OCULAR (~2.5 min)
   6. M3a  Horizontal saccades     20 trials, 10/20/30 degrees
   7. M3b  Vertical saccades       10 trials
   8. M3c  Smooth pursuit          30s sinusoidal
   9. M3d  Gaze holding            4 positions, 10s each
  10. SVV  Subjective visual vertical   6 static trials + dynamic CW/ACW

  BLOCK C · STANDING, BALANCE (~2.5 min)   ← FALL-RISK GATE BEFORE THIS BLOCK
  11. M9a  Romberg eyes open       30s
  12. M9b  Romberg eyes closed     30s
  13. M9c  Tandem stance           30s
  14. M6   Pronator drift          10s arms out, palms up, eyes closed

  BLOCK D · SEATED, MOTOR & COORDINATION (~2 min)
  15. M7   Finger tapping          10s left · 10s right
  16. M8a  Finger-to-nose          5 reps each side
  17. M8b  Rapid alternating       10s each hand

  BLOCK E · CLOSE (~1.5 min)
  18. M11b Delayed recall          the 5 words from step 2
  19. M13  PHQ-2                   2 items
  20. M19  Medication confirm      2 taps
  21. M17  PPG rhythm              60s finger on lens (passive, seated, restful)
  22. FAST card + emergency button   ALWAYS, unconditional

TOTAL: 11-12 minutes typical.

### NOT IN THE DAILY ROTATION — EVER
  ✗ M9d Unterberger (50 steps, eyes closed)  → ASHA visit only. Fall risk.
  ✗ M9e Tandem walking (10 heel-toe steps)   → ASHA visit only. Fall risk.
  ✗ M12  Neglect (line bisection, cancellation) → needs tablet area
  These four remain supervised. Enforce in the registry; INV-10 must catch
  any attempt to move them to an unsupervised tier.

### FATIGUE CONTROL — mandatory, this is what makes 12 minutes safe
  · Record `elapsed_seconds_at_task_start` for EVERY task. Fatigue effects
    are then measurable and correctable rather than confounding.
  · Add `within_session_fatigue_slope` as a derived feature: performance
    decay across Blocks A→D. This is itself a clinical signal (post-stroke
    fatigue), not just noise.
  · PAUSE ANYTIME button on every screen. Session resumes where it stopped,
    within 2 hours, without invalidating the session.
  · If a patient pauses >3 times or abandons twice in a week, automatically
    offer LIGHT intensity and notify the caregiver.
  · Delayed recall (step 18) is time-anchored: record actual minutes since
    encoding, do not assume.

### INTENSITY SETTING — per patient, on the patients table
  FULL      = the 22-step schedule above (default)
  STANDARD  = drops SVV, M8b, vertical saccades   (~8 min)
  LIGHT     = core only, physical blocks rotate across days   (~4 min)
  RESEARCH  = FULL + Unterberger/tandem-walk, ASHA-supervised only
  Auto-suggest a step down on repeated abandonment. Never auto-step-up.

### WEEKLY ADD-ON (one chosen day, +5 min)
  M5 aphasia battery · M14 fatigue scale · M18 BP entry · E3 hearing check

### MONTHLY ADD-ON (+8 min)
  M11 full cognitive · M15 function (Barthel/mRS) · M16 EAT-10 · E2 DHI

### ASHA VISIT — monthly, TIER_3
  M9d Unterberger · M9e tandem walking · M12 neglect (tablet) · supervised
  full battery. These two balance tasks carry the DIRECTION of deviation.

═══════════════════════════════════════════════════════════════════
## PART 2 — ONBOARDING WORKFLOW
═══════════════════════════════════════════════════════════════════
Done by the CAREGIVER, not the patient. The patient's first interaction with
this product must not be a chore.

  STEP 1 · Caregiver account + consent
    Plain-language consent, EN/HI/PA. Explicit statements:
      - it does not diagnose anything
      - it cannot detect a stroke happening now
      - for sudden symptoms, call emergency services immediately
      - what data is collected, that raw audio/video never leaves the phone
      - how to withdraw and delete everything
    Consent is versioned and timestamped. Re-consent on material change.

  STEP 2 · Patient profile
    Age, sex, languages, education level (drives cognitive cut-offs),
    dominant hand, stroke month/year, side affected, stroke type if known.
    ELIGIBILITY GATE: block if <3 months post-stroke, if PD or other movement
    disorder is declared, or if no caregiver is available. Explain why in
    plain language rather than a bare rejection.

  STEP 3 · Scope disclosure  ← MANDATORY, cannot be skipped
    A full screen listing what NeuroTrace does NOT do. Requires explicit
    acknowledgement. This is a safety control, not legal decoration.

  STEP 4 · Calibration
    Patient height (pose scaling) · phone camera FPS probe · a test capture
    for lighting and framing · audio level check · face + voice enrolment
    for identity verification.

  STEP 5 · Home setup guidance
    Where to place the phone for standing tests (chest height, ~1.5m, full
    body in frame). Lighting. A chair or wall within reach. Illustrated,
    not written — this population may have aphasia or low literacy.

  STEP 6 · Guided first session
    The caregiver runs it WITH the patient. Every task shows a demo video
    first. No scoring, no baseline contribution — this session is practice.

  STEP 7 · Baseline period begins
    14-21 days explained plainly: "we are learning what is normal for HIM."
    Progress indicator. No alerts, no scores shown during baseline.

═══════════════════════════════════════════════════════════════════
## PART 3 — EXERCISE UX: HOW EACH TEST IS PERFORMED
═══════════════════════════════════════════════════════════════════
UNIVERSAL PATTERN for every single task, no exceptions:

  1. DEMO      — a 3-5s looping video of the movement done correctly.
                 Always available, replayable, shown by default for the
                 first 5 sessions.
  2. INSTRUCT  — one short sentence, spoken aloud AND on screen, in the
                 patient's language. Never a paragraph.
  3. POSITION  — live camera preview with a body/face outline guide.
                 Turns green when correctly framed. Cannot start until green.
  4. COUNTDOWN — 3-2-1 with audio.
  5. PERFORM   — live progress ring. For timed holds, a visible timer.
                 For trials, "4 of 12". PAUSE always visible.
  6. QUALITY   — instant check. If poor: "We couldn't see clearly — try
                 once more?" Max 2 retries, then skip and mark as
                 low-quality rather than forcing.
  7. CONFIRM   — neutral tick. NEVER a score. NEVER "good job" (patronising
                 to adults) and NEVER "poor" (harmful).

### PER-TASK INSTRUCTIONS — the exact patient-facing wording
  M1 facial     "Smile as wide as you can." / "Raise your eyebrows."
                "Close your eyes tightly." / "Puff out your cheeks."
  M2 tongue     "Stick your tongue straight out." / "Say aaah."
  M4 speech     "Take a breath and say aaah for as long as you can."
                "Say pa-ta-ka, over and over, as fast as you can."
                "Read this sentence out loud." (large text, high contrast)
  M3 saccades   "Keep your head still. Look at the dot each time it jumps."
  M3 pursuit    "Follow the dot with your eyes. Don't move your head."
  SVV           "Turn the line until it looks perfectly upright to you."
  M9 Romberg    "Stand with your feet together, arms by your side."
                Then: "Now close your eyes. Someone should be beside you."
  M9 tandem     "Put one foot directly in front of the other, heel to toe."
  M6 drift      "Hold both arms straight out, palms up, and close your eyes."
  M7 tapping    "Tap the two circles, back and forth, as fast as you can."
  M8 nose       "Touch the dot on the screen, then touch your nose. Repeat."
  M10 reaction  "Tap the circle the moment it appears."
  M11 recall    "Remember these five words." … later … "What were the words?"
  M17 PPG       "Cover the camera with your fingertip. Rest your hand."

### ACCESSIBILITY — non-negotiable for this population
  · Every instruction spoken aloud, in EN / HI / PA
  · Minimum 20pt text, high contrast, no thin fonts
  · Touch targets minimum 64dp
  · Works one-handed (hemiparesis)
  · No time pressure on comprehension — only on the tests themselves
  · Aphasia mode: icon-led, minimal text, longer response windows
  · Skip any task with a stated reason; never block session completion

### SAFETY — the balance block
  Before BLOCK C, a full-screen gate the caregiver must acknowledge:
    "These next tests involve standing and balance.
     Have someone stand beside him.
     Do this near a wall or a sturdy chair.
     If he feels dizzy, stop immediately."
  Not dismissible by tapping through. Requires an explicit confirm.
  Every balance screen has a STOP button larger than any other control.

═══════════════════════════════════════════════════════════════════
## PART 4 — FRONTEND: VISUAL SYSTEM
═══════════════════════════════════════════════════════════════════
Minimal, clinical, calm. Blue and white. Nothing decorative.

  PALETTE
    Primary blue     #1E5AA8   headers, primary actions
    Accent blue      #2E77D0   active states, focus, data lines
    Light blue       #EEF4FB   panels, selected rows
    Ink              #16212E   body text
    Muted            #5C6B7A   secondary text
    Line             #DDE5EC   borders, dividers
    Surface          #FFFFFF   background
    Status: stable #2E77D0 · watch #E8A33D · alert #C8453A · atypical #7A6BC4
    Status colours appear ONLY in status contexts. Never decoratively.

  TYPE     One family (Inter or system). Weights 400/500/600 only.
           Patient screens minimum 20pt. Clinician screens minimum 14pt.
  SPACING  8px grid. Generous whitespace. One primary action per screen.
  SHAPE    8px radius. 1px borders. NO shadows, NO gradients, NO glassmorphism.
  MOTION   150-200ms ease-out. Progress rings and countdowns only.
           No decorative animation anywhere.
  ICONS    Thin line, single weight, 1.5px stroke.

  PATIENT UI     one task per screen · huge targets · minimal chrome ·
                 no navigation during a session · no numbers shown to patient
  CAREGIVER UI   status card · plain-language explanation · trend charts ·
                 history · adherence · alert log
  CLINICIAN UI   dense, data-first, sortable · sparklines vs baseline ·
                 CCG trace plot · confounder annotations on every alert ·
                 PDF export · audit log

  THE CCG TRACE — build this properly, it is our signature visual.
  Top-down movement path, clinical plot style: white ground, thin grid,
  the path as a single accent-blue line, start point marked, drift vector
  shown, sway envelope as a light ellipse. Side-by-side with the patient's
  own baseline trace. This is a phone reproducing a tertiary-hospital output
  and it should look like one.

═══════════════════════════════════════════════════════════════════
## PART 5 — ML VERIFICATION
═══════════════════════════════════════════════════════════════════
Every model gets a MODEL CARD in docs/models/ containing: purpose, training
data with n and source, split method, metrics (ROC-AUC, sensitivity,
specificity, confusion matrix), known limitations, and — stated plainly —
whether it currently runs on synthetic fixtures or real data.

VERIFY AND REPORT:
  1. voice_dysarthria_clf — currently synthetic. State so explicitly.
  2. rhythm_irregularity_clf — validate against PhysioNet AF Challenge if
     obtainable; otherwise state synthetic.
  3. asymmetry_discriminator — the empirical basis for Gate 3. Highest
     priority for real data (mPower is publicly downloadable).
  4. JS↔Python feature parity — same fixture through both pipelines,
     assert within tolerance. Pin as an invariant.
  5. FPS honesty — confirm every saccade velocity output carries actual
     capture FPS and a confidence caveat. Show me a sample output.
  6. SLM guardrail — band match, forbidden tokens, fallback path.

Produce docs/ML_STATUS.md: one table, every model, one column that says
REAL DATA or SYNTHETIC. No ambiguity. We will be asked this.

═══════════════════════════════════════════════════════════════════
## PART 6 — DEPLOYMENT
═══════════════════════════════════════════════════════════════════
  Backend    Railway
  Database   Neon (branch-per-feature for schema work)
  Frontend   Vercel or Railway static — HTTPS is mandatory (camera/mic)
  ML training  batch GPU by the hour. NO always-on inference service —
               inference is on-device. Record this in ARCHITECTURE.md so
               nobody later adds one.

  REQUIRED
   · Numbered checklist for everything I must do in the dashboards
   · Environment variables documented by NAME only, never values
   · Health endpoint · migrations run on deploy · seeded demo present
   · CORS locked to the frontend origin
   · VERIFY: the deployed instance reproduces the 21-day demo with the
     identical band sequence and identical gate states as local
   · docs/DEPLOY.md as a runbook a stranger could follow
   · Note Neon cold-start behaviour and how to warm before a demo

═══════════════════════════════════════════════════════════════════
## PART 7 — COMPLETION CHECKLIST
═══════════════════════════════════════════════════════════════════
The prototype is COMPLETE when every line below is true and verified
against the RUNNING system, not only in tests:

  [ ] Daily 12-minute session runs end to end on a phone, offline
  [ ] All physical modules run daily; Unterberger/tandem-walk remain ASHA-only
  [ ] Fatigue instrumentation records elapsed time per task
  [ ] Pause/resume works and does not invalidate a session
  [ ] Onboarding complete, scope disclosure unskippable
  [ ] Every task has demo video, spoken instruction, framing guide, quality check
  [ ] Fall-risk gate blocks the balance block until acknowledged
  [ ] Blue/white minimal design applied across patient, caregiver, clinician
  [ ] CCG trace renders and compares against baseline
  [ ] Caregiver dashboard complete
  [ ] Clinician dashboard complete with audit log and PDF export
  [ ] ASHA interface complete
  [ ] Awaaz D1-D5 complete
  [ ] SVV module live in posterior_vestibular
  [ ] E3 audiometry self-report built
  [ ] All model cards written; ML_STATUS.md states real vs synthetic
  [ ] Deployed on Railway + Neon, demo reproduces on the public URL
  [ ] EN / HI / PA throughout
  [ ] All invariants pinned; full suite green by exit code
  [ ] Privacy invariant passing; no identifiers anywhere; nothing pushed
  [ ] Living docs current

STANDING INSTRUCTION: no approval gates. Write plans if they help you think,
then build immediately. Only pause for things I must physically do (accounts,
hooks, dataset requests). Flag uncertainty in the report afterwards, not
before. Report when the checklist is complete.
