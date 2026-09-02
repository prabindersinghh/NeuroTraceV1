/**
 * The neural field: the geometry and the signal model behind the sign-in screen's canvas.
 *
 * WHAT IT IS. A small network of nodes on a brain-shaped shell in three dimensions, joined
 * to their nearest neighbours, with signals travelling along the joins. The canvas
 * component (`components/auth/NeuralField.tsx`) projects and draws; everything that can
 * be reasoned about without a canvas lives here so it can be tested in Node.
 *
 * WHAT IT IS NOT. It is not a picture of anyone's brain, not a readout, and not a claim.
 * The product's own argument — "compare a person to themselves, and refuse to alarm on one
 * signal" — is drawn to scale on the landing page (`TraceLanes`). This is the same
 * instrument palette used decoratively: an organism that quietly responds to the person
 * in front of it. It is `aria-hidden` and nothing depends on it.
 *
 * NO LIBRARY, ON PURPOSE. D-039: motion is one rAF ticker, not an animation library, and
 * three.js is ~150 kB gzipped for a hundred dots and a few hundred lines. A perspective
 * projection is four multiplications. The whole thing is a few kilobytes and shares the
 * app's reduced-motion and coarse-pointer gating instead of needing its own.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface Field {
  nodes: Vec3[];
  /** Undirected, deduplicated, `a < b`. */
  edges: [number, number][];
  /** Edge indices touching each node. */
  adjacency: number[][];
}

/** mulberry32: tiny, seedable, good enough for placement. Same seed, same field. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Nodes on a shell shaped like a cortex seen from above-front: wider than tall, a little
 * deeper than tall, with a shallow cleft down the middle. Fibonacci placement gives an even
 * spread; the radius jitter puts some nodes slightly inside the shell so the network has
 * depth rather than reading as a wireframe globe.
 */
export function createField(seed: number, count: number, neighbours = 2): Field {
  const rng = mulberry32(seed);
  const nodes: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i + rng() * 0.35;
    const r = 0.82 + rng() * 0.18;
    let x = Math.cos(theta) * ring * r;
    const z = Math.sin(theta) * ring * r;
    // The cleft: push each hemisphere outward a touch so a gap opens along x = 0. The two
    // poles sit exactly on the axis, so they are assigned a side rather than left in it.
    x = x * 1.18 + (x >= 0 ? 0.06 : -0.06);
    nodes.push({ x, y: y * r * 0.86, z: z * 0.95 });
  }

  const edgeKeys = new Set<number>();
  const edges: [number, number][] = [];
  const add = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * count + hi;
    if (lo === hi || edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push([lo, hi]);
  };
  for (let i = 0; i < count; i++) {
    const p = nodes[i];
    const byDistance = nodes
      .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d);
    // Two guaranteed neighbours, and a third about half the time so the mesh has a few
    // branch points rather than being a set of chains.
    const want = neighbours + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < want && k < byDistance.length; k++) add(i, byDistance[k].j);
  }

  const adjacency: number[][] = Array.from({ length: count }, () => []);
  edges.forEach(([a, b], e) => { adjacency[a].push(e); adjacency[b].push(e); });
  return { nodes, edges, adjacency };
}

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale, ~0.6 at the back of the shell to ~1.4 at the front. */
  s: number;
  /** Rotated depth, negative is nearer the viewer. */
  z: number;
}

/**
 * Yaw about the vertical axis, pitch about the horizontal, then a simple perspective
 * divide. `zoom` is half the shell's on-screen size in CSS px.
 */
export function project(
  p: Vec3, yaw: number, pitch: number, cx: number, cy: number, zoom: number,
): Projected {
  const cy1 = Math.cos(yaw);
  const sy1 = Math.sin(yaw);
  const x1 = p.x * cy1 + p.z * sy1;
  const z1 = -p.x * sy1 + p.z * cy1;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;
  const focal = 3.2;
  const s = focal / (focal + z2);
  return { x: cx + x1 * s * zoom, y: cy + y2 * s * zoom, s, z: z2 };
}

export interface Signal {
  edge: number;
  /** The node the signal left; it travels toward the edge's other end. */
  from: number;
  /** 0 at `from`, 1 at the far node. */
  t: number;
  hops: number;
}

export interface SignalState {
  signals: Signal[];
  /** Fractional spawns carried between frames so a low rate still fires eventually. */
  budget: number;
}

export interface Activity {
  /** New signals per second. */
  rate: number;
  /** Edges per second. */
  speed: number;
  /** Probability a signal continues onto a neighbouring edge when it arrives. */
  branch: number;
  maxHops: number;
}

/**
 * How the field behaves in each state of the form. The numbers were tuned by eye; what
 * matters is the ORDER: an attentive field when someone starts typing, a busier one while
 * the server is checking, and a calm, sparse one once they are in.
 */
export const ACTIVITY = {
  /** Nobody is doing anything. A slow ambient trickle. */
  idle: { rate: 1.1, speed: 0.55, branch: 0.55, maxHops: 4 },
  /** A field has focus: the network is paying attention. */
  attentive: { rate: 2.4, speed: 0.7, branch: 0.7, maxHops: 5 },
  /** The password field: fewer, longer, more deliberate paths. */
  structured: { rate: 1.6, speed: 0.6, branch: 0.92, maxHops: 9 },
  /** Waiting on the server. */
  busy: { rate: 5, speed: 1.1, branch: 0.75, maxHops: 6 },
  /** Signed in. Converging to quiet. */
  settled: { rate: 0.35, speed: 0.5, branch: 0.3, maxHops: 2 },
  /** Something went wrong: a short lull, then back to idle. */
  error: { rate: 0.4, speed: 0.4, branch: 0.2, maxHops: 1 },
} as const satisfies Record<string, Activity>;

export type FieldMode = keyof typeof ACTIVITY;

/** Advance every signal by `dt` seconds and spawn new ones. Pure: returns a new state. */
export function stepSignals(
  state: SignalState,
  field: Field,
  dt: number,
  activity: Activity,
  rng: () => number,
  maxSignals: number,
): SignalState {
  const next: Signal[] = [];
  for (const s of state.signals) {
    let t = s.t + activity.speed * dt;
    if (t < 1) { next.push({ ...s, t }); continue; }
    // Arrived. Continue from the far node onto a different edge, or fade out.
    const [a, b] = field.edges[s.edge];
    const at = s.from === a ? b : a;
    if (s.hops + 1 >= activity.maxHops || rng() >= activity.branch) continue;
    const options = field.adjacency[at].filter((e) => e !== s.edge);
    if (!options.length) continue;
    const edge = options[Math.floor(rng() * options.length)];
    t -= 1;
    next.push({ edge, from: at, t: Math.min(t, 0.999), hops: s.hops + 1 });
  }

  let budget = state.budget + activity.rate * dt;
  while (budget >= 1 && next.length < maxSignals && field.edges.length) {
    budget -= 1;
    const edge = Math.floor(rng() * field.edges.length);
    const [a, b] = field.edges[edge];
    next.push({ edge, from: rng() < 0.5 ? a : b, t: 0, hops: 0 });
  }
  // A rate the frame budget cannot honour must not pile up into a burst later.
  if (next.length >= maxSignals) budget = Math.min(budget, 1);

  return { signals: next, budget };
}

/** Exponential approach: the value never overshoots and settles in ~`3 / rate` seconds. */
export function approach(current: number, target: number, dt: number, rate: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/**
 * How many nodes a device should get. Coarse pointers are phones, where the field is a
 * band above the form and the GPU is shared with the keyboard animation; low core counts
 * and Data Saver are the handsets this product is actually used on.
 */
export function nodeBudget(opts: { coarse: boolean; cores: number; saveData: boolean }): number {
  if (opts.saveData) return 0;
  if (opts.cores > 0 && opts.cores <= 2) return 0;
  if (opts.coarse) return 44;
  if (opts.cores > 0 && opts.cores <= 4) return 60;
  return 96;
}
