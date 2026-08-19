/**
 * One domain's deviation over time.
 *
 * The shaded band is this patient's usual range (0 to the alert threshold) and the dashed
 * line is `dev_threshold` as returned by the API — the chart never hardcodes the gate, so
 * it cannot drift away from the engine.
 *
 * Baseline-phase sessions are drawn hollow. They were recorded but not judged, and showing
 * them as ordinary points would imply a verdict that was never made.
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { TrendPoint } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface Props {
  domain: string;
  data: TrendPoint[];
  threshold: number;
  color: string;
}

export function DomainChart({ domain, data, threshold, color }: Props) {
  const { t, lang, domain: domainLabel } = useI18n();
  const locale = lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN";

  const rows = data.map((point) => ({
    label: formatDate(point.date, locale),
    value: point.domain_devs[domain] ?? 0,
    baseline: point.baseline_phase,
  }));

  const peak = Math.max(threshold * 1.6, ...rows.map((r) => r.value));

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
          {domainLabel(domain)}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 25% 90%)" vertical={false} />

              <ReferenceArea
                y1={0}
                y2={threshold}
                fill="hsl(152 60% 32%)"
                fillOpacity={0.07}
                ifOverflow="hidden"
              />
              <ReferenceLine
                y={threshold}
                stroke="hsl(0 72% 45%)"
                strokeDasharray="6 4"
                strokeWidth={1.5}
              />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(215 16% 42%)" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(214 25% 86%)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, Math.ceil(peak)]}
                tick={{ fontSize: 11, fill: "hsl(215 16% 42%)" }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                cursor={{ stroke: "hsl(214 25% 80%)" }}
                contentStyle={{ borderRadius: 10, border: "1px solid hsl(214 25% 86%)", fontSize: 13 }}
                formatter={(value) => [Number(value).toFixed(2), t("deviationAxis")] as [string, string]}
              />

              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2.5}
                isAnimationActive={false}
                dot={(props) => {
                  const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                  const hollow = rows[index]?.baseline;
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={3.5}
                      fill={hollow ? "white" : color}
                      stroke={color}
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-stable/15" aria-hidden />
            {t("normalBand")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 border-t-2 border-dashed border-alert" aria-hidden />
            {t("alertLine")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-full border-2 bg-white"
              style={{ borderColor: color }}
              aria-hidden
            />
            {t("baselineProgress")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
