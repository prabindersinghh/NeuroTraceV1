"""Change detection — TRD §6.

Three complementary instruments, because each catches what the others miss:

* **Robust z** answers "how unusual is today?" in units of this patient's own spread.
* **RCI** (Reliable Change Index) answers "is today's move larger than the measurement
  error of the instrument itself?" A tapping test has real test-retest noise; without
  the RCI we would keep flagging that noise.
* **CUSUM** answers "has a small drift been accumulating?" A decline of 0.8 z per day for
  a week never trips a single-day threshold, but it is exactly the trajectory that
  matters clinically. CUSUM integrates it.

All three are deterministic. No model sits in this path.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .baseline import Baseline, expected_value

# --- robust z (TRD §6) ---
ROBUST_Z_SCALE = 0.6745      # Iglewicz-Hoaglin modified z-score constant
DEVIATION_CLIP = 6.0         # one broken feature must not dominate a module

# --- RCI ---
RCI_RELIABILITY = 0.85       # assumed test-retest reliability of a task in this battery
RCI_CRITICAL = 1.96          # two-tailed p < .05

# --- CUSUM ---
CUSUM_K = 0.5                # slack: drift below this is treated as noise
CUSUM_H = 4.0                # alarm threshold

# A module's deviation is mean(|z|) across its features. With one or two features there is
# no averaging, so the "mean" is a single draw and crosses any threshold by chance at the
# tail rate of the distribution. Below this count the deviation is still computed and
# stored — it is real information — but it is not allowed to drive the alert gate.
MIN_FEATURES_TO_GATE = 3

# A module counts as showing a ONE-SIDED change when the mean |z| across its asymmetry
# features clears this. Deliberately the same threshold as DEV_THRESHOLD in gates.py: a
# lateralised finding has to be as convincing as any other deviation, not a lower bar.
LATERAL_THRESHOLD = 2.0


@dataclass(slots=True)
class FeatureDeviation:
    key: str
    value: float
    expected: float
    robust_z: float
    rci: float
    reliable: bool


@dataclass(slots=True)
class ModuleDeviation:
    """One module's deviation on one session."""

    module_code: str
    domain: str
    mean_abs_z: float = 0.0
    max_abs_z: float = 0.0
    n_reliable: int = 0
    gateable: bool = True
    #: mean |z| across this module's asymmetry features only. 0.0 when it has none.
    lateral_abs_z: float = 0.0
    #: True when the deviation is one-sided rather than a symmetric change in level.
    lateralised: bool = False
    #: True when the module has asymmetry features at all (speech does not).
    has_laterality: bool = False
    features: list[FeatureDeviation] = field(default_factory=list)
    cusum: float = 0.0
    cusum_alarm: bool = False
    improving: bool = False
    computed: bool = False
    reason: str = ""

    def z_map(self) -> dict[str, float]:
        return {f.key: f.robust_z for f in self.features}

    def to_json(self) -> dict:
        return {
            "module_code": self.module_code,
            "domain": self.domain,
            "mean_abs_z": self.mean_abs_z,
            "max_abs_z": self.max_abs_z,
            "n_reliable": self.n_reliable,
            "cusum": self.cusum,
            "cusum_alarm": self.cusum_alarm,
            "improving": self.improving,
            "gateable": self.gateable,
            "lateral_abs_z": self.lateral_abs_z,
            "lateralised": self.lateralised,
            "has_laterality": self.has_laterality,
            "computed": self.computed,
            "reason": self.reason,
            "features": {
                f.key: {"value": f.value, "expected": f.expected,
                        "z": f.robust_z, "rci": f.rci, "reliable": f.reliable}
                for f in self.features
            },
        }


def robust_z(value: float, median: float, mad: float) -> float:
    """0.6745 * (x - median) / MAD — the modified z-score.

    The constant rescales MAD so that, for normally distributed data, the result is
    directly comparable to a conventional z. That comparability is what lets us set one
    threshold across modules whose raw units are milliseconds, degrees and ratios.
    """
    if mad <= 0:
        return 0.0
    return float(ROBUST_Z_SCALE * (value - median) / mad)


def reliable_change_index(value: float, expected: float, sd: float,
                          reliability: float = RCI_RELIABILITY) -> float:
    """(x - expected) / (sqrt(2) * SEM), where SEM = SD * sqrt(1 - reliability).

    This is the standard Jacobson-Truax formulation. It asks whether the observed change
    exceeds what the instrument's own unreliability could have produced. A value beyond
    ±1.96 is change we can defend at p < .05; anything inside that is measurement noise
    and must not reach a caregiver.
    """
    sem = sd * np.sqrt(max(0.0, 1.0 - reliability))
    se_diff = float(np.sqrt(2.0) * sem)
    if se_diff <= 0:
        return 0.0
    return float((value - expected) / se_diff)


def compute_module_deviation(
    module_code: str,
    domain: str,
    features: dict[str, float],
    baseline: Baseline,
    keys: Sequence[str],
    *,
    days_since_window_start: float = 0.0,
    bad_direction: dict[str, str] | None = None,
    previous_cusum: float = 0.0,
    gates_alerts: bool = True,
    lateral_keys: Sequence[str] | None = None,
) -> ModuleDeviation:
    """Score one module for one session against its locked baseline.

    `bad_direction` maps a feature to "up" or "down" — the direction in which a change is
    clinically worse. It is used only to decide whether an overall movement counts as
    IMPROVING; the deviation magnitude itself is direction-agnostic.
    """
    dev = ModuleDeviation(module_code=module_code, domain=domain)

    if not baseline.locked:
        dev.reason = f"baseline not locked ({baseline.reason})"
        return dev

    bad_direction = bad_direction or {}
    lateral = set(lateral_keys or ())
    dev.has_laterality = bool(lateral)
    z_values: list[float] = []
    lateral_z: list[float] = []
    signed_improvement: list[float] = []

    for key in keys:
        if key not in baseline.median:
            continue
        value = float(features.get(key, baseline.median[key]))
        if not np.isfinite(value):
            value = baseline.median[key]

        expected = expected_value(baseline, key, days_since_window_start)
        z = robust_z(value, expected, baseline.mad.get(key, 0.0))
        rci = reliable_change_index(value, expected, baseline.sd(key))
        is_reliable = abs(rci) >= RCI_CRITICAL

        dev.features.append(
            FeatureDeviation(key=key, value=value, expected=expected,
                             robust_z=z, rci=rci, reliable=is_reliable)
        )
        z_values.append(abs(z))
        if key in lateral:
            lateral_z.append(abs(z))
        if is_reliable:
            dev.n_reliable += 1

        # Positive = moved in the clinically better direction.
        direction = bad_direction.get(key)
        if direction == "up":
            signed_improvement.append(-z)
        elif direction == "down":
            signed_improvement.append(z)

    if not z_values:
        dev.reason = "no scoreable features overlapped the baseline"
        return dev

    clipped = np.clip(np.asarray(z_values), 0.0, DEVIATION_CLIP)
    dev.mean_abs_z = float(np.mean(clipped))
    dev.max_abs_z = float(np.max(clipped))
    dev.computed = True
    dev.gateable = gates_alerts and len(z_values) >= MIN_FEATURES_TO_GATE

    # Laterality is computed from the asymmetry features alone. A symmetric loss of
    # movement raises mean_abs_z without raising this, which is exactly how a diffuse
    # process is told apart from a focal one.
    if lateral_z:
        clipped_lateral = np.clip(np.asarray(lateral_z), 0.0, DEVIATION_CLIP)
        dev.lateral_abs_z = float(np.mean(clipped_lateral))
        dev.lateralised = dev.lateral_abs_z > LATERAL_THRESHOLD

    dev.reason = "ok" if dev.gateable else "recorded but not gate-eligible"

    # CUSUM accumulates only the excess above the slack term.
    dev.cusum = float(max(0.0, previous_cusum + (dev.mean_abs_z - CUSUM_K)))
    dev.cusum_alarm = dev.cusum >= CUSUM_H

    # IMPROVING: the module moved, and it moved the right way. Never alert on this.
    if signed_improvement:
        mean_improvement = float(np.mean(signed_improvement))
        dev.improving = mean_improvement > 0 and dev.n_reliable > 0

    return dev


def cusum_series(mean_abs_z_series: Sequence[float],
                 k: float = CUSUM_K, h: float = CUSUM_H) -> list[float]:
    """Full CUSUM trace, for charts and for tests."""
    out: list[float] = []
    s = 0.0
    for d in mean_abs_z_series:
        s = max(0.0, s + (float(d) - k))
        out.append(s)
    return out


def trajectory_slope(values: Sequence[float]) -> float:
    """Slope of recent module deviations. Negative = deviations shrinking = improving."""
    if len(values) < 3:
        return 0.0
    x = np.arange(len(values), dtype=float)
    return float(np.polyfit(x, np.asarray(values, dtype=float), 1)[0])
