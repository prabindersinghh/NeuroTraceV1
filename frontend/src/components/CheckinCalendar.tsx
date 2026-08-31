/**
 * The patient's check-in calendar — a wall calendar, not a chart.
 *
 * WHAT IT SHOWS AND REFUSES TO SHOW. A filled day means "you did your check-in"; a ringed
 * day means "you started one and stopped". That is the entire vocabulary. No bands, no
 * scores, no colour that could read as a verdict — this hangs where the patient looks
 * every morning, and a calendar that grades them is the "app says I am declining"
 * experience this product refuses to build. The data comes from `/sessions/{id}/history`,
 * which is stripped of verdicts server-side for the same reason.
 *
 * Colour is never the only carrier: every marked day includes the word in its accessible
 * name, and the legend spells both states out.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { buildMonth, currentStreak, statusByDay } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import type { ExamSession } from "@/lib/types";
import { cn, usableLocale } from "@/lib/utils";

export function CheckinCalendar({ sessions }: { sessions: ExamSession[] }) {
  const { t, lang } = useI18n();
  const locale = usableLocale(lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN");

  const today = new Date();
  const [view, setView] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const byDay = useMemo(() => statusByDay(sessions), [sessions]);
  const cells = useMemo(() => buildMonth(view.y, view.m, byDay, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.y, view.m, byDay]);
  const streak = useMemo(() => currentStreak(byDay, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDay]);

  const monthTitle = new Date(view.y, view.m, 1).toLocaleDateString(locale, {
    month: "long", year: "numeric",
  });
  // Monday-first narrow weekday letters, in the reader's own script.
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    return [...Array(7)].map((_, i) => fmt.format(new Date(2026, 5, i + 1))); // 2026-06-01 is a Monday
  }, [locale]);

  const move = (delta: number) => setView(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const atCurrentMonth = view.y === today.getFullYear() && view.m === today.getMonth();

  const dayLabel = (c: (typeof cells)[number]) => {
    const date = c.date.toLocaleDateString(locale, { day: "numeric", month: "long" });
    if (c.status === "done") return `${date} — ${t("calDone")}`;
    if (c.status === "stopped") return `${date} — ${t("calStopped")}`;
    return date;
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-label text-muted-foreground">{t("calTitle")}</p>
          <p className="mt-1 text-title-3 capitalize">{monthTitle}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => move(-1)} aria-label={t("calPrev")}
            className="tactile focus-ring grid h-10 w-10 place-items-center rounded-lg border border-border">
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <button type="button" onClick={() => move(1)} disabled={atCurrentMonth}
            aria-label={t("calNext")}
            className="tactile focus-ring grid h-10 w-10 place-items-center rounded-lg border border-border disabled:opacity-35">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-7 gap-1 text-center">
          {weekdays.map((w, i) => (
            <div key={i} className="pb-2 text-label text-muted-foreground" aria-hidden>
              {w}
            </div>
          ))}
          {cells.map((c) => (
            <div
              key={c.key}
              role="img"
              aria-label={c.inMonth ? dayLabel(c) : undefined}
              className={cn(
                // Fixed height, not aspect-square: in a wide desktop column square cells grew to
                // ~140px each and the month towered over everything beside it.
                "grid h-11 place-items-center rounded-lg text-sm tabular-nums lg:h-12",
                "transition-[background-color,border-color] duration-200 ease-out",
                !c.inMonth && "opacity-0",                        // whole weeks, blank spill
                c.inMonth && c.isFuture && "text-muted-foreground/50",
                c.inMonth && c.status === "done" &&
                  "bg-accent font-semibold text-accent-foreground",
                c.inMonth && c.status === "stopped" &&
                  "border-2 border-accent/50 font-medium text-accent",
                c.inMonth && c.status === "none" && !c.isFuture && "text-foreground",
                c.isToday && c.status === "none" && "border-2 border-border font-semibold",
              )}
            >
              {c.inMonth ? c.date.getDate() : ""}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          {/* Colour is never the only carrier of meaning — the legend says the words. */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-3 rounded-sm bg-accent" /> {t("calDone")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-3 rounded-sm border-2 border-accent/50" /> {t("calStopped")}
            </span>
          </div>
          {streak > 1 && (
            <p className="text-sm font-medium text-foreground tabular-nums">
              {t("calStreak").replace("{n}", String(streak))}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CheckinCalendar;
