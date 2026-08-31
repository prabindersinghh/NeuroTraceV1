"""Awaaz reinforcement-learning boundary: offline preference evaluation only.

Nothing here trains on-line, explores on patients, changes the Awaaz confirmation gate,
generates language, triggers speech, or makes a clinical claim. It can only compare opaque
candidate-ranking policies against explicitly logged choices and return an offline review
result that never authorises deployment.
"""
from .contracts import (
    CollectionMode,
    ExplicitFeedback,
    FeedbackActor,
    LoggedFeedback,
    OfflinePolicy,
    OutcomeModelPrediction,
    OutcomeModelValidation,
    OutcomeValidationScheme,
    PolicyManifest,
    PolicyPrediction,
    PolicyScope,
    ValidatedOutcomeModel,
)
from .offline import (
    ComparisonStatus,
    DoublyRobustDiagnostic,
    EvaluationConfig,
    ImprovementDecision,
    OfflineComparison,
    PolicyEstimate,
    compare_policies,
)
from .rewards import RewardBreakdown, RewardConfig, score_logged_action
from .safety import (
    GateResult,
    gate_logged_feedback,
    gate_outcome_model,
    gate_policy,
)

__all__ = [
    "CollectionMode",
    "ComparisonStatus",
    "DoublyRobustDiagnostic",
    "EvaluationConfig",
    "ExplicitFeedback",
    "FeedbackActor",
    "GateResult",
    "ImprovementDecision",
    "LoggedFeedback",
    "OfflineComparison",
    "OfflinePolicy",
    "OutcomeModelPrediction",
    "OutcomeModelValidation",
    "OutcomeValidationScheme",
    "PolicyEstimate",
    "PolicyManifest",
    "PolicyPrediction",
    "PolicyScope",
    "RewardBreakdown",
    "RewardConfig",
    "ValidatedOutcomeModel",
    "compare_policies",
    "gate_logged_feedback",
    "gate_outcome_model",
    "gate_policy",
    "score_logged_action",
]
