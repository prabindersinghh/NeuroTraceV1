/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    /* Full-width, not a 1200px letterbox. On a 1900px laptop the old cap left ~700px
       of unused screen either side, which is most of why the app read as a phone layout
       stretched rather than a desktop one. Padding grows with the viewport so text never
       runs to the physical edge. */
    container: {
      center: true,
      padding: { DEFAULT: "1rem", sm: "1.5rem", lg: "2rem", xl: "2.5rem" },
      screens: { "2xl": "1680px" },
    },
    extend: {
      fontFamily: {
        // "Inter var" is self-hosted in index.css; the rest is the platform stack it
        // falls back to for Devanagari, Gurmukhi and the swap window.
        sans: ['"Inter var"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI",
               "Roboto", '"Noto Sans"', '"Noto Sans Devanagari"', '"Noto Sans Gurmukhi"',
               "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        // `line` and `surface` are used across the app (TaskShell, FallRiskGate, the
        // landing, every card) and were never defined here — so `border-line` fell back
        // to currentColor and `bg-surface` painted nothing at all. Named here so the
        // classes mean what they say.
        line: "hsl(var(--border))",
        surface: "hsl(var(--muted))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        // clinical status palette — used by the band card and the charts
        stable: { DEFAULT: "hsl(var(--stable))", soft: "hsl(var(--stable-soft))" },
        watch: { DEFAULT: "hsl(var(--watch))", soft: "hsl(var(--watch-soft))" },
        alert: { DEFAULT: "hsl(var(--alert))", soft: "hsl(var(--alert-soft))" },
        atypical: { DEFAULT: "hsl(var(--atypical))", soft: "hsl(var(--atypical-soft))" },
      },
      /* ------------------------------------------------------------------ type scale
       * docs/DESIGN_LANGUAGE.md §2.2. Size, line-height, weight and tracking are baked into
       * each token so headings stay consistent without per-callsite tuning — which is
       * exactly what had drifted here: screens picked text-lg / text-2xl / text-3xl
       * ad hoc, so nothing established a hierarchy and everything read the same weight.
       *
       * Deviation from the reference, on purpose: body is 1rem, not 0.875rem. This
       * product's patient surfaces have a hard 20px floor (`.patient-scale`) and its
       * readers are 55-75 with post-stroke visual change, so a 14px base would be a
       * regression on every clinician screen too. */
      fontSize: {
        display:   ["2.75rem", { lineHeight: "1.05", fontWeight: "800", letterSpacing: "-0.03em" }],
        "title-1": ["2rem",    { lineHeight: "1.15", fontWeight: "700", letterSpacing: "-0.02em" }],
        "title-2": ["1.5rem",  { lineHeight: "1.2",  fontWeight: "700", letterSpacing: "-0.018em" }],
        "title-3": ["1.125rem",{ lineHeight: "1.3",  fontWeight: "600", letterSpacing: "-0.01em" }],
        metric:    ["2.25rem", { lineHeight: "1",    fontWeight: "700", letterSpacing: "-0.02em" }],
        /* The micro-label, matched to the landing page rather than approximating it:
         * measured there as font-mono + uppercase + tracking 0.18-0.22em, used 75
         * times. Mono and wide tracking are most of why that page reads as
         * instrumentation and the app did not. */
        /* 12px, not the reference doc's 11px. The mobile audit flags anything under
         * 12px, and this token is now on every page header — a marketing page can
         * afford 11px on a desktop, a clinical app read at arm's length on a phone
         * cannot. The wide tracking is what makes it read as a label, not the size. */
        label:     ["0.75rem",  { lineHeight: "1.2", fontWeight: "500", letterSpacing: "0.16em" }],
        /* Fluid page title, the landing page's own clamp. */
        "title-fluid": ["clamp(1.75rem,3.4vw,2.6rem)", { lineHeight: "1.1", fontWeight: "600", letterSpacing: "-0.025em" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.25)", opacity: "0" },
          "100%": { transform: "scale(1.25)", opacity: "0" },
        },
      },
      animation: { "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite" },
    },
  },
  plugins: [],
};
