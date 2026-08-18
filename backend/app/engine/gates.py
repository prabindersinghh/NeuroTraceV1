"""Alert gating — TRD §6.

This is the whole product in forty lines of logic, so it is worth being explicit about
why it is shaped this way.

A monitoring tool that fires whenever a number crosses a line gets muted within a week,
and a muted tool detects nothing. The cost of a false alert is not zero — it is the
destruction of the only thing that makes the product work, which is that the family
believes it.

So an ALERT requires two independent things to be true at once:

  GATE 1 — PERSISTENCE. The deviation held across >= 2 consecutive valid sessions.
           Kills: one bad night's sleep, a cold, a noisy room, a single poor capture.

  GATE 2 — CROSS-MODALITY. >= 2 *independent domains* passed Gate 1.
           Kills: a hoarse throat moving every speech feature at once. Speech features
           are correlated with each other, so "many features moved" is weak evidence.
           "Speech AND fine motor moved" is strong evidence, because no single artefact
           plausibly produces both.

Anything that clears one gate but not both is WATCH: recorded, visible to a clinician,
and deliberately silent to the family.

And an IMPROVING trajectory never alerts, no matter what the magnitudes say. A patient
recovering function will show large deviations from a baseline taken when they were worse.
That is success, not deterioration.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .deviation import ModuleDeviation

# --- gate parameters (TRD §6) ---
DEV_THRESHOLD = 2.0          # mean|robust z| above which a module is "deviating"
PERSISTENCE_SESSIONS = 2     # Gate 1: consecutive valid sessions
MIN_DOMAINS = 2              # Gate 2: independent domains

BAND_STABLE = "STABLE"
BAND_WATCH = "WATCH"
BAND_ALERT = "ALERT"

# TRD §4 domains. Independence is asserted at the DOMAIN level, not the module level:
# M1 (facial motor) and M4 (dysarthria) are different domains and are driven by different
# anatomy, so agreement between them is real corroboration.
DOMAINS = {
    "A": "cranial_nerves",
    "B": "speech_language",
    "C": "motor",
    "D": "coordination_gait",
    "E": "cognition",
    "F": "mood_fatigue_function",
    "G": "vitals_prevention",
}


@dataclass(slots=True)
class SessionDeviations:
    """One session's worth of per-module deviations, keyed by module code."""

    session_id: str
    modules: dict[str, ModuleDeviation] = field(default_factory=dict)
    valid: bool = True

    def domain_deviation(self, *, gateable_only: bool = True) -> dict[str, float]:
        """Worst deviating module per domain.

        Max rather than mean: a domain with five modules where one is clearly abnormal
        should not have that signal averaged away by four normal ones.

        `gateable_only` excludes modules that are recorded but not allowed to drive the
        gate — questionnaires with their own validated cut-offs, and any module with too
        few features for a mean to be stable. Pass False to get the display view, which
        shows everything that was measured.
        """
        out: dict[str, float] = {}
        for dev in self.modules.values():
            if not dev.computed:
                continue
            if gateable_only and not dev.gateable:
                continue
            out[dev.domain] = max(out.get(dev.domain, 0.0), dev.mean_abs_z)
        return out

    def improving_domains(self) -> set[str]:
        return {d.domain for d in self.modules.values() if d.computed and d.improving}


@dataclass(slots=True)
class GateResult:
    band: str = BAND_STABLE
    gate1_passed: bool = False
    gate2_passed: bool = False
    persistent_domains: list[str] = field(default_factory=list)
    flagged_today: list[str] = field(default_factory=list)
    improving: bool = False
    sustained_sessions: int = 0
    reason: str = "within this patient's usual variation"
    drivers: list[tuple[str, float]] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "band": self.band,
            "gate1_passed": self.gate1_passed,
            "gate2_passed": self.gate2_passed,
            "persistent_domains": self.persistent_domains,
            "flagged_today": self.flagged_today,
            "improving": self.improving,
            "sustained_sessions": self.sustained_sessions,
            "reason": self.reason,
            "drivers": [list(d) for d in self.drivers],
        }


def evaluate_gates(
    history: Sequence[SessionDeviations],
    *,
    threshold: float = DEV_THRESHOLD,
    persistence: int = PERSISTENCE_SESSIONS,
    min_domains: int = MIN_DOMAINS,
) -> GateResult:
    """Apply both gates to a chronological run of sessions (most recent last).

    Only *valid* sessions count toward persistence. A rejected capture does not break a
    run and does not extend it — it is simply not a session for gating purposes, which
    prevents a bad capture from either masking or manufacturing a deviation.
    """
    result = GateResult()
    valid = [s for s in history if s.valid]
    if not valid:
        result.reason = "no valid sessions yet"
        return result

    today = valid[-1]
    today_dev = today.domain_deviation()
    result.flagged_today = sorted(d for d, v in today_dev.items() if v > threshold)

    # --- IMPROVING short-circuits everything (TRD §6) ---
    improving = today.improving_domains()
    if improving and improving.issuperset(set(result.flagged_today)) and result.flagged_today:
        result.improving = True
        result.band = BAND_STABLE
        result.reason = "movement is in the direction of recovery"
        return result

    # --- GATE 1: persistence across consecutive valid sessions ---
    window = valid[-persistence:]
    if len(window) >= persistence:
        per_session = [s.domain_deviation() for s in window]
        for domain in DOMAINS.values():
            if all(sess.get(domain, 0.0) > threshold for sess in per_session):
                result.persistent_domains.append(domain)
    result.persistent_domains.sort()
    result.gate1_passed = bool(result.persistent_domains)

    # How many consecutive sessions have the persistent domains actually held? The gate
    # only needs `persistence`, but a clinician reading "2 domains for 5 sessions" is
    # getting materially different information from "2 domains for 2 sessions".
    if result.persistent_domains:
        run = 0
        for sess in reversed(valid):
            devs = sess.domain_deviation()
            if all(devs.get(d, 0.0) > threshold for d in result.persistent_domains):
                run += 1
            else:
                break
        result.sustained_sessions = run

    # --- GATE 2: independent corroboration ---
    result.gate2_passed = len(result.persistent_domains) >= min_domains

    if result.gate1_passed and result.gate2_passed:
        result.band = BAND_ALERT
        result.reason = (
            f"{len(result.persistent_domains)} independent domains "
            f"({', '.join(result.persistent_domains)}) deviating across "
            f"{persistence} consecutive sessions"
        )
    elif result.gate1_passed:
        result.band = BAND_WATCH
        result.reason = (
            f"{result.persistent_domains[0]} deviating across {persistence} sessions, "
            "but no second domain corroborates it yet"
        )
    elif result.flagged_today:
        result.band = BAND_WATCH
        result.reason = "a single session moved; not yet sustained"
    else:
        result.band = BAND_STABLE
        result.reason = "within this patient's usual variation"

    return result


def rank_drivers(session: SessionDeviations, k: int = 3) -> list[tuple[str, float]]:
    """The k features that moved most, across all modules, for the explanation layer."""
    scored: list[tuple[str, float]] = []
    for dev in session.modules.values():
        if not dev.computed:
            continue
        for feature in dev.features:
            if feature.reliable:
                scored.append((feature.key, abs(feature.robust_z)))
    scored.sort(key=lambda x: -x[1])
    return scored[:k]


def band_rank(band: str) -> int:
    return {BAND_STABLE: 0, BAND_WATCH: 1, BAND_ALERT: 2}.get(band, 0)


def domains_for(modules: Iterable[ModuleDeviation]) -> set[str]:
    return {m.domain for m in modules}
