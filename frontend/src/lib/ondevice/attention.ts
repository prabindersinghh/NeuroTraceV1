/**
 * M10 attention and speed — on-device mirror of `backend/app/exam/cognition.py`.
 *
 * The headline feature is `rt_cov`, not `rt_median`. Intra-individual variability of
 * response time is a more sensitive marker of neural integrity than mean speed: a patient
 * can hold their median steady by concentrating harder while their consistency collapses.
 *
 * Latencies are measured with `performance.now()` against the stimulus paint, not against
 * a timer callback, so what is recorded is the human's reaction rather than the event
 * loop's scheduling.
 */
import type { ModuleFeatures } from "../types";

const MIN_PLAUSIBLE_MS = 80; // faster than this is an anticipation, not a reaction

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

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear interpolation percentile, matching numpy.percentile's default. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function slope(values: number[]): number {
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

export interface SimpleRtInput {
  latencies_ms: number[];
  misses?: number;
  false_starts?: number;
}

export function simpleRtFeatures(input: SimpleRtInput): ModuleFeatures {
  const lat = (input.latencies_ms ?? []).filter((x) => Number.isFinite(x) && x > MIN_PLAUSIBLE_MS);
  if (lat.length < 4) return {};

  const med = median(lat);
  const lapses = lat.filter((x) => x > med * 2).length;
  const misses = input.misses ?? 0;
  const falseStarts = input.false_starts ?? 0;

  const out: ModuleFeatures = {
    rt_median: safe(med),
    rt_mean: safe(mean(lat)),
    rt_iqr: safe(percentile(lat, 75) - percentile(lat, 25)),
    rt_cov: safe(std(lat) / (mean(lat) + 1e-9)),
    lapse_rate: safe(lapses / lat.length),
    miss_rate: safe(misses / Math.max(1, lat.length + misses)),
    false_start_rate: safe(falseStarts / Math.max(1, lat.length)),
    rt_trials: lat.length,
  };

  if (lat.length >= 5) {
    out.attention_decay_slope = safe(slope(lat));
    const half = Math.floor(lat.length / 2);
    out.fatigue_delta = safe(median(lat.slice(half)) - median(lat.slice(0, half)));
  }
  return out;
}

export interface ChoiceTrial {
  latency_ms: number;
  correct: boolean;
}

export function choiceRtFeatures(trials: ChoiceTrial[]): ModuleFeatures {
  const valid = (trials ?? []).filter((t) => Number.isFinite(t.latency_ms) && t.latency_ms > 0);
  if (valid.length < 4) return {};
  const lat = valid.map((t) => t.latency_ms);
  return {
    choice_rt_median: safe(median(lat)),
    choice_rt_cov: safe(std(lat) / (mean(lat) + 1e-9)),
    choice_accuracy: safe(valid.filter((t) => t.correct).length / valid.length),
  };
}

export interface AttentionInput {
  simple_rt?: SimpleRtInput;
  choice_rt?: ChoiceTrial[];
  tmt_a_seconds?: number;
  tmt_a_errors?: number;
}

export function extractAttentionSpeed(input: AttentionInput): ModuleFeatures {
  const out: ModuleFeatures = {};
  let completed = 0;

  const simple = simpleRtFeatures(input.simple_rt ?? { latencies_ms: [] });
  if (Object.keys(simple).length) {
    Object.assign(out, simple);
    completed += 1;
  }

  const choice = choiceRtFeatures(input.choice_rt ?? []);
  if (Object.keys(choice).length) {
    Object.assign(out, choice);
    completed += 1;
    if (out.rt_median !== undefined && out.choice_rt_median !== undefined) {
      // Decision cost: the pure processing component, with motor speed removed.
      out.decision_cost_ms = safe(out.choice_rt_median - out.rt_median);
    }
  }

  if (input.tmt_a_seconds) {
    out.tmt_a_seconds = safe(input.tmt_a_seconds);
    out.tmt_a_errors = safe(input.tmt_a_errors ?? 0);
    completed += 1;
  }

  if (completed === 0) return { valid: 0, tasks_completed: 0 };
  out.valid = 1;
  out.tasks_completed = completed;
  return out;
}
