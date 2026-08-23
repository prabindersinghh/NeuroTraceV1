/**
 * The face mesh, running for real, on the landing page.
 *
 * This is NOT a decorative graphic. It loads the SAME `FaceLandmarker` and the SAME
 * pinned model the daily check-in uses, runs it on a portrait, and draws the 468 landmarks
 * it actually returns. If the model failed to stage, or the browser cannot run the wasm,
 * this component shows nothing rather than a fake — a marketing page that draws a
 * pretend mesh is claiming a capability, and the whole product's argument is that we do
 * not claim capabilities we do not have.
 *
 * Two costs, both deliberate:
 *  - The model is ~4 MB. It loads ONLY when this section scrolls into view, so a visitor
 *    who never reaches it never pays for it.
 *  - "Use my camera" is opt-in and never automatic. Nothing is uploaded — the same
 *    on-device path as the exam; the frames are landmarked and dropped.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { loadFaceLandmarker, type Landmark } from "@/lib/ondevice/face";

type Mode = "idle" | "loading" | "still" | "live" | "unavailable";

/** A readable subset of the FaceMesh topology: the contours a clinician would recognise. */
const CONTOURS: number[][] = [
  // face oval
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
   152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  // lips (outer, then inner)
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78],
  // eyes
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
  // brows
  [70, 63, 105, 66, 107], [336, 296, 334, 293, 300],
  // nose
  [168, 6, 197, 195, 5, 4], [98, 97, 2, 326, 327],
];

export function FaceMeshShowcase({ src, className }: { src: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [count, setCount] = useState(0);
  const running = useRef(false);

  const draw = useCallback((pts: Landmark[], w: number, h: number, reveal = 1) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(46,119,208,0.85)";
    ctx.lineWidth = Math.max(1, w / 640);
    for (const contour of CONTOURS) {
      ctx.beginPath();
      contour.forEach((idx, i) => {
        const p = pts[idx];
        if (!p) return;
        const x = p.x * w, y = p.y * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    // Every landmark, faintly — the point is that there are 468 of them.
    const shown = Math.floor(pts.length * reveal);
    ctx.fillStyle = "rgba(46,119,208,0.55)";
    for (let i = 0; i < shown; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x * w, pts[i].y * h, Math.max(0.8, w / 900), 0, Math.PI * 2);
      ctx.fill();
    }
    setCount(pts.length);
  }, []);

  const runStill = useCallback(async () => {
    setMode("loading");
    try {
      const landmarker = await loadFaceLandmarker();
      const img = imgRef.current;
      if (!img) return;
      if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; });
      // IMAGE mode for a still; the exam uses VIDEO mode on a live stream.
      await landmarker.setOptions({ runningMode: "IMAGE" });
      const res = landmarker.detect(img);
      const pts = res.faceLandmarks?.[0] as Landmark[] | undefined;
      if (!pts?.length) { setMode("unavailable"); return; }
      setMode("still");
      // Animate the point cloud in — it reads as "being measured", which is what it is.
      let t = 0;
      const step = () => {
        t = Math.min(1, t + 0.04);
        draw(pts, img.naturalWidth, img.naturalHeight, t);
        if (t < 1) requestAnimationFrame(step);
      };
      step();
    } catch {
      // No model staged, no wasm, no SIMD — show the portrait alone rather than a fake.
      setMode("unavailable");
    }
  }, [draw]);

  // Lazy: nothing loads until the section is actually on screen.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mode !== "idle") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void runStill();
      }
    }, { rootMargin: "200px" });
    io.observe(host);
    return () => io.disconnect();
  }, [mode, runStill]);

  const startCamera = useCallback(async () => {
    try {
      setMode("loading");
      const landmarker = await loadFaceLandmarker();
      await landmarker.setOptions({ runningMode: "VIDEO" });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 } }, audio: false,
      });
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setMode("live");
      running.current = true;
      let last = -1;
      const loop = () => {
        if (!running.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        const ts = Math.max(performance.now(), last + 1);
        last = ts;
        try {
          const res = landmarker.detectForVideo(video, ts);
          const pts = res.faceLandmarks?.[0] as Landmark[] | undefined;
          if (pts?.length) draw(pts, video.videoWidth, video.videoHeight);
        } catch { /* a dropped frame is not an error worth showing */ }
        requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setMode("unavailable");
    }
  }, [draw]);

  useEffect(() => () => { running.current = false; }, []);

  return (
    <div ref={hostRef} className={className}>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-slate-100">
        <img
          ref={imgRef}
          src={src}
          alt=""
          crossOrigin="anonymous"
          className={mode === "live" ? "hidden" : "block w-full"}
        />
        <video
          ref={videoRef}
          muted playsInline
          className={mode === "live" ? "block w-full" : "hidden"}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {mode === "loading" && (
          <span className="absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-1 text-xs">
            Loading the on-device model…
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {mode === "still" || mode === "live" ? (
          <p className="text-sm text-muted-foreground">
            <strong className="tabular-nums">{count}</strong> landmarks, computed in this
            browser. No frame left the device.
          </p>
        ) : mode === "unavailable" ? (
          <p className="text-sm text-muted-foreground">
            The on-device model could not run in this browser, so no mesh is drawn — we do
            not fake it.
          </p>
        ) : null}

        {mode !== "live" && mode !== "unavailable" && (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-lg border border-line px-4 py-2 text-sm"
          >
            Use my camera
          </button>
        )}
        {mode === "live" && (
          <button
            type="button"
            onClick={() => { running.current = false; setMode("still"); void runStill(); }}
            className="rounded-lg border border-line px-4 py-2 text-sm"
          >
            Stop camera
          </button>
        )}
      </div>
    </div>
  );
}

export default FaceMeshShowcase;
