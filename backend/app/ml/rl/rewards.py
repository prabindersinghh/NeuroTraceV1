"""Auditable reward components derived only from explicit patient feedback."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .contracts import LoggedFeedback
from .safety import gate_logged_feedback


@dataclass(frozen=True, slots=True)
class RewardConfig:
    """Weights for preference alignment and the cost of a communication repair.

    There is deliberately no latency, pause length, tap speed, or session-duration term.
    Those signals reflect disability, fatigue, and access needs as readily as policy quality.
    Optimising them would pressure the product to interrupt the person it is meant to help.
    """

    explicit_preference_weight: float = 0.8
    repair_cost_weight: float = 0.2

    def __post_init__(self) -> None:
        values = (self.explicit_preference_weight, self.repair_cost_weight)
        if any(isinstance(value, bool) for value in values):
            raise ValueError("reward weights must be numeric")
        if any(not math.isfinite(float(value)) or float(value) < 0.0 for value in values):
            raise ValueError("reward weights must be finite and non-negative")
        if not math.isclose(math.fsum(values), 1.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("reward weights must sum to 1")


@dataclass(frozen=True, slots=True)
class RewardBreakdown:
    """Bounded components for one action; this is a UX signal, not a clinical score."""

    explicit_preference: float
    repair_cost: float
    total: float

    def to_dict(self) -> dict[str, float]:
        return {
            "explicit_preference": self.explicit_preference,
            "repair_cost": self.repair_cost,
            "total": self.total,
        }


def score_logged_action(
    event: LoggedFeedback,
    *,
    config: RewardConfig | None = None,
) -> RewardBreakdown:
    """Score the behaviour policy's logged top action.

    Positive reward requires an uncorrected explicit patient selection. Choosing another
    option, explicitly rejecting this option, correcting it, or leaving for the phrase board
    is negative evidence. The safety gate is repeated here so callers cannot bypass it by
    invoking the reward function directly.
    """
    gate = gate_logged_feedback(event)
    if not gate.allowed:
        raise ValueError(
            "feedback is not eligible for reward scoring: " + ", ".join(gate.blockers)
        )
    config = config or RewardConfig()
    feedback = event.feedback

    selected_logged = feedback.selected_action_id == event.logged_action_id
    negative_preference = (
        event.logged_action_id in feedback.rejected_action_ids
        or (
            feedback.selected_action_id is not None
            and feedback.selected_action_id != event.logged_action_id
        )
        or feedback.correction_made
        or feedback.phrase_board_fallback
    )
    if selected_logged and not feedback.correction_made:
        explicit_preference = 1.0
    elif negative_preference:
        explicit_preference = -1.0
    else:
        explicit_preference = 0.0

    # The phrase board is the designed safety fallback, not a failure to be trained away.
    # Charging repair cost for it on top of the negative preference above scored a fallback
    # at -1.0 against a bare rejection's -0.8 -- so the ranker was rewarded for keeping a
    # patient wrestling with poor candidates rather than letting them reach the board that
    # exists to protect them. PRD 20 lists the board as a mitigation and 22 makes it a
    # condition of done; a reward function that penalises taking it is optimising against
    # the product's own safety design. A correction is different: the patient did engage
    # with the candidate and then had to repair it, which is real interaction cost.
    repair_cost = -1.0 if feedback.correction_made else 0.0
    total = (
        config.explicit_preference_weight * explicit_preference
        + config.repair_cost_weight * repair_cost
    )
    return RewardBreakdown(
        explicit_preference=explicit_preference,
        repair_cost=repair_cost,
        total=float(total),
    )

