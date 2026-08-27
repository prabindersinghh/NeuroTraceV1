/**
 * Browser capture helpers.
 *
 * Audio is captured through the Web Audio API and encoded to 16-bit PCM WAV in the
 * browser, NOT handed over as MediaRecorder's webm/opus. librosa reads WAV directly via
 * libsndfile; decoding webm/opus would need an ffmpeg binary on the server, which is one
 * more thing to break on a deploy. WAV costs a few hundred KB for a 10s clip — cheap.
 *
 * Video does use MediaRecorder (webm/vp8). OpenCV's bundled FFmpeg decodes that fine.
 */

export const AUDIO_SAMPLE_RATE = 16000; // matches SR in app/ml/speech.py

export function isCaptureSupported(): boolean {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext),
  );
}

export function isVideoRecordingSupported(): boolean {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined",
  );
}

export type CaptureFailureKind = "permission" | "unsupported" | "failed";

export class CaptureError extends Error {
  kind: CaptureFailureKind;

  constructor(kind: CaptureFailureKind, message: string) {
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

// --------------------------------------------------------------------------- WAV encoding
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

/** Duration of the mono 16-bit PCM WAV produced above, without decoding the audio. */
export function wavDurationSeconds(blob: Blob): number {
  const pcmBytes = Math.max(0, blob.size - 44);
  return pcmBytes / (AUDIO_SAMPLE_RATE * 2);
}

/** Downsample a Float32 buffer by simple averaging (anti-alias enough for speech features). */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export interface AudioRecorder {
  stop: () => Promise<Blob>;
  cancel: () => void;
  /** 0..1, for the level meter */
  level: () => number;
}

export async function startAudioRecording(): Promise<AudioRecorder> {
  if (!isCaptureSupported()) {
    throw new CaptureError("unsupported", "Web Audio is not available in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
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
    let localPeak = 0;
    for (let i = 0; i < input.length; i += 64) localPeak = Math.max(localPeak, Math.abs(input[i]));
    peak = localPeak;
  };

  source.connect(processor);
  // ScriptProcessor only runs when connected to a destination; a zero-gain node keeps it
  // silent so the patient does not hear themselves.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(ctx.destination);

  const teardown = () => {
    stopped = true;
    processor.onaudioprocess = null;
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
      return encodeWav(resample(merged, rate, AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE);
    },
  };
}

// --------------------------------------------------------------------------- video
export interface VideoRecorder {
  stream: MediaStream;
  stop: () => Promise<Blob>;
  cancel: () => void;
  mimeType: string;
}

function pickVideoMime(): string {
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
    "video/mp4",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return "";
}

export async function startVideoRecording(): Promise<VideoRecorder> {
  if (!isVideoRecordingSupported()) {
    throw new CaptureError("unsupported", "MediaRecorder is not available in this browser");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 }, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    throw classify(err);
  }

  const mimeType = pickVideoMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 800_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(200);

  const release = () => stream.getTracks().forEach((track) => track.stop());

  return {
    stream,
    mimeType: mimeType || "video/webm",
    cancel: () => {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      release();
    },
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
        };
        if (recorder.state !== "inactive") recorder.stop();
        else resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
      }),
  };
}
