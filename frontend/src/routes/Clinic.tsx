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
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Stethoscope className="h-6 w-6" aria-hidden />
          {t("clinicTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("clinicSubtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState>{t("noPatients")}</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <Card key={row.patient_id}>
              <CardContent className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-40 flex-1">
                  <p className="text-lg font-semibold">{row.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.age ? `${row.age} · ` : ""}
                    {row.baseline_state === "locked"
                      ? `${t("lastSession")}: ${row.last_session ? formatDateTime(row.last_session, locale) : "—"}`
                      : t("buildingBaseline")}
                  </p>
                </div>

                {row.band && (
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-semibold",
                      BAND_STYLE[row.band],
                    )}
                  >
                    {row.band}
                  </span>
                )}

                {/* Never a bare number: always what it is relative to. */}
                {row.sustained_domains.length > 0 && (
                  <p className="basis-full text-sm text-muted-foreground sm:basis-auto">
                    {row.sustained_domains.length} {t("domains").toLowerCase()} (
                    {row.sustained_domains.map(domainLabel).join(", ")}) sustained vs this
                    patient&apos;s own baseline · {t("confidence").toLowerCase()}{" "}
                    {(row.confidence * 100).toFixed(0)}%
                  </p>
                )}

                {row.unacknowledged_alerts > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-alert-soft px-2.5 py-1 text-sm font-medium text-alert">
                    <AlertTriangle className="h-4 w-4" aria-hidden />
                    {row.unacknowledged_alerts}
                  </span>
                )}

                <Link
                  to={`/dashboard/${row.patient_id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  {t("openDashboard")}
                </Link>
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
    </AppShell>
  );
}
