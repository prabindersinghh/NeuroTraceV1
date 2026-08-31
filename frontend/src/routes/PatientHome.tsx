/**
 * What the patient sees when they sign in: one button.
 * PRD §4 — 55-75, low digital literacy. No score, no chart, no jargon.
 *
 * Part 6.6 adds ONE thing above that button: which check-in is due today and roughly how
 * long it takes. Before this, both session types opened behind an identical "Begin" and a
 * patient expecting three minutes could find themselves eleven minutes in — which is how
 * people abandon halfway and how a half-finished session becomes a quality-flagged one.
 *
 * The duration is the server's own `estimated_seconds`, never a number typed here. D-045 is
 * exactly why: two files once disagreed about how long Daily Pulse takes because one of them
 * held a hand-written constant.
 */
import { HeartPulse, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmergencyButton } from "@/components/EmergencyButton";
import { Tour } from "@/components/Tour";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Patient, SessionType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Due = { session_type: SessionType; estimated_seconds: number; step_count: number };

export function PatientHome() {
  const { t } = useI18n();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [due, setDue] = useState<Due | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listPatients();
      setPatients(list);
      if (list[0]) {
        // Deliberately non-fatal. If the scheduler is unreachable — offline, most likely —
        // the patient still gets their button. Losing the "about 3 minutes" line is a
        // degraded experience; blocking the check-in on it would be a broken one.
        try {
          setDue(await api.sessionDue(list[0].id));
        } catch {
          setDue(null);
        }
      }
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
  // Round up, never down. Promising "3 minutes" for 195 seconds and then running longer is
  // the small dishonesty that makes someone distrust the next number too.
  const minutes = due ? Math.max(1, Math.ceil(due.estimated_seconds / 60)) : null;

  return (
    <AppShell>
      {/* max-w-md is right on a phone and a strip on a laptop. Widened at lg with the
          vertical rhythm tightened, so a large screen is used rather than padded. */}
      <div className="patient-scale mx-auto flex max-w-md flex-col items-center gap-8 py-10 text-center lg:max-w-xl lg:gap-6 lg:py-8">
        <HeartPulse className="h-20 w-20 text-accent" aria-hidden />
        {me ? (
          <>
            <h1 className="text-title-1">
              {t("checkinTitle")}
              <span className="mt-2 block text-lg font-normal text-muted-foreground">{me.name}</span>
            </h1>

            {due && minutes !== null && (
              <div className="w-full rounded-lg border border-line bg-surface p-4 text-left">
                <p className="font-semibold">
                  {due.session_type === "DAILY_PULSE" ? t("todayShort") : t("todayLong")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("aboutMinutes").replace("{n}", String(minutes))}
                  {" · "}
                  {t("stepsCount").replace("{n}", String(due.step_count))}
                </p>
                {/* One of the three safety guarantees, stated before they start rather than
                    discovered mid-session. */}
                <p className="mt-2 text-muted-foreground">{t("restAnyTime")}</p>
              </div>
            )}

            <Link
              data-tour="start-check-in"
              to={`/exam/${me.id}`}
              className={cn(buttonVariants({ variant: "accent", size: "touch" }), "max-w-sm")}
            >
              {t("begin")}
            </Link>
            {/* Awaaz is the OTHER daily surface — for some patients the more important
                one. Same size as the check-in button, never buried in a menu. */}
            <Link
              to={`/awaaz/${me.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "touch" }), "max-w-sm")}
            >
              <MessageSquareText className="mr-2 h-6 w-6" aria-hidden />
              {t("awaazOpen")}
            </Link>
            {/* The patient's OWN screen had no emergency control. It was on the
                caregiver, family and dashboard surfaces but not here — so the person most
                likely to be having a second stroke was the one person who could not reach
                it from their home screen. Same size and prominence as the other two
                actions, never behind a menu. */}
            <div data-tour="emergency" className="w-full max-w-sm">
              <EmergencyButton patientId={me.id} />
            </div>
            <Tour role="patient" />
          </>
        ) : (
          <EmptyState>{t("noData")}</EmptyState>
        )}
      </div>
    </AppShell>
  );
}
