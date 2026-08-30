"""Run a deterministic, synthetic Awaaz offline-policy evaluation.

This is an executable contract smoke test, not patient learning, model training, clinical
evaluation, deployment approval, or an online experiment.
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
    PolicyManifest,
    PolicyPrediction,
)
from .offline import MIN_EVENTS_FLOOR, EvaluationConfig, compare_policies


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


def _policy(
    policy_id: str,
    events: list[LoggedFeedback],
    *,
    preference_aware: bool,
) -> OfflinePolicy:
    predictions: list[PolicyPrediction] = []
    for index, event in enumerate(events):
        first, second = event.candidate_action_ids
        preferred = first if index % 2 == 0 else second
        first_probability = 0.5
        if preference_aware:
            first_probability = 0.9 if preferred == first else 0.1
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


def run_simulation(*, events: int = 60, seed: int = 42) -> dict:
    if events < MIN_EVENTS_FLOOR:
        raise ValueError(
            f"simulation requires at least {MIN_EVENTS_FLOOR} events to satisfy the review "
            "gate"
        )
    logged = _events(events, seed=seed)
    result = compare_policies(
        logged,
        baseline=_policy("synthetic-baseline-v1", logged, preference_aware=False),
        candidate=_policy("synthetic-candidate-v1", logged, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=500, seed=seed),
    )
    return {
        "schema_version": 1,
        "synthetic": True,
        "model_trained": False,
        "patient_data_used": False,
        "status": result.status.value,
        "reviewable_offline": result.reviewable,
        "baseline": asdict(result.baseline) if result.baseline else None,
        "candidate": asdict(result.candidate) if result.candidate else None,
        "reward_delta": result.reward_delta,
        "confidence_interval": result.confidence_interval,
        "offline_preferred_policy_id": result.offline_preferred_policy_id,
        "blockers": list(result.blockers),
        "limitations": list(result.limitations),
        "deployment_allowed": result.deployment_allowed,
        "online_experiment_allowed": result.online_experiment_allowed,
        "clinical_claim_allowed": result.clinical_claim_allowed,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--events", type=int, default=60)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(run_simulation(events=args.events, seed=args.seed), indent=2))


if __name__ == "__main__":
    main()
