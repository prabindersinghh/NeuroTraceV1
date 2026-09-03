/**
 * The public landing page — `/` when signed out.
 *
 * WHAT THIS PAGE IS FOR
 * ---------------------
 * One argument, in as few words as it can be made. A visitor who scrolls to the bottom
 * should be able to restate it:
 *
 *   Nobody measures a stroke survivor between appointments. You cannot fix that with a
 *   threshold, because a survivor is outside the population's normal range every day by
 *   definition. So compare them to themselves — refuse to raise an alarm unless the change
 *   persists, appears in more than one system, and has a side — and build the whole thing
 *   so it runs where the neurologists are not.
 *
 * That last clause is the part a visitor is most likely to assume we have hand-waved, so
 * it gets a section of its own (`#reach`) that names the assumption it refuses rather than
 * claiming a reach we have not achieved.
 *
 * THE SHAPE. An overture, then the evidence. `SignalScene` states the whole argument in
 * seven acts against one continuous visual; everything after it is the substantiation, in
 * the order a sceptic would ask for it — whose normal, what stops a false alarm, what a
 * real run looks like, what is actually measured, what leaves the phone, where it can run,
 * and what we do not claim.
 *
 * WHAT IT MAY NOT DO
 * ------------------
 * No number here is invented. Every figure is in the README, in
 * `backend/app/engine/gates.py`, or in `backend/app/exam/registry.py`; the four incidence
 * figures are published ranges and say so on the page; and the illustrated run says on its
 * face that it is the seeded demo run. The three-word test for a new sentence here is
 * "which file proves this".
 *
 * MOTION
 * ------
 * Every scroll-linked effect on this page runs off the single rAF ticker in `lib/motion`
 * and writes to the DOM or a canvas directly, so scrubbing seven arrangements does not
 * reconcile a React tree sixty times a second. The GPU field is `CortexField`, which is
 * raw WebGL2 and no library — see D-039, D-064 and that file's header for why three.js
 * and GSAP are both absent on a page that is unusually motion-heavy. Smooth scrolling is
 * Lenis, loaded only here, and off on touch and under reduced motion. Every effect has a
 * reduced-motion end state.
 */
import { Suspense, lazy, useMemo } from "react";
import { Link } from "react-router-dom";

import { GateBoard } from "@/components/landing/GateBoard";
import { HeroConsole } from "@/components/landing/HeroConsole";
import { LandingNav } from "@/components/landing/LandingNav";
import { NinetyDays } from "@/components/landing/NinetyDays";
import { PipelineFlow } from "@/components/landing/PipelineFlow";
import { PopulationBand } from "@/components/landing/PopulationBand";
import { RunTimeline } from "@/components/landing/RunTimeline";
import { SignalScene } from "@/components/landing/SignalScene";
import { SymmetryDiagram } from "@/components/landing/SymmetryDiagram";
import { DOMAINS, NON_GATING, buildRun } from "@/components/landing/traceData";
import { LineReveal, Reveal } from "@/components/motion/Reveal";
import { useSmoothScroll } from "@/lib/motion";

/**
 * The mesh pulls in the MediaPipe wrapper. Splitting it out of the landing chunk is the
 * difference between a marketing page that costs 800 kB and one that costs a fifth of
 * that; the model itself only loads when the visitor asks for their camera.
 */
const FaceMeshShowcase = lazy(() =>
  import("@/components/FaceMeshShowcase").then((m) => ({ default: m.FaceMeshShowcase })),
);

function Rule({ n, label, dark = false }: { n: string; label: string; dark?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-t pt-4 ${dark ? "border-white/15" : "border-line"}`}>
      <span className={`font-mono text-[11px] tracking-[0.2em] ${dark ? "text-[#7FB2F0]" : "text-accent"}`}>{n}</span>
      <span className={`font-mono text-[11px] uppercase tracking-[0.2em] ${dark ? "text-white/50" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}

const SHELL = "mx-auto max-w-[1680px] px-6";
const H2 = "text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.025em]";
const LEAD = "text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]";
const CTA_PRIMARY = "focus-ring tactile group inline-flex items-center gap-2 rounded-xl bg-foreground "
  + "px-6 py-3.5 text-[15px] font-medium text-background hover:-translate-y-0.5";
const CTA_SECONDARY = "focus-ring tactile rounded-xl border border-line px-6 py-3.5 text-[15px] "
  + "hover:border-foreground/40";

/**
 * What a deployment is normally allowed to assume, and what this one refuses to.
 *
 * Written as refusals rather than as features on purpose. "Works offline" is a claim every
 * product makes; "the session completes in airplane mode and syncs later, and syncing the
 * same morning twice does not duplicate it" is a description of a decision that can be
 * checked. Each row is a thing in the repository, not an aspiration.
 */
const ASSUMPTIONS: [string, string][] = [
  ["a clinic visit",
   "The exam runs on the survivor's own phone. Nothing to install in a room, nothing to "
   + "calibrate, and nobody to travel to on the morning it matters."],
  ["specialist hardware",
   "A camera and a microphone. The face and pose landmarkers are production models pinned "
   + "by content hash and served from our own origin, not fetched from a vendor CDN."],
  ["a reliable connection",
   "The session completes in airplane mode and syncs when there is signal. Sync is "
   + "idempotent, so a household on a flaky link can sync the same morning twice safely."],
  ["a shared language",
   "English, Hindi and Punjabi throughout — and the reader's own choice wins over the "
   + "patient record, so a caregiver reading in English never meets a Punjabi emergency card."],
  ["a trained operator",
   "The survivor's view is one button and a short session. The ASHA worker's view is a "
   + "household round with what is due, queued locally and synced later."],
  ["a confident reader",
   "Instructions are spoken as well as written wherever the browser can speak them, at a "
   + "20 px floor with 64 px touch targets on every patient surface."],
];

export default function Landing() {
  const series = useMemo(() => buildRun(42), []);
  useSmoothScroll();

  return (
    <div id="top" className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to content
      </a>

      <LandingNav />

      <main id="main">
        {/* ══════════════════════════════════════════════════════════ 01 · HERO */}
        <section className={`${SHELL} pb-16 pt-10 sm:pt-14 lg:pb-24`}>
          <div className="grid items-center gap-10 lg:grid-cols-[1.14fr_0.86fr] lg:gap-14">
            <div>
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Post-stroke recovery · measured at home · EN / हिं / ਪੰ
                </p>
              </Reveal>

              <h1 className="mt-6 text-[clamp(2rem,3.5vw,3.9rem)] font-semibold leading-[1.03] tracking-[-0.032em]">
                <LineReveal lines={["Twenty minutes of neurology,", "every three months."]} />
                <LineReveal
                  lines={["Three minutes a day is more."]}
                  className="block text-muted-foreground"
                  step={2}
                />
              </h1>

              <Reveal step={4} className="mt-6 max-w-xl">
                <p className="text-[17px] leading-[1.6] text-muted-foreground sm:text-[19px]">
                  Recovery happens at home, over months, where nothing is measured.
                  NeuroTrace runs a three-minute neurological check on the survivor's own
                  phone each morning, learns what normal looks like{" "}
                  <em className="not-italic text-foreground">for that one person</em>, and
                  gives a clinician the days in between — offline, in three languages, on
                  the handset the family already owns.
                </p>
              </Reveal>

              <Reveal step={5} className="mt-8 flex flex-wrap items-center gap-3">
                {/* The demo is one tap on the sign-in screen; sending a visitor to
                    /register asked them to invent an account to look at a demo. */}
                <Link to="/login" className={CTA_PRIMARY}>
                  Open the demo
                  <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                </Link>
                <a href="#gates" className={CTA_SECONDARY}>See how it decides</a>
              </Reveal>

              <Reveal step={6} className="mt-8">
                <p className="max-w-lg border-l-2 border-watch pl-4 text-[14px] leading-relaxed text-muted-foreground">
                  It reasons over days, so it cannot see a stroke that is happening now.
                  Sudden weakness, a drooping face or slurred speech is an emergency —
                  call 108 first, always.
                </p>
              </Reveal>
            </div>

            {/* The instrument. Dark because it is an instrument inside a light page, not a
                second theme: the product surfaces stay light for patients in daylight. */}
            <Reveal step={3} y={24}>
              <HeroConsole series={series} />
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ 02 · THE GAP */}
        <section id="gap" className="border-y border-line bg-surface/50">
          <div className={`${SHELL} py-16 lg:py-20`}>
            <Reveal><Rule n="01" label="The gap" /></Reveal>

            <div className="mt-7 grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
              <div>
                <h2 className={H2}>
                  <LineReveal lines={["Ninety days between", "appointments. One of them", "is measured."]} />
                </h2>
                <Reveal step={2} className="mt-5 max-w-lg">
                  <p className={LEAD}>
                    A neurologist sees a survivor for about twenty minutes, once every one to
                    three months. What goes wrong in between goes wrong slowly — and is
                    noticed when it has become a crisis.
                  </p>
                </Reveal>
              </div>

              <Reveal step={2}>
                <NinetyDays />
              </Reveal>
            </div>

            {/* All four are the README's, and all four are published ranges rather than
                anything this product measured. Said so, on the page. */}
            <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["39–47%", "develop post-stroke cognitive impairment"],
                ["~60%", "still have aphasia or dysarthria past six months"],
                ["11–41%", "develop post-stroke depression"],
                ["1 in 4", "has a second stroke"],
              ].map(([stat, label], i) => (
                <Reveal key={stat} step={i} y={22} className="bg-background p-5">
                  <p className="text-[27px] font-semibold tracking-[-0.02em] tabular-nums">{stat}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{label}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Published incidence ranges. Not measurements taken by this product.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ══════════════════════════════════════════ 03 · THE ARGUMENT, IN SIX ACTS */}
        <SignalScene />

        {/* ════════════════════════════════════════════════════ 04 · WHOSE NORMAL */}
        <section id="baseline" className={`${SHELL} py-16 lg:py-20`}>
          <Reveal><Rule n="02" label="Whose normal" /></Reveal>
          <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-end lg:gap-14">
            <h2 className={H2}>
              <LineReveal lines={["Normal is a person,", "not a population."]} />
            </h2>
            <Reveal step={2}>
              <p className={LEAD}>
                A stroke survivor is outside the population's normal range on the day they
                come home and on every day after — that is what a stroke is. So a population
                threshold either fires every morning until someone mutes it, or is widened
                until it can no longer see anything. We compare each morning to that person's
                own last twelve sessions instead.
              </p>
            </Reveal>
          </div>

          {/* The same data, twice, with only the reference changed. Two static plates rather
              than a scrubbed morph: the comparison is the point, and a comparison you can
              look back and forth between is read faster than one you have to scroll. */}
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {[
              { p: 0, label: "AGAINST A POPULATION", note: "Flagged every single day. Useless by the end of the first week." },
              { p: 1, label: "AGAINST THEMSELVES", note: "Flat for eighteen days, then days 19–21 move. Same data, different reference." },
            ].map((panel, i) => (
              <Reveal key={panel.label} step={i} y={26}>
                <div className="rounded-2xl border border-white/10 bg-[#0A121C] p-4">
                  <p className="pb-3 font-mono text-[10px] tracking-[0.2em] text-white/45">{panel.label}</p>
                  <PopulationBand progress={panel.p} />
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{panel.note}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ 05 · THE DECISION */}
        {/* The Parkinson's confound and the three gates are one section, because the
            confound is the ONLY reason the third gate exists. Splitting them, as this page
            used to, made Gate 3 read as fussiness rather than as the answer to a specific
            way this system could have been fooled. */}
        <section id="gates" className="border-y border-line bg-surface/50">
          <div className={`${SHELL} py-16 lg:py-20`}>
            <div className="mx-auto max-w-3xl text-center">
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  The decision
                </p>
              </Reveal>
              {/* The forced line breaks are sized for the narrowest viewport: a "line" that
                  wraps again inside its own mask produces a ragged centred block. */}
              <h2 className="mt-6 text-[clamp(1.6rem,3.6vw,2.6rem)] font-semibold leading-[1.12] tracking-[-0.028em]">
                <LineReveal
                  lines={[
                    "Three domains agreeing",
                    "looks like overwhelming",
                    "evidence.",
                    <span key="k" className="text-muted-foreground">Sometimes it is evidence</span>,
                    <span key="l" className="text-muted-foreground">of the wrong thing.</span>,
                  ]}
                />
              </h2>
              <Reveal step={5} className="mx-auto mt-7 max-w-xl">
                <p className={LEAD}>
                  Parkinson's slows the hand, quietens the voice and flattens the face — all
                  at once, and it is common in the age band we monitor. Persistence and
                  corroboration alone would make it our most confident alert, for a condition
                  this product does not monitor and cannot help with.
                </p>
              </Reveal>
            </div>

            <Reveal className="mt-10">
              <SymmetryDiagram />
            </Reveal>

            <div className="mt-16">
              <Reveal><Rule n="03" label="Three gates" /></Reveal>
              <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-14">
                <h2 className={H2}>
                  <LineReveal lines={["Three gates. All three,", "or it is not an alert."]} />
                </h2>
                <Reveal step={2}>
                  <p className={LEAD}>
                    A false alarm does not cost one notification — it costs the product, because
                    a muted tool detects nothing. Each gate refuses a specific way this system
                    could have been fooled. Pick one.
                  </p>
                </Reveal>
              </div>
              <Reveal step={3} className="mt-10">
                <GateBoard />
              </Reveal>

              <Reveal className="mt-8 rounded-2xl border border-line bg-background p-5 sm:p-6">
                <p className="text-[16px] font-medium">And an improving trajectory never alerts.</p>
                <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
                  A recovering patient deviates enormously from a baseline taken when they were
                  worse. That is the largest signal this engine will ever see, and it is success.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ 06 · THE RUN */}
        <section id="run">
          <div className={`${SHELL} pb-2 pt-16 lg:pt-20`}>
            <Reveal><Rule n="04" label="Twenty-one days" /></Reveal>
            <Reveal step={1} className="mt-7 max-w-2xl">
              <h2 className={H2}>One alert for the episode. Not one every morning.</h2>
            </Reveal>
          </div>
          <RunTimeline series={series} />
        </section>

        {/* ════════════════════════════════════════════════ 07 · WHAT IT MEASURES */}
        <section id="measures" className="border-y border-line bg-surface/50">
          <div className={`${SHELL} py-16 lg:py-20`}>
            <Reveal><Rule n="05" label="What it measures" /></Reveal>
            <div className="mt-7 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-14">
              <h2 className={H2}>
                <LineReveal lines={["Seven domains can raise a flag.", "Four of them carry a side."]} />
              </h2>
              <Reveal step={2}>
                <p className={LEAD}>
                  Twenty-one tasks. Six run every day inside the three-minute budget; the rest
                  are weekly or monthly. Speech and language have no left or right — they can
                  back up a one-sided finding, never establish one.
                </p>
              </Reveal>
            </div>

            <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-background">
              {DOMAINS.map((domain, i) => (
                <Reveal
                  key={domain.key}
                  step={i}
                  y={14}
                  className="grid grid-cols-1 gap-1.5 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[minmax(150px,0.85fr)_minmax(0,2.4fr)_auto] sm:items-baseline sm:gap-6"
                >
                  <p className="text-[15px] font-medium">{domain.label}</p>
                  <p className="text-[14px] leading-relaxed text-muted-foreground">{domain.measures}</p>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className="font-mono text-[11px] text-muted-foreground">{domain.modules}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${
                        domain.lateral ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {domain.lateral ? "HAS A SIDE" : "NO SIDE"}
                    </span>
                  </div>
                </Reveal>
              ))}
            </div>

            {/* Two rows, not two cards. They are recorded daily and shown to the clinician
                and they never gate — which is one sentence, and used to be a grid. */}
            <Reveal className="mt-3.5">
              <p className="text-[14px] leading-relaxed text-muted-foreground">
                {NON_GATING.map((row) => `${row.label} (${row.modules}) — ${row.note}`).join(". ")}. Recorded
                every day and shown to the clinician; never allowed to gate an alert on their own.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ════════════════════════════════════════════════════════ 08 · ON DEVICE */}
        <section id="device" className={`${SHELL} py-16 lg:py-20`}>
          <Reveal><Rule n="06" label="On the phone" /></Reveal>
          <div className="mt-7 grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14">
            <div>
              <h2 className={H2}>
                <LineReveal lines={["The server has no endpoint", "that accepts a recording."]} />
              </h2>
              <Reveal step={2} className="mt-5 max-w-xl space-y-4">
                <p className={LEAD}>
                  Landmarks and audio features are computed in the browser and the frames are
                  dropped in the same tick. What syncs is a dictionary of numbers.
                </p>
                <p className={LEAD}>
                  This is not a policy someone has to remember. There is no upload route for
                  audio, video or images anywhere in the API, and no column in the database
                  that could hold one — so a deployment mistake cannot leak a recording that
                  was never sent.
                </p>
              </Reveal>

              <PipelineFlow />
            </div>

            <Reveal step={2}>
              <Suspense
                fallback={
                  <div className="aspect-[4/5] w-full max-w-[360px] animate-pulse rounded-2xl border border-line bg-surface" />
                }
              >
                <FaceMeshShowcase className="max-w-[360px]" />
              </Suspense>
              <p className="mt-3 max-w-[360px] text-[13px] leading-relaxed text-muted-foreground">
                The panel above is a labelled diagram, and says so. Turn on your camera and it
                is replaced by the real landmarker — the same pinned model the daily check-in
                loads — running on your face, in your browser. There is no stock portrait here
                on purpose: a real person's face under a medical overlay, on a page about
                stroke, is a claim nobody in a photo library consented to.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ 09 · REACH */}
        <section id="reach" className="border-y border-line bg-surface/50">
          <div className={`${SHELL} py-16 lg:py-20`}>
            <Reveal><Rule n="07" label="Where it can run" /></Reveal>
            <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-end lg:gap-14">
              <h2 className={H2}>
                <LineReveal lines={["Every assumption is a", "district you decided", "not to serve."]} />
              </h2>
              <Reveal step={2}>
                <p className={LEAD}>
                  Specialist neurology concentrates where the specialists are. A tool that
                  quietly needs a clinic, a device, a connection or a language inherits that
                  same map and calls it a market. These are the six assumptions this one
                  refuses to make, and what it does instead.
                </p>
              </Reveal>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
              {ASSUMPTIONS.map(([assumption, answer], i) => (
                <Reveal key={assumption} step={i % 2} y={18} className="bg-background p-5 sm:p-6">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Assume <span className="text-foreground/70 line-through decoration-watch decoration-2">{assumption}</span>
                  </p>
                  <p className="mt-3 text-[15px] leading-relaxed">{answer}</p>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Six decisions in the repository. Not a claim about deployments that exist.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ 10 · AWAAZ */}
        <section id="awaaz" className={`${SHELL} py-16 lg:py-20`}>
          <Reveal><Rule n="08" label="Being understood" /></Reveal>
          <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
            <div>
              <h2 className={H2}>
                <LineReveal lines={["Awaaz — so they can", "be understood."]} />
              </h2>
              <Reveal step={2} className="mt-5">
                <p className={LEAD}>
                  A communication board for survivors whose speech was affected. It runs on the
                  speech profile the daily check-in already produces, so it behaves differently
                  for a muscle problem than for a language one — which is the difference between
                  helping someone speak and speaking over them.
                </p>
              </Reveal>
            </div>
            <Reveal step={2} className="space-y-3 text-[14px] leading-relaxed">
              <p className="rounded-xl border border-line p-4">
                <strong className="font-medium">Dysarthria</strong> — the muscles are affected,
                the message is intact. Confident speech is spoken aloud automatically.
              </p>
              <p className="rounded-xl border-2 border-accent/30 bg-accent/5 p-4">
                <strong className="font-medium">Aphasia</strong> — the language system is
                affected, and the intended words may not be the ones produced. So the system
                only ever offers candidates, and nothing is spoken until the patient taps one.
                Putting words into a mouth that cannot veto them is the one thing this feature
                must never do, and the rule is enforced on the server.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════ 11 · WHAT WE DO NOT CLAIM */}
        {/* A chapter break, not a band of colour: the dark plate rides up over the page on
            its own rounded edge, so the tone change reads as deliberate. */}
        <section id="limits" data-tone="dark" className="relative -mt-6 rounded-t-[1.75rem] bg-[#0A121C] text-white">
          <div className={`${SHELL} py-16 lg:py-20`}>
            <Reveal><Rule n="09" label="What we do not claim" dark /></Reveal>
            <h2 className={`mt-7 max-w-2xl ${H2}`}>
              <LineReveal lines={["The limits are part of the product."]} />
            </h2>
            <Reveal step={2} className="mt-5 max-w-xl">
              <p className="text-[16px] leading-relaxed text-white/60 sm:text-[17px]">
                A monitoring tool that oversells itself is worse than no tool, because the
                family stops looking. So these are here, in onboarding, and in the app.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-2">
              {[
                ["It does not diagnose, and it does not detect stroke.",
                 "It measures findings against a person's own history and reports what changed. Every trained model publishes its metrics and a limitations note."],
                ["Three of the five models are trained on synthetic data today.",
                 "Labelled synthetic in the repository, in each model card, and here, while dataset access is pending. The face and pose landmarkers are production models, pinned by content hash."],
                ["It cannot see an acute stroke.",
                 "So the FAST card renders after every session and on every dashboard — always, not only when the band is high. An acute symptom report bypasses the engine entirely."],
                ["Nothing may assert wellness.",
                 "“You are fine”, “all clear”, “nothing to worry about” are forbidden in three languages, enforced by a test that sweeps the shipped source."],
                ["It is for one population, deliberately.",
                 "Anterior-circulation ischemic stroke, three or more months post-discharge, clinically stable, living at home. Enrolment below three months is refused in one place, so no other route can bypass it."],
                ["Nothing has run on a physical phone yet.",
                 "Camera framing and pose scaling at 1.5 m are desktop-browser only so far. It is the largest untested surface in the product, and it is written down as such."],
              ].map(([head, body], i) => (
                <Reveal key={head} step={i % 2} y={18} className="bg-[#0A121C] p-6">
                  <p className="text-[16px] font-medium leading-snug">{head}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/55">{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ 12 · CLOSE */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center lg:py-24">
          <h2 className="text-[clamp(1.9rem,4vw,2.9rem)] font-semibold leading-[1.07] tracking-[-0.03em]">
            <LineReveal lines={["Make recovery visible.", "Make care continuous."]} />
          </h2>
          <Reveal step={3} className="mx-auto mt-6 max-w-xl">
            <p className={LEAD}>
              A recovery that is only visible at the clinic is only visible to the people who
              can reach one. Nobody can watch a survivor for ninety days — but three minutes
              a morning, on a phone they already own, they can.
            </p>
          </Reveal>
          <Reveal step={4} className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className={CTA_PRIMARY}>
              Open the demo
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
            </Link>
            <Link to="/register" className={CTA_SECONDARY}>Create an account</Link>
          </Reveal>

          {/* The ninety days again, all of them measured. The page opened on this picture
              with one square lit; closing on the finished one is the argument, resolved. */}
          <Reveal step={6} className="mx-auto mt-14 max-w-lg">
            <NinetyDays complete />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              ninety mornings · three minutes each · nothing leaves the phone
            </p>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className={`${SHELL} flex flex-col gap-3 py-7 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between`}>
          <span>Built for families in Punjab. Works offline. Nothing identifiable leaves the phone.</span>
          <span className="font-mono tracking-wide">engine deterministic · seed 42</span>
        </div>
      </footer>
    </div>
  );
}
