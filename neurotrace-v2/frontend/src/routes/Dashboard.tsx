import { BellRing, MessageCircle, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { BandCard, BAND_STYLE } from "@/components/BandCard";
import { DeviationChart } from "@/components/DeviationChart";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Band, Dashboard as DashboardData } from "@/lib/types";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

export function Dashboard() {
  const { patientId = "" } = useParams();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const locale = lang === "hi" ? "hi-IN" : "en-IN";

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.dashboard(patientId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the dashboard");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <AppShell>
        <ErrorState message={error} onRetry={load} />
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  const band: Band = data.latest?.band ?? "STABLE";
  const explanation = lang === "hi" ? data.latest_explanation_hi : data.latest_explanation_en;
  const readOnly = user?.role === "clinician";

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.patient.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[data.patient.age ? `${data.patient.age}` : null, data.patient.sex].filter(Boolean).join(" · ")}
            {readOnly && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                {t("readOnly")}
              </span>
            )}
          </p>
        </div>
        {!readOnly && (
          <Link to={`/checkin/${patientId}`} className={cn(buttonVariants({ variant: "accent" }))}>
            {t("startCheckin")}
          </Link>
        )}
      </div>

      {!data.baseline_ready && (
        <Card className="mb-6 border-accent/30 bg-accent/5">
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <div className="flex-1">
              <p className="font-medium">
                {t("baselineProgress")} — {data.baseline_days_recorded} / {data.baseline_days_required}{" "}
                {t("daysRecorded")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t("baselineNote")}</p>
            </div>
            <div className="h-2 w-40 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-accent"
                style={{
                  width: `${Math.min(100, (data.baseline_days_recorded / data.baseline_days_required) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {data.latest ? (
        <BandCard
          band={band}
          score={data.latest.stability_score}
          explanation={explanation}
          baselineDay={data.latest.baseline_day}
        />
      ) : (
        <EmptyState>{t("noData")}</EmptyState>
      )}

      {data.trends.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <DeviationChart
            title={t("voiceTrend")}
            data={data.trends}
            dataKey="voice_dev"
            threshold={data.dev_threshold}
            color="hsl(221 70% 40%)"
          />
          <DeviationChart
            title={t("faceTrend")}
            data={data.trends}
            dataKey="face_dev"
            threshold={data.dev_threshold}
            color="hsl(262 60% 48%)"
          />
          <DeviationChart
            title={t("reactionTrend")}
            data={data.trends}
            dataKey="reaction_dev"
            threshold={data.dev_threshold}
            color="hsl(190 75% 34%)"
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("history")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {data.history.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState>{t("noData")}</EmptyState>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-5 py-2 font-medium">{t("date")}</th>
                      <th className="px-3 py-2 font-medium">{t("status")}</th>
                      <th className="px-3 py-2 font-medium">{t("score")}</th>
                      <th className="px-5 py-2 font-medium">{t("explanation")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.date} className="border-b border-border/60 last:border-0 align-top">
                        <td className="whitespace-nowrap px-5 py-3">{formatDate(row.date, locale)}</td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                              BAND_STYLE[row.band].bg,
                              BAND_STYLE[row.band].text,
                            )}
                          >
                            {row.band}
                          </span>
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {row.baseline_day ? "—" : row.stability_score.toFixed(0)}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {(lang === "hi" ? row.explanation_hi : row.explanation_en) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-4 w-4" aria-hidden />
              {t("alertLog")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.alerts.length === 0 ? (
              <EmptyState>{t("noAlerts")}</EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.alerts.map((alert) => (
                  <li key={alert.id} className="rounded-xl border border-alert/25 bg-alert-soft p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-alert">{alert.band}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(alert.created_at, locale)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed">
                      {(lang === "hi" ? alert.explanation_hi : alert.explanation) ?? alert.explanation}
                    </p>
                    {alert.whatsapp_sent && (
                      <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-stable">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        {t("whatsappSent")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
