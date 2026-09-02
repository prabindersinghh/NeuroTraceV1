/**
 * Awaaz listener view — `/listen/:token`. NO login.
 *
 * WHO THIS IS FOR: the shopkeeper, the bus conductor, the nephew on a video call — someone
 * talking to a survivor right now who cannot follow them. The caregiver sends a link that
 * expires. The unguessable token IS the capability; there is nothing to sign into and
 * nothing to install, because a stranger will not do either.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW
 * No patient name — the caregiver picks a display name, often a first name or just "my
 * father", because a link can be forwarded. No bands, no scores, no history, no diagnosis.
 * A listener needs the last few things said and one instruction about how to help. Showing
 * a stranger a clinical picture would be a privacy breach dressed up as helpfulness.
 *
 * The coaching line is chosen server-side by urgency of the mistake it prevents. One line,
 * because a listener reads one line.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ListenerView {
  display_name: string;
  lang: string;
  expires_at: string;
  coaching: { code: string; line: string };
  recent: { text: string; lang: string; ts: string }[];
}

export default function Listen() {
  const { token = "" } = useParams();
  const { t } = useI18n();
  const [view, setView] = useState<ListenerView | null>(null);
  const [dead, setDead] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api.listenerView(token));
    } catch {
      // Expired, revoked, or never existed — all the same to a stranger, on purpose.
      setDead(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
    // Polling, not a socket: this page is opened for a few minutes on a stranger's phone,
    // often on a bad connection, and a dropped socket that silently stops updating is
    // worse than a poll that just retries.
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load]);

  if (dead) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
        <h1 className="text-title-fluid">{t("listenExpired")}</h1>
        <p className="text-muted-foreground">{t("listenExpiredBody")}</p>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
        <p className="text-muted-foreground">{t("connecting")}</p>
      </main>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.round((new Date(view.expires_at).getTime() - Date.now()) / 60000),
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-6">
      <header>
        <p className="text-sm text-muted-foreground">{t("listenWith")}</p>
        <h1 className="text-title-fluid">{view.display_name}</h1>
      </header>

      {/* The single most useful thing to say right now. */}
      <section className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-accent">{t("listenHowToHelp")}</p>
        <p className="mt-2 text-xl leading-snug">{view.coaching.line}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t("listenSaid")}</p>
        {view.recent.length === 0 ? (
          <p className="rounded-xl border border-line p-4 text-muted-foreground">
            {t("listenNothing")}
          </p>
        ) : (
          view.recent.map((u) => (
            <p key={u.ts} className="rounded-xl border border-line p-4 text-xl">
              {u.text}
            </p>
          ))
        )}
      </section>

      <footer className="mt-auto space-y-2 pt-6 text-xs text-muted-foreground">
        <p>{t("listenExpiresIn").replace("{n}", String(minutesLeft))}</p>
        <p>{t("listenPrivacy")}</p>
      </footer>
    </main>
  );
}
