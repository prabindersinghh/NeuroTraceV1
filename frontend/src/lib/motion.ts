/**
 * The motion system.
 *
 * ARCHITECTURE, which is the whole reason this file exists.
 * The naive way to build scroll-linked motion in React is a scroll listener per effect
 * that calls `setState`. That means N listeners each doing a layout read, and a React
 * re-render of a whole subtree on every frame — for the twenty-one-day section that is a
 * canvas redraw plus a paragraph reconciliation sixty times a second, and it is exactly
 * what makes an otherwise well-built page feel cheap.
 *
 * So there is ONE `requestAnimationFrame` ticker in this module, it only runs while some
 * subscriber is actually near the viewport, and scroll-linked effects are handed the
 * progress value directly rather than through component state. Components that must change
 * their TEXT (the run narration) quantise: they re-render when the day number changes, not
 * when the pixel offset does. Components that only change PIXELS (canvases, parallax,
 * masks) never re-render at all — they write to the DOM or the canvas in the ticker.
 *
 * SMOOTH SCROLLING is Lenis, and it is deliberately not global:
 *   · it is loaded only by the signed-out landing page, dynamically, so the clinical
 *     bundle never pays for it;
 *   · it is off under `prefers-reduced-motion`;
 *   · it is off on coarse pointers, because native touch-scroll momentum is better than
 *     anything we would synthesise, and because damped scrolling on a phone fights the
 *     user's thumb.
 *
 * That last exclusion is not only taste. This product measures vestibular function and is
 * used by people who have vertigo; inertial scrolling and parallax are a known trigger.
 * The immersive treatment belongs on the marketing page, and the clinical surfaces get
 * their smoothness from fast, well-damped state transitions instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Milliseconds. Tuned by eye at 1440px and on a 4x-throttled CPU profile. */
export const DURATION = {
  instant: 120,
  fast: 320,
  medium: 620,
  slow: 1100,
  cinematic: 1800,
} as const;

export const EASE = {
  /** Everything that acknowledges an interaction. */
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** Reveals. Fast out of the gate, long settle — reads as "arriving", not "sliding". */
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** State changes where both ends matter (a band widening, a lane resolving). */
  inOut: "cubic-bezier(0.76, 0, 0.24, 1)",
  /** A little overshoot, for things that should feel physical: badges, chips, nodes. */
  spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
} as const;

/** Stagger step for sequenced reveals, in ms. Anything larger reads as lag. */
export const STAGGER = 70;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Touch and pen. Hover affordances and damped scrolling are both wrong here. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return coarse;
}

// ---------------------------------------------------------------------------- ticker

type Tick = (scrollY: number, viewportH: number) => void;

const tickers = new Set<Tick>();
let frame = 0;
let lastY = Number.NaN;
let lastH = Number.NaN;

function pump() {
  frame = requestAnimationFrame(pump);
  const y = window.scrollY;
  const h = window.innerHeight;
  // Ticking on an unchanged scroll position still costs a full pass over the subscribers;
  // skipping it is what lets the loop idle at ~0% CPU while the visitor reads.
  if (y === lastY && h === lastH) return;
  lastY = y;
  lastH = h;
  for (const tick of tickers) tick(y, h);
}

function addTicker(tick: Tick) {
  tickers.add(tick);
  if (!frame) { lastY = Number.NaN; frame = requestAnimationFrame(pump); }
  // Run once immediately so a scene that mounts mid-page is correct on its first paint.
  tick(window.scrollY, window.innerHeight);
}

function removeTicker(tick: Tick) {
  tickers.delete(tick);
  if (!tickers.size && frame) { cancelAnimationFrame(frame); frame = 0; }
}

// ------------------------------------------------------------------ shared observers

const observers = new Map<string, IntersectionObserver>();
const callbacks = new WeakMap<Element, (entry: IntersectionObserverEntry) => void>();

function observe(
  el: Element,
  cb: (entry: IntersectionObserverEntry) => void,
  rootMargin: string,
  threshold: number,
) {
  const key = `${rootMargin}|${threshold}`;
  let io = observers.get(key);
  if (!io) {
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) callbacks.get(entry.target)?.(entry);
    }, { rootMargin, threshold });
    observers.set(key, io);
  }
  callbacks.set(el, cb);
  io.observe(el);
  return () => { io!.unobserve(el); callbacks.delete(el); };
}

interface InViewOptions {
  /** Disconnect after the first intersection. Default true — reveals do not replay. */
  once?: boolean;
  rootMargin?: string;
  threshold?: number;
}

/**
 * True once the element has entered the viewport.
 *
 * Backed by a pool of shared observers keyed on their options, so a page with two hundred
 * revealing elements creates three IntersectionObservers rather than two hundred.
 */
export function useInView<T extends HTMLElement>(options: InViewOptions = {}) {
  const { once = true, rootMargin = "0px 0px -10% 0px", threshold = 0 } = options;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (a very old WebView): show everything rather than nothing.
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    let stop: (() => void) | undefined;
    stop = observe(el, (entry) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting && once) stop?.();
    }, rootMargin, threshold);
    return () => stop?.();
  }, [once, rootMargin, threshold]);

  return { ref, inView };
}

// ------------------------------------------------------------------------ scroll scenes

/**
 * Drive an animation from an element's travel through the viewport, WITHOUT re-rendering.
 *
 * `onFrame` is called with progress in 0..1 on every animation frame the page actually
 * moved, and only while the element is within half a viewport of the screen. It is handed
 * the raw number; write it to a style, a canvas or a CSS variable. Do not call `setState`
 * in it unless you have quantised the value first.
 *
 * `mode`:
 *   "through"  0 when the element's top reaches the bottom of the viewport, 1 when its
 *              bottom leaves the top. For reveals and parallax on normal-height elements.
 *   "pin"      0 when the element's top hits the top of the viewport, 1 when its bottom
 *              does. For a tall section with a `sticky` child — the scrub range.
 */
export function useScrollScene<T extends HTMLElement>(
  onFrame: (progress: number) => void,
  mode: "pin" | "through" = "pin",
) {
  const ref = useRef<T | null>(null);
  const handler = useRef(onFrame);
  handler.current = onFrame;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const tick = (scrollY: number, vh: number) => {
      const rect = el.getBoundingClientRect();
      let p: number;
      if (mode === "pin") {
        const travel = rect.height - vh;
        p = travel <= 0 ? 1 : -rect.top / travel;
      } else {
        const travel = rect.height + vh;
        p = travel <= 0 ? 1 : (vh - rect.top) / travel;
      }
      handler.current(Math.min(1, Math.max(0, p)));
      void scrollY;
    };

    if (typeof IntersectionObserver === "undefined") {
      addTicker(tick);
      return () => removeTicker(tick);
    }
    let attached = false;
    const stop = observe(el, (entry) => {
      if (entry.isIntersecting && !attached) { attached = true; addTicker(tick); }
      else if (!entry.isIntersecting && attached) { attached = false; removeTicker(tick); }
    }, "50% 0px", 0);
    return () => { stop(); if (attached) removeTicker(tick); };
  }, [mode]);

  return ref;
}

/**
 * Parallax by writing `transform` straight onto the node.
 *
 * `strength` is the fraction of the element's own travel it lags behind by; 0.12 is a
 * hint, 0.3 is theatrical. Positive lags (moves up more slowly), negative leads.
 */
export function useParallax<T extends HTMLElement>(strength = 0.12) {
  const reduced = usePrefersReducedMotion();
  const coarse = useCoarsePointer();
  const nodeRef = useRef<T | null>(null);
  const off = reduced || coarse;

  const sceneRef = useScrollScene<HTMLElement>((p) => {
    const node = nodeRef.current;
    if (!node || off) return;
    // Centre the effect on the middle of the pass so the element is un-offset when it is
    // in the middle of the screen, which is where it will be looked at.
    node.style.transform = `translate3d(0, ${(p - 0.5) * -100 * strength}px, 0)`;
  }, "through");

  const setRefs = useCallback((el: T | null) => {
    nodeRef.current = el;
    sceneRef.current = el;
  }, [sceneRef]);

  useEffect(() => {
    if (off && nodeRef.current) nodeRef.current.style.transform = "";
  }, [off]);

  return setRefs;
}

/**
 * Smooth scrolling for the signed-out surface.
 *
 * Loaded dynamically so the clinical bundle never contains it, and skipped entirely on
 * touch and under reduced motion — see the note at the top of this file for why that
 * exclusion is a clinical decision and not a preference.
 */
export function useSmoothScroll() {
  const reduced = usePrefersReducedMotion();
  const coarse = useCoarsePointer();

  useEffect(() => {
    if (reduced || coarse) return;
    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;
    let cancelled = false;

    void import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({
        // Long enough to feel damped, short enough that a flick still lands where the
        // visitor aimed. Past ~0.9 the page starts feeling like it is resisting them.
        lerp: 0.11,
        wheelMultiplier: 0.9,
        // Native everywhere it matters: `sticky` keeps working, find-in-page keeps
        // working, and the scrollbar stays draggable.
        smoothWheel: true,
        syncTouch: false,
      });
      const loop = (time: number) => { lenis?.raf(time); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      lenis?.destroy();
    };
  }, [reduced, coarse]);
}

// ------------------------------------------------------------------------------ tweens

/**
 * A fixed-duration tween toward `target`, on the animation-frame clock.
 *
 * Eased with expo-out, the numeric twin of `EASE.out`. Use where a value has to LAND on a
 * number — the hero plate draws day 18 and must stop there, not creep into day 19 and give
 * away the ending.
 */
export function useTween(target: number, duration: number = DURATION.cinematic): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (reduced) { from.current = target; setValue(target); return; }
    const start = performance.now();
    const origin = from.current;
    if (origin === target) return;
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const next = origin + (target - origin) * eased;
      from.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
      else { from.current = target; setValue(target); }
    });
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);

  return reduced ? target : value;
}

/**
 * A number that counts up to `target` the first time it is seen.
 *
 * Only for figures where the count itself is the point — the four incidence statistics.
 * Returns the ref to attach and the current value.
 */
export function useCountUp(target: number, duration = 1400) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLElement>({ rootMargin: "0px 0px -15% 0px" });
  const [value, setValue] = useState(reduced ? target : 0);

  useEffect(() => {
    if (!inView || reduced) { if (reduced) setValue(target); return; }
    const start = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else setValue(target);
    });
    return () => cancelAnimationFrame(raf);
  }, [inView, target, duration, reduced]);

  return { ref, value };
}

/**
 * A damped follower for a value the user is steering (a hovered node, a pointer position).
 *
 * Exponential, so it never quite arrives and that is the point — it always looks like it
 * is still settling toward whatever the user is doing. Stops when it gets there.
 */
export function useEased(target: number, rate = 0.12): number {
  const reduced = usePrefersReducedMotion();
  const current = useRef(target);
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (reduced) { current.current = target; setValue(target); return; }
    let raf = 0;
    const step = () => {
      const delta = target - current.current;
      if (Math.abs(delta) < 0.0005) { current.current = target; setValue(target); return; }
      current.current += delta * rate;
      setValue(current.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, rate, reduced]);

  return reduced ? target : value;
}
