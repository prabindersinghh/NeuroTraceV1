/**
 * The welcome, and the warm-up — "Let's get comfortable."
 *
 * Two interactions teach the two gestures the path uses: tap the light, hold the light
 * until it fills. NOTHING IS RECORDED. The warm-up exists so that the first measured
 * tap of the morning (M10, position 1) is not also the first time the patient has ever
 * tapped this surface — and so someone with a tremor finds out here, not mid-measure,
 * that the target is big enough for them. It is skippable, and the session clock does
 * not start until it is over (design spec, D-062).
 *
 * The comfort switches sit here because this is the one screen where changing them
 * costs nothing.
 */
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { speak } from "@/lib/speech-synthesis";

import { ComfortControls } from "./ComfortControls";
import { Light } from "./Light";
import { haptic } from "@/lib/haptic";

type Phase = "intro" | "tap" | "hold" | "done";

const HOLD_MS = 1200;

interface Props {
  practice: boolean;
  onBegin: () => void;
}

export function Welcome({ practice, onBegin }: Props) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>("intro");
  const [fill, setFill] = useState(0);
  const holding = useRef<{ raf: number; startedAt: number } | null>(null);

  useEffect(() => {
    const line = { intro: t("welcomeTitle"), tap: t("warmupTap"), hold: t("warmupHold"), done: t("warmupDone") }[phase];
    speak(line, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => () => { if (holding.current) cancelAnimationFrame(holding.current.raf); }, []);

  const startHold = useCallback(() => {
    if (holding.current) return;
    const startedAt = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - startedAt) / HOLD_MS);
      setFill(p);
      if (p >= 1) {
        holding.current = null;
        haptic(12);
        setPhase("done");
        return;
      }
      holding.current = { raf: requestAnimationFrame(tick), startedAt };
    };
    holding.current = { raf: requestAnimationFrame(tick), startedAt };
  }, []);

  const endHold = useCallback(() => {
    if (!holding.current) return;
    cancelAnimationFrame(holding.current.raf);
    holding.current = null;
    setFill(0); // let go early: it simply empties, and they can try again
  }, []);

  if (phase === "intro") {
    return (
      <div className="flex flex-1 flex-col justify-center gap-6 py-4">
        <div className="flex flex-col gap-3 text-center">
          <h2 id="scene-title" tabIndex={-1} className="text-title-1 focus:outline-none">
            {t("welcomeTitle")}
          </h2>
          <p className="text-xl leading-relaxed text-muted-foreground">{t("welcomeBody")}</p>
          {practice && <p className="text-xl leading-relaxed">{t("welcomePractice")}</p>}
          <p className="text-lg text-muted-foreground">{t("welcomeSit")}</p>
        </div>
        <ComfortControls />
        <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
          <Button size="touch" variant="accent" onClick={() => setPhase("tap")}>{t("ready")}</Button>
          <Button variant="link" className="min-h-12 text-base text-muted-foreground" onClick={onBegin}>
            {t("skipWarmup")}
          </Button>
        </div>
      </div>
    );
  }

  const line = phase === "tap" ? t("warmupTap") : phase === "hold" ? t("warmupHold") : t("warmupDone");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 py-4 text-center">
      <h2 id="scene-title" tabIndex={-1} className="text-title-2 focus:outline-none" aria-live="polite">
        {line}
      </h2>
      <Light
        state={phase === "done" ? "done" : phase === "hold" ? (fill > 0 ? "on" : "idle") : "idle"}
        label={line}
        fill={phase === "hold" ? fill : undefined}
        disabled={phase === "done"}
        onPress={() => {
          if (phase === "tap") { haptic(); setPhase("hold"); }
          else if (phase === "hold") startHold();
        }}
        onRelease={phase === "hold" ? endHold : undefined}
      >
        {phase === "done" ? <Check className="h-16 w-16" aria-hidden /> : null}
      </Light>
      <p className="text-base text-muted-foreground">{t("warmupNote")}</p>
      {phase === "done" && (
        <Button size="touch" variant="accent" className="max-w-sm" onClick={onBegin}>{t("begin")}</Button>
      )}
    </div>
  );
}

export default Welcome;
