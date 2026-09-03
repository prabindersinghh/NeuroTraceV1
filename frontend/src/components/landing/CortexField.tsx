/**
 * The page's one continuous visual, drawn on the GPU.
 *
 * WHY RAW WebGL AND NOT A LIBRARY. D-039 rejected GSAP and D-064 rejected three.js for
 * this codebase, both for the same reason: the signed-out landing shares a service worker
 * with a clinical PWA that already precaches 45 MB of models, and the page's own argument
 * is that this product runs on a cheap phone in a place with no neurologist. ~150 kB of
 * scene graph buys nothing here — the whole renderer is two `gl.drawArrays` calls, and
 * the geometry it draws is `lib/cortex.ts`, which is testable in Node because it never
 * touches a GL context.
 *
 * WHY THE MORPH IS FREE. All six arrangements live on the GPU at once as six position
 * attributes. Scrolling changes six floats — the blend weights — and nothing else. There
 * is no per-frame work on the CPU proportional to the point count, so eighteen thousand
 * points cost the same to scrub as five hundred.
 *
 * IMPERATIVE ON PURPOSE, like `TraceLanes`. The state is NOT a prop. Scrubbing it through
 * React would reconcile the section's paragraphs sixty times a second for a picture whose
 * only change is a uniform. The parent calls `ref.current.setState(n)` from the scroll
 * ticker and React is not involved between mount and unmount.
 *
 * WHAT IT COSTS THE USER, AND WHEN IT REFUSES TO RUN AT ALL.
 *   · nothing before the canvas is near the viewport — the field is built lazily;
 *   · nothing while it is off-screen or the tab is hidden — the loop is stopped, not idled;
 *   · nothing on a device `particleBudget` declines (Data Saver, ≤2 cores, ≤2 GB), on a
 *     browser without WebGL2, or under `prefers-reduced-motion` — all three fall through
 *     to the same still plate, which is a real picture and not a degraded one;
 *   · at most 30 fps on a coarse pointer, where the GPU is shared with the scroller.
 *
 * It is `aria-hidden`: every word it illustrates is real text elsewhere on the page.
 */
import {
  forwardRef, useEffect, useImperativeHandle, useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  DOMAIN_COUNT, DOMAIN_RGB, FLARE_RGB, STATE, STATE_COUNT, STATE_VIEW,
  createField, particleBudget, readDevice, stateWeights, type Field,
} from "@/lib/cortex";
import { approach, project } from "@/lib/neural";
import { useCoarsePointer, usePrefersReducedMotion } from "@/lib/motion";

const PLATE = "#0A121C";

/* ─────────────────────────────────────────────────────────────────────── shaders */

const POINT_VS = `#version 300 es
in vec3 p0; in vec3 p1; in vec3 p2; in vec3 p3; in vec3 p4; in vec3 p5;
in float aDomain; in float aSeed; in float aSize;
uniform float uW[6];
uniform mat3 uRot;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uTime;
uniform float uDrift;
uniform float uDpr;
uniform float uFlare[7];
uniform vec3 uDomainRgb[7];
uniform vec3 uFlareRgb;
// Pointer in the same device-pixel space as "screen", and 0/1 for whether it is over.
uniform vec2 uPointer;
uniform float uPointerOn;
out vec4 vColor;

void main() {
  vec3 p = p0 * uW[0] + p1 * uW[1] + p2 * uW[2]
         + p3 * uW[3] + p4 * uW[4] + p5 * uW[5];

  // The breath. Phase is per-point and constant, so the cloud never pulses in unison —
  // a field that breathes together reads as a logo, not as an organism.
  float ph = aSeed * 6.2831853;
  p += vec3(sin(uTime * 0.42 + ph),
            cos(uTime * 0.37 + ph * 1.7),
            sin(uTime * 0.29 + ph * 2.3)) * uDrift;

  vec3 r = uRot * p;
  float s = 3.2 / (3.2 + r.z);              // the perspective divide, four multiplications
  vec2 screen = uCenter + vec2(r.x, -r.y) * s * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  // THE CURSOR'S WAKE. A falloff in screen space, so the points nearest the pointer grow
  // and brighten and the cloud reads as something being touched rather than something
  // being watched. Screen space, not world space, on purpose: it costs one distance per
  // vertex with no CPU work and no second pass, and it tracks what the eye is actually
  // near rather than what is geometrically close behind the shell.
  float reach = min(uViewport.x, uViewport.y) * 0.30;
  float glow = uPointerOn * (1.0 - smoothstep(0.0, reach, distance(screen, uPointer)));
  glow *= glow;                              // tighter core, so it is a touch, not a wash

  gl_PointSize = max(1.0, aSize * (0.55 + s * 1.4) * 1.72 * uDpr * (1.0 + glow * 1.15));

  int d = int(aDomain);
  float f = uFlare[d];
  // Depth carries brightness rather than a fog colour: the plate has no atmosphere to
  // tint toward, and alpha is the only channel that survives additive blending honestly.
  float depth = clamp((s - 0.66) / 0.78, 0.0, 1.0);
  // Raised from 0.18/0.45, then pulled back. At the old floor a point on the far face of
  // the shell carried 0.18 alpha into an ADDITIVE blend, which on the near-black plate is
  // very nearly nothing, so the cloud read as bright specks with emptiness behind them
  // rather than a volume with a far side.
  //
  // But alpha and count multiply here. Raising the budget ~1.55x and the floor ~1.67x at
  // the same time put roughly three times the light on the plate and the two lobes
  // saturated to flat white — denser, and LESS legible, because blowout destroys exactly
  // the depth the density was added to show. Density carries visibility now and the floor
  // only has to lift the far face off the background, so these are lower than a
  // brightness-only pass would set them. Judged on a screenshot, not from the numbers.
  vColor = vec4(mix(uDomainRgb[d], uFlareRgb, max(f, glow * 0.55)),
                (0.225 + depth * depth * 0.43) * (1.0 + f * 2.2) * (1.0 + glow * 0.85));
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 frag;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q);
  if (r2 > 0.25) discard;                    // round, not square — cheaper than a texture
  frag = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.05, 0.25, r2)));
}`;

const LINE_VS = `#version 300 es
in vec3 p0; in vec3 p1; in vec3 p2; in vec3 p3; in vec3 p4; in vec3 p5;
in float aT; in float aSeed; in float aDomain;
uniform float uW[6];
uniform mat3 uRot;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec3 uDomainRgb[7];
out float vT;
out float vSeed;
out vec3 vRgb;
out float vDepth;
void main() {
  vec3 p = p0 * uW[0] + p1 * uW[1] + p2 * uW[2]
         + p3 * uW[3] + p4 * uW[4] + p5 * uW[5];
  vec3 r = uRot * p;
  float s = 3.2 / (3.2 + r.z);
  vec2 screen = uCenter + vec2(r.x, -r.y) * s * uZoom;
  gl_Position = vec4(screen.x / uViewport.x * 2.0 - 1.0,
                     1.0 - screen.y / uViewport.y * 2.0, 0.0, 1.0);
  vT = aT;
  vSeed = aSeed;
  vRgb = uDomainRgb[int(aDomain)];
  vDepth = clamp((s - 0.70) / 0.75, 0.0, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in float vT;
in float vSeed;
in vec3 vRgb;
in float vDepth;
uniform float uTime;
uniform float uLineAlpha;
out vec4 frag;
void main() {
  // The signal. One travelling head per connection, its phase fixed per line, so the
  // network reads as carrying traffic rather than as flashing.
  float head = fract(uTime * 0.19 + vSeed);
  float d = vT - head;
  float pulse = exp(-d * d * 300.0);
  float a = uLineAlpha * (0.09 + vDepth * vDepth * 0.14 + pulse * 0.75);
  frag = vec4(vRgb + pulse * 0.35, a);
}`;

/* ───────────────────────────────────────────────────────────────────── gl helpers */

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // A driver that refuses one of these is not an error the visitor should experience as
    // a blank rectangle; the caller falls through to the still plate.
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Link a program and DO NOT ask whether it worked.
 *
 * That omission is the whole point. `getProgramParameter(LINK_STATUS)` blocks until the
 * driver has finished compiling, and compiling even these two small shaders is the single
 * most expensive thing this component does: measured at 1.5 s on a software rasteriser,
 * and tens of milliseconds on the cheap Android hardware this product is actually for.
 * Asking inside the scroll handler turns that into a visible stall exactly as the section
 * arrives. The caller polls `linked()` on later frames instead.
 */
function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

/**
 * Has the driver finished with this program?
 *
 * With `KHR_parallel_shader_compile` this is a non-blocking poll and the compile happens
 * on a driver thread. Without it there is nothing to poll, so the answer is "yes" and the
 * caller's `LINK_STATUS` query blocks — but by then it is in its own animation frame
 * rather than in the middle of a scroll, which is most of the win.
 */
function linked(
  gl: WebGL2RenderingContext,
  parallel: { COMPLETION_STATUS_KHR: number } | null,
  program: WebGLProgram | null,
): boolean {
  if (!program) return true;
  if (!parallel) return true;
  return gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR) === true;
}

/** Yaw about the vertical axis then pitch about the horizontal, column-major for GL. */
function rotation(yaw: number, pitch: number, out: Float32Array): Float32Array {
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const cp = Math.cos(pitch); const sp = Math.sin(pitch);
  out[0] = cy;       out[1] = sy * sp;   out[2] = -sy * cp;
  out[3] = 0;        out[4] = cp;        out[5] = sp;
  out[6] = sy;       out[7] = -cy * sp;  out[8] = cy * cp;
  return out;
}

/* ──────────────────────────────────────────────────────────────── the still plate */

/**
 * What a visitor sees with no WebGL2, on a device the budget declines, or under
 * `prefers-reduced-motion`. It is the cortex arrangement drawn once with the 2D context —
 * the same geometry, the same palette, holding still. Not a spinner and not an apology.
 */
function drawStill(canvas: HTMLCanvasElement, field: Field, w: number, h: number, dpr: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  const zoom = Math.min(w * 0.35 / field.extent[STATE.cortex * 2],
                        h * 0.35 / field.extent[STATE.cortex * 2 + 1]);
  const positions = field.positions[STATE.cortex];
  const order: { x: number; y: number; s: number; d: number }[] = [];
  for (let i = 0; i < field.count; i += 1) {
    const p = project(
      { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] },
      STATE_VIEW[STATE.cortex * 2], STATE_VIEW[STATE.cortex * 2 + 1], w / 2, h / 2, zoom,
    );
    order.push({ x: p.x, y: p.y, s: p.s, d: field.domain[i] });
  }
  order.sort((a, b) => a.s - b.s);          // far to near, so the front of the shell reads
  for (const p of order) {
    const depth = Math.min(1, Math.max(0, (p.s - 0.70) / 0.75));
    const c = p.d * 3;
    ctx.fillStyle = `rgba(${Math.round(DOMAIN_RGB[c] * 255)},${Math.round(DOMAIN_RGB[c + 1] * 255)},`
      + `${Math.round(DOMAIN_RGB[c + 2] * 255)},${(0.14 + depth * 0.5).toFixed(3)})`;
    const r = 0.5 + depth * 1.3;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
  }
}

/* ───────────────────────────────────────────────────────────────────── component */

export interface CortexHandle {
  /** 0..5, fractional. `STATE.<name>` names the integers. */
  setState: (state: number) => void;
  /** Per-domain flare, 0..1, seven long — or null to clear. */
  setFlare: (weights: ArrayLike<number> | null) => void;
  /** Pointer position over the plate in 0..1, or null. Tilts the field. Ignored on touch. */
  setPointer: (x: number | null, y?: number) => void;
}

export interface CortexFieldProps {
  /** The arrangement to start in, and the one the still plate draws. */
  initialState?: number;
  /** Multiplies the fitted size. Under 1 leaves air around the cloud. */
  zoom?: number;
  /**
   * Fraction of the device budget to actually draw. A small plate wants a fraction of a
   * full-screen scene's points — the same count in a 280 px band is a solid wash, and
   * paying for it is worse than pointless.
   */
  density?: number;
  /** Lines are structure; turn them off where the arrangement is about mass, not joins. */
  lines?: boolean;
  className?: string;
}

export const CortexField = forwardRef<CortexHandle, CortexFieldProps>(function CortexField(
  { initialState = STATE.cortex, zoom = 1, density = 1, lines = true, className },
  handleRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Last pointer sample, for the drag delta. Null between drags. */
  const last = useRef<{ x: number; y: number } | null>(null);

  // Targets the visitor steers, and the eased values actually drawn. Refs, not state:
  // nothing here may cause a render.
  const target = useRef({
    state: initialState, pointerX: 0, pointerY: 0, hasPointer: false,
    /** Orbit the visitor has dragged in, and the velocity it keeps when they let go. */
    dragYaw: 0, dragPitch: 0, velYaw: 0, velPitch: 0, dragging: false,
  });
  const flareTarget = useRef(new Float32Array(DOMAIN_COUNT));
  const reduced = usePrefersReducedMotion();
  const coarse = useCoarsePointer();

  useImperativeHandle(handleRef, () => ({
    setState: (state) => { target.current.state = state; },
    setFlare: (weights) => {
      const buffer = flareTarget.current;
      if (!weights) { buffer.fill(0); return; }
      for (let i = 0; i < DOMAIN_COUNT; i += 1) buffer[i] = weights[i] ?? 0;
    },
    setPointer: (x, y = 0.5) => {
      target.current.hasPointer = x !== null;
      if (x !== null) { target.current.pointerX = x; target.current.pointerY = y; }
    },
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    let disposed = false;
    let raf = 0;
    let field: Field | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let visible = false;
    /**
     * Which renderer owns the canvas.
     *
     * This exists because of a bug worth remembering: a `<canvas>` can only ever hand out
     * ONE kind of context. `ResizeObserver` delivers a first entry as soon as you observe,
     * so the still plate painted a 2D context onto the canvas before the intersection
     * observer had a chance to ask for WebGL — and every `getContext("webgl2")` after that
     * returned null, forever, on every device. The symptom was not an error: it was the
     * fallback quietly rendering everywhere, which is exactly the kind of failure that
     * ships. Nothing may touch the canvas while this is "pending".
     */
    let mode: "pending" | "gl" | "still" = "pending";
    /** True between `start` and `build` — a second `start` in that window must not run. */
    let building = false;
    /** Set once the scene is built. Kept so scrolling back re-enters the loop rather than
     *  rebuilding eighteen thousand points every time the plate crosses the viewport. */
    let render: ((now: number) => void) | null = null;
    /** Frame clock, outside `start` so `resume` can reset it — a plate that has been
     *  off-screen for a minute must not receive a one-minute `dt` on its first frame. */
    let last = 0;
    /** Every GL object we made, so teardown is a loop and not a checklist. */
    const owned: { buffers: WebGLBuffer[]; vaos: WebGLVertexArrayObject[]; programs: WebGLProgram[] } =
      { buffers: [], vaos: [], programs: [] };

    let cssW = 0;
    let cssH = 0;
    let dpr = 1;

    const measure = () => {
      cssW = box.clientWidth;
      cssH = box.clientHeight;
      // Capped at 2 — a 3x phone gains nothing visible on a point cloud and pays three
      // times the fill rate. Capped harder on touch, where the GPU is also scrolling.
      dpr = Math.min(coarse ? 1.5 : 2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      return cssW > 0 && cssH > 0;
    };

    /* ---------------------------------------------------------------- still path */
    const still = () => {
      mode = "still";
      if (!measure()) return;
      if (!field) field = createField(Math.min(2200, budget || 2200), 42);
      drawStill(canvas, field, cssW, cssH, dpr);
    };

    const device = readDevice();
    const budget = Math.round(particleBudget(device) * density);

    /* ------------------------------------------------------------------ live path */
    const start = () => {
      if (disposed || gl || building) return;
      if (!measure()) return;

      gl = canvas.getContext("webgl2", {
        alpha: true, antialias: false, depth: false, stencil: false,
        premultipliedAlpha: false, powerPreference: "low-power",
        preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true,
      });
      // No WebGL2, or a context with a performance caveat we declined: the canvas is still
      // untouched, so the still plate can take a 2D context on it cleanly.
      if (!gl) { still(); return; }
      const pointProgram = link(gl, POINT_VS, POINT_FS);
      const lineProgram = lines ? link(gl, LINE_VS, LINE_FS) : null;
      if (!pointProgram) { gl = null; still(); return; }
      owned.programs.push(pointProgram);
      if (lineProgram) owned.programs.push(lineProgram);
      const parallel = gl.getExtension("KHR_parallel_shader_compile") as
        { COMPLETION_STATUS_KHR: number } | null;
      building = true;
      requestAnimationFrame(function wait() {
        if (disposed || !gl) return;
        if (!linked(gl, parallel, pointProgram) || !linked(gl, parallel, lineProgram)) {
          requestAnimationFrame(wait);
          return;
        }
        building = false;
        build(pointProgram, lineProgram);
      });
    };

    /**
     * Everything that needs a linked program: geometry, buffers, uniforms, the loop.
     *
     * Split out of `start` so the driver's compile can overlap with the frames either
     * side of it rather than blocking the one the visitor is scrolling in.
     */
    const build = (pointProgram: WebGLProgram, lineProgram: WebGLProgram | null) => {
      if (!gl || disposed) return;
      if (!gl.getProgramParameter(pointProgram, gl.LINK_STATUS)
        || (lineProgram && !gl.getProgramParameter(lineProgram, gl.LINK_STATUS))) {
        // A driver that refused these shaders after accepting the context is rare enough
        // that there is no clean recovery: the canvas already holds a GL context, so the
        // still plate cannot take a 2D one on it. The plate keeps its own background and
        // the page loses only the picture, which nothing on it depends on.
        gl = null;
        mode = "still";
        return;
      }
      mode = "gl";
      field = createField(budget, 42);
      const context = gl;

      const buffer = (data: Float32Array<ArrayBuffer>) => {
        const b = context.createBuffer()!;
        owned.buffers.push(b);
        context.bindBuffer(context.ARRAY_BUFFER, b);
        context.bufferData(context.ARRAY_BUFFER, data, context.STATIC_DRAW);
        return b;
      };
      /** Bind one float attribute, tolerating a shader that optimised it away (loc -1). */
      const attrib = (program: WebGLProgram, name: string, b: WebGLBuffer, size: number) => {
        const loc = context.getAttribLocation(program, name);
        if (loc < 0) return;
        context.bindBuffer(context.ARRAY_BUFFER, b);
        context.enableVertexAttribArray(loc);
        context.vertexAttribPointer(loc, size, context.FLOAT, false, 0, 0);
      };

      // ── points VAO
      const pointVao = context.createVertexArray()!;
      owned.vaos.push(pointVao);
      context.bindVertexArray(pointVao);
      const stateBuffers = field.positions.map((p) => buffer(p));
      stateBuffers.forEach((b, i) => attrib(pointProgram, `p${i}`, b, 3));
      attrib(pointProgram, "aDomain", buffer(field.domain), 1);
      attrib(pointProgram, "aSeed", buffer(field.seed), 1);
      attrib(pointProgram, "aSize", buffer(field.size), 1);

      // ── lines VAO. Endpoints are duplicated into their own buffers rather than drawn
      // with an index buffer, because the two ends need DIFFERENT values of `aT` — that
      // parameter is what lets the fragment shader run a signal along the connection.
      let lineVao: WebGLVertexArrayObject | null = null;
      let lineVertexCount = 0;
      if (lineProgram && field.lines.length) {
        lineVertexCount = field.lines.length;
        lineVao = context.createVertexArray()!;
        owned.vaos.push(lineVao);
        context.bindVertexArray(lineVao);
        for (let s = 0; s < STATE_COUNT; s += 1) {
          const packed = new Float32Array(lineVertexCount * 3);
          for (let v = 0; v < lineVertexCount; v += 1) {
            const src = field.lines[v] * 3;
            packed[v * 3] = field.positions[s][src];
            packed[v * 3 + 1] = field.positions[s][src + 1];
            packed[v * 3 + 2] = field.positions[s][src + 2];
          }
          attrib(lineProgram, `p${s}`, buffer(packed), 3);
        }
        const t = new Float32Array(lineVertexCount);
        const lineSeed = new Float32Array(lineVertexCount);
        const lineDomain = new Float32Array(lineVertexCount);
        for (let v = 0; v < lineVertexCount; v += 1) {
          t[v] = v % 2;                                   // 0 at one end, 1 at the other
          lineSeed[v] = field.seed[field.lines[v - (v % 2)]];   // both ends share a phase
          lineDomain[v] = field.domain[field.lines[v]];
        }
        attrib(lineProgram, "aT", buffer(t), 1);
        attrib(lineProgram, "aSeed", buffer(lineSeed), 1);
        attrib(lineProgram, "aDomain", buffer(lineDomain), 1);
      }
      context.bindVertexArray(null);

      const uniforms = (program: WebGLProgram) => ({
        w: context.getUniformLocation(program, "uW"),
        rot: context.getUniformLocation(program, "uRot"),
        viewport: context.getUniformLocation(program, "uViewport"),
        center: context.getUniformLocation(program, "uCenter"),
        zoom: context.getUniformLocation(program, "uZoom"),
        time: context.getUniformLocation(program, "uTime"),
        drift: context.getUniformLocation(program, "uDrift"),
        dpr: context.getUniformLocation(program, "uDpr"),
        flare: context.getUniformLocation(program, "uFlare"),
        domainRgb: context.getUniformLocation(program, "uDomainRgb"),
        flareRgb: context.getUniformLocation(program, "uFlareRgb"),
        lineAlpha: context.getUniformLocation(program, "uLineAlpha"),
        pointer: context.getUniformLocation(program, "uPointer"),
        pointerOn: context.getUniformLocation(program, "uPointerOn"),
      });
      const pointU = uniforms(pointProgram);
      const lineU = lineProgram ? uniforms(lineProgram) : null;

      context.disable(context.DEPTH_TEST);
      context.enable(context.BLEND);
      // Additive. On a near-black plate this is what makes density read as depth — the
      // front of the shell is brighter because more of it is there, not because it was
      // coloured differently.
      context.blendFunc(context.SRC_ALPHA, context.ONE);

      const weights = new Float32Array(STATE_COUNT);
      const rot = new Float32Array(9);
      const flare = new Float32Array(DOMAIN_COUNT);
      const shown = {
        state: initialState,
        yaw: STATE_VIEW[Math.round(initialState) * 2],
        pitch: STATE_VIEW[Math.round(initialState) * 2 + 1],
        pointerOn: 0,
      };
      let clock = 0;
      let nextFrame = 0;

      render = (now: number) => {
        raf = requestAnimationFrame(render!);
        // Half rate on touch: the scroller and the compositor want the same GPU, and a
        // 30 fps cloud behind text is indistinguishable from 60 while costing half.
        if (coarse) {
          if (now < nextFrame) return;
          nextFrame = now + 33;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!reduced) clock += dt;

        measure();
        const t = target.current;
        shown.state = approach(shown.state, t.state, dt, 7);
        stateWeights(shown.state, weights);
        // The camera each arrangement wants, blended by the same weights as the cloud.
        let baseYaw = 0;
        let basePitch = 0;
        for (let i = 0; i < STATE_COUNT; i += 1) {
          baseYaw += weights[i] * STATE_VIEW[i * 2];
          basePitch += weights[i] * STATE_VIEW[i * 2 + 1];
        }
        // THE THROW. Let go mid-drag and the cloud keeps turning and settles, instead of
        // stopping dead under your finger — the difference between a control and a widget.
        // Framerate-independent decay: `pow` per second, not a constant per frame, or the
        // same gesture would coast twice as far on a 120 Hz panel.
        if (!t.dragging) {
          t.dragYaw += t.velYaw * dt;
          t.dragPitch += t.velPitch * dt;
          const decay = Math.pow(0.015, dt);
          t.velYaw *= decay;
          t.velPitch *= decay;
          if (Math.abs(t.velYaw) < 1e-4) t.velYaw = 0;
          if (Math.abs(t.velPitch) < 1e-4) t.velPitch = 0;
        }
        // Pitch is clamped; yaw is not. Turning the shell past vertical reads as broken,
        // but spinning it right round is exactly what someone will try first.
        t.dragPitch = Math.max(-0.85, Math.min(0.85, t.dragPitch));

        // Hover tilt stays fine-pointer-only — on touch the finger IS the drag, and
        // adding a tilt on top of it would fight the gesture.
        const hover = t.hasPointer && !coarse && !t.dragging;
        const wantYaw = baseYaw + (hover ? (t.pointerX - 0.5) * 0.8 : 0) + t.dragYaw;
        const wantPitch = basePitch + (hover ? (t.pointerY - 0.5) * 0.38 : 0) + t.dragPitch;
        // Eased so the wake fades in and out rather than popping on at the edge.
        shown.pointerOn = approach(shown.pointerOn, t.hasPointer ? 1 : 0, dt, 6);
        const sway = reduced ? 0 : Math.sin(clock * 0.075) * 0.09;
        shown.yaw = approach(shown.yaw, wantYaw + sway, dt, 3);
        shown.pitch = approach(shown.pitch, wantPitch, dt, 3);
        for (let i = 0; i < DOMAIN_COUNT; i += 1) {
          flare[i] = approach(flare[i], flareTarget.current[i], dt, 9);
        }

        rotation(shown.yaw, shown.pitch, rot);
        // Fit the arrangement the visitor is actually looking at, blended across the two
        // that are live. 0.35 rather than 0.5 leaves room for the perspective divide,
        // which makes the near face of the cloud up to half again as large.
        let hx = 0;
        let hy = 0;
        for (let i = 0; i < STATE_COUNT; i += 1) {
          hx += weights[i] * field!.extent[i * 2];
          hy += weights[i] * field!.extent[i * 2 + 1];
        }
        const fit = Math.min(cssW * 0.35 / hx, cssH * 0.35 / hy) * zoom * dpr;

        context.viewport(0, 0, canvas.width, canvas.height);
        context.clearColor(0, 0, 0, 0);
        context.clear(context.COLOR_BUFFER_BIT);

        // Lines under points, and only where the arrangement is ABOUT structure: the
        // scatter and reach states are about mass and a mesh there would assert a
        // coherence the page is at that moment saying does not exist.
        const structure = weights[STATE.cortex] + weights[STATE.ecosystem] * 0.85
          + weights[STATE.pathway] * 0.5 + weights[STATE.domains] * 0.2;
        if (lineVao && lineProgram && lineU && structure > 0.01) {
          context.useProgram(lineProgram);
          context.uniform1fv(lineU.w, weights);
          context.uniformMatrix3fv(lineU.rot, false, rot);
          context.uniform2f(lineU.viewport, canvas.width, canvas.height);
          context.uniform2f(lineU.center, canvas.width / 2, canvas.height / 2);
          context.uniform1f(lineU.zoom, fit);
          context.uniform1f(lineU.time, clock);
          context.uniform1f(lineU.lineAlpha, structure);
          context.uniform3fv(lineU.domainRgb, DOMAIN_RGB);
          context.bindVertexArray(lineVao);
          context.drawArrays(context.LINES, 0, lineVertexCount);
        }

        context.useProgram(pointProgram);
        context.uniform1fv(pointU.w, weights);
        context.uniformMatrix3fv(pointU.rot, false, rot);
        context.uniform2f(pointU.viewport, canvas.width, canvas.height);
        context.uniform2f(pointU.center, canvas.width / 2, canvas.height / 2);
        context.uniform1f(pointU.zoom, fit);
        context.uniform1f(pointU.time, clock);
        // The scatter state wanders; everything after it has been organised and holds
        // still. The drift IS the difference between "unmeasured" and "measured".
        context.uniform1f(pointU.drift, reduced ? 0 : 0.012 + weights[STATE.scatter] * 0.05);
        context.uniform1f(pointU.dpr, dpr);
        context.uniform1fv(pointU.flare, flare);
        context.uniform3fv(pointU.domainRgb, DOMAIN_RGB);
        context.uniform3fv(pointU.flareRgb, FLARE_RGB);
        // Device pixels: `screen` in the shader is built from `uCenter`, which is the
        // canvas size, not the CSS size.
        context.uniform2f(pointU.pointer, t.pointerX * canvas.width, t.pointerY * canvas.height);
        context.uniform1f(pointU.pointerOn, shown.pointerOn);
        context.bindVertexArray(pointVao);
        context.drawArrays(context.POINTS, 0, field!.count);
        context.bindVertexArray(null);
      };
      resume();
    };

    const resume = () => {
      if (!raf && render && !disposed) { last = performance.now(); raf = requestAnimationFrame(render); }
    };
    const stop = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    };

    /* ------------------------------------------------------------------- lifecycle */
    // Nothing above runs until the plate is actually near the screen: on a page this
    // long, building eighteen thousand points for a canvas six sections down is work the
    // visitor pays for and may never see.
    if (reduced || budget === 0) {
      still();
      const ro = new ResizeObserver(still);
      ro.observe(box);
      return () => { disposed = true; ro.disconnect(); };
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { if (gl) resume(); else start(); }
      else stop();
    }, { rootMargin: "20% 0px" });
    io.observe(box);

    // A tab in the background still runs rAF in some browsers; a point cloud nobody is
    // looking at is the definition of a battery cost with no benefit.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (visible) resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Only ever repaints a canvas the still plate already owns. See `mode` above.
    const ro = new ResizeObserver(() => { if (mode === "still") still(); });
    ro.observe(box);

    return () => {
      disposed = true;
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      // Every buffer, VAO and program we created, then the context itself. A landing page
      // the visitor navigates away from must not leave a live GL context behind —
      // browsers cap them, and the sixteenth one silently kills the first.
      if (gl) {
        for (const b of owned.buffers) gl.deleteBuffer(b);
        for (const v of owned.vaos) gl.deleteVertexArray(v);
        for (const p of owned.programs) gl.deleteProgram(p);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        gl = null;
      }
      field = null;
    };
  }, [reduced, coarse, initialState, zoom, density, lines]);

  // `start()` is re-entered when the plate scrolls back in, so the loop restarts without
  // rebuilding the field — the guard at the top of it returns early once `gl` exists.
  /**
   * Interaction lives HERE rather than in each parent. Before this, `setPointer` was
   * called only by `HeroConsole`, so the six-act scroll cloud in `SignalScene` — the
   * largest thing on the page — could not be touched at all. One set of handlers on the
   * component means every instance is grabbable, present and future.
   *
   * `touchAction: "pan-y"` is the whole reason this is safe on a phone. The browser keeps
   * vertical panning for the page and gives us the horizontal axis, so dragging the cloud
   * sideways orbits it while a normal scroll still scrolls. Taking `none` here would trap
   * the visitor's thumb on a page whose entire argument is delivered by scrolling.
   */
  const localPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = target.current;
    t.dragging = true;
    t.velYaw = 0;
    t.velPitch = 0;
    last.current = { x: e.clientX, y: e.clientY };
    const p = localPointer(e);
    if (p) { t.pointerX = p.x; t.pointerY = p.y; t.hasPointer = true; }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = target.current;
    const p = localPointer(e);
    if (p) { t.pointerX = p.x; t.pointerY = p.y; t.hasPointer = true; }
    if (!t.dragging) return;
    const prev = last.current;
    last.current = { x: e.clientX, y: e.clientY };
    if (!prev) return;
    // Radians per pixel. Tuned so a drag across a hero-sized plate is a bit more than a
    // half turn — enough to feel like the cloud is in your hand, not enough to lose the
    // arrangement the section is currently making an argument about.
    const k = 0.0055;
    const dx = (e.clientX - prev.x) * k;
    const dy = (e.clientY - prev.y) * k * 0.6;
    t.dragYaw += dx;
    t.dragPitch += dy;
    // Velocity for the throw. Instantaneous delta is too noisy at high frame rates, so
    // it is smoothed toward the latest sample.
    t.velYaw = t.velYaw * 0.72 + dx * 26;
    t.velPitch = t.velPitch * 0.72 + dy * 26;
  };

  const endDrag = () => {
    target.current.dragging = false;
    last.current = null;
  };

  return (
    <div
      ref={boxRef}
      aria-hidden
      className={className}
      style={{ touchAction: "pan-y", cursor: coarse ? undefined : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => {
        endDrag();
        target.current.hasPointer = false;
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
});
