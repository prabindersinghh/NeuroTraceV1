"""Fail-closed safety gates for the Awaaz offline feedback package."""
from __future__ import annotations

from dataclasses import dataclass

from ...awaaz.safety import SpeechProfile
from .contracts import (
    CollectionMode,
    FeedbackActor,
    LoggedFeedback,
    OutcomeValidationScheme,
    PolicyManifest,
    PolicyScope,
    ValidatedOutcomeModel,
)

#: The outcome-model gate takes no configuration. Every other gate in this package is tunable
#: in the stringent direction because a reviewer may reasonably demand more evidence than the
#: default; there is no reviewer who may reasonably demand *less* evidence before a reward
#: model is allowed to replace observed rewards, so these two numbers are constants rather
#: than ``EvaluationConfig`` fields. Nothing to tighten means nothing to loosen.

#: A calibration set smaller than the event floor cannot tell a calibrated model from a
#: lucky one, and the doubly-robust correction inherits that error directly.
OUTCOME_MODEL_MIN_HELD_OUT_EVENTS = 50
#: Mean absolute error above 0.25 on a reward spanning [-1, 1] means the model is wrong by
#: more than an eighth of the full scale; the "robust" half of doubly robust is then the only
#: half working, and SNIPS already provides that without the extra machinery.
OUTCOME_MODEL_MAX_CALIBRATION_ERROR = 0.25


@dataclass(frozen=True, slots=True)
class GateResult:
    allowed: bool
    blockers: tuple[str, ...]


def _result(blockers: list[str]) -> GateResult:
    ordered = tuple(sorted(set(blockers)))
    return GateResult(allowed=not ordered, blockers=ordered)


def gate_policy(manifest: PolicyManifest) -> GateResult:
    """Allow only offline ranking among pre-existing candidate IDs.

    This gate is an allow-list rather than a collection of known bad policy types. A future
    capability therefore starts blocked until this function is deliberately reviewed.
    """
    blockers: list[str] = []
    if manifest.scope is not PolicyScope.candidate_ranking:
        blockers.append("scope_not_candidate_ranking")
    if not manifest.offline_only:
        blockers.append("policy_not_offline_only")
    if manifest.uses_online_exploration:
        blockers.append("online_exploration_forbidden")
    if manifest.can_generate_text:
        blockers.append("candidate_generation_forbidden")
    if manifest.can_change_confirmation_gate:
        blockers.append("confirmation_gate_is_out_of_scope")
    if manifest.can_trigger_speech:
        blockers.append("speech_trigger_is_out_of_scope")
    if manifest.makes_clinical_claims:
        blockers.append("clinical_claims_forbidden")
    return _result(blockers)


def gate_logged_feedback(event: LoggedFeedback) -> GateResult:
    """Decide whether a log item is eligible for non-clinical offline scoring."""
    blockers: list[str] = []
    if event.collection_mode is not CollectionMode.passive_observation:
        blockers.append("feedback_not_passively_observed")
    if event.speech_profile is not SpeechProfile.dysarthria_dominant:
        blockers.append("profile_outside_dysarthria_mvp")
    if event.emergency:
        blockers.append("emergency_feedback_forbidden")
    if not event.confirmation_required:
        blockers.append("confirmation_path_required")
    if event.feedback.actor is not FeedbackActor.patient:
        blockers.append("caregiver_label_is_not_patient_preference")

    selected = event.feedback.selected_action_id
    if selected is not None and not event.confirmation_observed:
        blockers.append("selected_action_lacks_confirmation")
    if selected is None and event.confirmation_observed:
        blockers.append("confirmation_has_no_selected_action")
    if event.output_spoken and not event.confirmation_observed:
        blockers.append("unconfirmed_output_was_spoken")
    if event.output_spoken and selected is None:
        blockers.append("spoken_output_has_no_selected_action")
    return _result(blockers)



def gate_outcome_model(model: ValidatedOutcomeModel) -> GateResult:
    """Decide whether a reward model may participate in a doubly-robust estimate.

    Doubly robust is only "doubly" robust when the outcome model is independent evidence.
    A model fitted on the very events being evaluated predicts their rewards by memory, the
    residual ``r - q(x, a)`` collapses towards zero, the propensity correction stops
    correcting, and the estimator quietly becomes the reward model's own opinion of itself
    wearing a causal name. Every blocker below is a way that independence fails.
    """
    blockers: list[str] = []
    validation = model.validation
    if validation.scheme is not OutcomeValidationScheme.grouped_holdout:
        # A random event split leaves a speaker's own events on both sides of the line, so the
        # reported error measures memorisation of that speaker, not generalisation to the next
        # one. PRD 10.3 requires the split to be by patient before any fitting.
        blockers.append("outcome_model_validation_split_not_grouped")
    if not validation.fitted_without_evaluation_events:
        blockers.append("outcome_model_fitted_on_evaluation_events")
    if validation.held_out_events < OUTCOME_MODEL_MIN_HELD_OUT_EVENTS:
        blockers.append("outcome_model_holdout_below_minimum")
    if validation.calibration_error > OUTCOME_MODEL_MAX_CALIBRATION_ERROR:
        blockers.append("outcome_model_calibration_error_above_maximum")
    if not model.predictions:
        blockers.append("outcome_model_has_no_predictions")
    return _result(blockers)
