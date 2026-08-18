/**
 * Reaction mini-game — 12 trials, random 1-3s delay, logs stimulus->tap latency,
 * misses (no tap within 2s) and false starts (tap before the stimulus).
 * Feeds app/ml/reaction.py.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { ReactionPayload } from "@/lib/types";
import { cn } from "@/lib/utils";

const TRIALS = 12;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 3000;
const MISS_TIMEOUT_MS = 2000;

type Phase = "idle" | "waiting" | "go" | "done";

export function StepReaction({ onDone }: { onDone: (payload: ReactionPayload) => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [trial, setTrial] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const latencies = useRef<number[]>([]);
  const misses = useRef(0);
  const falseStarts = useRef(0);
  const goAt = useRef(0);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => clearTimers, []);

  const finish = useCallback(() => {
    clearTimers();
    setPhase("done");
    onDone({
      latencies_ms: latencies.current,
      misses: misses.current,
      false_starts: falseStarts.current,
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
          goAt.current = performance.now();
          setPhase("go");
          // no tap within the window counts as a miss
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
      latencies.current.push(performance.now() - goAt.current);
      setFlash(null);
      runTrial(trial + 1);
    }
  }

  const isGo = phase === "go";
  const label =
    phase === "idle" ? t("begin") : phase === "waiting" ? t("tapWait") : isGo ? t("tapNow") : "✓";

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-2xl font-semibold">{t("tapTitle")}</h2>
      <p className="text-xl text-muted-foreground">{t("tapInstruction")}</p>

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
    </div>
  );
}
