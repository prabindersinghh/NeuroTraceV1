/**
 * The hero instrument: the cortex above, the twenty-one-day run below, one plate.
 *
 * WHY THE TWO ARE BONDED. The page's claim is "seven readings of one person, every
 * morning". A picture of a neural field alone illustrates nothing — it is the same
 * abstract cloud every AI product ships. Bolting it to `TraceLanes`, which is the
 * product's real measurements drawn to scale from the seeded demo run, turns it into a
 * legend: the thing above is where the reading comes from, the thing below is what the
 * reading looks like over three weeks.
 *
 * THE INTERACTION IS THE ARGUMENT, AND IT IS A BUTTON. Choosing a domain flares that
 * region of the cortex and marks its lane. It is seven real `<button>`s rather than a
 * hover zone over the canvas for two reasons: a hover-only affordance excludes every
 * keyboard and touch visitor, and mapping a pointer position onto a lane would duplicate
 * `TraceLanes`'s internal geometry in a second place that could silently drift from it.
 *
 * Nothing here is required to understand the page. With no WebGL the cortex is a still
 * plate, the lanes are unaffected, and the buttons still mark a lane.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { CortexField, type CortexHandle } from "@/components/landing/CortexField";
import { TraceLanes, type TraceLanesHandle } from "@/components/landing/TraceLanes";
import { DOMAINS, type Series } from "@/components/landing/traceData";
import { DOMAIN_COUNT, STATE } from "@/lib/cortex";
import { usePrefersReducedMotion } from "@/lib/motion";

/** Eighteen quiet days drawn once, imperatively, with no React in the loop. */
function useEntrance(lanes: React.RefObject<TraceLanesHandle | null>, label: React.RefObject<HTMLSpanElement | null>) {
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    const write = (d: number) => {
      lanes.current?.setDay(d);
      if (label.current) label.current.textContent = String(Math.round(d)).padStart(2, "0");
    };
    if (reduced) { write(18); return; }
    const start = performance.now() + 240;
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, Math.max(0, (now - start) / 2400));
      // Expo-out, the numeric twin of EASE.out. Lands exactly on 18 rather than creeping
      // toward day 19 and giving away the ending.
      write(1 + (t === 1 ? 1 : 1 - 2 ** (-10 * t)) * 17);
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [lanes, label, reduced]);
}

export function HeroConsole({ series }: { series: Series }) {
  const cortex = useRef<CortexHandle>(null);
  const lanes = useRef<TraceLanesHandle>(null);
  const day = useRef<HTMLSpanElement>(null);
  // Two different things, deliberately: `pinned` is a choice the visitor made and it
  // survives the pointer leaving; `shown` is what is lit right now, which is the hovered
  // chip if there is one and the pinned chip otherwise. Collapsing them would make a
  // click do nothing on a mouse and a hover undo a tap on a touchscreen.
  const [pinned, setPinned] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const pinnedRef = useRef<number | null>(null);
  useEntrance(lanes, day);

  const light = useCallback((index: number | null) => {
    setShown(index);
    lanes.current?.setLane(index);
    if (index === null) { cortex.current?.setFlare(null); return; }
    const weights = new Array(DOMAIN_COUNT).fill(0);
    weights[index] = 1;
    cortex.current?.setFlare(weights);
  }, []);

  const pin = useCallback((index: number) => {
    const next = pinnedRef.current === index ? null : index;
    pinnedRef.current = next;
    setPinned(next);
    light(next ?? index);
  }, [light]);

  // Running the pointer along the plate inspects one morning across all seven lanes, and
  // tilts the cortex with it. Both are cosmetic; both are off on touch by their own gates.
  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    lanes.current?.setFocus(x);
    cortex.current?.setPointer(x, (e.clientY - rect.top) / rect.height);
  }, []);
  const onLeave = useCallback(() => {
    lanes.current?.setFocus(null);
    cortex.current?.setPointer(null);
  }, []);

  return (
    <div>
      <div
        className="overflow-hidden rounded-2xl border border-white/10 bg-[#0A121C]"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      >
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 sm:px-5">
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
            SEVEN DOMAINS · ONE PERSON
          </p>
          <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
            DAY <span ref={day}>01</span>
          </p>
        </div>

        {/* Turning, always: one revolution every ~29 seconds. Slow enough that it never
            competes with the lanes below it for attention, and the only way the folding
            and the interhemispheric gap read as a form with a far side rather than as a
            flat pattern. Drag still works — it offsets the turntable, it does not stop it. */}
        <CortexField
          ref={cortex}
          initialState={STATE.cortex}
          zoom={0.95}
          density={0.42}
          spin={0.22}
          className="h-[200px] w-full sm:h-[268px]"
        />

        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <TraceLanes ref={lanes} series={series} laneHeight={28} />
        </div>
      </div>

      {/* The legend. Also the interaction — and the only place on this page where the two
          halves of the instrument are named against each other. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {DOMAINS.map((domain, i) => (
          <button
            key={domain.key}
            type="button"
            aria-pressed={pinned === i}
            onPointerEnter={() => light(i)}
            onFocus={() => light(i)}
            onPointerLeave={() => light(pinnedRef.current)}
            onBlur={() => light(pinnedRef.current)}
            onClick={() => pin(i)}
            className={`focus-ring tactile rounded-md border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.14em] ${
              shown === i
                ? "border-watch/60 bg-watch/10 text-watch"
                : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            {domain.lane}
          </button>
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
        Seeded demo run · pick a domain · sweep the plate to read one morning
      </p>
    </div>
  );
}
