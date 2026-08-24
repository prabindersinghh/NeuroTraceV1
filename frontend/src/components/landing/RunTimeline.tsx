/**
 * The twenty-one day run, scrubbed by the page scroll.
 *
 * This is the payoff section: everything argued above happens here to one person, in
 * order, with the engine's own verdict printed beside it. The scroll drives a day counter
 * and nothing else — no scroll hijacking, no snapping, no easing the wheel. The visitor
 * keeps ordinary control of the page and the story advances because they moved.
 *
 * Under `prefers-reduced-motion` the pin is dropped entirely and the finished run is shown
 * as a static plate with the day-20 verdict, which is the state the section is arguing for.
 */
import { useEffect, useState } from "react";

import { BASELINE_UNTIL, RUN_DAYS, verdictOn, type Series } from "./traceData";
import { TraceLanes } from "./TraceLanes";
import { useEased, usePrefersReducedMotion, useScrollProgress } from "@/lib/motion";

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

const BAND_CLASS: Record<string, string> = {
  BASELINE: "text-muted-foreground",
  STABLE: "text-stable",
  WATCH: "text-watch",
  ALERT: "text-alert",
};

export function RunTimeline({ series }: { series: Series }) {
  const reduced = usePrefersReducedMotion();
  const narrow = useNarrow();
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  // Hold on the first and last frames so the opening and the resolution both get a beat.
  const shaped = Math.min(1, Math.max(0, (progress - 0.08) / 0.84));
  // Days are NOT linear in the scroll. A linear map spends over half the section on the
  // fifteen collection days, where by construction nothing happens, and leaves the part
  // the section exists for — 19, 20, 21 — to the last few hundred pixels. Move quickly
  // through the baseline, then slow right down once the engine starts having opinions.
  const PIVOT = 0.32;
  const day01 = shaped < PIVOT
    ? (shaped / PIVOT) * (BASELINE_UNTIL - 1)
    : (BASELINE_UNTIL - 1) + ((shaped - PIVOT) / (1 - PIVOT)) * (RUN_DAYS - BASELINE_UNTIL);
  const eased = useEased(1 + day01, 0.18);
  const day = reduced ? 20 : Math.min(RUN_DAYS, Math.max(1, eased));
  const whole = Math.round(day);
  const verdict = verdictOn(series, whole);
  const copy = narrate(whole);

  const plate = (
    <div className="rounded-2xl border border-white/10 bg-[#0A121C] p-3.5 sm:p-5">
      <div className="flex items-baseline justify-between gap-4 pb-2.5">
        <p className="font-mono text-[10px] tracking-[0.18em] text-white/45 sm:text-[11px]">
          SEEDED RUN · SEED 42
        </p>
        <p className="font-mono text-[10px] tracking-[0.18em] text-white/45 sm:text-[11px]">
          DAY {String(whole).padStart(2, "0")} / {RUN_DAYS}
        </p>
      </div>
      <TraceLanes series={series} day={day} laneHeight={narrow ? 20 : 34} labels={!narrow} />
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
        <span className={`font-mono text-xs tracking-[0.24em] ${BAND_CLASS[verdict.band]}`}>
          {verdict.band}
        </span>
        {verdict.repeat && (
          <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
            NO SECOND NOTIFICATION
          </span>
        )}
      </div>
      <h3 className="mt-2.5 text-[21px] font-semibold leading-tight tracking-tight sm:text-[30px]">
        {copy.head}
      </h3>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-[17px]">
        {copy.body}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5 sm:mt-6">
        {([
          ["GATE 1", verdict.gate1.length > 0],
          ["GATE 2", verdict.gate2],
          ["GATE 3", verdict.gate3.length > 0],
        ] as const).map(([label, passed]) => (
          <span
            key={label}
            className={`rounded-md border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] ${
              passed ? "border-alert/40 bg-alert-soft text-alert" : "border-line text-muted-foreground"
            }`}
          >
            {label} {passed ? "✓" : "—"}
          </span>
        ))}
      </div>

      {whole >= 20 && (
        <figure className="mt-4 border-l-2 border-alert pl-4 sm:mt-6">
          <blockquote className="text-[14px] leading-relaxed sm:text-[15px]">“{CAREGIVER_MESSAGE}”</blockquote>
          <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            What the caregiver's phone shows. No number appears in it — the wording model is
            never given one.
          </figcaption>
        </figure>
      )}
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
    <div ref={ref} className="relative" style={{ height: "230vh" }}>
      <div className="sticky top-0 flex min-h-[100svh] items-center pb-6 pt-[4.25rem] sm:py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-6 sm:gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-center lg:gap-12">
          {plate}
          {readout}
        </div>
      </div>
    </div>
  );
}
