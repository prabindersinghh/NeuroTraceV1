/**
 * ASHA worker interface.
 *
 * Designed around how the job actually happens, which is not how a clinical app usually
 * assumes. An ASHA worker walks a round of roughly fifty households carrying a shared
 * tablet, is out of network coverage for most of it, and is doing this alongside every
 * other duty they have. Three consequences shape this screen:
 *
 *   OFFLINE IS THE NORMAL CASE, not the error case. Visits are queued locally and synced
 *   when signal returns. The UI never blocks on the network and never loses a visit because
 *   a request failed — an unsynced visit is shown as pending, not as an error.
 *
 *   IDEMPOTENT BY CONSTRUCTION. Every visit carries a device-side id, so a retry after a
 *   dropped connection updates the same visit. Duplicates in a patient's baseline are worse
 *   than missing data, because they silently reweight the median rather than leaving a
 *   visible hole.
 *
 *   TASKS, NOT MODULES. The worker is told the specific tests the family cannot do alone —
 *   tandem walking and Unterberger stepping — rather than "do the balance module", which
 *   would have them repeat the three the family already did this week.
 *
 * Large targets and short sentences throughout: this is used standing up, outdoors, on a
 * shared device, often in bright sun.
 */
import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { useI18n, type StringKey } from "../lib/i18n";
import type { AshaHousehold } from "../lib/types";
import { formatDate } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader } from "../components/ui/page";

const QUEUE_KEY = "neurotrace.asha.queue";

/** A visit captured on the device, waiting for signal. */
interface QueuedVisit {
  client_visit_id: string;
  patient_id: string;
  patient_name: string;
  ts: string;
  modules: Record<string, Record<string, number>>;
  notes?: string | null;
  /** Set once the server has accepted it. Kept, not deleted, so the worker sees history. */
  synced_at?: string | null;
  last_error?: string | null;
}

function loadQueue(): QueuedVisit[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedVisit[];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedVisit[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked — the visit stays in memory for this session */
  }
}

/** Device-side visit id. Stable per household per day, which is the natural unit. */
function makeVisitId(patientId: string, ts: string): string {
  return `${patientId.slice(0, 8)}-${ts.slice(0, 10)}`;
}

const TASK_LABEL: Record<string, StringKey> = {
  tandem_walk: "taskTandemWalk",
  unterberger: "taskUnterberger",
  line_bisection: "taskLineBisection",
  star_cancellation: "taskStarCancellation",
  smooth_pursuit: "taskSmoothPursuit",
  random_saccades: "taskRandomSaccades",
  timed_up_and_go: "taskTimedUpAndGo",
};

export default function AshaHome() {
  const { t, locale } = useI18n();
  const [households, setHouseholds] = useState<AshaHousehold[]>([]);
  const [queue, setQueue] = useState<QueuedVisit[]>(loadQueue);
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // The household list is cached so a worker who opens the app out of coverage still sees
  // who they are visiting.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.ashaHouseholds();
        if (cancelled) return;
        setHouseholds(res.households);
        localStorage.setItem("neurotrace.asha.households", JSON.stringify(res.households));
      } catch (err) {
        const cached = localStorage.getItem("neurotrace.asha.households");
        if (cached) {
          setHouseholds(JSON.parse(cached) as AshaHousehold[]);
          setError(t("ashaSavedList"));
        } else {
          setError(err instanceof ApiError ? err.message : t("ashaLoadError"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = queue.filter((v) => !v.synced_at);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    const next = [...queue];
    for (const visit of next) {
      if (visit.synced_at) continue;
      try {
        await api.ashaSubmit({
          patient_id: visit.patient_id,
          client_visit_id: visit.client_visit_id,
          ts: visit.ts,
          notes: visit.notes ?? null,
          modules: visit.modules,
        });
        visit.synced_at = new Date().toISOString();
        visit.last_error = null;
      } catch (err) {
        // Keep the visit. A failed upload is a retry, never a loss.
        visit.last_error = err instanceof ApiError ? err.message : t("ashaSendError");
      }
    }
    setQueue(next);
    saveQueue(next);
    setSyncing(false);
  }, [queue, syncing]);

  // Sync automatically when signal returns.
  useEffect(() => {
    if (online && pending.length) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  function recordVisit(h: AshaHousehold) {
    const ts = new Date().toISOString();
    const visit: QueuedVisit = {
      client_visit_id: makeVisitId(h.patient_id, ts),
      patient_id: h.patient_id,
      patient_name: h.name,
      ts,
      // In the full build these come from the capture screens. Recording the visit with
      // the due tasks noted is already useful and is what a worker can do today.
      modules: {},
      notes: `Visit recorded on device. Due: ${h.due_modules.join(", ") || "none"}`,
    };
    const next = [visit, ...queue.filter((v) => v.client_visit_id !== visit.client_visit_id)];
    setQueue(next);
    saveQueue(next);
    if (online) void sync();
  }

  return (
    <div className="w-full space-y-4 p-4">
      <PageHeader
        className="mb-6"
        eyebrow={t("ashaEyebrow")}
        title={t("ashaTitle")}
        actions={<span
          className={[
            "rounded-full px-3 py-1 text-sm font-medium",
            // Connectivity is NOT a clinical status, so it must not borrow the band
            // palette — a green "Online" pill also breaks the rule that green never
            // signals all-clear in this product. Online is deliberately quiet (it is the
            // normal case and needs no colour); offline uses the watch tokens, because it
            // is the state a worker actually needs to notice.
            // The dropped `dark:` variants were dead: darkMode is configured as "class"
            // but no .dark palette exists in index.css and nothing adds the class.
            online
              ? "bg-secondary text-secondary-foreground"
              : "bg-watch-soft text-foreground border border-watch/40",
          ].join(" ")}
        >
          {online ? t("ashaOnline") : t("ashaOffline")}
        </span>}
      />

      {pending.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              {t("ashaPending").replace("{n}", String(pending.length))}
            </p>
            <Button onClick={() => void sync()} disabled={!online || syncing}>
              {syncing ? t("ashaSending") : t("ashaSendNow")}
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm
                      text-amber-900 dark:border-amber-800 dark:bg-amber-950/40
                      dark:text-amber-200">
          {error}
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground">{t("loading")}</p>}

      {!loading && households.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("ashaNoHouseholds")}</p>
      )}

      <ul className="space-y-3">
        {households.map((h) => {
          const queued = queue.find((v) => v.patient_id === h.patient_id);
          const dueTasks = Object.entries(h.due_tasks ?? {});
          return (
            <li key={h.patient_id}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{h.name}</span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {h.age ? t("ashaYears").replace("{n}", String(h.age)) : ""}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t("ashaLastCheckin")}:{" "}
                    {h.last_session ? formatDate(h.last_session, locale) : t("ashaNone")}
                    {" · "}
                    {t("ashaLastVisit")}:{" "}
                    {h.last_visit ? formatDate(h.last_visit, locale) : t("ashaNone")}
                  </p>

                  {dueTasks.length > 0 ? (
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="mb-1.5 text-sm font-medium">{t("ashaDoThese")}</p>
                      <ul className="space-y-1 text-sm">
                        {dueTasks.flatMap(([mod, tasks]) =>
                          tasks.map((task) => (
                            <li key={`${mod}-${task}`} className="flex gap-2">
                              <span aria-hidden>•</span>
                              <span>{TASK_LABEL[task] ? t(TASK_LABEL[task]) : task}</span>
                            </li>
                          )),
                        )}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">{t("ashaFamilyRest")}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("ashaNothingDue")}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className="min-h-12 flex-1"
                      onClick={() => recordVisit(h)}
                      disabled={Boolean(queued && !queued.synced_at)}
                    >
                      {queued?.synced_at
                        ? t("ashaVisitSent")
                        : queued
                          ? t("ashaVisitSaved")
                          : t("ashaRecordVisit")}
                    </Button>
                  </div>

                  {queued?.last_error && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {t("ashaNotSent").replace("{error}", queued.last_error)}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
