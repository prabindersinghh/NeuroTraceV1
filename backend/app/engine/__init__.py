"""The clinical engine — deterministic, seeded, auditable.

No machine-learned model sits anywhere in this decision path (TRD §7, session rule 5).
Trained classifiers may contribute *additional features*, but the band, the gates and the
thresholds are all computed here, in plain arithmetic that a clinician can audit.
"""
from .baseline import (
    Baseline,
    EnrolmentError,
    SessionObservation,
    as_utc,
    build_baseline,
    check_enrolment,
    is_off_window,
    window_progress,
)
from .confounders import ConfounderContext, ConfounderReport, detect_confounders
from .deviation import ModuleDeviation, compute_module_deviation, cusum_series, robust_z
from .gates import (
    BAND_ALERT,
    BAND_STABLE,
    BAND_WATCH,
    DOMAINS,
    GateResult,
    SessionDeviations,
    evaluate_gates,
    rank_drivers,
)

__all__ = [
    "BAND_ALERT", "BAND_STABLE", "BAND_WATCH", "DOMAINS",
    "as_utc", "Baseline", "ConfounderContext", "ConfounderReport", "EnrolmentError",
    "GateResult", "ModuleDeviation", "SessionDeviations", "SessionObservation",
    "build_baseline", "check_enrolment", "compute_module_deviation", "cusum_series",
    "detect_confounders", "evaluate_gates", "is_off_window", "rank_drivers",
    "robust_z", "window_progress",
]
