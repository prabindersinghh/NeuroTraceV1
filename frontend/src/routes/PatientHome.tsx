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
import { MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { CheckinCalendar } from "@/components/CheckinCalendar";
import { EmergencyButton } from "@/components/EmergencyButton";
import { Tour } from "@/components/Tour";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { rememberAwaazPatient } from "@/lib/awaazTarget";
import { useI18n } from "@/lib/i18n";
import type { ExamSession, Patient, SessionType } from "@/lib/types";
import { cn, formatDateTime, usableLocale } from "@/lib/utils";

type Due = { session_type: SessionType; estimated_seconds: number; step_count: number };

export function PatientHome() {
  const { t, lang } = useI18n();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [due, setDue] = useState<Due | null>(null);
  const [history, setHistory] = useState<ExamSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await api.listPatients();
      setPatients(list);
      // This screen has no `:patientId`, so the header would otherwise have nothing to
      // point Awaaz at on the one screen the patient opens first. Costs no request.
      rememberAwaazPatient(list[0]?.id);
      if (list[0]) {
        // Deliberately non-fatal. If the scheduler is unreachable — offline, most likely —
        // the patient still gets their button. Losing the "about 3 minutes" line is a
        // degraded experience; blocking the check-in on it would be a broken one.
        try {
          setDue(await api.sessionDue(list[0].id));
        } catch {
          setDue(null);
        }
        // Same non-fatal reasoning: the calendar is a record, not a gate. Offline, the
        // button still works and the calendar simply shows what it last knew.
        try {
          setHistory(await api.sessionHistory(list[0].id));
        } catch {
          setHistory([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errLoadProfile"));
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
  const locale = usableLocale(lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN");

  return (
    <AppShell>
      {me ? (
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          {/* The same header grammar as every other screen — mono eyebrow, fluid title,
              hairline rule. The subtitle is the patient's own name: this page is theirs. */}
          <PageHeader eyebrow={t("patientEyebrow")} title={t("checkinTitle")} subtitle={me.name} />

          {/* Laptop-first: today's action on the left, the record of showing up on the
              right. On a phone they stack, action first. */}
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="flex flex-col gap-4">
              {due && minutes !== null && (
                <div className="rounded-xl border border-border bg-secondary/50 p-4">
                  <p className="text-label text-muted-foreground">
                    {due.session_type === "DAILY_PULSE" ? t("todayShort") : t("todayLong")}
                  </p>
                  <p className="mt-2 text-title-3">
                    {t("aboutMinutes").replace("{n}", String(minutes))}
                    {" · "}
                    {t("stepsCount").replace("{n}", String(due.step_count))}
                  </p>
                  {/* One of the three safety guarantees, stated before they start rather
                      than discovered mid-session. */}
                  <p className="mt-1.5 text-muted-foreground">{t("restAnyTime")}</p>
                </div>
              )}

              <Link
                data-tour="start-check-in"
                to={`/exam/${me.id}`}
                className={cn(buttonVariants({ variant: "accent", size: "touch" }))}
              >
                {t("begin")}
              </Link>
              {/* Awaaz is the OTHER daily surface — for some patients the more important
                  one. Same size as the check-in button, never buried in a menu. */}
              <Link
                to={`/awaaz/${me.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "touch" }))}
              >
                <MessageSquareText className="mr-2 h-6 w-6" aria-hidden />
                {t("awaazOpen")}
              </Link>
              {/* Never behind a menu, never below the fold on this column. */}
              <div data-tour="emergency">
                <EmergencyButton patientId={me.id} />
              </div>
            </div>

            <div className="flex flex-col gap-6">
              <CheckinCalendar sessions={history} />

              <section aria-labelledby="history-h">
                <div className="mb-3 flex items-baseline justify-between border-b border-border pb-2">
                  <h2 id="history-h" className="text-label text-muted-foreground">
                    {t("historyTitle")}
                  </h2>
                </div>
                {history.length === 0 ? (
                  <p className="py-4 text-muted-foreground">{t("historyEmpty")}</p>
                ) : (
                  <ul className="flex flex-col">
                    {history.slice(0, 7).map((s) => (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 py-3 last:border-b-0"
                      >
                        <span className="font-medium tabular-nums">
                          {formatDateTime(s.ts, locale)}
                        </span>
                        <span className="text-muted-foreground">
                          {s.type === "DAILY_PULSE" ? t("typeShort") : t("typeLong")}
                        </span>
                        {/* Done, or how far they got. Never a verdict — the server strips
                            them from this payload for exactly this screen. */}
                        {s.completed ? (
                          <span className="font-medium text-accent">{t("calDone")}</span>
                        ) : s.abandoned ? (
                          <span className="text-muted-foreground">
                            {t("historyStopped")
                              .replace("{done}", String(s.abandoned.steps_completed))
                              .replace("{total}", String(s.abandoned.steps_total))}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t("calStopped")}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
          <Tour role="patient" />
        </div>
      ) : (
        <EmptyState>{t("noData")}</EmptyState>
      )}
    </AppShell>
  );
}
