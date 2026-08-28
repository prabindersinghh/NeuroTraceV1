"""The daily session protocol — ordered blocks, intensity, and fatigue control.

WHY ORDER IS PART OF THE MEASUREMENT, NOT PRESENTATION
------------------------------------------------------
A twelve-minute battery tires an 82-year-old stroke survivor. That is not a reason to run a
shorter battery — a real clinic follow-up runs thirty minutes and we are replicating that
examination — but it does mean fatigue has to be *controlled* rather than ignored.

The control is FIXED ORDERING. If finger tapping always runs fifteenth, then every session's
tapping is measured at the same point on the fatigue curve, and the patient's own baseline
absorbs that offset. Position becomes a constant, and a constant cannot confound.

Which is exactly why the things that CHANGE position are dangerous, and why this module
records them:

  INTENSITY. STANDARD drops SVV, vertical saccades and M8b. A patient whose baseline was
  built on FULL and who then moves to STANDARD performs M7 with three fewer preceding tasks
  — less fatigued, better performance, reading as improvement. That is a systematic bias in
  the direction that MASKS DECLINE, which is the one direction we cannot afford.

  PAUSE. Tasks after a ninety-minute pause are performed rested, against a baseline built
  unpaused. Same bias, same direction.

So every module result carries `session_position`, `elapsed_seconds_at_task_start`,
`intensity` and `paused_before_task`. An intensity change is a confounder, not a silent
event. See `docs/DECISIONS.md` D-027.

FATIGUE AS A FINDING
--------------------
`within_session_fatigue_slope` is not only nuisance-correction. Post-stroke fatigue is a
real and under-measured symptom, and a patient whose performance decays more steeply across
blocks this month than last month has told us something. It is recorded as a feature.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field


class Intensity(str, enum.Enum):
    """How much of the battery this patient runs. On the patient record."""

    #: The full 22-step schedule, ~11-12 minutes. The default.
    FULL = "FULL"
    #: Drops SVV, vertical saccades and rapid alternating. ~8 minutes.
    STANDARD = "STANDARD"
    #: Core only; physical blocks rotate across days. ~4 minutes.
    LIGHT = "LIGHT"
    #: FULL plus the supervised balance tasks. ASHA visit only.
    RESEARCH = "RESEARCH"


class Block(str, enum.Enum):
    A_COGNITIVE = "A_seated_cognitive"
    B_OCULAR = "B_seated_ocular"
    C_BALANCE = "C_standing_balance"
    D_MOTOR = "D_seated_motor"
    E_CLOSE = "E_close"


@dataclass(frozen=True, slots=True)
class Step:
    """One step of the protocol. `position` is 1-indexed and is part of the measurement."""

    position: int
    module: str
    task: str
    block: Block
    seconds: int
    label_en: str
    #: Dropped at STANDARD. Never dropped at FULL or RESEARCH.
    optional_at_standard: bool = False
    #: Kept in LIGHT. Everything else rotates.
    core: bool = False


#: THE PROTOCOL. Order is clinically deliberate — see the module note. Do not rearrange
#: without recording it as a decision: rearranging invalidates every locked baseline,
#: because each module's baseline encodes its position on the fatigue curve.
PROTOCOL: tuple[Step, ...] = (
    # --- BLOCK A: seated, cognitive first, while freshest -------------------
    Step(1, "M10", "simple_and_choice_rt", Block.A_COGNITIVE, 60,
         "Tap the circle the moment it appears.", core=True),
    Step(2, "M11", "word_encoding", Block.A_COGNITIVE, 30,
         "Remember these five words."),
    Step(3, "M4", "sustained_ddk_sentence", Block.A_COGNITIVE, 40,
         "Take a breath and say aaah for as long as you can.", core=True),
    Step(4, "M1", "facial_battery", Block.A_COGNITIVE, 40,
         "Smile as wide as you can.", core=True),
    Step(5, "M2", "tongue_palate", Block.A_COGNITIVE, 20,
         "Stick your tongue straight out."),

    # --- BLOCK B: seated, ocular -------------------------------------------
    Step(6, "M3", "horizontal_saccades", Block.B_OCULAR, 45,
         "Keep your head still. Look at the dot each time it jumps.", core=True),
    Step(7, "M3", "vertical_saccades", Block.B_OCULAR, 25,
         "Look at the dot each time it jumps.", optional_at_standard=True),
    Step(8, "M3", "smooth_pursuit", Block.B_OCULAR, 30,
         "Follow the dot with your eyes. Don't move your head."),
    Step(9, "M3", "gaze_holding", Block.B_OCULAR, 40,
         "Hold your eyes on the dot."),
    Step(10, "M21", "svv_static_and_dynamic", Block.B_OCULAR, 60,
         "Turn the line until it looks perfectly upright to you.",
         optional_at_standard=True),

    # --- BLOCK C: STANDING. Fall-risk gate immediately before this block ----
    Step(11, "M9", "romberg_eyes_open", Block.C_BALANCE, 30,
         "Stand with your feet together, arms by your side."),
    Step(12, "M9", "romberg_eyes_closed", Block.C_BALANCE, 30,
         "Now close your eyes. Someone should be beside you."),
    Step(13, "M9", "tandem_stance", Block.C_BALANCE, 30,
         "Put one foot directly in front of the other, heel to toe."),
    Step(14, "M6", "pronator_drift", Block.C_BALANCE, 15,
         "Hold both arms straight out, palms up, and close your eyes."),

    # --- BLOCK D: seated, motor and coordination ---------------------------
    Step(15, "M7", "finger_tapping", Block.D_MOTOR, 25,
         "Tap the two circles, back and forth, as fast as you can.", core=True),
    Step(16, "M8", "finger_to_nose", Block.D_MOTOR, 30,
         "Touch the dot on the screen, then touch your nose. Repeat."),
    Step(17, "M8", "rapid_alternating", Block.D_MOTOR, 25,
         "Turn your hand over and back, as fast as you can.",
         optional_at_standard=True),

    # --- BLOCK E: close ----------------------------------------------------
    Step(18, "M11", "delayed_recall", Block.E_CLOSE, 30,
         "What were the five words?"),
    Step(19, "M13", "phq2", Block.E_CLOSE, 20,
         "Two quick questions about how you have been feeling.", core=True),
    Step(20, "M19", "medication_confirm", Block.E_CLOSE, 10,
         "Did they take their medicines today?", core=True),
    Step(21, "M17", "ppg_rhythm", Block.E_CLOSE, 60,
         "Cover the camera with your fingertip. Rest your hand."),
)

#: The six DAILY-schedule modules (`exam/registry.py`) — Part 2's Daily Pulse content,
#: exactly. Kept here rather than imported from registry.py to avoid a circular import
#: (registry.py does not import session_plan, and should not need to).
DAILY_PULSE_MODULES: frozenset[str] = frozenset({"M1", "M4", "M7", "M10", "M13", "M19"})


def _renumbered(steps: tuple[Step, ...], start: int = 1) -> tuple[Step, ...]:
    from dataclasses import replace
    return tuple(replace(s, position=start + i) for i, s in enumerate(steps))


# --------------------------------------------------------------- D-044: two session types
#
# WHY THIS IS DERIVED, NOT RETYPED. `PROTOCOL` above is the single source of truth for
# every step's content, instructions and timing. Splitting it into Daily Pulse and
# Comprehensive by re-deriving from it — rather than writing two new step lists by hand —
# means there is exactly one place a task's wording or duration can be edited, and it is
# structurally impossible for the two protocols to describe the same module differently.
#
# WHY DAILY-PULSE MODULES MUST LAND AT THE SAME POSITIONS IN BOTH PROTOCOLS. This is not
# cosmetic. `SessionObservation` (engine/baseline.py) carries a module's raw feature
# values into its baseline with NO position-adjustment — the median/MAD is computed
# directly over whatever the module measured. If M7 (finger tapping) genuinely taps slower
# late in a session than early (which the whole point of `within_session_fatigue_slope`
# is to say it does), then a baseline built from M7 readings captured at position 4 in
# Daily Pulse and position 15 in the OLD flat protocol would silently blend two different
# physiological states into one "normal" — the exact silent corruption Part 2.4 asked to
# rule out, just via fatigue position instead of measurement cadence. Consolidating the six
# Daily Pulse modules at IDENTICAL positions 1-6 in both protocols removes the confound by
# construction: they are always captured at the same point on the fatigue curve, in either
# session type. `test_session_type_protocols.py` pins this.
#
# The comprehensive-only steps keep their ORIGINAL RELATIVE ORDER from `PROTOCOL`, merely
# renumbered starting at 7 — so the fall-risk gate's position (derived dynamically by the
# `/plan/` endpoint from `Block.C_BALANCE` membership, never hardcoded) and the >=300s gap
# `session_plan.py`'s own `MIN_RECALL_DELAY_SECONDS` requires between M11's word-encoding
# and delayed-recall steps are both preserved exactly as they were.

DAILY_PULSE_STEPS: tuple[Step, ...] = _renumbered(
    tuple(s for s in PROTOCOL if s.module in DAILY_PULSE_MODULES)
)

COMPREHENSIVE_STEPS: tuple[Step, ...] = DAILY_PULSE_STEPS + _renumbered(
    tuple(s for s in PROTOCOL if s.module not in DAILY_PULSE_MODULES),
    start=len(DAILY_PULSE_STEPS) + 1,
)

#: Raw capture time for the whole Daily Pulse, derived rather than asserted — a second
#: hand-written constant is exactly how registry.py and this file came to disagree
#: (D-045). ~195s of capture; 3-4 minutes wall-clock with instructions and retries.
DAILY_PULSE_BUDGET_SECONDS = sum(s.seconds for s in DAILY_PULSE_STEPS)


def steps_for_session_type(
    session_type: str, intensity: Intensity | str | None = None, day_index: int = 0,
) -> list[Step]:
    """The ordered steps for one session TYPE — the entry point Part 2 adds.

    DAILY_PULSE ignores intensity: it is already the minimal core, there is nothing left
    to trim without dropping a module Daily Pulse exists to run every day. COMPREHENSIVE
    defers to `steps_for`'s existing FULL/STANDARD/LIGHT trimming, applied only to the
    positions at or after 7 (the comprehensive-only additions) — Daily Pulse's own six
    steps are never optional or rotated, for the same position-consistency reason they are
    never renumbered.
    """
    if session_type in ("DAILY_PULSE", "daily_pulse"):
        return list(DAILY_PULSE_STEPS)
    if session_type in ("COMPREHENSIVE", "comprehensive"):
        level = Intensity(intensity) if intensity else Intensity.FULL
        if level in (Intensity.FULL, Intensity.RESEARCH):
            return list(COMPREHENSIVE_STEPS)
        core_positions = {s.position for s in DAILY_PULSE_STEPS}
        if level is Intensity.STANDARD:
            return [s for s in COMPREHENSIVE_STEPS
                    if s.position in core_positions or not s.optional_at_standard]
        # LIGHT: Daily Pulse's six every day, plus one rotating comprehensive-only block.
        additions = [s for s in COMPREHENSIVE_STEPS if s.position not in core_positions]
        rotating_blocks = [Block.B_OCULAR, Block.C_BALANCE, Block.D_MOTOR]
        today = rotating_blocks[day_index % len(rotating_blocks)]
        return list(DAILY_PULSE_STEPS) + [
            s for s in additions if s.core or s.block is today
        ]
    raise ValueError(
        f"unknown session_type {session_type!r}; expected DAILY_PULSE or COMPREHENSIVE "
        "(MONTHLY and ASHA_VISIT use exam/registry.py's modules_for(), not a fixed "
        "fatigue-ordered protocol — they are not run daily, so position-on-the-fatigue-"
        "curve is not the confound risk it is for the other two)"
    )


#: Never in the unsupervised daily rotation. Fall risk or hardware.
#:
#: Unterberger and tandem walking carry the DIRECTION of deviation — every one of M9's
#: lateral features comes from them — so it is tempting to want them daily. They involve
#: fifty eyes-closed steps and ten heel-to-toe steps respectively, performed by someone
#: whose balance we are measuring precisely because it is impaired. INV-10 enforces this.
SUPERVISED_ONLY: frozenset[str] = frozenset({
    "unterberger", "tandem_walk", "line_bisection", "star_cancellation",
})

#: Delayed recall must be at least this long after encoding to mean anything clinically.
MIN_RECALL_DELAY_SECONDS = 300


def steps_for(intensity: Intensity | str, day_index: int = 0) -> list[Step]:
    """The ordered steps this patient runs today.

    `day_index` only matters at LIGHT, where the non-core physical blocks rotate so the
    patient still gets full coverage across a week without a twelve-minute session.

    NOTE the cost of that rotation, which is real: a module that runs on some days and not
    others is measured at a varying position on the fatigue curve, so its baseline is noisier
    than a FULL patient's. That is the price of keeping a frail patient enrolled at all, and
    it is recorded per result rather than hidden.
    """
    intensity = Intensity(intensity)

    if intensity in (Intensity.FULL, Intensity.RESEARCH):
        return list(PROTOCOL)

    if intensity is Intensity.STANDARD:
        return [s for s in PROTOCOL if not s.optional_at_standard]

    # LIGHT: core every day, plus one rotating physical block.
    rotating_blocks = [Block.B_OCULAR, Block.C_BALANCE, Block.D_MOTOR]
    today = rotating_blocks[day_index % len(rotating_blocks)]
    return [s for s in PROTOCOL if s.core or s.block is today]


def planned_seconds(steps: list[Step]) -> int:
    """Task time only. Real sessions run longer — instructions, framing, retries."""
    return sum(s.seconds for s in steps)


@dataclass(slots=True)
class TaskTiming:
    """What every module result carries so fatigue is measurable, not confounding."""

    position: int
    elapsed_seconds_at_task_start: float
    intensity: str
    #: True when the session was paused at any point before this task began. Tasks after a
    #: pause are performed rested against a baseline built unpaused.
    paused_before_task: bool = False
    pauses_so_far: int = 0

    def to_json(self) -> dict:
        return {
            "session_position": float(self.position),
            "elapsed_seconds_at_task_start": float(self.elapsed_seconds_at_task_start),
            "paused_before_task": float(self.paused_before_task),
            "pauses_so_far": float(self.pauses_so_far),
        }


def within_session_fatigue_slope(performance_by_position: list[tuple[int, float]]) -> float:
    """Least-squares slope of normalised performance against session position.

    Negative = performance decays across the session. This is a clinical signal in its own
    right — post-stroke fatigue is real, under-measured, and a patient whose decay steepens
    month over month has told us something — as well as the term that lets a deviation be
    read net of fatigue.

    `performance_by_position` is [(position, normalised_score)] where higher is better,
    each score already z-scored against that module's own baseline so the units are
    comparable across tasks.
    """
    pts = [(float(p), float(v)) for p, v in performance_by_position]
    if len(pts) < 3:
        return 0.0
    xs = [p for p, _ in pts]
    ys = [v for _, v in pts]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    denom = sum((x - mx) ** 2 for x in xs)
    if denom < 1e-9:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in pts) / denom


#: Repeated abandonment is the signal to offer a shorter session. Thresholds from the spec.
PAUSES_BEFORE_SUGGESTING_LIGHTER = 3
ABANDONS_PER_WEEK_BEFORE_SUGGESTING_LIGHTER = 2


def should_offer_lighter(pauses_this_session: int, abandons_this_week: int,
                         current: Intensity | str) -> Intensity | None:
    """Suggest a step down. NEVER a step up.

    Auto-escalating a frail patient back to a longer battery because they had one good week
    is how you lose them. Stepping up is a human decision.
    """
    current = Intensity(current)
    if current is Intensity.LIGHT:
        return None
    trigger = (
        pauses_this_session > PAUSES_BEFORE_SUGGESTING_LIGHTER
        or abandons_this_week >= ABANDONS_PER_WEEK_BEFORE_SUGGESTING_LIGHTER
    )
    if not trigger:
        return None
    return Intensity.STANDARD if current in (Intensity.FULL, Intensity.RESEARCH) \
        else Intensity.LIGHT
