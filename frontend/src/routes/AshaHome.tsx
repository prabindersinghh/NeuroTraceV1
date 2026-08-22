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
import type { AshaHousehold } from "../lib/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

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

const TASK_LABEL: Record<string, string> = {
  tandem_walk: "Tandem walking",
  unterberger: "Stepping on the spot, eyes closed",
  line_bisection: "Line bisection",
  star_cancellation: "Star cancellation",
  smooth_pursuit: "Follow the moving dot",
  random_saccades: "Look at each dot",
  timed_up_and_go: "Stand, walk, sit",
};

export default function AshaHome() {
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
          setError("Showing your saved list — no connection right now.");
        } else {
          setError(err instanceof ApiError ? err.message : "Could not load your households");
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
        visit.last_error = err instanceof ApiError ? err.message : "Could not send";
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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">My households</h1>
        <span
          className={[
            "rounded-full px-3 py-1 text-sm font-medium",
            online
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
          ].join(" ")}
        >
          {online ? "Online" : "No connection — visits are saved"}
        </span>
      </header>

      {pending.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              <strong>{pending.length}</strong> visit{pending.length > 1 ? "s" : ""} saved on
              this device, waiting to send.
            </p>
            <Button onClick={() => void sync()} disabled={!online || syncing}>
              {syncing ? "Sending…" : "Send now"}
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

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && households.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No households are assigned to you yet.
        </p>
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
                      {h.age ? `${h.age} years` : ""}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Last check-in:{" "}
                    {h.last_session ? new Date(h.last_session).toLocaleDateString() : "none"}
                    {" · "}
                    Last visit:{" "}
                    {h.last_visit ? new Date(h.last_visit).toLocaleDateString() : "none"}
                  </p>

                  {dueTasks.length > 0 ? (
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <p className="mb-1.5 text-sm font-medium">Do these on this visit</p>
                      <ul className="space-y-1 text-sm">
                        {dueTasks.flatMap(([mod, tasks]) =>
                          tasks.map((t) => (
                            <li key={`${mod}-${t}`} className="flex gap-2">
                              <span aria-hidden>•</span>
                              <span>{TASK_LABEL[t] ?? t}</span>
                            </li>
                          )),
                        )}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        The family does the rest at home. Do not repeat those.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nothing needs a visit this month.
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      className="min-h-12 flex-1"
                      onClick={() => recordVisit(h)}
                      disabled={Boolean(queued && !queued.synced_at)}
                    >
                      {queued?.synced_at
                        ? "Visit sent ✓"
                        : queued
                          ? "Saved — will send"
                          : "Record visit"}
                    </Button>
                  </div>

                  {queued?.last_error && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Not sent yet: {queued.last_error}. It is saved and will retry.
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
