/**
 * Headings use the type scale, not ad-hoc sizes — DESIGN_LANGUAGE.md §2.2.
 *
 * WHY THIS IS PINNED. The scale bakes size, line-height, weight and tracking into one
 * token so headings stay consistent without per-callsite tuning. That only holds if
 * callsites actually use it, and the failure is invisible: a screen with `text-2xl
 * font-semibold` looks fine on its own and only reads as inconsistent next to the others.
 * Twenty-one headings had already drifted that way before this test existed.
 *
 * FRONTEND_ENGINEERING.md §5b calls exactly this out — a structural test only protects you
 * if it runs. This one is in the default vitest suite.
 */
import { describe, expect, it } from "vitest";

const ROUTES = import.meta.glob("../routes/**/*.tsx", {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

/**
 * Landing.tsx is the marketing page and is explicitly out of scope for the app's design
 * system — it has its own editorial type. Excluded here on purpose rather than silently
 * passing, the same way it is excluded from the i18n scan.
 */
const NOT_SCANNED = ["Landing.tsx"];

const HEADING = /<h[123][^>]*className="([^"]*)"/g;
const ADHOC = /\btext-(?:xl|2xl|3xl|4xl|5xl|6xl)\b/;

describe("headings use the type scale", () => {
  it("found the route files", () => {
    expect(Object.keys(ROUTES).length).toBeGreaterThan(15);
  });

  it("no heading sets an ad-hoc font size", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(ROUTES)) {
      if (NOT_SCANNED.some((skip) => path.endsWith(skip))) continue;
      for (const m of src.matchAll(HEADING)) {
        if (ADHOC.test(m[1])) {
          offenders.push(`${path.split("/").pop()}: ${m[1].slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no heading re-declares weight or tracking the token already carries", () => {
    // A leftover `font-semibold` next to `text-title-2` is how two headings end up
    // subtly different despite using the same token.
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(ROUTES)) {
      if (NOT_SCANNED.some((skip) => path.endsWith(skip))) continue;
      for (const m of src.matchAll(HEADING)) {
        const cls = m[1];
        if (!/text-(?:display|title-[123]|metric)/.test(cls)) continue;
        if (/\bfont-(?:semibold|bold)\b|\btracking-/.test(cls)) {
          offenders.push(`${path.split("/").pop()}: ${cls.slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("THE PIN: the detector catches the shape that had drifted", () => {
    const drifted = '<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">';
    const cls = [...drifted.matchAll(HEADING)][0][1];
    expect(ADHOC.test(cls)).toBe(true);
  });
});
