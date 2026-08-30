"""Fail-closed safety gates for the Awaaz offline feedback package."""
from __future__ import annotations

from dataclasses import dataclass

from ...awaaz.safety import SpeechProfile
from .contracts import (
    CollectionMode,
    FeedbackActor,
    LoggedFeedback,
    PolicyManifest,
    PolicyScope,
)


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

