"""Safety and reproducibility checks for the offline-only Awaaz policy scaffold."""
from __future__ import annotations

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
    PolicyManifest,
    PolicyPrediction,
    RewardConfig,
    compare_policies,
    gate_logged_feedback,
    gate_policy,
    score_logged_action,
)
from app.ml.rl import offline
from app.ml.rl.simulate import _events as simulate_events
from app.ml.rl.simulate import run_simulation


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


def test_leaving_for_the_phrase_board_scores_a_full_negative_with_a_repair_cost():
    event = _event(0, positive=True)
    fallback = replace(
        event,
        confirmation_observed=False,
        output_spoken=False,
        feedback=ExplicitFeedback(
            actor=FeedbackActor.patient,
            phrase_board_fallback=True,
        ),
    )
    breakdown = score_logged_action(fallback)
    assert breakdown.explicit_preference == -1.0
    assert breakdown.repair_cost == -1.0
    assert breakdown.total == pytest.approx(-1.0)


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
