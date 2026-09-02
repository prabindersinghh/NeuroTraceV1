"""Run a deterministic, synthetic Awaaz offline-policy evaluation.

This is an executable contract smoke test, not patient learning, model training, clinical
evaluation, deployment approval, or an online experiment.

It deliberately runs the failure modes as well as the success. A simulation that only ever
prints a passing comparison teaches a reviewer that the gates exist; it does not show them
what a refusal looks like, which is the output they will actually have to recognise on the
first day real logs arrive. Every scenario below is named for the thing that goes wrong.
"""
from __future__ import annotations

import argparse
import json
import random
import uuid
from dataclasses import asdict

from ...awaaz.safety import SpeechProfile
from .contracts import (
    ExplicitFeedback,
    FeedbackActor,
    LoggedFeedback,
    OfflinePolicy,
    OutcomeModelPrediction,
    OutcomeModelValidation,
    OutcomeValidationScheme,
    PolicyManifest,
    PolicyPrediction,
    ValidatedOutcomeModel,
)
from .offline import (
    IMPROVEMENT_CRITERION,
    IMPROVEMENT_DOES_NOT_GUARANTEE,
    IMPROVEMENT_GUARANTEES,
    MIN_EVENTS_FLOOR,
    UNCERTAINTY_BASIS,
    EvaluationConfig,
    OfflineComparison,
    compare_policies,
)


def _events(count: int, *, seed: int) -> list[LoggedFeedback]:
    """Build a log from a behaviour policy that genuinely randomises.

    An earlier version of this simulation recorded ``0.5`` for every event while always
    logging the same candidate. That is not a behaviour policy, it is a fixed choice wearing a
    propensity: the estimator would have been dividing by a probability no action was ever
    drawn with. Here the logged action is actually sampled, and the recorded probability is the
    probability of the action that was sampled -- which is what ``LoggedFeedback`` promises and
    what ``compare_policies`` divides by. The draw is seeded so the whole run stays
    reproducible; a synthetic log must be replayable to be worth anything as a smoke test.
    """
    rng = random.Random(seed)
    events: list[LoggedFeedback] = []
    for index in range(count):
        first = uuid.UUID(int=100_000 + index * 2)
        second = uuid.UUID(int=100_001 + index * 2)
        #: The option this synthetic patient would pick if offered it. Alternating rather than
        #: random so the candidate policy has something learnable to be right about.
        preferred = first if index % 2 == 0 else second
        #: Three different propensities so the log is not one constant weight in disguise.
        first_probability = (0.4, 0.5, 0.6)[index % 3]
        logged = first if rng.random() < first_probability else second
        probability = first_probability if logged == first else 1.0 - first_probability
        if first_probability == 0.5:
            top_ranked = None  # an honest tie has no top-ranked action to declare
        else:
            top_ranked = first if first_probability > 0.5 else second
        corrected = logged != preferred
        events.append(LoggedFeedback(
            event_id=uuid.UUID(int=index + 1),
            behavior_policy_id="synthetic-observed-v1",
            candidate_action_ids=(first, second),
            logged_action_id=logged,
            logged_action_probability=probability,
            top_ranked_action_id=top_ranked,
            speech_profile=SpeechProfile.dysarthria_dominant,
            confirmation_required=True,
            confirmation_observed=True,
            output_spoken=True,
            emergency=False,
            feedback=ExplicitFeedback(
                actor=FeedbackActor.patient,
                selected_action_id=preferred,
                correction_made=corrected,
            ),
        ))
    return events


def _deterministic_events(count: int) -> list[LoggedFeedback]:
    """A logger that always took the action it preferred, and recorded certainty about it.

    Structurally identical to ``_events``; the only difference is that every propensity is
    1.0. That is the point of showing it: nothing about the record looks wrong, the reward
    signal is real, the arithmetic completes, and the answer would still be meaningless.
    """
    base = _events(count, seed=1)
    return [
        LoggedFeedback(
            event_id=event.event_id,
            behavior_policy_id=event.behavior_policy_id,
            candidate_action_ids=event.candidate_action_ids,
            logged_action_id=event.logged_action_id,
            logged_action_probability=1.0,
            top_ranked_action_id=event.logged_action_id,
            speech_profile=event.speech_profile,
            confirmation_required=event.confirmation_required,
            confirmation_observed=event.confirmation_observed,
            output_spoken=event.output_spoken,
            emergency=event.emergency,
            feedback=event.feedback,
        )
        for event in base
    ]


def _near_certain_events(count: int, *, certain_every: int) -> list[LoggedFeedback]:
    """A mostly-randomised log with a recurring near-certain event.

    0.96 is below the 0.999 deterministic threshold, so the randomisation gate is content:
    this log is not refused for failing to explore. But the slate's probabilities sum to one,
    so on those events every unlogged action provably had propensity below 0.04 -- under the
    0.05 floor the config already refuses to divide by. A candidate that wants to act
    differently there is asking about a region the logger never entered.
    """
    base = _events(count, seed=7)
    return [
        LoggedFeedback(
            event_id=event.event_id,
            behavior_policy_id=event.behavior_policy_id,
            candidate_action_ids=event.candidate_action_ids,
            logged_action_id=event.logged_action_id,
            logged_action_probability=(
                0.96 if index % certain_every == 0 else event.logged_action_probability
            ),
            top_ranked_action_id=(
                event.logged_action_id
                if index % certain_every == 0
                else event.top_ranked_action_id
            ),
            speech_profile=event.speech_profile,
            confirmation_required=event.confirmation_required,
            confirmation_observed=event.confirmation_observed,
            output_spoken=event.output_spoken,
            emergency=event.emergency,
            feedback=event.feedback,
        )
        for index, event in enumerate(base)
    ]


def _policy(
    policy_id: str,
    events: list[LoggedFeedback],
    *,
    preference_aware: bool,
    strength: float = 0.4,
) -> OfflinePolicy:
    """``strength`` is how far from a coin flip the policy leans towards the preferred action.

    0.4 gives the 0.9/0.1 policy the nominal scenario uses. A small value gives a policy that
    is genuinely, slightly better -- which is the case the criterion has to be able to call
    inconclusive rather than round up into a win.
    """
    predictions: list[PolicyPrediction] = []
    for index, event in enumerate(events):
        first, second = event.candidate_action_ids
        preferred = first if index % 2 == 0 else second
        first_probability = 0.5
        if preference_aware:
            first_probability = (
                0.5 + strength if preferred == first else 0.5 - strength
            )
        predictions.append(PolicyPrediction(
            event_id=event.event_id,
            action_probabilities=(
                (first, first_probability),
                (second, 1.0 - first_probability),
            ),
        ))
    return OfflinePolicy(
        manifest=PolicyManifest(policy_id=policy_id),
        predictions=tuple(predictions),
    )


def _logged_action_policy(
    policy_id: str,
    events: list[LoggedFeedback],
    probability_for,
) -> OfflinePolicy:
    """A policy defined by the probability it puts on each event's logged action."""
    predictions: list[PolicyPrediction] = []
    for index, event in enumerate(events):
        other = next(
            action for action in event.candidate_action_ids
            if action != event.logged_action_id
        )
        logged_probability = probability_for(index, event)
        predictions.append(PolicyPrediction(
            event_id=event.event_id,
            action_probabilities=(
                (event.logged_action_id, logged_probability),
                (other, 1.0 - logged_probability),
            ),
        ))
    return OfflinePolicy(
        manifest=PolicyManifest(policy_id=policy_id),
        predictions=tuple(predictions),
    )


def _outcome_model(events: list[LoggedFeedback]) -> ValidatedOutcomeModel:
    """A synthetic reward model carrying a synthetic validation attestation.

    The attestation is fabricated, exactly like everything else in this file, and the run
    output says so. It exists here to demonstrate the shape of a record that would let the
    doubly-robust diagnostic run at all -- a grouped (by-patient) holdout, fitted on events
    disjoint from the ones being evaluated, and calibrated. No real model has ever produced
    one; ML_STATUS.md is the source of truth for that.
    """
    predictions: list[OutcomeModelPrediction] = []
    for index, event in enumerate(events):
        first, second = event.candidate_action_ids
        preferred = first if index % 2 == 0 else second
        other = second if preferred == first else first
        # Deliberately imperfect: the model is directionally right and numerically off, which
        # is the realistic case DR is supposed to tolerate.
        predictions.append(OutcomeModelPrediction(
            event_id=event.event_id,
            action_rewards=((preferred, 0.7), (other, -0.9)),
        ))
    return ValidatedOutcomeModel(
        model_id="synthetic-outcome-model-v1",
        validation=OutcomeModelValidation(
            validation_id="synthetic-validation-001",
            scheme=OutcomeValidationScheme.grouped_holdout,
            held_out_events=180,
            calibration_error=0.14,
            fitted_without_evaluation_events=True,
            reviewer_reference="synthetic-reviewer-ref-001",
        ),
        predictions=tuple(predictions),
    )


def _serialise(result: OfflineComparison, *, demonstrates: str) -> dict:
    """Serialise one comparison.

    ``limitations`` and the criterion's guarantee text are identical on every result, so they
    are emitted once at the top of the document rather than seven times inside it. They live
    on each result OBJECT regardless -- that is where they must be unavoidable, because that
    is what a caller other than this file will hold.
    """
    return {
        "demonstrates": demonstrates,
        "status": result.status.value,
        "reviewable_offline": result.reviewable,
        "headline_estimator": result.headline_estimator,
        "uncertainty_basis": result.uncertainty_basis,
        "clustered_uncertainty_available": result.clustered_uncertainty_available,
        "baseline": asdict(result.baseline) if result.baseline else None,
        "candidate": asdict(result.candidate) if result.candidate else None,
        "reward_delta": result.reward_delta,
        "confidence_interval": result.confidence_interval,
        "candidate_deficient_support_mass": result.candidate_deficient_support_mass,
        "offline_preferred_policy_id": result.offline_preferred_policy_id,
        "improvement": (
            {
                "criterion": result.improvement.criterion,
                "met": result.improvement.met,
                "direction": result.improvement.direction,
                "minimum_effect": result.improvement.minimum_effect,
                "point_estimate": result.improvement.point_estimate,
                "paired_lower_bound": result.improvement.paired_lower_bound,
                "paired_upper_bound": result.improvement.paired_upper_bound,
                "delta_without_most_influential_event": (
                    result.improvement.delta_without_most_influential_event
                ),
                "unmet_conditions": list(result.improvement.unmet_conditions),
            }
            if result.improvement else None
        ),
        "doubly_robust": (
            {**asdict(result.doubly_robust), "role": result.doubly_robust.role}
            if result.doubly_robust else None
        ),
        "blockers": list(result.blockers),
        "deployment_allowed": result.deployment_allowed,
        "online_experiment_allowed": result.online_experiment_allowed,
        "clinical_claim_allowed": result.clinical_claim_allowed,
    }


def _nominal(events: int, seed: int) -> tuple[OfflineComparison, list[LoggedFeedback]]:
    logged = _events(events, seed=seed)
    return compare_policies(
        logged,
        baseline=_policy("synthetic-baseline-v1", logged, preference_aware=False),
        candidate=_policy("synthetic-candidate-v1", logged, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=500, seed=seed),
    ), logged


def run_scenarios(*, events: int = 60, seed: int = 42) -> dict:
    """Every scenario a reviewer has to be able to recognise, refusals included."""
    config = EvaluationConfig(bootstrap_replicates=500, seed=seed)
    scenarios: dict[str, dict] = {}

    nominal, logged = _nominal(events, seed)
    scenarios["nominal_candidate_better"] = _serialise(
        nominal,
        demonstrates="a comparison that passes every gate and the conservative criterion",
    )

    # 1. The logger never randomised. Positivity fails and no counterfactual is identified.
    deterministic = _deterministic_events(events)
    scenarios["deterministic_logger_refused"] = _serialise(
        compare_policies(
            deterministic,
            baseline=_policy("synthetic-baseline-v1", deterministic, preference_aware=False),
            candidate=_policy("synthetic-candidate-v1", deterministic, preference_aware=True),
            config=config,
        ),
        demonstrates=(
            "a behaviour policy that never randomised: positivity fails, no counterfactual "
            "is identified, and no interval is produced"
        ),
    )

    # 2. Deficient support: the candidate wants to act where the logger provably did not go.
    #    Note this fires on its own -- overlap is a full 1.0, because every event still has
    #    SOME candidate mass on the logged action. Overlap alone would have passed this log.
    near_certain = _near_certain_events(events, certain_every=5)
    scenarios["deficient_support_refused"] = _serialise(
        compare_policies(
            near_certain,
            baseline=_logged_action_policy(
                "synthetic-baseline-v1",
                near_certain,
                lambda index, event: event.logged_action_probability,
            ),
            candidate=_logged_action_policy(
                "synthetic-candidate-v1",
                near_certain,
                lambda index, event: (
                    0.1 if index % 5 == 0 else event.logged_action_probability
                ),
            ),
            config=config,
        ),
        demonstrates=(
            "the candidate wants to act where the logger provably never went; overlap is a "
            "full 1.0 and only the support gate notices"
        ),
    )

    # 3. Not enough log to bootstrap a ratio estimator at all.
    short = _events(MIN_EVENTS_FLOOR - 10, seed=seed)
    scenarios["too_few_events_refused"] = _serialise(
        compare_policies(
            short,
            baseline=_policy("synthetic-baseline-v1", short, preference_aware=False),
            candidate=_policy("synthetic-candidate-v1", short, preference_aware=True),
            config=config,
        ),
        demonstrates="too little log to bootstrap a ratio estimator at all",
    )

    # 4. A real result that is simply not strong enough. This is the most common honest
    #    outcome and the one a reviewer is least prepared for, so it is tuned to the exact
    #    case the strengthened criterion exists for: the POINT estimate (~0.021) clears the
    #    0.02 minimum effect and the interval's lower end (~0.019) does not. Reported as a
    #    bare delta this reads as a win. It is not one, and the unmet condition says which.
    scenarios["genuinely_inconclusive"] = _serialise(
        compare_policies(
            logged,
            baseline=_policy("synthetic-baseline-v1", logged, preference_aware=False),
            candidate=_policy(
                "synthetic-candidate-v1", logged, preference_aware=True, strength=0.012
            ),
            config=config,
        ),
        demonstrates=(
            "a real but small improvement whose POINT estimate clears the minimum effect "
            "and whose interval does not; a bare delta would have called this a win"
        ),
    )

    # 5. Doubly robust asked for without a validated outcome model: refused, not fallen back.
    scenarios["doubly_robust_without_validated_model_refused"] = _serialise(
        compare_policies(
            logged,
            baseline=_policy("synthetic-baseline-v1", logged, preference_aware=False),
            candidate=_policy("synthetic-candidate-v1", logged, preference_aware=True),
            config=config,
            request_doubly_robust=True,
        ),
        demonstrates=(
            "doubly robust asked for with no validated outcome model: refused outright, "
            "not silently served a SNIPS number under a DR heading"
        ),
    )

    # 6. With a (synthetic) validated model, DR appears beside SNIPS and decides nothing.
    scenarios["doubly_robust_secondary_diagnostic"] = _serialise(
        compare_policies(
            logged,
            baseline=_policy("synthetic-baseline-v1", logged, preference_aware=False),
            candidate=_policy("synthetic-candidate-v1", logged, preference_aware=True),
            config=config,
            outcome_model=_outcome_model(logged),
            request_doubly_robust=True,
        ),
        demonstrates=(
            "with a (fabricated) validated model DR appears beside SNIPS, disagrees with "
            "it slightly, and decides nothing"
        ),
    )
    return scenarios


def run_simulation(*, events: int = 60, seed: int = 42) -> dict:
    if events < MIN_EVENTS_FLOOR:
        raise ValueError(
            f"simulation requires at least {MIN_EVENTS_FLOOR} events to satisfy the review "
            "gate"
        )
    result, _ = _nominal(events, seed)
    scenarios = run_scenarios(events=events, seed=seed)
    return {
        "schema_version": 2,
        "synthetic": True,
        "model_trained": False,
        "patient_data_used": False,
        "outcome_model_validation_is_fabricated": True,
        "headline_estimator": result.headline_estimator,
        "uncertainty_basis": UNCERTAINTY_BASIS,
        "speaker_clustering_correction": "unavailable_no_grouping_key_in_contract",
        "status": result.status.value,
        "reviewable_offline": result.reviewable,
        "baseline": asdict(result.baseline) if result.baseline else None,
        "candidate": asdict(result.candidate) if result.candidate else None,
        "reward_delta": result.reward_delta,
        "confidence_interval": result.confidence_interval,
        "candidate_deficient_support_mass": result.candidate_deficient_support_mass,
        "offline_preferred_policy_id": result.offline_preferred_policy_id,
        "blockers": list(result.blockers),
        "limitations": list(result.limitations),
        # Emitted once, and identical on every result object below.
        "improvement_criterion": {
            "criterion": IMPROVEMENT_CRITERION,
            "guarantees": list(IMPROVEMENT_GUARANTEES),
            "does_not_guarantee": list(IMPROVEMENT_DOES_NOT_GUARANTEE),
        },
        "deployment_allowed": result.deployment_allowed,
        "online_experiment_allowed": result.online_experiment_allowed,
        "clinical_claim_allowed": result.clinical_claim_allowed,
        "scenarios": scenarios,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", type=int, default=60)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(run_simulation(events=args.events, seed=args.seed), indent=2))


if __name__ == "__main__":
    main()
