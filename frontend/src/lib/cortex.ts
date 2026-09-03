/**
 * The cortex field: the geometry behind the landing page's one continuous visual.
 *
 * WHAT IT IS. A single cloud of points that the whole page reuses. It never re-spawns and
 * it is never swapped for another picture — it is MOVED between seven arrangements, and
 * the arrangements are the argument:
 *
 *   territory  a stroke: one artery, the territory it feeds, and that territory going out
 *   scatter    the months afterwards, at home, with nothing measuring them
 *   pathways   the same points sorted into the seven systems this product can read
 *   cortex     those readings resolved into one coherent picture of one person
 *   ribbon     that picture extended along ninety days
 *   ecosystem  the people the picture reaches
 *   network    and the geography it has to cross to reach them
 *
 * Because it is one cloud, a point that was perfused tissue in the first scene is the same
 * point that becomes a reading, a day, and finally a household. That continuity is the
 * entire reason this is one buffer and not seven illustrations.
 *
 * WHAT IT IS NOT. Not a picture of anyone's brain, not a readout, not a claim. The
 * `territory` arrangement is the premise of the product, not a capability of it: this
 * software reasons over days and cannot see an occlusion, which the page says in words
 * next to it. The product's actual measurements are drawn to scale by `TraceLanes`, from
 * the seeded demo run. All of this is `aria-hidden` and nothing depends on it.
 *
 * NO LIBRARY, ON PURPOSE — D-039, D-064 and D-085. Three.js is ~150 kB gzipped and GSAP
 * with ScrollTrigger another ~90 kB, on a bundle whose service worker already precaches
 * 45 MB of models for a clinical PWA, and the page's own argument is that this product
 * runs on a cheap phone. What we need instead is one `gl.POINTS` draw call and a
 * perspective divide, which is four multiplications. The renderer that consumes this file
 * is `components/landing/CortexField.tsx`; everything that can be reasoned about without
 * a GPU lives here so it can be tested in Node.
 */
import { mulberry32 } from "./neural";

/** The seven arrangements, in scroll order. `STATE.<name>` indexes into `positions`. */
export const STATE = {
  territory: 0,
  scatter: 1,
  pathways: 2,
  cortex: 3,
  ribbon: 4,
  ecosystem: 5,
  network: 6,
} as const;

export type StateName = keyof typeof STATE;
export const STATE_COUNT = 7;

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
  [0.00, -0.66, -0.28], // posterior / vestibular — the cerebellum, low and back
  [0.00, 0.10, -0.80],  // cognition — deep
];

/**
 * Which domain becomes the cerebellum in the `cortex` arrangement.
 *
 * Not an arbitrary pick: domain 5 IS posterior/vestibular, so the one lobe that can
 * honestly be drawn as a mass of its own is exactly the one a brain silhouette needs
 * detached. A stranger recognises a brain by its folds first and by the lump under the
 * back of it second; without that lump an ovoid with gyri is still just an ovoid.
 */
const CEREBELLUM = 5;

/* ─────────────────────────────────────────────────────────── the arterial tree */

/**
 * THE CEREBRAL ARTERIAL TREE, as one arc per domain rising out of one shared stem.
 *
 * Why this exists at all. The page's first act says a stroke is an emergency and what
 * follows it is not, and until now it said that over a cube of random dust — the premise
 * of the entire product was the one thing on the page with no picture. An artery closing
 * and the territory downstream of it going quiet is the event; everything else the page
 * argues is about the months after it.
 *
 * WHAT IT CLAIMS, AND WHAT IT DOES NOT. This is a recognisable arterial tree, not a
 * labelled angiogram: seven arcs from a common origin under the middle of the brain, each
 * ending in the cortical region its domain occupies in the `cortex` arrangement. The one
 * detail that IS clinically specific is which vessel closes and what goes with it — see
 * `OCCLUDED`. Nothing here is measured, modelled, or derived from a patient.
 *
 * Geometry: a quadratic Bézier per vessel, in |x| so each is mirrored into both
 * hemispheres by the same `side` bit the cortex uses — you have a left and a right MCA,
 * and drawing one of them would read as a lesion in itself.
 */
const WILLIS: [number, number, number] = [0.12, -0.40, -0.03];
const STEM_BASE: [number, number, number] = [0.09, -0.62, -0.13];
/**
 * Fraction of a point's travel along the tree spent on the shared stem below Willis.
 *
 * Small, and that is the whole tuning. At 0.2 one point in five landed in a tube a
 * hundredth of a unit wide, and under an ADDITIVE blend a fifth of eighteen thousand
 * points in one tube is not a vessel — it is a white bar with a tree growing out of it.
 * The trunk needs to read as the thickest single vessel in the picture, which is a matter
 * of its CALIBRE, not of how many points are crowded into it.
 */
const STEM_T = 0.07;
/** Where the terminal spray stops being an artery and becomes the tissue it feeds. */
const TERRITORY_T = 0.66;

/** Control point and endpoint per domain, in |x|. The endpoint sits just inside its lobe. */
const VESSELS: { ctrl: [number, number, number]; end: [number, number, number] }[] = [
  { ctrl: [0.30, 0.02, 0.50], end: [0.16, 0.48, 0.30] },    // 0 anterior, over the top
  { ctrl: [0.60, -0.30, 0.40], end: [0.58, 0.16, 0.34] },   // 1 middle, superior division
  { ctrl: [0.62, -0.27, 0.32], end: [0.58, 0.17, 0.33] },   // 2 middle, superior division
  { ctrl: [0.66, -0.25, 0.02], end: [0.70, -0.12, -0.16] }, // 3 middle, main trunk
  { ctrl: [0.64, -0.23, -0.05], end: [0.70, -0.13, -0.17] },// 4 middle, main trunk
  { ctrl: [0.22, -0.54, -0.32], end: [0.20, -0.50, -0.55] },// 5 posterior inferior
  { ctrl: [0.34, -0.17, -0.44], end: [0.17, 0.06, -0.64] }, // 6 posterior
];

/**
 * The occlusion: one middle cerebral artery, one side.
 *
 * The pairing is the one thing here worth being exact about, because it is the difference
 * between a picture and a diagram of nothing. A middle cerebral occlusion takes the motor
 * strip and the speech territory together — weakness down one side and difficulty
 * producing words, from a single vessel — which is domains 3 and 1, and it is why those
 * two are the ones the page shows going quiet rather than a random pair.
 *
 * One hemisphere only. Both sides going out at once would be a picture of something else
 * entirely, and laterality is a claim this product makes everywhere else (INV-2).
 */
const OCCLUDED_DOMAINS = new Set([1, 3]);
const OCCLUDED_SIDE = -1;
/** How far along the vessel it lodges. Mid-course, so there is a tree above and a field below. */
const CLOT_T = 0.46;

/**
 * How much of the cloud is the tree rather than the tissue, and how its points bunch.
 *
 * At module scope because two things need them: `createField` maps `flow` onto tree
 * position with them, and `CLOT_FLOW` inverts that map so the renderer can mark the
 * occlusion at the right place along the vessel without knowing anything about the
 * mapping. Both were inline once, and the shader keyed its mark off `risk` instead —
 * which worked until the territory became graded and every point in the penumbra margin
 * happened to hold the value the mark was looking for. The result was a gold field where
 * a small warm mark belonged. A clot is a position on a vessel; this is that position.
 */
const TREE_SHARE = 0.16;
const TREE_BIAS = 0.55;

/** Where the tree's parameter sits for a given `flow`, 0..1. Monotone. */
export function treeParam(flow: number): number {
  return flow < TREE_SHARE
    ? Math.pow(flow / TREE_SHARE, TREE_BIAS) * TERRITORY_T
    : TERRITORY_T + ((flow - TREE_SHARE) / (1 - TREE_SHARE)) * (1 - TERRITORY_T);
}

/** The value of `flow` at the occlusion — `treeParam(CLOT_FLOW) === CLOT_T`. */
export const CLOT_FLOW = TREE_SHARE * Math.pow(CLOT_T / TERRITORY_T, 1 / TREE_BIAS);

/* The `<ArrayBuffer>` argument is not decoration: since TS 5.7 a typed array is generic in
   its backing store, and `WebGL2RenderingContext.bufferData` will not accept one that
   might be shared. Pinning it here is what lets the renderer hand these straight to GL. */
/**
 * The camera each arrangement wants, as [yaw, pitch].
 *
 * One fixed viewpoint cannot serve all seven. A three-quarter view gives the cortex its
 * volume and turns the ecosystem — which is a diagram of five things around a centre —
 * into five clusters scattered at random. So the camera is blended with exactly the same
 * weights as the positions: the view rotates INTO each arrangement as the cloud arrives
 * in it, which also gives the morph a sense of the viewer moving rather than the object
 * spinning.
 *
 * THE CORTEX AND TERRITORY ANGLES ARE MUCH NEARER FACE-ON THAN THEY WERE, and the reason is
 * worth writing down because it cost this page its best picture for a while. The empty
 * midline is the one feature that makes this cloud read as a brain rather than as a ball —
 * and a gap between two hemispheres is only a gap when you are looking down it. At three
 * quarters it is edge-on and invisible, so the arrangement kept its volume and lost the
 * thing that made it recognisable. Recognition beats volume: a form nobody identifies has
 * no volume worth showing.
 */
export const STATE_VIEW = new Float32Array([
  -0.42, 0.12,   // territory  — lateral enough for arterial tree & clot, near enough face-on
  -0.34, 0.14,   // scatter    — anatomical brain at home with left-hemisphere circuit decay
  -0.36, 0.12,   // pathways   — perspective view showing tracts descending from cortical lobes
  -0.26, 0.14,   // cortex     — near face-on, deep longitudinal fissure clearly visible
  -0.28, 0.12,   // ribbon     — perspective angle highlighting longitudinal recovery trajectory
   0.00, 0.00,   // ecosystem  — face-on diagram showing 4 conduits radiating from central core
  -0.08, 0.36,   // network    — elevated perspective overlooking 3D topographical terrain & arcs
]);

export const STATE_WAVE = new Float32Array([
  1.00, 2.20, 0.42,   // territory — blood flow moving outward along arterial tree
  0.22, 1.40, 0.16,   // scatter   — fragmented, intermittent synaptic sparks in damaged circuit
  0.42, 3.20, 0.32,   // pathways  — distinct action potential signals firing along descending tracts
  0.00, 1.00, 0.00,   // cortex    — coherent personal baseline (breathes via uDrift)
  0.48, 1.20, 0.14,   // ribbon    — continuous recovery sweep advancing along 90-day timeline
  0.40, 2.00, 0.25,   // ecosystem — active data streaming from patient core along 4 conduits
  0.36, 1.20, 0.12,   // network   — tele-neurology pulses leaping along transmission arcs to hubs
]);

export const STATE_GAIN = new Float32Array([
  1.00,   // territory
  0.96,   // scatter
  0.96,   // pathways
  1.00,   // cortex
  0.94,   // ribbon
  0.94,   // ecosystem
  0.94,   // network
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
  /**
   * WHERE ALONG ITS OWN STRUCTURE a point sits, 0..1. One attribute, three meanings, each
   * belonging to the arrangement that is on screen when it is used:
   *
   *   territory  distance out from the stem — 0 at the trunk, 1 in the cortical field
   *   pathways   distance along its tract — 0 at the cortex, 1 at the far end
   *   ribbon     which of the ninety days it is
   *
   * All three are "how far through this thing has the signal got", which is why they can
   * share a buffer: the shader runs one travelling wave along it and the arrangement
   * decides what the wave means. Five separate attributes would be five buffers, five
   * shader inputs and the same picture.
   */
  flow: Float32Array<ArrayBuffer>;
  /**
   * How far downstream of the occlusion a point is, 0..1. Zero for everything that is not
   * in the affected territory, which is most of the cloud. Only the `territory`
   * arrangement uses it.
   */
  risk: Float32Array<ArrayBuffer>;
  /** Line endpoints as point indices, `2 * lineCount` of them. */
  lines: Uint16Array<ArrayBuffer>;
  /**
   * Half-width and half-height of each arrangement, `2 * STATE_COUNT` long.
   *
   * The arrangements are wildly different sizes — the cortex is a ball about 1.2 across,
   * the network is a sheet nearly 4 wide — so one fixed zoom either shrinks the cortex to
   * a speck or throws the network off both edges of the screen. The renderer blends these
   * with the same weights it blends the positions, which makes the camera pull back as
   * the cloud spreads without anyone having to tune seven numbers by hand.
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
  // The three DECLINE tiers are untouched on purpose. They are the low-end access
  // guarantee, not a quality setting: a Data Saver handset, a two-core phone or a 2 GB
  // device gets the still plate, and raising density must never be paid for by the people
  // this product exists for. What follows is only how much the devices that already said
  // yes actually draw.
  if (opts.saveData) return 0;
  if (opts.cores > 0 && opts.cores <= 2) return 0;
  if (opts.memory > 0 && opts.memory <= 2) return 0;
  // Density is the argument, and these were raised because the argument was measurably
  // failing. The hero plate and the scrolling scene draw the SAME geometry, and the hero
  // read as a brain while the scene read as dust — because the scene spreads the cloud
  // over five times the area for two and a half times the points, which is 2.36x less
  // light per pixel. A surface reads as a surface only while it is continuous, and at the
  // old counts across a full-screen canvas it was not. See D-087; the arithmetic is there.
  //
  // The cost is GPU fill, not CPU: the draw is one `drawArrays` and nothing per-frame
  // scales with the count. `createField` is the only cost that does, and it happens once,
  // lazily, a fifth of a viewport before the section arrives.
  if (opts.coarse) return 8000;
  if (opts.cores > 0 && opts.cores <= 4) return 16000;
  return 38000;
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

/** Smoothstep, the same curve the shaders use, so geometry and shading agree on edges. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build the field. Deterministic in `seed`, so the page draws identically on every visit
 * and in every screenshot — the same property `traceData.buildRun` has, for the same
 * reason.
 *
 * `hubs` is how many of the points get structural lines drawn between them. It is small on
 * purpose: nearest-neighbour is O(n²) and a few hundred lines over eighteen thousand
 * points is also what the picture wants. Drawing a line per point would be a hairball.
 *
 * READING ORDER. The `cortex` arrangement is computed FIRST even though it is the fourth
 * act, because three of the others are defined relative to it: the arterial tree ends in
 * the cortical region it feeds, and the seven tracts begin at the lobe they leave. Doing
 * it in scroll order would mean computing the same shell three times.
 */
export function createField(count: number, seed = 42, hubs = 200): Field {
  const rng = mulberry32(seed);
  const positions = Array.from(
    { length: STATE_COUNT }, () => new Float32Array(count * 3),
  );
  const domain = new Float32Array(count);
  const pointSeed = new Float32Array(count);
  const size = new Float32Array(count);
  const flow = new Float32Array(count);
  const risk = new Float32Array(count);

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
    const stem = rng() < 0.19;
    const stemT = rng();

    // Dedicated random variables for all arrangements to ensure branch-independent determinism
    const rLobeSpread = rng();
    const rLobeRing = rng();
    const rLobeY = rng();
    const rShellDepth = rng();
    const rFlow = rng();
    const rJitterX = rng();
    const rJitterY = rng();
    const rJitterZ = rng();
    const rDecayAmt = rng();
    const rDecayAngle = rng();
    const rDecayZ = rng();
    const rPathJitter1 = rng();
    const rPathJitter2 = rng();
    const rRibbonJitter = rng();
    const rEcoTheta = rng();
    const rEcoPhi = rng();
    const rEcoRad = rng();
    const rEcoStream = rng();
    const rNetHub = rng();
    const rNetX = rng();
    const rNetZ = rng();
    const rNetArc = rng();

    // ── cortex ─────────────────────────────────────────────────────────────────────
    // High-definition anatomical brain cortex:
    //   1. Empty longitudinal fissure cleft (midline is empty).
    //   2. Dual-harmonic gyri and sulci folding.
    //   3. Biologically accurate cerebrum proportions and frontal/parietal/occipital curvature.
    //   4. Temporal lobe and deep Sylvian fissure.
    //   5. Bilateral cerebellum with transverse folia and descending brainstem stalk.
    const [lx, ly, lz] = LOBES[d];
    const theta = golden * i;
    const spread = 0.48 + rLobeSpread * 0.38;
    const ring = Math.sqrt(Math.max(0, 1 - (2 * rLobeRing - 1) ** 2));
    const sx = lx + Math.cos(theta) * ring * spread;
    const sy = ly + (rLobeY - 0.5) * spread * 1.25;
    const sz = lz + Math.sin(theta) * ring * spread;
    const len = Math.hypot(sx, sy, sz) || 1;
    const nx = sx / len;
    const ny = sy / len;
    const nz = sz / len;

    // Dual-harmonic gyri/sulci folding
    const fold = 1.0
      + 0.105 * Math.sin(ny * 10.5 + nz * 5.0) * Math.cos(nz * 8.0 - nx * 3.5)
      + 0.048 * Math.sin(nz * 17.5 - ny * 11.5);

    // Deep Sylvian lateral fissure
    const lateral = Math.min(1.0, Math.abs(nx) * 2.4);
    const sylvian = lateral * Math.exp(-((ny + 0.10 - 0.34 * nz) ** 2) * 46);

    // Cortical mantle depth: concentrated in outer 26% of radius to prevent inner fog blowout
    const mantleDepth = Math.pow(rShellDepth, 4.0) * 0.26;
    const shell = (1.025 - mantleDepth) * fold * (1.0 - 0.16 * sylvian);

    // Tapering: frontal pole pinch, occipital curve
    const taper = 1.0 - 0.30 * Math.max(0, nz) ** 2.2 - 0.16 * Math.max(0, -nz) ** 3.0;
    const temporal = lateral * Math.exp(-((ny + 0.52) ** 2 * 4.2 + (nz - 0.16) ** 2 * 2.0));

    // Direction vector for cerebellum
    const bt = u * Math.PI * 2;
    const bp = Math.acos(2 * v - 1);
    const br = Math.cbrt(w);
    const bx = Math.sin(bp) * Math.cos(bt) * br;
    const by = Math.cos(bp) * br;
    const bz = Math.sin(bp) * Math.sin(bt) * br;

    let cx = Math.abs(nx) * shell * (0.84 * taper + 0.30 * temporal);
    let cy = ny * shell * 0.70 * taper - 0.20 * temporal * shell;
    let cz = nz * shell;
    if (cy < 0) cy *= 0.72; // Flat skull base floor

    let gap = 0.14; // Empty longitudinal fissure cleft
    if (d === CEREBELLUM) {
      if (stem) {
        cx = Math.abs(bx) * 0.16;
        cy = -0.42 - stemT * 0.40;
        cz = -0.14 - stemT * 0.18 + bz * 0.12;
      } else {
        const folia = 1.0 + 0.10 * Math.sin(bz * 28 + by * 10);
        cx = Math.abs(bx) * 0.50 * folia;
        cy = -0.48 + by * 0.25 * folia;
        cz = -0.66 + bz * 0.35 * folia;
      }
      gap = 0.04;
    }
    const side = (d === CEREBELLUM ? bx : nx) >= 0 ? 1 : -1;
    const cortexX = side * (gap + cx);
    positions[STATE.cortex][o] = cortexX;
    positions[STATE.cortex][o + 1] = cy;
    positions[STATE.cortex][o + 2] = cz;

    // ── territory ──────────────────────────────────────────────────────────────────
    // The cerebral arterial tree rising into the Circle of Willis and branching to lobes.
    flow[i] = rFlow;
    const t = treeParam(rFlow);
    const vessel = VESSELS[d];
    let tx: number;
    let ty: number;
    let tz: number;
    if (t < STEM_T) {
      const k = t / STEM_T;
      tx = STEM_BASE[0] + (WILLIS[0] - STEM_BASE[0]) * k;
      ty = STEM_BASE[1] + (WILLIS[1] - STEM_BASE[1]) * k;
      tz = STEM_BASE[2] + (WILLIS[2] - STEM_BASE[2]) * k;
    } else {
      const k = (t - STEM_T) / (1 - STEM_T);
      const m = 1 - k;
      tx = m * m * WILLIS[0] + 2 * m * k * vessel.ctrl[0] + k * k * vessel.end[0];
      ty = m * m * WILLIS[1] + 2 * m * k * vessel.ctrl[1] + k * k * vessel.end[1];
      tz = m * m * WILLIS[2] + 2 * m * k * vessel.ctrl[2] + k * k * vessel.end[2];
    }
    const calibre = 0.028 + 0.085 * t * t;
    const settle = smoothstep(TERRITORY_T, 0.76, t);
    const jx = (rJitterX - 0.5) * calibre * 2;
    const jy = (rJitterY - 0.5) * calibre * 2;
    const jz = (rJitterZ - 0.5) * calibre * 2;
    positions[STATE.territory][o] = side * (tx + jx) * (1 - settle) + cortexX * settle;
    positions[STATE.territory][o + 1] = (ty + jy) * (1 - settle) + cy * settle;
    positions[STATE.territory][o + 2] = (tz + jz) * (1 - settle) + cz * settle;

    if (OCCLUDED_DOMAINS.has(d) && side === OCCLUDED_SIDE) {
      const ex = side * vessel.end[0];
      const core = 1 - smoothstep(0.28, 0.82, Math.hypot(
        positions[STATE.territory][o] - ex,
        positions[STATE.territory][o + 1] - vessel.end[1],
        positions[STATE.territory][o + 2] - vessel.end[2],
      ));
      risk[i] = smoothstep(CLOT_T - 0.05, CLOT_T + 0.13, t) * (0.42 + 0.58 * core);
    } else {
      risk[i] = 0;
    }

    // ── scatter ────────────────────────────────────────────────────────────────────
    // Unmonitored Neural Circuit Decay:
    // The patient's brain at home after discharge. The intact hemisphere maintains its
    // recognizable brain shape, resting quietly. In the stroke-affected territory
    // (domains 1 and 3 on the occluded side), neural circuits are unmonitored and broken
    // across synaptic disconnection gaps.
    const isLesion = OCCLUDED_DOMAINS.has(d) && side === OCCLUDED_SIDE;
    if (isLesion) {
      const decayDist = 0.16 + 0.34 * rDecayAmt;
      const decayAng = rDecayAngle * Math.PI * 2;
      positions[STATE.scatter][o] = cortexX * (1.0 + decayDist * 0.35) + Math.cos(decayAng) * decayDist * 0.20;
      positions[STATE.scatter][o + 1] = cy * (1.0 + decayDist * 0.25) + Math.sin(decayAng) * decayDist * 0.20;
      positions[STATE.scatter][o + 2] = cz * (1.0 + decayDist * 0.25) + (rDecayZ - 0.5) * decayDist * 0.20;
    } else {
      positions[STATE.scatter][o] = cortexX * 0.98 + (rDecayAmt - 0.5) * 0.035;
      positions[STATE.scatter][o + 1] = cy * 0.98 + (rDecayAngle - 0.5) * 0.035;
      positions[STATE.scatter][o + 2] = cz * 0.98 + (rDecayZ - 0.5) * 0.035;
    }

    // ── pathways ───────────────────────────────────────────────────────────────────
    // Seven functional neural tracts emerging from their cortical centers:
    // Cranial, Speech, Language, Motor, Coordination, Vestibular, Cognition.
    const AMP = [0.052, 0.030, 0.086, 0.042, 0.104, 0.024, 0.068][d];
    const FREQ = [5.4, 9.1, 3.2, 12.6, 4.4, 7.3, 2.6][d];
    const NOISE = [0.030, 0.014, 0.052, 0.020, 0.062, 0.010, 0.038][d];

    const laneY = ((DOMAIN_COUNT - 1) / 2 - d) * 0.31;
    const laneX = (t - 0.5) * 2.7;
    const wave = Math.sin(t * FREQ + d * 1.7) * AMP;
    const laneZ = ((d % 3) - 1) * 0.25 + Math.cos(t * FREQ * 0.6 + d) * 0.05;

    // First third emerges from cortical origin:
    const leave = smoothstep(0.0, 0.32, t);
    const body = 0.028 + NOISE * 1.8;

    positions[STATE.pathways][o] = cortexX * (1 - leave) + laneX * leave;
    positions[STATE.pathways][o + 1] = cy * (1 - leave)
      + (laneY + wave + (rPathJitter1 - 0.5) * body) * leave;
    positions[STATE.pathways][o + 2] = cz * (1 - leave)
      + (laneZ + (rPathJitter2 - 0.5) * body * 3.8) * leave;

    // ── ribbon ─────────────────────────────────────────────────────────────────────
    // Continuous 90-day longitudinal recovery trajectory:
    // Early days carry noisy daily scatter; advancing days tighten into an ascending recovery vector.
    const timeX = (t - 0.5) * 3.4;
    const ascent = (t - 0.5) * 0.22;
    const variance = (1.0 - t * 0.75) * 0.09;
    const twist = t * Math.PI * 1.5;
    positions[STATE.ribbon][o] = timeX;
    positions[STATE.ribbon][o + 1] = laneY * 0.95 + ascent + Math.sin(twist + d) * 0.12 + (rRibbonJitter - 0.5) * variance;
    positions[STATE.ribbon][o + 2] = Math.cos(twist + d) * 0.28 + (rDecayZ - 0.5) * (0.05 + variance);

    // ── ecosystem ──────────────────────────────────────────────────────────────────
    // Center: Patient daily neurological core
    // 4 Stakeholders: Survivor (TL), Caregiver (TR), Clinician (BL), ASHA Worker (BR)
    const STAKEHOLDERS: [number, number, number][] = [
      [-1.10, 0.44, 0.12],   // Survivor
      [1.10, 0.44, -0.12],   // Caregiver
      [-1.10, -0.44, -0.12],  // Clinician
      [1.10, -0.44, 0.12],   // ASHA worker
    ];

    const isCenter = d < 2;
    if (isCenter) {
      const cphi = Math.acos(2 * rEcoPhi - 1);
      const ct = rEcoTheta * Math.PI * 2;
      const crad = 0.32 * Math.cbrt(rEcoRad);
      positions[STATE.ecosystem][o] = Math.sin(cphi) * Math.cos(ct) * crad;
      positions[STATE.ecosystem][o + 1] = Math.cos(cphi) * crad * 0.82;
      positions[STATE.ecosystem][o + 2] = Math.sin(cphi) * Math.sin(ct) * crad;
    } else {
      const targetIdx = (d - 2) % 4;
      const targetNode = STAKEHOLDERS[targetIdx];
      const onConduit = rEcoStream < 0.42;
      if (onConduit) {
        const k = Math.pow(rEcoRad, 0.85);
        const bowY = Math.sin(k * Math.PI) * 0.14 * (targetNode[1] > 0 ? 1 : -1);
        positions[STATE.ecosystem][o] = targetNode[0] * k + (rEcoTheta - 0.5) * 0.08;
        positions[STATE.ecosystem][o + 1] = targetNode[1] * k + bowY + (rEcoPhi - 0.5) * 0.08;
        positions[STATE.ecosystem][o + 2] = targetNode[2] * k + (rDecayZ - 0.5) * 0.08;
      } else {
        const cphi = Math.acos(2 * rEcoPhi - 1);
        const ct = rEcoTheta * Math.PI * 2;
        const crad = 0.22 * Math.cbrt(rEcoRad);
        positions[STATE.ecosystem][o] = targetNode[0] + Math.sin(cphi) * Math.cos(ct) * crad;
        positions[STATE.ecosystem][o + 1] = targetNode[1] + Math.cos(cphi) * crad * 0.8;
        positions[STATE.ecosystem][o + 2] = targetNode[2] + Math.sin(cphi) * Math.sin(ct) * crad;
      }
    }

    // ── network ────────────────────────────────────────────────────────────────────
    // 3D Topographical terrain with rural peripheral homes and 3 regional hospital hubs:
    const REGIONAL_HUBS: [number, number, number][] = [
      [-1.15, 0.18, -0.18],
      [0.10, 0.24, 0.24],
      [1.20, 0.16, -0.12],
    ];

    const isHub = rNetHub < 0.32;
    if (isHub) {
      const hubIdx = Math.floor(rEcoTheta * REGIONAL_HUBS.length) % REGIONAL_HUBS.length;
      const hub = REGIONAL_HUBS[hubIdx];
      const hr = 0.22 * Math.sqrt(rEcoRad);
      const ha = rEcoPhi * Math.PI * 2;
      positions[STATE.network][o] = hub[0] + Math.cos(ha) * hr;
      positions[STATE.network][o + 1] = hub[1] + Math.sin(ha) * hr * 0.55;
      positions[STATE.network][o + 2] = hub[2] + (rDecayZ - 0.5) * 0.14;
    } else {
      const onArc = rNetArc < 0.36;
      const netX = (rNetX - 0.5) * 3.6;
      const netZ = (rNetZ - 0.5) * 2.1;
      const terrainY = -0.32 + 0.12 * Math.sin(netX * 1.7) * Math.cos(netZ * 2.1);

      if (onArc) {
        let nearestHub = REGIONAL_HUBS[0];
        let minDist = 999;
        for (const h of REGIONAL_HUBS) {
          const dist = Math.hypot(netX - h[0], netZ - h[2]);
          if (dist < minDist) { minDist = dist; nearestHub = h; }
        }
        const k = rEcoRad;
        const arcY = terrainY * (1 - k) + nearestHub[1] * k + 0.50 * Math.sin(k * Math.PI);
        positions[STATE.network][o] = netX * (1 - k) + nearestHub[0] * k + (rEcoTheta - 0.5) * 0.06;
        positions[STATE.network][o + 1] = arcY + (rEcoPhi - 0.5) * 0.06;
        positions[STATE.network][o + 2] = netZ * (1 - k) + nearestHub[2] * k + (rDecayZ - 0.5) * 0.06;
      } else {
        positions[STATE.network][o] = netX + (rEcoTheta - 0.5) * 0.12;
        positions[STATE.network][o + 1] = terrainY + (rEcoPhi - 0.5) * 0.08;
        positions[STATE.network][o + 2] = netZ + (rDecayZ - 0.5) * 0.12;
      }
    }
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
    flow,
    risk,
    lines: buildLines(positions[STATE.cortex], Math.min(hubs, count)),
    extent,
  };
}

/**
 * Structural lines between the first `hubs` points, joined to their two nearest
 * neighbours in the CORTEX arrangement — but only where those neighbours are actually
 * near, which is what `maxLength` is for.
 *
 * Built from one arrangement and reused for all seven on purpose: the lines are indices,
 * so they follow their endpoints. A line that joined two readings in the cortex becomes
 * the line that joins two days in the ribbon, two people in the ecosystem, and a
 * household to a hub in the network — which is the continuity the page is arguing for,
 * drawn rather than asserted.
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

/**
 * The warm the field moves to when something is a finding: a domain the visitor is
 * inspecting on a morning it deviates, and the band on the vessel where flow stops.
 *
 * One accent for both, and only ever one. The affected territory in the first act does
 * NOT turn red — it stops being lit, which is what an unperfused territory looks like on
 * every real study of one and is also the honest register for the page. A field that goes
 * scarlet reads as an alarm, and this product's whole argument is that it is careful
 * about when it raises one.
 */
export const FLARE_RGB = new Float32Array([0.898, 0.639, 0.239]); // #E8A33D, the WATCH token
