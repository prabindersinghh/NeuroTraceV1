/**
 * M6 · pronator drift — arms out, palms up, eyes closed.
 *
 * PERFORMED SEATED. The protocol places this step in the standing block and the owner's
 * spec was flagged rather than silently rearranged (D-028) — but HOW the patient's body is
 * arranged is a safety call this component owns: the test is clinically valid seated, and
 * seated it stops being the session's peak fall-risk moment (eyes closed, arms out,
 * immediately after two other eyes-closed stances). The instruction says "sit".
 *
 * Full 33-point pose frames go to the server (`extract_pronator_drift`), which reads the
 * wrists RELATIVE to the shoulders — a drifting arm, not a swaying torso.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { startPoseStream, type LandmarkStream } from "@/lib/capture";
import type { PosePoint, PronatorRaw } from "@/lib/ondevice/pose";
import { useI18n } from "@/lib/i18n";

interface Props {
  seconds: number;
  onDone: (raw: PronatorRaw, quality: { ok: boolean; reason?: string }) => void;
  onError: (message: string) => void;
}

export function StepPronator({ seconds, onDone, onError }: Props) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<LandmarkStream | null>(null);
  const [inFrame, setInFrame] = useState(false);
  const [phase, setPhase] = useState<"position" | "capture">("position");
  const [remaining, setRemaining] = useState(seconds);

  const state = useRef({
    frames: [] as [number, number, number][][],
    lost: 0, total: 0, captureOn: false, done: false, streak: 0,
  });

  const finish = useCallback(() => {
    const st = state.current;
    if (st.done) return;
    st.done = true;
    const s = streamRef.current;
    const fps = s ? Math.round(s.fps() * 10) / 10 : 0;
    s?.stop();
    const lostFrac = st.total ? st.lost / st.total : 1;
    onDone(
      { frames: st.frames, fps },
      {
        ok: st.frames.length >= 10 && lostFrac < 0.4,
        reason: st.frames.length < 10 ? "person_not_detected" : lostFrac >= 0.4 ? "person_kept_leaving_frame" : undefined,
      },
    );
  }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        streamRef.current = await startPoseStream(video, (pts: PosePoint[] | null) => {
          const st = state.current;
          if (st.done) return;
          if (pts && pts.length >= 33) {
            st.streak += 1;
            if (st.captureOn) {
              st.total += 1;
              st.frames.push(pts.map((p) => [p.x, p.y, p.z] as [number, number, number]));
            }
          } else {
            st.streak = 0;
            if (st.captureOn) { st.total += 1; st.lost += 1; }
          }
          setInFrame(st.streak > 15);
        }, "user");
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; streamRef.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <p className="text-center text-lg font-medium">{t("pronatorSit")}</p>
      <div className={["relative overflow-hidden rounded-xl border-4", inFrame ? "border-accent" : "border-line"].join(" ")}>
        <video ref={videoRef} muted playsInline className="aspect-[3/4] w-full object-cover" />
        {phase === "capture" && (
          <span className="absolute right-3 top-3 rounded-lg bg-black/60 px-3 py-1 text-2xl font-semibold tabular-nums text-white">
            {remaining}
          </span>
        )}
      </div>
      {phase === "position" && (
        <button
          type="button" disabled={!inFrame} onClick={begin}
          className="min-h-16 w-full rounded-xl bg-accent text-lg font-medium text-accent-foreground disabled:opacity-40"
        >
          {t("start")}
        </button>
      )}
    </div>
  );
}

export default StepPronator;
