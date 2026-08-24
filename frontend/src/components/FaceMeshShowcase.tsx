/**
 * The face mesh on the landing page — the visitor's own face, or nothing.
 *
 * WHY THERE IS NO STOCK PORTRAIT HERE.
 * The obvious version of this component draws the mesh over a stock photo of a person. Two
 * problems, and the second is the serious one:
 *
 *  1. Stock portraits are studio shots of young Western models — not the 55-75 South Asian
 *     stroke survivors this product is for. The wrong face on the hero is a claim about who
 *     this is for.
 *  2. An identifiable real person's face under a medical-analysis overlay, on a page about
 *     stroke detection, reads as "this is a patient". The Unsplash licence covers the
 *     photograph; it does not grant that person's likeness for implying they have a
 *     neurological condition. Nobody photographed for a stock library consented to that.
 *
 * So the mesh runs on the VISITOR — opt-in, their camera, their choice — and until they
 * opt in, the panel shows a labelled SCHEMATIC that is obviously a diagram and never
 * pretends to be model output. The one thing this component must not do is draw a fake
 * mesh and call it a demo, on a page whose whole argument is that we do not claim
 * capabilities we do not have.
 *
 * The model (~4 MB) loads only when the visitor asks for the camera.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { loadFaceLandmarker, type Landmark } from "@/lib/ondevice/face";

type Mode = "schematic" | "loading" | "live" | "unavailable";

/** A readable subset of the FaceMesh topology: the contours a clinician would recognise. */
const CONTOURS: number[][] = [
  [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
    152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10],
  [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78],
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263],
  [70, 63, 105, 66, 107], [336, 296, 334, 293, 300],
  [168, 6, 197, 195, 5, 4], [98, 97, 2, 326, 327],
];

/**
 * The schematic. Hand-drawn geometry, labelled as a diagram — NOT landmarks from the
 * model, and never presented as such.
 */
function Schematic() {
  return (
    <svg viewBox="0 0 320 380" className="h-full w-full" role="img"
      aria-label="Diagram of the facial regions the examination measures">
      <g fill="none" stroke="currentColor" strokeWidth="1.25" className="text-accent/60">
        <ellipse cx="160" cy="190" rx="96" ry="126" />
        <path d="M84 150c14-12 40-12 54 0" /><path d="M182 150c14-12 40-12 54 0" />
        <ellipse cx="111" cy="176" rx="26" ry="14" /><ellipse cx="209" cy="176" rx="26" ry="14" />
        <path d="M160 168v58" /><path d="M136 232c14 8 34 8 48 0" />
        <path d="M112 268c26-16 70-16 96 0" /><path d="M112 268c26 20 70 20 96 0" />
        <path d="M64 190h192" strokeDasharray="3 7" className="text-accent/30" />
      </g>
      <g className="fill-current text-muted-foreground" fontSize="10" fontFamily="ui-monospace, monospace">
        <text x="14" y="146">BROW SYMMETRY</text>
        <text x="14" y="182">EYE APERTURE</text>
        <text x="14" y="274">MOUTH CORNER DROP</text>
        <text x="196" y="196">← LEFT / RIGHT</text>
      </g>
    </svg>
  );
}

export function FaceMeshShowcase({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [count, setCount] = useState(0);
  const running = useRef(false);

  const draw = useCallback((pts: Landmark[], w: number, h: number) => {
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
    ctx.fillStyle = "rgba(46,119,208,0.55)";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, Math.max(0.8, w / 900), 0, Math.PI * 2);
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

  /**
   * Release the camera SYNCHRONOUSLY.
   *
   * This used to live inside the rAF loop: the loop saw `running.current === false` and
   * stopped the tracks on its next tick. Two ways that leaves the camera on — the browser
   * stops firing rAF entirely when the tab is hidden or the element unmounts, so the
   * "next tick" may never come; and the early `if (!video) return` bailed out of
   * `startCamera` while still holding a live stream nobody had a reference to any more.
   * On a product whose whole argument is that nothing leaves the device, a camera that
   * stays awake after the user pressed stop is the worst possible bug to ship.
   */
  const stopCamera = useCallback(() => {
    running.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      setMode("loading");
      const landmarker = await loadFaceLandmarker();
      await landmarker.setOptions({ runningMode: "VIDEO" });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 } }, audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play();
      setMode("live");
      running.current = true;
      let last = -1;
      const loop = () => {
        if (!running.current) return;
        if (!running.current) return;
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
      stopCamera();
      setMode("unavailable");
    }
  }, [draw, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  return (
    <div ref={hostRef} className={className}>
      <div className="relative overflow-hidden rounded-2xl border border-line bg-slate-100">
        <img
          ref={imgRef}
          src={src}
          alt="A portrait with the face-landmark mesh drawn over it"
          width={760}
          height={1105}
          crossOrigin="anonymous"
          className={mode === "live" ? "hidden" : "block h-auto w-full"}
        />
        <video
          ref={videoRef}
          muted playsInline
          className={mode === "live" ? "h-full w-full object-cover" : "hidden"}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {mode === "loading" && (
          <span className="absolute bottom-3 left-3 rounded-lg bg-background/90 px-3 py-1 text-xs">
            Loading the on-device model…
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {mode === "live" ? (
          <>
            <p className="text-sm text-muted-foreground">
              <strong className="tabular-nums">{count}</strong> landmarks, computed in this
              browser. No frame left your device.
            </p>
            <button type="button" onClick={stop}
              className="rounded-lg border border-line px-4 py-2 text-sm">
              Stop camera
            </button>
          </>
        ) : mode === "unavailable" ? (
          <p className="text-sm text-muted-foreground">
            The model could not run in this browser, so no mesh is drawn — we do not fake it.
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
            onClick={() => { stopCamera(); setMode("still"); void runStill(); }}
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
