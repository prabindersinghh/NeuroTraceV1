/**
 * What reaches a caregiver, and what deliberately does not — Part 6.2.
 *
 * Pure functions, no React, no network, so the rules can be asserted directly. Same reason
 * `taskFlow.ts` exists: the last time a behavioural rule lived only inside a component, two
 * retry bugs shipped and only surfaced when the rules were pulled out and tested.
 *
 * THE RULE THAT IS EASIEST TO GET WRONG: **WATCH does not notify.** WATCH means "something
 * moved, we are not yet sure it means anything" — it is the band the engine uses while it
 * waits for a second corroborating domain. Notifying on it would train a family to ignore
 * the notification that actually matters, and the whole three-gate design exists to avoid
 * crying wolf. A WATCH is visible on the dashboard when someone looks; it does not go and
 * find them.
 *
 * THE OTHER RULE: no message may imply reassurance. "Everything looks fine" is a clinical
 * claim this product cannot make — it observes a handful of features for a few minutes a
 * day and cannot see most of what could be wrong. Silence is how we say "nothing crossed a
 * threshold", and that is all it means.
 */

export type Band = "STABLE" | "WATCH" | "ALERT" | "PATTERN_ATYPICAL";

export type NotifyReason =
  | "ALERT"
  | "PATTERN_ATYPICAL"
  | "MISSED_SESSIONS"
  | "LOW_QUALITY_STREAK"
  | "ADHERENCE_DROP";

export interface PatientSignals {
  band: Band | null;
  /** Consecutive days with no completed session. */
  missedSessionDays: number;
  /** Consecutive sessions flagged low-quality. */
  lowQualityStreak: number;
  /** Completed / expected over the recent window, 0..1. `null` when not yet computable. */
  adherence: number | null;
  /** A baseline still being collected or awaiting a doctor is not being monitored. */
  monitoring: boolean;
}

/** Three missed days is a pattern rather than a bad week — a Sunday off is not a signal. */
export const MISSED_DAYS_FLOOR = 3;

/** Two in a row: one bad capture is light or a wobble, two is something systematic. */
export const LOW_QUALITY_STREAK_FLOOR = 2;

/** Below this the record is too thin to reason about, so it is worth saying so. */
export const ADHERENCE_FLOOR = 0.6;

export interface Notification {
  reason: NotifyReason;
  /** Ordering only. Not a clinical severity, and never rendered as one. */
  rank: number;
}

/**
 * Every reason this patient should reach their caregiver, most urgent first.
 *
 * Returns `[]` for a stable, adherent patient — and for ANY patient who is not being
 * monitored yet. A baseline still collecting, awaiting a doctor, or abandoned produces no
 * band worth acting on (Part 3), so notifying on one would be reporting a number the
 * product itself does not stand behind.
 */
export function notificationsFor(signals: PatientSignals): Notification[] {
  const out: Notification[] = [];

  if (signals.band === "ALERT") out.push({ reason: "ALERT", rank: 0 });
  if (signals.band === "PATTERN_ATYPICAL") out.push({ reason: "PATTERN_ATYPICAL", rank: 1 });

  // WATCH is deliberately absent from the two lines above. See the module docstring.

  if (signals.missedSessionDays >= MISSED_DAYS_FLOOR) {
    out.push({ reason: "MISSED_SESSIONS", rank: 2 });
  }
  if (signals.lowQualityStreak >= LOW_QUALITY_STREAK_FLOOR) {
    out.push({ reason: "LOW_QUALITY_STREAK", rank: 3 });
  }
  if (signals.adherence !== null && signals.adherence < ADHERENCE_FLOOR) {
    out.push({ reason: "ADHERENCE_DROP", rank: 4 });
  }

  // Adherence and quality signals are about the RECORD, not the person, so they stand even
  // while monitoring is suppressed — a baseline nobody is completing is worth saying out
  // loud. Band-derived reasons do not, because there is no trustworthy band yet.
  const allowed = signals.monitoring
    ? out
    : out.filter((n) => n.reason !== "ALERT" && n.reason !== "PATTERN_ATYPICAL");

  return allowed.sort((a, b) => a.rank - b.rank);
}

/** True when anything at all should reach the caregiver. */
export function shouldNotify(signals: PatientSignals): boolean {
  return notificationsFor(signals).length > 0;
}

/**
 * The i18n key for each reason. Kept here so the mapping is testable and so a reason can
 * never be rendered without a deliberate string — a missing key would show a raw enum name
 * like `LOW_QUALITY_STREAK` to a family, which is both meaningless and alarming.
 */
export const NOTIFY_MESSAGE_KEY: Record<NotifyReason, string> = {
  ALERT: "notifyAlert",
  PATTERN_ATYPICAL: "notifyAtypical",
  MISSED_SESSIONS: "notifyMissed",
  LOW_QUALITY_STREAK: "notifyLowQuality",
  ADHERENCE_DROP: "notifyAdherence",
};
