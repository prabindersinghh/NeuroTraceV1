/**
 * The journey is presentation over an unchanged protocol. These pin two things: that
 * every runnable task has a chapter (a step with no chapter is a step with no intro, and
 * the patient would hit a camera cold), and that chaptering never touches order.
 */
import { describe, expect, it } from "vitest";

import {
  chapterIndexAt, chapterOf, chapters, isChapterStart, progressPhrase, LABEL_OVERRIDE,
} from "./journey";
import { PROTOCOL_MIRROR, WEB_RUNNABLE, runnableSteps, type PlanStep, type SessionPlan } from "./protocol";

const DAILY = new Set(["M1", "M4", "M7", "M10", "M13", "M19"]);

function plan(steps: PlanStep[]): SessionPlan {
  return { intensity: "full", planned_seconds: 0, fall_gate_before_position: null, steps };
}

/** The comprehensive runnable order: Daily Pulse six, then the rest (D-044). */
const COMPREHENSIVE = runnableSteps(plan([
  ...PROTOCOL_MIRROR.filter((s) => DAILY.has(s.module)),
  ...PROTOCOL_MIRROR.filter((s) => !DAILY.has(s.module)),
].map((s, i) => ({ ...s, position: i + 1 }))));

const DAILY_PULSE = runnableSteps(plan(
  PROTOCOL_MIRROR.filter((s) => DAILY.has(s.module)).map((s, i) => ({ ...s, position: i + 1 })),
));

describe("every runnable task has a chapter", () => {
  it.each([...WEB_RUNNABLE])("%s is placed explicitly", (task) => {
    // The fallback is "close"; a task that only reaches "close" by fallback is unplaced.
    // Both the fallback and a real placement return a key, so pin the ones that must
    // NOT be the fallback: everything that is not actually a closing task.
    const key = chapterOf(task);
    expect(key).toBeTruthy();
    if (task !== "delayed_recall" && task !== "ppg_rhythm") expect(key).not.toBe("close");
  });

  it("an unknown task lands in the closing chapter rather than throwing", () => {
    expect(chapterOf("something_new")).toBe("close");
  });
});

describe("chapters follow protocol order and cover every step exactly once", () => {
  it("a comprehensive session has five chapters in the expected order", () => {
    expect(COMPREHENSIVE).toHaveLength(18);
    expect(chapters(COMPREHENSIVE).map((c) => c.key))
      .toEqual(["hands", "checkin", "eyes", "standing", "close"]);
  });

  it("a Daily Pulse session has two", () => {
    expect(DAILY_PULSE).toHaveLength(6);
    expect(chapters(DAILY_PULSE).map((c) => c.key)).toEqual(["hands", "checkin"]);
  });

  it("chapters tile the steps with no gaps and no overlap", () => {
    for (const steps of [COMPREHENSIVE, DAILY_PULSE]) {
      const list = chapters(steps);
      expect(list[0].start).toBe(0);
      expect(list[list.length - 1].end).toBe(steps.length);
      for (let i = 1; i < list.length; i += 1) expect(list[i].start).toBe(list[i - 1].end);
      for (const c of list) expect(c.end).toBeGreaterThan(c.start);
    }
  });

  it("a chapter start is exactly where the key changes, and step 0 always is one", () => {
    const starts = COMPREHENSIVE.map((_, i) => isChapterStart(COMPREHENSIVE, i));
    expect(starts.filter(Boolean)).toHaveLength(5);
    expect(starts[0]).toBe(true);
    // The standing chapter begins at the first Romberg — the fall gate's own position.
    const romberg = COMPREHENSIVE.findIndex((s) => s.task === "romberg_eyes_open");
    expect(starts[romberg]).toBe(true);
    expect(isChapterStart([], 0)).toBe(false);
  });

  it("looks up the chapter for a step index", () => {
    const list = chapters(COMPREHENSIVE);
    expect(chapterIndexAt(list, 0)).toBe(0);
    expect(chapterIndexAt(list, COMPREHENSIVE.length - 1)).toBe(4);
  });

  it("STANDARD intensity (three steps fewer) still yields the same five chapters", () => {
    const standard = COMPREHENSIVE.filter(
      (s) => !["vertical_saccades", "svv_static_and_dynamic"].includes(s.task),
    );
    expect(chapters(standard).map((c) => c.key))
      .toEqual(["hands", "checkin", "eyes", "standing", "close"]);
  });
});

describe("progress is a phrase, said honestly", () => {
  it("says nothing is done before anything is", () => {
    expect(progressPhrase(0, 18)).toBe("progressStart");
    expect(progressPhrase(0, 6)).toBe("progressStart");
  });

  it("says 'about halfway' around the middle and only there", () => {
    const phrases = Array.from({ length: 18 }, (_, i) => progressPhrase(i, 18));
    const half = phrases.map((p, i) => (p === "progressHalf" ? i : -1)).filter((i) => i >= 0);
    expect(half.length).toBeGreaterThan(0);
    expect(Math.min(...half)).toBeGreaterThanOrEqual(7);
    expect(Math.max(...half)).toBeLessThanOrEqual(10);
  });

  it("does not say 'nearly there' at step 12 of 18", () => {
    expect(progressPhrase(12, 18)).not.toBe("progressNearly");
    expect(progressPhrase(16, 18)).toBe("progressNearly");
  });

  it("marks the last step as the last step", () => {
    expect(progressPhrase(17, 18)).toBe("progressLast");
    expect(progressPhrase(5, 6)).toBe("progressLast");
  });

  it("never runs off either end", () => {
    expect(progressPhrase(-4, 18)).toBe("progressStart");
    expect(progressPhrase(99, 18)).toBe("progressLast");
    expect(progressPhrase(3, 0)).toBe("progressStart");
  });
});

describe("label overrides", () => {
  it("only override tasks that exist in the protocol", () => {
    for (const task of Object.keys(LABEL_OVERRIDE)) expect(WEB_RUNNABLE.has(task)).toBe(true);
  });
});
