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
    PolicyManifest,
    PolicyPrediction,
    PolicyScope,
)
from .offline import (
    ComparisonStatus,
    EvaluationConfig,
    OfflineComparison,
    PolicyEstimate,
    compare_policies,
)
from .rewards import RewardBreakdown, RewardConfig, score_logged_action
from .safety import GateResult, gate_logged_feedback, gate_policy

__all__ = [
    "CollectionMode",
    "ComparisonStatus",
    "EvaluationConfig",
    "ExplicitFeedback",
    "FeedbackActor",
    "GateResult",
    "LoggedFeedback",
    "OfflineComparison",
    "OfflinePolicy",
    "PolicyEstimate",
    "PolicyManifest",
    "PolicyPrediction",
    "PolicyScope",
    "RewardBreakdown",
    "RewardConfig",
    "compare_policies",
    "gate_logged_feedback",
    "gate_policy",
    "score_logged_action",
]
