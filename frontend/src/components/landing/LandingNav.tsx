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

const SECTIONS = [
  ["#problem", "The gap"],
  ["#baseline", "Whose normal"],
  ["#gates", "The decision"],
  ["#run", "21 days"],
  ["#device", "On the phone"],
  ["#measures", "What it measures"],
  ["#limits", "Limits"],
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

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
      style={{
        background: scrolled ? "hsl(var(--background) / 0.86)" : "hsl(var(--background) / 0)",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: `1px solid ${scrolled ? "hsl(var(--border))" : "transparent"}`,
        transition: `background-color ${DURATION.fast}ms ${EASE.standard}, border-color ${DURATION.fast}ms ${EASE.standard}`,
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
              className="focus-ring rounded text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link to="/login" className="focus-ring rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            Log in
          </Link>
          {/* The demo lives on the sign-in screen (one tap, no form). This pointed at
              /register, where a visitor was asked to invent an account to see a demo. */}
          <Link
            to="/login"
            className="focus-ring rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Open the demo
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
