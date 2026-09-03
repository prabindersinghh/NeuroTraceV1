/**
 * The doctor's baseline decision — Part 3.3/3.4, and the surface that was missing.
 *
 * `_refresh_baseline_state` moves a patient to DOCTOR_REVIEW_PENDING the moment every
 * module locks, and `record_review` is the only thing that leaves that state. Until this
 * panel existed nothing in the app could call it, so a real patient finished their
 * baseline and then sat unmonitored forever with bands and alerts suppressed and no screen
 * able to say why. The demo hid it: `services/seed.py` calls `record_review` in Python.
 *
 * Three decisions, and the asymmetry between them is the point:
 *
 *   CONFIRM       locks the baseline and writes the frozen reference (INV-4, D-048). It is
 *                 the only action that starts monitoring, and the only one that is
 *                 irreversible, so it is the only one that states its consequence.
 *   EXTEND        "that window is not representative" — collect more. Requires a reason,
 *                 because the reason is what a later reader needs to judge the baseline.
 *   FLAG_CONCERN  something here needs a human before anything is locked.
 *
 * A note is REQUIRED for EXTEND and FLAG_CONCERN and the server enforces it (readable 400).
 * We disable the button rather than let the round-trip fail, but we do not rely on that
 * being the only check.
 *
 * The cadence asymmetry is shown, never smoothed away: a Comprehensive-only module carries
 * ~6 observations against a Daily Pulse module's ~21 (D-043/D-044). A doctor who is not
 * told that reads six points as thin data and extends a baseline that was already complete,
 * which is the exact mistake this panel is meant to prevent.
 */
import { AlertTriangle, CheckCircle2, Clock, ShieldQuestion } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormError, Label } from "@/components/ui/field";
import { ErrorState, LoadingState, Spinner } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { BaselineReviewAction, BaselineReviewView } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

/** EXTEND and FLAG_CONCERN carry a reason. CONFIRM's note is optional — a doctor agreeing
 *  with the data has nothing to explain, and demanding prose for the common case is how a
 *  gate gets clicked through with "ok". */
const NOTE_REQUIRED: ReadonlySet<BaselineReviewAction> = new Set(["EXTEND", "FLAG_CONCERN"]);

const ACTION_ICON = {
  CONFIRM: CheckCircle2,
  EXTEND: Clock,
  FLAG_CONCERN: AlertTriangle,
} as const;

export function BaselineReviewPanel({
  patientId,
  onReviewed,
}: {
  patientId: string;
  /** The dashboard owns `baseline_state`; a CONFIRM changes it, so it refetches. */
  onReviewed: () => void;
}) {
  const { t, lang } = useI18n();
  const locale = lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN";

  const [view, setView] = useState<BaselineReviewView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<BaselineReviewAction | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setView(await api.baselineReview(patientId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the baseline review");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!action) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.submitBaselineReview(patientId, { action, note: note.trim() || null });
      setNote("");
      setAction(null);
      // Refetch both: EXTEND leaves the patient here with one more review in the log, so
      // the panel must not go stale while it is still on screen.
      await load();
      onReviewed();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not record the decision");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!view) return <LoadingState />;

  const noteMissing = action !== null && NOTE_REQUIRED.has(action) && !note.trim();

  return (
    <Card className="mb-6 border-2 border-watch/40 bg-watch-soft/30">
      <CardContent className="p-6">
        <p className="text-label text-muted-foreground">{t("reviewEyebrow")}</p>
        <h2 className="mt-1 text-title-2">{t("baselineReviewTitle")}</h2>
        {/* Said before the buttons, not after: nothing is being watched right now. */}
        <p className="mt-2 max-w-prose text-muted-foreground">{t("reviewNotMonitored")}</p>

        <p className="mt-5 max-w-prose leading-relaxed">{view.summary}</p>

        {view.completion.blockers.length > 0 && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <p className="font-medium">{t("reviewBlockers")}</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {view.completion.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Per-module evidence. Scrolls inside itself so a long module list never makes
            the dashboard scroll sideways. */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{t("reviewColModule")}</th>
                <th className="py-2 pr-4 font-medium">{t("reviewColCadence")}</th>
                <th className="py-2 pr-4 text-right font-medium tabular-nums">
                  {t("reviewColSessions")}
                </th>
                <th className="py-2 pr-4 text-right font-medium tabular-nums">
                  {t("reviewColQuality")}
                </th>
                <th className="py-2 font-medium">{t("reviewColState")}</th>
              </tr>
            </thead>
            <tbody>
              {view.modules.map((m) => (
                <tr key={m.module_code} className="border-b border-border/60 last:border-b-0">
                  <td className="py-2.5 pr-4">
                    <span className="font-medium">{m.name}</span>{" "}
                    <span className="text-muted-foreground">({m.module_code})</span>
                  </td>
                  {/* Why six observations is not thin data. */}
                  <td className="py-2.5 pr-4 text-muted-foreground">{m.cadence_note}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {m.n_sessions}
                    {m.n_rejected > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        (+{m.n_rejected} {t("reviewRejected")})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">
                    {m.capture_quality_rate === null
                      ? "—"
                      : `${Math.round(m.capture_quality_rate * 100)}%`}
                  </td>
                  <td className={cn("py-2.5", m.locked ? "text-stable" : "text-watch")}>
                    {m.locked ? t("reviewModuleReady") : t("reviewModuleCollecting")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {view.previous_reviews.length > 0 && (
          <div className="mt-5">
            <p className="text-label text-muted-foreground">{t("reviewPrevious")}</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {view.previous_reviews.map((r) => (
                <li key={r.reviewed_at} className="text-sm">
                  <span className="font-medium">{r.action}</span>{" "}
                  <span className="tabular-nums text-muted-foreground">
                    {formatDateTime(r.reviewed_at, locale)}
                  </span>
                  {r.note && <span className="text-muted-foreground"> — {r.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Stated on every render, per the server's own payload: the advisory models are
            trained on synthetic fixtures and a doctor signing this should know. */}
        <p className="mt-5 rounded-xl bg-card/70 p-3 text-sm text-muted-foreground">
          {view.disclosure}
        </p>

        <div className="mt-6 border-t border-border pt-5">
          <p className="font-medium">{t("reviewDecision")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["CONFIRM", "EXTEND", "FLAG_CONCERN"] as const).map((a) => {
              const Icon = ACTION_ICON[a];
              const selected = action === a;
              return (
                <Button
                  key={a}
                  type="button"
                  variant={selected ? "default" : "outline"}
                  onClick={() => {
                    setAction(selected ? null : a);
                    setSubmitError(null);
                  }}
                  aria-pressed={selected}
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden />
                  {a === "CONFIRM"
                    ? t("reviewConfirm")
                    : a === "EXTEND"
                      ? t("reviewExtend")
                      : t("reviewFlag")}
                </Button>
              );
            })}
          </div>

          {action && (
            <div className="mt-4">
              {/* CONFIRM is irreversible and it is the only action that starts monitoring,
                  so it is the only one that spells out what happens next. */}
              <p className="mb-3 max-w-prose text-sm text-muted-foreground">
                {action === "CONFIRM"
                  ? t("reviewConfirmWarning")
                  : action === "EXTEND"
                    ? t("reviewExtendHelp")
                    : t("reviewFlagHelp")}
              </p>

              <Label htmlFor="review-note">
                {NOTE_REQUIRED.has(action) ? t("reviewNoteRequired") : t("reviewNoteOptional")}
              </Label>
              <textarea
                id="review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
                rows={3}
                className="mt-1.5 w-full rounded-xl border border-input bg-card p-3 text-[0.95rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />

              <FormError>{submitError}</FormError>

              <Button
                type="button"
                className="mt-3"
                variant={action === "CONFIRM" ? "accent" : "default"}
                disabled={submitting || noteMissing}
                onClick={() => void submit()}
              >
                {submitting && <Spinner className="mr-2 h-4 w-4" />}
                {t("reviewSubmit")}
              </Button>
              {noteMissing && (
                <p className="mt-2 text-sm text-muted-foreground">{t("reviewNoteMissing")}</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** The caregiver's half of the same gate. Not a clinician surface: it explains the wait,
 *  names who is expected to act, and never implies anyone is being watched meanwhile.
 *
 *  Before this, every non-LOCKED state rendered ONE card — "baseline progress 12/12" with
 *  a bar pinned at 100%, forever, for a patient waiting on a doctor, and the identical
 *  card for a baseline that had been abandoned. */
export function BaselineStatusCard({
  state,
  minSessions,
  requiredSessions,
}: {
  state: string;
  minSessions: number;
  requiredSessions: number;
}) {
  const { t } = useI18n();

  if (state === "DOCTOR_REVIEW_PENDING") {
    return (
      <Card className="mb-6 border-watch/40 bg-watch-soft/30">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <ShieldQuestion className="h-6 w-6 shrink-0 text-watch" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">{t("baselinePendingTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("baselinePendingNote")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state === "ABANDONED") {
    return (
      <Card className="mb-6 border-border">
        <CardContent className="flex flex-wrap items-center gap-4 p-5">
          <AlertTriangle className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex-1">
            <p className="font-medium">{t("baselineAbandonedTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("baselineAbandonedNote")}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // NOT_STARTED / IN_PROGRESS — still collecting, and the bar means what it says.
  return (
    <Card className="mb-6 border-accent/30 bg-accent/5">
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        <div className="flex-1">
          <p className="font-medium">
            {t("baselineProgress")} — {minSessions} / {requiredSessions} {t("sessionsRecorded")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t("baselineNote")}</p>
        </div>
        <div className="h-2 w-40 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, (minSessions / requiredSessions) * 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}
