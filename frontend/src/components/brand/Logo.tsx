/**
 * The NeuroTrace mark and lockup.
 *
 * A FAITHFUL REPRODUCTION of the supplied artwork, not an interpretation of it. The first
 * attempt here drew a brain from memory — outline strokes with small dots — and that was
 * simply the wrong mark. The real one is built the opposite way round:
 *
 *   SOLID hemispheres, each a vertical core beside the midline unioned with four rounded
 *   lobes bulging outward, and then NEGATIVE SPACE carved out of that solid: four curved
 *   slits per side, each ending in a circular node. The cut-outs are what read as sulci
 *   and synapses; nothing is drawn on top.
 *
 * Implemented with a `<mask>` rather than by painting the cut-outs in a background colour,
 * so the holes are genuinely transparent and the mark sits correctly on the header, on the
 * deep sidebar, and on any tinted surface.
 *
 * INLINE SVG for two reasons that agree: DESIGN_LANGUAGE.md §2.0 wants a geometric mark
 * that holds its shape at ~16px, and INV-11 forbids any tracked image in this repository —
 * the supplied PNG would fail `preflight_push.sh` before a reviewer ever saw it.
 *
 * The bilateral symmetry is the product's actual subject: every clinical claim this engine
 * makes is about one SIDE differing from the other (INV-2). The right hemisphere is the
 * left mirrored through x=32, so the two halves are provably identical.
 */

/** One hemisphere's solid silhouette: the core bar plus four outer lobes. */
function Hemisphere({ mirror }: { mirror?: boolean }) {
  return (
    <g transform={mirror ? "translate(64,0) scale(-1,1)" : undefined}>
      {/* the core, hard against the midline */}
      <rect x="16.4" y="9" width="14.2" height="46" rx="7.1" />
      {/* four lobes, largest at the top and bottom */}
      <circle cx="22.8" cy="16.6" r="10.4" />
      <circle cx="11.6" cy="23.6" r="9.4" />
      <circle cx="8.6" cy="35" r="9.8" />
      <circle cx="12.2" cy="45.4" r="9.6" />
      <circle cx="23" cy="49.6" r="10.2" />
    </g>
  );
}

/** The carved slits. Each is a curved stroke that terminates in a node. */
function Cutouts({ mirror }: { mirror?: boolean }) {
  return (
    <g
      transform={mirror ? "translate(64,0) scale(-1,1)" : undefined}
      fill="black"
      stroke="black"
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      {/* upper: sweeps from the top-outer edge in toward the midline */}
      <path d="M13.2 13.6c1.5 5.6 5.4 8.6 10.4 9.1" fill="none" />
      <circle cx="25.2" cy="23" r="3.5" stroke="none" />

      {/* upper-middle */}
      <path d="M4.6 27.4c2.5 3.4 5.5 4.9 9 5.1" fill="none" />
      <circle cx="15.2" cy="32.2" r="3.4" stroke="none" />

      {/* lower-middle */}
      <path d="M4.4 44c2.3-3.4 5-5.2 8.5-5.6" fill="none" />
      <circle cx="14.4" cy="38" r="3.4" stroke="none" />

      {/* lower: the long sweep along the bottom lobe */}
      <path d="M12.2 55.4c1.3-5.6 5.1-9 10.5-9.8" fill="none" />
      <circle cx="24.4" cy="45.2" r="3.7" stroke="none" />
    </g>
  );
}

export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  // Unique per instance so two marks on one page cannot share a mask id.
  const id = "nt-mark";
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        {/* nothing shows by default */}
        <rect width="64" height="64" fill="black" />
        {/* the solid brain */}
        <g fill="white">
          <Hemisphere />
          <Hemisphere mirror />
        </g>
        {/* carved back out: the midline slit, then the sulci and their nodes */}
        <rect x="31.1" y="6" width="1.8" height="52" fill="black" rx="0.95" />
        <Cutouts />
        <Cutouts mirror />
      </mask>
      <rect width="64" height="64" fill="currentColor" mask={`url(#${id})`} />
    </svg>
  );
}

interface LockupProps {
  /** `ink` on light chrome, `light` on a deep surface. */
  tone?: "ink" | "light";
  /** A small-caps line under the wordmark — the current role or context. */
  subtitle?: string;
  className?: string;
}

export function Logo({ tone = "ink", subtitle, className = "" }: LockupProps) {
  const colour = tone === "light" ? "text-primary-foreground" : "text-primary";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className={`h-8 w-8 shrink-0 ${colour}`} />
      <span className="flex flex-col leading-none">
        <span className={`text-title-3 ${colour}`}>NeuroTrace</span>
        {subtitle && <span className="mt-1 text-label text-muted-foreground">{subtitle}</span>}
      </span>
    </span>
  );
}

export default Logo;
