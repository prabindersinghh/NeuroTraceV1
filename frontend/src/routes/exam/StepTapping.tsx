/**
 * M7 hand speed. Ten seconds per hand, ~22 seconds total.
 *
 * Both hands, always, and never averaged into a single number on screen. The feature that
 * matters is the ratio between them: bilateral slowing is Parkinson's or ordinary ageing,
 * unilateral slowing is a corticospinal lesion, and a product that reports only "tapping
 * has slowed" would alert on every ageing patient in the cohort.
 *
 * Timestamps come from `performance.now()` at pointerdown, which is the closest thing the
 * browser offers to the moment of contact.
 */
import { Hand } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { extractFineMotor } from "@/lib/ondevice/motor";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";
import { cn } from "@/lib/utils";

const SECONDS_PER_HAND = 10;
const MIN_TAPS = 4;

type Phase = "idle" | "left" | "between" | "right" | "done";

interface Props {
  onDone: (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => void;
  onSkip: () => void;
}

export function StepTapping({ onDone, onSkip }: Props) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(SECONDS_PER_HAND);
  const [count, setCount] = useState(0);

  const left = useRef<number[]>([]);
  const right = useRef<number[]>([]);

  const finish = useCallback(() => {
    const features = extractFineMotor({ taps_L: left.current, taps_R: right.current });
    const enough = left.current.length >= MIN_TAPS && right.current.length >= MIN_TAPS;
    onDone(features, {
      ok: enough,
      reason: enough ? undefined : "too_few_taps",
    });
  }, [onDone]);

  useEffect(() => {
    if (phase !== "left" && phase !== "right") return;
    setRemaining(SECONDS_PER_HAND);
    setCount(0);
    speak(t(phase === "left" ? "handLeft" : "handRight"), lang);

    const tick = window.setInterval(() => setRemaining((r) => r - 1), 1000);
    const done = window.setTimeout(() => {
      if (phase === "left") setPhase("between");
      else setPhase("done");
    }, SECONDS_PER_HAND * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "done") finish();
  }, [phase, finish]);

  function tap() {
    if (phase !== "left" && phase !== "right") return;
    const now = performance.now();
    (phase === "left" ? left : right).current.push(now);
    setCount((c) => c + 1);
  }

  const active = phase === "left" || phase === "right";

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <h2 className="text-2xl font-semibold">{t("handTitle")}</h2>

      {active && (
        <p className="text-2xl font-medium text-accent" aria-live="polite">
          {t(phase === "left" ? "handLeft" : "handRight")}
        </p>
      )}

      <button
        type="button"
        onPointerDown={tap}
        disabled={!active}
        aria-label={t("tapNow")}
        className={cn(
          "grid h-64 w-64 select-none place-items-center rounded-full text-4xl font-bold transition-transform duration-75 focus-ring touch-manipulation active:scale-95",
          active ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground",
        )}
      >
        {active ? count : <Hand className="h-16 w-16" aria-hidden />}
      </button>

      {active && (
        <p className="text-3xl font-bold tabular-nums" aria-live="polite">
          {Math.max(0, remaining)}
        </p>
      )}

      {phase === "idle" && (
        <>
          <Button size="touch" variant="accent" onClick={() => setPhase("left")}>
            {t("begin")}
          </Button>
          <Button variant="link" onClick={onSkip}>
            {t("skipStep")}
          </Button>
        </>
      )}

      {phase === "between" && (
        <Button size="touch" variant="accent" onClick={() => setPhase("right")}>
          {t("handRight")}
        </Button>
      )}
    </div>
  );
}
