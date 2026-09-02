/**
 * Vertigo attack log.
 *
 * In the reference patient this single number was the earliest observable sign: sixty
 * attacks accumulated over months while every limb-coordination test stayed normal and the
 * hospital assessment was still in the future. It costs the family nothing to record, and
 * they are the only people who can.
 *
 * Design follows from who uses it and when. A caregiver logs an attack just after it
 * happens, often while still settling the person — one-handed, distracted, possibly
 * frightened. So:
 *
 *   Two taps to log. Duration is a set of ranges, not a number entry, because nobody times
 *   an attack with a stopwatch and a free-text minute field invites false precision.
 *
 *   Entries queue offline. An attack at 3am in a village with no signal must still be
 *   recorded, and it must not be lost when the app is closed.
 *
 *   Nothing here is scored on the spot. The value is the count over weeks. Showing a band
 *   after one entry would be meaningless and would teach the family to distrust the number.
 */
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Button } from "./ui/button";

const LOG_KEY = "neurotrace.vertigo.log";

export interface VertigoAttack {
  ts: string;
  duration_seconds: number;
  severity: number;
  positional?: boolean;
  synced?: boolean;
}

/** Ranges, not a number field. The midpoint is what we store. */
const DURATIONS: { label: Record<string, string>; seconds: number }[] = [
  { seconds: 30, label: { en: "A few seconds", hi: "कुछ सेकंड", pa: "ਕੁਝ ਸਕਿੰਟ" } },
  { seconds: 120, label: { en: "1–5 minutes", hi: "1–5 मिनट", pa: "1–5 ਮਿੰਟ" } },
  { seconds: 900, label: { en: "5–30 minutes", hi: "5–30 मिनट", pa: "5–30 ਮਿੰਟ" } },
  { seconds: 3600, label: { en: "About an hour", hi: "करीब एक घंटा", pa: "ਲਗਭਗ ਇੱਕ ਘੰਟਾ" } },
  { seconds: 10800, label: { en: "Hours", hi: "कई घंटे", pa: "ਕਈ ਘੰਟੇ" } },
];

const SEVERITIES: { value: number; label: Record<string, string> }[] = [
  { value: 1, label: { en: "Mild", hi: "हल्का", pa: "ਹਲਕਾ" } },
  { value: 2, label: { en: "Bad", hi: "तेज़", pa: "ਤੇਜ਼" } },
  { value: 3, label: { en: "Could not stand", hi: "खड़े नहीं हो सके", pa: "ਖੜ੍ਹੇ ਨਹੀਂ ਹੋ ਸਕੇ" } },
];

function load(): VertigoAttack[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]") as VertigoAttack[];
  } catch {
    return [];
  }
}

export function VertigoLog({ onLogged }: { onLogged?: (a: VertigoAttack) => void }) {
  const { lang, locale } = useI18n();
  const [attacks, setAttacks] = useState<VertigoAttack[]>(load);
  const [duration, setDuration] = useState<number | null>(null);
  const [severity, setSeverity] = useState<number | null>(null);
  const [positional, setPositional] = useState(false);
  const [justLogged, setJustLogged] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(attacks));
    } catch {
      /* storage blocked — entries survive this session only */
    }
  }, [attacks]);

  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    return attacks.filter((a) => new Date(a.ts).getTime() >= cutoff);
  }, [attacks]);

  const totalMinutes = Math.round(
    last30.reduce((sum, a) => sum + a.duration_seconds, 0) / 60,
  );

  function log() {
    if (duration === null || severity === null) return;
    const attack: VertigoAttack = {
      ts: new Date().toISOString(),
      duration_seconds: duration,
      severity,
      positional,
      synced: false,
    };
    setAttacks((prev) => [attack, ...prev]);
    setDuration(null);
    setSeverity(null);
    setPositional(false);
    setJustLogged(true);
    setTimeout(() => setJustLogged(false), 2500);
    onLogged?.(attack);
  }

  const t = {
    title: { en: "Dizzy spell", hi: "चक्कर का दौरा", pa: "ਚੱਕਰ ਦਾ ਦੌਰਾ" }[lang],
    how_long: { en: "How long did it last?", hi: "कितनी देर रहा?", pa: "ਕਿੰਨੀ ਦੇਰ ਰਿਹਾ?" }[lang],
    how_bad: { en: "How bad was it?", hi: "कितना तेज़ था?", pa: "ਕਿੰਨਾ ਤੇਜ਼ ਸੀ?" }[lang],
    positional: {
      en: "Did it start when they moved or turned over?",
      hi: "क्या यह हिलने या करवट लेने पर शुरू हुआ?",
      pa: "ਕੀ ਇਹ ਹਿੱਲਣ ਜਾਂ ਪਾਸਾ ਲੈਣ 'ਤੇ ਸ਼ੁਰੂ ਹੋਇਆ?",
    }[lang],
    save: { en: "Save", hi: "सहेजें", pa: "ਸੰਭਾਲੋ" }[lang],
    saved: { en: "Saved", hi: "सहेज लिया", pa: "ਸੰਭਾਲ ਲਿਆ" }[lang],
  };

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-base font-semibold">{t.title}</h3>
        {last30.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {last30.length} in the last 30 days · about {totalMinutes} minutes in total
          </p>
        )}
      </header>

      <div className="space-y-3">
        <fieldset>
          <legend className="mb-1.5 text-sm">{t.how_long}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DURATIONS.map((d) => (
              <button
                key={d.seconds}
                type="button"
                aria-pressed={duration === d.seconds}
                onClick={() => setDuration(d.seconds)}
                className={[
                  "min-h-12 rounded-lg border px-3 text-sm transition",
                  duration === d.seconds
                    ? "border-sky-600 bg-sky-600 text-white"
                    : "hover:bg-muted",
                ].join(" ")}
              >
                {d.label[lang]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-sm">{t.how_bad}</legend>
          <div className="flex gap-2">
            {SEVERITIES.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={severity === s.value}
                onClick={() => setSeverity(s.value)}
                className={[
                  "min-h-12 flex-1 rounded-lg border px-2 text-sm transition",
                  severity === s.value
                    ? "border-sky-600 bg-sky-600 text-white"
                    : "hover:bg-muted",
                ].join(" ")}
              >
                {s.label[lang]}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Positional vs spontaneous is the single most useful triage split in dizziness,
            and it is one question. NOT a Dix-Hallpike — we never ask an unsupervised
            patient to provoke an attack. */}
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={positional}
            onChange={(e) => setPositional(e.target.checked)}
          />
          <span>{t.positional}</span>
        </label>

        <Button
          className="min-h-12 w-full"
          onClick={log}
          disabled={duration === null || severity === null}
        >
          {justLogged ? `${t.saved} ✓` : t.save}
        </Button>
      </div>

      {last30.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {last30.slice(0, 5).map((a) => (
            <li key={a.ts} className="flex justify-between gap-2">
              <span>{formatDateTime(a.ts, locale)}</span>
              <span>
                {Math.round(a.duration_seconds / 60)} min
                {a.positional ? " · on moving" : ""}
                {a.synced ? "" : " · saved on this phone"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default VertigoLog;
