/**
 * The NeuroTrace mark and lockup.
 *
 * INLINE SVG, NOT A RASTER — for two reasons that happen to agree. DESIGN_LANGUAGE.md §2.0
 * asks for a geometric mark so it holds its shape down to ~16px and can be themed per part;
 * and INV-11 means no image file can be tracked in this repository at all, because the
 * privacy scanner treats any tracked image as a possible patient photo. A PNG here would
 * fail `preflight_push.sh` before it ever reached a reviewer.
 *
 * The mark is two hemispheres separated by a midline, each carrying three synapse nodes.
 * The bilateral symmetry is the product's actual subject: every clinical claim this engine
 * makes is about one SIDE differing from the other (INV-2), so a symmetric mark that
 * separates cleanly down the middle is the right shape rather than a decorative one.
 *
 * `currentColor` throughout, so the lockup re-themes with its `tone` and needs no variants.
 */

export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {/* midline — the thing the whole product measures across */}
      <path d="M24 7v34" strokeWidth={1.75} opacity={0.55} />

      {/* left hemisphere */}
      <path d="M24 9.5a7 7 0 0 0-11.6 4.1A6.4 6.4 0 0 0 7.4 20a6.6 6.6 0 0 0 1.5 4.2A6.6 6.6 0 0 0 8 32a6.8 6.8 0 0 0 6 6.3A6.4 6.4 0 0 0 24 40" />
      {/* right hemisphere — mirrored, so the two halves are provably identical */}
      <path d="M24 9.5a7 7 0 0 1 11.6 4.1A6.4 6.4 0 0 1 40.6 20a6.6 6.6 0 0 1-1.5 4.2A6.6 6.6 0 0 1 40 32a6.8 6.8 0 0 1-6 6.3A6.4 6.4 0 0 1 24 40" />

      {/* synapse nodes, three a side, on the same three latitudes */}
      <g fill="currentColor" stroke="none">
        <circle cx="16.2" cy="17.4" r="2.05" />
        <circle cx="13.1" cy="26.6" r="2.05" />
        <circle cx="17.4" cy="34" r="2.05" />
        <circle cx="31.8" cy="17.4" r="2.05" />
        <circle cx="34.9" cy="26.6" r="2.05" />
        <circle cx="30.6" cy="34" r="2.05" />
      </g>
    </svg>
  );
}

interface LockupProps {
  /** `ink` on light chrome, `light` on the deep sidebar. */
  tone?: "ink" | "light";
  /** A small-caps line under the wordmark — the current role or context. */
  subtitle?: string;
  className?: string;
}

export function Logo({ tone = "ink", subtitle, className = "" }: LockupProps) {
  const colour = tone === "light" ? "text-primary-foreground" : "text-primary";
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className={`h-7 w-7 shrink-0 ${colour}`} />
      <span className="flex flex-col leading-none">
        <span className={`text-title-3 ${colour}`}>NeuroTrace</span>
        {subtitle && (
          <span className="mt-1 text-label text-muted-foreground">{subtitle}</span>
        )}
      </span>
    </span>
  );
}

export default Logo;
