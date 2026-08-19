/**
 * The caregiver dashboard.
 *
 * What it is careful about:
 *
 *  - The band card leads with a plain-language sentence, not a number. "Please check on
 *    them today: one corner of the mouth sat lower than the other" is actionable; "score
 *    87" is not.
 *  - Confounders are printed on the card, not hidden. An alert that might be explained by
 *    a reported illness has to say so, or the family stops trusting the ones that are not.
 *  - The FAST card renders unconditionally, at the bottom of every visit, because this
 *    system cannot see an acute event and the family needs the real warning signs daily.
 *  - WATCH is visible but never notifies. Alert fatigue is the failure mode that kills
 *    adherence, and a muted product detects nothing.
 */
import { BellRing, Pill, ShieldCheck, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { DomainChart } from "@/components/DomainChart";
import { EmergencyButton } from "@/components/EmergencyButton";
import { FastCard } from "@/components/FastCard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Band, Dashboard as DashboardData } from "@/lib/types";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

const BAND_STYLE: Record<Band, { ring: string; bg: string; text: string }> = {
  STABLE: { ring: "border-stable/35", bg: "bg-stable-soft", text: "text-stable" },
  WATCH: { ring: "border-watch/40", bg: "bg-watch-soft", text: "text-watch" },
  ALERT: { ring: "border-alert/40", bg: "bg-alert-soft", text: "text-alert" },
};

const DOMAIN_COLOURS: Record<string, string> = {
  cranial_nerves: "hsl(262 60% 48%)",
  speech_language: "hsl(221 70% 40%)",
  motor: "hsl(190 75% 34%)",
  cognition: "hsl(28 80% 45%)",
  coordination_gait: "hsl(340 60% 45%)",
  mood_fatigue_function: "hsl(152 50% 35%)",
  vitals_prevention: "hsl(0 0% 40%)",
};

export function Dashboard() {
  const { patientId = "" } = useParams();
  const { t, lang, domain: domainLabel } = useI18n();
  const { user } = useAuth();
  const locale = lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN";

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
  const style = BAND_STYLE[band];
  const explanation =
    lang === "en" ? data.latest?.explanation_en : data.latest?.explanation_hi;
  const bandLabel =
    band === "STABLE" ? t("bandStable") : band === "WATCH" ? t("bandWatch") : t("bandAlert");
  const readOnly = user?.role === "clinician";
  const confounders = data.latest?.confounders_json;
  const confounderLabels = lang === "en" ? confounders?.labels_en : confounders?.labels_hi;

  // Only chart domains that were actually measured.
  const domains = [...new Set(data.trends.flatMap((p) => Object.keys(p.domain_devs)))];

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.patient.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[data.patient.age, data.patient.sex].filter(Boolean).join(" · ")}
            {readOnly && (
              <span className="ml-2 inline-flex items-center gap-1">
                <Stethoscope className="h-3.5 w-3.5" aria-hidden />
                {t("readOnly")}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EmergencyButton patientId={patientId} />
          {!readOnly && (
            <Link to={`/exam/${patientId}`} className={cn(buttonVariants({ variant: "accent" }))}>
              {t("startCheckin")}
            </Link>
          )}
        </div>
      </div>

      {data.baseline.state !== "locked" && (
        <Card className="mb-6 border-accent/30 bg-accent/5">
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <div className="flex-1">
              <p className="font-medium">
                {t("baselineProgress")} — {data.baseline.min_sessions} / {data.baseline.required_sessions}{" "}
                {t("sessionsRecorded")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t("baselineNote")}</p>
            </div>
            <div className="h-2 w-40 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-accent"
                style={{
                  width: `${Math.min(100, (data.baseline.min_sessions / data.baseline.required_sessions) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {data.latest ? (
        <section className={cn("rounded-2xl border-2 p-6", style.ring, style.bg)} aria-label={t("status")}>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t("status")}
          </p>
          <p className={cn("text-4xl font-bold tracking-tight", style.text)}>{bandLabel}</p>

          {explanation && (
            <p className="mt-5 border-t border-current/10 pt-4 text-lg leading-relaxed text-foreground">
              {explanation}
            </p>
          )}

          {confounderLabels && confounderLabels.length > 0 && (
            <div className="mt-4 rounded-xl bg-card/60 p-3 text-sm">
              <p className="font-medium">{t("becauseOf")}</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {confounderLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          )}

          {data.latest.persistent_domains && data.latest.persistent_domains.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {t("domains")}: {data.latest.persistent_domains.map(domainLabel).join(", ")}
            </p>
          )}
        </section>
      ) : (
        <EmptyState>{t("noData")}</EmptyState>
      )}

      {data.adherence_streak > 0 && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
          <Pill className="h-4 w-4" aria-hidden />
          {t("adherence")}: {data.adherence_streak} {t("dayStreak")}
        </p>
      )}

      {domains.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-semibold">{t("domainTrends")}</h2>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {domains.map((domain) => (
              <DomainChart
                key={domain}
                domain={domain}
                data={data.trends}
                threshold={data.dev_threshold}
                color={DOMAIN_COLOURS[domain] ?? "hsl(221 70% 40%)"}
              />
            ))}
          </div>
        </>
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
                      <th className="px-5 py-2 font-medium">{t("explanation")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row) => (
                      <tr key={row.date} className="border-b border-border/60 align-top last:border-0">
                        <td className="whitespace-nowrap px-5 py-3">{formatDate(row.date, locale)}</td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                              BAND_STYLE[row.band].bg,
                              BAND_STYLE[row.band].text,
                            )}
                          >
                            {row.baseline_phase ? "—" : row.band}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {(lang === "en" ? row.explanation_en : row.explanation_hi) ?? "—"}
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
              <EmptyState>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  {t("noAlerts")}
                </span>
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.alerts.map((alert) => (
                  <li key={alert.id} className="rounded-xl border border-alert/25 bg-alert-soft p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-alert">{t("bandAlert")}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(alert.created_at, locale)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed">
                      {(lang === "en" ? alert.explanation_en : alert.explanation_hi) ??
                        alert.explanation_en}
                    </p>
                    {alert.clinician_line && user?.role === "clinician" && (
                      <p className="mt-3 border-t border-alert/20 pt-2 text-xs text-muted-foreground">
                        {alert.clinician_line}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TRD §8: unconditional, on every dashboard. */}
      <FastCard card={data.fast} className="mt-6" />
    </AppShell>
  );
}
