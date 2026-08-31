# Awaaz offline policy evaluation

**Status:** offline-only. The production logging contract now exists and has never been
written to. `awaaz_policy_events` and its two endpoints can record real candidate-ranking
decisions, but nothing calls them: the frontend confirmation loop must still mint event ids
and report outcomes. No real product event has ever been logged, no policy is authorised for
anything, and the executable path remains synthetic.

The safe optimisation surface is candidate **ranking** among options already produced and
safety-screened elsewhere. It cannot generate words, alter confirmation, trigger speech,
touch an emergency flow, make a clinical claim, or explore on a patient.

Calling the current code “reinforcement learning” without this qualification would be
misleading. It is logged-feedback scoring plus conservative offline contextual-policy
comparison. It is also not online learning in any form: nothing reads a logged row at
runtime, no model is fitted from one, and no ranking adapts from feedback. The behaviour
policy's distribution is a fixed function of scores the ranker already produced.

The production schema used to record no slate, policy version, logged action probability, or
explicit outcome, which made every product event ineligible. `awaaz_policy_events` closes
that gap in the schema. It does not close it in practice, because no row has been written.

## Executable simulation

From `backend/`:

```bash
.venv/bin/python -m app.ml.rl.simulate --events 60 --seed 42
```

The output is marked `synthetic: true`, `model_trained: false`, and
`patient_data_used: false`. `deployment_allowed`, `online_experiment_allowed`, and
`clinical_claim_allowed` are read-only properties on `OfflineComparison` that always return
false — they are not fields, so no caller and no `dataclasses.replace` can set them, and a
forged result object cannot emit a document that appears to grant deployment.

The simulated behaviour policy genuinely randomises: it samples which candidate it logs and
records the probability of the action it actually logged. On `--events 60 --seed 42` it
currently returns `candidate_better_offline` with a delta of ≈0.78 and a 95% interval of
≈[0.64, 0.88] over synthetic events. That is a statement about a made-up log and nothing
else.

## Production logging (AWA-FR-014)

`awaaz_policy_events` is append-only, one row per candidate-ranking decision, and holds: the
opaque event id the client minted, which is also the idempotency key; the behaviour policy id;
the full offered slate as opaque ids in rank order; the logged action; the probability the
policy assigned to **the action it actually logged**; the top-ranked action; a `randomised`
flag; the coarse speech profile; the three INV-9 confirmation booleans; the emergency flag;
the feedback actor; the outcome enum (`selected` / `rejected` / `corrected` /
`phrase_board_fallback` / `no_explicit_signal`); the selected and rejected actions; and
`logged_on` as a DATE.

There is no patient column and no foreign key of any kind, which is the point of the table
and not an omission (D-062). The cost has to be stated with it: no patient-level split before
fitting is possible from this log, so the repeated-speaker dependence below stays unaddressed,
and cohort or subgroup work on this table cannot be done at all. `logged_on` is a day rather
than a timestamp because a microsecond timestamp would join effectively one-to-one onto
`audit_log.ts` and `utterance_log.ts`, both of which carry `patient_id`, handing back the
identifier the table exists without. The audit rows the router writes omit the event id and
every candidate id for the same reason.

Two endpoints write it — a decision endpoint that draws and remembers the propensity, and an
outcome endpoint that closes it. The decision endpoint refuses without a purpose-specific
`policy_logging_consent` per PRD §10.2; the outcome endpoint carries no consent field of its
own because it can only close a decision that already passed that check. Both are idempotent
in either direction. The sampled decision waits in process memory
between the two calls, so the outcome is known before the single INSERT; a restart drops
pending decisions and those events are simply never logged.

`no_explicit_signal` rows are recorded rather than dropped, because a log that only exists
when the patient reacted is a sample selected on the outcome. They carry no reward and cannot
become feedback — inactivity is not a preference — so the exporter skips them, and **the skip
rate is a number a reviewer must inspect before believing any estimate**.

The migration's revision id is `0014_awaaz_policy_events` rather than `0014`, because `main`
already carries a different migration claiming revision `0014` and the two branches have
independently used 0012, 0013 and 0014 for unrelated changes. Two revisions sharing an id do
not merge. **This is an open merge hazard**, recorded rather than resolved.

## Bounded randomisation

IPS and SNIPS are unidentifiable under a deterministic logger, so a product that never
randomises can never be evaluated no matter how good the estimator is. The ranker therefore
samples which near-tied candidate it shows first, and the server — never the client — records
the probability of the action it showed. Three bounds, each doing separate work (D-063):

1. **Near-tie only.** A candidate is explorable only if its score is within `NEAR_TIE_MARGIN`
   (0.05) of the best. A clearly-better candidate is never displaced, because a worse one is
   assigned probability zero and cannot be drawn.
2. **The top stays modal by a wide margin.** At most two alternatives at a flat
   `EXPLORATION_EPSILON` of 0.08 each; the top keeps the remainder, at least 0.84, and
   `ExplorationBound` refuses any configuration leaving it below 0.75. Flat-per-alternative
   rather than epsilon-split-k, because a split shrinks as the slate grows and would push
   propensities under `MIN_LOGGED_PROBABILITY_FLOOR`.
3. **Confirmation path only.** The decision endpoint refuses to randomise a slate that is not
   declared as going to the confirmation loop. Reordering options a person reads and taps is
   a presentation change they override; reordering something spoken without confirmation
   would be exploration on a disabled person's mouth, which INV-9 forbids. The emergency flow
   is never ranked and never reaches this code.

**Watch from day one:** `max_deterministic_event_rate` defaults to 0.10. If the real ranker
produces a clear winner — nothing within 0.05 of the top — for more than a tenth of slates,
the whole log is refused as deterministic and yields nothing. Nobody has measured how often
Awaaz slates are near-tied, and that measurement should be the first thing read off the log.

## Logged contract

An eligible event contains only:

- opaque event and candidate UUIDs;
- behaviour-policy version and the probability the behaviour policy assigned to **the action
  it actually logged** — π₀(logged_action | context), not the top-ranked action's score;
- optionally the action the ranker placed first, so a re-rank, tie-break, or fallback is
  declarable. A record that names a different top-ranked action while claiming a logged
  probability above 0.5 is arithmetically impossible and is rejected by the contract, which
  is the only point at which that mis-specification is still visible;
- confirmation/speech/emergency booleans and the existing speech-profile enum;
- an explicit patient selection, rejection, correction, or phrase-board fallback.

It contains no patient ID, transcript, candidate text, audio, filename, latency, pause
length, tap speed, session duration, or clinical outcome. Silence and inactivity are not
interpreted as preference. Caregiver corrections may support a separately governed ASR
label workflow but are not the patient's reward signal.

## Estimation and hard gates

The comparison reports IPS as a diagnostic and uses self-normalised inverse propensity
scoring (SNIPS) for the estimate. SNIPS is the headline structurally, not by convention:
`headline_estimator` is a read-only property returning `snips`, so no caller can promote
anything else. It blocks on insufficient events, missing/mismatched
candidate sets, duplicate events, weak overlap, low effective sample size, extreme weights,
invalid propensities, insufficient bootstrap support, or any safety-ineligible event.

**A logging policy that did not randomise is refused.** If more than
`max_deterministic_event_rate` (default 10%) of events carry a logged probability at or above
`deterministic_probability_threshold` (default 0.999), the comparison returns
`logging_policy_is_deterministic` and produces no estimate. Under π₀(a|x)=1 no alternative
action was ever observable, positivity fails, the importance weight collapses to π(a|x), and
SNIPS reduces to a re-weighted average of the same logged actions — the bootstrap interval
then measures reward noise and nothing counterfactual. The gate is a rate rather than an
"any 1.0" test because a genuinely randomised logger can legitimately emit 1.0 occasionally
(a slate screening left with one option, a hard tie-break); an occasional certain event
carries no information but does not invalidate the log.

**The gates have absolute floors.** `EvaluationConfig` is still tunable, but only in the
stringent direction. `MIN_EVENTS_FLOOR` (50), `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR` (25),
`MIN_OVERLAP_RATE_FLOOR` (0.80), `MIN_LOGGED_PROBABILITY_FLOOR` (0.01),
`MAX_IMPORTANCE_WEIGHT_CEILING` (20), `MIN_WEIGHT_MASS_FLOOR` (0.50),
`MAX_WEIGHT_MASS_CEILING` (2.00), `BOOTSTRAP_REPLICATES_FLOOR` (200),
`CONFIDENCE_LEVEL_FLOOR` (0.90), `MINIMUM_EFFECT_FLOOR` (0.02),
`DETERMINISTIC_PROBABILITY_CEILING` (0.999) and `MAX_DETERMINISTIC_EVENT_RATE_CEILING` (0.25)
are enforced in `__post_init__`. A reviewer may demand more events or a larger effect; nobody
can construct a config that accepts a two-event comparison or a zero minimum effect.

**Doubly robust is gated, opt-in in both directions, and never the headline.** The estimator
accepts an outcome model only as a `ValidatedOutcomeModel`, which cannot be constructed
without an `OutcomeModelValidation` whose six fields carry no defaults, so an unvalidated
model is not an expressible call. Requesting doubly robust without a model blocks the whole
comparison rather than serving a SNIPS number under a DR heading, and supplying a model
without requesting it blocks too. The diagnostic's `role` is a read-only
`secondary_diagnostic_only`. If DR and SNIPS disagree, the disagreement is the finding.

**Deficient support is detected as a lower bound, not measured.** `overlap_rate` asks whether
the *candidate* covers the logger; support deficiency is the opposite question, whether the
*logger* covered the candidate, and no overlap number can answer it. A separate quantity flags
candidate mass sitting where the log provably could not have looked — the two cases derivable
from a single record, namely a logged propensity within `min_logged_probability` of 1 and a
candidate assigning zero to the logged action — gated at 2% by default under a 10% ceiling.
What it computes is a provable lower bound on support deficiency (Sachdeva, Su & Joachims,
KDD 2020), so **a zero means "nothing provable", never "nothing there"**. The exact quantity
needs slate-wide propensities the contract does not record.

**The improvement criterion is conservative.** A bare `lower > minimum_effect` is one number
from one tail of one bootstrap. All three of the following must now hold: the interval's lower
bound clears the minimum effect, the point estimate clears it too, and the improvement
survives deleting the single most influential logged event. Each unmet condition is named on
the decision object rather than collapsed into a status.

Reward is bounded and auditable: explicit uncorrected patient selection is positive;
rejection, choosing another candidate, correction, or phrase-board fallback is negative.
There is no reward derived from clinical status, speed, engagement, or reduced confirmation.
A correction costs an additional repair term; a phrase-board fallback does not. Charging that
repair cost for a fallback scored the designed safety route at −1.0 against a plain
rejection's −0.8 and was fixed (D-065): fallback and rejection now both score −0.8.

## Repeated-speaker clustering is not corrected, and the bias has a known sign

The reported interval resamples events independently. Awaaz events cluster by speaker, so
under positive intra-cluster correlation the true interval is **wider** than the printed one
and the error runs toward declaring the candidate better — the one direction this package
exists to prevent. The textbook fix is a cluster bootstrap, which needs a per-speaker key.

There is no such key and one is not being added (D-064). A grouping id stable across a
speaker's events is a pseudonymous patient identifier: the collisions that make it useful for
clustering are exactly what make it a re-identification handle, and no salting separates the
two. So the limitation is made unmissable instead — it is the first entry of `LIMITATIONS`,
it names the direction of the bias, it repeats in the improvement decision's
`does_not_guarantee`, `UNCERTAINTY_BASIS` states the resampling scheme on every result, and
`clustered_uncertainty_available` is a permanently-false read-only property.

## The minimum effect is not calibrated to the sample floors

`MINIMUM_EFFECT_FLOOR = 0.02` advertises roughly ten times more resolution than
`MIN_EVENTS_FLOOR = 50` and `MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR = 25` can deliver: at ESS 25 the
smallest adjudicable true delta is about 0.18 (`docs/RESEARCH_OPE.md` §2.2, our own
arithmetic rather than a cited result). The literature supplies no fixed minimum event count
at all — the governing quantity is effective sample size, not n. This is an **open
calibration question**, not something the floors have solved. The two honest options are
raising the floor to something the sample size supports, or computing the achievable minimum
detectable effect from the realised ESS at runtime and blocking when the configured effect
falls below it. Neither has been done.

## Before any real offline evaluation

1. add a versioned, purpose-consented logging contract to the product without free text or
   audio — **the contract exists but is not in use.** `awaaz_policy_events` and its two
   endpoints are built (D-062); nothing calls them, so the frontend confirmation loop must
   mint event ids and report outcomes before a single row exists;
2. ~~document how propensities are produced without live random exploration~~ — answered
   differently than the step assumed. Propensities come from real, bounded randomisation on
   the confirmation path (D-063), because a deterministic logger cannot be evaluated at all.
   What remains unmeasured is how often real slates are near-tied;
3. preregister the policy, reward, cohort unit, exclusions, and minimum-support gates;
4. split by patient before any fitting or policy selection — **not achievable from this log
   and deliberately so.** The table carries no patient column (D-062), so a patient-level
   split has to happen in a governed environment that legitimately holds the patient key, and
   the offline package receives only an attestation that it did (`OutcomeModelValidation`).
   Nothing in this repository can perform or verify that split;
5. perform privacy/security review and deletion/retention implementation — `logged_on` was
   made a DATE specifically to support a retention sweep, and **no such job exists**;
6. run independent offline review and a prospective supervised usability study;
7. obtain explicit approval for any deployment path—the current module provides none.

Online exploration on patients remains prohibited, and the bounded randomisation described
above is not an exception to that. "Online exploration" means a system that changes its own
behaviour from the feedback it receives — a bandit that updates, a policy that adapts, a
model fitted on live outcomes. Nothing here does any of that: the logged rows are never read
at runtime, no parameter moves, and the sampling distribution is a fixed function of scores
the ranker already produced. What was added is a fixed, bounded presentation randomisation on
a path where the person still chooses, recorded so that a human can later compute an estimate
offline. A future proposal to let anything learn from these rows online is a new
clinical-safety decision, not an extension of this scaffold.
