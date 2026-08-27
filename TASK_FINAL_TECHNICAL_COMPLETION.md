# NEUROTRACE — FINAL TECHNICAL COMPLETION
## Everything buildable, in one task. No approval gates.

This is the last major build task. When Part 9's checklist is green, the technical
work is complete and everything remaining is physical (phone testing, hardware,
filming, doctor meetings, dataset access) or organisational.

Work continuously. Build immediately rather than waiting for sign-off. Flag
uncertainty in the report afterwards, not before. Keep the working discipline:
living docs current, invariants pinned by tests, exit codes read not grepped,
reports split live-verified vs test-verified, near-misses written up honestly.

═══════════════════════════════════════════════════════════════════
## PART 1 — CRITICAL: THE REGULATORY LANGUAGE IS WRONG
═══════════════════════════════════════════════════════════════════
This is my error, propagated by me into the specs you built from. Fix it first.

The repo currently states, in the README and probably in PRD/TRD/ARCHITECTURE:
    "D2C — Recovery Companion — Outside CDSCO device classification"

THAT CLAIM IS WRONG AND MUST BE REMOVED EVERYWHERE.

CDSCO published final Medical Device Software guidance on 21 July 2026. Under the
Medical Devices Rules 2017 framework, software can be a medical device when its
intended use includes monitoring of disease, disorder, injury or physiological
processes. Classification is driven by INTENDED USE, not by business model. A system
whose stated purpose is monitoring neurological change in identified post-stroke
patients is much closer to SaMD than to wellness software. Calling it "outside CDSCO"
because it is D2C is not a defensible position.

REPLACE with this exact wording wherever the old claim appears:

  D2C — Home Recovery Companion: smartphone-first neurological follow-up for
  eligible post-stroke patients, with clinician involvement during baseline
  establishment and clinical escalation when required. Regulatory classification
  will be determined based on the final intended use under the CDSCO Medical
  Devices Rules framework.

  B2B — Clinical Continuity Platform: hospital and clinician-facing longitudinal
  monitoring and review workflow, with clinical decisions remaining with
  appropriately qualified healthcare professionals.

  Regulatory status: A formal CDSCO intended-use and risk-classification assessment
  under the Medical Devices Rules framework is in progress. No exemption is claimed.

TASKS
  1.1  Grep the entire repo for: "outside CDSCO", "not a medical device"
       (as a regulatory conclusion rather than a user-facing disclaimer),
       "wellness software", "exempt", "Class A/B/C/D" — list every hit, fix each.
  1.2  Write docs/INTENDED_USE.md containing ONE frozen intended-use statement.
       Everything else in the project must quote it verbatim, never paraphrase.
  1.3  Write docs/CLAIMS_MATRIX.md — every public-facing sentence classified as
       ALLOWED / NEEDS EVIDENCE / PROHIBITED. Seed it from Part 8 below.
  1.4  Add INV: no file may contain a regulatory-exemption claim. Pin with a test
       that greps for the forbidden phrases and fails the build.

═══════════════════════════════════════════════════════════════════
## PART 2 — THE SESSION MODEL IS OUT OF DATE
═══════════════════════════════════════════════════════════════════
The code implements a single ~12 minute daily session. The product positioning has
moved to TWO LAYERS and the code must follow. This is the largest functional gap
between what we say and what we ship.

  DAILY PULSE — target 90 seconds, runs every day
    Purpose: FREQUENCY. Low burden, high adherence.
    Contents: M1 facial · M4 dysarthria · M7 finger tapping · M10 attention ·
              M13 PHQ-2 · M19 medication
    Ends with FAST card + emergency button, as every session does.

  COMPREHENSIVE FOLLOW-UP — target 6-12 minutes
    Purpose: DEPTH. The full neurological examination.
    Default cadence: twice weekly. Configurable per patient.
    Contents: everything in Daily Pulse PLUS
              M2 tongue/palate · M3 ocular (saccades, pursuit, gaze hold) ·
              SVV · M5 aphasia · M6 pronator drift · M8 coordination ·
              M9 balance (Romberg, tandem stance) · M11 memory/executive ·
              M14 fatigue · M17 PPG · M18 BP
    Fall-risk gate before the standing block, unchanged.

  UNCHANGED
    Monthly battery · ASHA visit tasks (Unterberger, tandem walk, neglect) ·
    intensity settings · fatigue instrumentation · pause/resume

TASKS
  2.1  Add session_type enum: DAILY_PULSE | COMPREHENSIVE | MONTHLY | ASHA_VISIT
  2.2  Restructure the protocol/registry so module scheduling is driven by
       session_type, not one flat list. INV-10 must still hold — every module
       reachable by at least one session type, every task assigned.
  2.3  Scheduler: which session is due today, per patient, per cadence config.
       Patient-facing copy must make it obvious which one they are starting and
       roughly how long it will take.
  2.4  Baseline engine: verify it handles modules appearing at different
       frequencies. A module measured twice weekly needs its own baseline
       n-count and window, independent of daily modules. Test this explicitly —
       do NOT assume the existing code handles mixed cadence correctly.
  2.5  Update the seed and the 21-day demo to use the two-layer schedule while
       still producing the same STABLE → WATCH → ALERT story.
  2.6  Update PRD, TRD, ARCHITECTURE, README, DECISIONS.

═══════════════════════════════════════════════════════════════════
## PART 3 — DOCTOR-IN-THE-LOOP 21-DAY BASELINE
═══════════════════════════════════════════════════════════════════
This is now core positioning and is entirely unbuilt. It is also our strongest
regulatory argument: the clinician sets the clinical reference, NeuroTrace maintains
the longitudinal observation. The system is visibly not autonomous.

  3.1  RMP / DOCTOR ONBOARDING
       New fields on the clinician user: full name, medical qualification,
       medical registration number, registering authority/state council, specialty,
       affiliation/institution, contact.
       Registration number is stored and displayed but NOT auto-verified — mark it
       `verification_status: SELF_DECLARED` and surface that honestly in the UI.
       Do not imply we have verified a credential we have not.
       Role must be specific: TREATING_PHYSICIAN | CONSULTING_NEUROLOGIST |
       CLINICAL_REVIEWER — not a generic "doctor".

  3.2  DOCTOR ↔ PATIENT LINK
       Explicit, consented, auditable. A doctor sees only linked patients.
       Linking and unlinking both generate audit records.

  3.3  BASELINE PHASE STATE MACHINE
       baseline_phase: NOT_STARTED | IN_PROGRESS | DOCTOR_REVIEW_PENDING |
                       LOCKED | ABANDONED
       Transitions, and what each state permits:
         - During IN_PROGRESS: no alerts fire, no bands shown to caregiver
         - Sessions accumulate toward the n>=12 lock condition
         - When criteria met → DOCTOR_REVIEW_PENDING
         - Doctor reviews and confirms → LOCKED, monitoring begins
         - Doctor can reject and extend the baseline period with a reason
       Define and implement: what happens if the baseline is incomplete after
       21 days (extend, or downgrade to LIGHT intensity, or flag for review —
       pick one, implement it, record the decision in DECISIONS.md).

  3.4  CLINICIAN BASELINE REVIEW VIEW
       What the doctor sees before confirming a baseline:
       every module's captured values across the window, variability, capture
       quality rate, adherence, any sessions rejected and why, and a plain
       summary of what this patient's "normal" looks like.
       Doctor action: CONFIRM | EXTEND | FLAG_CONCERN, each with a free-text note.
       Every action timestamped, attributed, immutable, audit-logged.

  3.5  RE-ENTRY CRITERIA
       Define when a doctor is brought back after baseline lock:
       any ALERT band · any PATTERN_ATYPICAL · adherence below threshold ·
       caregiver-raised concern · scheduled periodic review.
       Implement as an explicit list, not implicit behaviour.

  3.6  CLINICAL STATE CHANGE DURING BASELINE
       If a new clinical event is reported during the baseline window, the
       baseline is invalidated — the patient's "normal" has changed. Implement
       an explicit invalidate-and-restart path with a recorded reason.

═══════════════════════════════════════════════════════════════════
## PART 4 — CONSENT ARCHITECTURE
═══════════════════════════════════════════════════════════════════
Replace any single blanket consent with SEPARATE, independently grantable and
withdrawable consents. Each versioned, timestamped, attributed.

  C1  Use of NeuroTrace for neurological follow-up
  C2  Processing of personal and health data
  C3  Sharing measurements with the linked clinician
  C4  Research / validation participation          (default OFF)
  C5  Photo / video / testimonial use              (default OFF)
  C6  Teleconsultation                              (only if applicable)

TASKS
  4.1  consents table: patient_id, consent_type, version, granted bool,
       granted_at, granted_by, withdrawn_at, ip/device context
  4.2  Withdrawal flow reachable from settings for every consent independently.
       Withdrawing C3 must actually stop clinician data sharing — enforce
       server-side, and test it.
  4.3  Consent version bump forces re-consent on material change.
  4.4  All six texts in EN / HI / PA, plain language, at the reading level of a
       caregiver with no medical background.
  4.5  Test: no clinician endpoint returns patient data when C3 is withdrawn.

═══════════════════════════════════════════════════════════════════
## PART 5 — PRIVACY, SECURITY, DATA
═══════════════════════════════════════════════════════════════════
  5.1  Audit every API endpoint. Does any return raw media, or more data than the
       caller's role requires? Produce docs/ENDPOINT_DATA_AUDIT.md — one row per
       endpoint: what it returns, which roles may call it, why that is minimal.
  5.2  Re-verify the on-device invariant: no endpoint accepts raw audio, video or
       frames for persistence. Strengthen the test if it only checks some paths.
  5.3  docs/DATA_INVENTORY.md — every field stored, why, retention period,
       deletion path. Include wearable and belt data.
  5.4  Implement patient data deletion — full withdrawal, actually deletes.
       Audit records are append-only and retained; clinical measurements are
       deleted. Document the distinction.
  5.5  docs/SECURITY.md — auth model, role matrix, CORS policy, secret handling,
       backup and recovery, incident-response outline.
  5.6  Verify offline sync ordering: sessions captured offline and synced late
       must land in the correct temporal order and must not corrupt a baseline.
       Test with deliberately out-of-order arrival.
  5.7  Generate an SBOM. Note any dependency with a known advisory.

═══════════════════════════════════════════════════════════════════
## PART 6 — UX AND SESSION FLOW COMPLETION
═══════════════════════════════════════════════════════════════════
  6.1  TASKSHELL RETRY LOOP — finish the unification flagged earlier. Quality
       failures currently flag but never re-prompt, so a bad capture silently
       becomes a low-quality data point instead of a second attempt. Implement:
       quality fail → clear explanation of what went wrong → retry (max 2) →
       then skip and mark low-quality. Every runnable task uses one code path.
  6.2  CAREGIVER REVIEW QUEUE UI — build it. Which events surface: ALERT,
       PATTERN_ATYPICAL, missed sessions, low-quality streaks, adherence drops.
       WATCH does NOT notify. No message may imply reassurance.
  6.3  AWAAZ LISTENER PAGE — the shareable no-install browser view showing live
       cleaned text plus one line of listener coaching. Backend exists; build UI.
  6.4  IDENTITY ENROLMENT — face and voice embedding capture during onboarding,
       matched per session to prevent proxy testing. Currently unbuilt.
  6.5  Instruction copy pass across every task: warmer, plainer, EN/HI/PA,
       written for a 70-year-old and their adult child. No clinical jargon in
       patient-facing text.
  6.6  Verify the session-type distinction is obvious in the UI — the patient
       must always know whether today is a short check-in or the longer one.

═══════════════════════════════════════════════════════════════════
## PART 7 — PHONE READINESS (prepare, since field test is pending)
═══════════════════════════════════════════════════════════════════
Nothing has run on a physical phone. Make the first real test maximally informative.

  7.1  Extend /diagnostics: FaceMesh init time and success rate, PoseLandmarker
       init and full-body detection rate, measured camera FPS with timing_source,
       WASM SIMD, available memory, browser/OS/device string, torch availability,
       storage quota. All copy-pasteable as JSON.
  7.2  Implement graceful degradation for every CV failure mode: no face detected,
       partial body in frame, too dark, too much motion blur, camera permission
       denied, model load failed. Each must produce a specific, actionable message
       — never a generic error, never a silent bad measurement.
  7.3  Capture device metadata on EVERY session: device, browser, OS, camera FPS,
       resolution, orientation. Without this we cannot interpret field results.
  7.4  Verify offline model loading truly works with the network disabled — this
       is the airplane-mode demo and it must be certain, not assumed.
  7.5  Write docs/PHONE_TEST_RESULTS.md as an empty structured template ready to
       fill in the field.

═══════════════════════════════════════════════════════════════════
## PART 8 — CLAIMS MATRIX (seed content)
═══════════════════════════════════════════════════════════════════
ALLOWED
  "Monitors neurological change over time"
  "Tracks post-stroke recovery against a personal baseline"
  "Builds a personal baseline"
  "Makes the time between hospital visits measurable"
  "Doctor-guided baseline, then longitudinal monitoring"
  "Phone-first, hardware-optional"
  "Designed for post-stroke follow-up"

NEEDS EVIDENCE (do not state until validated; label clearly if referenced)
  Any accuracy, sensitivity or specificity figure
  Any claim of agreement with clinical instruments
  Any claim about detection timing or lead time
  Any claim of outcome improvement or readmission reduction

PROHIBITED
  "Detects stroke" · "Predicts your next stroke"
  "Diagnoses Parkinson's" · "Diagnoses Bell's palsy"
  "Replaces a neurologist" · "Doctor-level diagnosis from your phone"
  "Clinically proven" for unvalidated components
  "Clinically equivalent to hospital equipment"
  Any synthetic-model metric presented as real-world accuracy
  Any regulatory-exemption claim

  8.1  Add a test that greps user-facing strings, docs and the built bundle for
       PROHIBITED phrases and fails the build.

═══════════════════════════════════════════════════════════════════
## PART 9 — COMPLETION CHECKLIST
═══════════════════════════════════════════════════════════════════
Technical work is complete when every line is true and verified against the
RUNNING system, not only in tests:

  [ ] No regulatory-exemption claim anywhere; INTENDED_USE.md frozen and quoted
  [ ] CLAIMS_MATRIX.md written; prohibited-phrase test passing
  [ ] DAILY_PULSE (~90s) and COMPREHENSIVE (6-12 min) both run end to end
  [ ] Scheduler tells the patient which session is due and how long it takes
  [ ] Baseline engine correct for mixed-cadence modules, explicitly tested
  [ ] Doctor onboarding with RMP fields; verification_status honestly shown
  [ ] Doctor-patient linking, consented and audited
  [ ] Baseline phase state machine; no alerts during IN_PROGRESS
  [ ] Clinician baseline review view with CONFIRM / EXTEND / FLAG_CONCERN
  [ ] Re-entry criteria implemented as an explicit list
  [ ] Six separate consents, independently withdrawable, enforced server-side
  [ ] Withdrawing clinician-sharing consent actually stops sharing (tested)
  [ ] ENDPOINT_DATA_AUDIT, DATA_INVENTORY, SECURITY docs written
  [ ] Patient data deletion works; audit retained, measurements deleted
  [ ] Offline sync ordering tested with out-of-order arrival
  [ ] TaskShell retry loop unified across every task
  [ ] Caregiver review queue live
  [ ] Awaaz listener page live
  [ ] Identity enrolment live
  [ ] Instruction copy pass complete in EN/HI/PA
  [ ] /diagnostics extended; device metadata on every session
  [ ] Every CV failure mode degrades with a specific message
  [ ] Offline model loading verified with network disabled
  [ ] All docs current; invariants pinned; suite green by exit code
  [ ] Deployed and verified on the live URLs

═══════════════════════════════════════════════════════════════════
## ORDER
═══════════════════════════════════════════════════════════════════
Part 1 first — the regulatory language is a live credibility risk and it is
cheap to fix. Then Part 2, because the product and the story currently disagree.
Then 3, 4, 5, 6, 7 in order. Deploy at the end and verify on the live URLs.

Report when Part 9 is green, split by live-verified vs test-verified, with every
near-miss written up.
