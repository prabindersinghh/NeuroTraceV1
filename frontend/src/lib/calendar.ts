/**
 * The check-in calendar's date arithmetic, as pure functions — testable in the node
 * environment this project runs vitest in, the same reason `taskFlow.ts` exists.
 *
 * WHAT A DAY IS ALLOWED TO SAY. `done`, `stopped`, or nothing. Never a band, never a
 * score: this calendar is read by the patient, and a verdict on their own wall calendar
 * the morning after a check-in is the "app tells me I am declining" experience this
 * product refuses to build. The colour on this grid means only "you showed up".
 */
import type { ExamSession } from "./types";

export type DayStatus = "done" | "stopped" | "none";

/** Local calendar date key. NOT toISOString(), which shifts the day at UTC boundaries —
 *  a 00:30 IST check-in must land on the day the patient experienced. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One status per day. A completed session wins over a stopped one on the same day —
 * someone who bailed at 9am and finished at 6pm DID their check-in, and marking the day
 * "stopped" would punish the retry that this product wants to encourage.
 */
export function statusByDay(sessions: ExamSession[]): Map<string, DayStatus> {
  const map = new Map<string, DayStatus>();
  for (const s of sessions) {
    const key = dayKey(new Date(s.ts));
    const status: DayStatus = s.completed ? "done" : "stopped";
    const existing = map.get(key);
    if (existing === "done") continue;
    map.set(key, existing === "stopped" && status === "done" ? "done" : status);
  }
  return map;
}

export interface CalendarDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
  status: DayStatus;
}

/**
 * A month as exactly the cells its grid renders: leading and trailing days included so
 * every row has seven, weeks starting Monday — the convention on Indian wall calendars,
 * which is the object this is imitating.
 */
export function buildMonth(
  year: number, month: number, byDay: Map<string, DayStatus>, today: Date = new Date(),
): CalendarDay[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const todayKey = dayKey(today);

  const cells: CalendarDay[] = [];
  const cursor = new Date(start);
  do {
    const key = dayKey(cursor);
    cells.push({
      date: new Date(cursor),
      key,
      inMonth: cursor.getMonth() === month,
      isToday: key === todayKey,
      isFuture: key > todayKey,
      status: byDay.get(key) ?? "none",
    });
    cursor.setDate(cursor.getDate() + 1);
  } while (cursor.getMonth() === month || cells.length % 7 !== 0);
  return cells;
}

/** Longest run of consecutive `done` days ending today or yesterday — the streak a
 *  patient is currently on. Yesterday counts so the streak does not read as broken
 *  before today's check-in has happened. */
export function currentStreak(byDay: Map<string, DayStatus>, today: Date = new Date()): number {
  const cursor = new Date(today);
  if (byDay.get(dayKey(cursor)) !== "done") cursor.setDate(cursor.getDate() - 1);
  let run = 0;
  while (byDay.get(dayKey(cursor)) === "done") {
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}
