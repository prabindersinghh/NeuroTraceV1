/**
 * The patient journey, as pure functions.
 *
 * WHAT THIS IS. The check-in is eighteen protocol positions. The patient should never
 * experience it as eighteen tests — they move along one path with a few chapters, and
 * the chapters are where the path pauses for a breath. This module decides where those
 * pauses fall and how progress is described. It is presentation and nothing else.
 *
 * WHAT THIS IS NOT. It never reorders, renumbers, drops or times a step. `session_plan.py`
 * owns the protocol, positions are recorded with every result (D-044, INV-14), and a
 * chapter boundary is a screen shown BETWEEN two positions, not a change to either.
 *
 * WHY CHAPTERS ARE KEYED BY TASK AND NOT BY CLINICAL BLOCK. The six Daily Pulse modules
 * sit at positions 1-6 in both session types and span three clinical blocks (cognitive,
 * motor, close). Grouping by block would scatter a six-step session into three chapters
 * of two. Grouping by task gives the patient a shape that matches what they feel:
 * hands and voice, a quick check-in, eyes, standing, winding down.
 */
import type { PlanStep } from "./protocol";

export type ChapterKey = "hands" | "checkin" | "eyes" | "standing" | "close";

/** Every web-runnable task has an explicit chapter. `journey.test.ts` pins that. */
const CHAPTER_OF: Record<string, ChapterKey> = {
  simple_and_choice_rt: "hands",
  sustained_ddk_sentence: "hands",
  facial_battery: "hands",
  finger_tapping: "hands",
  phq2: "checkin",
  medication_confirm: "checkin",
  word_encoding: "eyes",
  horizontal_saccades: "eyes",
  vertical_saccades: "eyes",
  smooth_pursuit: "eyes",
  gaze_holding: "eyes",
  svv_static_and_dynamic: "eyes",
  romberg_eyes_open: "standing",
  romberg_eyes_closed: "standing",
  tandem_stance: "standing",
  pronator_drift: "standing",
  delayed_recall: "close",
  ppg_rhythm: "close",
};

/** A task this module does not know lands in the closing chapter rather than crashing:
 *  a new protocol step must still run even before anyone has placed it. */
export function chapterOf(task: string): ChapterKey {
  return CHAPTER_OF[task] ?? "close";
}

export interface Chapter {
  key: ChapterKey;
  /** Index into the runnable steps of the first step in this chapter. */
  start: number;
  /** Exclusive. */
  end: number;
}

/** Contiguous runs of steps sharing a chapter, in protocol order. */
export function chapters(steps: PlanStep[]): Chapter[] {
  const out: Chapter[] = [];
  steps.forEach((s, i) => {
    const key = chapterOf(s.task);
    const last = out[out.length - 1];
    if (last && last.key === key) last.end = i + 1;
    else out.push({ key, start: i, end: i + 1 });
  });
  return out;
}

/** True when the step at `index` is the first of a new chapter — where an intro is shown. */
export function isChapterStart(steps: PlanStep[], index: number): boolean {
  if (index <= 0 || index >= steps.length) return index === 0 && steps.length > 0;
  return chapterOf(steps[index - 1].task) !== chapterOf(steps[index].task);
}

/** Which chapter (ordinal) the step at `index` belongs to. */
export function chapterIndexAt(list: Chapter[], index: number): number {
  return Math.max(0, list.findIndex((c) => index >= c.start && index < c.end));
}

/**
 * Which on-device model the coming chapter will need, so it can be loaded while the
 * patient reads the intro rather than after they tap Continue. Both loaders are
 * memoised, so asking early costs nothing and asking twice costs nothing.
 */
export const PREWARM: Partial<Record<ChapterKey, "face" | "pose">> = {
  hands: "face",   // M1 is the third step of the first chapter
  eyes: "face",
  standing: "pose",
};

export type ProgressPhraseKey =
  | "progressStart"
  | "progressUnderWay"
  | "progressHalf"
  | "progressPastHalf"
  | "progressNearly"
  | "progressLast";

/**
 * How far along the path the patient is, as a phrase rather than a fraction.
 *
 * `completed` is the number of steps left behind (the live index), never the one in
 * progress — the same honesty rule as `exitSummary`. Thresholds are chosen so "About
 * halfway" is said once, around the middle, and "Nearly there" is not said at step 12
 * of 18, which it would be under a naive 66% cut.
 */
export function progressPhrase(completed: number, total: number): ProgressPhraseKey {
  if (total <= 0) return "progressStart";
  const done = Math.max(0, Math.min(completed, total));
  if (done === 0) return "progressStart";
  if (done >= total - 1) return "progressLast";
  const ratio = done / total;
  if (ratio < 0.4) return "progressUnderWay";
  if (ratio < 0.6) return "progressHalf";
  if (ratio < 0.85) return "progressPastHalf";
  return "progressNearly";
}

/**
 * Presentation overrides of the server's canonical `label_en`, keyed by TASK.
 *
 * The server's wording is the clinical record of what was asked; these are the words a
 * patient hears at the moment of doing it, where two labels were actively misleading:
 * M10's "circle" (the surface is a light), and M11's "What were the five words?" — a
 * free-recall question above a recognition grid, which is not the test being run and
 * says so nowhere. Everything else keeps the server's line.
 */
export const LABEL_OVERRIDE: Record<string, "labelTapLight" | "labelRecall"> = {
  simple_and_choice_rt: "labelTapLight",
  delayed_recall: "labelRecall",
};
