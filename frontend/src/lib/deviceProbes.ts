/**
 * Device probes shared by /diagnostics and onboarding calibration.
 *
 * The one honesty rule in here: `timing_source`. Frame counting uses
 * `requestVideoFrameCallback` (fires per DECODED FRAME) where it exists; the fallback is
 * `requestAnimationFrame`, which fires per display repaint — 60 Hz regardless of what the
 * camera delivers. A 30 fps camera measured with rAF reports 60, which is exactly the
 * wrong answer for deciding whether saccade velocity is usable. So every result carries
 * which clock produced it, and an rAF number is labelled untrustworthy rather than
 * silently reported. (Safari has had rvfc since 15.4; the fallback exists for older
 * WebKit and is honest about itself.)
 */

export interface FpsResult {
  requested: number;
  measured: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  /** Worst gap between frames — a mean hides dropped frames, the worst gap does not. */
  worstGapMs: number;
  /** Which clock counted frames. "raf" numbers are display rate, NOT camera rate. */
  timing_source: "rvfc" | "raf";
}

export async function measureFps(requestedFps: number, seconds = 6): Promise<FpsResult> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      frameRate: { ideal: requestedFps },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();

  const raw = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  }).requestVideoFrameCallback;
  const rvfc = typeof raw === "function" ? raw.bind(video) : undefined;
  const source: FpsResult["timing_source"] = rvfc ? "rvfc" : "raf";

  let frames = 0;
  let last = 0;
  let worstGapMs = 0;
  const started = performance.now();

  await new Promise<void>((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (last) worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
      frames += 1;
      if (now - started >= seconds * 1000) return resolve();
      if (rvfc) rvfc(tick);
      else requestAnimationFrame(tick);
    };
    if (rvfc) rvfc(tick);
    else requestAnimationFrame(tick);
  });

  const elapsed = (performance.now() - started) / 1000;
  stream.getTracks().forEach((t) => t.stop());

  return {
    requested: requestedFps,
    measured: Number((frames / elapsed).toFixed(1)),
    frames,
    seconds: Number(elapsed.toFixed(2)),
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    worstGapMs: Number(worstGapMs.toFixed(1)),
    timing_source: source,
  };
}

/** Without SIMD, MediaPipe falls back to a build several times slower. */
export function hasWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10,
        10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/** ~2s microphone level check. Returns peak 0..1, or null when the mic is unavailable. */
export async function probeMicLevel(): Promise<number | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const Ctx = window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        for (let i = 0; i < buf.length; i += 32) peak = Math.max(peak, Math.abs(buf[i]));
        if (performance.now() - t0 > 2000) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    return Number(peak.toFixed(3));
  } catch {
    return null;
  }
}
