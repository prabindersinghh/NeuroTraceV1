# PLAN — clinically-recommended new modules (A3, plan-only)

**Status: PLAN ONLY. Nothing in this document has been built.** These items touch
`backend/app/exam/registry.py`, which is structural — every module carries a declared tier
placement (INV-10) and a fixed position that other modules' fatigue-curve placement depends
on (INV-14, D-027). Adding or resizing a module is not a local change; it can shift where
every module after it sits in the protocol. The project rule is PLAN-first for anything
touching `registry.py`, and this run is explicitly scoped to plan, not implement, these five.

Source: `docs/GAP_ANALYSIS.md` §3.5, which evaluated these against one reference patient's
actual records and is the clinical grounding for every recommendation below. This plan adds
the *how*, not new clinical judgement — GAP_ANALYSIS's verdicts are carried forward unchanged.

---

## Recommended order (unchanged from GAP_ANALYSIS §3.5)

### 1 · Positional symptom questions — trivial, build first
**What.** Two questions appended to the existing vertigo log: which positions bring on the
symptom — rolling over, lying down, looking up. Not Dix-Hallpike; a self-report distinguishing
positional from spontaneous vertigo, which GAP_ANALYSIS calls "the single most useful triage
split in dizziness."

**How.** No new module, no registry change. This is a schema addition to whatever table
already backs the vertigo log (`questionnaires` or a dedicated symptom-log table — confirm
which at implementation time) plus two new fields on the existing caregiver-loggable form.
Caregiver-loggable, so no on-device capture and no tier gating.

**Risk.** None. **Blast radius.** One table, one form. This is the only item in this plan
simple enough that a future session could reasonably implement it without a fresh PLAN
review — but it still touches patient-facing copy in three languages (EN/HI/PA) and must not
be built without that.

### 2 · Hearing-change self-report — HALF-BUILT, verified this run, not completed here
**Verified, not assumed:** `backend/app/exam/questionnaires.py:262-319` fully implements
`HEARING` — a three-option-per-ear question (better/same/worse), scored with an
`asymmetric`/`worse_ears` breakdown, registered in `SCORERS["HEARING"]`, with a clinical
rationale docstring (AICA shared blood supply between the labyrinth and posterior
circulation) already citing v3 E3 and the reference patient's bilateral, audiometry-confirmed
hearing loss. So the *scoring logic* is genuinely complete, not a stub.

**But it is not reachable by a patient or caregiver.** `grep`ing for `HEARING` across
`backend/app/exam/session_plan.py`, `backend/app/scheduler.py`,
`backend/app/services/scheduler.py`, and `backend/app/exam/registry.py` returns nothing —
unlike DHI, which has the same shape of question but IS scheduled and has a dedicated
frontend form (`frontend/src/components/DhiForm.tsx`). A `grep` across `frontend/src` for
`HEARING` also returns nothing. So today, no session ever asks the question, no
`questionnaires` row of instrument `HEARING` can ever be written, and the scorer has never
run against real input.

**Correction this run makes:** `GAP_ANALYSIS.md` §3.5 item 7 says "RECOMMEND (already
specified as v3 E3, not built)" — that framing undersells what exists (the scoring logic IS
built) and oversells what's missing (it needs scheduling + a form, not a new instrument
design). This plan corrects the record; `GAP_ANALYSIS.md` itself is left untouched per this
run's scope (it's a source document, not a status tracker — `docs/PROGRESS.md` is).

**What finishing it needs — NOT built in this run, deliberately:** a scheduler entry
(monthly cadence per v3 E3, following whatever pattern schedules DHI) and a frontend form
mirroring `DhiForm.tsx`'s shape for a two-radio-per-ear question. This is smaller than the
other four items — it does not touch `registry.py` or fatigue-curve placement, since
questionnaires are not timed exam-protocol steps — but it is still new patient-facing
surface in three languages, and this run's scope is Part 3.7 + Parts 4-8 + beautification,
not new question surfaces. Flagged for the owner's priority call, not built unattended.

### 3 · Subjective Visual Vertical (SVV) as a fuller module — highest value, needs the most care
**What.** GAP_ANALYSIS: "Dynamic clockwise was one of only three abnormalities in the entire
battery, with a striking monotonic rise (3.5→17.5°)." A phone renders a line, the patient
rotates it to upright, the error is recorded. Static SVV needs a dark room and a tilted line;
dynamic needs a rotating background. Highest measurement value of the five, and the only one
that is a genuinely new capability rather than a bigger version of something derivable today.

**Why this is the hard one.** M21 already exists in the registry with SVV variants noted (see
`docs/DECISIONS.md` D-045: "M21 has its dynamic SVV variants" as part of the honest-timing
correction). This item is *expanding* M21, not creating a module from nothing — which is
actually higher risk, not lower: M21 already has a position in the protocol and a declared
tier placement; expanding its task set changes its own duration (shifting every module after
it on the fatigue curve, per INV-14) and may change which tier can run it (a rotating
background needs a screen large/bright enough to matter, which interacts with
`TIER_CAPABILITIES` in `registry.py:530`).

**What the plan must specify at build time** (not decided here — this is the checklist the
PLAN-first session must resolve):
- New domain question(s): does dynamic SVV corroborate laterality on its own, or only within
  `posterior_vestibular` alongside M3/M9 (current doc: "Its laterality comes primarily from M3
  saccade asymmetry" — `docs/ARCHITECTURE.md` §5). SVV's role in the three-gate laterality
  test needs an explicit answer, not an inferred one.
- A stop control for the rotating background — GAP_ANALYSIS flags mild nausea risk. This is a
  patient-facing safety affordance (visible pause, non-invalidating — same rule as every other
  task) and must be specified before build, not added after.
- Tier gating: can TIER_1_PHONE actually render a rotating field at sufficient size/contrast,
  or is this TIER_2/3 only? `tasks_for_tier` (`registry.py:583`) is the mechanism; the answer
  changes what a TIER_1 patient's monthly battery contains.
- Duration impact on `DAILY_BUDGET_SECONDS` / the comprehensive protocol total, and whether
  M21's new duration needs the same registry-vs-session_plan reconciliation D-044/D-045 did.

**Recommend:** build after item 5 below (CCG), not before, despite being individually higher
value — because item 5 requires zero new UI (see below) and will surface any remaining
registry/session_plan reconciliation issues cheaply before this heavier item touches the same
files.

### 4 · Postural BP at TIER_2/3 only — recommend on general grounds, not on this patient's evidence
**What.** A cuff reading pre/post standing. TIER_3 already has a cuff (asha_worker deployment).

**Explicit honesty note, carried forward from GAP_ANALYSIS and repeated here so it is not
lost in translation to a future build:** the reference patient this analysis is grounded in
showed **no orthostatic drop** — BP rose on standing, pulse was flat. This module is
recommended on general clinical grounds (orthostatic hypotension is a real fall-risk and
vertigo contributor in the broader population), explicitly **not** because the evidence base
behind this plan supports it. Any future PR description or demo claim must not imply this
patient's data motivated postural BP — that would misrepresent the evidence.

**How.** New module or new task on an existing vitals module (`vitals_prevention` domain —
`docs/ARCHITECTURE.md` §5), gated to `TIER_2_WATCH`/`TIER_3_ASHA` only via
`TIER_CAPABILITIES`. TIER_1_PHONE has no cuff and must not attempt this — a phone cannot
measure BP.

### 5 · CCG displacement + exposure time — already derivable, cheapest of the five
**What.** Craniocorpography (M9) displacement and exposure-time metrics, computed from a
trace the app already captures (per GAP_ANALYSIS: "already derivable from the captured
trace"). This is the one item on the list that may not need a new capture UI at all — it may
be a feature-extraction addition on data already flowing from M9.

**Why last isn't right — recommend building this first among the SVV/CCG pair.** Because it
needs no new UI and no new consent/tier surface, it is the lowest-risk place to prove the
registry-change discipline (declare tier placement, re-run INV-14's fatigue-curve test, re-run
the registry-vs-session_plan timing reconciliation) still holds cleanly, before spending that
same discipline on SVV's larger surface. Recommend: 1 → 2(verify) → 5 → 3 → 4.

---

## Explicitly DO-NOT-BUILD (carried forward so nobody revisits them blind)

**Fixation suppression / fixation index.** Computed from a caloric response; without the
caloric irrigation there is nothing to suppress. A "fixation test" without the stimulus would
be a different measurement wearing the same name — not a smaller version of the real test, a
mislabelled one. Do not build a fixation-index task under any framing that skips irrigation.

**Head-shaking, patient-performed.** The clinical value is in the nystagmus *afterwards*,
which needs VNG goggles this product does not have and will not have. What would remain is
asking an unsteady 82-year-old to shake their head — provocative, unsupervised, and it
measures nothing capturable. The relevant symptom question ("does turning your head quickly
bring it on?") already exists inside the DHI questionnaire; that is the correct-sized version
of this idea and needs no new module.

**Vibration sense via phone haptics.** A clinical test uses a 128 Hz tuning fork against bone
with graded, calibrated amplitude. Phone haptic motors vary by handset generation, are not
amplitude-calibrated, and the foot cannot be coupled to the phone the way a fork couples to
the malleolus — a phone-haptics version would produce a number that tracks the handset model
more than the patient. **Additional confound specific to this project's evidence base:** the
reference patient's C5–6 canal measures 8.9 mm with multilevel spondylosis; bilateral
"abnormal" vibration sense in an 83-year-old with cervical stenosis is at least as plausible
as a dorsal-column/cervical finding as a posterior-circulation one. Building this would risk
misattributing a cervical finding to the stroke the product exists to monitor. Revisit only
if a calibrated external actuator becomes available — never with the bare phone motor.

---

## What this run did

Verified item 2 (hearing self-report) has backend references (`questionnaires.py`,
`listener.py`) confirming the earlier "not built" note in GAP_ANALYSIS is stale in at least
one direction — see the Build report's Part 8 / doc-drift section for the precise verification
result and whatever correction that implies for `GAP_ANALYSIS.md` itself. No code in
`registry.py` was touched. No new module was added.
