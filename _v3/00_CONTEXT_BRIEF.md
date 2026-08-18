# NEUROTRACE — CONTEXT BRIEF FOR CLAUDE CODE
Read this FIRST. It explains what we're building, for whom, and what constraints are non-negotiable.

## THE SITUATION
Team NeuroTrace (Deepesh Kakkar, Prabinder Singh, Anish Grover — Thapar Institute, Patiala)
is in the TOP 40 of Samsung Solve for Tomorrow India 2026, Health & Education theme.
10 teams in our theme. 5 advance to Top 20. Exactly 1 wins the theme.
Innovation Bootcamp at IIT Delhi Aug 30 - Sep 10. National Pitch Sep 7.

## HOW WE ARE JUDGED (drives every build decision)
  Impact        40%   → the product must visibly help a real person
  Feasibility   30%   → it must actually run, live, on a phone
  Creativity    20%   → technical novelty (on-device multimodal neuro exam)
  Presentation  10%   → the demo must be legible in 60 seconds
Samsung states prototypes earn BONUS points across Feasibility, Creativity,
Impact AND Presentation. A working live demo is the single highest-leverage artifact.
Judges are Samsung R&D engineers (SRI-Bangalore CTO, SRI MDs) + IIT Delhi faculty.
They reward engineering depth and honest limits. They punish overclaiming.

## WHAT WON LAST YEAR IN OUR EXACT THEME
Paraspeak (dysarthric speech device, won Health 2025, later won ₹15L YUVAi national award):
  · on-device / edge processing
  · self-built Indian-language clinical dataset (1,407 samples, 28 patients)
  · ONE-BUTTON LIVE DEMO with an unmistakable "it works" moment
  · honest metrics (published its word error rate)
  · low unit cost, deployable in Bharat
We copy this formula exactly.

## SAMSUNG STRATEGIC FIT (say this in the pitch, build it in the product)
Samsung launched "Brain Health" at CES 2026: detects cognitive decline from VOICE,
GAIT and SLEEP, processed ON-DEVICE via Knox, and Samsung's digital health VP stated
the goal is "NOT TO DIAGNOSE" but to prompt medical follow-up.
NeuroTrace is the same posture, same modalities, same privacy model — for stroke.
Therefore: on-device processing is not a nice-to-have. It IS the pitch.

## NON-NEGOTIABLE CONSTRAINTS
1. ON-DEVICE FIRST. Raw audio/video/frames must never leave the phone. Only derived
   features and scores sync. Show a visible "processed on this device" indicator.
2. SCREENING, NOT DIAGNOSIS. The word "stroke" never appears in a user-facing output.
   Outputs are observations ("speech sounded different from usual"), never diagnoses.
3. SAFETY LAYER IS UNCONDITIONAL. FAST card + one-tap emergency on every session.
   Acute symptom report bypasses ALL AI logic. Never display "you are fine".
4. DETERMINISTIC CLINICAL LOGIC. The SLM writes text only. It never computes a score,
   sets a threshold, or triggers an alert. This must be enforced by a test.
5. DEMO-ABILITY IS A FEATURE. Every phase must end in something demonstrable on a phone.

## WHAT WE ARE BUILDING (one line)
A digital replication of the neurologist's post-stroke follow-up examination,
performed daily at home on a phone, entirely on-device, with per-patient baselines.
