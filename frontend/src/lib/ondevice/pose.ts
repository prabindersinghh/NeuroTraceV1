/**
 * PoseLandmarker loading and the balance / pronator capture payloads.
 *
 * Same privacy contract as the face path: frames are landmarked as they arrive and only
 * the landmark numbers survive. The pose model (`pose_landmarker_lite.task`) is staged by
 * `scripts/fetch-mediapipe.mjs` next to the face model, pinned by SHA-256 for the same
 * reason — a silently swapped model moves every balance baseline.
 *
 * WHAT THE SERVER EXPECTS
 * -----------------------
 * M9 (`extract_craniocorpography`): {fps, head_width_norm, head_width_cm?, tests: {name:
 * [[x,y]...]}} — HEAD CENTROID per frame, normalised image coordinates. Head width
 * (bitemporal, ear-to-ear) converts pixels to centimetres; the default 15 cm matches the
 * backend's DEFAULT_HEAD_WIDTH_CM.
 *
 * M6 (`extract_pronator_drift`): {frames: [[[x,y,z] × 33]...], fps} — the full 33-point
 * skeleton, because drift is read from wrists RELATIVE to shoulders and one centroid
 * cannot express it.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

// MediaPipe Pose indices.
const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;

let landmarker: Promise<PoseLandmarker> | null = null;

export function loadPoseLandmarker(basePath = "/mediapipe"): Promise<PoseLandmarker> {
  landmarker ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(`${basePath}/wasm`);
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${basePath}/pose_landmarker_lite.task` },
      runningMode: "VIDEO",
      numPoses: 1,
    });
  })();
  return landmarker;
}

export function isPoseCaptureSupported(): boolean {
  return typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function";
}

export interface PosePoint { x: number; y: number; z: number }

/** Head centroid: nose and both ears averaged — stable under partial occlusion. */
export function headCentroid(pts: PosePoint[]): [number, number] | null {
  if (!pts || pts.length < 33) return null;
  const used = [pts[NOSE], pts[L_EAR], pts[R_EAR]].filter(Boolean);
  if (!used.length) return null;
  return [
    used.reduce((a, p) => a + p.x, 0) / used.length,
    used.reduce((a, p) => a + p.y, 0) / used.length,
  ];
}

/** Bitemporal width in normalised units — the pixel→cm scale reference. */
export function headWidthNorm(pts: PosePoint[]): number {
  if (!pts || pts.length < 33) return 0;
  return Math.hypot(pts[L_EAR].x - pts[R_EAR].x, pts[L_EAR].y - pts[R_EAR].y);
}

/** The accumulating M9 payload across the three standing-block steps. */
export interface BalanceRaw {
  fps: number;
  head_width_norm: number;
  head_width_cm?: number;
  tests: Record<string, [number, number][]>;
  [k: string]: unknown;
}

export function emptyBalanceRaw(): BalanceRaw {
  return { fps: 0, head_width_norm: 0, tests: {} };
}

/** M6 payload — full skeleton frames. */
export interface PronatorRaw {
  fps: number;
  frames: [number, number, number][][];
  [k: string]: unknown;
}
