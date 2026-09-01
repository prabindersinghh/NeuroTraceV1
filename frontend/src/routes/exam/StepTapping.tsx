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
 *
 * PRESENTATION. No tap count on screen. A number climbing in front of someone whose
 * weaker hand is the one being measured is a scoreboard, and the ratio it feeds is not
 * something they can improve by watching it. Each tap is acknowledged by the light
 * dipping for a frame and a haptic tick; the ring shows how long is left.
 */
import { Hand } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Light } from "@/components/journey/Light";
import { haptic } from "@/lib/haptic";
import { Ring } from "@/components/journey/Ring";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { extractFineMotor } from "@/lib/ondevice/motor";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";

const SECONDS_PER_HAND = 10;
const MIN_TAPS = 4;

type Phase = "idle" | "left" | "between" | "right" | "done";

interface Props {
  onDone: (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => void;
}

export function StepTapping({ onDone }: Props) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(SECONDS_PER_HAND);
  const [pressed, setPressed] = useState(false);

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
    haptic(5);
    // A one-frame dip acknowledges the contact without counting it.
    setPressed(true);
    window.setTimeout(() => setPressed(false), 60);
  }

  const active = phase === "left" || phase === "right";

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      {active && (
        <div className="flex w-full items-center justify-between gap-4 px-2">
          <p className="text-title-3 text-accent" aria-live="polite">
            {t(phase === "left" ? "handLeft" : "handRight")}
          </p>
          <Ring seconds={SECONDS_PER_HAND} remaining={Math.max(0, remaining)} size={64} />
        </div>
      )}

      <Light
        state={phase === "done" ? "done" : active ? (pressed ? "idle" : "on") : "idle"}
        label={t("tapNow")}
        disabled={!active}
        onPress={tap}
      >
        {active ? <span className="text-title-2">{t("keepGoing")}</span> : <Hand className="h-16 w-16" aria-hidden />}
      </Light>

      {phase === "idle" && (
        <Button size="touch" variant="accent" className="max-w-sm" onClick={() => setPhase("left")}>
          {t("begin")}
        </Button>
      )}

      {phase === "between" && (
        <Button size="touch" variant="accent" className="max-w-sm" onClick={() => setPhase("right")}>
          {t("handRight")}
        </Button>
      )}
    </div>
  );
}
