# NEUROTRACE — PRODUCT REQUIREMENTS DOCUMENT v2.0

## 1. PROBLEM
After an ischemic stroke, survivors go home and effectively disappear from clinical view.
A neurologist examines them once every 1-3 months for ~20 minutes. In between, nobody
measures anything. Post-stroke cognitive impairment affects 39-47%, aphasia/dysarthria
persists in ~60% past six months, and post-stroke depression affects 11-41% — all of
which progress silently and are noticed only when they become crises.

## 2. PRODUCT
NeuroTrace digitises the neurological follow-up examination and runs it DAILY at home,
on the patient's own phone, entirely on-device. It learns each patient's personal
baseline, then reports deviations from that baseline as observations to the family and
(in the hospital tier) to the treating clinician.

## 3. PATIENT SCOPE — LOCKED
IN SCOPE
  · Anterior-circulation ISCHEMIC stroke survivors (MCA territory; lacunar
    dysarthria-clumsy-hand syndrome)
  · >= 3 months post-discharge, clinically stable, living at home
  · Age 55-75, Tier-2/3 India, family caregiver available
  · Residual deficit in >=1 of: aphasia, dysarthria, central facial palsy, cognitive slowing

MONITORED CONDITIONS
  1. Post-stroke cognitive impairment            (39-47%)
  2. Aphasia / dysarthria trajectory             (~60% chronic)
  3. Post-stroke depression                      (11-41%)
  4. Secondary-prevention adherence              (BP, medication, rhythm)

EXPLICITLY OUT OF SCOPE — must be stated in onboarding and in-app
  ✗ Acute stroke of any kind (onset in seconds; our logic works over days)
  ✗ Posterior circulation strokes (~20-25% of ischemic)
  ✗ Hemorrhagic stroke (11-35% of Indian strokes)
  ✗ TIA, silent infarcts, pure motor / pure sensory lacunar strokes
  ✓ POSTERIOR-CIRCULATION and CEREBELLAR ischemic stroke survivors (added v2.2).
    20-25% of ischemic strokes, misdiagnosed 2-3x more often than anterior, served by
    nobody. Their deficits are vertigo, imbalance and oculomotor dysfunction - NOT the
    FAST picture. The index case (docs/CLINICAL_REFERENCE.md) had an MRI-confirmed left
    cerebellar infarct with entirely NORMAL finger-nose, heel-knee-shin,
    dysdiadochokinesia and joint-position: our M8 module would have found nothing.

  ✗ Patients with Parkinson's disease or another movement disorder (added v2.1).
    These degrade face, movement and voice symmetrically and simultaneously - the same
    combination our alert logic reads as deterioration - and they progress on their own
    course, so the personal baseline itself is moving. Enrolment is refused with an
    explanation, and this limit is stated in onboarding.

## 4. USERS
  PATIENT      55-75, post-stroke, low digital literacy, possibly aphasic.
               Needs: huge targets, audio instructions, no reading required, no scores shown.
  CAREGIVER    adult child, often in another city. The buyer. Needs: reassurance,
               trends, plain-language explanation, and to know when to act.
  CLINICIAN    (B2B tier) neurologist/physician. Needs: raw metrics, trends vs baseline,
               confounder annotations, audit trail. Retains ALL medical judgment.

## 5. THE TWO TIERS
See `docs/INTENDED_USE.md` for the frozen intended-use statement — quote it, do not
paraphrase it. This section summarises; that file is the source of truth.

  D2C — Home Recovery Companion
    Smartphone-first neurological follow-up for eligible post-stroke patients, with
    clinician involvement during baseline establishment and clinical escalation when
    required. Regulatory classification will be determined based on the final intended
    use under the CDSCO Medical Devices Rules framework (D-042).

  B2B — Clinical Continuity Platform
    Hospital and clinician-facing longitudinal monitoring and review workflow, with
    clinical decisions remaining with appropriately qualified healthcare professionals.
    Sold to hospitals. Clinician dashboard showing all discharged stroke patients ranked
    by sustained deviation. We measure and report; the clinician interprets and diagnoses.

Regulatory status: a formal CDSCO intended-use and risk-classification assessment under
the Medical Devices Rules framework is in progress. No exemption is claimed.

## 6. FUNCTIONAL REQUIREMENTS
FR1  Auth with roles patient | caregiver | clinician; caregiver creates patient profile.
FR1b Enrolment records pd_diagnosis and other_movement_disorder and BLOCKS enrolment if
     either is true, with a message explaining the validated scope.
FR2  Guided Daily Pulse session (~195s capture, 3-4 min wall-clock) with audio-delivered
     instructions, EN/HI/PA. Comprehensive Follow-up (~12 min) twice weekly — D-044.
FR3  All feature extraction runs on-device; raw media deleted after extraction.
FR4  Personal baseline: 14-21 days, >=3 sessions/week, first 3 sessions discarded,
     fixed time-of-day window, median+MAD statistics, per-module.
FR5  Change detection: Reliable Change Index + CUSUM + recovery-trajectory fit.
FR5b Posterior-circulation core modules (added v2.2): M3 oculomotor (saccade latency,
     velocity, precision per direction; pursuit gain and asymmetry) and M9
     craniocorpography (Romberg eyes open/closed, tandem stance, tandem walk,
     Unterberger; sway path in cm, sway area, angular deviation in degrees, lateral
     displacement, plus a clinical-format movement trace). Both WEEKLY, both in the new
     `posterior_vestibular` domain, which CARRIES LATERALITY.
FR5c Instruments (added v2.2): Dizziness Handicap Inventory (25 items, three subscales,
     0-100, bands 16-34 mild / 36-52 moderate / 54+ severe), monthly; and a vertigo
     attack log, caregiver-loggable at any time.
FR6  Three alert gates: persistence (>=2 consecutive sessions) AND cross-modality
     (>=2 independent domains) AND laterality (>=1 domain showing a one-sided change).
     Symmetric progressive change across face/motor/voice emits PATTERN_ATYPICAL instead
     of an alert. Confounder annotation on every score.
FR7  Identity verification (face + voice embedding match) to prevent proxy testing.
FR8  Capture-quality gating: bad captures are rejected and re-prompted, never scored.
FR9  On-device SLM generates plain-language explanation in Hindi/Punjabi/English.
FR10 Safety layer: FAST card every session, one-tap emergency, acute-symptom bypass.
FR11 Caregiver dashboard: band, explanation, per-domain trends, history, adherence.
FR12 Clinician dashboard: ranked patient list, per-domain sparklines, annotated alerts,
     PDF exam report, audit log.
FR13 Demo mode: instantly loads a seeded 21-day patient history for live pitching.

## 7. NON-FUNCTIONAL
  · Daily Pulse must complete in <=195s of capture on a ₹12,000 Android phone;
    Comprehensive Follow-up in <=12 min. (Was "<=90s" for an undifferentiated "full
    session" — a target the protocol never met, and ambiguous after the two-layer
    split. D-044, D-045.)
  · On-device inference must work with NO internet connection.
  · Privacy: no raw biometric media leaves the device. DPDP Act 2023 aligned.
  · Every clinical computation must be deterministic, reproducible (seed=42) and auditable.
  · Accessibility: audio instructions, icon-driven UI, high contrast, one-hand operation.

## 8. SUCCESS CRITERIA (demo acceptance)
  · Daily Pulse runs end-to-end on a phone, offline, in ~195s of capture.
  · Seeded stable week produces ZERO alerts.
  · Seeded decline produces exactly one ALERT, with a correct plain-language explanation
    naming the specific changed findings.
  · SLM explanation band always matches the deterministic engine's band (enforced by test).
  · Emergency path reachable from every screen in one tap.
