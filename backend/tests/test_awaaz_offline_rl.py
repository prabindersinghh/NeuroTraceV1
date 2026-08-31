"""Safety and reproducibility checks for the offline-only Awaaz policy scaffold."""
from __future__ import annotations

import json
import uuid
from dataclasses import replace

import pytest

from app.awaaz.safety import SpeechProfile
from app.ml.rl import (
    CollectionMode,
    ComparisonStatus,
    EvaluationConfig,
    ExplicitFeedback,
    FeedbackActor,
    LoggedFeedback,
    OfflineComparison,
    OfflinePolicy,
    OutcomeModelPrediction,
    OutcomeModelValidation,
    OutcomeValidationScheme,
    PolicyManifest,
    PolicyPrediction,
    RewardConfig,
    ValidatedOutcomeModel,
    compare_policies,
    gate_logged_feedback,
    gate_outcome_model,
    gate_policy,
    score_logged_action,
)
from app.ml.rl import offline
from app.ml.rl.simulate import _events as simulate_events
from app.ml.rl.simulate import run_scenarios, run_simulation


def _event(index: int, *, positive: bool, emergency: bool = False) -> LoggedFeedback:
    event_id = uuid.UUID(int=index + 1)
    logged = uuid.UUID(int=10_000 + index * 2)
    other = uuid.UUID(int=10_001 + index * 2)
    feedback = ExplicitFeedback(
        actor=FeedbackActor.patient,
        selected_action_id=logged if positive else other,
        correction_made=not positive,
    )
    return LoggedFeedback(
        event_id=event_id,
        behavior_policy_id="observed-v1",
        candidate_action_ids=(logged, other),
        logged_action_id=logged,
        logged_action_probability=0.5,
        speech_profile=SpeechProfile.dysarthria_dominant,
        confirmation_required=True,
        confirmation_observed=True,
        output_spoken=True,
        emergency=emergency,
        feedback=feedback,
    )


def _policy(policy_id: str, events: list[LoggedFeedback], *, preference_aware: bool):
    predictions = []
    for index, event in enumerate(events):
        logged, other = event.candidate_action_ids
        logged_probability = 0.9 if preference_aware and index % 2 == 0 else (
            0.1 if preference_aware else 0.5
        )
        predictions.append(PolicyPrediction(
            event_id=event.event_id,
            action_probabilities=(
                (logged, logged_probability),
                (other, 1.0 - logged_probability),
            ),
        ))
    return OfflinePolicy(
        manifest=PolicyManifest(policy_id=policy_id),
        predictions=tuple(predictions),
    )


def test_feedback_log_is_deterministic_and_contains_no_text_audio_or_patient_id():
    event = _event(0, positive=True)
    payload = event.canonical_json()
    assert event.fingerprint() == event.fingerprint()
    for forbidden in ("patient_id", "transcript", "target_text", "audio", "wav"):
        assert forbidden not in payload.lower()


def test_online_exploration_is_rejected_by_the_policy_gate():
    gate = gate_policy(PolicyManifest(
        policy_id="unsafe-v1",
        offline_only=False,
        uses_online_exploration=True,
        can_trigger_speech=True,
    ))
    assert not gate.allowed
    assert set(gate.blockers) >= {
        "policy_not_offline_only",
        "online_exploration_forbidden",
        "speech_trigger_is_out_of_scope",
    }


def test_emergency_or_caregiver_feedback_cannot_become_reward():
    emergency = _event(0, positive=True, emergency=True)
    assert not gate_logged_feedback(emergency).allowed
    with pytest.raises(ValueError, match="not eligible"):
        score_logged_action(emergency)

    normal = _event(1, positive=True)
    caregiver = replace(
        normal,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.caregiver,
            selected_action_id=normal.logged_action_id,
        ),
    )
    assert "caregiver_label_is_not_patient_preference" in gate_logged_feedback(caregiver).blockers


def test_offline_comparison_is_reproducible_and_never_authorises_deployment():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    baseline = _policy("baseline-v1", events, preference_aware=False)
    candidate = _policy("candidate-v1", events, preference_aware=True)
    config = EvaluationConfig(bootstrap_replicates=200, seed=42)

    first = compare_policies(events, baseline=baseline, candidate=candidate, config=config)
    second = compare_policies(events, baseline=baseline, candidate=candidate, config=config)

    assert first == second
    assert first.status is ComparisonStatus.candidate_better_offline
    assert first.reviewable
    assert first.offline_preferred_policy_id == "candidate-v1"
    assert not first.deployment_allowed
    assert not first.online_experiment_allowed
    assert not first.clinical_claim_allowed


def test_missing_logged_support_blocks_counterfactual_claims():
    events = [_event(i, positive=True) for i in range(10)]
    baseline = _policy("baseline-v1", events, preference_aware=False)
    candidate = _policy("candidate-v1", events, preference_aware=True)
    result = compare_policies(events, baseline=baseline, candidate=candidate)
    assert result.status is ComparisonStatus.blocked
    assert "insufficient_event_count" in result.blockers
    assert not result.reviewable


def test_synthetic_simulation_is_explicitly_non_deployable():
    first = run_simulation()
    second = run_simulation()
    assert first == second
    assert first["synthetic"] is True
    assert first["model_trained"] is False
    assert first["patient_data_used"] is False
    assert first["status"] == "candidate_better_offline"
    assert first["deployment_allowed"] is False
    assert first["online_experiment_allowed"] is False
    assert first["clinical_claim_allowed"] is False


# ---------------------------------------------------------------------------
# Helpers for the gate-level tests below. `_matched_policy` is the neutral one:
# it predicts exactly the behaviour policy's own propensity, so every importance
# weight is 1.0 and it never contributes a blocker of its own. That keeps a test
# about the candidate side from failing for a reason on the baseline side.
# ---------------------------------------------------------------------------


def _two_candidate_prediction(event, logged_probability):
    other = next(
        action for action in event.candidate_action_ids if action != event.logged_action_id
    )
    return PolicyPrediction(
        event_id=event.event_id,
        action_probabilities=(
            (event.logged_action_id, logged_probability),
            (other, 1.0 - logged_probability),
        ),
    )


def _matched_policy(policy_id: str, events: list[LoggedFeedback]) -> OfflinePolicy:
    return OfflinePolicy(
        manifest=PolicyManifest(policy_id=policy_id),
        predictions=tuple(
            _two_candidate_prediction(event, event.logged_action_probability)
            for event in events
        ),
    )


def _shaped_policy(policy_id: str, events: list[LoggedFeedback], probability_for) -> OfflinePolicy:
    """A policy whose probability on each logged action is chosen by the test."""
    return OfflinePolicy(
        manifest=PolicyManifest(policy_id=policy_id),
        predictions=tuple(
            _two_candidate_prediction(event, probability_for(index))
            for index, event in enumerate(events)
        ),
    )


def _events_with(probabilities: list[float]) -> list[LoggedFeedback]:
    return [
        replace(_event(index, positive=index % 2 == 0), logged_action_probability=probability)
        for index, probability in enumerate(probabilities)
    ]


# --- C1: a behaviour policy that never randomised cannot be evaluated ---------


def test_a_logging_policy_that_never_randomised_is_refused_instead_of_scored():
    events = _events_with([1.0] * 60)
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "logging_policy_is_deterministic" in result.blockers
    assert result.confidence_interval is None
    assert result.offline_preferred_policy_id is None


def test_an_occasional_certain_logged_action_does_not_condemn_a_randomised_log():
    tolerated = _events_with([1.0] * 6 + [0.5] * 54)
    result = compare_policies(
        tolerated,
        baseline=_policy("baseline-v1", tolerated, preference_aware=False),
        candidate=_policy("candidate-v1", tolerated, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert "logging_policy_is_deterministic" not in result.blockers

    too_many = _events_with([1.0] * 7 + [0.5] * 53)
    crossed = compare_policies(
        too_many,
        baseline=_policy("baseline-v1", too_many, preference_aware=False),
        candidate=_policy("candidate-v1", too_many, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert "logging_policy_is_deterministic" in crossed.blockers


def test_the_deterministic_logging_rate_may_be_tightened_but_never_relaxed():
    events = _events_with([1.0] * 3 + [0.5] * 57)
    strict = EvaluationConfig(
        bootstrap_replicates=200,
        max_deterministic_event_rate=0.0,
        deterministic_probability_threshold=0.99,
    )
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=strict,
    )
    assert "logging_policy_is_deterministic" in result.blockers
    with pytest.raises(ValueError, match="stringency ceiling"):
        EvaluationConfig(max_deterministic_event_rate=0.9)
    with pytest.raises(ValueError, match="stringency ceiling"):
        EvaluationConfig(deterministic_probability_threshold=0.99999)


# --- C2: the authorisation answers are not data anyone can supply ------------


def test_deployment_authorisation_cannot_be_forged_on_a_comparison_result():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    with pytest.raises(TypeError):
        replace(result, deployment_allowed=True)
    with pytest.raises(TypeError):
        replace(result, online_experiment_allowed=True)
    with pytest.raises(TypeError):
        replace(result, clinical_claim_allowed=True)
    # A frozen dataclass refuses the assignment before the missing property setter is even
    # consulted, so the exception type is the dataclass's, not AttributeError.
    with pytest.raises((AttributeError, TypeError)):
        result.deployment_allowed = True
    assert not result.deployment_allowed
    assert not result.online_experiment_allowed
    assert not result.clinical_claim_allowed


def test_a_hand_built_comparison_cannot_declare_itself_deployable():
    fields = {
        "status": ComparisonStatus.candidate_better_offline,
        "reviewable": True,
        "baseline": None,
        "candidate": None,
        "reward_delta": 1.0,
        "confidence_interval": (0.9, 1.0),
        "offline_preferred_policy_id": "candidate-v1",
        "blockers": (),
    }
    for forged in (
        "deployment_allowed",
        "online_experiment_allowed",
        "clinical_claim_allowed",
    ):
        with pytest.raises(TypeError):
            OfflineComparison(**fields, **{forged: True})
    assert OfflineComparison(**fields).deployment_allowed is False


# --- C3: the hard gates have floors -----------------------------------------


def test_evaluation_config_refuses_every_gate_weaker_than_its_documented_floor():
    weakened = (
        {"min_events": 2},
        {"min_effective_sample_size": 1e-9},
        {"min_overlap_rate": 1e-9},
        {"min_logged_probability": 1e-9},
        {"max_importance_weight": 1e9},
        {"min_weight_mass": 1e-9},
        {"max_weight_mass": 100.0},
        {"minimum_effect": 0.0},
        {"bootstrap_replicates": 100},
        {"confidence_level": 0.5},
    )
    for kwargs in weakened:
        with pytest.raises(ValueError):
            EvaluationConfig(**kwargs)


def test_evaluation_config_still_accepts_a_configuration_stricter_than_the_defaults():
    config = EvaluationConfig(
        min_events=200,
        min_effective_sample_size=100.0,
        min_overlap_rate=0.95,
        min_logged_probability=0.10,
        max_importance_weight=5.0,
        min_weight_mass=0.80,
        max_weight_mass=1.20,
        minimum_effect=0.20,
        bootstrap_replicates=2_000,
        confidence_level=0.99,
    )
    assert config.min_events == 200
    assert config.minimum_effect == 0.20


def test_a_two_event_comparison_with_a_zero_minimum_effect_can_no_longer_be_requested():
    with pytest.raises(ValueError, match="min_events"):
        EvaluationConfig(min_events=2, minimum_effect=0.0)


# --- C11: the propensity belongs to the logged action ------------------------


def test_a_propensity_recorded_against_a_different_action_than_the_logged_one_is_rejected():
    event = _event(0, positive=True)
    other = event.candidate_action_ids[1]
    with pytest.raises(ValueError, match="probability of logged_action_id"):
        replace(event, logged_action_probability=0.9, top_ranked_action_id=other)


def test_a_re_ranked_logged_action_is_accepted_when_its_own_probability_was_recorded():
    event = _event(0, positive=True)
    other = event.candidate_action_ids[1]
    re_ranked = replace(event, logged_action_probability=0.4, top_ranked_action_id=other)
    assert re_ranked.top_ranked_action_id == other
    assert re_ranked.logged_action_probability == 0.4
    assert re_ranked.to_dict()["top_ranked_action_id"] == str(other)


def test_declaring_the_logged_action_itself_as_top_ranked_permits_a_high_propensity():
    event = _event(0, positive=True)
    confident = replace(
        event,
        logged_action_probability=0.9,
        top_ranked_action_id=event.logged_action_id,
    )
    assert confident.logged_action_probability == 0.9


def test_top_ranked_action_id_must_be_one_of_the_offered_candidates():
    event = _event(0, positive=True)
    with pytest.raises(ValueError, match="top_ranked_action_id"):
        replace(event, top_ranked_action_id=uuid.UUID(int=999_999))


# --- estimate-level blockers -------------------------------------------------


def test_a_candidate_policy_without_overlap_on_the_logged_actions_is_blocked():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 0.0 if index % 2 == 0 else 0.5,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:overlap_below_minimum" in result.blockers
    assert result.candidate is not None and result.candidate.overlap_rate == 0.5


def test_a_candidate_estimate_carried_by_a_few_events_is_blocked_on_effective_sample_size():
    # Five events at a 0.1 propensity carry weight 10; the other 55 carry weight 0.2. The
    # mean weight is still ~1, so only the effective sample size notices that the estimate
    # is really five observations wearing sixty.
    events = _events_with([0.1] * 5 + [0.5] * 55)
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 1.0 if index < 5 else 0.1,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:effective_sample_size_below_minimum" in result.blockers
    assert result.candidate is not None
    assert result.candidate.effective_sample_size < 25.0


def test_an_extreme_importance_weight_blocks_the_comparison():
    events = _events_with([0.05] * 60)
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy("candidate-v1", events, lambda index: 1.0),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:importance_weight_above_maximum" in result.blockers
    assert "candidate:weight_mass_above_maximum" in result.blockers
    assert result.candidate is not None
    assert result.candidate.max_importance_weight == 20.0


def test_a_candidate_that_systematically_avoids_the_logged_actions_fails_the_weight_mass_gate():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy("candidate-v1", events, lambda index: 0.2),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:weight_mass_below_minimum" in result.blockers
    assert result.candidate is not None
    assert result.candidate.weight_mass == pytest.approx(0.4)


def test_a_candidate_with_no_weight_at_all_reports_a_non_finite_estimate_rather_than_a_number():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy("candidate-v1", events, lambda index: 0.0),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:estimate_not_finite" in result.blockers
    assert result.reward_delta is None


def test_a_bootstrap_with_no_positive_weight_mass_yields_no_interval():
    # Reachable only defensively once the overlap and weight-mass gates are in force, so it
    # is exercised directly rather than through a log that could not get this far.
    interval, valid = offline._bootstrap_delta(
        [1.0, -1.0, 0.0],
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 0.0],
        EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert interval is None
    assert valid == 0


# --- comparison-level blockers ----------------------------------------------


def test_a_repeated_event_id_blocks_the_comparison():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events + [events[0]],
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy("candidate-v1", events, lambda index: 0.6),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "duplicate_event_id" in result.blockers


def test_a_policy_cannot_be_compared_against_itself():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("same-v1", events),
        candidate=_shaped_policy("same-v1", events, lambda index: 0.6),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "policies_must_have_distinct_ids" in result.blockers


def test_a_policy_that_did_not_predict_every_logged_event_is_blocked():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_matched_policy("candidate-v1", events[:-1]),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:prediction_event_set_mismatch" in result.blockers


def test_a_prediction_over_a_different_candidate_set_is_blocked():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    honest = _matched_policy("candidate-v1", events)
    tampered = OfflinePolicy(
        manifest=honest.manifest,
        predictions=(
            PolicyPrediction(
                event_id=events[0].event_id,
                action_probabilities=(
                    (uuid.UUID(int=900_001), 0.5),
                    (uuid.UUID(int=900_002), 0.5),
                ),
            ),
        ) + honest.predictions[1:],
    )
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=tampered,
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:candidate_action_set_mismatch" in result.blockers


def test_a_propensity_below_the_configured_minimum_blocks_the_comparison():
    events = _events_with([0.01] + [0.5] * 59)
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy("candidate-v1", events, lambda index: 0.6),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "logged_probability_below_minimum" in result.blockers


# --- statuses other than candidate_better_offline ----------------------------


def test_a_worse_candidate_is_reported_as_baseline_better_offline():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=True),
        candidate=_policy("candidate-v1", events, preference_aware=False),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.baseline_better_offline
    assert result.offline_preferred_policy_id == "baseline-v1"
    assert result.reward_delta is not None and result.reward_delta < 0
    assert not result.deployment_allowed


def test_two_indistinguishable_policies_are_reported_as_inconclusive_not_as_a_winner():
    events = [_event(i, positive=i % 2 == 0) for i in range(60)]
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_matched_policy("candidate-v1", events),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.inconclusive
    assert result.offline_preferred_policy_id is None
    assert result.reviewable
    assert result.reward_delta == pytest.approx(0.0)


# --- the remaining safety gates ---------------------------------------------


def test_every_forbidden_policy_capability_produces_its_own_blocker():
    gate = gate_policy(PolicyManifest(
        policy_id="unsafe-v2",
        offline_only=False,
        uses_online_exploration=True,
        can_generate_text=True,
        can_change_confirmation_gate=True,
        can_trigger_speech=True,
        makes_clinical_claims=True,
    ))
    assert not gate.allowed
    assert set(gate.blockers) == {
        "policy_not_offline_only",
        "online_exploration_forbidden",
        "candidate_generation_forbidden",
        "confirmation_gate_is_out_of_scope",
        "speech_trigger_is_out_of_scope",
        "clinical_claims_forbidden",
    }


def test_a_compliant_ranking_policy_passes_the_policy_gate():
    assert gate_policy(PolicyManifest(policy_id="safe-v1")).allowed


def test_replayed_or_non_dysarthric_events_are_not_eligible_for_scoring():
    event = _event(0, positive=True)
    replayed = replace(event, collection_mode=CollectionMode.offline_replay)
    assert "feedback_not_passively_observed" in gate_logged_feedback(replayed).blockers

    aphasic = replace(event, speech_profile=SpeechProfile.aphasia_dominant)
    assert "profile_outside_dysarthria_mvp" in gate_logged_feedback(aphasic).blockers

    mixed = replace(event, speech_profile=SpeechProfile.mixed)
    assert "profile_outside_dysarthria_mvp" in gate_logged_feedback(mixed).blockers


def test_an_event_that_never_required_confirmation_is_not_eligible_for_scoring():
    event = replace(_event(0, positive=True), confirmation_required=False)
    assert "confirmation_path_required" in gate_logged_feedback(event).blockers


def test_a_selection_without_an_observed_confirmation_is_not_a_preference():
    event = replace(
        _event(0, positive=True),
        confirmation_observed=False,
        output_spoken=False,
    )
    assert "selected_action_lacks_confirmation" in gate_logged_feedback(event).blockers


def test_a_confirmation_with_nothing_selected_is_refused():
    event = _event(0, positive=True)
    rejection_only = replace(
        event,
        output_spoken=False,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            rejected_action_ids=(event.logged_action_id,),
        ),
    )
    assert "confirmation_has_no_selected_action" in gate_logged_feedback(rejection_only).blockers


def test_speech_without_a_confirmed_selection_is_blocked_because_of_inv_9():
    # INV-9: nothing is spoken for an aphasic patient without confirmation. An event whose log
    # says speech happened anyway is evidence of a broken speech path, so it is refused as
    # training signal rather than quietly rewarded for the tap it never received.
    spoken_unconfirmed = replace(_event(0, positive=True), confirmation_observed=False)
    blockers = gate_logged_feedback(spoken_unconfirmed).blockers
    assert "unconfirmed_output_was_spoken" in blockers
    assert "selected_action_lacks_confirmation" in blockers

    event = _event(1, positive=True)
    spoken_without_selection = replace(
        event,
        confirmation_observed=False,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            rejected_action_ids=(event.logged_action_id,),
        ),
    )
    assert "spoken_output_has_no_selected_action" in gate_logged_feedback(
        spoken_without_selection
    ).blockers


# --- the actual reward numbers ----------------------------------------------


def test_an_uncorrected_explicit_selection_of_the_logged_action_scores_exactly_zero_point_eight():
    breakdown = score_logged_action(_event(0, positive=True))
    assert breakdown.explicit_preference == 1.0
    assert breakdown.repair_cost == 0.0
    assert breakdown.total == pytest.approx(0.8)


def test_choosing_another_candidate_and_correcting_it_scores_the_worst_available_value():
    breakdown = score_logged_action(_event(0, positive=False))
    assert breakdown.explicit_preference == -1.0
    assert breakdown.repair_cost == -1.0
    assert breakdown.total == pytest.approx(-1.0)


def test_rejecting_the_logged_action_is_negative_preference_without_a_repair_cost():
    event = _event(0, positive=True)
    rejection = replace(
        event,
        confirmation_observed=False,
        output_spoken=False,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            rejected_action_ids=(event.logged_action_id,),
        ),
    )
    breakdown = score_logged_action(rejection)
    assert breakdown.explicit_preference == -1.0
    assert breakdown.repair_cost == 0.0
    assert breakdown.total == pytest.approx(-0.8)


def test_reaching_the_phrase_board_is_not_punished_harder_than_a_plain_rejection():
    """The safety fallback must never be the worst outcome the reward function can express.

    This previously charged a repair cost on top of the negative preference, scoring a
    fallback at -1.0 against a bare rejection's -0.8. That ordering trains the ranker to
    keep a patient wrestling with poor candidates rather than let them reach the board --
    optimising against the mitigation PRD 20 names and the done-condition PRD 22 sets.

    A correction still carries repair cost: the patient engaged with the candidate and then
    had to fix it, which is real interaction cost. Walking away to the board is not.
    """
    event = _event(0, positive=True)

    def outcome(**kwargs):
        return score_logged_action(
            replace(
                event,
                confirmation_observed=False,
                output_spoken=False,
                feedback=ExplicitFeedback(actor=FeedbackActor.patient, **kwargs),
            )
        )

    fallback = outcome(phrase_board_fallback=True)
    rejection = outcome(rejected_action_ids=(event.logged_action_id,))

    assert fallback.explicit_preference == -1.0
    assert fallback.repair_cost == 0.0
    assert fallback.total == pytest.approx(-0.8)
    assert fallback.total >= rejection.total, (
        "the designed safety fallback scored worse than an outright rejection"
    )


def test_a_selection_that_had_to_be_corrected_is_not_rewarded_for_being_selected():
    event = _event(0, positive=True)
    corrected = replace(
        event,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            selected_action_id=event.logged_action_id,
            correction_made=True,
        ),
    )
    breakdown = score_logged_action(corrected)
    assert breakdown.explicit_preference == -1.0
    assert breakdown.total == pytest.approx(-1.0)


def test_rejecting_only_an_unlogged_candidate_is_neutral_evidence_about_the_logged_one():
    event = _event(0, positive=True)
    other = event.candidate_action_ids[1]
    neutral = replace(
        event,
        confirmation_observed=False,
        output_spoken=False,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            rejected_action_ids=(other,),
        ),
    )
    breakdown = score_logged_action(neutral)
    assert breakdown.explicit_preference == 0.0
    assert breakdown.repair_cost == 0.0
    assert breakdown.total == pytest.approx(0.0)
    assert breakdown.to_dict() == {
        "explicit_preference": 0.0,
        "repair_cost": 0.0,
        "total": 0.0,
    }


def test_reward_weights_must_be_a_convex_split_between_preference_and_repair():
    with pytest.raises(ValueError, match="sum to 1"):
        RewardConfig(explicit_preference_weight=0.9, repair_cost_weight=0.9)
    with pytest.raises(ValueError, match="non-negative"):
        RewardConfig(explicit_preference_weight=1.5, repair_cost_weight=-0.5)
    reweighted = RewardConfig(explicit_preference_weight=0.5, repair_cost_weight=0.5)
    breakdown = score_logged_action(_event(0, positive=True), config=reweighted)
    assert breakdown.total == pytest.approx(0.5)


# --- the simulation's own logging policy ------------------------------------


def test_the_simulated_behaviour_policy_actually_randomises_over_its_candidates():
    events = simulate_events(60, seed=42)
    logged_first = sum(
        event.logged_action_id == event.candidate_action_ids[0] for event in events
    )
    assert 0 < logged_first < len(events)
    assert len({event.logged_action_probability for event in events}) > 1
    assert all(0.0 < event.logged_action_probability < 1.0 for event in events)


# --- C12: doubly robust is unreachable without a validated outcome model -----
#
# PRD 11: "Doubly robust estimators may be added only after a separately validated outcome
# model exists." These tests exist to make that sentence unfalsifiable in code: there is no
# argument shape that produces a DR number without an attestation, and no attestation shape
# that can be written without its evidence.


def _valid_validation(**overrides) -> OutcomeModelValidation:
    fields = {
        "validation_id": "validation-001",
        "scheme": OutcomeValidationScheme.grouped_holdout,
        "held_out_events": 120,
        "calibration_error": 0.10,
        "fitted_without_evaluation_events": True,
        "reviewer_reference": "reviewer-ref-001",
    }
    fields.update(overrides)
    return OutcomeModelValidation(**fields)


def _outcome_model(events, *, validation=None, model_id="outcome-v1", cover=None):
    covered = events if cover is None else cover
    return ValidatedOutcomeModel(
        model_id=model_id,
        validation=validation or _valid_validation(),
        predictions=tuple(
            OutcomeModelPrediction(
                event_id=event.event_id,
                # Deliberately imperfect and asymmetric: a model that predicted the logged
                # reward exactly would make the DR residual vanish and DR would coincide
                # with SNIPS, which would prove nothing about the two being separate.
                action_rewards=tuple(
                    (action, 0.5 if action == event.logged_action_id else -0.2)
                    for action in event.candidate_action_ids
                ),
            )
            for event in covered
        ),
    )


def _sixty_events():
    return [_event(i, positive=i % 2 == 0) for i in range(60)]


def test_doubly_robust_is_refused_outright_when_no_validated_outcome_model_is_supplied():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        request_doubly_robust=True,
    )
    assert result.status is ComparisonStatus.blocked
    assert "doubly_robust_requires_validated_outcome_model" in result.blockers
    # The refusal is not a fallback: no estimate is produced at all.
    assert result.reward_delta is None
    assert result.doubly_robust is None


def test_a_comparison_without_an_outcome_model_reports_no_doubly_robust_number_at_all():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.candidate_better_offline
    assert result.doubly_robust is None
    assert result.baseline.doubly_robust_reward is None
    assert result.candidate.doubly_robust_reward is None


def test_supplying_an_outcome_model_without_requesting_doubly_robust_is_refused():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        outcome_model=_outcome_model(events),
    )
    assert result.status is ComparisonStatus.blocked
    assert "doubly_robust_requires_explicit_request" in result.blockers


def test_an_outcome_model_validation_record_cannot_be_written_without_its_evidence():
    with pytest.raises(TypeError):
        OutcomeModelValidation()
    with pytest.raises(ValueError, match="held_out_events"):
        _valid_validation(held_out_events=-1)
    with pytest.raises(ValueError, match="calibration_error"):
        _valid_validation(calibration_error=float("nan"))
    with pytest.raises(ValueError, match="fitted_without_evaluation_events"):
        _valid_validation(fitted_without_evaluation_events="yes")
    with pytest.raises(ValueError, match="scheme"):
        _valid_validation(scheme="whatever_split")


def test_an_outcome_model_validated_on_a_random_event_split_is_refused_by_its_gate():
    events = _sixty_events()
    model = _outcome_model(
        events,
        validation=_valid_validation(
            scheme=OutcomeValidationScheme.random_event_holdout,
        ),
    )
    assert "outcome_model_validation_split_not_grouped" in gate_outcome_model(model).blockers
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        outcome_model=model,
        request_doubly_robust=True,
    )
    assert result.status is ComparisonStatus.blocked
    assert "outcome_model:outcome_model_validation_split_not_grouped" in result.blockers


def test_an_outcome_model_fitted_on_the_evaluation_events_cannot_be_doubly_robust():
    events = _sixty_events()
    model = _outcome_model(
        events,
        validation=_valid_validation(fitted_without_evaluation_events=False),
    )
    assert "outcome_model_fitted_on_evaluation_events" in gate_outcome_model(model).blockers


def test_a_small_holdout_or_a_poorly_calibrated_outcome_model_is_refused():
    events = _sixty_events()
    small = _outcome_model(events, validation=_valid_validation(held_out_events=10))
    assert "outcome_model_holdout_below_minimum" in gate_outcome_model(small).blockers
    uncalibrated = _outcome_model(
        events,
        validation=_valid_validation(calibration_error=0.4),
    )
    assert (
        "outcome_model_calibration_error_above_maximum"
        in gate_outcome_model(uncalibrated).blockers
    )


def test_an_outcome_model_with_no_predictions_is_refused():
    model = ValidatedOutcomeModel(model_id="empty-v1", validation=_valid_validation())
    assert "outcome_model_has_no_predictions" in gate_outcome_model(model).blockers


def test_an_outcome_model_that_does_not_cover_every_logged_event_blocks_the_comparison():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        outcome_model=_outcome_model(events, cover=events[:-1]),
        request_doubly_robust=True,
    )
    assert result.status is ComparisonStatus.blocked
    assert "outcome_model:prediction_event_set_mismatch" in result.blockers


def test_an_outcome_model_scoring_a_different_action_set_blocks_the_comparison():
    events = _sixty_events()
    honest = _outcome_model(events)
    tampered = ValidatedOutcomeModel(
        model_id=honest.model_id,
        validation=honest.validation,
        predictions=(
            OutcomeModelPrediction(
                event_id=events[0].event_id,
                action_rewards=(
                    (uuid.UUID(int=800_001), 0.5),
                    (uuid.UUID(int=800_002), -0.5),
                ),
            ),
        ) + honest.predictions[1:],
    )
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        outcome_model=tampered,
        request_doubly_robust=True,
    )
    assert result.status is ComparisonStatus.blocked
    assert "outcome_model:candidate_action_set_mismatch" in result.blockers


def test_an_outcome_model_may_not_predict_a_reward_outside_the_achievable_range():
    with pytest.raises(ValueError, match="achievable reward range"):
        OutcomeModelPrediction(
            event_id=uuid.UUID(int=1),
            action_rewards=((uuid.UUID(int=2), 5.0),),
        )


def test_a_validated_outcome_model_produces_doubly_robust_as_a_secondary_diagnostic_only():
    events = _sixty_events()
    kwargs = dict(
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    without = compare_policies(events, **kwargs)
    with_model = compare_policies(
        events,
        **kwargs,
        outcome_model=_outcome_model(events),
        request_doubly_robust=True,
    )
    assert with_model.doubly_robust is not None
    assert with_model.doubly_robust.outcome_model_id == "outcome-v1"
    assert with_model.doubly_robust.validation_id == "validation-001"
    assert with_model.doubly_robust.role == "secondary_diagnostic_only"
    # The DR values are genuinely different numbers from the SNIPS ones, and they change
    # nothing that decides: status, delta, interval and criterion are identical with and
    # without the model, because all four are computed from SNIPS alone.
    assert with_model.doubly_robust.baseline_reward != pytest.approx(
        with_model.baseline.snips_reward
    )
    assert with_model.doubly_robust.candidate_reward != pytest.approx(
        with_model.candidate.snips_reward
    )
    assert with_model.status is without.status
    assert with_model.reward_delta == pytest.approx(without.reward_delta)
    assert with_model.confidence_interval == without.confidence_interval
    assert with_model.improvement.unmet_conditions == without.improvement.unmet_conditions


def test_the_headline_estimator_is_snips_and_cannot_be_reassigned_to_doubly_robust():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
        outcome_model=_outcome_model(events),
        request_doubly_robust=True,
    )
    assert result.headline_estimator == "snips"
    with pytest.raises(TypeError):
        replace(result, headline_estimator="doubly_robust")
    with pytest.raises((AttributeError, TypeError)):
        result.headline_estimator = "doubly_robust"
    with pytest.raises((AttributeError, TypeError)):
        result.doubly_robust.role = "primary"


# --- C13: the interval is not clustered, and says so on every result ---------
#
# The contract carries no speaker key and this package does not add one: a grouping id stable
# across a person's events is a pseudonymous patient identifier, and the property that makes
# it useful (their events collide) is the property that makes it a re-identification handle.
# See UNCERTAINTY_BASIS in offline.py. Since the limitation cannot be fixed here, these tests
# check it cannot be missed either.


def test_every_result_states_that_its_interval_is_uncorrected_for_speaker_clustering():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.uncertainty_basis == offline.UNCERTAINTY_BASIS
    assert "clustering" in result.uncertainty_basis
    assert "cluster" in result.limitations[0].lower()
    assert "anti-conservative" in result.limitations[0]
    blocked = compare_policies(
        events[:10],
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
    )
    # A refusal carries the caveat too; there is no output shape that omits it.
    assert blocked.uncertainty_basis == offline.UNCERTAINTY_BASIS


def test_clustered_uncertainty_is_reported_unavailable_and_cannot_be_claimed_otherwise():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.clustered_uncertainty_available is False
    with pytest.raises(TypeError):
        replace(result, clustered_uncertainty_available=True)
    with pytest.raises((AttributeError, TypeError)):
        result.clustered_uncertainty_available = True


def test_the_logged_contract_still_carries_no_speaker_grouping_or_patient_key():
    payload = _event(0, positive=True).to_dict()
    flattened = " ".join(payload).lower()
    for forbidden in ("patient", "speaker", "subject", "cluster", "group", "person"):
        assert forbidden not in flattened


# --- C14: deficient support is a first-class number with its own gate --------


def test_candidate_mass_where_the_logger_provably_never_went_is_measured_and_blocked():
    # 0.96 is under the 0.999 deterministic threshold, so the randomisation gate is satisfied.
    # But the slate's propensities sum to one, so on those ten events every unlogged action
    # provably had propensity under 0.04 -- below the 0.05 the config refuses to divide by.
    events = _events_with([0.96] * 10 + [0.5] * 50)
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 0.1 if index < 10 else 0.5,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:deficient_support_mass_above_maximum" in result.blockers
    assert "logging_policy_is_deterministic" not in result.blockers
    assert result.candidate.deficient_support_mass == pytest.approx(10 * 0.9 / 60)
    assert result.candidate.deficient_support_event_rate == pytest.approx(10 / 60)
    # Reported at the top level too, not only inside the estimate.
    assert result.candidate_deficient_support_mass == pytest.approx(10 * 0.9 / 60)


def test_deficient_support_is_detected_even_when_the_overlap_gate_is_fully_satisfied():
    events = _events_with([0.96] * 10 + [0.5] * 50)
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 0.1 if index < 10 else 0.5,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    # Every event still carries positive candidate weight, so overlap alone sees nothing.
    assert result.candidate.overlap_rate == 1.0
    assert result.candidate.max_importance_weight <= 10.0
    assert result.blockers == ("candidate:deficient_support_mass_above_maximum",)


def test_a_candidate_placing_no_mass_on_the_logged_action_counts_that_event_unsupported():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 0.0 if index % 2 == 0 else 0.5,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.blocked
    assert "candidate:deficient_support_mass_above_maximum" in result.blockers
    assert result.candidate.deficient_support_mass == pytest.approx(0.5)
    assert result.candidate.deficient_support_event_rate == pytest.approx(0.5)


def test_a_well_supported_comparison_reports_exactly_zero_deficient_support_mass():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.candidate_deficient_support_mass == 0.0
    assert result.baseline.deficient_support_mass == 0.0


def test_the_deficient_support_gate_may_be_tightened_but_never_relaxed_past_its_ceiling():
    with pytest.raises(ValueError, match="stringency ceiling"):
        EvaluationConfig(max_deficient_support_mass=0.5)
    with pytest.raises(ValueError, match="must be finite"):
        EvaluationConfig(max_deficient_support_mass=-0.1)
    assert EvaluationConfig(max_deficient_support_mass=0.0).max_deficient_support_mass == 0.0


# --- C15: the conservative improvement criterion ----------------------------


def test_a_point_estimate_above_the_minimum_effect_is_not_enough_on_its_own():
    # Tuned so the SNIPS delta (~0.021) clears the 0.02 minimum effect while the interval's
    # lower end (~0.019) does not. The old rule and the new rule disagree here, and the new
    # one names the disagreement instead of rounding it up into a win.
    scenario = run_scenarios()["genuinely_inconclusive"]
    assert scenario["status"] == "inconclusive"
    assert scenario["blockers"] == []
    assert scenario["reward_delta"] > 0.02
    assert scenario["improvement"]["unmet_conditions"] == [
        "paired_lower_bound_below_minimum_effect"
    ]
    assert scenario["improvement"]["direction"] is None
    assert scenario["offline_preferred_policy_id"] is None


def test_an_improvement_that_vanishes_without_its_most_influential_event_is_refused():
    decision = offline._evaluate_improvement(
        delta=0.5,
        interval=(0.4, 0.6),
        leave_one_out_delta=0.001,
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert not decision.met
    assert decision.direction is None
    assert decision.unmet_conditions == (
        "improvement_does_not_survive_influential_event_removal",
    )


def test_deleting_the_most_influential_event_uses_the_largest_weight_on_either_side():
    rewards = [1.0] * 5 + [-1.0] * 5
    baseline_weights = [1.0] * 10
    candidate_weights = [1.0] * 9 + [9.0]
    delta = offline._delta_without_most_influential_event(
        rewards,
        baseline_weights,
        candidate_weights,
    )
    # Dropping index 9 makes the two policies identical over what remains.
    assert delta == pytest.approx(0.0)


def test_an_improvement_carried_by_one_high_weight_event_does_not_reach_a_verdict():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_matched_policy("baseline-v1", events),
        candidate=_shaped_policy(
            "candidate-v1",
            events,
            lambda index: 1.0 if index == 0 else 0.5,
        ),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.status is ComparisonStatus.inconclusive
    assert (
        "improvement_does_not_survive_influential_event_removal"
        in result.improvement.unmet_conditions
    )
    assert result.improvement.delta_without_most_influential_event == pytest.approx(0.0)
    assert result.offline_preferred_policy_id is None


def test_the_criterion_applies_the_same_three_conditions_to_the_baseline_direction():
    met = offline._evaluate_improvement(
        delta=-0.5,
        interval=(-0.6, -0.4),
        leave_one_out_delta=-0.5,
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert met.met and met.direction == "baseline"
    unmet = offline._evaluate_improvement(
        delta=-0.5,
        interval=(-0.6, 0.4),
        leave_one_out_delta=-0.001,
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert not unmet.met
    assert set(unmet.unmet_conditions) == {
        "paired_lower_bound_below_minimum_effect",
        "improvement_does_not_survive_influential_event_removal",
    }


def test_every_improvement_decision_states_what_it_does_not_guarantee():
    events = _sixty_events()
    result = compare_policies(
        events,
        baseline=_policy("baseline-v1", events, preference_aware=False),
        candidate=_policy("candidate-v1", events, preference_aware=True),
        config=EvaluationConfig(bootstrap_replicates=200, seed=42),
    )
    assert result.improvement.met
    assert result.improvement.direction == "candidate"
    assert result.improvement.unmet_conditions == ()
    assert result.improvement.criterion == "conservative_high_confidence_improvement"
    not_guaranteed = " ".join(result.improvement.does_not_guarantee).lower()
    for absent in ("clustering", "clinical", "deploy", "online experiment"):
        assert absent in not_guaranteed
    guaranteed = " ".join(result.improvement.guarantees).lower()
    assert "most influential logged event" in guaranteed


def test_the_strengthened_criterion_did_not_weaken_the_minimum_effect_floor():
    with pytest.raises(ValueError):
        EvaluationConfig(minimum_effect=0.0)
    assert offline.MINIMUM_EFFECT_FLOOR == 0.02


# --- C16: the simulation shows the refusals, not only the success ------------


def test_the_simulation_demonstrates_every_failure_mode_and_authorises_nothing():
    first = run_simulation()
    second = run_simulation()
    assert first == second
    assert first["synthetic"] is True
    assert first["outcome_model_validation_is_fabricated"] is True
    assert first["speaker_clustering_correction"] == (
        "unavailable_no_grouping_key_in_contract"
    )

    scenarios = first["scenarios"]
    assert scenarios["nominal_candidate_better"]["status"] == "candidate_better_offline"
    assert scenarios["deterministic_logger_refused"]["blockers"] == [
        "logging_policy_is_deterministic"
    ]
    assert scenarios["deficient_support_refused"]["blockers"] == [
        "candidate:deficient_support_mass_above_maximum"
    ]
    assert scenarios["deficient_support_refused"]["candidate_deficient_support_mass"] > 0.02
    assert scenarios["too_few_events_refused"]["blockers"] == ["insufficient_event_count"]
    assert scenarios["genuinely_inconclusive"]["status"] == "inconclusive"
    assert scenarios["doubly_robust_without_validated_model_refused"]["blockers"] == [
        "doubly_robust_requires_validated_outcome_model"
    ]
    dr = scenarios["doubly_robust_secondary_diagnostic"]
    assert dr["headline_estimator"] == "snips"
    assert dr["doubly_robust"]["role"] == "secondary_diagnostic_only"

    for name, scenario in scenarios.items():
        assert scenario["demonstrates"], name
        assert scenario["deployment_allowed"] is False, name
        assert scenario["online_experiment_allowed"] is False, name
        assert scenario["clinical_claim_allowed"] is False, name
        assert scenario["clustered_uncertainty_available"] is False, name
        assert scenario["headline_estimator"] == "snips", name


def test_no_simulation_scenario_emits_a_transcript_patient_or_timing_field():
    payload = json.dumps(run_simulation()).lower()
    for forbidden in (
        "patient_id",
        "transcript",
        "target_text",
        "audio",
        "wav",
        "latency",
        "duration_ms",
        "speaker_id",
    ):
        assert forbidden not in payload
