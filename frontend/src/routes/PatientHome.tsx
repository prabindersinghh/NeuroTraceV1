/**
 * What the patient sees when they sign in: one button.
 * PRD §4 — 55-75, low digital literacy. No score, no chart, no jargon.
 */
import { HeartPulse } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Patient } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PatientHome() {
  const { t } = useI18n();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPatients(await api.listPatients());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your profile");
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
  if (!patients) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  const me = patients[0];

  return (
    <AppShell>
      <div className="patient-scale mx-auto flex max-w-md flex-col items-center gap-8 py-10 text-center">
        <HeartPulse className="h-20 w-20 text-accent" aria-hidden />
        {me ? (
          <>
            <h1 className="text-3xl font-semibold">
              {t("checkinTitle")}
              <span className="mt-2 block text-lg font-normal text-muted-foreground">{me.name}</span>
            </h1>
            <Link
              to={`/exam/${me.id}`}
              className={cn(buttonVariants({ variant: "accent", size: "touch" }), "max-w-sm")}
            >
              {t("begin")}
            </Link>
          </>
        ) : (
          <EmptyState>{t("noData")}</EmptyState>
        )}
      </div>
    </AppShell>
  );
}
