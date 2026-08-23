/**
 * Stage the MediaPipe vision runtime and the FaceMesh model into public/mediapipe.
 *
 * Run once after cloning: `npm run fetch:mediapipe`.
 *
 * These assets are served from our own origin and precached by the service worker so the
 * exam works with no network at all.
 *
 * Why local rather than a CDN at runtime? Because the whole claim is that a patient in a
 * Tier-2/3 town with intermittent data completes their check-in anyway. A model fetched on
 * first use fails in exactly the situation the product exists for — and it would also mean
 * a third party sees a request every time someone opens the camera.
 *
 * WHERE THE RUNTIME COMES FROM
 * ----------------------------
 * The wasm files are COPIED OUT OF node_modules, not downloaded. `@mediapipe/tasks-vision`
 * is already a declared dependency, and the npm package ships the wasm alongside the JS
 * bindings that import it. Copying from there means:
 *
 *   - no network at build time, so a clone + `npm install` + build works offline;
 *   - the runtime cannot drift from the bindings, because both come from the one version
 *     the lockfile resolved. A CDN URL pinned by hand is a second source of truth, and it
 *     was wrong: this script used to fetch @0.10.22, a version that was never published
 *     (0.10.21 is followed by 0.10.32), so every fetch 404'd.
 *
 * To move the runtime, change the dependency in package.json — not a string in here. A
 * different landmarker build shifts the landmark output, and every existing patient
 * baseline is expressed in terms of those landmarks, so treat it as a migration.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "mediapipe");
const require = createRequire(import.meta.url);

// The model is not on npm — it is published by Google as a standalone .task file. It is the
// one asset we cannot take from the lockfile, so it is pinned by content hash instead: a
// silently swapped model would move every baseline without anything else changing.
// Each model is pinned by content hash: a silently swapped model moves every baseline
// without anything else changing. Verified 2026-08-22/23. Override only when deliberately
// moving to a different model build — which is a baseline migration, not a config change.
const MODELS = [
  {
    name: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sha256: process.env.NEUROTRACE_MODEL_SHA256 ||
      "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    bytes: 3758596,
  },
  {
    // PoseLandmarker (lite): the standing block (M9) and pronator drift (M6). Lite on
    // purpose — it has to run per-frame on budget handsets alongside the UI.
    name: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: process.env.NEUROTRACE_POSE_SHA256 ||
      "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    bytes: 5777746,
  },
];

// An operator with no egress can point this at a local copy or an internal mirror.
const MODEL_SOURCE = process.env.NEUROTRACE_MODEL_PATH || process.env.NEUROTRACE_MODEL_URL;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

/** Copy the wasm runtime out of the installed package. No network involved. */
async function stageRuntime() {
  // Resolve the package by its main entry, not by "<pkg>/package.json": this package's
  // `exports` map does not expose package.json, so requiring that path throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED even though the package is installed correctly.
  let pkgDir;
  try {
    pkgDir = dirname(require.resolve("@mediapipe/tasks-vision"));
  } catch {
    throw new Error(
      "@mediapipe/tasks-vision is not installed. Run `npm install` first — the wasm " +
        "runtime is copied out of node_modules, not downloaded.",
    );
  }
  const { version } = JSON.parse(
    await readFile(join(pkgDir, "package.json"), "utf8"),
  );
  const from = join(pkgDir, "wasm");
  if (!(await exists(from))) {
    throw new Error(`@mediapipe/tasks-vision@${version} has no wasm/ directory at ${from}`);
  }

  const files = (await readdir(from)).filter((f) => f.endsWith(".js") || f.endsWith(".wasm"));
  if (!files.length) throw new Error(`no wasm assets found in ${from}`);

  await mkdir(join(OUT, "wasm"), { recursive: true });
  let copied = 0;
  for (const file of files) {
    const target = join(OUT, "wasm", file);
    const src = join(from, file);
    // Re-copy when the size differs, so bumping the dependency actually restages.
    if (await exists(target)) {
      const [a, b] = await Promise.all([stat(src), stat(target)]);
      if (a.size === b.size) continue;
    }
    await copyFile(src, target);
    copied += 1;
  }
  console.log(
    `  runtime  @mediapipe/tasks-vision@${version} -> wasm/ ` +
      `(${files.length} files, ${copied} written, ${files.length - copied} already current)`,
  );
  // FilesetResolver picks the SIMD or non-SIMD build at load time from what the browser
  // reports, so both have to be present or capture breaks on the devices that need it most.
  for (const required of ["vision_wasm_internal.js", "vision_wasm_nosimd_internal.js"]) {
    if (!files.includes(required)) {
      throw new Error(`${required} missing from the package — capture would fail at runtime`);
    }
  }
}

async function stageModel({ name, url: modelUrl, sha256: expected, bytes }) {
  const target = join(OUT, name);

  if (await exists(target)) {
    const size = (await stat(target)).size;
    if (size === bytes) {
      console.log(`  model    ${name} (already present, ${size} bytes)`);
      return;
    }
    console.log(`  model    re-fetching ${name}: ${size} bytes is not the expected ${bytes}`);
    await unlink(target);
  }

  await mkdir(OUT, { recursive: true });

  // A local path wins over any download — this is the fully-offline route.
  if (MODEL_SOURCE && !/^https?:/.test(MODEL_SOURCE)) {
    await copyFile(join(MODEL_SOURCE, name), target).catch(() => copyFile(MODEL_SOURCE, target));
    console.log(`  model    ${name} copied from ${MODEL_SOURCE}`);
  } else {
    const url = modelUrl;
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(
        `${res.status} ${res.statusText} for ${url}\n` +
          "  If this host is unreachable, set NEUROTRACE_MODEL_PATH to a local directory\n" +
          "  holding the .task files, or NEUROTRACE_MODEL_URL to an internal mirror.",
      );
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
    console.log(`  model    ${name} from ${new URL(url).host}`);
  }

  const digest = await sha256(target);
  if (expected && digest !== expected) {
    await unlink(target);
    throw new Error(
      `model checksum mismatch for ${name}\n  expected ${expected}\n  got      ${digest}\n` +
        "  Refusing to stage it: a different landmarker shifts every patient baseline.",
    );
  }
  console.log(`  sha256   ${digest}`);
}

console.log("Staging MediaPipe assets into public/mediapipe ...");
await stageRuntime();
for (const m of MODELS) await stageModel(m);
console.log("Done. These are gitignored and precached by the service worker.");
