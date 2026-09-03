/**
 * Camera and microphone capture.
 *
 * The important property of this file: neither function ever produces a Blob, a File, a
 * data URL or anything else that could be uploaded. Audio comes back as Float32 PCM that
 * is fed straight to the DSP and dropped; video is never buffered at all — frames are
 * landmarked as they arrive and only the landmark arrays survive the frame.
 *
 * There is no MediaRecorder here. That is deliberate: a recorder produces an encoded file,
 * and a file is a thing that can be sent somewhere by mistake.
 */
import { FaceLandmarker } from "@mediapipe/tasks-vision";

import { loadFaceLandmarker, type Landmark } from "./ondevice/face";
import { resample, TARGET_SR } from "./ondevice/speech";

export class CaptureError extends Error {
  kind: "permission" | "unsupported" | "failed";

  constructor(kind: "permission" | "unsupported" | "failed", message: string) {
    super(message);
    this.name = "CaptureError";
    this.kind = kind;
  }
}

function classify(err: unknown): CaptureError {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new CaptureError("permission", "Permission denied");
  }
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
    return new CaptureError("unsupported", "No usable microphone or camera");
  }
  return new CaptureError("failed", (err as Error)?.message ?? "Capture failed");
}

export function isCaptureSupported(): boolean {
  return Boolean(
    typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext),
  );
}

/**
 * Last-resort hardware release.
 *
 * Every caller below already stops its tracks on unmount, and each one is right to. This
 * is the case none of them can see: the page itself going away — a back-navigation out of
 * the SPA, a closed tab, a phone suspending the page into the back/forward cache — while a
 * stream is still live. FaceMeshShowcase learned that one the expensive way (see its
 * `stop`), and the guard belongs where every camera and microphone in the exam is opened
 * rather than in whichever component remembers to write it.
 *
 * Deliberately `pagehide` and NOT `visibilitychange`: a measurement in progress must not be
 * killed because a notification shade came down for a second. `lib/recording.ts` does use
 * visibility, because the recordings there are user-driven and restartable.
 *
 * Returns the un-registration, which every teardown path calls, so a step opened and closed
 * a hundred times does not leave a hundred listeners behind.
 */
function releaseOnPageHide(stream: MediaStream): () => void {
  const release = () => stream.getTracks().forEach((t) => t.stop());
  window.addEventListener("pagehide", release);
  return () => window.removeEventListener("pagehide", release);
}

// --------------------------------------------------------------------------- audio
export interface AudioCapture {
  /** Stop and return the captured PCM, resampled to the rate the DSP expects. */
  stop: () => Promise<Float32Array>;
  cancel: () => void;
  /** 0..1 instantaneous level, for the meter that tells the patient we can hear them. */
  level: () => number;
}

export async function startAudioCapture(): Promise<AudioCapture> {
  if (!isCaptureSupported()) {
    throw new CaptureError("unsupported", "Web Audio is not available in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        // Both off on purpose: they are voice-comms features that reshape exactly the
        // spectral and amplitude properties we are trying to measure.
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (err) {
    throw classify(err);
  }

  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);

  const chunks: Float32Array[] = [];
  let peak = 0;
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    let local = 0;
    for (let i = 0; i < input.length; i += 64) local = Math.max(local, Math.abs(input[i]));
    peak = local;
  };

  source.connect(processor);
  // A ScriptProcessor only runs while connected to a destination; a zero-gain node keeps
  // it running without the patient hearing themselves.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(ctx.destination);

  const unwatch = releaseOnPageHide(stream);
  let torn = false;
  const teardown = () => {
    if (torn) return; // a `stop()` after the page-hide release must not close ctx twice
    torn = true;
    stopped = true;
    processor.onaudioprocess = null;
    unwatch();
    try {
      processor.disconnect();
      mute.disconnect();
      source.disconnect();
    } catch {
      /* already torn down */
    }
    stream.getTracks().forEach((track) => track.stop());
    void ctx.close();
  };

  return {
    level: () => peak,
    cancel: teardown,
    stop: async () => {
      const rate = ctx.sampleRate;
      teardown();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return resample(merged, rate, TARGET_SR);
    },
  };
}

// --------------------------------------------------------------------------- video
export interface FaceCaptureHandle {
  stream: MediaStream;
  /** Landmarks collected so far for the current task. */
  frames: Landmark[][];
  attempted: number;
  /** Begin collecting into a fresh buffer for the named task. */
  beginTask: () => void;
  /** Stop collecting and hand back this task's landmark frames. */
  endTask: () => Landmark[][];
  stop: () => void;
  /** True once the model is loaded and frames are being processed. */
  ready: () => boolean;
}

/**
 * Open the camera and landmark frames as they arrive.
 *
 * Frames are pulled with `requestVideoFrameCallback` where available so we process actual
 * decoded frames rather than guessing at a timer interval; on Safari it falls back to rAF.
 */
export async function startFaceCapture(video: HTMLVideoElement): Promise<FaceCaptureHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError("unsupported", "Camera is not available in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 20 },
        facingMode: "user",
      },
      audio: false,
    });
  } catch (err) {
    throw classify(err);
  }

  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const unwatch = releaseOnPageHide(stream);

  let landmarker: FaceLandmarker | null = null;
  try {
    landmarker = await loadFaceLandmarker();
  } catch {
    unwatch();
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("failed", "Could not load the on-device face model");
  }

  let collecting = false;
  let frames: Landmark[][] = [];
  let attempted = 0;
  let running = true;
  let lastTs = -1;

  const process = (nowMs: number) => {
    if (!running) return;
    if (collecting && video.readyState >= 2 && landmarker) {
      const ts = Math.max(nowMs, lastTs + 1);
      lastTs = ts;
      attempted += 1;
      try {
        const result = landmarker.detectForVideo(video, ts);
        const face = result.faceLandmarks?.[0];
        // Only the landmark array is kept. The frame itself is never copied anywhere.
        if (face?.length) frames.push(face.map((p) => ({ x: p.x, y: p.y, z: p.z })));
      } catch {
        /* a dropped frame is not an error worth surfacing */
      }
    }
    schedule();
  };

  const rvfc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  }).requestVideoFrameCallback?.bind(video);

  const schedule = () => {
    if (!running) return;
    if (rvfc) rvfc((now) => process(now));
    else requestAnimationFrame((now) => process(now));
  };
  schedule();

  return {
    stream,
    get frames() {
      return frames;
    },
    get attempted() {
      return attempted;
    },
    ready: () => landmarker !== null,
    beginTask: () => {
      frames = [];
      attempted = 0;
      collecting = true;
    },
    endTask: () => {
      collecting = false;
      return frames;
    },
    stop: () => {
      running = false;
      collecting = false;
      unwatch();
      video.srcObject = null;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// ------------------------------------------------------------------ live landmark streams
/**
 * Face landmarks delivered to a callback per frame, for tasks that pair each frame with
 * live UI state (M3 pairs gaze with where the target dot was AT THAT FRAME — a buffer
 * collected first and joined later cannot express that pairing).
 */
export interface LandmarkStream {
  stop: () => void;
  /** Measured delivery rate so far — the number the capture reports as `fps`. */
  fps: () => number;
}

export async function startFaceStream(
  video: HTMLVideoElement,
  onFrame: (pts: Landmark[] | null, tMs: number) => void,
): Promise<LandmarkStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError("unsupported", "Camera is not available in this browser");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    throw classify(err);
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const unwatch = releaseOnPageHide(stream);

  const landmarker = await loadFaceLandmarker().catch(() => {
    unwatch();
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("failed", "Could not load the on-device face model");
  });

  let running = true;
  let lastTs = -1;
  let frames = 0;
  const started = performance.now();

  const vrc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  }).requestVideoFrameCallback?.bind(video);

  const process = (nowMs: number) => {
    if (!running) return;
    if (video.readyState >= 2) {
      const ts = Math.max(nowMs, lastTs + 1);
      lastTs = ts;
      frames += 1;
      try {
        const res = landmarker.detectForVideo(video, ts);
        onFrame((res.faceLandmarks?.[0] as Landmark[] | undefined) ?? null, nowMs);
      } catch {
        onFrame(null, nowMs);
      }
    }
    if (vrc) vrc(process);
    else requestAnimationFrame((t) => process(t));
  };
  if (vrc) vrc(process);
  else requestAnimationFrame((t) => process(t));

  return {
    stop: () => {
      running = false;
      unwatch();
      stream.getTracks().forEach((t) => t.stop());
    },
    fps: () => frames / Math.max(0.001, (performance.now() - started) / 1000),
  };
}

/**
 * Pose landmarks per frame — the standing block and pronator drift. Uses the BACK camera
 * when available: the phone is propped facing the patient from ~1.5 m, and the rear lens
 * is the better one on every budget handset.
 */
export async function startPoseStream(
  video: HTMLVideoElement,
  onFrame: (pts: { x: number; y: number; z: number }[] | null, tMs: number) => void,
  facing: "user" | "environment" = "environment",
): Promise<LandmarkStream> {
  const { loadPoseLandmarker } = await import("./ondevice/pose");
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new CaptureError("unsupported", "Camera is not available in this browser");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: facing },
      audio: false,
    });
  } catch {
    // Laptops have no rear camera; the front one is the honest fallback.
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch((err) => {
      throw classify(err);
    });
  }
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  const unwatch = releaseOnPageHide(stream);

  const landmarker = await loadPoseLandmarker().catch(() => {
    unwatch();
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("failed", "Could not load the on-device pose model");
  });

  let running = true;
  let lastTs = -1;
  let frames = 0;
  const started = performance.now();

  const vrc = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  }).requestVideoFrameCallback?.bind(video);

  const process = (nowMs: number) => {
    if (!running) return;
    if (video.readyState >= 2) {
      const ts = Math.max(nowMs, lastTs + 1);
      lastTs = ts;
      frames += 1;
      try {
        const res = landmarker.detectForVideo(video, ts);
        onFrame(res.landmarks?.[0] ?? null, nowMs);
      } catch {
        onFrame(null, nowMs);
      }
    }
    if (vrc) vrc(process);
    else requestAnimationFrame((t) => process(t));
  };
  if (vrc) vrc(process);
  else requestAnimationFrame((t) => process(t));

  return {
    stop: () => {
      running = false;
      unwatch();
      stream.getTracks().forEach((t) => t.stop());
    },
    fps: () => frames / Math.max(0.001, (performance.now() - started) / 1000),
  };
}
