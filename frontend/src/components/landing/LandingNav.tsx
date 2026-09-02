/**
 * The signed-out header.
 *
 * Two behaviours, both functional: it acquires a ground and a rule once the page has
 * scrolled off the hero, so display type never collides with nav labels; and it carries a
 * one-pixel read of how far through the story the visitor is, which on a page built as a
 * single argument is orientation rather than ornament.
 *
 * The section links are real anchors, so they work with the keyboard, with a middle click
 * and with JavaScript broken. `scroll-margin-top` in index.css keeps the target heading
 * clear of this bar — without it every jump lands with the heading underneath the header.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { DURATION, EASE } from "@/lib/motion";

/** The desktop bar. Seven, because an eighth wraps at 1280px and a wrapped nav reads as
 *  an accident. The full set is in the phone menu below, which has room for all of them. */
const SECTIONS = [
  ["#gap", "The gap"],
  ["#signal", "The signal"],
  ["#baseline", "Whose normal"],
  ["#gates", "The decision"],
  ["#run", "21 days"],
  ["#reach", "Reach"],
  ["#limits", "Limits"],
];

/** Everything, for the phone menu — where a longer list costs nothing. */
const ALL_SECTIONS = [
  ...SECTIONS.slice(0, 5),
  ["#measures", "What it measures"],
  ["#device", "On the phone"],
  ["#reach", "Reach"],
  ["#awaaz", "Awaaz"],
  ["#limits", "Limits"],
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  // The page has two dark chapters, and a white bar laid over either of them reads as a
  // slab someone forgot to style. The header takes the tone of whatever is under it.
  const [onDark, setOnDark] = useState(false);

  useEffect(() => {
    const marked = document.querySelectorAll("[data-tone='dark']");
    if (!marked.length || typeof IntersectionObserver === "undefined") return;
    const live = new Set<Element>();
    // A one-pixel band at the header's own baseline: a section counts as "under the bar"
    // exactly when it crosses that line, which is the only place the question matters.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) live.add(entry.target);
        else live.delete(entry.target);
      }
      setOnDark(live.size > 0);
    }, { rootMargin: "-56px 0px -100% 0px" });
    marked.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(window.scrollY > 24);
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <header
      className="sticky top-0 z-50"
      data-dark={onDark || undefined}
      style={{
        background: scrolled
          ? (onDark ? "rgba(6,11,18,0.82)" : "hsl(var(--background) / 0.86)")
          : "hsl(var(--background) / 0)",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: `1px solid ${scrolled ? (onDark ? "rgba(255,255,255,0.10)" : "hsl(var(--border))") : "transparent"}`,
        color: onDark ? "#E6EDF6" : undefined,
        transition: `background-color ${DURATION.fast}ms ${EASE.standard},`
          + ` border-color ${DURATION.fast}ms ${EASE.standard}, color ${DURATION.fast}ms ${EASE.standard}`,
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5">
        <a href="#top" className="focus-ring shrink-0 rounded text-[15px] font-semibold tracking-[-0.01em]">
          NeuroTrace
        </a>
        <nav aria-label="Sections" className="hidden min-w-0 flex-1 items-center gap-5 lg:flex">
          {SECTIONS.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className={`focus-ring rounded text-[13px] transition-colors ${onDark ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
            >
              {label}
            </a>
          ))}
        </nav>
        {/* The phone menu. `<details>` rather than a state-driven panel: the platform
            already gives us the disclosure semantics, the keyboard behaviour and the
            open/close, and a nav that works before hydration is one fewer thing that can
            be broken by a slow first load. */}
        <details className="group relative ml-auto lg:hidden">
          <summary className={`focus-ring flex list-none items-center gap-1.5 rounded-lg px-3 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden ${onDark ? "text-white/70" : "text-muted-foreground"}`}>
            Sections
            <span aria-hidden className="transition-transform duration-200 group-open:rotate-180">▾</span>
          </summary>
          {/* Closing on choose is the one thing `<details>` does not give us: without it
              the panel stays open over the heading the visitor just jumped to. */}
          <nav
            aria-label="All sections"
            onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
            className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-line bg-background p-1.5"
          >
            {ALL_SECTIONS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="focus-ring block rounded-lg px-3 py-2.5 text-[14px] text-muted-foreground hover:bg-surface hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </nav>
        </details>

        <div className="flex items-center gap-1.5 lg:ml-auto">
          <Link to="/login" className={`focus-ring hidden rounded-lg px-3 py-2 text-sm sm:block ${onDark ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}>
            Log in
          </Link>
          {/* The demo lives on the sign-in screen (one tap, no form). This pointed at
              /register, where a visitor was asked to invent an account to see a demo. */}
          <Link
            to="/login"
            className={`focus-ring tactile rounded-lg px-4 py-2 text-sm font-medium ${
              onDark ? "bg-white text-[#0A121C]" : "bg-foreground text-background"
            }`}
          >
            {/* "Open the demo" wraps to two lines at 390 px and doubles the header's
                height. The short form only appears where the long one does not fit. */}
            <span className="sm:hidden">Demo</span>
            <span className="hidden sm:inline">Open the demo</span>
          </Link>
        </div>
      </div>
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-accent"
        style={{ transform: `scaleX(${progress})` }}
      />
    </header>
  );
}
