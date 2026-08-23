/**
 * M11 · word memory — encoding at position 2, recall at position 18.
 *
 * RECOGNITION, NOT FREE RECALL — AND LABELLED AS SUCH.
 * Free recall needs the patient to SAY the words and someone (or an ASR) to score them.
 * This population includes aphasia, where a failure to say a word is a language finding,
 * not a memory finding — free recall would conflate the two. Recognition (pick the five
 * you saw among eight) is self-administrable, scoreable by taps, and separates memory
 * from expression. The features are named `recognition_*`, never `recall_*`, because a
 * clinician reading "recall 5/5" would assume the harder test.
 *
 * The word pool is drawn per-session but FIXED within it via sessionStorage — the recall
 * step must test the words that were actually shown, including after an app reload
 * mid-session.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { ModuleFeatures } from "@/lib/types";

const POOL = {
  en: ["river", "candle", "market", "yellow", "elbow", "window", "farmer", "spoon", "temple", "pocket", "cloud", "mirror"],
  hi: ["नदी", "मोमबत्ती", "बाज़ार", "पीला", "कोहनी", "खिड़की", "किसान", "चम्मच", "मंदिर", "जेब", "बादल", "दर्पण"],
  pa: ["ਨਦੀ", "ਮੋਮਬੱਤੀ", "ਬਾਜ਼ਾਰ", "ਪੀਲਾ", "ਕੂਹਣੀ", "ਖਿੜਕੀ", "ਕਿਸਾਨ", "ਚਮਚਾ", "ਮੰਦਰ", "ਜੇਬ", "ਬੱਦਲ", "ਸ਼ੀਸ਼ਾ"],
} as const;

const KEY = "nt.recall.words";

function draw(lang: keyof typeof POOL): { shown: string[]; lures: string[] } {
  const pool = [...POOL[lang]];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { shown: pool.slice(0, 5), lures: pool.slice(5, 8) };
}

interface Props {
  mode: "encode" | "recall";
  seconds: number;
  onDone: (features: ModuleFeatures, quality: { ok: boolean }) => void;
}

export function StepRecall({ mode, seconds, onDone }: Props) {
  const { lang, t } = useI18n();

  const words = useMemo(() => {
    try {
      if (mode === "encode") {
        const w = draw(lang as keyof typeof POOL);
        sessionStorage.setItem(KEY, JSON.stringify(w));
        return w;
      }
      const stored = sessionStorage.getItem(KEY);
      if (stored) return JSON.parse(stored) as { shown: string[]; lures: string[] };
    } catch { /* storage unavailable — fall through */ }
    return draw(lang as keyof typeof POOL);
  }, [mode, lang]);

  const [remaining, setRemaining] = useState(seconds);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const started = useMemo(() => performance.now(), []);

  // Encoding: show the five words, spoken aloud, then finish on the timer.
  useEffect(() => {
    if (mode !== "encode") return;
    try {
      const u = new SpeechSynthesisUtterance(words.shown.join(", "));
      u.lang = { en: "en-IN", hi: "hi-IN", pa: "pa-IN" }[lang] ?? "en-IN";
      u.rate = 0.75;
      window.speechSynthesis?.speak(u);
    } catch { /* text remains on screen */ }
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(timer);
          onDone({ encoding_shown: 5, encoding_seconds: seconds }, { ok: true });
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submitRecall = useCallback(() => {
    const hits = words.shown.filter((w) => picked.has(w)).length;
    const falseAlarms = words.lures.filter((w) => picked.has(w)).length;
    onDone(
      {
        recognition_hits: hits,
        recognition_false_alarms: falseAlarms,
        recognition_shown: 5,
        recognition_lures: words.lures.length,
        recognition_seconds: Math.round((performance.now() - started) / 100) / 10,
      },
      { ok: true },
    );
  }, [onDone, picked, started, words]);

  if (mode === "encode") {
    return (
      <div className="flex flex-col items-center gap-6">
        <ul className="flex flex-col gap-3">
          {words.shown.map((w) => (
            <li key={w} className="text-center text-3xl font-semibold">{w}</li>
          ))}
        </ul>
        <p className="text-4xl font-semibold tabular-nums text-muted-foreground">{remaining}</p>
      </div>
    );
  }

  const options = useMemo(
    () => [...words.shown, ...words.lures].sort((a, b) => a.localeCompare(b)),
    [words],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {options.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() =>
              setPicked((p) => {
                const n = new Set(p);
                if (n.has(w)) n.delete(w); else n.add(w);
                return n;
              })
            }
            className={[
              "min-h-16 rounded-xl border-2 px-3 text-xl",
              picked.has(w) ? "border-accent bg-accent/10 font-semibold" : "border-line",
            ].join(" ")}
          >
            {w}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={submitRecall}
        className="min-h-16 w-full rounded-xl bg-accent text-lg font-medium text-accent-foreground"
      >
        {t("done")}
      </button>
    </div>
  );
}

export default StepRecall;
