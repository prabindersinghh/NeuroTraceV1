/**
 * THE SPINE OF THE PAGE: six acts, one point cloud, one scroll.
 *
 * The whole argument in order — the gap, the seven readings, the person they resolve
 * into, the ninety days they extend across, the four people who read them, and the
 * distance the whole thing has to travel to be worth anything. `CortexField` moves one
 * cloud of points between the six arrangements as the section scrolls; nothing is
 * swapped, faded or cross-dissolved, because the continuity is the claim.
 *
 * THE TEXT IS REAL TEXT. Every act is an `<article>` with a real heading in the document
 * flow — the canvas behind it is `aria-hidden` and carries no information of its own. A
 * screen reader, a search crawler and a visitor with WebGL disabled all get the same six
 * paragraphs in the same order. That is also why the acts are laid out with a negative
 * margin over a `sticky` sibling rather than absolutely positioned: the reading order in
 * the DOM is the reading order on the page.
 *
 * NATIVE STICKY, NOT SCROLL-JACKING. The visitor's scroll always moves the page by the
 * amount they asked for. Find-in-page works, the scrollbar is draggable, and a flick on a
 * phone still lands where they aimed. The only thing driven by scroll position is a
 * uniform.
 */
import { useRef, useState } from "react";

import { CortexField, type CortexHandle } from "@/components/landing/CortexField";
import { Reveal } from "@/components/motion/Reveal";
import { STATE_COUNT } from "@/lib/cortex";
import { useScrollScene } from "@/lib/motion";

interface Act {
  /** Two digits, shown as the act marker. */
  n: string;
  kicker: string;
  head: string;
  body: string;
  /** The one sentence the act exists to land. Kept separate so it can be set apart. */
  point: string;
}

/**
 * Every factual claim here is one the rest of the page or the repository can produce:
 * seven gating domains and six daily tasks inside the three-minute budget
 * (`exam/registry.py`), the twelve-session baseline window and the frozen reference
 * (`engine/gates.py`, INV-4), the four roles (the four signed-in surfaces), and offline
 * capture with a precached model served from our own origin. Nothing here is a number
 * this product has measured about anybody.
 */
const ACTS: Act[] = [
  {
    n: "01",
    kicker: "The gap",
    head: "The emergency ends. The recovery does not.",
    body: "A stroke is an emergency, and the system around it is built for emergencies — "
      + "fast, staffed, and finished. What follows is neither fast nor staffed. It runs "
      + "for months at home, where nothing is being measured and no one has been trained "
      + "to notice a change until it has already become a second crisis.",
    point: "Care stops at the door. Recovery walks out with the patient.",
  },
  {
    n: "02",
    kicker: "The signal",
    head: "Recovery is not one thing getting better.",
    body: "It moves in the face, the hands, the balance, the voice, the words and the "
      + "attention — separately, and at different speeds. Seven of those are readable "
      + "well enough on an ordinary phone to raise a flag. Six short tasks run every "
      + "morning inside a three-minute budget; the rest are weekly or monthly.",
    point: "Seven readings, taken before the day starts.",
  },
  {
    n: "03",
    kicker: "The picture",
    head: "One reading is noise. Seven, held together, are a person.",
    body: "Each morning is compared to that person's own last twelve sessions rather than "
      + "to a population — a survivor is outside the population's range every day by "
      + "definition. What resolves is specific: what changed, in which systems, on which "
      + "side of the body, and for how long it has been changing.",
    point: "Not a score. A description of what moved.",
  },
  {
    n: "04",
    kicker: "The line",
    head: "A clinic visit is a point. Recovery is a line.",
    body: "Between appointments the record is simply empty, so any change has to be "
      + "reconstructed afterwards out of what a family happens to remember. A reading every "
      + "morning makes those same months continuous instead — twelve sessions of context, "
      + "then every day after — which is a different object from a row of snapshots.",
    point: "The trajectory, not the appointment.",
  },
  {
    n: "05",
    kicker: "The people",
    head: "One morning. Four different jobs.",
    body: "The survivor sees a short session and a button, never a score. The caregiver "
      + "sees what changed, in one sentence, and what to do about it. The clinician sees "
      + "a ranked roster, gate states, laterality and drift against a frozen reference. "
      + "The ASHA worker sees a household round with what is due.",
    point: "The same morning, told four different ways.",
  },
  {
    n: "06",
    kicker: "The distance",
    head: "Expertise should not depend on geography.",
    body: "The exam runs on the survivor's own phone, offline, in English, Hindi or "
      + "Punjabi. No clinic hardware, no specialist in the room, no reliable connection, "
      + "no second device. Every one of those is an assumption that would have decided in "
      + "advance which districts this could ever run in.",
    point: "Built for where the neurologists are not.",
  },
];

export function SignalScene() {
  const cortex = useRef<CortexHandle>(null);
  // The only value React ever sees from this section, and it changes six times over six
  // screens of scrolling — not sixty times a second. The canvas is driven directly.
  const [act, setAct] = useState(0);
  const actRef = useRef(0);

  const scene = useScrollScene<HTMLElement>((p) => {
    // The acts occupy the section's travel evenly, so progress maps straight onto the
    // arrangement index. `CortexField` eases toward it, which is what stops a fast flick
    // from teleporting the cloud.
    const state = p * (STATE_COUNT - 1);
    cortex.current?.setState(state);
    const next = Math.min(ACTS.length - 1, Math.round(state));
    if (next !== actRef.current) { actRef.current = next; setAct(next); }
  }, "pin");

  return (
    <section
      ref={scene}
      id="signal"
      data-tone="dark"
      aria-labelledby="signal-heading"
      className="relative bg-[#060B12] text-white"
    >
      <h2 id="signal-heading" className="sr-only">
        How a morning at home becomes something a clinician can act on
      </h2>

      {/* The instrument. `sticky`, so the browser does the pinning and the scroll stays
          the visitor's. Behind the text on a phone, beside it on a desktop. */}
      <div className="pointer-events-none sticky top-0 h-screen overflow-hidden">
        {/* The canvas box IS the frame: `CortexField` fits the arrangement to whatever
            element it is given, so narrowing it on a desktop puts the cloud in the left
            half at a legible density instead of spreading eighteen thousand points across
            a 1440 px screen as dust. On a phone it is full width and the text sits over it. */}
        <CortexField
          ref={cortex}
          initialState={0}
          className="absolute inset-x-0 bottom-0 h-[56%] lg:inset-y-0 lg:right-auto lg:h-full lg:w-[56%]"
        />
        {/* The scrim exists for legibility, not for style. On a phone the text sits ABOVE
            the cloud rather than on it — stacking them was legible only because the scrim
            was veiling the picture, which is a bad trade in both directions — so this only
            has to soften the seam. On a desktop it protects the text column. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-[#060B12] via-[#060B12]/45 to-transparent
                     lg:bg-gradient-to-l lg:from-[#060B12] lg:via-[#060B12]/85 lg:to-transparent"
        />

        {/* Where the visitor is in the sequence. One line, updated six times. */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-6 pb-6">
            <span className="font-mono text-[10px] tracking-[0.22em] text-white/40">
              {ACTS[act].n} / {String(ACTS.length).padStart(2, "0")}
            </span>
            <span aria-hidden className="flex flex-1 gap-1.5">
              {ACTS.map((a, i) => (
                <span
                  key={a.n}
                  className="h-px flex-1 origin-left transition-colors duration-500"
                  style={{ background: i <= act ? "rgba(127,178,240,0.75)" : "rgba(255,255,255,0.12)" }}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* The acts, pulled back up over the sticky plate. `-mt-[100vh]` and a per-act
          `min-h` are what make the section exactly as tall as the sequence is long. */}
      <div className="relative -mt-[100vh]">
        {ACTS.map((a) => (
          <article
            key={a.n}
            className="mx-auto flex min-h-[85vh] max-w-[1680px] items-start px-6 pt-[13vh] lg:min-h-screen lg:items-center lg:pt-0"
          >
            <div className="max-w-xl lg:ml-auto lg:mr-[4%]">
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#7FB2F0]">
                  {a.n} · {a.kicker}
                </p>
              </Reveal>
              <Reveal step={1}>
                <h3 className="mt-5 text-[clamp(1.6rem,3.4vw,2.5rem)] font-semibold leading-[1.1] tracking-[-0.028em]">
                  {a.head}
                </h3>
              </Reveal>
              <Reveal step={2}>
                <p className="mt-5 text-[16px] leading-[1.62] text-white/62 sm:text-[17px]">
                  {a.body}
                </p>
              </Reveal>
              <Reveal step={3}>
                <p className="mt-6 border-l-2 border-[#7FB2F0]/50 pl-4 text-[15px] leading-relaxed text-white/85">
                  {a.point}
                </p>
              </Reveal>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
