"""Alert gating — TRD §6.

This is the whole product in a hundred lines of logic, so it is worth being explicit about
why it is shaped this way.

A monitoring tool that fires whenever a number crosses a line gets muted within a week, and
a muted tool detects nothing. The cost of a false alert is not zero — it is the destruction
of the only thing that makes the product work, which is that the family believes it.

So an ALERT requires three things to be true at once:

  GATE 1 — PERSISTENCE. The deviation held across >= 2 consecutive valid sessions.
           Kills: one bad night's sleep, a cold, a noisy room, a single poor capture.

  GATE 2 — CROSS-MODALITY. >= 2 *independent domains* passed Gate 1.
           Kills: a hoarse throat moving every speech feature at once. Speech features are
           correlated with each other, so "many features moved" is weak evidence. "Speech
           AND fine motor moved" is strong evidence, because no single artefact plausibly
           produces both.

  GATE 3 — LATERALITY. At least one persistent domain shows a ONE-SIDED change.
           Kills: Parkinson's disease, and this is not hypothetical.

Why Gate 3 exists
-----------------
Parkinson's produces bradykinesia (slow tapping), hypophonia and monotone speech, and
masked facies with reduced blink — *simultaneously*. It is common in the 55-75 band we
monitor, and post-stroke patients can additionally develop vascular parkinsonism.

Under Gates 1 and 2 alone a PD patient would trip face, motor and voice together and
generate our **highest-confidence ALERT** — for a condition this system does not monitor,
cannot help with, and would be misrepresenting. Three domains agreeing looks like
overwhelming evidence, and it would be overwhelming evidence of the wrong thing.

The discriminator is anatomy. A stroke damages one hemisphere and produces a **lateralised**
deficit: one mouth corner, one hand, one arm. Parkinson's is broadly **symmetric**. So a
domain only counts toward an alert when its deviation appears in its asymmetry features,
and every ALERT needs at least one such domain.

Speech is the exception that proves the rule: it has no left/right axis at all, so it can
never establish that a change is focal. It may corroborate a lateralised finding; it may
never stand in for one.

And when face, motor and voice all decline *symmetrically* together, we say so explicitly
rather than going quiet — see `detect_symmetric_pattern`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Sequence

from .deviation import ModuleDeviation

# --- gate parameters (TRD §6) ---
DEV_THRESHOLD = 2.0          # mean|robust z| above which a module is "deviating"
PERSISTENCE_SESSIONS = 2     # Gate 1: consecutive valid sessions
MIN_DOMAINS = 2              # Gate 2: independent domains
MIN_LATERALISED_DOMAINS = 1  # Gate 3: at least one one-sided finding

BAND_STABLE = "STABLE"
BAND_WATCH = "WATCH"
BAND_ALERT = "ALERT"
#: Consistent, progressive, symmetric change across face, motor and voice. Not a focal
#: deficit — reported as such rather than as a stroke-monitoring alert.
BAND_ATYPICAL = "PATTERN_ATYPICAL"

# TRD §4 domains. Independence is asserted at the DOMAIN level, not the module level:
# M1 (facial motor) and M4 (dysarthria) are different domains driven by different anatomy,
# so agreement between them is real corroboration.
DOMAINS = {
    "A": "cranial_nerves",
    # B was one "speech_language" domain. Dysarthria (motor) and aphasia (language) are
    # different lesions with different meanings, and merging them meant they could never
    # corroborate each other under Gate 2.
    "B1": "motor_speech",
    "B2": "language",
    "C": "motor",
    "D": "coordination_gait",
    # Posterior circulation. Kept apart from coordination_gait because limb ataxia and
    # vestibular/oculomotor failure are different systems that fail independently — the
    # index case had NORMAL finger-nose and heel-knee-shin with a confirmed cerebellar
    # infarct. Merged, this domain could never corroborate that one under Gate 2.
    "D2": "posterior_vestibular",
    "E": "cognition",
    "F": "mood_fatigue_function",
    "G": "vitals_prevention",
}

# NOTE: posterior_vestibular is deliberately NOT in this set — it DOES carry a side, so a
# posterior-circulation patient can satisfy Gate 3 and reach ALERT on balance and eye
# movement alone, with no limb or facial sign anywhere.
#
# Which measure supplies the side matters, and we had this the wrong way round. Saccade and
# pursuit metrics are direction-dependent and are the reliable source: in the only real
# patient we have, the lateralised finding was M3 saccade velocity asymmetry (~0.37,
# leftward slower and later). His Unterberger angular deviation was classified NORMAL.
# Balance corroborates; the eye establishes. See docs/GAP_ANALYSIS.md D-2.

#: Domains with no left/right axis. They can corroborate a focal finding, never establish one.
NON_LATERALISABLE_DOMAINS = frozenset({
    # Neither half of speech has a left/right axis. Splitting the domain deliberately does
    # NOT weaken Gate 3: dysarthria plus aphasia is now two domains, so it satisfies Gate 2,
    # but with no lateralised finding it still cannot reach ALERT.
    "motor_speech", "language", "cognition", "mood_fatigue_function", "vitals_prevention",
})

#: The three domains Parkinson's degrades together.
# Hypophonia and monotone are a MOTOR speech problem; parkinsonian language is typically
# preserved. The triad tracks motor_speech, not language.
PARKINSONIAN_TRIAD = ("cranial_nerves", "motor", "motor_speech")


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

        `gateable_only` excludes modules recorded but not allowed to drive the gate —
        questionnaires with their own validated cut-offs, and any module with too few
        features for a mean to be stable. Pass False for the display view.
        """
        out: dict[str, float] = {}
        for dev in self.modules.values():
            if not dev.computed:
                continue
            if gateable_only and not dev.gateable:
                continue
            out[dev.domain] = max(out.get(dev.domain, 0.0), dev.mean_abs_z)
        return out

    def lateral_deviation(self) -> dict[str, float]:
        """Worst *asymmetry* deviation per domain. Zero where the domain has no laterality."""
        out: dict[str, float] = {}
        for dev in self.modules.values():
            if not dev.computed or not dev.gateable:
                continue
            out[dev.domain] = max(out.get(dev.domain, 0.0), dev.lateral_abs_z)
        return out

    def lateralised_domains(self) -> set[str]:
        """Domains showing a genuinely one-sided change on this session."""
        return {dev.domain for dev in self.modules.values() if is_lateralised(dev)}

    def improving_domains(self) -> set[str]:
        return {d.domain for d in self.modules.values() if d.computed and d.improving}


def is_lateralised(deviation: ModuleDeviation) -> bool:
    """Does this module's change look one-sided?

    False for a module with no asymmetry features at all — speech cannot be lateralised, so
    it can never be the domain that establishes a focal deficit.
    """
    return bool(
        deviation.computed
        and deviation.gateable
        and deviation.has_laterality
        and deviation.lateralised
    )


@dataclass(slots=True)
class GateResult:
    band: str = BAND_STABLE
    gate1_passed: bool = False
    gate2_passed: bool = False
    gate3_passed: bool = False
    persistent_domains: list[str] = field(default_factory=list)
    lateralised_domains: list[str] = field(default_factory=list)
    flagged_today: list[str] = field(default_factory=list)
    improving: bool = False
    symmetric_pattern: bool = False
    sustained_sessions: int = 0
    reason: str = "within this patient's usual variation"
    drivers: list[tuple[str, float]] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "band": self.band,
            "gate1_passed": self.gate1_passed,
            "gate2_passed": self.gate2_passed,
            "gate3_passed": self.gate3_passed,
            "persistent_domains": self.persistent_domains,
            "lateralised_domains": self.lateralised_domains,
            "flagged_today": self.flagged_today,
            "improving": self.improving,
            "symmetric_pattern": self.symmetric_pattern,
            "sustained_sessions": self.sustained_sessions,
            "reason": self.reason,
            "drivers": [list(d) for d in self.drivers],
        }


def detect_symmetric_pattern(
    window: Sequence[SessionDeviations],
    persistent: Sequence[str],
    *,
    threshold: float = DEV_THRESHOLD,
) -> bool:
    """A slow, symmetric, progressive decline across face, motor and voice together.

    That combination is the classic parkinsonian presentation — bradykinesia, hypophonia,
    masked facies — and it is emphatically not a focal deficit. Detecting it lets us say
    something useful ("this does not look one-sided; discuss other neurological causes")
    instead of either raising a stroke alert that is wrong or going silent about a real and
    progressive change.

    Requires all of:
      - all three of the parkinsonian triad persistently deviating
      - none of them lateralised, on any session in the window
      - the deviation not shrinking across the window (progressive, not a transient dip)
    """
    if not all(domain in persistent for domain in PARKINSONIAN_TRIAD):
        return False

    # Any one-sided finding rules this out immediately — that is a focal deficit.
    for session in window:
        if session.lateralised_domains():
            return False

    series: list[float] = []
    for session in window:
        devs = session.domain_deviation()
        values = [devs.get(d, 0.0) for d in PARKINSONIAN_TRIAD]
        if not all(v > threshold for v in values):
            return False
        series.append(sum(values) / len(values))

    if len(series) < 2:
        return False
    # Progressive rather than a dip that is already resolving.
    return series[-1] >= series[0]


def evaluate_gates(
    history: Sequence[SessionDeviations],
    *,
    threshold: float = DEV_THRESHOLD,
    persistence: int = PERSISTENCE_SESSIONS,
    min_domains: int = MIN_DOMAINS,
) -> GateResult:
    """Apply all three gates to a chronological run of sessions (most recent last).

    Only *valid* sessions count toward persistence. A rejected capture does not break a run
    and does not extend it — it is simply not a session for gating purposes, which prevents
    a bad capture from either masking or manufacturing a deviation.
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

    # --- GATE 3: laterality ---
    # Required across the whole persistence window, not just today: a single session's
    # asymmetry can come from head tilt or an awkward grip on the phone.
    if len(window) >= persistence:
        sustained_lateral = set(window[0].lateralised_domains())
        for sess in window[1:]:
            sustained_lateral &= sess.lateralised_domains()
        result.lateralised_domains = sorted(
            sustained_lateral & set(result.persistent_domains)
        )
    result.gate3_passed = len(result.lateralised_domains) >= MIN_LATERALISED_DOMAINS

    # --- GATE 2: independent corroboration ---
    result.gate2_passed = len(result.persistent_domains) >= min_domains

    # --- the parkinsonian pattern, checked before any alert can be emitted ---
    if len(window) >= persistence and detect_symmetric_pattern(
        window, result.persistent_domains, threshold=threshold
    ):
        result.symmetric_pattern = True
        result.band = BAND_ATYPICAL
        result.reason = (
            "face, movement and voice are all changing together and symmetrically, "
            "with no one-sided finding"
        )
        return result

    if result.gate1_passed and result.gate2_passed and result.gate3_passed:
        result.band = BAND_ALERT
        result.reason = (
            f"{len(result.persistent_domains)} independent domains "
            f"({', '.join(result.persistent_domains)}) deviating across "
            f"{result.sustained_sessions or persistence} consecutive sessions, "
            f"including a one-sided change in {', '.join(result.lateralised_domains)}"
        )
    elif result.gate1_passed and result.gate2_passed:
        # Two domains agree, but nothing is one-sided. Real, and worth watching — but not
        # the focal pattern this system is validated to alert on.
        result.band = BAND_WATCH
        result.reason = (
            f"{len(result.persistent_domains)} domains deviating "
            f"({', '.join(result.persistent_domains)}), but the change is not one-sided"
        )
    elif result.gate1_passed:
        result.band = BAND_WATCH
        result.reason = (
            f"{result.persistent_domains[0]} deviating across "
            f"{result.sustained_sessions or persistence} sessions, "
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
    """Ordering for display. PATTERN_ATYPICAL sits alongside WATCH: it warrants a
    conversation with a doctor, but it is not the focal deterioration we alert on."""
    return {BAND_STABLE: 0, BAND_WATCH: 1, BAND_ATYPICAL: 1, BAND_ALERT: 2}.get(band, 0)


def domains_for(modules: Iterable[ModuleDeviation]) -> set[str]:
    return {m.domain for m in modules}
