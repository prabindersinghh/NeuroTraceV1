/**
 * M3 · oculomotor tasks — the dot the eyes chase.
 *
 * Four protocol steps share this component: horizontal saccades, vertical saccades,
 * smooth pursuit, gaze holding. Each contributes into ONE shared `OculomotorRaw` that the
 * runner submits after the last of them — the server computes per-direction asymmetries,
 * and it needs all directions to do that.
 *
 * WHY THE PHONE IS HELD, NOT PROPPED, FOR THIS BLOCK
 * The face camera needs the eyes large in frame — iris landmarks on a face 1.5 m away are
 * noise. Arm's length is the design distance, and the framing check requires the face box
 * to fill enough of the frame before the task starts.
 *
 * CAPTURE HONESTY
 * `capture_fps` is the measured delivery rate, not the requested one, and rides along in
 * the raw payload — the server derives `velocity_confidence` from it and flags saccade
 * peak velocity as unusable below ~45 fps. Latency and left/right asymmetry survive low
 * fps; peak velocity does not, and the payload says which world this capture lives in.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { startFaceStream, type LandmarkStream } from "@/lib/capture";
import { gazeFromLandmarks, type OculomotorRaw, type SaccadeTrial } from "@/lib/ondevice/ocular";
import { Ring } from "@/components/journey/Ring";
import { useI18n } from "@/lib/i18n";

export type OcularTask =
  | "horizontal_saccades" | "vertical_saccades" | "smooth_pursuit" | "gaze_holding";

interface Props {
  task: OcularTask;
  seconds: number;
  /** Shared accumulator across the four M3 steps — owned by the runner. */
  raw: OculomotorRaw;
  onDone: (quality: { ok: boolean; reason?: string }) => void;
  onError: (message: string) => void;
}

/** Dot positions in normalised task-space (0..1). */
const CENTER: [number, number] = [0.5, 0.5];

export function StepOcular({ task, seconds, raw, onDone, onError }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<LandmarkStream | null>(null);
  const [running, setRunning] = useState(false);
  const [dot, setDot] = useState<[number, number]>(CENTER);
  const [remaining, setRemaining] = useState(seconds);

  // Mutable capture state, outside React so the per-frame callback stays cheap.
  const state = useRef({
    task,
    dot: CENTER as [number, number],
    frame: 0,
    lost: 0,
    total: 0,
    trial: null as SaccadeTrial | null,
    holding: [] as [number, number][],
    done: false,
  });
  state.current.task = task;

  const finish = useCallback(() => {
    if (state.current.done) return;
    state.current.done = true;
    if (state.current.trial) {
      raw.saccades.push(state.current.trial);
      state.current.trial = null;
    }
    if (task === "gaze_holding" && state.current.holding.length) {
      raw.gaze_holding = state.current.holding;
    }
    const s = streamRef.current;
    if (s) raw.fps = Math.max(raw.fps, Math.round(s.fps() * 10) / 10);
    s?.stop();
    const lostFrac = state.current.total ? state.current.lost / state.current.total : 1;
    onDone({
      ok: lostFrac < 0.3,
      reason: lostFrac >= 0.3 ? "face_kept_leaving_frame" : undefined,
    });
  }, [onDone, raw, task]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let mover: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        streamRef.current = await startFaceStream(video, (pts) => {
          const st = state.current;
          if (st.done) return;
          st.total += 1;
          st.frame += 1;
          const g = gazeFromLandmarks(pts);
          if (!g.ok) st.lost += 1;

          if (st.task === "smooth_pursuit") {
            raw.pursuit.push({ gaze: [g.x, g.y], target: [...st.dot] as [number, number] });
          } else if (st.task === "gaze_holding") {
            st.holding.push([g.x, g.y]);
          } else if (st.trial) {
            st.trial.gaze.push([g.x, g.y]);
          }
        });
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) { streamRef.current?.stop(); return; }
      setRunning(true);

      // ---- target choreography ----
      const horizontal = task === "horizontal_saccades";
      const vertical = task === "vertical_saccades";
      if (horizontal || vertical) {
        // A jump every ~1.6s, alternating around centre with jitter so it cannot be
        // anticipated — anticipatory saccades have negative latency and poison the mean.
        let side = 1;
        mover = setInterval(() => {
          const st = state.current;
          if (st.trial) raw.saccades.push(st.trial);
          side = -side;
          const target: [number, number] = horizontal
            ? [0.5 + side * 0.38, 0.5]
            : [0.5, 0.5 + side * 0.3];
          st.trial = {
            direction: horizontal ? (side > 0 ? "right" : "left") : (side > 0 ? "down" : "up"),
            target_onset_frame: st.frame,
            gaze: [],
            target,
          };
          st.dot = target;
          setDot(target);
        }, 1400 + Math.floor(Math.random() * 500));
      } else if (task === "smooth_pursuit") {
        // 0.3 Hz sinusoid — slow enough that a healthy eye tracks it with gain ~1.
        const t0 = performance.now();
        mover = setInterval(() => {
          const phase = ((performance.now() - t0) / 1000) * 0.3 * 2 * Math.PI;
          const target: [number, number] = [0.5 + 0.35 * Math.sin(phase), 0.5];
          state.current.dot = target;
          setDot(target);
        }, 33);
      } // gaze_holding: the dot stays at centre.

      timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (mover) clearInterval(mover);
      streamRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  // The capture closes when the countdown lands — in an effect, never inside the
  // updater, which runs during render and must not update the parent.
  useEffect(() => {
    if (running && remaining <= 0) finish();
  }, [running, remaining, finish]);

  return (
    <div className="relative flex min-h-[60vh] flex-col">
      {/* The camera preview is deliberately tiny: the patient must watch the LIGHT, and a
          big mirror image of their own face is the strongest possible distractor. */}
      <video
        ref={videoRef}
        muted playsInline
        className="absolute right-2 top-2 z-10 h-20 w-16 rounded-lg border border-slate-700 object-cover opacity-70"
      />
      {/* The dark room. The shell goes dark with it (JourneyShell `dark`), so the light
          is the only bright thing on the page. The glow is functional — it is what makes
          a small moving target visible at arm's length — and is the one shadow this
          product keeps on purpose. */}
      <div className="relative flex-1 rounded-2xl bg-slate-900">
        <div
          aria-hidden
          className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_4px_rgba(255,255,255,0.6)] transition-none"
          style={{ left: `${dot[0] * 100}%`, top: `${dot[1] * 100}%` }}
        />
      </div>
      <div className="mt-4 flex justify-center">
        {running
          ? <Ring seconds={seconds} remaining={remaining} size={64} overlay />
          : <p className="text-lg text-slate-300">{t("loading")}</p>}
      </div>
    </div>
  );
}

export default StepOcular;
