/**
 * The clinician view (B2B tier).
 *
 * Ranked by *sustained* deviation, not by today's magnitude. Ranking on a single session
 * would put every noisy morning at the top of a busy clinician's list, which is precisely
 * how a decision-support tool gets switched off.
 *
 * Every row states what it is relative to. "2 domains, 3 sessions, vs this patient's own
 * baseline" is interpretable; a bare number is not — and a number without its comparison
 * invites the reader to supply a population norm that does not exist for this cohort.
 */
import { AlertTriangle, Check, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tour } from "@/components/Tour";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Band, ClinicPatientRow } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

const BAND_STYLE: Record<Band, string> = {
  STABLE: "bg-stable-soft text-stable",
  WATCH: "bg-watch-soft text-watch",
  ALERT: "bg-alert-soft text-alert",
  PATTERN_ATYPICAL: "bg-atypical-soft text-atypical",
};

/** The band as a 3px leading rule, so the roster can be scanned down its margin without
 *  reading a word. Blue for STABLE — green is forbidden as a status colour here, because a
 *  green "all clear" is the reassurance a monitoring tool must never manufacture. */
const BAND_EDGE: Record<string, string> = {
  STABLE: "hsl(var(--stable))",
  WATCH: "hsl(var(--watch))",
  ALERT: "hsl(var(--alert))",
  PATTERN_ATYPICAL: "hsl(var(--atypical))",
  NONE: "hsl(var(--border))",
};

export function Clinic() {
  const { t, lang, domain: domainLabel } = useI18n();
  const locale = lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN";

  const [rows, setRows] = useState<ClinicPatientRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await api.clinicPatients()).patients);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the patient list");
    }
  }, []);

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
  if (!rows) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Stethoscope className="h-3.5 w-3.5" aria-hidden />
            {t("clinicEyebrow")}
          </span>
        }
        title={t("clinicTitle")}
        subtitle={t("clinicSubtitle")}
      />

      {/* The roster's shape, before the roster. A clinician opening this needs to know how
          much is waiting for them before reading any one row — DESIGN_LANGUAGE §1.4,
          "status is always visible". Numbers lead, and each says what it is measured
          against rather than standing alone. */}
      {rows.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Metric label={t("clinicTitle")} value={rows.length}
                  context={t("linkedToYou")} />
          <Metric
            label={t("alerts")}
            value={rows.reduce((n, r) => n + r.unacknowledged_alerts, 0)}
            tone={rows.some((r) => r.unacknowledged_alerts > 0) ? "alert" : "neutral"}
            context={t("unacknowledged")}
          />
          <Metric
            label={t("buildingBaseline")}
            value={rows.filter((r) => r.baseline_state !== "LOCKED").length}
            tone="watch"
            context={t("awaitingReview")}
          />
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>{t("noPatients")}</EmptyState>
      ) : (
        <div data-tour="roster" className="flex flex-col gap-3">
          {rows.map((row) => (
            /* Two rows, not one strip. Identity and state on the first line where the
               eye lands; the finding underneath, which is the sentence a clinician
               actually reads. The leading edge carries the band so the list can be
               scanned down the margin without reading any words. */
            <Card key={row.patient_id} className="chip-edge"
                  style={{ ["--chip-edge-color" as string]: BAND_EDGE[row.band ?? "NONE"] }}>
              <CardContent className="p-5 ps-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-title-3">{row.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.age ? `${row.age} · ` : ""}
                    {row.baseline_state === "LOCKED"
                      ? `${t("lastSession")}: ${row.last_session ? formatDateTime(row.last_session, locale) : "—"}`
                      : t("buildingBaseline")}
                  </p>

                  <div className="ms-auto flex items-center gap-2">
                    {row.unacknowledged_alerts > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-alert-soft px-2.5 py-1 text-sm font-medium text-alert">
                        <AlertTriangle className="h-4 w-4" aria-hidden />
                        {row.unacknowledged_alerts}
                      </span>
                    )}
                    {row.band && (
                      <span className={cn("rounded-full px-3 py-1 text-sm font-semibold",
                                          BAND_STYLE[row.band])}>
                        {row.band}
                      </span>
                    )}
                    <Link
                      data-tour="review-queue"
                      to={`/dashboard/${row.patient_id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      {t("openDashboard")}
                    </Link>
                  </div>
                </div>

                {/* Never a bare number: always what it is relative to. */}
                {row.sustained_domains.length > 0 && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {row.sustained_domains.length} {t("domains").toLowerCase()} (
                    {row.sustained_domains.map(domainLabel).join(", ")}) sustained vs this
                    patient&apos;s own baseline · {t("confidence").toLowerCase()}{" "}
                    {(row.confidence * 100).toFixed(0)}%
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          All deviations are measured against each patient&apos;s own median/MAD baseline
          using a robust z-score and a Reliable Change Index. An alert requires two
          independent domains to exceed threshold across two consecutive valid sessions.
          This is a monitoring aid; clinical interpretation remains with you.
        </span>
      </p>
      <Tour role="clinician" />
    </AppShell>
  );
}
