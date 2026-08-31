/**
 * The session's behavioural rules, as pure functions.
 *
 * WHY THESE LIVE HERE RATHER THAN INSIDE ProtocolRunner
 * -----------------------------------------------------
 * They are the rules a patient actually feels, and they are the ones this product cannot
 * get wrong: how many times someone is asked to repeat a task they may be unable to do,
 * and what they are told at the moment they finish performing. Buried inside a React
 * component they were only reachable by rendering, which this project has no DOM harness
 * for — so they were never pinned by a test. Two steps had silently stopped honouring the
 * retry rule as a result: M10 never remounted, and M7 consumed both prompts in a few
 * synchronous passes without the patient seeing either.
 *
 * `MAX_RETRIES` was also declared twice, independently, in `TaskShell.tsx` and
 * `ProtocolRunner.tsx`. Two copies of a number whose whole purpose is to be a hard limit
 * is one copy too many; this is now the single source and both import it.
 *
 * NOTE ON SCOPE: extracting these is deliberately NOT the same as routing ProtocolRunner
 * through TaskShell. That larger question — unify the task pattern, or retire TaskShell —
 * is being decided separately and on its own branch. This module changes no behaviour; it
 * only makes the existing behaviour addressable and testable.
 */

/**
 * Two retries, then move on. Never a third.
 *
 * A patient asked a third time to repeat something they cannot do is being told they are
 * failing. The capture is accepted with the low-quality flag instead — stored, kept out of
 * the baseline, surfaced to the caregiver as a confounder. A missing measurement is
 * recoverable; an abandoned patient is not.
 */
export const MAX_RETRIES = 2;

/** What the runner should do after a capture comes back. */
export type QualityOutcome =
  /** Good capture (or a task with no quality check). Record it and advance. */
  | { action: "accept" }
  /** Re-prompt: remount the capture cleanly and ask once more. */
  | { action: "retry"; retriesUsedAfter: number }
  /** Retries exhausted. Accept the capture, flagged low-quality, and advance. */
  | { action: "accept_low_quality" };

/**
 * The single decision every capture passes through.
 *
 * `retriesUsed` is the count for THIS step position — retries do not pool across the
 * session, because a patient who struggled with balance has not used up their chances at
 * speech.
 */
export function assessCapture(
  quality: { ok: boolean; reason?: string },
  retriesUsed: number,
  max: number = MAX_RETRIES,
): QualityOutcome {
  // A capture with no failure reason is accepted even if `ok` is false: without a reason
  // there is nothing to tell the patient, and re-prompting with no explanation is worse
  // than accepting the measurement.
  if (quality.ok || !quality.reason) return { action: "accept" };
  if (retriesUsed >= max) return { action: "accept_low_quality" };
  return { action: "retry", retriesUsedAfter: retriesUsed + 1 };
}

/** How many prompts remain for this step. Never negative. */
export function retriesRemaining(retriesUsed: number, max: number = MAX_RETRIES): number {
  return Math.max(0, max - retriesUsed);
}

/* ------------------------------------------------------------------ going back
 *
 * Back is VIEW-ONLY, and that restriction is the feature rather than a limitation of it.
 *
 * A patient who feels they did a task badly wants to do it again. Letting them, freely,
 * would quietly destroy the measurement: unlimited retakes create a learning effect, so a
 * module's "normal" would drift toward the patient's best-ever attempt instead of their
 * typical one, and real decline would then have to be worse than that best attempt before
 * anything showed. It is the same reasoning that caps retries at two and that discards the
 * first three sessions from the baseline.
 *
 * The need behind "I did that wrong" is already met, inside the step, by the two-retry
 * rule — which is offered at the moment it is relevant, when the capture actually failed
 * its quality check. So going back shows what happened; it does not reopen it.
 */

/** What the runner should render: the live step, or an earlier one being reviewed. */
export type StepView =
  | { mode: "live"; index: number }
  /** An earlier step, shown for reading only. `liveIndex` is where the session resumes. */
  | { mode: "review"; index: number; liveIndex: number };

export function viewFor(viewIndex: number, liveIndex: number): StepView {
  return viewIndex >= liveIndex
    ? { mode: "live", index: liveIndex }
    : { mode: "review", index: viewIndex, liveIndex };
}

/**
 * THE GUARD. A capture component may only be mounted for the live step.
 *
 * Every path that renders a capture goes through this, so "back cannot re-record" is one
 * decision in one place rather than a property each of the eleven step components has to
 * remember to have.
 */
export function mayCapture(view: StepView): boolean {
  return view.mode === "live";
}

export function canGoBack(viewIndex: number): boolean {
  return viewIndex > 0;
}

/** Forward only returns toward the live step — it can never skip past it. */
export function canGoForward(viewIndex: number, liveIndex: number): boolean {
  return viewIndex < liveIndex;
}

export function stepBack(viewIndex: number): number {
  return Math.max(0, viewIndex - 1);
}

export function stepForward(viewIndex: number, liveIndex: number): number {
  return Math.min(liveIndex, viewIndex + 1);
}

/**
 * The numbers in "Stop this check-in? You've completed X of Y steps."
 *
 * X counts steps LEFT BEHIND, which is `liveIndex` — the live step is in progress, not
 * completed, so counting it would tell the patient they finished something they are
 * currently looking at. Clamped because a session that has run past its last step is
 * finishing, not exiting.
 */
export function exitSummary(liveIndex: number, total: number): {
  completed: number; total: number;
} {
  return { completed: Math.max(0, Math.min(liveIndex, total)), total };
}

/**
 * Language that must never appear at the moment of performance.
 *
 * The confirm state is a neutral acknowledgement. Not praise — patronising to an adult who
 * was recently independent — and never criticism, which teaches a patient that the app is
 * where they go to be told they are declining. Scores belong to the caregiver dashboard
 * and the clinician, after aggregation.
 *
 * Checked as substrings against the actual strings the finish screen renders, in all three
 * languages. Substring matching on purpose: a "smart" check that tried to understand
 * context is exactly the kind that fails open.
 */
export const FORBIDDEN_AT_CONFIRM = {
  praise: [
    "well done", "good job", "great", "excellent", "perfect", "nice work",
    "शाबाश", "बहुत बढ़िया", "बढ़िया",
    "ਸ਼ਾਬਾਸ਼", "ਬਹੁਤ ਵਧੀਆ", "ਵਧੀਆ",
  ],
  criticism: [
    "poor", "failed", "failure", "bad", "worse", "wrong", "too slow",
    "खराब", "ख़राब", "असफल", "गलत", "ग़लत",
    "ਖਰਾਬ", "ਅਸਫਲ", "ਗਲਤ",
  ],
  /**
   * A score being PRESENTED. Deliberately narrow.
   *
   * A first version listed bare "score" and flagged `practiceDone` — "That was practice —
   * nothing was scored" — which is the exact opposite of a violation: it is the app
   * telling the patient no score exists. This codebase has made that mistake once before
   * and fixed it the same way (D-030): tighten the detector, never exempt the file, because
   * a guard that cries wolf is a guard someone mutes.
   *
   * So a presented score is a PERCENTAGE or an explicit band name. Numeric scores are
   * covered separately and more strictly by the digit check in the test, which allows no
   * digit at all in confirm copy.
   */
  score: [
    "%", "out of 10", "out of 100",
    "पूर्णांक",
    "ਪ੍ਰਤੀਸ਼ਤ",
  ],
} as const;

/**
 * True when `text` carries praise, criticism or a score.
 *
 * Digits are checked separately by the caller, because a legitimate confirm string may
 * contain a step counter ("3 / 21") while still carrying no score.
 */
export function violatesConfirmNeutrality(text: string): string[] {
  const hay = text.toLowerCase();
  const hits: string[] = [];
  for (const [category, phrases] of Object.entries(FORBIDDEN_AT_CONFIRM)) {
    for (const phrase of phrases) {
      if (hay.includes(phrase.toLowerCase())) hits.push(`${category}: "${phrase}"`);
    }
  }
  return hits;
}
