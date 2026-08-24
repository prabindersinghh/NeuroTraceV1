/**
 * The illustration data for the signed-out surface.
 *
 * WHAT THIS IS AND IS NOT.
 * These are not patient values and they are not model output. They are a deterministic
 * re-creation of the shape of the seeded 21-day demo run described in the README, produced
 * from a fixed seed so the page draws identically on every visit and in every screenshot.
 * Every constant it keys off — the 2.0 robust-z threshold, two consecutive sessions, two
 * independent domains, one lateralised domain, the 12-session baseline window, which seven
 * domains can gate and which of those carry a side — is read off the engine, not invented
 * here. Wherever the page shows one of these numbers it says on the page that it is the
 * seeded run.
 *
 * Mirrors: backend/app/engine/gates.py, backend/app/exam/registry.py.
 */

/** Mean |robust z| above which a module counts as deviating. `gates.DEV_THRESHOLD`. */
export const DEV_THRESHOLD = 2.0;
/** Gate 1: consecutive valid sessions. `gates.PERSISTENCE_SESSIONS`. */
export const PERSISTENCE_SESSIONS = 2;
/** Gate 2: independent domains. `gates.MIN_DOMAINS`. */
export const MIN_DOMAINS = 2;
/** Sessions of median+MAD before the engine will judge anything. */
export const BASELINE_SESSIONS = 12;
/** The run the demo replays. */
export const RUN_DAYS = 21;
/** Days 1–15 are collection only: the engine has not learned this person's normal yet. */
export const BASELINE_UNTIL = 15;

export type Band = "BASELINE" | "STABLE" | "WATCH" | "ALERT";

export interface Domain {
  key: string;
  /** Full name, used in prose and in the domain table. */
  label: string;
  /** Lane label. The plate gutter is ~110px at 1440 and less on a phone, and the canvas
   *  cannot ellipsize, so the long names have to be pre-shortened rather than clipped. */
  lane: string;
  /** What the daily or weekly tasks in this domain actually measure. */
  measures: string;
  /** Does a deviation here carry a left/right side? `gates.NON_LATERALISABLE_DOMAINS`. */
  lateral: boolean;
  /** The modules that feed it, for the domain table. */
  modules: string;
}

/**
 * The seven domains that can gate an alert.
 *
 * `mood_fatigue_function` and `vitals_prevention` are recorded every day and shown to the
 * clinician, but every module in them is declared `gates_alerts=False` — a low PHQ-2 or a
 * missed dose is a reason to call, never a reason for this engine to raise a neurological
 * alert. They are listed separately on the page for that reason.
 */
export const DOMAINS: Domain[] = [
  { key: "cranial_nerves", label: "Cranial nerves", lane: "CRANIAL", lateral: true,
    measures: "Smile symmetry, mouth droop, eye aperture — and the forehead raise, which separates a stroke from Bell's palsy",
    modules: "M1 · M2" },
  { key: "motor_speech", label: "Motor speech", lane: "SPEECH", lateral: false,
    measures: "Voice quality, how long a breath lasts, and how regular “pa-ta-ka” stays",
    modules: "M4" },
  { key: "language", label: "Language", lane: "LANGUAGE", lateral: false,
    measures: "Naming, comprehension, word finding. A different lesion from slurred speech, so a separate domain",
    modules: "M5" },
  { key: "motor", label: "Motor", lane: "MOTOR", lateral: true,
    measures: "Tap rate per hand, the left-right ratio, and arm drift",
    modules: "M6 · M7" },
  { key: "coordination_gait", label: "Coordination & gait", lane: "COORDINATION", lateral: true,
    measures: "Finger-to-nose, rapid alternating movement, walking and turning",
    modules: "M8 · M9" },
  { key: "posterior_vestibular", label: "Posterior / vestibular", lane: "VESTIBULAR", lateral: true,
    measures: "Eye-jump speed and delay, pursuit, standing sway, and their sense of upright",
    modules: "M3 · M9 · M21" },
  { key: "cognition", label: "Cognition", lane: "COGNITION", lateral: false,
    measures: "Reaction time and how variable it is; recall and visual attention",
    modules: "M10 · M11 · M12" },
];

/** Recorded daily, never gates. */
export const NON_GATING = [
  { label: "Mood, fatigue & function", modules: "M13 · M14 · M15 · M16",
    note: "PHQ-2, fatigue, daily function, swallowing" },
  { label: "Vitals & prevention", modules: "M17 · M18 · M19 · M20",
    note: "Fingertip PPG rhythm, blood pressure, adherence, symptom report" },
];

/** mulberry32 — small, seeded, and identical run to run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The three domains that move in the demo run: face, speech, hand. */
const DECLINING = new Set(["cranial_nerves", "motor_speech", "motor"]);

export interface DayPoint {
  /** Mean |robust z| for the domain that day. */
  z: number;
  /** The asymmetry component — zero for a domain with no left/right axis. */
  asymmetry: number;
}

export type Series = Record<string, DayPoint[]>;

/**
 * The 21-day run: fifteen days of collection, three stable, then a three-domain decline
 * that clears Gate 1 on day 20 and stays cleared on day 21.
 */
export function buildRun(seed = 42): Series {
  const series: Series = {};
  for (const domain of DOMAINS) {
    const noise = rng(seed + domain.key.length * 977 + domain.key.charCodeAt(0) * 31);
    const points: DayPoint[] = [];
    for (let day = 1; day <= RUN_DAYS; day += 1) {
      // Day-to-day wobble that a threshold model would keep tripping over.
      let z = (noise() - 0.5) * 1.6;
      if (DECLINING.has(domain.key)) {
        // Day 19 is the first session outside the band; 20 and 21 hold there.
        if (day === 19) z = 2.35 + noise() * 0.45;
        else if (day === 20) z = 2.7 + noise() * 0.5;
        else if (day === 21) z = 2.55 + noise() * 0.45;
      }
      const lateral = domain.lateral && DECLINING.has(domain.key) && day >= 19;
      points.push({
        z: Number(z.toFixed(3)),
        asymmetry: lateral ? Number((z * 0.72).toFixed(3)) : 0,
      });
    }
    series[domain.key] = points;
  }
  return series;
}

/** Which domains are deviating on a given day (1-indexed). */
export function deviatingOn(series: Series, day: number): string[] {
  return DOMAINS
    .filter((d) => Math.abs(series[d.key][day - 1]?.z ?? 0) >= DEV_THRESHOLD)
    .map((d) => d.key);
}

export interface Verdict {
  band: Band;
  gate1: string[];   // domains deviating for >= PERSISTENCE_SESSIONS consecutive days
  gate2: boolean;    // >= MIN_DOMAINS of them
  gate3: string[];   // of those, the ones carrying a side
  /** True on the second and later ALERT days: the band holds, the family is not re-notified. */
  repeat: boolean;
}

/**
 * The engine's decision for a given day, evaluated the way `gates.evaluate` evaluates it.
 *
 * Kept as one function rather than hard-coded per day so the page cannot drift out of
 * agreement with the story it is telling: change the series and the bands follow.
 */
export function verdictOn(series: Series, day: number): Verdict {
  if (day <= BASELINE_UNTIL) return { band: "BASELINE", gate1: [], gate2: false, gate3: [], repeat: false };

  const gate1 = DOMAINS.filter((d) => {
    for (let back = 0; back < PERSISTENCE_SESSIONS; back += 1) {
      const point = series[d.key][day - 1 - back];
      if (!point || Math.abs(point.z) < DEV_THRESHOLD) return false;
    }
    return true;
  }).map((d) => d.key);

  const gate2 = gate1.length >= MIN_DOMAINS;
  const gate3 = gate1.filter((key) => (series[key][day - 1]?.asymmetry ?? 0) !== 0);

  const alert = gate1.length > 0 && gate2 && gate3.length > 0;
  const anyDeviating = deviatingOn(series, day).length > 0;

  let band: Band = "STABLE";
  if (alert) band = "ALERT";
  else if (anyDeviating) band = "WATCH";

  const previous = day > BASELINE_UNTIL + 1 ? verdictOn(series, day - 1) : null;
  return { band, gate1, gate2, gate3, repeat: alert && previous?.band === "ALERT" };
}
