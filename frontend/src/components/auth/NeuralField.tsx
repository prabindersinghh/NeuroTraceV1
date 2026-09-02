/**
 * The neural field: a canvas of nodes on a brain-shaped shell with signals moving between
 * them, quietly responding to the person signing in. Geometry and the signal model are in
 * `lib/neural.ts` (tested); this file only projects, draws and schedules.
 *
 * WHAT IT RESPONDS TO
 *   `mode`       — which form control has focus, whether a request is in flight, and
 *                  whether it succeeded or failed. Activity ramps continuously between
 *                  states; nothing snaps.
 *   the pointer  — a fine pointer tilts the shell a few degrees toward the cursor and
 *                  brightens the node under it. Coarse pointers get neither: the field is
 *                  a band above the form on a phone and thumbs are not cursors.
 *   `settledAt`  — a timestamp; when it changes, one coherent pulse runs through the
 *                  network from the centre out. Sign-in succeeded.
 *
 * WHAT IT WILL NOT DO
 *   · Move under `prefers-reduced-motion`. It draws one frame and stops; a mode change
 *     draws one more. This is the surface a patient with vertigo signs in on (D-038).
 *   · Draw off-screen or in a background tab. The loop attaches only while the canvas is
 *     intersecting and the document is visible, and never runs above 30 fps on a phone.
 *   · Cost anything on a constrained handset. `nodeBudget` returns 0 on ≤2 cores or
 *     Data Saver, and the component draws a small static field once.
 *   · Matter. It is `aria-hidden`, has no handlers the form depends on, and if
 *     `getContext` returns null it renders an empty box.
 *
 * Palette: the accent and primary tokens read from the root at mount, so it is the same
 * blue as the button beside it. No gradients and no shadows — index.css states the rule,
 * and it holds here too; depth is carried by alpha and radius only.
 */
import { useEffect, useRef } from "react";

import {
  ACTIVITY, approach, createField, mulberry32, nodeBudget, project, stepSignals,
  type Activity, type FieldMode, type SignalState,
} from "@/lib/neural";
import { useCoarsePointer, usePrefersReducedMotion } from "@/lib/motion";

interface NeuralFieldProps {
  mode: FieldMode;
  /** Change this (e.g. `Date.now()`) to run the convergence pulse. */
  settledAt?: number;
  className?: string;
}

/** `--accent: 212 64% 50%` → a function of alpha. */
function tokenColour(name: string, fallback: string): (alpha: number) => string {
  const raw = typeof document === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = raw || fallback;
  return (alpha) => `hsl(${value} / ${alpha})`;
}

const SEED = 20260902;
const MAX_SIGNALS = 28;
/** Pointer influence on the shell's tilt, in radians. Small on purpose. */
const TILT = 0.22;

export function NeuralField({ mode, settledAt, className }: NeuralFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = usePrefersReducedMotion();
  const coarse = useCoarsePointer();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const settledRef = useRef(settledAt);
  const redrawRef = useRef<(withPulse: boolean) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const budget = nodeBudget({
      coarse,
      cores: nav.hardwareConcurrency ?? 0,
      saveData: Boolean(nav.connection?.saveData),
    });
    // A device below the budget still gets a picture — a small one, drawn once.
    const animate = budget > 0 && !reduced;
    const field = createField(SEED, budget > 0 ? budget : 36);
    const rng = mulberry32(SEED + 1);
    const accent = tokenColour("--accent", "212 64% 50%");
    const ink = tokenColour("--primary", "213 70% 39%");

    // Everything the loop mutates lives here, not in React state: the field never
    // re-renders after mount.
    let signals: SignalState = { signals: [], budget: 0 };
    const glow = new Float32Array(field.nodes.length);
    let activity: Activity = { ...ACTIVITY.idle };
    let yaw = -0.35;
    let pitch = 0.12;
    let pointerYaw = 0;
    let pointerPitch = 0;
    let targetYaw = 0;
    let targetPitch = 0;
    let hovered = -1;
    let pointerX = -1;
    let pointerY = -1;
    let pulse = 1.5;            // ≥ 1.5 means no pulse is running
    let dim = 1;                // 1 normal; dips toward 0.55 on error
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      // Cap DPR at 2: a 3x phone gains nothing visible and pays three times the fill.
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    const draw = (dt: number) => {
      const wanted = ACTIVITY[modeRef.current];
      // Ramp continuously so a focus change is felt, not seen.
      activity = {
        rate: approach(activity.rate, wanted.rate, dt, 3),
        speed: approach(activity.speed, wanted.speed, dt, 3),
        branch: approach(activity.branch, wanted.branch, dt, 3),
        maxHops: wanted.maxHops,
      };
      dim = approach(dim, modeRef.current === "error" ? 0.6 : 1, dt, 4);

      if (animate) {
        yaw += dt * 0.05;                         // one turn in about two minutes
        pointerYaw = approach(pointerYaw, targetYaw, dt, 4);
        pointerPitch = approach(pointerPitch, targetPitch, dt, 4);
        signals = stepSignals(signals, field, dt, activity, rng, MAX_SIGNALS);
        if (pulse < 1.5) pulse += dt * 1.6;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const zoom = Math.min(width, height) * 0.44;
      // On the phone band the shell is ~130px tall; full-size dots there read as a blob.
      const scale = Math.min(1, zoom / 150);
      const yawNow = yaw + pointerYaw;
      const pitchNow = pitch + pointerPitch;
      const projected = field.nodes.map((n) => project(n, yawNow, pitchNow, cx, cy, zoom));

      // A signal arriving lights the node it reaches; hover lights the nearest node.
      for (let i = 0; i < glow.length; i++) glow[i] = approach(glow[i], 0, dt, 2.5);
      for (const s of signals.signals) {
        if (s.t > 0.85) {
          const [a, b] = field.edges[s.edge];
          glow[s.from === a ? b : a] = 1;
        }
      }
      hovered = -1;
      if (!coarse && pointerX >= 0) {
        let best = 34 * 34;
        projected.forEach((p, i) => {
          const d = (p.x - pointerX) ** 2 + (p.y - pointerY) ** 2;
          if (d < best) { best = d; hovered = i; }
        });
        if (hovered >= 0) glow[hovered] = Math.max(glow[hovered], 0.8);
      }

      // Joins, back to front so the nearer ones overdraw.
      ctx.lineWidth = 1;
      const edgeOrder = field.edges
        .map((e, i) => ({ i, z: projected[e[0]].z + projected[e[1]].z }))
        .sort((a, b) => b.z - a.z);
      for (const { i } of edgeOrder) {
        const [a, b] = field.edges[i];
        const pa = projected[a];
        const pb = projected[b];
        const depth = (pa.s + pb.s) / 2;            // ~0.7 back, ~1.3 front
        const alpha = (0.09 + Math.max(0, depth - 0.7) * 0.34) * dim;
        ctx.strokeStyle = ink(alpha);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Signals: a short bright trail along the join, and a head.
      for (const s of signals.signals) {
        const [a, b] = field.edges[s.edge];
        const from = projected[s.from === a ? a : b];
        const to = projected[s.from === a ? b : a];
        const t0 = Math.max(0, s.t - 0.16);
        const x0 = from.x + (to.x - from.x) * t0;
        const y0 = from.y + (to.y - from.y) * t0;
        const x1 = from.x + (to.x - from.x) * s.t;
        const y1 = from.y + (to.y - from.y) * s.t;
        const depth = from.s + (to.s - from.s) * s.t;
        ctx.strokeStyle = accent(0.55 * dim);
        ctx.lineWidth = 1.4 * depth * scale;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.fillStyle = accent(0.9 * dim);
        ctx.beginPath();
        ctx.arc(x1, y1, 1.6 * depth * scale, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes, back to front.
      const nodeOrder = projected.map((p, i) => ({ i, z: p.z })).sort((a, b) => b.z - a.z);
      for (const { i } of nodeOrder) {
        const p = projected[i];
        const n = field.nodes[i];
        // The convergence pulse: a ring of brightness moving outward from the centre.
        const dist = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
        const wave = pulse < 1.5 ? Math.max(0, 1 - Math.abs(pulse - dist) * 3.5) : 0;
        const lit = Math.min(1, glow[i] + wave);
        const base = 0.36 + Math.max(0, p.s - 0.7) * 0.7;
        const radius = (1.1 + 1.3 * p.s) * (1 + 0.45 * lit) * scale;
        ctx.fillStyle = lit > 0.02 ? accent(Math.min(1, base + lit * 0.7) * dim) : ink(base * dim);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fill();
        if (lit > 0.35) {
          // A halo as a second, larger, fainter circle — never a shadow.
          ctx.fillStyle = accent(0.18 * lit * dim);
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // ---- scheduling
    let raf = 0;
    let last = 0;
    let running = false;
    let visible = true;
    let onScreen = true;
    const frameGap = coarse ? 1000 / 30 : 0;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (frameGap && now - last < frameGap) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      draw(dt);
    };
    const start = () => {
      if (running || !animate) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    const reconcile = () => { if (visible && onScreen) start(); else stop(); };

    const onVisibility = () => { visible = !document.hidden; reconcile(); };
    document.addEventListener("visibilitychange", onVisibility);

    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; reconcile(); });
      io.observe(canvas);
    }

    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => { resize(); if (!animate) draw(0); })
      : undefined;
    ro?.observe(canvas);

    // The pointer writes to locals; the loop reads them. No work per event beyond that.
    const onPointer = (e: PointerEvent) => {
      if (coarse) return;
      const rect = canvas.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
      // Tilt from the VIEWPORT centre, so the whole page steers the shell, not just the
      // canvas; the effect is a glance, not a dial.
      targetYaw = ((e.clientX / window.innerWidth) - 0.5) * 2 * TILT;
      targetPitch = ((e.clientY / window.innerHeight) - 0.5) * 2 * TILT * 0.6;
    };
    const onLeave = () => { pointerX = -1; pointerY = -1; targetYaw = 0; targetPitch = 0; };
    if (!coarse && animate) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }

    resize();
    draw(0);
    reconcile();

    redrawRef.current = (withPulse: boolean) => {
      if (withPulse) {
        if (animate) pulse = 0;
        // No motion to carry a wave: show the settled state directly, every node lit.
        else glow.fill(0.6);
      }
      if (!animate) draw(0);
    };

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      io?.disconnect();
      ro?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      redrawRef.current = () => {};
    };
  }, [coarse, reduced]);

  // A mode change under reduced motion still deserves the new picture, once.
  useEffect(() => {
    if (reduced) redrawRef.current(false);
  }, [mode, reduced]);

  // The convergence pulse, once per `settledAt`.
  useEffect(() => {
    if (settledAt === undefined || settledAt === settledRef.current) return;
    settledRef.current = settledAt;
    redrawRef.current(true);
  }, [settledAt]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
