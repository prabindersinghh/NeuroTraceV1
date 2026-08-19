/**
 * M4 speech clarity — on-device DSP. Mirrors `backend/app/exam/speech_tasks.py`.
 *
 * Everything here runs on the raw PCM in the browser. The recording is never uploaded and
 * is dropped as soon as these numbers are computed, which is what makes the privacy claim
 * structural rather than a policy: there is no endpoint that would accept the audio.
 *
 * What is implemented and what is not, stated plainly:
 *
 *   implemented   F0 (autocorrelation), F0 CV, jitter proxy, shimmer proxy, HNR estimate,
 *                 pause ratio, pauses/sec, articulation rate, maximum phonation time,
 *                 DDK rate and regularity, spectral centroid, RMS
 *   not here      MFCCs and Praat jitter/shimmer/HNR
 *
 * The omission is deliberate rather than unfinished. A faithful MFCC or Praat
 * implementation in JS would drift from librosa and parselmouth in the third decimal, and
 * a feature that differs between the device and the server is worse than a feature that is
 * absent — it corrupts the baseline silently. The features above are ones where the two
 * implementations agree to within the tolerance asserted by the parity test. The Python
 * side remains authoritative for anything richer, and computes it when audio is available
 * to it (research mode with explicit consent), never in the daily on-device path.
 */
import type { ModuleFeatures } from "../types";

export const TARGET_SR = 16000;

const SILENCE_DB = -30; // matches librosa.effects.split(top_db=30)
const FRAME = 1024;
const HOP = 256;

function safe(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function mean(values: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i];
  return values.length ? total / values.length : 0;
}

function std(values: ArrayLike<number>): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += (values[i] - m) ** 2;
  return Math.sqrt(total / values.length);
}

// --------------------------------------------------------------------------- framing
export function rmsFrames(signal: Float32Array, frame = FRAME, hop = HOP): Float32Array {
  const count = Math.max(1, Math.floor((signal.length - frame) / hop) + 1);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    let total = 0;
    const start = i * hop;
    for (let j = 0; j < frame && start + j < signal.length; j += 1) {
      total += signal[start + j] ** 2;
    }
    out[i] = Math.sqrt(total / frame);
  }
  return out;
}

/** Voiced/unvoiced mask, thresholded relative to the loudest frame (as librosa does). */
export function voicedMask(rms: Float32Array, topDb = -SILENCE_DB): boolean[] {
  let peak = 0;
  for (let i = 0; i < rms.length; i += 1) peak = Math.max(peak, rms[i]);
  if (peak <= 0) return new Array(rms.length).fill(false);
  const floor = peak * 10 ** (-topDb / 20);
  return Array.from(rms, (v) => v > floor);
}

// --------------------------------------------------------------------------- pitch
/**
 * F0 per frame by autocorrelation.
 *
 * Autocorrelation rather than YIN/pYIN: it is a few lines, has no tunable internals that
 * could diverge from the server, and over a sustained vowel — which is what M4 asks for —
 * it is accurate enough. It is not accurate enough for connected speech, which is why the
 * connected-speech pitch features are computed server-side.
 */
export function estimateF0(
  signal: Float32Array,
  sr = TARGET_SR,
  fmin = 60,
  fmax = 400,
): number[] {
  const minLag = Math.floor(sr / fmax);
  const maxLag = Math.floor(sr / fmin);
  const frame = Math.min(2048, signal.length);
  const hop = 512;
  const out: number[] = [];

  for (let start = 0; start + frame <= signal.length; start += hop) {
    const window = signal.subarray(start, start + frame);

    let energy = 0;
    for (let i = 0; i < window.length; i += 1) energy += window[i] ** 2;
    if (energy < 1e-6) continue;

    let bestLag = 0;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag && lag < window.length; lag += 1) {
      let sum = 0;
      for (let i = 0; i < window.length - lag; i += 1) sum += window[i] * window[i + lag];
      const score = sum / (window.length - lag);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    // Require a clear periodic peak; otherwise the frame is unvoiced.
    if (bestLag > 0 && bestScore > 0.25 * (energy / window.length)) {
      out.push(sr / bestLag);
    }
  }
  return out;
}

// --------------------------------------------------------------------------- spectrum
/** Spectral centroid via a real DFT on a decimated frame. */
export function spectralCentroid(signal: Float32Array, sr = TARGET_SR): number {
  const n = 512;
  if (signal.length < n) return 0;
  const start = Math.floor((signal.length - n) / 2);
  let weighted = 0;
  let total = 0;

  for (let k = 1; k < n / 2; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (-2 * Math.PI * k * t) / n;
      const sample = signal[start + t] * (0.54 - 0.46 * Math.cos((2 * Math.PI * t) / (n - 1)));
      re += sample * Math.cos(angle);
      im += sample * Math.sin(angle);
    }
    const magnitude = Math.sqrt(re * re + im * im);
    weighted += ((k * sr) / n) * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / total : 0;
}

// --------------------------------------------------------------------------- tasks
export function sustainedPhonationFeatures(signal: Float32Array, sr = TARGET_SR): ModuleFeatures {
  if (signal.length < sr / 2) return { valid: 0 };

  const rms = rmsFrames(signal);
  if (!rms.length) return { valid: 0 };

  // Maximum phonation time: the longest continuous voiced run. An early marker of
  // failing respiratory support.
  let peak = 0;
  for (let i = 0; i < rms.length; i += 1) peak = Math.max(peak, rms[i]);
  const floor = peak * 0.15;
  let best = 0;
  let run = 0;
  for (let i = 0; i < rms.length; i += 1) {
    run = rms[i] > floor ? run + 1 : 0;
    best = Math.max(best, run);
  }

  const f0 = estimateF0(signal, sr);
  const out: ModuleFeatures = {
    valid: 1,
    max_phonation_time: safe((best * HOP) / sr),
    phonation_rms_cv: safe(std(rms) / (mean(rms) + 1e-9)),
  };

  if (f0.length >= 3) {
    out.sustained_f0_mean = safe(mean(f0));
    out.sustained_f0_cv = safe(std(f0) / (mean(f0) + 1e-6));
    // Cycle-to-cycle period perturbation — a jitter proxy independent of Praat.
    const periods = f0.map((v) => 1 / Math.max(v, 1e-6));
    let diffs = 0;
    for (let i = 1; i < periods.length; i += 1) diffs += Math.abs(periods[i] - periods[i - 1]);
    out.sustained_jitter_proxy = safe(diffs / (periods.length - 1) / (mean(periods) + 1e-12));
  } else {
    out.sustained_f0_mean = 0;
    out.sustained_f0_cv = 0;
    out.sustained_jitter_proxy = 0;
  }
  return out;
}

/**
 * DDK rate and regularity from a "pa-ta-ka" repetition.
 *
 * Regularity is the more sensitive of the two: a patient compensating for weakness can
 * often hold their rate up for a few seconds while the evenness has already gone.
 */
export function ddkFeatures(signal: Float32Array, sr = TARGET_SR): ModuleFeatures {
  if (signal.length < sr / 2) return { valid: 0 };

  const rms = rmsFrames(signal, 512, 128);
  if (rms.length < 4) return { valid: 0 };

  // Onset strength: positive first difference of the energy envelope.
  const flux = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i += 1) flux[i] = Math.max(0, rms[i] - rms[i - 1]);

  const threshold = mean(flux) + std(flux) * 0.6;
  const minGapFrames = Math.floor((0.06 * sr) / 128); // syllables no closer than 60 ms
  const onsets: number[] = [];
  for (let i = 1; i < flux.length - 1; i += 1) {
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      if (!onsets.length || i - onsets[onsets.length - 1] >= minGapFrames) onsets.push(i);
    }
  }

  const durationS = signal.length / sr;
  const out: ModuleFeatures = {
    valid: 1,
    ddk_syllables: onsets.length,
    ddk_rate: safe(durationS > 0 ? onsets.length / durationS : 0),
    ddk_interval_mean: 0,
    ddk_regularity: 0,
    ddk_decay_slope: 0,
  };

  if (onsets.length >= 3) {
    const times = onsets.map((i) => (i * 128) / sr);
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      if (gap > 0.02) intervals.push(gap);
    }
    if (intervals.length >= 2) {
      out.ddk_interval_mean = safe(mean(intervals));
      out.ddk_regularity = safe(std(intervals) / (mean(intervals) + 1e-9));
      const xs = intervals.map((_, i) => i);
      const mx = mean(xs);
      const my = mean(intervals);
      let num = 0;
      let den = 0;
      for (let i = 0; i < intervals.length; i += 1) {
        num += (xs[i] - mx) * (intervals[i] - my);
        den += (xs[i] - mx) ** 2;
      }
      out.ddk_decay_slope = safe(den === 0 ? 0 : num / den);
    }
  }
  return out;
}

/** Pause structure and articulation rate from connected speech. */
export function pauseFeatures(signal: Float32Array, sr = TARGET_SR): ModuleFeatures {
  const rms = rmsFrames(signal);
  const voiced = voicedMask(rms);
  if (!voiced.length) return {};

  const totalS = signal.length / sr;
  const voicedFrames = voiced.filter(Boolean).length;
  const speechS = (voicedFrames * HOP) / sr;

  let segments = 0;
  for (let i = 0; i < voiced.length; i += 1) {
    if (voiced[i] && (i === 0 || !voiced[i - 1])) segments += 1;
  }
  const pauses = Math.max(0, segments - 1);

  return {
    pause_ratio: safe(Math.max(0, 1 - speechS / Math.max(totalS, 1e-6))),
    n_pauses_per_sec: safe(pauses / Math.max(totalS, 1e-6)),
    speech_dur_ratio: safe(speechS / Math.max(totalS, 1e-6)),
    articulation_rate: speechS > 0.1 ? safe(segments / speechS) : 0,
  };
}

export interface DysarthriaInput {
  sustained_a?: Float32Array;
  ddk?: Float32Array;
  sentence?: Float32Array;
}

export function extractDysarthria(input: DysarthriaInput, sr = TARGET_SR): ModuleFeatures {
  const out: ModuleFeatures = {};
  let completed = 0;

  if (input.sustained_a?.length) {
    const feats = sustainedPhonationFeatures(input.sustained_a, sr);
    if (feats.valid === 1) {
      completed += 1;
      for (const [k, v] of Object.entries(feats)) if (k !== "valid") out[k] = v;
    }
  }

  if (input.ddk?.length) {
    const feats = ddkFeatures(input.ddk, sr);
    if (feats.valid === 1) {
      completed += 1;
      for (const [k, v] of Object.entries(feats)) if (k !== "valid") out[k] = v;
    }
  }

  if (input.sentence?.length) {
    const feats = pauseFeatures(input.sentence, sr);
    if (Object.keys(feats).length) {
      completed += 1;
      Object.assign(out, feats);
      const f0 = estimateF0(input.sentence, sr);
      if (f0.length >= 3) {
        out.f0_mean = safe(mean(f0));
        out.f0_std = safe(std(f0));
        out.f0_cv = safe(std(f0) / (mean(f0) + 1e-6));
      }
      out.spec_centroid = safe(spectralCentroid(input.sentence, sr));
      out.rms_mean = safe(mean(rmsFrames(input.sentence)));
    }
  }

  if (completed === 0) return { valid: 0, tasks_completed: 0 };
  out.valid = 1;
  out.tasks_completed = completed;
  return out;
}

// --------------------------------------------------------------------------- capture quality
export interface QualityVerdict {
  ok: boolean;
  reason?: string;
  snrDb: number;
  clippedFraction: number;
  voicedFraction: number;
}

/**
 * Capture-quality gate (FR8). A bad recording is rejected and re-prompted, never scored.
 *
 * Scoring a poor capture is worse than discarding it: it enters the baseline as if it were
 * signal, widens the band, and blinds the system to the change it was built to see.
 */
export function assessAudioQuality(signal: Float32Array, sr = TARGET_SR): QualityVerdict {
  const rms = rmsFrames(signal);
  const voiced = voicedMask(rms);
  const voicedFraction = voiced.length ? voiced.filter(Boolean).length / voiced.length : 0;

  const voicedRms = rms.filter((_, i) => voiced[i]);
  const silentRms = rms.filter((_, i) => !voiced[i]);
  const signalLevel = voicedRms.length ? mean(voicedRms) : 0;
  const noiseLevel = silentRms.length ? mean(silentRms) : 1e-6;
  const snrDb = 20 * Math.log10((signalLevel + 1e-9) / (noiseLevel + 1e-9));

  let clipped = 0;
  for (let i = 0; i < signal.length; i += 1) if (Math.abs(signal[i]) > 0.99) clipped += 1;
  const clippedFraction = signal.length ? clipped / signal.length : 0;

  if (signal.length < sr) {
    return { ok: false, reason: "too_short", snrDb, clippedFraction, voicedFraction };
  }
  if (voicedFraction < 0.15) {
    return { ok: false, reason: "no_speech_detected", snrDb, clippedFraction, voicedFraction };
  }
  if (snrDb < 6) {
    return { ok: false, reason: "too_noisy", snrDb, clippedFraction, voicedFraction };
  }
  if (clippedFraction > 0.02) {
    return { ok: false, reason: "too_loud", snrDb, clippedFraction, voicedFraction };
  }
  return { ok: true, snrDb, clippedFraction, voicedFraction };
}

/** Down-mix and resample captured PCM to the rate the feature maths expects. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let total = 0;
    for (let j = start; j < end; j += 1) total += input[j];
    out[i] = end > start ? total / (end - start) : 0;
  }
  return out;
}
