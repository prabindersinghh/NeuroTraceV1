/**
 * Face identity enrolment and verification — entirely on device.
 *
 * WHAT PROBLEM THIS SOLVES, AND WHICH ONE IT DOES NOT
 * The engine already has an `identity_uncertain` confounder and an `identity_verified`
 * flag on every session; nothing was ever computing them. The risk is mundane and real:
 * a family member "helps" by doing the tapping task, or hands the phone to the wrong
 * person, and a stranger's measurement enters someone's baseline. That is data poisoning
 * by kindness, and it is far more likely than any adversary.
 *
 * This is therefore a SAME-PERSON CHECK, not a security control. It answers "does this
 * face match the enrolled geometry?" and its failure mode is a flag on the session, never
 * a refusal to run — locking a stroke survivor out of their own check-in because the
 * light changed would be a worse outcome than a flagged measurement.
 *
 * HOW
 * A signature of scale-invariant ratios between stable BONE-STRUCTURE landmarks, taken
 * from the landmarks the face model already returns — no new model, no embedding, and
 * nothing that could be called a faceprint: it cannot be reversed into an image and it
 * cannot be matched against anyone outside this phone. The enrolment vector lives in
 * `patients.calibration_json`; the comparison runs in the browser.
 *
 * The threshold is deliberately loose. Facial geometry moves with weight, swelling, a
 * new beard, and — critically for this population — with the very facial weakness we are
 * measuring. A tight threshold would flag a patient precisely as their face changed,
 * which is the moment the measurement matters most.
 */
import type { Landmark } from "./face";

/**
 * STRUCTURAL ratios only.
 *
 * `frameFeatures` (used by M1) returns EXPRESSION features — mouth openness, eye
 * aperture, corner drop — which by design change with every task and with the facial
 * weakness we are measuring. Reusing them here would mean a patient "failed" identity
 * because they smiled, or because their face changed in exactly the way the product
 * exists to detect. So identity uses bone-structure geometry instead, normalised by face
 * height so distance from the camera cancels out.
 *
 * Standard MediaPipe FaceMesh indices.
 */
const IDX = {
  eyeOuterL: 33, eyeOuterR: 263,
  eyeInnerL: 133, eyeInnerR: 362,
  noseAlaL: 129, noseAlaR: 358,
  mouthL: 61, mouthR: 291,
  jawL: 234, jawR: 454,
  browL: 105, browR: 334,
  bridge: 168, chin: 152,
} as const;

const d = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

function structuralRatios(pts: Landmark[]): Record<string, number> {
  const height = d(pts[IDX.bridge], pts[IDX.chin]) + 1e-6;
  const interocular = d(pts[IDX.eyeOuterL], pts[IDX.eyeOuterR]) + 1e-6;
  return {
    interocular_over_height: interocular / height,
    nose_width_over_interocular: d(pts[IDX.noseAlaL], pts[IDX.noseAlaR]) / interocular,
    mouth_width_over_interocular: d(pts[IDX.mouthL], pts[IDX.mouthR]) / interocular,
    jaw_width_over_height: d(pts[IDX.jawL], pts[IDX.jawR]) / height,
    eye_spacing_over_interocular: d(pts[IDX.eyeInnerL], pts[IDX.eyeInnerR]) / interocular,
    brow_span_over_interocular: d(pts[IDX.browL], pts[IDX.browR]) / interocular,
  };
}

const KEYS = [
  "interocular_over_height",
  "nose_width_over_interocular",
  "mouth_width_over_interocular",
  "jaw_width_over_height",
  "eye_spacing_over_interocular",
  "brow_span_over_interocular",
] as const;

export interface IdentitySignature {
  /** Median of each ratio across the enrolment frames. */
  values: Record<string, number>;
  /** Median absolute deviation per ratio — this person's own natural variation. */
  spread: Record<string, number>;
  frames: number;
  enrolled_at: string;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mad(xs: number[], med: number): number {
  if (!xs.length) return 0;
  return median(xs.map((x) => Math.abs(x - med)));
}

/** Build a signature from enrolment frames. Needs enough frames to have a spread at all. */
export function buildSignature(frames: Landmark[][]): IdentitySignature | null {
  const usable = frames.filter((f) => f && f.length > 400);
  if (usable.length < 15) return null;

  const perKey: Record<string, number[]> = {};
  for (const f of usable) {
    const feats = structuralRatios(f);
    for (const k of KEYS) {
      const v = feats[k];
      if (typeof v === "number" && Number.isFinite(v)) (perKey[k] ??= []).push(v);
    }
  }
  const values: Record<string, number> = {};
  const spread: Record<string, number> = {};
  for (const k of KEYS) {
    const xs = perKey[k] ?? [];
    if (xs.length < 10) continue;
    values[k] = median(xs);
    // Floor the spread: a perfectly still enrolment would otherwise make every later
    // session look like a different person.
    spread[k] = Math.max(mad(xs, values[k]), Math.abs(values[k]) * 0.02, 1e-4);
  }
  if (Object.keys(values).length < 4) return null;
  return { values, spread, frames: usable.length, enrolled_at: new Date().toISOString() };
}

export interface IdentityVerdict {
  /** 0..1 — 1 means indistinguishable from the enrolled geometry. */
  score: number;
  /** False only when the geometry is far outside this person's own variation. */
  verified: boolean;
  /** True when there was no signature to compare against; NOT a failure. */
  unenrolled: boolean;
}

/**
 * Sessions this far outside the enrolled geometry are flagged, never blocked.
 *
 * CALIBRATION STATUS: this threshold and the `z / 12` scaling below are set against
 * SYNTHETIC geometry (see identity.test.ts) — a same-person case, a facial-weakness case
 * and a clearly-different-face case. They have never been tuned against real enrolments,
 * and the separation between "same person in worse light" and "different person" in the
 * field is unmeasured. It is deliberately loose so that the error it makes is the cheap
 * one: letting a session through unflagged rather than accusing a patient.
 *
 * Two things would change it, and neither has happened yet: enrolment pairs from real
 * households, and a look at how often the flag fires in the pilot.
 */
const VERIFY_THRESHOLD = 0.45;

export function verifyAgainst(
  signature: IdentitySignature | null | undefined,
  frames: Landmark[][],
): IdentityVerdict {
  if (!signature || !Object.keys(signature.values).length) {
    // No enrolment yet: say so plainly rather than reporting a confident pass. The
    // session is stored as verified, because "we never checked" must not read to a
    // clinician as "we checked and it was someone else".
    return { score: 1, verified: true, unenrolled: true };
  }
  const usable = frames.filter((f) => f && f.length > 400);
  if (usable.length < 5) return { score: 1, verified: true, unenrolled: true };

  const perKey: Record<string, number[]> = {};
  for (const f of usable) {
    const feats = structuralRatios(f);
    for (const k of KEYS) {
      const v = feats[k];
      if (typeof v === "number" && Number.isFinite(v)) (perKey[k] ??= []).push(v);
    }
  }

  // Robust z per ratio against the enrolled median and spread, then a bounded score.
  const zs: number[] = [];
  for (const k of Object.keys(signature.values)) {
    const xs = perKey[k];
    if (!xs?.length) continue;
    const z = Math.abs(median(xs) - signature.values[k]) / (signature.spread[k] || 1e-4);
    zs.push(z);
  }
  if (!zs.length) return { score: 1, verified: true, unenrolled: true };

  // Median z, not mean: one ratio moving a lot (a swollen cheek, a new beard) should not
  // by itself declare a different person.
  const z = median(zs);
  const score = Math.max(0, Math.min(1, 1 - z / 12));
  return { score: Number(score.toFixed(3)), verified: score >= VERIFY_THRESHOLD, unenrolled: false };
}
