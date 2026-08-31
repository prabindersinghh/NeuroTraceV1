/**
 * The calendar's date arithmetic, pinned. Each of these is a way the grid could quietly
 * lie to a patient about their own effort.
 */
import { describe, expect, it } from "vitest";

import { buildMonth, currentStreak, dayKey, statusByDay } from "./calendar";
import type { ExamSession } from "./types";

const s = (ts: string, completed: boolean): ExamSession =>
  ({ id: ts, ts, completed } as unknown as ExamSession);

describe("dayKey", () => {
  it("uses the LOCAL day, not the UTC one", () => {
    // 00:30 local is the previous day in UTC for any zone east of Greenwich. The patient
    // experienced the check-in on the 15th; the calendar must say the 15th.
    const local = new Date(2026, 7, 15, 0, 30);
    expect(dayKey(local)).toBe("2026-08-15");
    expect(local.toISOString().slice(0, 10)).not.toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone === "UTC" ? "" : "2026-08-15",
    );
  });
});

describe("statusByDay", () => {
  it("a finished session wins over a stopped one on the same day", () => {
    // Bailed in the morning, finished in the evening: the day is DONE. Marking it
    // stopped would punish exactly the retry the product wants to encourage.
    const morningStop = s("2026-08-15T09:00:00", false);
    const eveningDone = s("2026-08-15T18:00:00", true);
    expect(statusByDay([morningStop, eveningDone]).get("2026-08-15")).toBe("done");
    expect(statusByDay([eveningDone, morningStop]).get("2026-08-15")).toBe("done");
  });

  it("a stopped-only day says stopped, not nothing", () => {
    expect(statusByDay([s("2026-08-15T09:00:00", false)]).get("2026-08-15")).toBe("stopped");
  });
});

describe("buildMonth", () => {
  const today = new Date(2026, 7, 20);

  it("always emits whole weeks, Monday first", () => {
    const cells = buildMonth(2026, 7, new Map(), today); // August 2026: Sat 1st
    expect(cells.length % 7).toBe(0);
    expect(cells[0].date.getDay()).toBe(1); // Monday
    expect(cells.filter((c) => c.inMonth).length).toBe(31);
  });

  it("marks today and the future correctly", () => {
    const cells = buildMonth(2026, 7, new Map(), today);
    expect(cells.find((c) => c.isToday)?.key).toBe("2026-08-20");
    expect(cells.find((c) => c.key === "2026-08-21")?.isFuture).toBe(true);
    expect(cells.find((c) => c.key === "2026-08-19")?.isFuture).toBe(false);
  });
});

describe("currentStreak", () => {
  const done = (days: string[]) => new Map(days.map((d) => [d, "done" as const]));

  it("counts back through consecutive done days", () => {
    const byDay = done(["2026-08-18", "2026-08-19", "2026-08-20"]);
    expect(currentStreak(byDay, new Date(2026, 7, 20))).toBe(3);
  });

  it("does not read as broken before today's check-in has happened", () => {
    // Done through yesterday; today still pending. The streak is alive.
    const byDay = done(["2026-08-18", "2026-08-19"]);
    expect(currentStreak(byDay, new Date(2026, 7, 20))).toBe(2);
  });

  it("a real gap ends it", () => {
    const byDay = done(["2026-08-16", "2026-08-17"]);
    expect(currentStreak(byDay, new Date(2026, 7, 20))).toBe(0);
  });
});
