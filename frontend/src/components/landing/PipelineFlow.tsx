/**
 * The on-device pipeline, as a pipeline.
 *
 * It was a numbered list, which is a fine way to write five steps down and a poor way to
 * show that they are one path a signal travels. A dot moves down the rail as the visitor
 * scrolls, and each step lights as it arrives — so the section reads as "this happens, then
 * this happens to its output", which is the actual claim.
 *
 * The dot's position is a single transform written from the scroll ticker. The active step
 * is quantised, so React re-renders five times across the section rather than continuously.
 */
import { useRef, useState } from "react";

import { DURATION, EASE, usePrefersReducedMotion, useScrollScene } from "@/lib/motion";

const STEPS: [string, string][] = [
  ["Capture", "The camera and microphone run a task. Nothing is written to disk."],
  ["Extract, on device", "MediaPipe landmarks and audio DSP turn the signal into numbers, in the browser."],
  ["Compare to their own history", "Twelve sessions of their own past. Never a population average."],
  ["Three gates", "Persistence, then corroboration, then a side."],
  ["Say it in their language", "One guardrailed sentence in English, Hindi or Punjabi: what changed, and what to do."],
];

export function PipelineFlow() {
  const reduced = usePrefersReducedMotion();
  const dotRef = useRef<HTMLSpanElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(reduced ? STEPS.length - 1 : -1);

  const sceneRef = useScrollScene<HTMLDivElement>((p) => {
    if (reduced) return;
    // The list is taller than the viewport on a phone, so the travel is mapped across the
    // middle of the pass rather than its whole length — otherwise the dot finishes before
    // the last two steps have been read.
    const t = Math.min(1, Math.max(0, (p - 0.18) / 0.5));
    const rail = railRef.current;
    if (rail && dotRef.current) {
      dotRef.current.style.transform = `translate3d(0, ${t * rail.clientHeight}px, 0)`;
    }
    const idx = Math.min(STEPS.length - 1, Math.floor(t * STEPS.length + 0.0001));
    setActive((prev) => (prev === idx ? prev : idx));
  }, "through");

  return (
    <div ref={sceneRef} className="relative mt-8">
      {/* The rail. Sits behind the numbers, and is the thing the dot travels down. */}
      <div
        ref={railRef}
        aria-hidden
        className="pointer-events-none absolute bottom-6 left-[13px] top-6 w-px bg-line"
      >
        <span
          ref={dotRef}
          className="absolute -left-[3px] top-0 block h-[7px] w-[7px] rounded-full bg-accent"
          style={{
            boxShadow: "0 0 0 4px hsl(var(--accent) / 0.14)",
            opacity: reduced ? 0 : 1,
          }}
        />
      </div>

      <ol className="space-y-px overflow-hidden rounded-2xl border border-line">
        {STEPS.map(([title, body], i) => {
          const on = i <= active;
          return (
            <li key={title} className="relative bg-background px-5 py-3.5">
              <div className="flex gap-4">
                <span
                  className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full font-mono text-[10px] tabular-nums"
                  style={{
                    background: on ? "hsl(var(--accent))" : "hsl(var(--muted))",
                    color: on ? "hsl(var(--accent-foreground))" : "hsl(var(--muted-foreground))",
                    transform: on ? "scale(1)" : "scale(0.9)",
                    transition: `background-color ${DURATION.fast}ms ${EASE.standard},`
                      + ` color ${DURATION.fast}ms ${EASE.standard},`
                      + ` transform ${DURATION.fast}ms ${EASE.spring}`,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div
                  style={{
                    opacity: on ? 1 : 0.45,
                    transition: `opacity ${DURATION.medium}ms ${EASE.out}`,
                  }}
                >
                  <p className="text-[15px] font-medium">{title}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
