/**
 * Wearable data — shown as its own lanes, deliberately separated from the exam trends.
 *
 * THE CLAIM BOUNDARY IS THE DESIGN.
 *
 * The device vendor owns the measurement: Samsung is answerable for whether their watch's
 * heart-rate reading is a heart rate. We own only the trend — that we recorded what their
 * device reported and can show how it moved.
 *
 * That is why these render in a visually distinct block, always carry the source device,
 * and never sit on the same axes as a NeuroTrace-derived score. Putting a vendor heart rate
 * next to our deviation band on one chart would imply we measured both, and would be the
 * quiet start of a claim we cannot defend.
 *
 * Falls are separated again. A fall is an event, not a trend — it bypasses the deviation
 * engine entirely — so it gets its own card type and never appears as a data point.
 */
import { useMemo } from "react";

import type { FallEvent, WearableReading } from "../lib/types";

const METRIC_LABEL: Record<string, string> = {
  heart_rate: "Heart rate",
  irregular_rhythm: "Irregular rhythm notifications",
  sleep_quality: "Sleep quality",
  step_count: "Steps",
  spo2: "Blood oxygen",
  blood_pressure_systolic: "Blood pressure (upper)",
  blood_pressure_diastolic: "Blood pressure (lower)",
};

const W = 320;
const H = 56;

function Sparkline({ points }: { points: number[] }) {
  const path = useMemo(() => {
    if (points.length < 2) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    return points
      .map((v, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - ((v - min) / span) * (H - 8) - 4;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [points]);

  if (!path) return null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label="trend">
      <path
        d={path}
        fill="none"
        className="stroke-slate-500 dark:stroke-slate-400"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WearableLanes({
  readings,
  falls,
  onAcknowledgeFall,
}: {
  readings: WearableReading[];
  falls: FallEvent[];
  onAcknowledgeFall?: (id: string) => void;
}) {
  const byMetric = useMemo(() => {
    const out = new Map<string, WearableReading[]>();
    for (const r of readings) {
      const list = out.get(r.metric) ?? [];
      list.push(r);
      out.set(r.metric, list);
    }
    for (const list of out.values()) {
      list.sort((a, b) => a.ts.localeCompare(b.ts));
    }
    return out;
  }, [readings]);

  const unacknowledged = falls.filter((f) => !f.acknowledged);
  const sources = [...new Set(readings.map((r) => r.source))];

  if (!readings.length && !falls.length) return null;

  return (
    <section className="space-y-4">
      {/* Falls first, and visually unmistakable. An event, not a trend. */}
      {unacknowledged.length > 0 && (
        <div className="space-y-2">
          {unacknowledged.map((f) => (
            <div
              key={f.id}
              className="rounded-lg border-2 border-rose-400 bg-rose-50 p-4
                         dark:border-rose-700 dark:bg-rose-950/40"
            >
              <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
                A fall was reported {new Date(f.ts).toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-rose-900 dark:text-rose-100">{f.message}</p>
              {f.dismissed_by_patient && (
                <p className="mt-1 text-xs text-rose-800 dark:text-rose-200">
                  They dismissed it on the watch. Check anyway — people dismiss falls they
                  are embarrassed by, or confused after.
                </p>
              )}
              <p className="mt-2 text-xs text-rose-800/80 dark:text-rose-200/80">
                {f.claim_notice}
              </p>
              {onAcknowledgeFall && (
                <button
                  type="button"
                  onClick={() => onAcknowledgeFall(f.id)}
                  className="mt-3 min-h-11 w-full rounded-lg border border-rose-400
                             bg-white px-4 text-sm font-medium text-rose-900
                             dark:bg-rose-900/40 dark:text-rose-50"
                >
                  I have checked on them
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {byMetric.size > 0 && (
        <div className="rounded-lg border border-dashed p-4">
          <header className="mb-3">
            <h3 className="text-base font-semibold">From their watch</h3>
            <p className="text-xs text-muted-foreground">
              Recorded by {sources.join(", ") || "the device"} — shown here as a trend.
              NeuroTrace does not measure these; the device maker does.
            </p>
          </header>

          <div className="space-y-4">
            {[...byMetric.entries()].map(([metric, list]) => {
              const latest = list[list.length - 1];
              return (
                <div key={metric}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {METRIC_LABEL[metric] ?? metric}
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {latest.value}
                      {latest.unit ? ` ${latest.unit}` : ""}
                    </span>
                  </div>
                  <Sparkline points={list.map((r) => r.value)} />
                  <p className="text-xs text-muted-foreground">
                    {list.length} reading{list.length > 1 ? "s" : ""} ·{" "}
                    {new Date(list[0].ts).toLocaleDateString()} –{" "}
                    {new Date(latest.ts).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export default WearableLanes;
