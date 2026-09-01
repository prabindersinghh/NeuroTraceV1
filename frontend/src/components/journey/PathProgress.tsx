/**
 * The path — one line, a stop per step, lit as far as the patient has come.
 *
 * This is the progress system, and it is deliberately not a bar. A bar says "you are
 * 39% through a thing"; a line of lights says "you have come this far along the way",
 * which is the same fact felt differently. Chapter starts wear a faint outer ring so
 * the shape of the morning is visible at a glance — a few clusters, not eighteen ticks.
 *
 * Static apart from the current stop's slow breathe: no parallax, no drift, nothing
 * that could trouble someone whose vestibular function we are here to measure.
 *
 * The semantic equivalent is the sentence under it and the `aria-label` — "About
 * halfway. 8 of 18." — so a screen reader gets the same two facts a sighted patient
 * does, in the same order.
 */
import { progressPhrase } from "@/lib/journey";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  total: number;
  /** Steps left behind — the live index. */
  completed: number;
  /** Indices where a chapter begins. */
  chapterStarts: number[];
  /** Everything lit: the completion screen. */
  finished?: boolean;
  className?: string;
}

const W = 320;
const H = 44;
const PAD = 14;

export function PathProgress({ total, completed, chapterStarts, finished = false, className }: Props) {
  const { t } = useI18n();
  if (total <= 0) return null;

  const done = finished ? total : Math.max(0, Math.min(completed, total));
  const phrase = t(finished ? "progressLast" : progressPhrase(done, total));
  const shown = Math.min(done + (finished ? 0 : 1), total);
  const starts = new Set(chapterStarts);

  const x = (i: number) => (total === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (total - 1));
  // A gentle wave: the line has somewhere to go, and stops do not sit in one flat row.
  const y = (i: number) => H / 2 + 7 * Math.sin(i * 0.95 + 0.6);
  const d = Array.from({ length: total }, (_, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(i).toFixed(1)}`).join(" ");
  // The lit segment runs to the current stop, which is the one being done now.
  const litTo = finished ? 1 : total > 1 ? Math.min(done, total - 1) / (total - 1) : 1;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <svg
        role="img"
        aria-label={t("pathLabel")
          .replace("{phrase}", phrase)
          .replace("{n}", String(shown))
          .replace("{total}", String(total))}
        viewBox={`0 0 ${W} ${H}`}
        className="h-11 w-full"
      >
        <path d={d} fill="none" stroke="hsl(var(--border))" strokeWidth="2" strokeLinejoin="round" />
        <path
          d={d} fill="none" stroke="hsl(var(--accent))" strokeWidth="2" strokeLinejoin="round"
          pathLength={1} strokeDasharray={1} strokeDashoffset={1 - litTo}
          className="path-line"
        />
        {Array.from({ length: total }, (_, i) => {
          const lit = i < done || finished;
          const current = !finished && i === done;
          return (
            <g key={i}>
              {starts.has(i) && (
                <circle
                  cx={x(i)} cy={y(i)} r={9} fill="none"
                  stroke="hsl(var(--accent))" strokeOpacity={lit || current ? 0.35 : 0.15}
                  strokeWidth="1.5"
                />
              )}
              <circle
                cx={x(i)} cy={y(i)} r={4.5}
                fill={lit || current ? "hsl(var(--accent))" : "hsl(var(--border))"}
                className={cn("path-stop", current && "breathe")}
                style={{ transform: current ? "scale(1.5)" : lit ? "scale(1.15)" : "scale(1)" }}
              />
            </g>
          );
        })}
      </svg>
      <p aria-hidden className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{phrase}</span>
        <span className="text-base tabular-nums text-muted-foreground">
          {t("stepOf").replace("{n}", String(shown)).replace("{total}", String(total))}
        </span>
      </p>
    </div>
  );
}

export default PathProgress;
