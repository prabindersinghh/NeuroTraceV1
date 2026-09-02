/**
 * Every screen in the app must route its words through `t()` — Part 2.
 *
 * The dictionary being complete is only half the problem. A string typed straight into JSX
 * is never *missing* a translation, because it was never a key — so `i18n.test.ts` passes
 * and the patient still reads English. That is the failure mode that actually shipped: two
 * `aria-label`s in the exam path, one of them on the SVV slider, which IS the measurement.
 * A Punjabi-speaking screen-reader user got the instruction in Punjabi and the control's
 * name in English.
 *
 * `import.meta.glob` rather than a hand-listed set, so a NEW step file is covered the day
 * it is added rather than the day someone remembers to add it here.
 */
import { describe, expect, it } from "vitest";

const SOURCES = {
  // Every route and every component, not a hand-picked list. The narrow glob was the
  // reason this test passed while the caregiver dashboard, the ASHA field view, the
  // listener page and the printed clinician report were all still English under a
  // Punjabi header — they were simply outside the scan. `NOT_SCANNED` below now carries
  // the exclusions explicitly, which is a list someone has to justify adding to.
  ...import.meta.glob("../routes/**/*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../components/**/*.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

/** Not scanned, and why — recorded here rather than left implicit. */
const NOT_SCANNED = [
  // Untranslated ON PURPOSE: shown before a language is known, so each option is written
  // in its own script and its one sentence appears in all three at once. Translating it
  // would defeat it.
  "LanguageGate.tsx",
  // The marketing page and the pieces only it renders. Still English throughout, still an
  // open gap rather than a passing file — 600 lines of persuasive copy is a content
  // project, and translating its first screenful alone produces exactly the half-English
  // page this test exists to prevent.
  "Landing.tsx",
  // A device-capability readout: browser name, user agent, secure-context, frame rate,
  // model names. The content is identifiers the browser hands us, not copy, and a
  // half-translated hardware report is harder to act on than an English one.
  "Diagnostics.tsx",
];

/** Components rendered only by a NOT_SCANNED page. */
const NOT_SCANNED_DIRS = ["/components/landing/"];

/** Text between JSX tags, and the attributes that are read aloud or shown on hover. */
const JSX_TEXT = />([^<>{}\n][^<>{}]{2,})</g;
const TEXT_ATTR = /\b(?:aria-label|placeholder|title|alt)=\{?"([^"]{3,})"/g;

/** Two or more real words. One word is usually a unit or a code; a sentence is copy. */
function isSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!/[a-z]/.test(trimmed)) return false;
  return /[A-Za-z]{3,}(\s+[A-Za-z]{2,})+/.test(trimmed);
}

function offendersIn(source: string, label: string): string[] {
  const found: string[] = [];
  source.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;   // a comment is never rendered
    for (const re of [JSX_TEXT, TEXT_ATTR]) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        if (isSentence(match[1])) {
          found.push(`${label}:${i + 1}: ${match[1].trim().slice(0, 70)}`);
        }
      }
    }
  });
  return found;
}

describe("every translated surface has no hardcoded English", () => {
  it("actually found the files it claims to scan", () => {
    // Without this a glob that silently matched nothing would let the scan below pass
    // while checking zero files — the vacuous-pass shape this repo has been bitten by
    // twice already.
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => f.includes("ProtocolRunner"))).toBe(true);
    expect(files.some((f) => f.includes("StepSvv"))).toBe(true);
    expect(files.some((f) => f.includes("Welcome"))).toBe(true);
    // The surfaces that were outside the old glob, named so a future narrowing shows up
    // here rather than as English text on a Punjabi screen.
    expect(files.some((f) => f.includes("Dashboard"))).toBe(true);
    expect(files.some((f) => f.includes("AshaHome"))).toBe(true);
    expect(files.some((f) => f.includes("Listen"))).toBe(true);
    expect(files.some((f) => f.includes("ClinicianReport"))).toBe(true);
    expect(files.some((f) => f.includes("CcgTrace"))).toBe(true);
  });

  it("routes every visible string and accessible name through t()", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (NOT_SCANNED.some((skip) => path.endsWith(skip))) continue;
      if (NOT_SCANNED_DIRS.some((dir) => path.includes(dir))) continue;
      offenders.push(...offendersIn(source, path.split("/").pop() ?? path));
    }
    expect(offenders).toEqual([]);
  });

  it("THE PIN: the scanner still catches a hardcoded string", () => {
    // Proves the regexes match real JSX rather than nothing at all. Both forms are the
    // ones that actually shipped: visible text, and an accessible name.
    const bad = '  <button aria-label="Start the check-in">Begin the check-in now</button>';
    expect(offendersIn(bad, "fixture")).toHaveLength(2);
  });

  it("does not flag a correctly translated line", () => {
    const good = '  <button aria-label={t("exitLabel")}>{t("exitShort")}</button>';
    expect(offendersIn(good, "fixture")).toEqual([]);
  });
});
