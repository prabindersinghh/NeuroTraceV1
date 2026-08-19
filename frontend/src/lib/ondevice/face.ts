/**
 * M1 facial movement — on-device MediaPipe FaceMesh. Mirrors `backend/app/exam/facial.py`.
 *
 * The camera frames are read into a canvas, landmarked, and discarded. Nothing is encoded,
 * nothing is stored, nothing is uploaded — what leaves this module is a dictionary of
 * ratios and angles.
 *
 * The clinically important feature here is `forehead_movement_symmetry`, and the derived
 * `central_pattern_index`. The forehead has bilateral cortical innervation, so a central
 * lesion (a stroke) spares it while the lower face droops; a peripheral lesion (Bell's
 * palsy) takes the whole hemiface. A module that only measured the smile would raise a
 * stroke-shaped alarm for a self-limiting Bell's palsy.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

import type { ModuleFeatures } from "../types";

// FaceMesh landmark indices — identical to the Python constants.
const L_MOUTH = 61;
const R_MOUTH = 291;
const UP_LIP = 13;
const LOW_LIP = 14;
const L_EYE = [33, 160, 158, 133, 153, 144];
const R_EYE = [362, 385, 387, 263, 373, 380];
const L_BROW_INNER = 105;
const R_BROW_INNER = 334;
const L_BROW_OUTER = 70;
const R_BROW_OUTER = 300;
const NOSE_BRIDGE = 168;
const CHIN = 199;
const L_NASOLABIAL = 129;
const R_NASOLABIAL = 358;
const L_CHEEK = 205;
const R_CHEEK = 425;

const MIN_FRAMES = 5;

export type FaceTask = "smile" | "forehead_raise" | "eye_closure" | "cheek_puff";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

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

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = ((sorted.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function symmetry(left: number, right: number): number {
  return Math.abs(left - right) / (Math.abs(left) + Math.abs(right) + 1e-6);
}

function eyeAspectRatio(points: Landmark[], idx: number[]): number {
  const p = idx.map((i) => points[i]);
  const vertical = dist(p[1], p[5]) + dist(p[2], p[4]);
  const horizontal = 2 * dist(p[0], p[3]) + 1e-6;
  return vertical / horizontal;
}

/** Per-frame geometry. Mirrors `facial.frame_features`. */
export function frameFeatures(pts: Landmark[]): Record<string, number> {
  const scale = dist(pts[NOSE_BRIDGE], pts[CHIN]) + 1e-6;
  const mid = {
    x: (pts[NOSE_BRIDGE].x + pts[CHIN].x) / 2,
    y: (pts[NOSE_BRIDGE].y + pts[CHIN].y) / 2,
    z: 0,
  };

  const dl = dist(pts[L_MOUTH], mid);
  const dr = dist(pts[R_MOUTH], mid);

  const nlLeft = dist(pts[L_NASOLABIAL], pts[L_CHEEK]) / scale;
  const nlRight = dist(pts[R_NASOLABIAL], pts[R_CHEEK]) / scale;

  const earL = eyeAspectRatio(pts, L_EYE);
  const earR = eyeAspectRatio(pts, R_EYE);

  return {
    mouth_corner_symmetry: safe(symmetry(dl, dr)),
    corner_drop: safe(Math.abs(pts[L_MOUTH].y - pts[R_MOUTH].y) / scale),
    nasolabial_ratio: safe(symmetry(nlLeft, nlRight)),
    eye_aperture_L: safe(earL),
    eye_aperture_R: safe(earR),
    ear_asymmetry: safe(symmetry(earL, earR)),
    brow_height_L: safe((pts[NOSE_BRIDGE].y - pts[L_BROW_INNER].y) / scale),
    brow_height_R: safe((pts[NOSE_BRIDGE].y - pts[R_BROW_INNER].y) / scale),
    brow_outer_L: safe((pts[NOSE_BRIDGE].y - pts[L_BROW_OUTER].y) / scale),
    brow_outer_R: safe((pts[NOSE_BRIDGE].y - pts[R_BROW_OUTER].y) / scale),
    mouth_open: safe(Math.abs(pts[UP_LIP].y - pts[LOW_LIP].y) / scale),
  };
}

function series(frames: Record<string, number>[], key: string): number[] {
  return frames.map((f) => f[key] ?? 0);
}

/** Rest-to-peak travel. A weak side is one whose excursion is small at maximum effort. */
function excursion(frames: Record<string, number>[], key: string): number {
  const values = series(frames, key);
  return values.length ? percentile(values, 90) - percentile(values, 10) : 0;
}

function blinkAsymmetry(earLeft: number[], earRight: number[]): number {
  const count = (values: number[]): number => {
    if (values.length < 3) return 0;
    const threshold = median(values) * 0.7;
    let blinks = 0;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i - 1] >= threshold && values[i] < threshold) blinks += 1;
    }
    return blinks;
  };
  const l = count(earLeft);
  const r = count(earRight);
  return safe(Math.abs(l - r) / (l + r + 1e-6));
}

export type FaceCapture = Partial<Record<FaceTask, Landmark[][]>>;

/** Combine the four tasks into one feature vector. Mirrors `extract_facial_motor`. */
export function extractFacialMotor(capture: FaceCapture): ModuleFeatures {
  const perTask: Partial<Record<FaceTask, Record<string, number>[]>> = {};

  for (const [task, frames] of Object.entries(capture) as [FaceTask, Landmark[][]][]) {
    if (!frames || frames.length < 3) continue;
    const computed = frames
      .filter((f) => Array.isArray(f) && f.length >= 468)
      .map(frameFeatures);
    if (computed.length >= 3) perTask[task] = computed;
  }

  const tasks = Object.keys(perTask) as FaceTask[];
  if (!tasks.length) return { valid: 0, frames_detected: 0 };

  const out: ModuleFeatures = {};
  const totalFrames = tasks.reduce((n, t) => n + (perTask[t]?.length ?? 0), 0);

  const smile = perTask.smile;
  if (smile) {
    out.mouth_corner_symmetry = safe(median(series(smile, "mouth_corner_symmetry")));
    out.corner_drop = safe(median(series(smile, "corner_drop")));
    out.nasolabial_ratio = safe(median(series(smile, "nasolabial_ratio")));
    out.mouth_corner_symmetry_std = safe(std(series(smile, "mouth_corner_symmetry")));
  }

  const forehead = perTask.forehead_raise;
  if (forehead) {
    const excL = excursion(forehead, "brow_height_L");
    const excR = excursion(forehead, "brow_height_R");
    out.forehead_excursion_L = safe(excL);
    out.forehead_excursion_R = safe(excR);
    out.forehead_movement_symmetry = safe(symmetry(excL, excR));
    // Positive = lower face asymmetric while the forehead is spared: the central pattern.
    out.central_pattern_index = safe(
      (out.mouth_corner_symmetry ?? 0) - out.forehead_movement_symmetry,
    );
  }

  const closure = perTask.eye_closure;
  if (closure) {
    out.eye_closure_L = safe(Math.min(...series(closure, "eye_aperture_L")));
    out.eye_closure_R = safe(Math.min(...series(closure, "eye_aperture_R")));
    out.eye_closure_asymmetry = safe(symmetry(out.eye_closure_L, out.eye_closure_R));
  }

  const puff = perTask.cheek_puff;
  if (puff) out.cheek_puff_symmetry = safe(median(series(puff, "nasolabial_ratio")));

  const pooled = tasks.flatMap((t) => perTask[t] ?? []);
  out.eye_aperture_L = safe(median(series(pooled, "eye_aperture_L")));
  out.eye_aperture_R = safe(median(series(pooled, "eye_aperture_R")));
  out.ear_asymmetry = safe(median(series(pooled, "ear_asymmetry")));

  const corner = series(pooled, "corner_drop");
  let tremor = 0;
  for (let i = 1; i < corner.length; i += 1) tremor += Math.abs(corner[i] - corner[i - 1]);
  out.landmark_tremor = safe(corner.length > 1 ? tremor / (corner.length - 1) : 0);

  out.blink_asymmetry = blinkAsymmetry(
    series(pooled, "eye_aperture_L"),
    series(pooled, "eye_aperture_R"),
  );

  out.valid = 1;
  out.frames_detected = totalFrames;
  out.tasks_completed = tasks.length;
  return out;
}

// --------------------------------------------------------------------------- runtime
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

/**
 * Load the FaceMesh model once, from the app's own origin.
 *
 * The WASM bundle and the model are served locally rather than from a CDN so the exam
 * still runs with the phone in airplane mode — which is the whole on-device claim, and the
 * moment worth showing in the demo.
 */
export function loadFaceLandmarker(basePath = "/mediapipe"): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    const vision = await FilesetResolver.forVisionTasks(`${basePath}/wasm`);
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${basePath}/face_landmarker.task`,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
    });
  })();
  return landmarkerPromise;
}

export function isFaceCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export interface FaceQualityVerdict {
  ok: boolean;
  reason?: string;
  detectionRate: number;
  frames: number;
}

/** Capture-quality gate (FR8): too few detected frames means re-prompt, not score. */
export function assessFaceQuality(frames: Landmark[][], attempted: number): FaceQualityVerdict {
  const detected = frames.length;
  const rate = attempted > 0 ? detected / attempted : 0;
  if (detected < MIN_FRAMES) {
    return { ok: false, reason: "face_not_detected", detectionRate: rate, frames: detected };
  }
  if (rate < 0.5) {
    return { ok: false, reason: "face_kept_leaving_frame", detectionRate: rate, frames: detected };
  }
  return { ok: true, detectionRate: rate, frames: detected };
}
