/**
 * End-to-end proof that on-device facial capture works.
 *
 * `npm run verify:ondevice`
 *
 * Everything else in this repo tests the maths with synthetic numbers. This is the one
 * check that the *capture* path is real: that the staged wasm runtime and the FaceMesh
 * model actually load, that inference runs, and that landmarks come back out and turn into
 * the features the engine consumes.
 *
 * It runs in a real browser, driven over CDP, because that is where this code ships. A
 * Node shim would prove that a shim works. MediaPipe's wasm glue calls `document` during
 * model init, so Node cannot run it without pretending to be a browser anyway.
 *
 * The page imports `src/lib/ondevice/face.ts` through Vite, so what is verified is the
 * module the PWA uses — not a copy of it.
 *
 * No browser is downloaded: it drives the Edge or Chrome already installed.
 */
import { createServer } from "vite";
import { chromium } from "playwright-core";

const CHANNELS = ["msedge", "chrome", "chromium"];

async function launch() {
  const failures = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({
        channel: channel === "chromium" ? undefined : channel,
        args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
      });
    } catch (err) {
      failures.push(`${channel}: ${String(err.message).split("\n")[0]}`);
    }
  }
  throw new Error(`no usable browser found\n  ${failures.join("\n  ")}`);
}

const vite = await createServer({
  server: { port: 0 },
  logLevel: "error",
  optimizeDeps: { include: ["@mediapipe/tasks-vision"] },
});
await vite.listen();
const port = vite.httpServer.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await launch();
const page = await browser.newPage();

const logs = [];
page.on("console", (m) => logs.push(`    [${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`    [pageerror] ${e.message}`));

let result;
try {
  await page.goto(`${base}/verify-ondevice.html`, { waitUntil: "domcontentloaded" });
  result = await page.evaluate(() => window.__verifyOnDevice());
} finally {
  if (logs.length) console.log("  browser console:\n" + logs.join("\n"));
  await browser.close();
  await vite.close();
}

if (result.error) {
  console.error(`\nFAILED: ${result.error}`);
  process.exit(1);
}

const f = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : String(n));

console.log(`\nRuntime`);
console.log(`  wasm + model loaded from   ${result.assetBase}`);
console.log(`  FaceLandmarker init        ${result.initMs} ms`);
console.log(`  inference on ${String(result.frames).padStart(2)} frames    ${result.detectMs} ms ` +
            `(${f(result.detectMs / result.frames, 1)} ms/frame)`);
console.log(`  faces detected             ${result.facesDetected}/${result.frames}`);
console.log(`  landmarks per face         ${result.landmarkCount}`);

console.log(`\nLandmark-derived features (from the detected face)`);
for (const [k, v] of Object.entries(result.frameFeatures)) {
  console.log(`  ${k.padEnd(28)} ${f(v)}`);
}

console.log(`\nM1 module output — what the engine would receive`);
for (const [k, v] of Object.entries(result.moduleFeatures)) {
  console.log(`  ${k.padEnd(28)} ${f(v)}`);
}

// The laterality features are the ones Gate 3 reads, so they are the ones that have to
// respond. A runtime that loads but produces flat asymmetry would pass every other check
// in this repo and still leave the alert gate blind.
if (result.symmetricFeatures) {
  const LATERAL = ["mouth_corner_symmetry", "corner_drop", "nasolabial_ratio"];
  console.log("");
  console.log(`Does a droop actually show up? (symmetric capture vs left-droop capture)`);
  console.log(`  ${"feature".padEnd(28)} ${"symmetric".padStart(10)} ${"droop".padStart(10)}   change`);
  let moved = 0;
  for (const k of LATERAL) {
    const a = result.symmetricFeatures[k];
    const b = result.moduleFeatures[k];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b > a) moved += 1;
    console.log(`  ${k.padEnd(28)} ${f(a).padStart(10)} ${f(b).padStart(10)}   ${b > a ? "+" : ""}${f(b - a)}`);
  }
  console.log(`  -> ${moved}/${LATERAL.length} asymmetry features rose with the droop`);
  if (moved < 2) {
    console.error("FAILED: the droop did not move the asymmetry features the engine reads.");
    process.exit(1);
  }
}

console.log(`\nQuality gate`);
console.log(`  usable                     ${result.quality.usable}`);
console.log(`  reason                     ${result.quality.reason ?? "-"}`);

console.log(`\nOK — capture ran on-device end to end.`);
