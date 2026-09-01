/**
 * M9 · the standing block — Romberg (eyes open / closed) and tandem stance.
 *
 * THE ONE RULE: these tasks run ONLY behind the fall-risk gate, with a carer confirmed to
 * be standing next to the patient. The runner enforces that ordering; this component
 * additionally refuses to start until the whole body is in frame, because a capture of
 * half a person produces sway numbers that look plausible and mean nothing.
 *
 * The phone is propped ~1.5 m away (rear camera preferred). Head centroid per frame goes
 * into the shared `BalanceRaw`; the SERVER converts to centimetres via bitemporal width
 * and computes sway path/area — the same code path the test suite pins, and the same
 * numbers `CcgTrace` draws.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { startPoseStream, type LandmarkStream } from "@/lib/capture";
import { headCentroid, headWidthNorm, type BalanceRaw, type PosePoint } from "@/lib/ondevice/pose";
import { Ring } from "@/components/journey/Ring";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export type BalanceTask = "romberg_eyes_open" | "romberg_eyes_closed" | "tandem_stance";

interface Props {
  task: BalanceTask;
  seconds: number;
  raw: BalanceRaw;
  onDone: (quality: { ok: boolean; reason?: string }) => void;
  onError: (message: string) => void;
}

export function StepBalance({ task, seconds, raw, onDone, onError }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<LandmarkStream | null>(null);
  const [inFrame, setInFrame] = useState(false);
  const [phase, setPhase] = useState<"position" | "capture">("position");
  const [remaining, setRemaining] = useState(seconds);

  const state = useRef({
    points: [] as [number, number][],
    widths: [] as number[],
    lost: 0,
    total: 0,
    captureOn: false,
    done: false,
    visibleStreak: 0,
  });

  const finish = useCallback(() => {
    const st = state.current;
    if (st.done) return;
    st.done = true;
    raw.tests[task] = st.points;
    if (st.widths.length) {
      const sorted = [...st.widths].sort((a, b) => a - b);
      raw.head_width_norm = sorted[Math.floor(sorted.length / 2)];
    }
    const s = streamRef.current;
    if (s) raw.fps = Math.max(raw.fps, Math.round(s.fps() * 10) / 10);
    s?.stop();
    const lostFrac = st.total ? st.lost / st.total : 1;
    onDone({
      ok: st.points.length >= 20 && lostFrac < 0.4,
      reason: st.points.length < 20 ? "person_not_detected" : lostFrac >= 0.4 ? "person_kept_leaving_frame" : undefined,
    });
  }, [onDone, raw, task]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        streamRef.current = await startPoseStream(video, (pts: PosePoint[] | null) => {
          const st = state.current;
          if (st.done) return;
          if (pts && pts.length >= 33) {
            st.visibleStreak += 1;
            const c = headCentroid(pts);
            if (st.captureOn) {
              st.total += 1;
              if (c) {
                st.points.push(c);
                st.widths.push(headWidthNorm(pts));
              } else st.lost += 1;
            }
          } else {
            st.visibleStreak = 0;
            if (st.captureOn) { st.total += 1; st.lost += 1; }
          }
          // ~1s of continuous visibility lights the framing outline (border-accent).
          setInFrame(st.visibleStreak > 20);
        });
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const begin = useCallback(() => {
    state.current.captureOn = true;
    setPhase("capture");
    const timer = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(timer); finish(); return 0; }
        return r - 1;
      });
    }, 1000);
  }, [finish]);

  return (
    <div className="flex flex-col gap-3">
      <div className={[
        "relative overflow-hidden rounded-xl border-4",
        inFrame ? "border-accent" : "border-line",
      ].join(" ")}>
        <video ref={videoRef} muted playsInline className="aspect-[3/4] w-full object-cover" />
        {phase === "capture" && (
          <Ring seconds={seconds} remaining={remaining} size={64} overlay className="absolute right-3 top-3" />
        )}
      </div>
      {phase === "position" ? (
        <>
          <p className="text-center text-lg" aria-live="polite">
            {inFrame ? t("balanceReady") : t("balanceFraming")}
          </p>
          <Button size="touch" variant="accent" disabled={!inFrame} onClick={begin}>
            {t("start")}
          </Button>
        </>
      ) : (
        <p className="text-center text-lg">{t("holdStill")}</p>
      )}
    </div>
  );
}

export default StepBalance;
