/**
 * Craniocorpography movement trace.
 *
 * A clinical CCG apparatus films a patient stepping on the spot with their eyes closed and
 * plots how the head travelled. A vestibular specialist reads that picture first and the
 * numbers second — the shape of the path is the finding, and the centimetres qualify it.
 *
 * So this deliberately reproduces the clinical layout rather than inventing a nicer one:
 * a centimetre grid, the start fixed at origin, the path drawn as it was walked, and the
 * angular deviation drawn as a wedge from straight-ahead. A clinician should recognise it
 * without being taught to.
 *
 * The honest part: when a capture is partial — the walking and stepping tests need someone
 * present, so a phone-only patient does not get them — the component says so on the face of
 * the chart. A three-test capture must never render as though it were a five-test one.
 */
import { useMemo } from "react";

import { useI18n, type StringKey } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";

export interface TraceSeries {
  test: string;
  units: string;
  points: [number, number][];
  start?: [number, number];
  end?: [number, number];
}

export interface CcgTraceData {
  date: string;
  units: string;
  traces: Record<string, TraceSeries>;
  metrics: Record<string, number>;
  tests_captured: number;
  tests_total: number;
  complete: boolean;
  laterality_available: boolean;
  note?: string | null;
}

/** Clinical convention: Unterberger is the headline, the rest are supporting. */
const TEST_ORDER = [
  "unterberger",
  "tandem_walk",
  "tandem_stance",
  "romberg_eyes_closed",
  "romberg_eyes_open",
] as const;

const TEST_LABEL: Record<string, StringKey> = {
  unterberger: "ccgTestUnterberger",
  tandem_walk: "ccgTestTandemWalk",
  tandem_stance: "ccgTestTandemStance",
  romberg_eyes_closed: "ccgTestRombergClosed",
  romberg_eyes_open: "ccgTestRombergOpen",
};

const SIZE = 320;
const PADDING = 28;

function niceBound(points: [number, number][]): number {
  const extent = points.reduce(
    (m, [x, y]) => Math.max(m, Math.abs(x), Math.abs(y)),
    1,
  );
  // Round up to a readable grid step so the axis labels are whole numbers.
  const step = extent <= 5 ? 1 : extent <= 20 ? 5 : 10;
  return Math.ceil((extent * 1.15) / step) * step;
}

function TracePlot({ series }: { series: TraceSeries }) {
  const { t } = useI18n();
  const { points } = series;
  const bound = useMemo(() => niceBound(points), [points]);

  // Screen coords: origin centre, +y forward (up the page), +x to the patient's right.
  const project = (x: number, y: number): [number, number] => {
    const scale = (SIZE / 2 - PADDING) / bound;
    return [SIZE / 2 + x * scale, SIZE / 2 - y * scale];
  };

  const path = points
    .map(([x, y], i) => {
      const [px, py] = project(x, y);
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  const end = points[points.length - 1] ?? [0, 0];
  const [ex, ey] = project(end[0], end[1]);
  const [ox, oy] = project(0, 0);

  const step = bound <= 5 ? 1 : bound <= 20 ? 5 : 10;
  const gridlines: number[] = [];
  for (let v = -bound; v <= bound; v += step) gridlines.push(v);

  // Angular deviation from straight ahead — the number the clinical report leads with.
  const deviationDeg =
    Math.abs(end[1]) > 1e-6 || Math.abs(end[0]) > 1e-6
      ? (Math.atan2(end[0], Math.abs(end[1])) * 180) / Math.PI
      : 0;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[320px] rounded-lg border bg-background"
        role="img"
        aria-label={t("ccgPlotLabel")
          .replace("{test}", TEST_LABEL[series.test] ? t(TEST_LABEL[series.test]) : series.test)
          .replace("{units}", series.units)}
      >
        {gridlines.map((v) => {
          const [gx] = project(v, 0);
          const [, gy] = project(0, v);
          const major = v === 0;
          return (
            <g key={v}>
              <line
                x1={gx} y1={PADDING} x2={gx} y2={SIZE - PADDING}
                stroke="currentColor"
                strokeOpacity={major ? 0.35 : 0.12}
                strokeWidth={major ? 1 : 0.5}
              />
              <line
                x1={PADDING} y1={gy} x2={SIZE - PADDING} y2={gy}
                stroke="currentColor"
                strokeOpacity={major ? 0.35 : 0.12}
                strokeWidth={major ? 1 : 0.5}
              />
            </g>
          );
        })}

        {/* Axis labels in centimetres — the whole point of scaling by head width. */}
        <text x={SIZE / 2 + 4} y={PADDING - 8} className="fill-current text-[9px] opacity-60">
          forward
        </text>
        <text x={SIZE - PADDING - 18} y={SIZE / 2 - 5} className="fill-current text-[9px] opacity-60">
          {bound} cm
        </text>

        {/* The deviation wedge: straight ahead vs where they actually ended up. */}
        {Math.abs(deviationDeg) > 0.5 && (
          <>
            <line
              x1={ox} y1={oy} x2={ox} y2={PADDING}
              stroke="currentColor" strokeOpacity={0.3}
              strokeWidth={1} strokeDasharray="4 3"
            />
            <line
              x1={ox} y1={oy} x2={ex} y2={ey}
              className="stroke-amber-500" strokeWidth={1.5} strokeDasharray="4 3"
            />
          </>
        )}

        <path
          d={path}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/*
          * Start and end markers. Previously emerald and rose — raw Tailwind colours that
          * bypassed the token palette, and in a CLINICAL trace a green dot and a red dot
          * read as a verdict ("began well, ended badly"). Neither endpoint is good or bad;
          * they mark where a stepping path started and finished. Accent and ink carry the
          * direction without implying one.
          *
          * `<title>` gives each marker an accessible name, because colour alone was the
          * only thing distinguishing them — the caption named neither.
          */}
        <circle cx={ox} cy={oy} r={4} className="fill-accent">
          <title>{t("ccgStart")}</title>
        </circle>
        <circle cx={ex} cy={ey} r={5} className="fill-foreground">
          <title>{t("ccgEnd")}</title>
        </circle>
      </svg>

      <figcaption className="mt-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {TEST_LABEL[series.test] ? t(TEST_LABEL[series.test]) : series.test}
        </span>
        {" · "}
        <span className="whitespace-nowrap">
          <span aria-hidden className="text-accent">●</span> {t("ccgStartShort")}
          {" "}
          <span aria-hidden>●</span> {t("ccgEndShort")}
        </span>
        {Math.abs(deviationDeg) > 0.5 && (
          <>
            {" · "}
            {t(deviationDeg > 0 ? "ccgToTheRight" : "ccgToTheLeft")
              .replace("{deg}", Math.abs(deviationDeg).toFixed(1))}
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** Exported: CcgComparison labels the same metrics in its delta table, and two lists that
 *  can drift is how one view ends up naming a measure differently from the other. */
export const METRIC_LABEL: Record<string, StringKey> = {
  unterberger_sway_path_cm: "ccgMetricUnterbergerPath",
  unterberger_angular_deviation_deg: "ccgMetricAngular",
  tandem_walk_sway_path_cm: "ccgMetricTandemWalk",
  tandem_stance_sway_path_cm: "ccgMetricTandemStance",
  romberg_eyes_open_sway_path_cm: "ccgMetricRombergOpen",
  romberg_eyes_closed_sway_path_cm: "ccgMetricRombergClosed",
  romberg_quotient: "ccgMetricRombergQuotient",
};

const METRIC_UNIT: Record<string, string> = {
  romberg_quotient: "",
};

export function CcgTrace({ data }: { data: CcgTraceData }) {
  const { t, locale } = useI18n();
  const available = TEST_ORDER.filter((k) => data.traces[k]?.points?.length);

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">{t("balanceTraceTitle")}</h3>
        <span className="text-xs text-muted-foreground">
          {formatDate(data.date, locale)} ·{" "}
          {t("ccgTests")
            .replace("{done}", String(data.tests_captured))
            .replace("{total}", String(data.tests_total))}
        </span>
      </header>

      {/* An incomplete capture says so on the face of the chart, not in a tooltip. */}
      {!data.complete && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs
                      text-amber-900 dark:border-amber-800 dark:bg-amber-950/40
                      dark:text-amber-200">
          {/* Deliberately NOT `data.note ?? …`. The server sends one fixed English
              sentence here, so preferring it made this the one amber box on the page
              still speaking English. The payload keeps carrying `note` for API
              consumers; this surface renders the translated copy. */}
          {t("ccgPartial")}
          {!data.laterality_available && (
            <>
              {" "}
              <strong>{t("ccgNoLaterality")}</strong>
            </>
          )}
        </p>
      )}

      {available.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ccgNoPath")}</p>
      ) : (
        <div className="flex flex-wrap gap-5">
          {available.map((key) => (
            <TracePlot key={key} series={data.traces[key]} />
          ))}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        {Object.entries(data.metrics)
          .filter(([k]) => k in METRIC_LABEL)
          .map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">{t(METRIC_LABEL[k])}</dt>
              <dd className="font-mono tabular-nums">
                {v}
                {METRIC_UNIT[k] ?? (k.endsWith("_deg") ? "°" : " cm")}
              </dd>
            </div>
          ))}
      </dl>

      {/* The old caption said green marks the start and red the finish. The markers were
          moved off green/red precisely because in a clinical trace they read as a verdict
          (see TracePlot) — the caption had been describing colours no longer on the chart. */}
      <p className="text-xs text-muted-foreground">{t("ccgUnits")}</p>
    </section>
  );
}

export default CcgTrace;
