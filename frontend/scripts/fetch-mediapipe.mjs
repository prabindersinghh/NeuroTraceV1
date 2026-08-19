/**
 * Download the MediaPipe vision runtime and the FaceMesh model into public/mediapipe.
 *
 * Run once after cloning: `npm run fetch:mediapipe`.
 *
 * These assets are served from our own origin and precached by the service worker so the
 * exam works with no network at all. They are deliberately not committed: large binaries
 * do not belong in a git repository, and pinning the version here keeps the download
 * reproducible without carrying 4 MB in every clone.
 *
 * Why not just point MediaPipe at a CDN? Because the whole claim is that a patient in a
 * Tier-2/3 town with intermittent data completes their check-in anyway. A model fetched on
 * first use fails in exactly the situation the product exists for — and it would also mean
 * a third party sees a request every time someone opens the camera.
 */
import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "mediapipe");

// Pinned. An unpinned runtime would change the landmark output from under the baselines.
const TASKS_VISION_VERSION = "0.10.22";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const FILES = [
  [`${CDN}/vision_wasm_internal.js`, "wasm/vision_wasm_internal.js"],
  [`${CDN}/vision_wasm_internal.wasm`, "wasm/vision_wasm_internal.wasm"],
  [`${CDN}/vision_wasm_nosimd_internal.js`, "wasm/vision_wasm_nosimd_internal.js"],
  [`${CDN}/vision_wasm_nosimd_internal.wasm`, "wasm/vision_wasm_nosimd_internal.wasm"],
  [MODEL, "face_landmarker.task"],
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, relative) {
  const target = join(OUT, relative);
  if (await exists(target)) {
    console.log(`  skip  ${relative} (already present)`);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  console.log(`  got   ${relative}`);
}

console.log("Fetching MediaPipe assets into public/mediapipe ...");
for (const [url, relative] of FILES) {
  await download(url, relative);
}
console.log("Done. These are gitignored and precached by the service worker.");
