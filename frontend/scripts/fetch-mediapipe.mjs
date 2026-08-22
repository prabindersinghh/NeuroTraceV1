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
import { access, copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "mediapipe");
const LOCAL_WASM_DIR = join(ROOT, "node_modules", "@mediapipe", "tasks-vision", "wasm");

// Pinned to match package.json dependencies
const TASKS_VISION_VERSION = "1.0.1";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, target) {
  if (await exists(target)) {
    console.log(`  skip  ${target.replace(ROOT + "/", "")} (already present)`);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  console.log(`  got   ${target.replace(ROOT + "/", "")}`);
}

async function syncWasm() {
  const wasmOut = join(OUT, "wasm");
  await mkdir(wasmOut, { recursive: true });

  const hasLocal = await exists(LOCAL_WASM_DIR);
  if (hasLocal) {
    console.log("Copying WASM runtime from local node_modules/@mediapipe/tasks-vision/wasm ...");
    const files = await readdir(LOCAL_WASM_DIR);
    for (const file of files) {
      const src = join(LOCAL_WASM_DIR, file);
      const dest = join(wasmOut, file);
      if (!(await exists(dest))) {
        await copyFile(src, dest);
        console.log(`  copied wasm/${file}`);
      } else {
        console.log(`  skip   wasm/${file} (already present)`);
      }
    }
  } else {
    console.log(`Fetching WASM runtime from CDN (@mediapipe/tasks-vision@${TASKS_VISION_VERSION}) ...`);
    for (const file of WASM_FILES) {
      await download(`${CDN}/${file}`, join(wasmOut, file));
    }
  }
}

console.log("Fetching MediaPipe assets into public/mediapipe ...");
await syncWasm();
console.log("Fetching FaceMesh model ...");
await download(MODEL, join(OUT, "face_landmarker.task"));
console.log("Done. These are gitignored and precached by the service worker.");

