/**
 * The signed-out header.
 *
 * Three behaviours, all functional: it acquires a ground and a rule once the page has
 * scrolled off the hero, so display type never collides with nav labels; it carries a
 * one-pixel read of how far through the story the visitor is, which on a page built as a
 * single argument is orientation rather than ornament; and it marks WHICH section that
 * read has arrived at, so the bar, the picture and the words are never telling the visitor
 * three different things about where they are.
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

/**
 * Which DESKTOP link to mark, given the section actually under the bar.
 *
 * The bar shows seven of the ten sections — an eighth wraps at 1280px — so three of them
 * mark nothing, and a mark that simply blinks off for a third of the page reads as a bug
 * rather than as honesty. The visitor in `#measures` is past "21 days" and has not reached
 * "Reach", so "21 days" stays lit: it names the stretch they are in, which is what a
 * section mark is for. Not exported, because a component file that exports anything else
 * stops fast refresh working.
 *
 * `ALL_SECTIONS` is in document order, which is what makes "at or before" meaningful; if
 * that ever stops being true this returns a section the visitor has not reached.
 */
const desktopActive = (active: string | null): string | null => {
  if (!active) return null;
  const at = ALL_SECTIONS.findIndex(([href]) => href === active);
  if (at < 0) return null;
  const shown = new Set(SECTIONS.map(([href]) => href));
  for (let i = at; i >= 0; i -= 1) if (shown.has(ALL_SECTIONS[i][0])) return ALL_SECTIONS[i][0];
  return null;
};

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  // The page has two dark chapters, and a white bar laid over either of them reads as a
  // slab someone forgot to style. The header takes the tone of whatever is under it.
  const [onDark, setOnDark] = useState(false);
  // Which section is under the bar right now, as an href. Its own observer rather than a
  // scroll handler doing arithmetic: the question "what is crossing the header line" is
  // exactly what an IntersectionObserver with a one-pixel root band answers, and it costs
  // nothing between crossings.
  const [active, setActive] = useState<string | null>(null);

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
    if (typeof IntersectionObserver === "undefined") return;
    // Every href the two menus can reach, deduplicated — the phone menu is a superset.
    const hrefs = [...new Set([...SECTIONS, ...ALL_SECTIONS].map(([href]) => href))];
    const targets = hrefs
      .map((href) => [href, document.getElementById(href.slice(1))] as const)
      .filter((pair): pair is [string, HTMLElement] => pair[1] !== null);
    if (!targets.length) return;
    const live = new Set<string>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const href = "#" + entry.target.id;
        if (entry.isIntersecting) live.add(href);
        else live.delete(href);
      }
      // The band is one pixel tall, so usually exactly one section is in it — but on the
      // seam between two, both are, and the LATER one is the one being entered.
      const order = targets.map(([href]) => href).filter((href) => live.has(href));
      setActive(order.length ? order[order.length - 1] : null);
    }, { rootMargin: "-57px 0px -100% 0px" });
    targets.forEach(([, el]) => io.observe(el));
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

  const marked = desktopActive(active);

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
          {SECTIONS.map(([href, label]) => {
            const on = href === marked;
            return (
              <a
                key={href}
                href={href}
                aria-current={on ? "true" : undefined}
                className={`focus-ring relative rounded text-[13px] transition-colors ${
                  on
                    ? (onDark ? "text-white" : "text-foreground")
                    : (onDark ? "text-white/55 hover:text-white" : "text-muted-foreground hover:text-foreground")
                }`}
              >
                {label}
                {/* A rule under the label rather than a pill or a fill: the mark has to be
                    findable without becoming a second piece of furniture in a bar whose
                    whole job is to stay out of the way. Colour alone would also be the
                    only carrier of the state, which is not enough on its own. */}
                <span
                  aria-hidden
                  className="absolute -bottom-1.5 left-0 h-px w-full origin-left bg-current transition-transform"
                  style={{
                    transform: `scaleX(${on ? 1 : 0})`,
                    transitionDuration: `${DURATION.fast}ms`,
                    transitionTimingFunction: EASE.out,
                  }}
                />
              </a>
            );
          })}
        </nav>
        {/* The phone menu. `<details>` rather than a state-driven panel: the platform
            already gives us the disclosure semantics, the keyboard behaviour and the
            open/close, and a nav that works before hydration is one fewer thing that can
            be broken by a slow first load. */}
        <details className="group relative ml-auto lg:hidden">
          <summary className={`focus-ring flex list-none items-center gap-1.5 rounded-lg px-3 py-2 text-sm marker:hidden [&::-webkit-details-marker]:hidden ${onDark ? "text-white/70" : "text-muted-foreground"}`}>
            {ALL_SECTIONS.find(([href]) => href === active)?.[1] ?? "Sections"}
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
                aria-current={href === active ? "true" : undefined}
                className={`focus-ring block rounded-lg px-3 py-2.5 text-[14px] hover:bg-surface hover:text-foreground ${
                  href === active ? "bg-surface text-foreground" : "text-muted-foreground"
                }`}
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
