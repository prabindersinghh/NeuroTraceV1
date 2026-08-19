/**
 * M7 fine motor — on-device mirror of `backend/app/exam/motor.py`.
 *
 * This file and its Python counterpart must produce the same numbers for the same input.
 * `src/lib/ondevice/__tests__/parity.test.ts` pins them together against shared fixtures;
 * if the two drift, a patient's baseline (computed from whichever side ran that day) stops
 * being comparable to their later sessions, which silently corrupts every z-score after.
 *
 * The headline feature is `tap_asymmetry_ratio`. Bilateral slowing is Parkinson's or
 * ordinary ageing; unilateral slowing is a corticospinal lesion. Rate alone cannot tell
 * them apart — see `app/ml/train/asymmetry_discriminator.py`.
 */
import type { ModuleFeatures } from "../types";

const MIN_INTERVAL_MS = 20; // discard double-registrations from a bouncing touch event

function safe(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Least-squares slope of y against its index. Mirrors numpy.polyfit(x, y, 1)[0]. */
export function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const mx = mean(xs);
  const my = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (values[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/** |L - R| / (L + R). Scale-free, zero when the sides match. */
export function asymmetryRatio(left: number, right: number): number {
  return Math.abs(left - right) / (Math.abs(left) + Math.abs(right) + 1e-9);
}

export function tapFeatures(timestampsMs: number[], suffix: "L" | "R"): ModuleFeatures {
  const ts = [...timestampsMs].filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (ts.length < 4) return {};

  const intervals: number[] = [];
  for (let i = 1; i < ts.length; i += 1) {
    const gap = ts[i] - ts[i - 1];
    if (gap > MIN_INTERVAL_MS) intervals.push(gap);
  }
  if (intervals.length < 3) return {};

  const durationS = (ts[ts.length - 1] - ts[0]) / 1000;
  const rate = durationS > 0 ? ts.length / durationS : 0;
  const meanIti = mean(intervals);

  return {
    [`tap_rate_${suffix}`]: safe(rate),
    [`tap_count_${suffix}`]: ts.length,
    [`inter_tap_mean_${suffix}`]: safe(meanIti),
    [`inter_tap_cv_${suffix}`]: safe(std(intervals) / (meanIti + 1e-9)),
    // Decrement: do the taps slow across the run? A hallmark of fatigable weakness.
    [`decrement_slope_${suffix}`]: intervals.length >= 4 ? safe(slope(intervals)) : 0,
  };
}

export interface FineMotorInput {
  taps_L: number[];
  taps_R: number[];
  drag?: { error_px: number[]; duration_ms?: number };
}

export function extractFineMotor(input: FineMotorInput): ModuleFeatures {
  const out: ModuleFeatures = {};
  const left = tapFeatures(input.taps_L ?? [], "L");
  const right = tapFeatures(input.taps_R ?? [], "R");
  Object.assign(out, left, right);

  if (Object.keys(left).length && Object.keys(right).length) {
    const rateL = out.tap_rate_L ?? 0;
    const rateR = out.tap_rate_R ?? 0;
    const cvL = out.inter_tap_cv_L ?? 0;
    const cvR = out.inter_tap_cv_R ?? 0;

    out.tap_asymmetry_ratio = safe(asymmetryRatio(rateL, rateR));
    out.tap_cv_asymmetry = safe(asymmetryRatio(cvL, cvR));
    out.tap_rate_mean = safe((rateL + rateR) / 2);
    // Kept separate so bilateral slowing can be told apart from asymmetry.
    out.tap_bilateral_slowing = safe(Math.min(rateL, rateR));
  }

  const errors = input.drag?.error_px;
  if (errors && errors.length >= 3) {
    out.drag_error_mean = safe(mean(errors));
    out.drag_error_cv = safe(std(errors) / (mean(errors) + 1e-9));
    if (input.drag?.duration_ms) out.drag_duration_ms = safe(input.drag.duration_ms);
  }

  if (!Object.keys(out).length) return { valid: 0 };
  out.valid = 1;
  return out;
}
