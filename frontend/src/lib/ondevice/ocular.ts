/**
 * M3 · oculomotor capture — saccades, smooth pursuit, gaze holding.
 *
 * WHAT LEAVES THE DEVICE
 * ----------------------
 * Normalised gaze COORDINATES per frame, paired with where the target was. Numbers only —
 * the camera frames are landmarked and dropped, same as every other capture in this app.
 * Feature extraction (latency, velocity, gain, asymmetry) happens on the SERVER, in
 * `backend/app/exam/vestibular.py::extract_oculomotor` — the implementation the test suite
 * pins against the real patient's report. Re-deriving those numbers in TypeScript would
 * create a second implementation that drifts, and drift in the one module that carries
 * TIER_1 posterior laterality is not a risk worth taking for the few KB a round trip saves.
 *
 * GAZE FROM IRIS LANDMARKS
 * ------------------------
 * FaceLandmarker emits iris rings: 468–472 (right eye), 473–477 (left eye), centre first.
 * Gaze here is the mean of both iris centres, normalised INSIDE the eye box (corner
 * landmarks 33/133 and 362/263), so head translation cancels to first order and what
 * remains is where the eyes point. This is not a calibrated gaze tracker — absolute
 * degrees are out of reach — but saccade LATENCY (when the eye moves) and the LEFT/RIGHT
 * ASYMMETRY of velocity survive normalisation intact, and those are the two numbers the
 * laterality gate actually consumes.
 */
import type { Landmark } from "./face";

// Iris centres. The four ring points around each are not needed for a centre estimate.
const R_IRIS = 468;
const L_IRIS = 473;
// Eye corners for the per-eye reference frame.
const R_INNER = 133; const R_OUTER = 33;
const L_INNER = 362; const L_OUTER = 263;

export interface GazeSample {
  /** Normalised gaze position, head-motion-compensated, 0..1-ish per axis. */
  x: number;
  y: number;
  /** Raw face presence — false when the landmarker lost the face this frame. */
  ok: boolean;
}

/** One frame of landmarks → one gaze sample. */
export function gazeFromLandmarks(pts: Landmark[] | null): GazeSample {
  if (!pts || pts.length < 478) return { x: 0.5, y: 0.5, ok: false };
  const rIris = pts[R_IRIS];
  const lIris = pts[L_IRIS];
  const rSpan = Math.abs(pts[R_INNER].x - pts[R_OUTER].x) || 1e-6;
  const lSpan = Math.abs(pts[L_INNER].x - pts[L_OUTER].x) || 1e-6;
  // Position of each iris within its own eye box, then averaged across eyes.
  const rx = (rIris.x - pts[R_OUTER].x) / rSpan;
  const lx = (lIris.x - pts[L_OUTER].x) / lSpan;
  const ry = (rIris.y - (pts[R_OUTER].y + pts[R_INNER].y) / 2) / rSpan;
  const ly = (lIris.y - (pts[L_OUTER].y + pts[L_INNER].y) / 2) / lSpan;
  return { x: (rx + lx) / 2, y: (ry + ly) / 2 + 0.5, ok: true };
}

export type SaccadeDirection = "left" | "right" | "up" | "down";

export interface SaccadeTrial {
  direction: SaccadeDirection;
  target_onset_frame: number;
  gaze: [number, number][];
  target: [number, number];
}

export interface PursuitSample {
  gaze: [number, number];
  target: [number, number];
}

/**
 * The accumulating M3 payload. The four protocol steps (horizontal saccades, vertical
 * saccades, pursuit, gaze holding) fill ONE of these; it is submitted once, after the
 * last of them, because the server extractor wants the whole picture to compute
 * per-direction asymmetries.
 */
export interface OculomotorRaw {
  fps: number;
  pursuit: PursuitSample[];
  saccades: SaccadeTrial[];
  /** Gaze-holding samples: drift and refixations under a static target. */
  gaze_holding?: [number, number][];
  [k: string]: unknown;
}

export function emptyOculomotorRaw(): OculomotorRaw {
  return { fps: 0, pursuit: [], saccades: [] };
}

/** Frames where the face was lost, as a fraction — the honest capture-quality number. */
export function lostFraction(samples: GazeSample[]): number {
  if (!samples.length) return 1;
  return samples.filter((s) => !s.ok).length / samples.length;
}
