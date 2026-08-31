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

from .contracts import (
    LoggedFeedback,
    OfflinePolicy,
    OutcomeModelPrediction,
    PolicyPrediction,
    ValidatedOutcomeModel,
)
from .rewards import RewardConfig, score_logged_action
from .safety import gate_logged_feedback, gate_outcome_model, gate_policy


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
#: Candidate probability mass sitting in a region the log provably never explored is not
#: noisy, it is undefined: no reweighting of observed rewards says anything about it. A tenth
#: of the evaluated policy's mass is already more extrapolation than a review can absorb.
MAX_DEFICIENT_SUPPORT_MASS_CEILING = 0.10

#: What the reported interval is, stated in the result object rather than in a footnote.
#:
#: The bootstrap below resamples EVENTS independently. Awaaz events are not independent: one
#: speaker contributes many, and their choices correlate, so the true interval is wider than
#: the one printed here and the error runs in the optimistic direction -- towards declaring a
#: candidate better. The honest fix is a cluster bootstrap, which needs a per-speaker key.
#:
#: ``contracts`` carries no such key, and this module deliberately does not add one. A
#: grouping id that is stable across a speaker's events IS a pseudonymous patient identifier:
#: the property that makes it useful for clustering (all of one person's events collide) is
#: exactly the property that makes it a re-identification handle, and no hashing, salting, or
#: truncation separates the two -- a per-event salt would destroy the collisions the cluster
#: bootstrap exists to exploit. "Opaque but stable per person" is a distinction of
#: presentation, not of function, and INV-11 is about function. So the limitation is not
#: repaired; it is named, carried on every result, and repeated in the improvement decision's
#: ``does_not_guarantee``, so that no reader of an output can reach a conclusion without
#: having read it. Correcting it is a logging-contract and governance decision (PLAN_RL.md
#: steps 1-4), not a change this file may make on its own.
UNCERTAINTY_BASIS = "event_level_iid_bootstrap_uncorrected_for_speaker_clustering"

#: SNIPS is the headline estimator, permanently. Doubly robust is reported beside it as a
#: diagnostic and never decides a status; see ``OfflineComparison.headline_estimator``.
HEADLINE_ESTIMATOR = "snips"
IMPROVEMENT_CRITERION = "conservative_high_confidence_improvement"


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
    max_deficient_support_mass: float = 0.02
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
        if (
            isinstance(self.max_deficient_support_mass, bool)
            or not math.isfinite(float(self.max_deficient_support_mass))
            or not 0.0 <= float(self.max_deficient_support_mass) <= 1.0
        ):
            raise ValueError("max_deficient_support_mass must be finite and in [0, 1]")

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
            ("max_deficient_support_mass", self.max_deficient_support_mass,
             MAX_DEFICIENT_SUPPORT_MASS_CEILING),
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
    #: Mean candidate probability mass this policy places on actions the log provably could
    #: not have shown us -- see ``_deficient_support`` for what "provably" buys.
    deficient_support_mass: float = 0.0
    deficient_support_event_rate: float = 0.0
    #: ``None`` unless a validated outcome model was supplied. It is never a fallback for
    #: ``snips_reward``; a missing value means "not available", not "same number".
    doubly_robust_reward: float | None = None


LIMITATIONS = (
    # First, because it is the one a reader is most likely to skip and the only one that
    # biases the answer towards "the candidate is better".
    "The reported interval resamples events independently. Awaaz events cluster by speaker, "
    "the logged contract carries no grouping key by design (INV-11), and no cluster bootstrap "
    "is therefore possible: the true interval is WIDER than the one shown here and this "
    "result is anti-conservative in exactly the direction that favours the candidate.",
    "Offline agreement with logged explicit choices is a product-UX estimate, not a "
    "clinical outcome or treatment claim.",
    "Counterfactual validity depends on logged propensities, overlap, and policy predictions "
    "being produced without access to held-out feedback.",
    "Unmeasured context bias is not addressed by any gate in this module.",
    "A passing comparison authorises human offline review only; deployment and online patient "
    "experimentation remain forbidden.",
)

#: What the conservative criterion in ``_evaluate_improvement`` does and does not buy. These
#: travel on the decision object so a reader cannot obtain the verdict without the terms.
IMPROVEMENT_GUARANTEES = (
    "the lower end of the paired bootstrap interval on the SNIPS reward difference clears "
    "the preregistered minimum effect, so the ranking is not a tail artefact",
    "the point estimate agrees with the interval, so the verdict does not rest on an "
    "asymmetric bootstrap tail alone",
    "the improvement survives deleting the single most influential logged event, so it is "
    "not one high-weight observation wearing a population",
    "every gate -- overlap, effective sample size, weight magnitude, weight mass, propensity, "
    "logged-support sufficiency, and behaviour-policy randomisation -- passed at or above "
    "its absolute floor",
)
IMPROVEMENT_DOES_NOT_GUARANTEE = (
    "any correction for repeated-speaker clustering: the interval assumes independent "
    "events, the contract carries no grouping key, and the reported bound is therefore "
    "optimistic by an unknown amount",
    "any clinical benefit, intelligibility gain, or safety finding whatsoever",
    "anything about speakers, contexts, or candidate slates that the log does not contain",
    "that the reward definition in rewards.py is the outcome a patient actually cares about",
    "authorisation to deploy, to run an online experiment, or to make a clinical claim",
)


@dataclass(frozen=True, slots=True)
class DoublyRobustDiagnostic:
    """A secondary estimate, and a record of the model that was allowed to produce it.

    ``role`` is a read-only property for the same reason the authorisation answers below are:
    the PRD defers doubly robust until a validated outcome model exists, and the moment a
    result object can be edited to say DR was the primary estimate, the deferral is decided by
    whoever holds the object rather than by the policy. There is no keyword to set it.
    """

    outcome_model_id: str
    validation_id: str
    baseline_reward: float
    candidate_reward: float
    reward_delta: float

    @property
    def role(self) -> str:
        return "secondary_diagnostic_only"


@dataclass(frozen=True, slots=True)
class ImprovementDecision:
    """Why a status was or was not reached, in terms a reviewer can argue with.

    ``ComparisonStatus`` alone answers "which policy"; this answers "on what basis, and what
    is still unproven". It is a field on the result rather than a log line because the
    ``does_not_guarantee`` list is the part that gets dropped when a number is copied into a
    slide.
    """

    criterion: str
    minimum_effect: float
    point_estimate: float
    paired_lower_bound: float
    paired_upper_bound: float
    delta_without_most_influential_event: float
    direction: str | None
    met: bool
    unmet_conditions: tuple[str, ...]
    guarantees: tuple[str, ...] = IMPROVEMENT_GUARANTEES
    does_not_guarantee: tuple[str, ...] = IMPROVEMENT_DOES_NOT_GUARANTEE


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
    #: A first-class field, not a diagnostic: the fraction of the evaluated policy's
    #: probability mass that the log cannot speak to at all. ``None`` only when the
    #: comparison was blocked before any estimate existed.
    candidate_deficient_support_mass: float | None = None
    uncertainty_basis: str = UNCERTAINTY_BASIS
    improvement: ImprovementDecision | None = None
    doubly_robust: DoublyRobustDiagnostic | None = None
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

    @property
    def headline_estimator(self) -> str:
        """Always SNIPS. A property so no caller can promote the DR diagnostic.

        ``status``, ``reward_delta``, ``confidence_interval`` and ``improvement`` are all
        computed from SNIPS. ``doubly_robust`` is reported alongside and read by a human; if
        the two disagree, that disagreement is the finding, and the way to act on it is to
        improve the outcome model and re-review -- not to relabel which number was primary.
        """
        return HEADLINE_ESTIMATOR

    @property
    def clustered_uncertainty_available(self) -> bool:
        """Permanently false; see ``UNCERTAINTY_BASIS`` for why it cannot be made true here."""
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
        candidate_deficient_support_mass=(
            candidate.deficient_support_mass if candidate is not None else None
        ),
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


def _deficient_support(
    events: tuple[LoggedFeedback, ...],
    predictions: dict,
    *,
    min_logged_probability: float,
) -> list[float]:
    """Per-event candidate probability mass that the log provably cannot speak to.

    Only one action per event has an observed reward and a known propensity: the logged one.
    Mass on the other actions is normally fine -- a randomised logger shows each of them
    eventually, and that is the entire premise of importance weighting. Two situations break
    that premise, and both are provable from a single record rather than assumed:

    1. ``pi_0(logged) `` sits within ``min_logged_probability`` of 1. Because the slate's
       propensities sum to one, EVERY other action in that event provably had probability
       below the floor the config already refuses to divide by. The alternatives were not
       merely unobserved here; they were effectively unreachable.
    2. The evaluated policy places zero probability on the logged action. The one action with
       an observed reward is the one action the policy would never take, so its entire mass
       for that event rests on rewards nobody recorded.

    In both cases the unsupported quantity is ``1 - pi(logged)``: the mass sitting outside
    what the log can identify. Everywhere else the contribution is zero -- this function
    deliberately does not count ordinary unobserved actions as deficient, because doing so
    would flag every honest evaluation and a gate that always fires is a gate nobody reads.

    This is a LOWER BOUND on true support deficiency (Sachdeva, Su & Joachims, KDD 2020),
    not a measurement of it, and the number should not be read as one. The full quantity --
    candidate mass on actions whose logging probability really was zero -- needs pi_0 over
    the whole slate, which the contract does not record: it stores one propensity, for the
    action that was logged. Everything above is derived from the one thing a single record
    does prove, namely that a slate's propensities sum to one. When the logging contract
    grows slate-wide propensities, this function is where the exact quantity replaces the
    bound; until then a zero here means "nothing provable", never "nothing there".
    """
    masses: list[float] = []
    for event in events:
        policy_probability = predictions[event.event_id].probability_for(
            event.logged_action_id
        )
        residual = 1.0 - event.logged_action_probability
        if residual < min_logged_probability or policy_probability == 0.0:
            masses.append(1.0 - policy_probability)
        else:
            masses.append(0.0)
    return masses


def _doubly_robust(
    events: tuple[LoggedFeedback, ...],
    predictions: dict,
    outcome: dict,
    rewards: list[float],
    weights: list[float],
) -> float:
    """The standard DR estimator: model-based value plus propensity-corrected residual.

    ``sum_a pi(a|x) q(x, a)`` is what the reward model believes the policy is worth;
    ``w * (r - q(x, a_logged))`` corrects that belief wherever the log disagrees. It is
    reported only, never used to decide a status -- see ``headline_estimator``.
    """
    terms: list[float] = []
    for event, reward, weight in zip(events, rewards, weights, strict=True):
        model: OutcomeModelPrediction = outcome[event.event_id]
        prediction: PolicyPrediction = predictions[event.event_id]
        modelled = math.fsum(
            probability * model.reward_for(action)
            for action, probability in prediction.action_probabilities
        )
        residual = reward - model.reward_for(event.logged_action_id)
        terms.append(modelled + weight * residual)
    return math.fsum(terms) / len(terms)


def _estimate(
    policy_id: str,
    events: tuple[LoggedFeedback, ...],
    predictions: dict,
    rewards: list[float],
    weights: list[float],
    *,
    config: EvaluationConfig,
    outcome: dict | None = None,
) -> PolicyEstimate:
    weight_sum = math.fsum(weights)
    square_sum = math.fsum(value * value for value in weights)
    weighted_reward = math.fsum(
        weight * reward for weight, reward in zip(weights, rewards, strict=True)
    )
    n = len(rewards)
    deficient = _deficient_support(
        events,
        predictions,
        min_logged_probability=config.min_logged_probability,
    )
    return PolicyEstimate(
        policy_id=policy_id,
        events=n,
        ips_reward=weighted_reward / n,
        snips_reward=weighted_reward / weight_sum if weight_sum else float("nan"),
        effective_sample_size=(weight_sum * weight_sum / square_sum) if square_sum else 0.0,
        overlap_rate=sum(weight > 0.0 for weight in weights) / n,
        max_importance_weight=max(weights, default=0.0),
        weight_mass=weight_sum / n,
        deficient_support_mass=math.fsum(deficient) / n,
        deficient_support_event_rate=sum(mass > 0.0 for mass in deficient) / n,
        doubly_robust_reward=(
            _doubly_robust(events, predictions, outcome, rewards, weights)
            if outcome is not None
            else None
        ),
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
    if estimate.deficient_support_mass > config.max_deficient_support_mass:
        blockers.add(f"{label}:deficient_support_mass_above_maximum")
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


def _delta_without_most_influential_event(
    rewards: list[float],
    baseline_weights: list[float],
    candidate_weights: list[float],
) -> float:
    """The SNIPS delta with the single highest-weight event deleted.

    A self-normalised ratio with one dominant weight is that event's reward with extra steps.
    The bootstrap does not reliably catch it: a percentile interval built by resampling the
    same sixty events redraws the dominant event in roughly 63% of replicates, so its
    influence is present in most of the distribution rather than visible in its tail. Deleting
    it and re-checking is cheap, deterministic, and answers the question the reviewer actually
    has -- "would this survive if that one log line were wrong?"
    """
    influence = [
        max(baseline, candidate)
        for baseline, candidate in zip(baseline_weights, candidate_weights, strict=True)
    ]
    dropped = influence.index(max(influence))
    kept = [index for index in range(len(rewards)) if index != dropped]
    baseline = _snips(rewards, baseline_weights, kept)
    candidate = _snips(rewards, candidate_weights, kept)
    if baseline is None or candidate is None:
        # No positive weight mass left without that event: the improvement was that event.
        return float("-inf")
    return candidate - baseline


def _evaluate_improvement(
    *,
    delta: float,
    interval: tuple[float, float],
    leave_one_out_delta: float,
    config: EvaluationConfig,
) -> ImprovementDecision:
    """Decide improvement conservatively, and say what the decision is worth.

    The previous rule was a single inequality: the interval's lower end beats
    ``minimum_effect``. That is one number from one tail of one bootstrap, and it can be
    cleared by a skewed resampling distribution whose centre is nowhere near the effect, or by
    a single high-weight event that appears in most replicates. All three conditions below
    must hold, each is reported by name when it does not, and none of them replaces or relaxes
    an existing gate -- this runs only after every gate has already passed.

    The direction examined is the one the point estimate favours. Requiring both directions to
    be evaluated would be theatre: they are mutually exclusive by construction.
    """
    lower, upper = interval
    if delta >= 0.0:
        direction = "candidate"
        bound, point, dropped = lower, delta, leave_one_out_delta
    else:
        # Mirror image: the baseline wins when the UPPER end is below the negative effect.
        direction = "baseline"
        bound, point, dropped = -upper, -delta, -leave_one_out_delta

    unmet: list[str] = []
    if not bound > config.minimum_effect:
        unmet.append("paired_lower_bound_below_minimum_effect")
    if not point > config.minimum_effect:
        unmet.append("point_estimate_below_minimum_effect")
    if not dropped > config.minimum_effect:
        unmet.append("improvement_does_not_survive_influential_event_removal")

    return ImprovementDecision(
        criterion=IMPROVEMENT_CRITERION,
        minimum_effect=config.minimum_effect,
        point_estimate=delta,
        paired_lower_bound=lower,
        paired_upper_bound=upper,
        delta_without_most_influential_event=leave_one_out_delta,
        direction=direction if not unmet else None,
        met=not unmet,
        unmet_conditions=tuple(unmet),
    )


def compare_policies(
    events: tuple[LoggedFeedback, ...] | list[LoggedFeedback],
    *,
    baseline: OfflinePolicy,
    candidate: OfflinePolicy,
    reward_config: RewardConfig | None = None,
    config: EvaluationConfig | None = None,
    outcome_model: ValidatedOutcomeModel | None = None,
    request_doubly_robust: bool = False,
) -> OfflineComparison:
    """Compare two policies without authorising either one to touch a live speech path.

    Doubly robust is opt-in in BOTH directions, and a mismatch is a blocker rather than a
    default. Asking for it without a model must not quietly return a SNIPS number under a DR
    heading (PRD 11 defers DR until a validated outcome model exists), and supplying a model
    without asking must not silently switch the estimator underneath a caller who did not
    request it. Neither confusion has a safe default, so neither gets one.
    """
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
    if request_doubly_robust and outcome_model is None:
        blockers.add("doubly_robust_requires_validated_outcome_model")
    if outcome_model is not None and not request_doubly_robust:
        blockers.add("doubly_robust_requires_explicit_request")
    if outcome_model is not None:
        gate = gate_outcome_model(outcome_model)
        blockers.update(f"outcome_model:{reason}" for reason in gate.blockers)
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

    outcome_map: dict | None = None
    if outcome_model is not None and request_doubly_robust:
        outcome_map = {
            prediction.event_id: prediction for prediction in outcome_model.predictions
        }
        if set(outcome_map) != expected_event_ids:
            blockers.add("outcome_model:prediction_event_set_mismatch")
        for event in events:
            prediction = outcome_map.get(event.event_id)
            if (
                prediction is not None
                and prediction.action_ids != frozenset(event.candidate_action_ids)
            ):
                blockers.add("outcome_model:candidate_action_set_mismatch")

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
        events,
        prediction_maps["baseline"],
        rewards,
        baseline_weights,
        config=config,
        outcome=outcome_map,
    )
    candidate_estimate = _estimate(
        candidate.manifest.policy_id,
        events,
        prediction_maps["candidate"],
        rewards,
        candidate_weights,
        config=config,
        outcome=outcome_map,
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

    # Every number that decides a status below comes from SNIPS. The doubly-robust pair is
    # assembled afterwards and attached as a diagnostic; nothing reads it back.
    delta = candidate_estimate.snips_reward - baseline_estimate.snips_reward
    improvement = _evaluate_improvement(
        delta=delta,
        interval=interval,
        leave_one_out_delta=_delta_without_most_influential_event(
            rewards,
            baseline_weights,
            candidate_weights,
        ),
        config=config,
    )
    preferred: str | None = None
    if not improvement.met:
        status = ComparisonStatus.inconclusive
    elif improvement.direction == "candidate":
        status = ComparisonStatus.candidate_better_offline
        preferred = candidate.manifest.policy_id
    else:
        status = ComparisonStatus.baseline_better_offline
        preferred = baseline.manifest.policy_id

    doubly_robust: DoublyRobustDiagnostic | None = None
    if (
        outcome_model is not None
        and baseline_estimate.doubly_robust_reward is not None
        and candidate_estimate.doubly_robust_reward is not None
    ):
        doubly_robust = DoublyRobustDiagnostic(
            outcome_model_id=outcome_model.model_id,
            validation_id=outcome_model.validation.validation_id,
            baseline_reward=baseline_estimate.doubly_robust_reward,
            candidate_reward=candidate_estimate.doubly_robust_reward,
            reward_delta=(
                candidate_estimate.doubly_robust_reward
                - baseline_estimate.doubly_robust_reward
            ),
        )

    return OfflineComparison(
        status=status,
        reviewable=True,
        baseline=baseline_estimate,
        candidate=candidate_estimate,
        reward_delta=delta,
        confidence_interval=interval,
        offline_preferred_policy_id=preferred,
        blockers=(),
        candidate_deficient_support_mass=candidate_estimate.deficient_support_mass,
        improvement=improvement,
        doubly_robust=doubly_robust,
    )

