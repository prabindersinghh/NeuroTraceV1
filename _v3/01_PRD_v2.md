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

## 4. USERS
  PATIENT      55-75, post-stroke, low digital literacy, possibly aphasic.
               Needs: huge targets, audio instructions, no reading required, no scores shown.
  CAREGIVER    adult child, often in another city. The buyer. Needs: reassurance,
               trends, plain-language explanation, and to know when to act.
  CLINICIAN    (B2B tier) neurologist/physician. Needs: raw metrics, trends vs baseline,
               confounder annotations, audit trail. Retains ALL medical judgment.

## 5. THE TWO TIERS
  D2C — "Recovery Companion"
    Wellness and adherence companion. Fully on-device. Non-diagnostic language only.
    Outputs observations and trends for the family to raise with their doctor.
    Positioned outside medical-device classification.

  B2B — "Clinical Continuity Platform"
    Sold to hospitals. Clinician dashboard showing all discharged stroke patients ranked
    by sustained deviation. We measure and report; the clinician interprets and diagnoses.
    Decision-support under clinician oversight.

## 6. FUNCTIONAL REQUIREMENTS
FR1  Auth with roles patient | caregiver | clinician; caregiver creates patient profile.
FR2  Guided daily exam session (~90s) with audio-delivered instructions, EN/HI/PA.
FR3  All feature extraction runs on-device; raw media deleted after extraction.
FR4  Personal baseline: 14-21 days, >=3 sessions/week, first 3 sessions discarded,
     fixed time-of-day window, median+MAD statistics, per-module.
FR5  Change detection: Reliable Change Index + CUSUM + recovery-trajectory fit.
FR6  Two alert gates: persistence (>=2 consecutive sessions) AND cross-modality
     (>=2 independent domains). Confounder annotation on every alert.
FR7  Identity verification (face + voice embedding match) to prevent proxy testing.
FR8  Capture-quality gating: bad captures are rejected and re-prompted, never scored.
FR9  On-device SLM generates plain-language explanation in Hindi/Punjabi/English.
FR10 Safety layer: FAST card every session, one-tap emergency, acute-symptom bypass.
FR11 Caregiver dashboard: band, explanation, per-domain trends, history, adherence.
FR12 Clinician dashboard: ranked patient list, per-domain sparklines, annotated alerts,
     PDF exam report, audit log.
FR13 Demo mode: instantly loads a seeded 21-day patient history for live pitching.

## 7. NON-FUNCTIONAL
  · Full session must complete in <=90s on a ₹12,000 Android phone.
  · On-device inference must work with NO internet connection.
  · Privacy: no raw biometric media leaves the device. DPDP Act 2023 aligned.
  · Every clinical computation must be deterministic, reproducible (seed=42) and auditable.
  · Accessibility: audio instructions, icon-driven UI, high contrast, one-hand operation.

## 8. SUCCESS CRITERIA (demo acceptance)
  · Complete exam runs end-to-end on a phone, offline, in under 90 seconds.
  · Seeded stable week produces ZERO alerts.
  · Seeded decline produces exactly one ALERT, with a correct plain-language explanation
    naming the specific changed findings.
  · SLM explanation band always matches the deterministic engine's band (enforced by test).
  · Emergency path reachable from every screen in one tap.
