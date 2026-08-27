# INTENDED USE

**This is the frozen source of truth.** Every other document, every UI string, every pitch
deck slide that describes what NeuroTrace is or what tier it belongs to must quote this
file verbatim. Paraphrasing it is how drift happens — see D-042 for why this file exists.

Last frozen: 2026-08-24. Changing it requires a DECISIONS.md entry explaining what changed
and why, not a silent edit.

---

## The claim, exactly as stated

> **D2C — Home Recovery Companion:** smartphone-first neurological follow-up for eligible
> post-stroke patients, with clinician involvement during baseline establishment and
> clinical escalation when required. Regulatory classification will be determined based on
> the final intended use under the CDSCO Medical Devices Rules framework.
>
> **B2B — Clinical Continuity Platform:** hospital and clinician-facing longitudinal
> monitoring and review workflow, with clinical decisions remaining with appropriately
> qualified healthcare professionals.
>
> **Regulatory status:** A formal CDSCO intended-use and risk-classification assessment
> under the Medical Devices Rules framework is in progress. No exemption is claimed.

---

## Why the previous wording was wrong, and must not come back

The repo previously stated, in several places: *"D2C — Recovery Companion — Outside CDSCO
device classification."* That sentence asserted a regulatory conclusion the project has no
basis for, and it was wrong on the specific mechanism it relied on.

CDSCO published final Medical Device Software guidance on 21 July 2026. Under the Medical
Devices Rules 2017 framework, software can itself be a medical device when its intended use
includes monitoring of disease, disorder, injury or physiological processes. **Classification
follows intended use, not business model.** Calling a product "outside CDSCO" because it is
sold direct-to-consumer, rather than because of what it is claimed to do, is not a
defensible position — and this product's stated purpose is monitoring neurological change
in identified post-stroke patients, which sits much closer to Software as a Medical Device
than to general wellness software.

The wrong framing was not cosmetic. It appeared in the docstring rationale for the
diagnostic-language guardrail (`backend/app/safety/guards.py`) as *"turns a wellness
companion into an unregistered medical device"* — implying that avoiding certain words is
what keeps the product unregulated. It is not. The guardrail itself was always correct (do
not make diagnostic claims the system cannot support); the stated REASON for it was wrong,
and has been corrected without changing the guardrail's behaviour.

## What this means operationally, right now

- No file, screen, or generated string may claim the product is exempt from, or outside,
  medical-device classification. `backend/tests/test_regulatory_claims.py` greps the
  repository for the forbidden phrasing and fails the build if it reappears.
- User-facing safety disclaimers (*"it cannot detect a stroke happening now — call 108"*)
  are unaffected and unchanged. Those are functional truths about what the engine does and
  does not observe, not regulatory self-classifications, and they stay exactly as they were.
- "D2C" and "B2B" remain the internal tier names — those labels are not the problem, the
  claim attached to them was.
- Nothing about the product's actual behaviour changes because of this document. The engine
  does not diagnose, has never diagnosed, and this file does not ask it to. What changes is
  that the project stops asserting a regulatory conclusion it has not earned.

See `docs/CLAIMS_MATRIX.md` for the full allowed / needs-evidence / prohibited breakdown of
every public-facing claim, and D-042 in `docs/DECISIONS.md` for the decision record.
