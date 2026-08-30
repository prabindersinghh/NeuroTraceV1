"""Conservative counterfactual comparison for Awaaz candidate-ranking policies.

The estimator is self-normalised inverse propensity scoring (SNIPS), with IPS retained as a
diagnostic. It is useful only when the logged policy has support for the evaluated policy.
Overlap, importance weights, effective sample size, and deterministic bootstrap uncertainty
are therefore gates, not footnotes, and a log whose behaviour policy did not randomise is
refused outright rather than scored. Every gate has an absolute stringency floor a caller
cannot configure past. Passing them permits offline review only; this module has no
deployment or experiment path, and ``OfflineComparison`` cannot be made to claim otherwise.
"""
from __future__ import annotations

import enum
import math
import random
from dataclasses import dataclass

from .contracts import LoggedFeedback, OfflinePolicy, PolicyPrediction
from .rewards import RewardConfig, score_logged_action
from .safety import gate_logged_feedback, gate_policy


class ComparisonStatus(str, enum.Enum):
    blocked = "blocked"
    inconclusive = "inconclusive"
    candidate_better_offline = "candidate_better_offline"
    baseline_better_offline = "baseline_better_offline"


#: Every value below is an ABSOLUTE limit on how weak a caller may make a gate. The gate
#: fields on ``EvaluationConfig`` are still tunable, but only in the stringent direction: a
#: reviewer may demand more events or a larger effect, and nobody may quietly dial a hard
#: gate down to nothing. Before these existed, ``EvaluationConfig(min_events=2,
#: minimum_effect=0.0, ...)`` validated cleanly and let a two-event interval clearing zero by
#: 1e-12 return ``candidate_better_offline``, which is exactly the claim this package exists
#: to refuse.

#: Fewer than 50 logged events cannot support an event-level bootstrap of a ratio estimator;
#: the interval is driven by which handful of events the resample happened to draw.
MIN_EVENTS_FLOOR = 50
#: SNIPS is a weighted mean. Below ~25 effective observations its variance is dominated by a
#: few large weights, and the bootstrap understates that because it resamples the same few.
MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR = 25.0
#: The evaluated policy must put mass on actions the logger actually took for at least 80% of
#: events. Below that the estimate describes a sub-population chosen by the policy itself.
MIN_OVERLAP_RATE_FLOOR = 0.80
#: A propensity in the denominator below 1% turns one event into a 100x weight. No amount of
#: self-normalisation makes that event's reward a population estimate.
MIN_LOGGED_PROBABILITY_FLOOR = 0.01
#: A single weight above 20 means one logged event can move the estimate more than the other
#: 49 combined. The ceiling caps how permissive a caller may be about that.
MAX_IMPORTANCE_WEIGHT_CEILING = 20.0
#: Mean importance weight far from 1 means the logged and evaluated policies disagree about
#: which events matter; the estimate is then extrapolation, not re-weighting.
MIN_WEIGHT_MASS_FLOOR = 0.50
MAX_WEIGHT_MASS_CEILING = 2.00
#: Fewer than 200 replicates gives a percentile interval whose endpoints are themselves noisy
#: at the 2.5% tail we read them from.
BOOTSTRAP_REPLICATES_FLOOR = 200
#: A 90% interval is the loosest this package will call evidence.
CONFIDENCE_LEVEL_FLOOR = 0.90
#: The interval must clear zero by a margin that means something to a patient. With a floor
#: of 0.0 the status would be decided by floating-point noise on a bounded reward.
MINIMUM_EFFECT_FLOOR = 0.02
#: A logged probability at or above this counts as "this event was not randomised". Left as a
#: ceiling: a caller may treat 0.99 as deterministic, but may not push the bar so close to 1
#: that a policy logging 0.9995 everywhere reads as randomised.
DETERMINISTIC_PROBABILITY_CEILING = 0.999
#: At most a quarter of events may be unrandomised however the caller configures it.
MAX_DETERMINISTIC_EVENT_RATE_CEILING = 0.25


@dataclass(frozen=True, slots=True)
class EvaluationConfig:
    min_events: int = 50
    min_effective_sample_size: float = 25.0
    min_overlap_rate: float = 0.80
    min_logged_probability: float = 0.05
    max_importance_weight: float = 10.0
    min_weight_mass: float = 0.50
    max_weight_mass: float = 2.00
    bootstrap_replicates: int = 1_000
    confidence_level: float = 0.95
    minimum_effect: float = 0.02
    deterministic_probability_threshold: float = 0.999
    max_deterministic_event_rate: float = 0.10
    seed: int = 42

    def __post_init__(self) -> None:
        if type(self.min_events) is not int or self.min_events < MIN_EVENTS_FLOOR:
            raise ValueError(
                f"min_events must be an integer of at least {MIN_EVENTS_FLOOR}"
            )
        if (
            type(self.bootstrap_replicates) is not int
            or self.bootstrap_replicates < BOOTSTRAP_REPLICATES_FLOOR
        ):
            raise ValueError(
                "bootstrap_replicates must be an integer of at least "
                f"{BOOTSTRAP_REPLICATES_FLOOR}"
            )
        if type(self.seed) is not int:
            raise ValueError("seed must be an integer")
        bounded = {
            "min_overlap_rate": self.min_overlap_rate,
            "min_logged_probability": self.min_logged_probability,
            "confidence_level": self.confidence_level,
            "deterministic_probability_threshold": (
                self.deterministic_probability_threshold
            ),
        }
        for name, value in bounded.items():
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError(f"{name} must be finite")
            if not 0.0 < float(value) <= 1.0:
                raise ValueError(f"{name} must be in (0, 1]")
        positive = {
            "min_effective_sample_size": self.min_effective_sample_size,
            "max_importance_weight": self.max_importance_weight,
            "min_weight_mass": self.min_weight_mass,
            "max_weight_mass": self.max_weight_mass,
        }
        for name, value in positive.items():
            if isinstance(value, bool) or not math.isfinite(float(value)) or float(value) <= 0:
                raise ValueError(f"{name} must be finite and positive")
        if self.min_weight_mass > self.max_weight_mass:
            raise ValueError("min_weight_mass cannot exceed max_weight_mass")
        if (
            isinstance(self.minimum_effect, bool)
            or not math.isfinite(float(self.minimum_effect))
            or not 0.0 <= float(self.minimum_effect) <= 2.0
        ):
            raise ValueError("minimum_effect must be finite and in [0, 2]")
        if (
            isinstance(self.max_deterministic_event_rate, bool)
            or not math.isfinite(float(self.max_deterministic_event_rate))
            or not 0.0 <= float(self.max_deterministic_event_rate) <= 1.0
        ):
            raise ValueError("max_deterministic_event_rate must be finite and in [0, 1]")

        # Stringency floors. A caller may tighten any of these; loosening one past the
        # documented minimum is rejected here rather than politely accepted, because the
        # result object carries no record of the configuration it was produced under.
        at_least = (
            ("min_effective_sample_size", self.min_effective_sample_size,
             MIN_EFFECTIVE_SAMPLE_SIZE_FLOOR),
            ("min_overlap_rate", self.min_overlap_rate, MIN_OVERLAP_RATE_FLOOR),
            ("min_logged_probability", self.min_logged_probability,
             MIN_LOGGED_PROBABILITY_FLOOR),
            ("min_weight_mass", self.min_weight_mass, MIN_WEIGHT_MASS_FLOOR),
            ("confidence_level", self.confidence_level, CONFIDENCE_LEVEL_FLOOR),
            ("minimum_effect", self.minimum_effect, MINIMUM_EFFECT_FLOOR),
        )
        for name, value, floor in at_least:
            if float(value) < floor:
                raise ValueError(
                    f"{name} may not be weaker than the {floor} stringency floor"
                )
        at_most = (
            ("max_importance_weight", self.max_importance_weight,
             MAX_IMPORTANCE_WEIGHT_CEILING),
            ("max_weight_mass", self.max_weight_mass, MAX_WEIGHT_MASS_CEILING),
            ("deterministic_probability_threshold",
             self.deterministic_probability_threshold, DETERMINISTIC_PROBABILITY_CEILING),
            ("max_deterministic_event_rate", self.max_deterministic_event_rate,
             MAX_DETERMINISTIC_EVENT_RATE_CEILING),
        )
        for name, value, ceiling in at_most:
            if float(value) > ceiling:
                raise ValueError(
                    f"{name} may not be weaker than the {ceiling} stringency ceiling"
                )


@dataclass(frozen=True, slots=True)
class PolicyEstimate:
    policy_id: str
    events: int
    ips_reward: float
    snips_reward: float
    effective_sample_size: float
    overlap_rate: float
    max_importance_weight: float
    weight_mass: float


LIMITATIONS = (
    "Offline agreement with logged explicit choices is a product-UX estimate, not a "
    "clinical outcome or treatment claim.",
    "Counterfactual validity depends on logged propensities, overlap, and policy predictions "
    "being produced without access to held-out feedback.",
    "Event-level bootstrap intervals do not remove repeated-speaker dependence or unmeasured "
    "context bias.",
    "A passing comparison authorises human offline review only; deployment and online patient "
    "experimentation remain forbidden.",
)


@dataclass(frozen=True, slots=True)
class OfflineComparison:
    """An offline review result. It cannot, by construction, authorise anything.

    The three authorisation answers below are properties rather than fields with a ``False``
    default. As fields they were settable -- ``OfflineComparison(..., deployment_allowed=True)``
    and ``dataclasses.replace(result, clinical_claim_allowed=True)`` both worked, and
    ``simulate`` serialises them straight into JSON, so a forged object emitted an
    authoritative-looking document granting deployment. As properties they take no
    constructor keyword, ``replace`` rejects them, and there is nothing to assign to.
    Authorisation for this surface lives in a human clinical-safety decision (PLAN_RL.md
    step 7); this module has no path to it and should not be able to imitate one.
    """

    status: ComparisonStatus
    reviewable: bool
    baseline: PolicyEstimate | None
    candidate: PolicyEstimate | None
    reward_delta: float | None
    confidence_interval: tuple[float, float] | None
    offline_preferred_policy_id: str | None
    blockers: tuple[str, ...]
    limitations: tuple[str, ...] = LIMITATIONS

    @property
    def deployment_allowed(self) -> bool:
        return False

    @property
    def online_experiment_allowed(self) -> bool:
        return False

    @property
    def clinical_claim_allowed(self) -> bool:
        return False


def _blocked(
    blockers: set[str],
    *,
    baseline: PolicyEstimate | None = None,
    candidate: PolicyEstimate | None = None,
) -> OfflineComparison:
    return OfflineComparison(
        status=ComparisonStatus.blocked,
        reviewable=False,
        baseline=baseline,
        candidate=candidate,
        reward_delta=None,
        confidence_interval=None,
        offline_preferred_policy_id=None,
        blockers=tuple(sorted(blockers)),
    )


def _prediction_map(policy: OfflinePolicy) -> dict:
    return {prediction.event_id: prediction for prediction in policy.predictions}


def _weights(
    events: tuple[LoggedFeedback, ...],
    predictions: dict,
) -> list[float]:
    return [
        predictions[event.event_id].probability_for(event.logged_action_id)
        / event.logged_action_probability
        for event in events
    ]


def _estimate(
    policy_id: str,
    rewards: list[float],
    weights: list[float],
) -> PolicyEstimate:
    weight_sum = math.fsum(weights)
    square_sum = math.fsum(value * value for value in weights)
    weighted_reward = math.fsum(
        weight * reward for weight, reward in zip(weights, rewards, strict=True)
    )
    n = len(rewards)
    return PolicyEstimate(
        policy_id=policy_id,
        events=n,
        ips_reward=weighted_reward / n,
        snips_reward=weighted_reward / weight_sum if weight_sum else float("nan"),
        effective_sample_size=(weight_sum * weight_sum / square_sum) if square_sum else 0.0,
        overlap_rate=sum(weight > 0.0 for weight in weights) / n,
        max_importance_weight=max(weights, default=0.0),
        weight_mass=weight_sum / n,
    )


def _estimate_blockers(
    estimate: PolicyEstimate,
    *,
    label: str,
    config: EvaluationConfig,
) -> set[str]:
    blockers: set[str] = set()
    if estimate.overlap_rate < config.min_overlap_rate:
        blockers.add(f"{label}:overlap_below_minimum")
    if estimate.effective_sample_size < config.min_effective_sample_size:
        blockers.add(f"{label}:effective_sample_size_below_minimum")
    if estimate.max_importance_weight > config.max_importance_weight:
        blockers.add(f"{label}:importance_weight_above_maximum")
    if estimate.weight_mass < config.min_weight_mass:
        blockers.add(f"{label}:weight_mass_below_minimum")
    if estimate.weight_mass > config.max_weight_mass:
        blockers.add(f"{label}:weight_mass_above_maximum")
    if not math.isfinite(estimate.snips_reward):
        blockers.add(f"{label}:estimate_not_finite")
    return blockers


def _snips(rewards: list[float], weights: list[float], indices: list[int]) -> float | None:
    denominator = math.fsum(weights[index] for index in indices)
    if denominator <= 0.0:
        return None
    numerator = math.fsum(weights[index] * rewards[index] for index in indices)
    return numerator / denominator


def _percentile(values: list[float], probability: float) -> float:
    """Linear percentile interpolation with no dependency on numeric libraries."""
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def _bootstrap_delta(
    rewards: list[float],
    baseline_weights: list[float],
    candidate_weights: list[float],
    config: EvaluationConfig,
) -> tuple[tuple[float, float] | None, int]:
    rng = random.Random(config.seed)
    n = len(rewards)
    deltas: list[float] = []
    for _ in range(config.bootstrap_replicates):
        indices = [rng.randrange(n) for _ in range(n)]
        baseline = _snips(rewards, baseline_weights, indices)
        candidate = _snips(rewards, candidate_weights, indices)
        if baseline is not None and candidate is not None:
            deltas.append(candidate - baseline)
    if not deltas:
        return None, 0
    alpha = (1.0 - config.confidence_level) / 2.0
    return (
        _percentile(deltas, alpha),
        _percentile(deltas, 1.0 - alpha),
    ), len(deltas)


def compare_policies(
    events: tuple[LoggedFeedback, ...] | list[LoggedFeedback],
    *,
    baseline: OfflinePolicy,
    candidate: OfflinePolicy,
    reward_config: RewardConfig | None = None,
    config: EvaluationConfig | None = None,
) -> OfflineComparison:
    """Compare two policies without authorising either one to touch a live speech path."""
    config = config or EvaluationConfig()
    reward_config = reward_config or RewardConfig()
    events = tuple(events)
    blockers: set[str] = set()

    for label, policy in (("baseline", baseline), ("candidate", candidate)):
        gate = gate_policy(policy.manifest)
        blockers.update(f"{label}:{reason}" for reason in gate.blockers)
    if baseline.manifest.policy_id == candidate.manifest.policy_id:
        blockers.add("policies_must_have_distinct_ids")
    if len(events) < config.min_events:
        blockers.add("insufficient_event_count")
    event_ids = [event.event_id for event in events]
    if len(event_ids) != len(set(event_ids)):
        blockers.add("duplicate_event_id")
    for event in events:
        gate = gate_logged_feedback(event)
        blockers.update(f"feedback:{reason}" for reason in gate.blockers)
        if event.logged_action_probability < config.min_logged_probability:
            blockers.add("logged_probability_below_minimum")

    # A logged probability of (near) 1.0 means the behaviour policy took that action with
    # certainty: no other action was ever observable in that context, so positivity fails and
    # the counterfactual value of any policy that would have chosen differently is not
    # identified. The importance weight pi(a|x)/pi_0(a|x) then degenerates to pi(a|x), SNIPS
    # collapses to a re-weighted average of the SAME logged actions, and the bootstrap
    # measures only reward noise -- which is why a fully deterministic log used to return a
    # confident-looking interval that meant nothing at all.
    #
    # The test is deliberately a RATE, not "any event with p == 1.0". A genuinely randomised
    # logger legitimately emits 1.0 now and then: a slate that safety screening reduced to one
    # option, or a context where the ranker's margin left no alternative. One such event
    # contributes no counterfactual information but does not invalidate the log. What cannot
    # be rescued is a log where most events carry no randomisation, so the gate fires on the
    # fraction of unrandomised events, not on their existence.
    if events:
        unrandomised = sum(
            event.logged_action_probability >= config.deterministic_probability_threshold
            for event in events
        )
        if unrandomised / len(events) > config.max_deterministic_event_rate:
            blockers.add("logging_policy_is_deterministic")

    expected_event_ids = set(event_ids)
    prediction_maps = {
        "baseline": _prediction_map(baseline),
        "candidate": _prediction_map(candidate),
    }
    for label, predictions in prediction_maps.items():
        prediction_ids = set(predictions)
        if prediction_ids != expected_event_ids:
            blockers.add(f"{label}:prediction_event_set_mismatch")
        for event in events:
            prediction: PolicyPrediction | None = predictions.get(event.event_id)
            if (
                prediction is not None
                and prediction.action_ids != frozenset(event.candidate_action_ids)
            ):
                blockers.add(f"{label}:candidate_action_set_mismatch")

    if blockers:
        return _blocked(blockers)

    rewards = [
        score_logged_action(event, config=reward_config).total
        for event in events
    ]
    baseline_weights = _weights(events, prediction_maps["baseline"])
    candidate_weights = _weights(events, prediction_maps["candidate"])
    baseline_estimate = _estimate(
        baseline.manifest.policy_id,
        rewards,
        baseline_weights,
    )
    candidate_estimate = _estimate(
        candidate.manifest.policy_id,
        rewards,
        candidate_weights,
    )
    blockers.update(_estimate_blockers(
        baseline_estimate,
        label="baseline",
        config=config,
    ))
    blockers.update(_estimate_blockers(
        candidate_estimate,
        label="candidate",
        config=config,
    ))
    if blockers:
        return _blocked(
            blockers,
            baseline=baseline_estimate,
            candidate=candidate_estimate,
        )

    interval, valid_bootstraps = _bootstrap_delta(
        rewards,
        baseline_weights,
        candidate_weights,
        config,
    )
    if interval is None or valid_bootstraps < math.ceil(config.bootstrap_replicates * 0.95):
        return _blocked(
            {"bootstrap_support_insufficient"},
            baseline=baseline_estimate,
            candidate=candidate_estimate,
        )

    delta = candidate_estimate.snips_reward - baseline_estimate.snips_reward
    lower, upper = interval
    preferred: str | None = None
    if lower > config.minimum_effect:
        status = ComparisonStatus.candidate_better_offline
        preferred = candidate.manifest.policy_id
    elif upper < -config.minimum_effect:
        status = ComparisonStatus.baseline_better_offline
        preferred = baseline.manifest.policy_id
    else:
        status = ComparisonStatus.inconclusive

    return OfflineComparison(
        status=status,
        reviewable=True,
        baseline=baseline_estimate,
        candidate=candidate_estimate,
        reward_delta=delta,
        confidence_interval=interval,
        offline_preferred_policy_id=preferred,
        blockers=(),
    )

