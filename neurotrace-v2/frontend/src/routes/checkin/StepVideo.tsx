import { Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CaptureError, startVideoRecording, type VideoRecorder } from "@/lib/recording";

const TARGET_SECONDS = 10;

export function StepVideo({
  onDone,
  onError,
}: {
  onDone: (blob: Blob) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (recording && elapsed >= TARGET_SECONDS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, recording]);

  async function start() {
    try {
      const recorder = await startVideoRecording();
      recorderRef.current = recorder;
      if (videoRef.current) {
        videoRef.current.srcObject = recorder.stream;
        await videoRef.current.play().catch(() => undefined);
      }
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
    if (videoRef.current) videoRef.current.srcObject = null;
    onDone(await recorder.stop());
  }

  const progress = Math.min(1, elapsed / TARGET_SECONDS);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-2xl font-semibold">{t("faceTitle")}</h2>
      <p className="text-xl text-muted-foreground">{t("faceInstruction")}</p>

      <div className="relative aspect-[4/3] w-full max-w-sm overflow-hidden rounded-2xl border-2 border-border bg-secondary">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full scale-x-[-1] object-cover"
          aria-label="Camera preview"
        />
        {!recording && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Video className="h-16 w-16" aria-hidden />
          </div>
        )}
        {recording && (
          <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-sm font-medium text-destructive-foreground">
            <span className="h-2 w-2 rounded-full bg-white" />
            {Math.ceil(TARGET_SECONDS - elapsed)}s
          </span>
        )}
      </div>

      {recording ? (
        <div
          className="h-2.5 w-full max-w-sm overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : (
        <Button size="touch" variant="accent" onClick={start}>
          <Video className="h-7 w-7" aria-hidden />
          {t("startCamera")}
        </Button>
      )}
    </div>
  );
}
