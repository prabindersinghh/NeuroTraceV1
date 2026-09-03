/**
 * The one metric component every dashboard uses — docs/DESIGN_LANGUAGE.md §3, "KPI cards".
 *
 * A micro-label in caps, a large tabular number, and an optional one-line context. The
 * shape is what makes a clinical screen read as instrumentation rather than prose, and
 * having exactly one of them is what stops six screens inventing six slightly different
 * ways to show a number.
 *
 * TWO DELIBERATE DEVIATIONS from the reference component, both because of what this
 * product is:
 *
 * 1. NO COUNT-UP ANIMATION. The reference animates the number from zero with a rAF
 *    ease-out. Here the number is a clinical measurement, and a value that visibly travels
 *    through wrong numbers on its way to the right one is a small dishonesty on a screen a
 *    clinician reads to make a decision. It appears at its value.
 *
 * 2. NO GREEN. The reference's `trendIsGood` colours an improving metric green. Green is
 *    forbidden as a status colour in this product — STABLE is accent-blue — because a
 *    green "all clear" is exactly the reassurance a monitoring tool must never manufacture.
 *    Direction is carried by an arrow and a word, never by hue alone.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type MetricTone = "neutral" | "watch" | "alert" | "atypical";

const EDGE: Record<MetricTone, string> = {
  neutral: "hsl(var(--stable))",
  watch: "hsl(var(--watch))",
  alert: "hsl(var(--alert))",
  atypical: "hsl(var(--atypical))",
};

interface MetricProps {
  /** The micro-label above the number. Kept short — it is rendered in caps. */
  label: string;
  /** The number itself. A string so the caller controls units and precision. */
  value: ReactNode;
  /** One line of context under the number: what it is measured against. */
  context?: ReactNode;
  /** Carries a state on the leading edge without needing a second badge. */
  tone?: MetricTone;
  /** Shape-matched skeleton, so nothing jumps when the real value lands. */
  loading?: boolean;
  className?: string;
}

export function Metric({
  label, value, context, tone = "neutral", loading = false, className,
}: MetricProps) {
  return (
    <div
      className={cn(
        "chip-edge rounded-xl border border-border bg-card py-4 pe-4",
        // A readout, not a control: it gets a smooth colour change when its tone
        // moves (STABLE -> ALERT) and deliberately no press animation, because
        // nothing happens when you click it.
        "transition-[background-color,border-color] duration-200 ease-out",
        className,
      )}
      style={{ ["--chip-edge-color" as string]: EDGE[tone] }}
    >
      <p className="text-label text-muted-foreground">{label}</p>
      {loading ? (
        // Matches the rendered height exactly, so the card does not resize on load.
        <div className="mt-2 h-9 w-24 animate-pulse rounded-md bg-muted" aria-hidden />
      ) : (
        <p className="mt-1.5 text-metric text-foreground">{value}</p>
      )}
      {context && !loading && (
        <p className="mt-1.5 text-sm text-muted-foreground">{context}</p>
      )}
    </div>
  );
}

export default Metric;
