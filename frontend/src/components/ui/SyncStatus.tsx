/**
 * The shell's connectivity and queued-session strip.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/lib/offline.ts` has always been able to count and drain the queue — `pendingCount`
 * and `syncPending` are exported, documented, and were called from nowhere. The
 * `pendingSync` string existed in all three languages and was referenced nowhere. So a
 * session captured offline was written to IndexedDB and then became invisible: the patient
 * saw one WifiOff chip on the finish screen, tapped Finish, and the record was never sent
 * or mentioned again. The caregiver in another city just saw a dashboard that stopped
 * updating.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not drain automatically when the connection returns. Replaying captured clinical
 * sessions without anyone asking is a behaviour change on the data path, not a UX polish —
 * `syncPending` replays in strict capture order because the alert gate is a function of
 * consecutive sessions, and an unattended retry loop needs its own thinking about
 * concurrency, partial failure and duplicates. That is recorded in docs/archive/UX-CHANGES.md as
 * deferred. Here the send is explicit, one tap, and the user can see the count go down.
 *
 * RESTRAINT
 * ---------
 * Renders NOTHING when the app is online with an empty queue, which is almost always.
 * A persistent "you are online" badge is chrome that teaches people to ignore the strip
 * on the one morning it says something.
 */
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isOnline, onConnectivityChange, pendingCount, syncPending } from "@/lib/offline";
import { Button } from "./button";
import { Spinner } from "./states";

export function SyncStatus() {
  const { t } = useI18n();
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(() => {
    pendingCount().then(setPending).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const stop = onConnectivityChange((next) => {
      setOnline(next);
      refresh();
    });
    return stop;
  }, [refresh]);

  const send = useCallback(async () => {
    // Guarded: a second tap while a drain is in flight would replay the same sessions,
    // and `syncPending` is explicitly order-sensitive.
    if (sending) return;
    setSending(true);
    try {
      await syncPending(api);
    } catch {
      /* the queue keeps the session and its attempt count; the strip stays visible */
    } finally {
      setSending(false);
      refresh();
    }
  }, [sending, refresh]);

  // The common case: connected, nothing waiting. Say nothing at all.
  if (online && pending === 0) return null;

  return (
    <div
      // `polite`, not `assertive`: this must never interrupt a patient mid-task.
      role="status"
      aria-live="polite"
      className="border-b border-watch/40 bg-watch-soft"
    >
      <div className="container flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm">
        <span>
          {!online && t("offline")}
          {!online && pending > 0 && " · "}
          {pending > 0 && `${pending} ${t("pendingSync")}`}
        </span>

        {/* Only offer sending when there is both something to send and a way to send it. */}
        {online && pending > 0 && (
          <Button variant="outline" size="sm" onClick={send} disabled={sending}>
            {sending ? <Spinner className="h-4 w-4" /> : null}
            {sending ? t("sending") : t("sendNow")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default SyncStatus;
