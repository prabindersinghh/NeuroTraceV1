# Awaaz offline policy evaluation

**Status:** executable, synthetic, offline-only scaffold. No live Awaaz event source is
connected and no policy is authorised for deployment.

The safe optimisation surface is candidate **ranking** among options already produced and
safety-screened elsewhere. It cannot generate words, alter confirmation, trigger speech,
touch an emergency flow, make a clinical claim, or explore on a patient.

Calling the current code “reinforcement learning” without this qualification would be
misleading. It is deterministic logged-feedback scoring plus conservative offline
contextual-policy comparison. The production Awaaz schema does not yet record the complete
slate, policy version, logged action probability, and explicit outcome required for a valid
counterfactual estimate, so current product events are ineligible.

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
scoring (SNIPS) for the estimate. It blocks on insufficient events, missing/mismatched
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

Reward is bounded and auditable: explicit uncorrected patient selection is positive;
rejection, choosing another candidate, correction, or phrase-board fallback is negative.
There is no reward derived from clinical status, speed, engagement, or reduced confirmation.

## Before any real offline evaluation

1. add a versioned, purpose-consented logging contract to the product without free text or
   audio;
2. document how propensities are produced without live random exploration;
3. preregister the policy, reward, cohort unit, exclusions, and minimum-support gates;
4. split by patient before any fitting or policy selection;
5. perform privacy/security review and deletion/retention implementation;
6. run independent offline review and a prospective supervised usability study;
7. obtain explicit approval for any deployment path—the current module provides none.

Online exploration on patients remains prohibited. A future proposal to change that is a
new clinical-safety decision, not an extension of this scaffold.
