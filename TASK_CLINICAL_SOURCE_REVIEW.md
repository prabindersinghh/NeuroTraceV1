# TASK — CLINICAL SOURCE REVIEW + OPERATIONAL PRIORITIES

## PART 0 — PRIVACY: READ THIS BEFORE OPENING ANYTHING

Source images are at:  D:\neurotrace\real stroke report\   (22 .jpeg files)

This folder is OUTSIDE the repository. It stays outside.

ABSOLUTE RULES — no exceptions, no "temporarily":
  ✗ NEVER copy, move, or symlink these images into the repo
  ✗ NEVER commit them, stage them, or reference their absolute path in code
  ✗ NEVER write the patient's name, patient ID, hospital ID, accession number,
    IPID, referring physician name, hospital name, or any full date into ANY
    file, commit message, docstring, test fixture, log line, or report
  ✓ Read them in place, extract CLINICAL VALUES ONLY
  ✓ Month-and-year granularity maximum for dates ("January 2026", "August 2026")
  ✓ Refer to the source only as "anonymised reference patient, consented"

Before you finish: run the repo-wide identifier grep test (INV from
CLINICAL_AMENDMENT_v3 §7). If it does not exist yet, write it now and pin it.
It must fail the build on any forbidden identifier appearing anywhere.

Add to .gitignore, defensively:
  *stroke report*/
  *.jpeg
  *.jpg
(then verify no existing tracked file matches)

═══════════════════════════════════════════════════════════════════
## PART 1 — READ ALL 22 IMAGES
═══════════════════════════════════════════════════════════════════
Open and read every image. They are photographs of printed reports from a
tertiary hospital vestibular/neuro-otology unit, plus two MRI reports.

Expected content (verify — do not assume):
  · SUMMARY page — SVV, Craniocorpography, VNG, Saccade, Caloric, positional
  · CLINICAL EXAMINATION — general, neurological bedside tests, DHI scores
  · HISTORY — presenting symptoms, attack counts, progression, free-text note
  · SUBJECTIVE VISUAL VERTICAL — static + dynamic CW/ACW, T-1..T-6, averages
  · CRANIOCORPOGRAPHY — displacement, sway, angular deviation, body axis spin,
    exposure time, plus movement-trace plots
  · Spontaneous / gaze-induced / head-shaking / Valsalva / hyperventilation
    nystagmus pages, with per-eye SPV tables and waveform plots
  · SMOOTH PURSUIT — gain per cycle, per eye, per direction, frequency plot
  · RANDOM SACCADE HORIZONTAL — target movement, accepted saccades, latency,
    velocity, precision, per eye and per direction, with scatter plots
  · CALORIC — right/left warm and cool, SPV, canal paresis, fixation index
  · SKEW DEVIATION, POSITIONAL (Dix-Hallpike) pages
  · BRAIN MRI (plain) — full observations
  · CERVICAL SPINE MRI — full observations

═══════════════════════════════════════════════════════════════════
## PART 2 — BUILD docs/CLINICAL_REFERENCE.md
═══════════════════════════════════════════════════════════════════
Extract EVERY numeric value and every normal/abnormal classification.
Do not summarise — transcribe exhaustively. This is our only real-patient
calibration source and we will not get a second one before the pitch.

Structure the file as:

### A. Reference patient profile (anonymised)
   Age band, sex, region, stroke month/year, months since stroke at assessment,
   height, weight, BMI, BP lying/standing, pulse lying/standing.

### B. Imaging findings
   Brain MRI: every observation verbatim-in-substance (lesion locations,
   signal characteristics, sequences used, impression).
   Cervical spine MRI: same.
   Note explicitly which vascular territory each lesion belongs to.

### C. Every measured value — one table per instrument
   Columns: Test | Sub-measure | Value | Units | Normal/Abnormal | Notes
   Include the per-trial values (T-1..T-6), per-eye values, per-direction
   values, and the plot-derived observations where a number is not printed.

### D. Bedside neurological examination
   Every test, both sides, with result. Flag explicitly which were NORMAL —
   these matter as much as the abnormal ones (see Part 3).

### E. Symptom burden
   Vertigo attack count, attack duration, progression, hearing change per ear,
   tinnitus, headache, and the free-text clinical note (paraphrased, no identifiers).
   DHI physical / emotional / functional / total, with the banding scale.

### F. Calibration mapping table
   For EVERY clinical measure above, one row:
   Clinical measure | Instrument used | Value | Our module | Our digital
   equivalent feature | Can we approximate it? (YES / PARTIAL / NO) | Why
   Be brutally honest in the last two columns. Caloric irrigation and
   Dix-Hallpike cannot be done on a phone. Say NO and say why.

### G. Validation checklist
   For each measure marked YES or PARTIAL: what output range would we expect
   our digital version to produce for a patient like this, and how would we
   know if we were wrong?

═══════════════════════════════════════════════════════════════════
## PART 3 — GAP ANALYSIS AGAINST WHAT WE ACTUALLY BUILT
═══════════════════════════════════════════════════════════════════
This is the point of the exercise. Produce docs/GAP_ANALYSIS.md answering:

3.1  Which measured abnormalities in this patient would our CURRENT
     implementation detect? Name the module and feature for each.

3.2  Which would we MISS ENTIRELY? For each miss: is it a gap we should
     close, or correctly out of scope? Justify.

3.3  THE FALSE-NEGATIVE CHECK — most important.
     Every classic cerebellar bedside test was NORMAL in this patient:
     finger-nose, heel-knee-shin, dysdiadochokinesia, joint-position.
     Yet he had 60 vertigo attacks, worsening unsteadiness, abnormal
     Unterberger sway, and abnormal saccade latency AND velocity.
     Run our M8 coordination module's logic against this profile.
     Confirm mechanically that M8 alone returns no finding, and that
     posterior_vestibular + vertigo burden is what actually fires.
     If our test fixture does not already model this exactly, correct it
     against the real values.

3.4  Are our calibration targets correct? Compare every value now extracted
     against what is currently in the codebase and in the amendment.
     I transcribed these by eye from photographs — assume I made errors and
     correct them. List every discrepancy you find.

3.5  What NEW modules or features do these reports suggest that we have
     not considered at all? Candidates to evaluate honestly:
       · Subjective Visual Vertical — dynamic CW was abnormal. A phone can
         render a rotating line and ask the patient to set it upright.
         Is this feasible? What would it measure?
       · Fixation suppression / fixation index
       · Head-shaking induced symptoms (patient-performed, NOT head impulse)
       · Positional symptom reporting (patient-reported, NOT Dix-Hallpike —
         we do not perform provocative manoeuvres unsupervised)
       · Postural BP (lying vs standing) — we have both values here; orthostatic
         drop is a fall-risk and vertigo contributor
       · Vibration sense — toe-vibration was ABNORMAL bilaterally. Can a phone's
         haptic motor deliver a graded vibration threshold test?
     For each: feasibility, clinical value, risk, and your recommendation.
     Do NOT build any of these yet. Recommend only.

═══════════════════════════════════════════════════════════════════
## PART 4 — OPERATIONAL PRIORITIES (do these in order, after Parts 1-3)
═══════════════════════════════════════════════════════════════════
P1  FIX TEST-DB CONTENTION FIRST.
    Per-process test DB path in conftest. You have hit this three times and
    the registry hook will make it worse — a guard that emits spurious
    failures gets switched off, which defeats its purpose. Fix before the
    hook goes live.

P2  LOAD AND VERIFY THE REGISTRY HOOK.
    Tell me exactly what I must do (open /hooks, restart, other) and confirm
    it is live afterwards with a fresh both-directions proof.

P3  DEPLOY. Railway + Neon. Seeded 21-day demo reproducing on a public URL.
    Numbered checklist, the URLs, and verification that the demo produces
    the same SSSS…WAA → ALERT sequence on the deployed instance as locally.
    This is currently our single largest risk: everything works on one
    machine and nowhere else.

P4  DATASET ACCESS REQUESTS. UASpeech and TORGO. You flagged weeks of lead
    time and I have not seen the forms. Give me the exact URL/email, what
    I must supply, and who signs. This is calendar time, not build time.

═══════════════════════════════════════════════════════════════════
## PART 5 — REPORT
═══════════════════════════════════════════════════════════════════
Per working discipline, split explicitly:
  · What was verified against the RUNNING system
  · What was verified only in TESTS
  · What is pending
  · What I must check by hand
Plus: every discrepancy found in 3.4, and any near-miss.

Update PROGRESS.md, CHANGELOG.md, DECISIONS.md.
Confirm in PROGRESS.md that CLINICAL_AMENDMENT_v3 is ALREADY IMPLEMENTED,
so nobody re-executes it.

Parts 1-3 are analysis and documentation — no structural code changes, so no
PLAN gate. If anything in Part 3 implies a structural change, write the PLAN
and WAIT rather than building it.
