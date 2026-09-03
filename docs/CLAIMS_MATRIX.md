# CLAIMS MATRIX

Every public-facing sentence about NeuroTrace falls into exactly one bucket. When writing
copy — landing page, pitch deck, doctor-facing material, app store listing, a tweet — check
here first. When in doubt, treat a new claim as NEEDS EVIDENCE until it is added here
explicitly; do not assume ALLOWED by default.

`backend/tests/test_regulatory_claims.py` enforces the PROHIBITED list mechanically (it
greps user-facing source, docs, and — where the build exists — the shipped bundle). The
ALLOWED and NEEDS EVIDENCE lists are judgment calls this file records; they are not
currently machine-checked, because a good claim can be phrased many honest ways and a
substring test would either miss rewordings or false-positive on the word "monitor" itself.

Source: `docs/archive/TASK_FINAL_TECHNICAL_COMPLETION.md` Part 8, seeded verbatim, extended where this
session found a gap. See `docs/INTENDED_USE.md` for the regulatory-status wording this
matrix assumes.

---

## ALLOWED

Say these freely. They describe what the system verifiably does.

- "Monitors neurological change over time"
- "Tracks post-stroke recovery against a personal baseline"
- "Builds a personal baseline"
- "Makes the time between hospital visits measurable"
- "Doctor-guided baseline, then longitudinal monitoring"
- "Phone-first, hardware-optional"
- "Designed for post-stroke follow-up"

## NEEDS EVIDENCE

Do not state until validated against real (non-synthetic) data and a stated methodology. If
referenced before then — in a pitch, a demo caveat, anywhere — it must be labelled as
unvalidated in the same sentence, not in a footnote.

- Any accuracy, sensitivity or specificity figure
- Any claim of agreement with clinical instruments (NIHSS, DHI, PHQ-2 concordance, etc.)
- Any claim about detection timing or lead time ("catches decline N days sooner")
- Any claim of outcome improvement or readmission reduction

`docs/ML_STATUS.md` is the live record of which components are synthetic today. A claim
cannot graduate out of NEEDS EVIDENCE by this matrix alone — it also needs ML_STATUS to say
the underlying model is real-data-trained, not synthetic.

## PROHIBITED

Never state these, in any language, in any surface — marketing, in-app, pitch, generated
text. Several of these are already enforced at the engine level for generated clinical
language (`backend/app/safety/guards.py`, `DIAGNOSTIC_TERMS` / `WELLNESS_ASSERTIONS`); this
list is broader — it also covers marketing and pitch copy the safety guardrail never sees.

- "Detects stroke" · "Predicts your next stroke"
- "Diagnoses Parkinson's" · "Diagnoses Bell's palsy"
- "Replaces a neurologist" · "Doctor-level diagnosis from your phone"
- "Clinically proven" for any unvalidated component
- "Clinically equivalent to hospital equipment"
- Any synthetic-model metric presented as real-world accuracy
- **Any regulatory-exemption claim** — "outside CDSCO", "not a medical device" as a
  classification conclusion, "wellness software" as a framing chosen to avoid regulation,
  "exempt", or a specific risk class (A/B/C/D) asserted without a completed CDSCO
  assessment. See `docs/INTENDED_USE.md` for why this specific one is a live risk, not a
  hypothetical one — it was in the repo until this session.

### A note on what PROHIBITED does not forbid

The exam's own safety disclaimers — "it cannot detect a stroke happening now, call 108
first" — are not regulatory claims and are not affected by this list. They are functional,
safety-critical statements about what the engine observes (change over days) versus what it
cannot (an acute event in progress), and removing them would make the product more
dangerous, not more compliant. The distinction this matrix draws is between describing a
real functional limitation (keep, everywhere, verbatim) and asserting a regulatory
conclusion the project has not earned (never).

---

## Maintenance

Adding a new public-facing claim:
1. Check ALLOWED first — if it is a rewording of something already there, use the existing
   wording instead of adding a near-duplicate.
2. If it is genuinely new and unvalidated, it goes in NEEDS EVIDENCE, not ALLOWED, even if
   you are confident it is true. Confidence is not evidence.
3. If it resembles anything in PROHIBITED even loosely, do not use it — ask whether the
   underlying fact can be stated more narrowly (a specific number instead of "clinically
   proven"; "flags a pattern for clinician review" instead of "diagnoses").
