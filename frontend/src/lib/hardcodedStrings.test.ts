/**
 * Every screen a PATIENT sees must route its words through `t()` — Part 2.
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

const PATIENT_SOURCES = {
  ...import.meta.glob("../routes/exam/*.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../components/FastCard.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../components/FallRiskGate.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("../components/EmergencyButton.tsx", { query: "?raw", import: "default", eager: true }),
} as Record<string, string>;

/**
 * Not scanned, and why — recorded here rather than left implicit.
 *
 * `LanguageGate.tsx` carries untranslated text ON PURPOSE: it is shown before a language is
 * known, so each option is written in its own script and its one sentence appears in all
 * three at once. Translating it would defeat it.
 *
 * `Landing.tsx` is outside this glob entirely and is English throughout. That is an open
 * gap, not a passing file: translating 600 lines of persuasive marketing copy is a content
 * project, and doing only its first screenful would produce exactly the half-English page
 * this work exists to remove.
 */
const NOT_SCANNED = ["LanguageGate.tsx"];

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

describe("patient surfaces have no hardcoded English", () => {
  it("actually found the files it claims to scan", () => {
    // Without this a glob that silently matched nothing would let the scan below pass
    // while checking zero files — the vacuous-pass shape this repo has been bitten by
    // twice already.
    const files = Object.keys(PATIENT_SOURCES);
    expect(files.length).toBeGreaterThan(8);
    expect(files.some((f) => f.includes("ProtocolRunner"))).toBe(true);
    expect(files.some((f) => f.includes("StepSvv"))).toBe(true);
  });

  it("routes every visible string and accessible name through t()", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(PATIENT_SOURCES)) {
      if (NOT_SCANNED.some((skip) => path.endsWith(skip))) continue;
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
