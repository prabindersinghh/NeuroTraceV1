/**
 * M4 speech clarity. Three tasks, ~20 seconds total.
 *
 * Each probes a different part of motor speech, which is why all three are here:
 *
 *   sustained /a/   phonation only — jitter, shimmer, breathiness, and how long they can
 *                   hold a sound, which indexes respiratory support
 *   "pa-ta-ka"      articulatory agility across the whole vocal tract; the *evenness*
 *                   degrades before the rate does
 *   read a sentence connected speech under real coarticulatory load — pause structure
 *
 * The PCM is analysed in the browser and dropped. Only numbers leave this component.
 */
import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaptureError, startAudioCapture, type AudioCapture } from "@/lib/capture";
import { useI18n, type StringKey } from "@/lib/i18n";
import {
  assessAudioQuality,
  extractDysarthria,
  type DysarthriaInput,
} from "@/lib/ondevice/speech";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";
import { cn } from "@/lib/utils";

type TaskKey = keyof DysarthriaInput;

const TASKS: { key: TaskKey; label: StringKey; seconds: number; showSentence?: boolean }[] = [
  { key: "sustained_a", label: "speechSustain", seconds: 6 },
  { key: "ddk", label: "speechDdk", seconds: 6 },
  { key: "sentence", label: "speechSentence", seconds: 8, showSentence: true },
];

interface Props {
  onDone: (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => void;
  onError: (message: string) => void;
  onSkip: () => void;
}

export function StepSpeech({ onDone, onError, onSkip }: Props) {
  const { t, lang } = useI18n();
  const captureRef = useRef<AudioCapture | null>(null);
  const collected = useRef<DysarthriaInput>({});
  /** When the current capture window closes. See the countdown effect below. */
  const deadlineRef = useRef(0);

  const [index, setIndex] = useState(-1);
  const [remaining, setRemaining] = useState(0);
  const [level, setLevel] = useState(0);
  const [recording, setRecording] = useState(false);

  useEffect(() => () => captureRef.current?.cancel(), []);

  const finish = useCallback(() => {
    const features = extractDysarthria(collected.current);
    // Judge quality on the sentence task: it is the longest and the most representative
    // of ordinary speaking conditions.
    const sample = collected.current.sentence ?? collected.current.sustained_a;
    const verdict = sample ? assessAudioQuality(sample) : { ok: false, reason: "no_speech_detected" };
    onDone(features, { ok: verdict.ok, reason: verdict.reason });
  }, [onDone]);

  const runTask = useCallback(
    async (i: number) => {
      const task = TASKS[i];
      speak(t(task.label), lang);
      try {
        captureRef.current = await startAudioCapture();
      } catch (err) {
        onError(
          err instanceof CaptureError && err.kind === "permission"
            ? t("permissionDenied")
            : t("unsupportedBrowser"),
        );
        return;
      }
      deadlineRef.current = performance.now() + task.seconds * 1000;
      setRecording(true);
      setRemaining(task.seconds);
    },
    [lang, onError, t],
  );

  /**
   * One countdown drives both the visible timer and the capture window.
   *
   * Derived from a DEADLINE, not by subtracting from `remaining` on each tick. This step
   * ticks four times a second so the level meter moves smoothly — every other step ticks
   * once a second — and it was decrementing by a whole second on each of those ticks. So
   * every capture window ran at 4x speed: the 6s tasks recorded 1.5s, the 8s sentence
   * recorded 2s, and the whole 20s module finished in 5.
   *
   * That is not only why it appeared to "not wait" — it corrupted the measurement. M4's
   * features were extracted from a fraction of the intended audio, and those features feed
   * the patient's baseline. A window that short also captures the patient still reading the
   * instruction, which is why it so often came back "we could not hear you".
   *
   * A deadline also survives what a decrementing counter does not: browsers throttle timers
   * in a backgrounded tab, which would silently stretch the window instead of shortening it.
   */
  useEffect(() => {
    if (!recording) return;
    const tick = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadlineRef.current - performance.now()) / 1000)));
      setLevel(captureRef.current?.level() ?? 0);
    }, 250);
    return () => window.clearInterval(tick);
  }, [recording]);

  useEffect(() => {
    if (!recording || remaining > 0) return;
    (async () => {
      const capture = captureRef.current;
      captureRef.current = null;
      setRecording(false);
      if (!capture) return;
      const pcm = await capture.stop();
      collected.current[TASKS[index].key] = pcm;
      if (index + 1 < TASKS.length) {
        setIndex(index + 1);
        void runTask(index + 1);
      } else {
        finish();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, recording]);

  function begin() {
    setIndex(0);
    void runTask(0);
  }

  const current = index >= 0 && index < TASKS.length ? TASKS[index] : null;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-title-2">{t("speechTitle")}</h2>

      {current && (
        <p className="text-2xl font-medium text-accent" aria-live="polite">
          {t(current.label)}
        </p>
      )}

      {current?.showSentence && (
        <blockquote
          lang={lang}
          className="rounded-xl border-2 border-accent/25 bg-accent/5 px-5 py-5 text-2xl font-medium leading-relaxed"
        >
          {t("sentenceText")}
        </blockquote>
      )}

      <div className="relative grid h-36 w-36 place-items-center">
        {recording && (
          <span
            className="absolute inset-0 rounded-full bg-accent/25"
            style={{ transform: `scale(${1 + Math.min(level, 1) * 1.4})` }}
            aria-hidden
          />
        )}
        <span
          className={cn(
            "relative grid h-28 w-28 place-items-center rounded-full transition-colors",
            recording ? "bg-destructive text-destructive-foreground" : "bg-secondary text-primary",
          )}
        >
          <Mic className="h-12 w-12" aria-hidden />
        </span>
      </div>

      {recording ? (
        <p className="text-3xl font-bold tabular-nums text-accent" aria-live="polite">
          {Math.max(0, remaining)}
        </p>
      ) : index < 0 ? (
        <>
          <Button size="touch" variant="accent" onClick={begin}>
            <Mic className="h-7 w-7" aria-hidden />
            {t("begin")}
          </Button>
          <Button variant="link" onClick={onSkip}>
            {t("skipStep")}
          </Button>
        </>
      ) : (
        <Square className="h-6 w-6 text-muted-foreground" aria-hidden />
      )}

      <div className="flex items-center gap-2" aria-label="progress">
        {TASKS.map((task, i) => (
          <span
            key={task.key}
            className={cn(
              "h-2.5 w-10 rounded-full",
              i < index ? "bg-stable" : i === index ? "bg-accent" : "bg-secondary",
            )}
          />
        ))}
      </div>
    </div>
  );
}
