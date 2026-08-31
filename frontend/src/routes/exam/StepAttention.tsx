/**
 * M10 attention and speed. Ten trials, ~20 seconds.
 *
 * What this measures is not really speed — it is *consistency*. Intra-individual
 * variability of response time is the most sensitive cognitive marker we have, and a
 * patient can hold their median steady by concentrating harder while their consistency
 * collapses. `rt_cov` is the headline; `rt_median` is corroboration.
 *
 * Latency is measured from the frame in which the stimulus actually painted, not from the
 * timer that scheduled it, so what is recorded is the person rather than the event loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { extractAttentionSpeed } from "@/lib/ondevice/attention";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRIALS = 10;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 2600;
const MISS_TIMEOUT_MS = 2000;

type Phase = "idle" | "waiting" | "go" | "done";

interface Props {
  onDone: (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => void;
  onSkip: () => void;
}

export function StepAttention({ onDone, onSkip }: Props) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [trial, setTrial] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const latencies = useRef<number[]>([]);
  const misses = useRef(0);
  const falseStarts = useRef(0);
  const shownAt = useRef(0);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const finish = useCallback(() => {
    clearTimers();
    setPhase("done");
    const features = extractAttentionSpeed({
      simple_rt: {
        latencies_ms: latencies.current,
        misses: misses.current,
        false_starts: falseStarts.current,
      },
    });
    onDone(features, {
      ok: latencies.current.length >= 4,
      reason: latencies.current.length >= 4 ? undefined : "too_few_trials",
    });
  }, [onDone]);

  const runTrial = useCallback(
    (index: number) => {
      if (index >= TRIALS) {
        finish();
        return;
      }
      setTrial(index);
      setPhase("waiting");
      const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);

      timers.current.push(
        window.setTimeout(() => {
          setPhase("go");
          // Stamp the time in the frame where the blue circle is actually painted.
          requestAnimationFrame(() => {
            shownAt.current = performance.now();
          });
          timers.current.push(
            window.setTimeout(() => {
              misses.current += 1;
              setFlash(null);
              runTrial(index + 1);
            }, MISS_TIMEOUT_MS),
          );
        }, delay),
      );
    },
    [finish],
  );

  function handleTap() {
    if (phase === "idle") {
      latencies.current = [];
      misses.current = 0;
      falseStarts.current = 0;
      speak(t("tapTitle"), lang);
      runTrial(0);
      return;
    }
    if (phase === "waiting") {
      falseStarts.current += 1;
      setFlash(t("tapTooSoon"));
      window.setTimeout(() => setFlash(null), 700);
      return;
    }
    if (phase === "go") {
      clearTimers();
      if (shownAt.current > 0) latencies.current.push(performance.now() - shownAt.current);
      shownAt.current = 0;
      setFlash(null);
      runTrial(trial + 1);
    }
  }

  const isGo = phase === "go";
  const label =
    phase === "idle" ? t("begin") : phase === "waiting" ? t("tapWait") : isGo ? t("tapNow") : "✓";

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <h2 className="text-title-2">{t("tapTitle")}</h2>

      <button
        type="button"
        onPointerDown={handleTap}
        disabled={phase === "done"}
        aria-label={label}
        className={cn(
          "grid h-64 w-64 select-none place-items-center rounded-full text-4xl font-bold transition-colors duration-75 focus-ring touch-manipulation",
          isGo && "bg-accent text-accent-foreground",
          phase === "waiting" && "bg-secondary text-muted-foreground",
          phase === "idle" && "bg-primary text-primary-foreground",
          phase === "done" && "bg-stable text-white",
        )}
      >
        {label}
      </button>

      <p className="h-6 text-lg font-medium text-destructive" role="status">
        {flash}
      </p>

      <p className="text-lg text-muted-foreground">
        {t("trial")} {Math.min(trial + (phase === "idle" ? 0 : 1), TRIALS)} / {TRIALS}
      </p>

      {phase === "idle" && (
        <Button variant="link" onClick={onSkip}>
          {t("skipStep")}
        </Button>
      )}
    </div>
  );
}
