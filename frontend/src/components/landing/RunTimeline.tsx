/**
 * The twenty-one day run, scrubbed by the page scroll.
 *
 * This is the payoff section: everything argued above happens to one person, in order,
 * with the engine's own verdict printed beside it.
 *
 * HOW IT STAYS SMOOTH. The scroll ticker calls `setDay` on the canvas directly — no prop,
 * no state, no React work between frames. The narration DOES have to change, so it is
 * quantised: the component re-renders when the whole day number changes, which happens
 * twenty times across the whole section rather than sixty times a second. The old version
 * put the fractional day in component state and reconciled three paragraphs and a canvas
 * on every frame.
 *
 * PACING is deliberately non-linear. A linear map spends over half the section on the
 * fifteen collection days, where by construction nothing happens, and leaves days 19-21 —
 * the part the section exists for — to the last few hundred pixels.
 *
 * Under `prefers-reduced-motion` the pin is dropped and the finished run is shown as a
 * static plate at day 20, which is the state the section argues for.
 */
import { useEffect, useRef, useState } from "react";

import { BASELINE_UNTIL, RUN_DAYS, verdictOn, type Series } from "./traceData";
import { TraceLanes, type TraceLanesHandle } from "./TraceLanes";
import {
  DURATION, EASE, usePrefersReducedMotion, useScrollScene,
} from "@/lib/motion";

const CAREGIVER_MESSAGE =
  "Please check on them today. What changed: one corner of the mouth sat lower than the "
  + "other, and the eyebrows lifted unevenly. These changes have shown up across more than "
  + "one kind of check, on more than one day.";

function narrate(day: number) {
  if (day <= 15) return {
    head: "Collecting",
    body: "Nothing is judged yet. A baseline needs twelve valid sessions before the engine has any opinion about what is normal for this person.",
  };
  if (day <= 18) return {
    head: "Inside the band",
    body: "Three sessions against a learned baseline. Every domain sits inside its own range. Nothing is sent to anyone.",
  };
  if (day === 19) return {
    head: "Three domains moved — and it is still not an alert",
    body: "Face, voice and hand all broke the band this morning — the moment a threshold system would have called the family. Gate 1 is not satisfied: one session is an event.",
  };
  if (day === 20) return {
    head: "The same three, a second consecutive session, and a side",
    body: "Persistence, corroboration and laterality are all satisfied. The family is notified once, in their own language, with what changed and what to do.",
  };
  return {
    head: "The band holds. Nobody is notified again",
    body: "Day twenty-one deviates as clearly as day twenty. The clinician sees it; the family does not get a second alarm about something they have already been told.",
  };
}

const BAND_CLASS: Record<string, string> = {
  BASELINE: "text-muted-foreground",
  STABLE: "text-stable",
  WATCH: "text-watch",
  ALERT: "text-alert",
};

/** Below this the pinned box has to carry a compact plate or it will not fit at all. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Scroll position -> day, weighted so the six days that matter get most of the section. */
const PIVOT = 0.32;
function dayFor(progress: number) {
  const shaped = Math.min(1, Math.max(0, (progress - 0.06) / 0.86));
  const d = shaped < PIVOT
    ? (shaped / PIVOT) * (BASELINE_UNTIL - 1)
    : (BASELINE_UNTIL - 1) + ((shaped - PIVOT) / (1 - PIVOT)) * (RUN_DAYS - BASELINE_UNTIL);
  return 1 + d;
}

export function RunTimeline({ series }: { series: Series }) {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrow();
  const lanes = useRef<TraceLanesHandle>(null);
  const dayLabel = useRef<HTMLSpanElement>(null);

  // The only piece of scroll state React is allowed to see, and it changes 21 times.
  const [whole, setWhole] = useState(reduced ? 20 : 1);

  const sceneRef = useScrollScene<HTMLDivElement>((p) => {
    const day = Math.min(RUN_DAYS, Math.max(1, dayFor(p)));
    lanes.current?.setDay(day);
    const rounded = Math.round(day);
    // The counter is written straight to the DOM: it changes on almost every frame and is
    // not worth a reconciliation.
    if (dayLabel.current) dayLabel.current.textContent = String(rounded).padStart(2, "0");
    setWhole((prev) => (prev === rounded ? prev : rounded));
  }, "pin");

  const verdict = verdictOn(series, whole);
  const copy = narrate(whole);

  const plate = (
    <div className="rounded-2xl border border-white/10 bg-[#0A121C] p-3.5 sm:p-5">
      <div className="flex items-baseline justify-between gap-4 pb-2.5">
        <p className="font-mono text-[10px] tracking-[0.18em] text-white/45 sm:text-[11px]">
          SEEDED RUN · SEED 42
        </p>
        <p className="font-mono text-[10px] tracking-[0.18em] text-white/45 sm:text-[11px]">
          DAY <span ref={dayLabel}>{String(whole).padStart(2, "0")}</span> / {RUN_DAYS}
        </p>
      </div>
      <TraceLanes
        ref={lanes}
        series={series}
        day={reduced ? 20 : 1}
        laneHeight={narrow ? 20 : 34}
        labels={!narrow}
      />
      {narrow && (
        <p className="pt-2 font-mono text-[9px] leading-relaxed tracking-[0.12em] text-white/40">
          TOP TO BOTTOM: CRANIAL · SPEECH · LANGUAGE · MOTOR · COORD · VESTIBULAR ·
          COGNITION
        </p>
      )}
    </div>
  );

  const readout = (
    <div>
      <div className="flex items-center gap-3">
        <span
          className={`font-mono text-xs tracking-[0.24em] ${BAND_CLASS[verdict.band]}`}
          style={{ transition: `color ${DURATION.medium}ms ${EASE.out}` }}
        >
          {verdict.band}
        </span>
        <span
          className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground"
          style={{
            opacity: verdict.repeat ? 1 : 0,
            transform: verdict.repeat ? "none" : "translateY(-3px)",
            transition: `opacity ${DURATION.medium}ms ${EASE.out}, transform ${DURATION.medium}ms ${EASE.out}`,
          }}
          aria-hidden={!verdict.repeat}
        >
          NO SECOND NOTIFICATION
        </span>
      </div>

      {/* Keyed on the verdict so React swaps the node and the crossfade actually plays;
          without the key the text mutates in place and the transition never fires. */}
      <div key={copy.head} className="run-narration">
        <h3 className="mt-2.5 text-[21px] font-semibold leading-tight tracking-tight sm:text-[30px]">
          {copy.head}
        </h3>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
          {copy.body}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-6">
        {([
          ["GATE 1", verdict.gate1.length > 0],
          ["GATE 2", verdict.gate2],
          ["GATE 3", verdict.gate3.length > 0],
        ] as const).map(([label, passed], i) => (
          <span
            key={label}
            className={`rounded-md border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] ${
              passed ? "border-alert/40 bg-alert-soft text-alert" : "border-line text-muted-foreground"
            }`}
            style={{
              transform: passed ? "none" : "scale(0.97)",
              transition: `all ${DURATION.fast}ms ${EASE.spring} ${i * 60}ms`,
            }}
          >
            {label} {passed ? "✓" : "—"}
          </span>
        ))}
      </div>

      <figure
        className="mt-4 overflow-hidden border-l-2 border-alert pl-4 sm:mt-6"
        style={{
          maxHeight: whole >= 20 ? 320 : 0,
          opacity: whole >= 20 ? 1 : 0,
          marginTop: whole >= 20 ? undefined : 0,
          transition: `max-height ${DURATION.slow}ms ${EASE.out}, opacity ${DURATION.medium}ms ${EASE.out}`,
        }}
        aria-hidden={whole < 20}
      >
        <blockquote className="text-[14px] leading-relaxed sm:text-[15px]">
          “{CAREGIVER_MESSAGE}”
        </blockquote>
        <figcaption className="mt-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          What the caregiver's phone shows. No number appears in it — the wording model is
          never given one.
        </figcaption>
      </figure>
    </div>
  );

  if (reduced) {
    return (
      <div className="mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-[1.3fr_1fr] lg:items-center">
        {plate}
        {readout}
      </div>
    );
  }

  return (
    <div ref={sceneRef} className="relative" style={{ height: "260vh" }}>
      <div className="sticky top-0 flex min-h-[100svh] items-center pb-6 pt-[4.25rem] sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-6 sm:gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-12">
          {plate}
          {readout}
        </div>
      </div>
    </div>
  );
}
