/**
 * The NeuroTrace mark and lockup.
 *
 * THIS IS THE SUPPLIED ARTWORK, TRACED — not a redrawing of it. The path below is the real
 * contour of the real file, vectorised from the source PNG at 1536x1024: the blue channel
 * thresholded, speckle closed, contours extracted with OpenCV and simplified with
 * Douglas-Peucker at ~0.16% of the diagonal. Two subpaths come out, one per hemisphere,
 * because the slits open to the outer edge as notches rather than enclosed holes — which is
 * how the artwork is actually built. `fill-rule="evenodd"` so any enclosed area stays open.
 *
 * WHY IT IS NOT THE PNG. INV-11 permits no tracked image in this repository: the privacy
 * scanner treats any tracked image as a possible patient photo, and `preflight_push.sh`
 * fails on one before a reviewer ever sees it. Tracing keeps the exact mark and adds no
 * raster. It also gives what docs/DESIGN_LANGUAGE.md §2.0 asks for — a geometric mark that holds
 * its shape at ~16px and takes its colour from `currentColor`.
 *
 * The source ratio is 1.156:1 (1133x980), preserved by centring the trace in a square
 * viewBox rather than stretching it.
 *
 * To regenerate from a new file, re-run the tracer in the scratchpad; do not hand-edit the
 * path.
 */

/** The traced outline of the supplied mark. */
const MARK_PATH =
  "M39.37 4.32L38.02 4.55L35.87 5.45L34.91 6.13L33.67 7.65L33.21 25.50L33.21 40.64L33.55 53.07L34.34 55.39L35.36 56.74L36.60 57.81L38.19 58.72L39.71 59.28L41.69 59.62L43.38 59.62L45.42 59.23L46.83 58.66L48.13 57.87L49.31 56.74L50.05 55.72L50.56 54.54L50.84 53.01L50.78 52.17L49.93 49.68L49.09 48.49L47.45 46.97L45.19 45.73L43.72 46.29L42.70 46.29L41.91 46.01L41.24 45.44L40.67 44.26L40.73 43.13L41.18 42.28L42.48 41.43L44.12 41.49L45.36 42.45L45.87 43.75L47.96 44.88L49.99 46.69L51.63 49.29L52.25 51.32L52.25 53.41L51.52 55.78L52.82 55.50L55.53 54.09L57.45 52.17L58.63 49.85L58.92 48.55L58.92 46.97L58.63 45.56L57.96 43.98L57.11 42.73L56.04 41.66L54.96 40.87L53.61 41.26L52.59 41.15L51.23 40.19L50.78 39.17L50.78 38.16L51.06 37.42L51.97 36.52L52.87 36.18L54.00 36.24L54.91 36.69L55.41 37.14L55.87 37.99L55.87 39.51L57.73 41.09L58.97 42.96L59.26 42.96L61.63 40.92L62.64 39.51L63.77 36.58L63.94 33.75L63.27 30.87L61.80 28.22L59.93 26.29L57.84 24.94L57.50 24.94L56.09 26.92L54.40 28.33L54.34 29.57L53.78 30.53L53.15 31.04L52.19 31.38L51.18 31.32L50.27 30.87L49.60 30.14L49.20 28.61L49.77 27.26L50.39 26.69L51.23 26.35L52.14 26.35L53.55 26.80L54.62 26.01L56.43 23.81L57.28 21.38L57.22 18.89L56.26 16.24L54.45 14.04L52.42 12.68L50.44 11.95L49.71 11.95L49.65 13.36L49.31 14.83L48.13 17.20L46.04 19.46L43.44 20.98L43.10 22.06L42.42 22.85L41.52 23.30L40.67 23.41L39.77 23.19L38.75 22.45L38.19 21.15L38.24 20.19L38.64 19.35L39.37 18.67L40.33 18.33L41.41 18.39L42.87 19.06L45.30 17.77L46.55 16.64L47.39 15.51L48.01 14.21L48.41 12.62L48.35 10.87L47.90 9.29L47.28 8.11L45.98 6.58L44.46 5.45L42.65 4.66L40.90 4.32ZM24.63 4.32L22.76 4.38L20.96 4.83L19.43 5.56L18.02 6.64L16.95 7.88L16.04 9.57L15.65 11.21L15.65 12.62L15.99 14.09L16.78 15.68L17.57 16.69L19.15 18.05L21.18 19.06L22.93 18.33L24.01 18.39L24.91 18.84L25.53 19.52L25.87 20.42L25.87 21.27L25.48 22.23L24.80 22.91L23.78 23.36L22.76 23.36L21.80 22.96L20.96 22.06L20.62 20.98L18.08 19.52L15.87 17.14L14.80 15.00L14.40 13.36L14.35 11.95L13.67 11.95L11.92 12.57L9.83 13.87L7.91 16.07L6.89 18.56L6.78 21.38L7.68 23.92L8.47 25.05L9.66 26.18L10.56 26.80L11.98 26.35L12.82 26.35L13.61 26.63L14.35 27.26L14.86 28.33L14.86 29.29L14.57 30.02L13.95 30.76L12.88 31.32L11.86 31.38L11.02 31.10L9.83 29.80L9.72 28.38L8.13 27.09L6.55 24.94L6.27 24.94L3.95 26.46L2.20 28.27L0.68 30.93L0.00 33.64L0.11 36.46L1.24 39.46L2.49 41.15L4.74 43.02L5.03 43.02L6.33 41.09L8.19 39.46L8.25 37.93L8.59 37.25L9.32 36.58L10.34 36.18L11.64 36.24L12.37 36.63L13.11 37.48L13.33 39.06L12.82 40.19L11.47 41.15L10.28 41.26L9.09 40.87L8.08 41.60L6.33 43.58L5.48 45.33L5.14 46.74L5.25 49.29L6.27 51.71L8.08 53.75L10.90 55.39L12.48 55.78L11.75 53.41L11.75 51.32L12.54 48.89L13.90 46.86L15.76 45.11L18.19 43.75L18.75 42.39L19.60 41.66L20.39 41.38L21.41 41.38L22.31 41.72L22.93 42.28L23.44 43.35L23.39 44.48L22.93 45.33L22.26 45.95L21.07 46.35L20.11 46.23L18.92 45.73L16.78 46.86L14.91 48.55L14.07 49.74L13.44 51.26L13.22 52.45L13.27 53.75L13.73 55.22L14.52 56.52L15.42 57.48L17.85 58.94L20.79 59.62L22.88 59.57L24.46 59.23L26.21 58.55L27.74 57.59L29.66 55.44L30.16 54.43L30.50 52.90L30.84 42.68L30.90 28.89L30.45 8.05L29.99 6.92L28.30 5.51L26.27 4.60Z";

export function LogoMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
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
