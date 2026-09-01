/**
 * M11 · word memory — encoding at position 7, recall at position 17 (Comprehensive).
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
 *
 * The words are spoken QUEUED behind the instruction. Before this they were spoken and
 * then cancelled a moment later by the step label, so a patient who does not read never
 * heard them at all.
 */
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Ring } from "@/components/journey/Ring";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";
import { cn } from "@/lib/utils";

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

  // Encoding: show the five words, spoken aloud after the instruction, then finish on
  // the timer.
  useEffect(() => {
    if (mode !== "encode") return;
    speak(words.shown.join(", "), lang, { rate: 0.75, queue: true });
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Acts when the countdown lands, outside any updater: an updater runs during render,
  // and a parent's state must never change from inside a child's render.
  useEffect(() => {
    if (mode !== "encode" || remaining > 0) return;
    onDone({ encoding_shown: 5, encoding_seconds: seconds }, { ok: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, remaining]);

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

  // Hoisted above the `encode` early-return on purpose. React counts hooks per render, so a
  // `useMemo` reached only on the recall branch changes the hook count when `mode` changes —
  // "rendered more hooks than during the previous render". Today the two modes are rendered
  // from two different slots in ProtocolRunner, so the component unmounts in between and the
  // violation never fires; it fires the moment anyone renders both from one slot, or adds a
  // toggle. Computing the option list on the encode pass costs one sort of eight strings.
  const options = useMemo(
    () => [...words.shown, ...words.lures].sort((a, b) => a.localeCompare(b)),
    [words],
  );

  if (mode === "encode") {
    return (
      <div className="flex flex-col items-center gap-8">
        <ul className="flex flex-col gap-3 rounded-2xl border border-line bg-secondary px-10 py-6">
          {words.shown.map((w, i) => (
            <li
              key={w}
              lang={lang}
              className="journey-in text-center text-title-1"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {w}
            </li>
          ))}
        </ul>
        <Ring seconds={seconds} remaining={remaining} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        {options.map((w) => {
          const on = picked.has(w);
          return (
            <button
              key={w}
              type="button"
              lang={lang}
              aria-pressed={on}
              onClick={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  if (n.has(w)) n.delete(w); else n.add(w);
                  return n;
                })
              }
              className={cn(
                "focus-ring tactile flex min-h-16 items-center justify-center gap-2 rounded-xl border-2 px-3 text-xl",
                on ? "border-accent bg-accent/10 font-semibold" : "border-line bg-card",
              )}
            >
              {/* Selection is carried by the fill AND a tick, never by colour alone. */}
              {on && <Check className="h-5 w-5 shrink-0 text-accent" aria-hidden />}
              {w}
            </button>
          );
        })}
      </div>
      <Button size="touch" variant="accent" onClick={submitRecall}>
        {t("done")}
      </Button>
    </div>
  );
}

export default StepRecall;
