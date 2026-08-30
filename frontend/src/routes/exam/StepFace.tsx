/**
 * M1 facial movement. Four tasks, ~16 seconds total.
 *
 * The forehead raise is not optional padding. It is what separates a central palsy (which
 * spares the forehead) from a peripheral one (which does not) — without it this module
 * would raise a stroke-shaped alarm for a self-limiting Bell's palsy.
 *
 * Frames are landmarked as they arrive and thrown away. Nothing is encoded or stored.
 */
import { Camera, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { CaptureError, startFaceCapture, type FaceCaptureHandle } from "@/lib/capture";
import { useI18n, type StringKey } from "@/lib/i18n";
import { assessFaceQuality, extractFacialMotor, type FaceTask, type Landmark } from "@/lib/ondevice/face";
import { verifyAgainst, type IdentitySignature } from "@/lib/ondevice/identity";
import { speak } from "@/lib/speech-synthesis";
import type { ModuleFeatures } from "@/lib/types";
import { cn } from "@/lib/utils";

const TASKS: { task: FaceTask; label: StringKey; seconds: number }[] = [
  { task: "smile", label: "faceSmile", seconds: 4 },
  { task: "forehead_raise", label: "faceBrows", seconds: 4 },
  { task: "eye_closure", label: "faceEyes", seconds: 4 },
  { task: "cheek_puff", label: "faceCheeks", seconds: 4 },
];

interface Props {
  onDone: (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => void;
  /**
   * The enrolled signature, if this patient ever enrolled. M1 is the only module that
   * sees the face, so the same-person check rides along here rather than costing the
   * patient a separate capture.
   */
  identitySignature?: IdentitySignature | null;
  onIdentity?: (verdict: { score: number; verified: boolean; unenrolled: boolean }) => void;
  onError: (message: string) => void;
  onSkip: () => void;
}

export function StepFace({ onDone, onError, onSkip, identitySignature, onIdentity }: Props) {
  const { t, lang } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handleRef = useRef<FaceCaptureHandle | null>(null);
  const capturedRef = useRef<Partial<Record<FaceTask, Landmark[][]>>>({});
  const attemptedRef = useRef(0);

  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(-1);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => () => handleRef.current?.stop(), []);

  const finish = useCallback(() => {
    handleRef.current?.stop();
    const captured = capturedRef.current;
    const detected = Object.values(captured).reduce((n, f) => n + (f?.length ?? 0), 0);
    const quality = assessFaceQuality(
      Object.values(captured).flat() as Landmark[][],
      attemptedRef.current || detected,
    );
    // Same-person check on the frames already in hand — no extra capture, no new model.
    onIdentity?.(verifyAgainst(identitySignature, Object.values(captured).flat() as Landmark[][]));
    onDone(extractFacialMotor(captured), { ok: quality.ok, reason: quality.reason });
  }, [onDone, onIdentity, identitySignature]);

  // Drive the task sequence off a single countdown so the on-screen timer and the
  // capture window can never disagree.
  useEffect(() => {
    if (index < 0 || index >= TASKS.length) return;
    const current = TASKS[index];
    handleRef.current?.beginTask();
    speak(t(current.label), lang);
    setRemaining(current.seconds);

    const tick = window.setInterval(() => setRemaining((r) => r - 1), 1000);
    const done = window.setTimeout(() => {
      const frames = handleRef.current?.endTask() ?? [];
      attemptedRef.current += handleRef.current?.attempted ?? 0;
      capturedRef.current[current.task] = frames;
      if (index + 1 < TASKS.length) setIndex(index + 1);
      else finish();
    }, current.seconds * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  async function start() {
    if (!videoRef.current) return;
    try {
      handleRef.current = await startFaceCapture(videoRef.current);
      setStarted(true);
      setIndex(0);
    } catch (err) {
      onError(
        err instanceof CaptureError && err.kind === "permission"
          ? t("permissionDenied")
          : t("unsupportedBrowser"),
      );
    }
  }

  const current = index >= 0 && index < TASKS.length ? TASKS[index] : null;

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <h2 className="text-2xl font-semibold">{t("faceTitle")}</h2>

      {current && (
        <p className="text-2xl font-medium text-accent" aria-live="polite">
          {t(current.label)}
        </p>
      )}

      <div className="relative aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl border-2 border-border bg-secondary">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full scale-x-[-1] object-cover"
          aria-label={t("cameraPreview")}
        />
        {!started && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Camera className="h-16 w-16" aria-hidden />
          </div>
        )}
        {current && (
          <span className="absolute left-3 top-3 rounded-full bg-accent px-3 py-1 text-lg font-bold text-accent-foreground tabular-nums">
            {Math.max(0, remaining)}
          </span>
        )}
      </div>

      {started ? (
        <div className="flex items-center gap-2" aria-label="progress">
          {TASKS.map((task, i) => (
            <span
              key={task.task}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full border-2 text-xs",
                i < index && "border-stable bg-stable text-white",
                i === index && "border-accent bg-accent text-accent-foreground",
                i > index && "border-border text-muted-foreground",
              )}
            >
              {i < index ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
            </span>
          ))}
        </div>
      ) : (
        <Button size="touch" variant="accent" onClick={start}>
          <Camera className="h-7 w-7" aria-hidden />
          {t("begin")}
        </Button>
      )}

      {!started && (
        <Button variant="link" onClick={onSkip}>
          {t("skipStep")}
        </Button>
      )}
    </div>
  );
}
