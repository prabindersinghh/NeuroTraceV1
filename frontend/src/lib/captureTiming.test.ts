/**
 * A capture window must last as long as the protocol says it does.
 *
 * THE BUG THIS PINS. `StepSpeech` ticks four times a second so its level meter moves
 * smoothly — every other step ticks once a second — and it decremented the countdown by a
 * whole second on each of those ticks. Every window ran at 4x speed: the two 6s tasks
 * recorded 1.5s each, the 8s sentence recorded 2s, and a module documented as "~20 seconds
 * total" finished in five.
 *
 * It reads as a UI glitch — the step "doesn't wait for you" — but the damage is to the
 * measurement. M4's features were extracted from a fraction of the intended audio and fed
 * straight into the patient's baseline, and a window that short mostly catches the patient
 * still reading the instruction, which is why it so often returned "we could not hear you".
 *
 * Source assertions, because vitest runs `environment: "node"` here with no DOM harness —
 * the same reason `taskFlow.test.ts` and `caretaker.test.ts` scan source.
 */
import { describe, expect, it } from "vitest";

const STEP_SOURCES = import.meta.glob("../routes/exam/Step*.tsx", {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

/** `window.setInterval(fn, N)` → every N found in a file. */
const intervals = (src: string) =>
  [...src.matchAll(/setInterval\([\s\S]*?\}\s*,\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));

describe("countdowns match the durations the protocol asks for", () => {
  it("found the step files to check", () => {
    expect(Object.keys(STEP_SOURCES).length).toBeGreaterThan(8);
    expect(Object.keys(STEP_SOURCES).some((f) => f.includes("StepSpeech"))).toBe(true);
  });

  it("no step decrements a per-second counter on a sub-second tick", () => {
    // The exact defect: a `r - 1` decrement inside an interval faster than 1000ms.
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(STEP_SOURCES)) {
      const perSecondDecrement = /setRemaining\(\(\s*r\s*\)\s*=>\s*r\s*-\s*1\s*\)/.test(src);
      if (!perSecondDecrement) continue;
      const fast = intervals(src).filter((ms) => ms < 1000);
      if (fast.length) {
        offenders.push(`${path.split("/").pop()}: decrements by 1s on a ${fast[0]}ms tick`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("StepSpeech derives its countdown from a deadline", () => {
    // Stronger than "the tick is 1000ms": a deadline is also correct when a browser
    // throttles timers in a backgrounded tab, which would otherwise stretch the window.
    const speech = Object.entries(STEP_SOURCES)
      .find(([p]) => p.includes("StepSpeech"))?.[1] ?? "";
    expect(speech).toMatch(/deadlineRef/);
    expect(speech).toMatch(/performance\.now\(\)/);
    expect(speech).not.toMatch(/setRemaining\(\(\s*r\s*\)\s*=>\s*r\s*-\s*1\s*\)/);
  });

  it("THE PIN: the detector catches the shape that shipped", () => {
    const buggy = `
      const tick = window.setInterval(() => {
        setRemaining((r) => r - 1);
      }, 250);`;
    expect(/setRemaining\(\(\s*r\s*\)\s*=>\s*r\s*-\s*1\s*\)/.test(buggy)).toBe(true);
    expect(intervals(buggy).filter((ms) => ms < 1000)).toEqual([250]);
  });
});
