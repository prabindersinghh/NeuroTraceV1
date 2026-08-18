import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CaptureError, startAudioRecording, type AudioRecorder } from "@/lib/recording";
import { cn } from "@/lib/utils";

const TARGET_SECONDS = 10;

export function StepAudio({
  onDone,
  onError,
}: {
  onDone: (blob: Blob) => void;
  onError: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setElapsed((e) => e + 0.1);
      setLevel(recorderRef.current?.level() ?? 0);
    }, 100);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && elapsed >= TARGET_SECONDS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording]);

  async function start() {
    try {
      recorderRef.current = await startAudioRecording();
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      onError(
        err instanceof CaptureError && err.kind === "permission"
          ? t("permissionDenied")
          : t("unsupportedBrowser"),
      );
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;
    setRecording(false);
    onDone(await recorder.stop());
  }

  const progress = Math.min(1, elapsed / TARGET_SECONDS);

  return (
    <div className="flex flex-col items-center gap-8 text-center">
      <h2 className="text-2xl font-semibold">{t("speakTitle")}</h2>

      <blockquote
        lang={lang}
        className="rounded-xl border-2 border-accent/25 bg-accent/5 px-6 py-6 text-2xl font-medium leading-relaxed"
      >
        {t("speakSentence")}
      </blockquote>

      <div className="relative grid h-40 w-40 place-items-center">
        {recording && (
          <span
            className="absolute inset-0 rounded-full bg-accent/25 animate-pulse-ring"
            style={{ transform: `scale(${1 + level * 1.5})` }}
            aria-hidden
          />
        )}
        <span
          className={cn(
            "relative grid h-32 w-32 place-items-center rounded-full transition-colors",
            recording ? "bg-destructive text-destructive-foreground" : "bg-secondary text-primary",
          )}
        >
          <Mic className="h-14 w-14" aria-hidden />
        </span>
      </div>

      {recording ? (
        <>
          <div
            className="h-2.5 w-full max-w-sm overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="text-lg text-muted-foreground">
            {t("recording")} {Math.ceil(TARGET_SECONDS - elapsed)}s
          </p>
          <Button size="touch" variant="destructive" onClick={stop}>
            <Square className="h-6 w-6" aria-hidden />
            {t("stopRecording")}
          </Button>
        </>
      ) : (
        <Button size="touch" variant="accent" onClick={start}>
          <Mic className="h-7 w-7" aria-hidden />
          {t("startRecording")}
        </Button>
      )}
    </div>
  );
}
