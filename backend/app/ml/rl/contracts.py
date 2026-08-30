"""Deterministic, data-minimising contracts for Awaaz offline policy evaluation.

This package never receives transcript text or audio. Candidate contents stay behind opaque
UUIDs, and the only usable reward signal is an explicit choice, rejection, correction, or
phrase-board fallback. The contracts deliberately describe logged observation; they do not
provide an API for assigning a patient to an experiment.
"""
from __future__ import annotations

import enum
import hashlib
import json
import math
import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from ...awaaz.safety import SpeechProfile

#: Bumped to 2 when ``top_ranked_action_id`` joined the wire shape. Nothing persists these
#: records yet, so there is no migration to write -- but a stored v1 row is missing the field
#: that lets us detect a propensity written against the wrong action, so it is refused rather
#: than read optimistically.
SCHEMA_VERSION = 2
MAX_CANDIDATES = 8
_POLICY_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")


def _uuid(value: uuid.UUID | str, *, field_name: str) -> uuid.UUID:
    try:
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an opaque UUID") from exc


def _policy_id(value: object) -> str:
    value = str(value)
    if _POLICY_ID.fullmatch(value) is None:
        raise ValueError(
            "policy_id must be a lowercase opaque slug containing only letters, digits, "
            "dot, underscore, or dash"
        )
    return value


def _boolean(value: object, *, field_name: str) -> bool:
    if type(value) is not bool:
        raise ValueError(f"{field_name} must be a boolean")
    return value


class FeedbackActor(str, enum.Enum):
    """Who supplied the feedback signal.

    Caregiver feedback may be retained for supervised ASR labelling, but it is never treated
    as the patient's communication preference by this RL package.
    """

    patient = "patient"
    caregiver = "caregiver"


class CollectionMode(str, enum.Enum):
    """Allowed origins for a record. There is intentionally no online-experiment mode."""

    passive_observation = "passive_observation"
    offline_replay = "offline_replay"


class PolicyScope(str, enum.Enum):
    """The only policy surface this foundation is permitted to inspect."""

    candidate_ranking = "candidate_ranking"


@dataclass(frozen=True, slots=True)
class ExplicitFeedback:
    """A small, explicit signal; absence, dwell time, and silence are not feedback.

    IDs refer to already-screened candidate options. Free text is intentionally absent so a
    feedback export cannot become a transcript corpus by accident.
    """

    actor: FeedbackActor
    selected_action_id: uuid.UUID | None = None
    rejected_action_ids: tuple[uuid.UUID, ...] = ()
    correction_made: bool = False
    phrase_board_fallback: bool = False

    def __post_init__(self) -> None:
        try:
            actor = FeedbackActor(self.actor)
        except (TypeError, ValueError) as exc:
            raise ValueError("feedback actor is not supported") from exc
        object.__setattr__(self, "actor", actor)

        selected = (
            _uuid(self.selected_action_id, field_name="selected_action_id")
            if self.selected_action_id is not None
            else None
        )
        rejected = tuple(
            _uuid(value, field_name="rejected_action_ids")
            for value in self.rejected_action_ids
        )
        if len(rejected) != len(set(rejected)):
            raise ValueError("rejected_action_ids must not contain duplicates")
        if selected is not None and selected in rejected:
            raise ValueError("an action cannot be both selected and rejected")
        object.__setattr__(self, "selected_action_id", selected)
        object.__setattr__(self, "rejected_action_ids", rejected)

        correction = _boolean(self.correction_made, field_name="correction_made")
        fallback = _boolean(
            self.phrase_board_fallback,
            field_name="phrase_board_fallback",
        )
        object.__setattr__(self, "correction_made", correction)
        object.__setattr__(self, "phrase_board_fallback", fallback)
        if selected is not None and fallback:
            raise ValueError(
                "selected_action_id and phrase_board_fallback are mutually exclusive"
            )
        if not (selected is not None or rejected or correction or fallback):
            raise ValueError(
                "at least one explicit feedback signal is required; inactivity is not "
                "a patient preference"
            )

    def to_dict(self) -> dict:
        return {
            "actor": self.actor.value,
            "selected_action_id": (
                str(self.selected_action_id) if self.selected_action_id else None
            ),
            "rejected_action_ids": [str(value) for value in self.rejected_action_ids],
            "correction_made": self.correction_made,
            "phrase_board_fallback": self.phrase_board_fallback,
        }


@dataclass(frozen=True, slots=True)
class LoggedFeedback:
    """One immutable contextual-bandit observation.

    ``logged_action_probability`` is pi_0(``logged_action_id`` | context): the probability the
    already-running behaviour policy assigned to **the action this record actually logged**.
    It is not the probability of the top-ranked action, and it is not the score of the action
    a re-rank, tie-break, or fallback would have preferred. ``compare_policies`` divides by
    this number, so recording any other quantity mis-specifies every importance weight and
    both estimates are wrong without a single blocker firing.

    It is recorded for counterfactual estimation, never used to randomise a live patient
    experience. A deterministic behaviour policy records ``1.0``; a log dominated by such
    records carries no counterfactual information and ``compare_policies`` fails closed on it
    (``logging_policy_is_deterministic``).

    ``top_ranked_action_id`` is optional and exists only so the contract can catch the
    mis-specification above: a logger that knows it re-ranked can say so, and a probability
    that is arithmetically impossible for a non-top action is then rejected here rather than
    silently divided by downstream.
    """

    event_id: uuid.UUID
    behavior_policy_id: str
    candidate_action_ids: tuple[uuid.UUID, ...]
    logged_action_id: uuid.UUID
    logged_action_probability: float
    speech_profile: SpeechProfile
    confirmation_required: bool
    confirmation_observed: bool
    output_spoken: bool
    emergency: bool
    feedback: ExplicitFeedback
    top_ranked_action_id: uuid.UUID | None = None
    collection_mode: CollectionMode = CollectionMode.passive_observation
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError(f"unsupported feedback schema version: {self.schema_version}")
        object.__setattr__(self, "event_id", _uuid(self.event_id, field_name="event_id"))
        object.__setattr__(self, "behavior_policy_id", _policy_id(self.behavior_policy_id))

        candidates = tuple(
            _uuid(value, field_name="candidate_action_ids")
            for value in self.candidate_action_ids
        )
        if not 2 <= len(candidates) <= MAX_CANDIDATES:
            raise ValueError(
                f"candidate_action_ids must contain 2 to {MAX_CANDIDATES} actions"
            )
        if len(candidates) != len(set(candidates)):
            raise ValueError("candidate_action_ids must not contain duplicates")
        logged_action = _uuid(self.logged_action_id, field_name="logged_action_id")
        if logged_action not in candidates:
            raise ValueError("logged_action_id must be one of candidate_action_ids")
        object.__setattr__(self, "candidate_action_ids", candidates)
        object.__setattr__(self, "logged_action_id", logged_action)

        if isinstance(self.logged_action_probability, bool):
            raise ValueError("logged_action_probability must be numeric")
        probability = float(self.logged_action_probability)
        if not math.isfinite(probability) or not 0.0 < probability <= 1.0:
            raise ValueError("logged_action_probability must be finite and in (0, 1]")
        object.__setattr__(self, "logged_action_probability", probability)

        top_ranked = (
            _uuid(self.top_ranked_action_id, field_name="top_ranked_action_id")
            if self.top_ranked_action_id is not None
            else None
        )
        if top_ranked is not None and top_ranked not in candidates:
            raise ValueError("top_ranked_action_id must be one of candidate_action_ids")
        # The probability above must belong to the LOGGED action. When the logger declares a
        # different action as top-ranked, the logged action is by definition not the modal
        # one: pi_0(logged) <= pi_0(top) and the two are disjoint outcomes summing to at most
        # 1, so pi_0(logged) <= 0.5. A larger value is arithmetically impossible and is the
        # signature of a logger writing the top action's probability against the ID of an
        # action it actually emitted after a re-rank, tie-break, or fallback. Refusing the
        # record is the only place this is still detectable -- once it reaches the estimator
        # it is just a plausible-looking number in a denominator.
        if (
            top_ranked is not None
            and top_ranked != logged_action
            and probability > 0.5
        ):
            raise ValueError(
                "logged_action_probability must be the probability of logged_action_id; a "
                "non-top-ranked action cannot carry probability above 0.5"
            )
        object.__setattr__(self, "top_ranked_action_id", top_ranked)

        try:
            profile = SpeechProfile(self.speech_profile)
        except (TypeError, ValueError) as exc:
            raise ValueError("speech_profile is not supported") from exc
        try:
            collection_mode = CollectionMode(self.collection_mode)
        except (TypeError, ValueError) as exc:
            raise ValueError("collection_mode is not supported") from exc
        object.__setattr__(self, "speech_profile", profile)
        object.__setattr__(self, "collection_mode", collection_mode)

        for name in (
            "confirmation_required",
            "confirmation_observed",
            "output_spoken",
            "emergency",
        ):
            object.__setattr__(self, name, _boolean(getattr(self, name), field_name=name))
        if not isinstance(self.feedback, ExplicitFeedback):
            raise ValueError("feedback must be an ExplicitFeedback record")

        referenced = set(self.feedback.rejected_action_ids)
        if self.feedback.selected_action_id is not None:
            referenced.add(self.feedback.selected_action_id)
        if not referenced.issubset(candidates):
            raise ValueError("feedback may only reference actions offered in this event")

    def to_dict(self) -> dict:
        """Return the versioned wire shape with no free-text or media fields."""
        return {
            "schema_version": self.schema_version,
            "event_id": str(self.event_id),
            "behavior_policy_id": self.behavior_policy_id,
            "candidate_action_ids": [str(value) for value in self.candidate_action_ids],
            "logged_action_id": str(self.logged_action_id),
            "logged_action_probability": self.logged_action_probability,
            "top_ranked_action_id": (
                str(self.top_ranked_action_id) if self.top_ranked_action_id else None
            ),
            "speech_profile": self.speech_profile.value,
            "confirmation_required": self.confirmation_required,
            "confirmation_observed": self.confirmation_observed,
            "output_spoken": self.output_spoken,
            "emergency": self.emergency,
            "collection_mode": self.collection_mode.value,
            "feedback": self.feedback.to_dict(),
        }

    def canonical_json(self) -> str:
        """Stable bytes for append-only logs, signatures, and duplicate detection."""
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )

    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class PolicyManifest:
    """A policy's safety declaration, checked before any numbers are produced."""

    policy_id: str
    scope: PolicyScope = PolicyScope.candidate_ranking
    offline_only: bool = True
    uses_online_exploration: bool = False
    can_generate_text: bool = False
    can_change_confirmation_gate: bool = False
    can_trigger_speech: bool = False
    makes_clinical_claims: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "policy_id", _policy_id(self.policy_id))
        try:
            scope = PolicyScope(self.scope)
        except (TypeError, ValueError) as exc:
            raise ValueError("policy scope is not supported") from exc
        object.__setattr__(self, "scope", scope)
        for name in (
            "offline_only",
            "uses_online_exploration",
            "can_generate_text",
            "can_change_confirmation_gate",
            "can_trigger_speech",
            "makes_clinical_claims",
        ):
            object.__setattr__(self, name, _boolean(getattr(self, name), field_name=name))


@dataclass(frozen=True, slots=True)
class PolicyPrediction:
    """One offline policy distribution over exactly one logged candidate set."""

    event_id: uuid.UUID
    action_probabilities: tuple[tuple[uuid.UUID, float], ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_id", _uuid(self.event_id, field_name="event_id"))
        raw: Iterable[tuple[uuid.UUID | str, float]]
        if isinstance(self.action_probabilities, Mapping):
            raw = self.action_probabilities.items()
        else:
            raw = self.action_probabilities

        parsed: list[tuple[uuid.UUID, float]] = []
        for action_id, probability in raw:
            action = _uuid(action_id, field_name="action_probabilities action")
            if isinstance(probability, bool):
                raise ValueError("action probabilities must be numeric")
            value = float(probability)
            if not math.isfinite(value) or not 0.0 <= value <= 1.0:
                raise ValueError("action probabilities must be finite and in [0, 1]")
            parsed.append((action, value))
        if not parsed:
            raise ValueError("action_probabilities must not be empty")
        action_ids = [item[0] for item in parsed]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("action_probabilities must not repeat an action")
        total = math.fsum(item[1] for item in parsed)
        if not math.isclose(total, 1.0, rel_tol=0.0, abs_tol=1e-9):
            raise ValueError("action probabilities must sum to 1")
        parsed.sort(key=lambda item: item[0].int)
        object.__setattr__(self, "action_probabilities", tuple(parsed))

    @property
    def action_ids(self) -> frozenset[uuid.UUID]:
        return frozenset(action_id for action_id, _ in self.action_probabilities)

    def probability_for(self, action_id: uuid.UUID) -> float:
        action_id = _uuid(action_id, field_name="action_id")
        return next(
            (probability for action, probability in self.action_probabilities
             if action == action_id),
            0.0,
        )


@dataclass(frozen=True, slots=True)
class OfflinePolicy:
    """A manifest plus predictions produced without reading held-out feedback."""

    manifest: PolicyManifest
    predictions: tuple[PolicyPrediction, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not isinstance(self.manifest, PolicyManifest):
            raise ValueError("manifest must be a PolicyManifest")
        predictions = tuple(self.predictions)
        if any(not isinstance(item, PolicyPrediction) for item in predictions):
            raise ValueError("predictions must contain PolicyPrediction records")
        event_ids = [item.event_id for item in predictions]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("a policy may provide only one prediction per event")
        object.__setattr__(
            self,
            "predictions",
            tuple(sorted(predictions, key=lambda item: item.event_id.int)),
        )

