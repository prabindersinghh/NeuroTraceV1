/**
 * The daily protocol, on the client.
 *
 * The SERVER is the source of truth (`GET /sessions/plan/{intensity}` renders
 * `backend/app/exam/session_plan.py`). The constant below is the OFFLINE MIRROR — the
 * session must start in airplane mode, and a protocol that needs the network to be known
 * breaks the product's central promise. `loadPlan()` prefers the server and falls back to
 * this; a parity test on the backend pins the two against each other, so a drift is a
 * failing build, not a silent fork.
 *
 * WEB CAPTURE COVERAGE IS EXPLICIT.
 * `WEB_RUNNABLE` lists the tasks this PWA can actually measure today. A protocol step
 * without a capture engine is SKIPPED, never faked: a step that renders a timer while
 * measuring nothing would produce a session that looks complete and is partly hollow.
 * What is skipped and why is a fact the audit reports, not something buried here.
 */
import { api } from "./api";
import type { SessionType } from "./types";

export type Intensity = "full" | "standard" | "light" | "research";

export interface PlanStep {
  position: number;
  module: string;
  task: string;
  block: string;
  seconds: number;
  label_en: string;
  core: boolean;
}

export interface SessionPlan {
  intensity: Intensity;
  /** Part 2 (D-044). Absent on responses from the deprecated `/plan/` endpoint. */
  session_type?: SessionType;
  planned_seconds: number;
  /** The fall-risk gate renders immediately before this position. */
  fall_gate_before_position: number | null;
  steps: PlanStep[];
}

/** Mirror of `session_plan.PROTOCOL` at FULL. Positions are canonical and never renumber. */
export const PROTOCOL_MIRROR: PlanStep[] = [
  { position: 1, module: "M10", task: "simple_and_choice_rt", block: "A_seated_cognitive", seconds: 60, label_en: "Tap the circle the moment it appears.", core: true },
  { position: 2, module: "M11", task: "word_encoding", block: "A_seated_cognitive", seconds: 30, label_en: "Remember these five words.", core: false },
  { position: 3, module: "M4", task: "sustained_ddk_sentence", block: "A_seated_cognitive", seconds: 40, label_en: "Take a breath and say aaah for as long as you can.", core: true },
  { position: 4, module: "M1", task: "facial_battery", block: "A_seated_cognitive", seconds: 40, label_en: "Smile as wide as you can.", core: true },
  { position: 5, module: "M2", task: "tongue_palate", block: "A_seated_cognitive", seconds: 20, label_en: "Stick your tongue straight out.", core: false },
  { position: 6, module: "M3", task: "horizontal_saccades", block: "B_seated_ocular", seconds: 45, label_en: "Keep your head still. Look at the dot each time it jumps.", core: true },
  { position: 7, module: "M3", task: "vertical_saccades", block: "B_seated_ocular", seconds: 25, label_en: "Look at the dot each time it jumps.", core: false },
  { position: 8, module: "M3", task: "smooth_pursuit", block: "B_seated_ocular", seconds: 30, label_en: "Follow the dot with your eyes. Don't move your head.", core: false },
  { position: 9, module: "M3", task: "gaze_holding", block: "B_seated_ocular", seconds: 40, label_en: "Hold your eyes on the dot.", core: false },
  { position: 10, module: "M21", task: "svv_static_and_dynamic", block: "B_seated_ocular", seconds: 60, label_en: "Turn the line until it looks perfectly upright to you.", core: false },
  { position: 11, module: "M9", task: "romberg_eyes_open", block: "C_standing_balance", seconds: 30, label_en: "Stand with your feet together, arms by your side.", core: false },
  { position: 12, module: "M9", task: "romberg_eyes_closed", block: "C_standing_balance", seconds: 30, label_en: "Now close your eyes. Someone should be beside you.", core: false },
  { position: 13, module: "M9", task: "tandem_stance", block: "C_standing_balance", seconds: 30, label_en: "Put one foot directly in front of the other, heel to toe.", core: false },
  { position: 14, module: "M6", task: "pronator_drift", block: "C_standing_balance", seconds: 15, label_en: "Hold both arms straight out, palms up, and close your eyes.", core: false },
  { position: 15, module: "M7", task: "finger_tapping", block: "D_seated_motor", seconds: 25, label_en: "Tap the two circles, back and forth, as fast as you can.", core: true },
  { position: 16, module: "M8", task: "finger_to_nose", block: "D_seated_motor", seconds: 30, label_en: "Touch the dot on the screen, then touch your nose. Repeat.", core: false },
  { position: 17, module: "M8", task: "rapid_alternating", block: "D_seated_motor", seconds: 25, label_en: "Turn your hand over and back, as fast as you can.", core: false },
  { position: 18, module: "M11", task: "delayed_recall", block: "E_close", seconds: 30, label_en: "What were the five words?", core: false },
  { position: 19, module: "M13", task: "phq2", block: "E_close", seconds: 20, label_en: "Two quick questions about how you have been feeling.", core: true },
  { position: 20, module: "M19", task: "medication_confirm", block: "E_close", seconds: 10, label_en: "Did they take their medicines today?", core: true },
  { position: 21, module: "M17", task: "ppg_rhythm", block: "E_close", seconds: 60, label_en: "Cover the camera with your fingertip. Rest your hand.", core: false },
];

/** Tasks with a real capture engine in this PWA. Everything else is skipped, not faked. */
export const WEB_RUNNABLE = new Set<string>([
  "simple_and_choice_rt",   // M10 — tap RT, built
  "word_encoding",          // M11 — on-screen encoding
  "sustained_ddk_sentence", // M4 — PCM + DSP, built
  "facial_battery",         // M1 — FaceLandmarker, built
  "horizontal_saccades",    // M3 — iris landmarks (built this session)
  "vertical_saccades",
  "smooth_pursuit",
  "gaze_holding",
  "svv_static_and_dynamic", // M21 — built
  "romberg_eyes_open",      // M9 — PoseLandmarker (built this session)
  "romberg_eyes_closed",
  "tandem_stance",
  "pronator_drift",         // M6 — PoseLandmarker
  "finger_tapping",         // M7 — built
  "delayed_recall",         // M11 — recognition variant
  "phq2",                   // M13
  "medication_confirm",     // M19
  "ppg_rhythm",             // M17 — fingertip PPG (built this session)
]);

/**
 * Not measurable in this PWA yet, and why. Shown to nobody mid-session — the step simply
 * does not run — but reported honestly wherever coverage is discussed.
 */
export const WEB_EXCLUDED: Record<string, string> = {
  tongue_palate: "FaceLandmarker has no tongue landmarks; a protrusion blendshape cannot measure deviation, which is the clinical signal.",
  finger_to_nose: "Needs hand tracking; the hand model is not staged and a wrong measurement is worse than a missing one.",
  rapid_alternating: "Same — hand tracking.",
};

// (The old hardcoded MIRROR_FALL_GATE = 11 was removed with D-044's renumbering — the
// gate position is now derived from the actual standing block, see mirrorPlan.)

/** The six DAILY-schedule modules — Daily Pulse's content. Mirrors
 *  `session_plan.DAILY_PULSE_MODULES`; kept in sync by `protocol.test.ts`. */
const DAILY_PULSE_MODULES = new Set(["M1", "M4", "M7", "M10", "M13", "M19"]);

/** Renumber a step list 1..N, preserving order. Mirrors `session_plan._renumbered`. */
function renumbered(steps: PlanStep[], start = 1): PlanStep[] {
  return steps.map((s, i) => ({ ...s, position: start + i }));
}

/**
 * The offline mirror, split by session type the SAME WAY the server splits it (D-044).
 *
 * This derivation is not duplicated logic for its own sake — it is what keeps the offline
 * path from disagreeing with the server about where a module sits in the session. Since
 * every module's baseline encodes its position on the fatigue curve, an offline session
 * that ran M7 at a different position than an online one would feed two different
 * physiological states into the same baseline: precisely the corruption the server-side
 * position-consistency guarantee exists to prevent, reintroduced through the back door.
 */
function mirrorPlan(intensity: Intensity, sessionType: SessionType): SessionPlan {
  const dailyPulse = renumbered(PROTOCOL_MIRROR.filter((s) => DAILY_PULSE_MODULES.has(s.module)));

  let steps: PlanStep[];
  if (sessionType === "DAILY_PULSE") {
    steps = dailyPulse;  // intensity is ignored: nothing left to trim, same as the server
  } else {
    const additions = renumbered(
      PROTOCOL_MIRROR.filter((s) => !DAILY_PULSE_MODULES.has(s.module)),
      dailyPulse.length + 1,
    );
    // STANDARD drops the three optional steps; LIGHT and RESEARCH fall back to FULL rather
    // than guessing — the server is authoritative for those.
    const trimmed = intensity === "standard"
      ? additions.filter(
          (s) => !["vertical_saccades", "svv_static_and_dynamic", "rapid_alternating"].includes(s.task),
        )
      : additions;
    steps = [...dailyPulse, ...trimmed];
  }

  const firstStanding = steps.find((s) => s.block.startsWith("C_"));
  return {
    intensity,
    session_type: sessionType,
    planned_seconds: steps.reduce((a, s) => a + s.seconds, 0),
    // Derived, not the hardcoded MIRROR_FALL_GATE constant: renumbering moved the standing
    // block, and a stale gate position would render the fall-risk gate at the wrong step.
    fall_gate_before_position: firstStanding ? firstStanding.position : null,
    steps,
  };
}

/** Server plan when reachable; the mirror when not. Never throws. */
export async function loadPlan(
  intensity: Intensity, sessionType: SessionType = "COMPREHENSIVE",
): Promise<SessionPlan> {
  try {
    const plan = await api.sessionPlanV2(sessionType, intensity.toUpperCase());
    if (plan?.steps?.length) return plan;
  } catch {
    /* offline — exactly the situation the mirror exists for */
  }
  return mirrorPlan(intensity, sessionType);
}

/** The steps this PWA will actually run, in order. */
export function runnableSteps(plan: SessionPlan): PlanStep[] {
  return plan.steps.filter((s) => WEB_RUNNABLE.has(s.task));
}
