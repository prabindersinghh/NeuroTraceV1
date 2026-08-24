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
 *   definition. So compare them to themselves — and then refuse to raise an alarm unless
 *   the change persists, appears in more than one system, and has a side.
 *
 * Everything else on the page — the domain table, the pipeline, the care network, Awaaz,
 * the limits — hangs off those beats rather than competing with them, and every block is
 * written to be read at a glance: two short sentences, plain words, the technical term
 * only where it is load-bearing. The earlier draft said the same things in twice as many
 * words and was correspondingly harder to follow. Length is the enemy on this page, not
 * detail.
 *
 * WHAT IT MAY NOT DO
 * ------------------
 * No number here is invented. Every figure is in the README, in
 * `backend/app/engine/gates.py`, or in `backend/app/exam/registry.py`, and the illustrated
 * run says on its face that it is the seeded demo run.
 *
 * MOTION
 * ------
 * IntersectionObserver, CSS transitions and two canvases. No animation library — see the
 * note at the top of `lib/motion.ts`. Every effect has a reduced-motion end state.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { GateBoard } from "@/components/landing/GateBoard";
import { LandingNav } from "@/components/landing/LandingNav";
import { NinetyDays } from "@/components/landing/NinetyDays";
import { PopulationBand } from "@/components/landing/PopulationBand";
import { RunTimeline } from "@/components/landing/RunTimeline";
import { TraceLanes } from "@/components/landing/TraceLanes";
import { DOMAINS, NON_GATING, buildRun } from "@/components/landing/traceData";
import { LineReveal, Reveal } from "@/components/motion/Reveal";
import { useTween } from "@/lib/motion";

/**
 * The portrait the mesh runs on.
 *
 * Hotlinked from Unsplash under their licence, with their documented CDN parameters, and
 * NOT vendored into the repository — `*.jpg` is gitignored and `test_no_source_image_is_tracked`
 * fails the build on any tracked raster image, because the working tree also contains
 * photographs of a real patient's records. Punching an exception through that rule to save
 * one request on a marketing page is not a trade worth making.
 *
 * An external request is acceptable HERE and nowhere else in the product: this page has no
 * offline promise and no patient on it. The exam never loads a third-party asset. If the
 * fetch fails, `FaceMeshShowcase` draws nothing rather than faking a mesh.
 */
const PORTRAIT =
  "https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&w=760&q=70";

/**
 * The mesh pulls in the MediaPipe wrapper. Splitting it out of the landing chunk is the
 * difference between a marketing page that costs 800 kB and one that costs a fifth of
 * that; the model itself was already deferred to intersection, the code loading it was not.
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

const H2 = "text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.1] tracking-[-0.025em]";
const LEAD = "text-[16px] leading-relaxed text-muted-foreground sm:text-[17px]";

export default function Landing() {
  const series = useMemo(() => buildRun(42), []);

  // The hero plate draws the eighteen quiet days and stops. It does not show the alert —
  // that is the payoff further down, and spending it here would flatten the page.
  const [heroTarget, setHeroTarget] = useState(1);
  useEffect(() => {
    const t = window.setTimeout(() => setHeroTarget(18), 260);
    return () => window.clearTimeout(t);
  }, []);
  const heroDay = useTween(heroTarget, 2400);

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
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 sm:pt-14 lg:pb-24">
          <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
            <div>
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Post-stroke recovery · measured at home · EN / हिं / ਪੰ
                </p>
              </Reveal>

              <h1 className="mt-6 text-[clamp(2.05rem,5.6vw,3.9rem)] font-semibold leading-[1.03] tracking-[-0.032em]">
                <LineReveal lines={["Twenty minutes of neurology,", "every three months."]} />
                <LineReveal
                  lines={["Ninety seconds a day is more."]}
                  className="block text-muted-foreground"
                  step={2}
                />
              </h1>

              <Reveal step={4} className="mt-6 max-w-xl">
                <p className="text-[17px] leading-[1.6] text-muted-foreground sm:text-[19px]">
                  Recovery happens at home, where nobody is measuring anything. NeuroTrace
                  runs a ninety-second neurological check on the survivor's own phone each
                  morning and learns what normal looks like{" "}
                  <em className="not-italic text-foreground">for that one person</em>.
                </p>
              </Reveal>

              <Reveal step={5} className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/register"
                  className="focus-ring group inline-flex items-center gap-2 rounded-xl bg-foreground px-6 py-3.5 text-[15px] font-medium text-background"
                >
                  Open the demo
                  <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                </Link>
                <a
                  href="#gates"
                  className="focus-ring rounded-xl border border-line px-6 py-3.5 text-[15px] transition-colors hover:border-foreground/40"
                >
                  See how it decides
                </a>
              </Reveal>

              <Reveal step={6} className="mt-8">
                <p className="max-w-lg border-l-2 border-watch pl-4 text-[14px] leading-relaxed text-muted-foreground">
                  A monitoring aid, not a medical device. It reasons over days, so it cannot
                  see a stroke that is happening now. Sudden weakness, a drooping face or
                  slurred speech is an emergency — call 108 first, always.
                </p>
              </Reveal>
            </div>

            {/* The instrument. Dark because it is an instrument inside a light page, not a
                second theme: the product surfaces stay light for patients in daylight. */}
            <Reveal step={3} y={24}>
              <div className="rounded-2xl border border-white/10 bg-[#0A121C] p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-3 pb-3">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
                    SEVEN DOMAINS · ONE PERSON
                  </p>
                  <p className="font-mono text-[10px] tracking-[0.2em] text-white/45">
                    DAY {String(Math.round(heroDay)).padStart(2, "0")}
                  </p>
                </div>
                <TraceLanes series={series} day={heroDay} laneHeight={30} />
              </div>
              <p className="mt-3 font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
                Seeded demo run · the band is this person's own normal, and it does not exist
                until twelve sessions have built it
              </p>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ 02 · THE GAP */}
        <section id="problem" className="border-y border-line bg-surface/50">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
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
                <NinetyDays measured={false} />
                <p className="mt-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  ■ examined&nbsp;&nbsp;·&nbsp;&nbsp;□ not observed
                </p>
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
                <Reveal key={stat} step={i} className="bg-background p-5">
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

        {/* ════════════════════════════════════════════════════ 03 · WHOSE NORMAL */}
        <section id="baseline" className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
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
              <Reveal key={panel.label} step={i}>
                <div className="rounded-2xl border border-white/10 bg-[#0A121C] p-4">
                  <p className="pb-3 font-mono text-[10px] tracking-[0.2em] text-white/45">{panel.label}</p>
                  <PopulationBand progress={panel.p} />
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{panel.note}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════ 04 · THE SECOND PROBLEM */}
        <section className="border-y border-line bg-surface/50">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center lg:py-20">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                The second problem
              </p>
            </Reveal>
            {/* The forced line breaks are sized for the narrowest viewport: a "line" that
                wraps again inside its own mask produces a ragged centred block on a phone. */}
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
                Parkinson's slows the hand, quietens the voice and flattens the face — all at
                once, and it is common in the age band we monitor. Persistence and
                corroboration alone would make it our most confident alert, for a condition
                this product does not monitor and cannot help with.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ 05 · THE DECISION */}
        <section id="gates" className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <div>
            <Reveal><Rule n="03" label="The decision" /></Reveal>
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

            <Reveal className="mt-8 rounded-2xl border border-line bg-surface/60 p-5 sm:p-6">
              <p className="text-[16px] font-medium">And an improving trajectory never alerts.</p>
              <p className="mt-1.5 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
                A recovering patient deviates enormously from a baseline taken when they were
                worse. That is the largest signal this engine will ever see, and it is success.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════════ 06 · THE RUN */}
        <section id="run" className="border-y border-line bg-surface/50">
          <div className="mx-auto max-w-6xl px-6 pb-2 pt-16 lg:pt-20">
            <Reveal><Rule n="04" label="Twenty-one days" /></Reveal>
            <Reveal step={1} className="mt-7 max-w-2xl">
              <h2 className={H2}>One alert for the episode. Not one every morning.</h2>
            </Reveal>
          </div>
          <RunTimeline series={series} />
        </section>

        {/* ════════════════════════════════════════════════════════ 07 · ON DEVICE */}
        <section id="device">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
            <Reveal><Rule n="05" label="On the phone" /></Reveal>
            <div className="mt-7 grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14">
              <div>
                <h2 className={H2}>
                  <LineReveal lines={["The server has no endpoint", "that accepts a recording."]} />
                </h2>
                <Reveal step={2} className="mt-5 max-w-xl space-y-4">
                  <p className={LEAD}>
                    Landmarks and audio features are computed in the browser and the frames
                    are dropped in the same tick. What syncs is a dictionary of numbers.
                  </p>
                  <p className={LEAD}>
                    This is not a policy someone has to remember. There is no upload route for
                    audio, video or images anywhere in the API, and no column in the database
                    that could hold one — so a deployment mistake cannot leak a recording that
                    was never sent.
                  </p>
                  <p className={LEAD}>
                    The session completes in airplane mode and syncs later, because the model
                    is served from our own origin and precached.
                  </p>
                </Reveal>

                <div className="mt-8 space-y-px overflow-hidden rounded-2xl border border-line">
                  {[
                    ["Capture", "The camera and microphone run a task. Nothing is written to disk."],
                    ["Extract, on device", "MediaPipe landmarks and audio DSP turn the signal into numbers, in the browser."],
                    ["Compare to their own history", "Twelve sessions of their own past. Never a population average."],
                    ["Three gates", "Persistence, then corroboration, then a side."],
                    ["Say it in their language", "One guardrailed sentence in English, Hindi or Punjabi: what changed, and what to do."],
                  ].map(([title, body], i) => (
                    <Reveal key={title} step={i} className="bg-background px-5 py-3.5">
                      <div className="flex gap-4">
                        <span className="mt-0.5 font-mono text-[11px] tabular-nums text-accent">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <p className="text-[15px] font-medium">{title}</p>
                          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{body}</p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>

              <Reveal step={2}>
                <Suspense
                  fallback={
                    <div className="aspect-[3/4] w-full max-w-[360px] animate-pulse rounded-2xl border border-line bg-background" />
                  }
                >
                  <FaceMeshShowcase src={PORTRAIT} className="max-w-[360px]" />
                </Suspense>
                <p className="mt-3 max-w-[360px] text-[13px] leading-relaxed text-muted-foreground">
                  Not an illustration — the same pinned face model the daily check-in uses,
                  running in your browser. If it cannot run here, nothing is drawn.
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════ 08 · WHAT IT MEASURES */}
        <section id="measures" className="border-y border-line bg-surface/50">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
            <Reveal><Rule n="06" label="What it measures" /></Reveal>
            <div className="mt-7 grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-14">
              <h2 className={H2}>
                <LineReveal lines={["Seven domains can raise a flag.", "Four of them carry a side."]} />
              </h2>
              <Reveal step={2}>
                <p className={LEAD}>
                  Twenty-one tasks. Six run every day inside the ninety-second budget; the rest
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
                  className="grid grid-cols-1 gap-1.5 border-b border-line px-5 py-3.5 last:border-0 sm:grid-cols-[minmax(150px,0.85fr)_minmax(0,2.4fr)_auto] sm:items-baseline sm:gap-6"
                >
                  <p className="text-[15px] font-medium">{domain.label}</p>
                  <p className="text-[14px] leading-relaxed text-muted-foreground">{domain.measures}</p>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <span className="font-mono text-[11px] text-muted-foreground">{domain.modules}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${domain.lateral ? "bg-accent/10 text-accent" : "bg-muted text-muted-foreground"
                        }`}
                    >
                      {domain.lateral ? "HAS A SIDE" : "NO SIDE"}
                    </span>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal className="mt-3.5 grid gap-3 sm:grid-cols-2">
              {NON_GATING.map((row) => (
                <div key={row.label} className="rounded-xl border border-dashed border-line px-5 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[15px] font-medium">{row.label}</p>
                    <span className="font-mono text-[11px] text-muted-foreground">{row.modules}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    {row.note}. Recorded daily and shown to the clinician — but never gates an alert.
                  </p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════ 09 · THE CARE NETWORK */}
        <section id="care" className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
          <Reveal><Rule n="07" label="One morning, four views" /></Reveal>
          <h2 className={`mt-7 max-w-2xl ${H2}`}>
            <LineReveal lines={["Four people. Four different", "views of the same morning."]} />
          </h2>

          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 lg:grid-cols-4">
            {[
              ["Survivor", "One button and a short session. Never a score — a number in front of the person being measured changes what they do next."],
              ["Caregiver", "A band, one sentence about what changed, and what to do. Confounders printed, not hidden."],
              ["Clinician", "A ranked roster, gate states, laterality, drift against a frozen reference, and an audit log."],
              ["ASHA worker", "A household list with due items. Offline-first, and safe to sync twice."],
            ].map(([who, what], i) => (
              <Reveal key={who} step={i} className="bg-background p-5">
                <p className="text-[15px] font-medium">{who}</p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{what}</p>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-5 grid gap-6 rounded-2xl border border-line p-6 sm:p-7 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                A capability inside the system
              </p>
              <h3 className="mt-4 text-[24px] font-semibold tracking-[-0.02em]">
                Awaaz — so they can be understood
              </h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
                A communication board for survivors whose speech was affected. It runs on the
                speech profile the daily check-in already produces, so it behaves differently
                for a muscle problem than for a language one.
              </p>
            </div>
            <div className="space-y-3 text-[14px] leading-relaxed">
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
            </div>
          </Reveal>
        </section>

        {/* ═══════════════════════════════════════════ 10 · WHAT WE DO NOT CLAIM */}
        <section id="limits" className="bg-[#0A121C] text-white">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
            <Reveal><Rule n="08" label="What we do not claim" dark /></Reveal>
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
                <Reveal key={head} step={i % 2} className="bg-[#0A121C] p-6">
                  <p className="text-[16px] font-medium leading-snug">{head}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-white/55">{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════ 11 · CTA */}
        <section className="mx-auto max-w-3xl px-6 py-20 text-center lg:py-24">
          <h2 className="text-[clamp(1.9rem,4vw,2.9rem)] font-semibold leading-[1.07] tracking-[-0.03em]">
            <LineReveal lines={["Nobody can watch someone", "for ninety days."]} />
            <LineReveal
              lines={["Ninety seconds a day, they can."]}
              className="block text-muted-foreground"
              step={2}
            />
          </h2>
          <Reveal step={4} className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="focus-ring group inline-flex items-center gap-2 rounded-xl bg-foreground px-7 py-4 text-[15px] font-medium text-background"
            >
              Open the demo
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              to="/login"
              className="focus-ring rounded-xl border border-line px-7 py-4 text-[15px] transition-colors hover:border-foreground/40"
            >
              Log in
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-7 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Built for families in Punjab. Works offline. Nothing identifiable leaves the phone.</span>
          <span className="font-mono tracking-wide">engine deterministic · seed 42 · not a medical device</span>
        </div>
      </footer>
    </div>
  );
}
