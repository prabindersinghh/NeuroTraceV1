/**
 * The cortex field: the geometry behind the landing page's one continuous visual.
 *
 * WHAT IT IS. A single cloud of points that the whole page reuses. It never re-spawns and
 * it is never swapped for another picture — it is MOVED between six arrangements, and the
 * arrangements are the argument:
 *
 *   scatter    recovery happening at home with nothing measuring it
 *   domains    the same points sorted into the seven things this product can read
 *   cortex     those readings resolved into one coherent picture of one person
 *   pathway    that picture extended along ninety days
 *   ecosystem  the people the picture reaches
 *   reach      and the geography it has to cross to reach them
 *
 * Because it is one cloud, a point that was a stray observation in the first scene is the
 * same point that becomes a reading, a day, and finally a household. That continuity is
 * the entire reason this is one buffer and not six illustrations.
 *
 * WHAT IT IS NOT. Not a picture of anyone's brain, not a readout, not a claim. The
 * product's actual measurements are drawn to scale next to it by `TraceLanes`, from the
 * seeded demo run. This is `aria-hidden` and nothing depends on it.
 *
 * NO LIBRARY, ON PURPOSE — D-039 and D-064. Three.js is ~150 kB gzipped on a bundle whose
 * service worker already precaches 45 MB of models for a clinical PWA, and the page's own
 * argument is that this product runs on a cheap phone. What we need instead is one
 * `gl.POINTS` draw call and a perspective divide, which is four multiplications. The
 * renderer that consumes this file is `components/landing/CortexField.tsx`; everything
 * that can be reasoned about without a GPU lives here so it can be tested in Node.
 */
import { mulberry32 } from "./neural";

/** The six arrangements, in scroll order. `STATE.<name>` indexes into `positions`. */
export const STATE = {
  scatter: 0,
  domains: 1,
  cortex: 2,
  pathway: 3,
  ecosystem: 4,
  reach: 5,
} as const;

export type StateName = keyof typeof STATE;
export const STATE_COUNT = 6;

/** One per gating domain — `traceData.DOMAINS` is the same seven, in the same order. */
export const DOMAIN_COUNT = 7;

/**
 * Where each domain's points settle on the shell. Spread by hand rather than by another
 * Fibonacci pass: seven anchors placed evenly on a sphere cluster near the poles, and the
 * whole point of the lobes is that a highlighted domain reads as a REGION rather than as
 * seven dots scattered through the cloud.
 */
const LOBES: [number, number, number][] = [
  [0.00, 0.62, 0.34],   // cranial nerves — front and high
  [-0.72, 0.20, 0.42],  // motor speech
  [0.72, 0.20, 0.42],   // language
  [-0.86, -0.16, -0.20],// motor
  [0.86, -0.16, -0.20], // coordination & gait
  [0.00, -0.66, -0.28], // posterior / vestibular — low and back
  [0.00, 0.10, -0.80],  // cognition — deep
];

/* The `<ArrayBuffer>` argument is not decoration: since TS 5.7 a typed array is generic in
   its backing store, and `WebGL2RenderingContext.bufferData` will not accept one that
   might be shared. Pinning it here is what lets the renderer hand these straight to GL. */
/**
 * The camera each arrangement wants, as [yaw, pitch].
 *
 * One fixed viewpoint cannot serve all six. A three-quarter view gives the cortex its
 * volume and turns the ecosystem — which is a diagram of five things around a centre —
 * into five clusters scattered at random. So the camera is blended with exactly the same
 * weights as the positions: the view rotates INTO each arrangement as the cloud arrives
 * in it, which also gives the morph a sense of the viewer moving rather than the object
 * spinning.
 */
export const STATE_VIEW = new Float32Array([
  -0.55, 0.14,   // scatter    — three-quarter, so it reads as a volume with no front
  -0.14, 0.09,   // domains    — nearly face-on: seven lanes must read as seven lanes
  -0.50, 0.16,   // cortex     — three-quarter, the angle the form was shaped for
  -0.24, 0.11,   // pathway    — a slight turn, enough for the twist to read as depth
   0.00, 0.00,   // ecosystem  — face-on. It is a diagram; a diagram at an angle is a mess
  -0.06, 0.34,   // reach      — looking down over a plane spreading away from the viewer
]);

export interface Field {
  count: number;
  /** `STATE_COUNT` buffers of `count * 3` floats. Index with `STATE.<name>`. */
  positions: Float32Array<ArrayBuffer>[];
  /** Domain index 0..6, one per point. */
  domain: Float32Array<ArrayBuffer>;
  /** Stable per-point randomness, 0..1. Drives drift phase and twinkle. */
  seed: Float32Array<ArrayBuffer>;
  /** Relative point size, 0.55..1.6. */
  size: Float32Array<ArrayBuffer>;
  /** Line endpoints as point indices, `2 * lineCount` of them. */
  lines: Uint16Array<ArrayBuffer>;
  /**
   * Half-width and half-height of each arrangement, `2 * STATE_COUNT` long.
   *
   * The six arrangements are wildly different sizes — the cortex is a ball about 1.2
   * across, the reach is a sheet nearly 4 wide — so one fixed zoom either shrinks the
   * cortex to a speck or throws the reach off both edges of the screen. The renderer
   * blends these with the same weights it blends the positions, which makes the camera
   * pull back as the cloud spreads without anyone having to tune six numbers by hand.
   */
  extent: Float32Array<ArrayBuffer>;
}

/**
 * How many points a device gets.
 *
 * The same three signals `neural.nodeBudget` uses, and for the same reason: this product
 * is used on the handsets it is used on, not on the laptop it was built on. Zero means
 * "draw the static plate instead" — a real answer, not a degraded one.
 */
export function particleBudget(opts: {
  coarse: boolean; cores: number; saveData: boolean; memory: number;
}): number {
  if (opts.saveData) return 0;
  if (opts.cores > 0 && opts.cores <= 2) return 0;
  if (opts.memory > 0 && opts.memory <= 2) return 0;
  if (opts.coarse) return 3600;
  if (opts.cores > 0 && opts.cores <= 4) return 8000;
  return 18000;
}

/** Read the budget signals off the browser, with safe values where they are unavailable. */
export function readDevice(): { coarse: boolean; cores: number; saveData: boolean; memory: number } {
  if (typeof window === "undefined") return { coarse: false, cores: 0, saveData: false, memory: 0 };
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  return {
    coarse: window.matchMedia("(pointer: coarse)").matches,
    cores: nav.hardwareConcurrency ?? 0,
    saveData: nav.connection?.saveData === true,
    memory: nav.deviceMemory ?? 0,
  };
}

/** Blend weights for a fractional state. A tent, so it is a two-state lerp everywhere. */
export function stateWeights(state: number, out = new Float32Array(STATE_COUNT)): Float32Array {
  const s = Math.min(STATE_COUNT - 1, Math.max(0, state));
  for (let i = 0; i < STATE_COUNT; i += 1) out[i] = Math.max(0, 1 - Math.abs(s - i));
  return out;
}

/**
 * Build the field. Deterministic in `seed`, so the page draws identically on every visit
 * and in every screenshot — the same property `traceData.buildRun` has, for the same
 * reason.
 *
 * `hubs` is how many of the points get structural lines drawn between them. It is small on
 * purpose: nearest-neighbour is O(n²) and a few hundred lines over eighteen thousand
 * points is also what the picture wants. Drawing a line per point would be a hairball.
 */
export function createField(count: number, seed = 42, hubs = 200): Field {
  const rng = mulberry32(seed);
  const positions = Array.from(
    { length: STATE_COUNT }, () => new Float32Array(count * 3),
  );
  const domain = new Float32Array(count);
  const pointSeed = new Float32Array(count);
  const size = new Float32Array(count);

  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const d = i % DOMAIN_COUNT;
    domain[i] = d;
    pointSeed[i] = rng();
    size[i] = 0.55 + rng() * 1.05;
    const o = i * 3;
    const u = rng();
    const v = rng();
    const w = rng();

    // ── scatter ────────────────────────────────────────────────────────────────────
    // Unstructured, and wider than any later state: the first thing the page says is
    // that recovery is happening across a space nobody is looking at. Cube rather than
    // ball, so it has no centre to read as a subject.
    positions[STATE.scatter][o] = (u - 0.5) * 3.6;
    positions[STATE.scatter][o + 1] = (v - 0.5) * 2.0;
    positions[STATE.scatter][o + 2] = (w - 0.5) * 2.6;

    // ── domains ────────────────────────────────────────────────────────────────────
    // Seven flat lanes. Deliberately the same reading as `TraceLanes` seen edge-on: the
    // signal exists and is separable, but it is still seven unrelated rows.
    const laneY = ((DOMAIN_COUNT - 1) / 2 - d) * 0.235;
    positions[STATE.domains][o] = (rng() - 0.5) * 3.3;
    positions[STATE.domains][o + 1] = laneY + (rng() - 0.5) * 0.055;
    positions[STATE.domains][o + 2] = (rng() - 0.5) * 0.45;

    // ── cortex ─────────────────────────────────────────────────────────────────────
    // Three things stop this being the generic glowing ball every AI product ships, and
    // all three are deliberate:
    //   1. a real interhemispheric gap, not a seam — the midline is EMPTY, which is the
    //      single feature that makes a point cloud read as a brain rather than a sphere;
    //   2. folding — the shell radius is modulated so the surface has ridges, because a
    //      perfectly smooth shell reads as geometry and a folded one reads as tissue;
    //   3. it is flatter than it is wide, which is the proportion of a cortex seen from
    //      above and in front, and the angle the whole page looks at it from.
    // Each domain's points gather on its own lobe so a highlight lights a region.
    const [lx, ly, lz] = LOBES[d];
    const theta = golden * i;
    // Wide enough that neighbouring lobes OVERLAP. This number is the difference between
    // one folded surface with regions and seven balls floating near each other, and the
    // act this arrangement belongs to is the one arguing that seven readings cohere into
    // a person — so seven visibly separate clusters would illustrate the opposite.
    const spread = 0.52 + rng() * 0.42;
    const ring = Math.sqrt(Math.max(0, 1 - (2 * rng() - 1) ** 2));
    const sx = lx + Math.cos(theta) * ring * spread;
    const sy = ly + (rng() - 0.5) * spread * 1.25;
    const sz = lz + Math.sin(theta) * ring * spread;
    // Back onto the shell, so the seven lobes read as one surface rather than as seven
    // balls floating near each other.
    const len = Math.hypot(sx, sy, sz) || 1;
    const nx = sx / len;
    const ny = sy / len;
    const nz = sz / len;
    const fold = 1 + 0.075 * Math.sin(ny * 9.5 + nz * 4.0) * Math.cos(nz * 7.5 - nx * 3.0);
    const shell = (0.80 + rng() * 0.26) * fold;
    // The gap. Every point is pushed to one side of the midline by a fixed amount, so
    // nothing lands in the middle — a seam you can see through, not a darker stripe.
    const side = nx >= 0 ? 1 : -1;
    positions[STATE.cortex][o] = side * (0.15 + Math.abs(nx) * shell * 1.02);
    positions[STATE.cortex][o + 1] = ny * shell * 0.74;
    positions[STATE.cortex][o + 2] = nz * shell * 0.98;

    // ── pathway ────────────────────────────────────────────────────────────────────
    // The same seven lanes, but now running along time rather than sitting still: a
    // ninety-day ribbon with a slow twist, so depth reads as duration.
    const t = rng();
    const twist = t * Math.PI * 1.5;
    positions[STATE.pathway][o] = (t - 0.5) * 3.9;
    positions[STATE.pathway][o + 1] = laneY * 0.82 + Math.sin(twist + d) * 0.09;
    positions[STATE.pathway][o + 2] = Math.cos(twist + d) * 0.30 + (rng() - 0.5) * 0.08;

    // ── ecosystem ──────────────────────────────────────────────────────────────────
    // One dense centre — the record the whole system reasons over — and four satellites
    // for the four people who read it. Points belong to a satellite by domain so the
    // clusters inherit their colour from the state before.
    const CLUSTERS: [number, number, number, number][] = [
      [0, 0, 0, 0.34],           // the record — tighter than the satellites, so it reads
      [-0.98, 0.44, 0.16, 0.26], // survivor      as the mass everything else refers to
      [0.98, 0.44, -0.16, 0.26], // caregiver
      [-0.98, -0.46, -0.16, 0.26], // clinician
      [0.98, -0.46, 0.16, 0.26], // ASHA worker
    ];
    // Two of every seven points stay in the centre, so the record reads as the mass.
    const cluster = d < 2 ? 0 : (d - 1) % 4 + 1;
    const [cxp, cyp, czp, cr] = CLUSTERS[cluster];
    const ct = rng() * Math.PI * 2;
    const cphi = Math.acos(2 * rng() - 1);
    const crad = cr * Math.cbrt(rng());
    positions[STATE.ecosystem][o] = cxp + Math.sin(cphi) * Math.cos(ct) * crad;
    positions[STATE.ecosystem][o + 1] = cyp + Math.cos(cphi) * crad * 0.8;
    positions[STATE.ecosystem][o + 2] = czp + Math.sin(cphi) * Math.sin(ct) * crad;

    // ── reach ──────────────────────────────────────────────────────────────────────
    // The same mass, spread thin and wide. Not a map of anywhere — a distribution: a few
    // dense places and a long tail of small ones, which is what the population looks
    // like and why a product that only works in the dense places misses most of it.
    const far = rng();
    const spreadX = (rng() - 0.5) * (0.5 + far * 3.9);
    positions[STATE.reach][o] = spreadX;
    positions[STATE.reach][o + 1] = (rng() - 0.5) * (0.35 + far * 1.5);
    positions[STATE.reach][o + 2] = (rng() - 0.5) * (0.3 + far * 1.1);
  }

  // Measured rather than declared: the arrangements above are generated, so a hand-written
  // bound would be one edit away from being wrong and the symptom would be a cloud
  // silently cropped at the edge of a canvas.
  const extent = new Float32Array(STATE_COUNT * 2);
  positions.forEach((buffer, state) => {
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < count; i += 1) {
      hx = Math.max(hx, Math.abs(buffer[i * 3]));
      hy = Math.max(hy, Math.abs(buffer[i * 3 + 1]));
    }
    extent[state * 2] = Math.max(0.2, hx);
    extent[state * 2 + 1] = Math.max(0.2, hy);
  });

  return {
    count,
    positions,
    domain,
    seed: pointSeed,
    size,
    lines: buildLines(positions[STATE.cortex], Math.min(hubs, count)),
    extent,
  };
}

/**
 * Structural lines between the first `hubs` points, joined to their two nearest
 * neighbours in the CORTEX arrangement — but only where those neighbours are actually
 * near, which is what `maxLength` is for.
 *
 * Built from one arrangement and reused for all six on purpose: the lines are indices, so
 * they follow their endpoints. A line that joined two readings in the cortex becomes the
 * line that joins two days in the pathway and two people in the ecosystem — which is the
 * continuity the page is arguing for, drawn rather than asserted.
 */
export function buildLines(
  positions: Float32Array, hubs: number, maxLength = 0.42,
): Uint16Array<ArrayBuffer> {
  const pairs: number[] = [];
  const taken = new Set<number>();
  const maxSq = maxLength * maxLength;
  for (let i = 0; i < hubs; i += 1) {
    let bestA = -1;
    let bestB = -1;
    let dA = Infinity;
    let dB = Infinity;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    for (let j = 0; j < hubs; j += 1) {
      if (j === i) continue;
      const d = (x - positions[j * 3]) ** 2
        + (y - positions[j * 3 + 1]) ** 2
        + (z - positions[j * 3 + 2]) ** 2;
      if (d < dA) { dB = dA; bestB = bestA; dA = d; bestA = j; }
      else if (d < dB) { dB = d; bestB = j; }
    }
    for (const [j, d2] of [[bestA, dA], [bestB, dB]] as const) {
      if (j < 0) continue;
      // A hub's nearest neighbour can still be right across the cloud, and a chord through
      // the middle of the shell is what turns a surface into the low-poly wireframe every
      // AI landing page ships. Local links trace the form; long ones deny it.
      if (d2 > maxSq) continue;
      const key = Math.min(i, j) * hubs + Math.max(i, j);
      if (taken.has(key)) continue;
      taken.add(key);
      pairs.push(i, j);
    }
  }
  return new Uint16Array(pairs);
}

/**
 * The instrument palette, one colour per domain, as linear-ish RGB in 0..1.
 *
 * A cool ramp, NOT seven hues. Colour on this page carries meaning — warm is a finding —
 * so seven decorative hues would spend the one signal the page cannot afford to spend.
 * The domains are separable by position; they only need to be separable by shade.
 */
export const DOMAIN_RGB = new Float32Array([
  0.498, 0.698, 0.941,  // #7FB2F0
  0.400, 0.596, 0.859,
  0.545, 0.741, 0.949,
  0.353, 0.518, 0.769,
  0.451, 0.647, 0.902,
  0.310, 0.451, 0.671,
  0.588, 0.780, 0.965,
]);

/** The warm a domain moves to when the visitor is inspecting a morning it deviates on. */
export const FLARE_RGB = new Float32Array([0.898, 0.639, 0.239]); // #E8A33D, the WATCH token
