/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1200px" } },
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
