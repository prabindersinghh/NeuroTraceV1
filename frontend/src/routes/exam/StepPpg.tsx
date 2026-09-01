/**
 * M17 · heart rhythm from a fingertip over the camera.
 *
 * One number per frame — red-weighted mean brightness — is the whole capture. Beat
 * detection and rhythm features run on the server (`extract_rhythm`), the implementation
 * the synthetic AF fixtures pin.
 *
 * TORCH IS OPTIONAL, AND ITS ABSENCE IS A FACT, NOT A FAILURE. Android Chrome can light
 * the flash through `applyConstraints`; iOS Safari has no torch API at all. Without it
 * the capture still works with ambient light through the finger; `torch_available` rides
 * in the quality detail so the analyst knows which kind of signal this was.
 *
 * Capture refuses to start until the lens actually looks covered (red-dominant, dim) —
 * sixty seconds of somebody's ceiling produces beautiful nonsense.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { frameStats, looksCovered, tryEnableTorch, type PpgRaw } from "@/lib/ondevice/ppg";
import { Ring } from "@/components/journey/Ring";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Props {
  seconds: number;
  onDone: (raw: PpgRaw, quality: { ok: boolean; reason?: string }, detail: Record<string, unknown>) => void;
  onError: (message: string) => void;
}

export function StepPpg({ seconds, onDone, onError }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [covered, setCovered] = useState(false);
  const [phase, setPhase] = useState<"cover" | "capture">("cover");
  const [remaining, setRemaining] = useState(seconds);

  const state = useRef({
    samples: [] as number[],
    t0: 0, torch: false, captureOn: false, done: false, coveredStreak: 0,
    stream: null as MediaStream | null, raf: 0,
  });

  const finish = useCallback(() => {
    const st = state.current;
    if (st.done) return;
    st.done = true;
    cancelAnimationFrame(st.raf);
    st.stream?.getTracks().forEach((tr) => tr.stop());
    const secondsCaptured = (performance.now() - st.t0) / 1000;
    const fs = st.samples.length / Math.max(0.5, secondsCaptured);
    onDone(
      { ppg: st.samples.map((v) => Math.round(v * 100) / 100), fs: Math.round(fs * 100) / 100 },
      {
        ok: st.samples.length > fs * (seconds * 0.7),
        reason: st.samples.length <= fs * (seconds * 0.7) ? "finger_moved_off_lens" : undefined,
      },
      { torch_available: st.torch, sample_rate_hz: Math.round(fs * 10) / 10 },
    );
  }, [onDone, seconds]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      let stream: MediaStream;
      try {
        // Rear camera: that is where the flash is, and where a finger naturally rests.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch (e) {
          if (!cancelled) onError(e instanceof Error ? e.message : String(e));
          return;
        }
      }
      if (cancelled) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      state.current.stream = stream;
      state.current.torch = await tryEnableTorch(stream.getVideoTracks()[0]);
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 48;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        const st = state.current;
        if (st.done) return;
        if (ctx && video.readyState >= 2) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const stats = frameStats(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
          const cov = looksCovered(stats);
          st.coveredStreak = cov ? st.coveredStreak + 1 : 0;
          setCovered(st.coveredStreak > 10);
          if (st.captureOn) st.samples.push(stats.value);
        }
        st.raf = requestAnimationFrame(tick);
      };
      state.current.raf = requestAnimationFrame(tick);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(state.current.raf);
      state.current.stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = useCallback(() => {
    state.current.captureOn = true;
    state.current.t0 = performance.now();
    setPhase("capture");
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(timer); finish(); return 0; }
        return r - 1;
      });
    }, 1000);
  }, [finish]);

  return (
    <div className="flex flex-col items-center gap-4">
      <video
        ref={videoRef} muted playsInline
        className={[
          "h-28 w-36 rounded-xl border-4 object-cover transition-colors duration-300",
          covered ? "border-accent" : "border-line",
        ].join(" ")}
      />
      {phase === "cover" ? (
        <>
          <p className="text-center text-lg" aria-live="polite">{covered ? t("ppgReady") : t("ppgCover")}</p>
          <Button size="touch" variant="accent" disabled={!covered} onClick={begin}>
            {t("start")}
          </Button>
        </>
      ) : (
        <>
          <Ring seconds={seconds} remaining={remaining} size={112} />
          <p className="text-center text-lg text-muted-foreground">{t("ppgHold")}</p>
        </>
      )}
    </div>
  );
}

export default StepPpg;
