/**
 * Seven days of check-ins, at a glance, on a caregiver's patient card.
 *
 * ADHERENCE, NOT ASSESSMENT. A filled square means the check-in happened; a ringed one
 * means it was started and stopped. It carries no band and no score — those live on the
 * patient's dashboard, one click away, where there is room to say what they are measured
 * against. A roster card that showed a colour-coded verdict per person would be read as a
 * daily grade for someone's parent, from a card that has no space to qualify it.
 *
 * The week reads Monday-first and ends today, so the rightmost square is always "did it
 * happen today" — the question a caregiver actually opens this screen with.
 */
import { dayKey, statusByDay } from "@/lib/calendar";
import { useI18n } from "@/lib/i18n";
import type { ExamSession } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WeekStrip({ sessions }: { sessions: ExamSession[] }) {
  const { t } = useI18n();
  const byDay = statusByDay(sessions);
  const today = new Date();

  const days = [...Array(7)].map((_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    return { key: dayKey(d), status: byDay.get(dayKey(d)) ?? "none", date: d };
  });

  const label = `${t("last7days")}: ${days.filter((d) => d.status === "done").length}/7`;

  return (
    // One accessible name for the whole strip: seven separate "done"s read aloud one by
    // one is noise, and the count is the thing a screen-reader user wants.
    <div className="flex items-center gap-1" role="img" aria-label={label}>
      {days.map((d) => (
        <span
          key={d.key}
          aria-hidden
          className={cn(
            "h-2 flex-1 rounded-full",
            d.status === "done" && "bg-accent",
            d.status === "stopped" && "border-2 border-accent/50",
            d.status === "none" && "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

export default WeekStrip;
