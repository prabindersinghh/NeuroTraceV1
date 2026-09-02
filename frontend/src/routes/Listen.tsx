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
import { useParams, useSearchParams } from "react-router-dom";

import { ApiError, api } from "@/lib/api";
import { LISTENER_COPY, normaliseListenerLanguage } from "@/lib/awaazListener";

interface ListenerView {
  display_name: string;
  lang: string;
  expires_at: string;
  coaching: { code: string; line: string };
  recent: { text: string; lang: string; ts: string }[];
}

export default function Listen() {
  const { token = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<ListenerView | null>(null);
  const [dead, setDead] = useState(false);
  const [connectionProblem, setConnectionProblem] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api.listenerView(token));
      setDead(false);
      setConnectionProblem(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Expired, revoked, or never existed — all the same to a stranger, on purpose.
        setDead(true);
        setConnectionProblem(false);
      } else {
        // Keep the last good view during a transient outage. A dropped poll is not proof
        // that the caregiver revoked the capability or that its TTL elapsed.
        setConnectionProblem(true);
      }
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

  const lang = normaliseListenerLanguage(view?.lang ?? searchParams.get("lang"));
  const copy = LISTENER_COPY[lang];

  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = previous; };
  }, [lang]);

  if (dead) {
    return (
      <main lang={lang} className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-center">
        {/* The listener page is opened by a stranger with no account and no language
            preference of ours, so `lang` comes from the link and the copy is localised
            (branch). The type token stays the app's own — reverting it to a raw size
            would take this one screen back to the pre-DESIGN_LANGUAGE styling. */}
        <h1 className="text-title-fluid">{copy.expiredTitle}</h1>
        <p className="text-muted-foreground">
          {copy.expiredBody}
        </p>
      </main>
    );
  }

  if (!view) {
    return (
      <main lang={lang} className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">
          {connectionProblem ? copy.connectionFailed : copy.connecting}
        </p>
        {connectionProblem && (
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-12 rounded-xl border border-line px-5 font-medium"
          >
            {copy.retry}
          </button>
        )}
      </main>
    );
  }

  const minutesLeft = Math.max(
    0,
    Math.round((new Date(view.expires_at).getTime() - Date.now()) / 60000),
  );

  return (
    <main lang={lang} className="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-6">
      {connectionProblem && (
        <p role="alert" className="rounded-xl border border-alert/40 bg-alert-soft p-3 text-sm text-alert">
          {copy.updatesPaused}
        </p>
      )}
      <header>
        <p className="text-sm text-muted-foreground">{copy.listeningWith}</p>
        <h1 className="text-title-fluid">{view.display_name}</h1>
      </header>

      {/* The single most useful thing to say right now. */}
      <section className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-5">
        <p className="font-mono text-[11px] tracking-[0.18em] text-accent">{copy.howToHelp}</p>
        <p className="mt-2 text-xl leading-snug">{view.coaching.line}</p>
      </section>

      <section className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{copy.whatTheySaid}</p>
        {view.recent.length === 0 ? (
          <p className="rounded-xl border border-line p-4 text-muted-foreground">
            {copy.nothingYet}
          </p>
        ) : (
          view.recent.map((u) => (
            <p
              key={u.ts}
              lang={normaliseListenerLanguage(u.lang)}
              className="rounded-xl border border-line p-4 text-xl"
            >
              {u.text}
            </p>
          ))
        )}
      </section>

      <footer className="mt-auto space-y-2 pt-6 text-xs text-muted-foreground">
        <p>{copy.expiresIn(minutesLeft)}</p>
        <p>{copy.privacy}</p>
      </footer>
    </main>
  );
}
