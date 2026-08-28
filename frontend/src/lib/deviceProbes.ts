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

// --------------------------------------------------------------------- Part 7.1
/**
 * What a model actually costs on THIS device, and whether it actually sees anybody.
 *
 * Init time and detection rate are the two numbers that decide whether a module is usable
 * on a given handset, and neither can be read off a spec sheet. A phone that loads
 * FaceMesh in 400 ms and one that takes 9 s are different products to the person holding
 * them; a phone that loads it fine and then detects a face in 30% of frames produces
 * measurements nobody should trust.
 *
 * `detectionRate` is the honest half. A model can initialise perfectly and still fail to
 * find the subject — bad light, bad framing, a lens the user's thumb is over — and without
 * this number a field tester reports "the model loaded" and moves on.
 */
export interface ModelProbe {
  model: "face" | "pose";
  /** Milliseconds from call to a usable landmarker, including WASM fetch on a cold cache. */
  initMs: number | null;
  /** Fraction of sampled frames in which the subject was found. null when no camera ran. */
  detectionRate: number | null;
  framesSampled: number;
  /** Median milliseconds per detect() call — the per-frame cost during a real task. */
  medianDetectMs: number | null;
  error: string | null;
}

async function probeModel(
  model: ModelProbe["model"],
  stream: MediaStream | null,
  frames = 30,
): Promise<ModelProbe> {
  const out: ModelProbe = {
    model, initMs: null, detectionRate: null, framesSampled: 0,
    medianDetectMs: null, error: null,
  };
  try {
    const startedAt = performance.now();
    const landmarker = model === "face"
      ? await (await import("./ondevice/face")).loadFaceLandmarker()
      : await (await import("./ondevice/pose")).loadPoseLandmarker();
    out.initMs = Math.round(performance.now() - startedAt);

    if (!stream) return out;

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    const costs: number[] = [];
    let found = 0;
    for (let i = 0; i < frames; i += 1) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const t0 = performance.now();
      // `detectForVideo` needs a monotonically increasing timestamp; performance.now() is.
      const result = landmarker.detectForVideo(video, performance.now()) as {
        faceLandmarks?: unknown[]; landmarks?: unknown[];
      };
      costs.push(performance.now() - t0);
      const points = result.faceLandmarks ?? result.landmarks ?? [];
      if (points.length > 0) found += 1;
      out.framesSampled += 1;
    }
    video.pause();
    out.detectionRate = out.framesSampled ? found / out.framesSampled : null;
    costs.sort((a, b) => a - b);
    out.medianDetectMs = costs.length
      ? Math.round(costs[Math.floor(costs.length / 2)])
      : null;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/**
 * Init + detection rate for both models, sharing one camera stream.
 *
 * Shares the stream deliberately: opening the camera twice on a mid-range Android often
 * fails outright, and the failure would look like a model problem rather than a camera one.
 */
export async function probeModels(frames = 30): Promise<ModelProbe[]> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch {
    // No camera, or permission denied. Init time is still worth measuring on its own —
    // it is the number that decides whether the app feels broken on a slow handset.
    stream = null;
  }
  try {
    return [
      await probeModel("face", stream, frames),
      await probeModel("pose", stream, frames),
    ];
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

/**
 * Browser and OS as a plain string, from UA-CH where available and the UA string otherwise.
 *
 * Deliberately coarse. This is for "which devices did we test on", not fingerprinting, and
 * the diagnostics payload is meant to be pasteable into an email without carrying anything
 * that identifies a person.
 */
export function describePlatform(): { browser: string; os: string; mobile: boolean } {
  const nav = navigator as Navigator & {
    userAgentData?: {
      brands?: { brand: string; version: string }[];
      platform?: string;
      mobile?: boolean;
    };
  };
  const data = nav.userAgentData;
  if (data?.brands?.length) {
    const real = data.brands.find(
      (b) => !/not.a.brand/i.test(b.brand),
    ) ?? data.brands[0];
    return {
      browser: `${real.brand} ${real.version}`,
      os: data.platform || "unknown",
      mobile: Boolean(data.mobile),
    };
  }
  const ua = navigator.userAgent;
  const browser =
    /Edg\/([\d.]+)/.exec(ua) ? `Edge ${/Edg\/([\d.]+)/.exec(ua)![1]}` :
    /Chrome\/([\d.]+)/.exec(ua) ? `Chrome ${/Chrome\/([\d.]+)/.exec(ua)![1]}` :
    /Firefox\/([\d.]+)/.exec(ua) ? `Firefox ${/Firefox\/([\d.]+)/.exec(ua)![1]}` :
    /Version\/([\d.]+).*Safari/.exec(ua) ? `Safari ${/Version\/([\d.]+).*Safari/.exec(ua)![1]}` :
    "unknown";
  const os =
    /Android ([\d.]+)/.exec(ua) ? `Android ${/Android ([\d.]+)/.exec(ua)![1]}` :
    /iPhone OS ([\d_]+)/.exec(ua) ? `iOS ${/iPhone OS ([\d_]+)/.exec(ua)![1].replace(/_/g, ".")}` :
    /Windows NT ([\d.]+)/.exec(ua) ? `Windows NT ${/Windows NT ([\d.]+)/.exec(ua)![1]}` :
    /Mac OS X ([\d_]+)/.exec(ua) ? `macOS ${/Mac OS X ([\d_]+)/.exec(ua)![1].replace(/_/g, ".")}` :
    /Linux/.test(ua) ? "Linux" : "unknown";
  return { browser, os, mobile: /Mobi|Android/i.test(ua) };
}
