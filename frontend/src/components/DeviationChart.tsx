/**
 * One modality's deviation over time.
 *
 * The shaded band is the patient's normal range (0 to the alert threshold); the dashed
 * line is DEV_THRESHOLD from the backend, so the chart never hardcodes the gate.
 * Baseline days are drawn hollow — they are recorded, not judged.
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
  title: string;
  data: TrendPoint[];
  dataKey: "voice_dev" | "face_dev" | "reaction_dev";
  threshold: number;
  color: string;
}

export function DeviationChart({ title, data, dataKey, threshold, color }: Props) {
  const { t, lang } = useI18n();
  const locale = lang === "hi" ? "hi-IN" : "en-IN";

  const rows = data.map((point) => ({
    ...point,
    label: formatDate(point.date, locale),
  }));

  const peak = Math.max(threshold * 1.6, ...rows.map((r) => r[dataKey]));

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
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
                label={{
                  value: t("alertLine"),
                  position: "insideTopRight",
                  fill: "hsl(0 72% 45%)",
                  fontSize: 11,
                }}
              />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(215 16% 42%)" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(214 25% 86%)" }}
              />
              <YAxis
                domain={[0, Math.ceil(peak)]}
                tick={{ fontSize: 11, fill: "hsl(215 16% 42%)" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: "hsl(214 25% 80%)" }}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid hsl(214 25% 86%)",
                  fontSize: 13,
                }}
                formatter={(value) => [Number(value).toFixed(2), t("deviationAxis")] as [string, string]}
              />

              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                strokeWidth={2.5}
                dot={(props) => {
                  const { cx, cy, index } = props as { cx: number; cy: number; index: number };
                  const isBaseline = rows[index]?.baseline_day;
                  return (
                    <circle
                      key={index}
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={isBaseline ? "white" : color}
                      stroke={color}
                      strokeWidth={2}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-stable/15" aria-hidden />
            {t("normalBand")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-px w-4 border-t-2 border-dashed border-alert" aria-hidden />
            {t("alertLine")} ({threshold.toFixed(1)})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 bg-white" style={{ borderColor: color }} aria-hidden />
            {t("baselineProgress")}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
