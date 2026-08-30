/**
 * Every user-facing string exists in all three languages — Part 2.
 *
 * WHY THIS IS A TEST AND NOT A REVIEW. The failure it catches is silent. A key added with
 * only `en` renders English to a Punjabi-speaking patient, and nothing anywhere reports it:
 * `t()` returns something, the screen looks finished, and the only person who finds out is
 * the person who cannot read it. That is the population this product is for — Tier-2/3
 * Punjab, where a meaningful share of users have limited literacy or a post-stroke reading
 * impairment — so an English fallback is not a degraded experience, it is no experience.
 *
 * These assert against the real `STRINGS` object rather than scanning source text, so they
 * cannot be fooled by formatting and cannot drift from what the app actually renders.
 */
import { describe, expect, it } from "vitest";

import { STRINGS } from "./i18n";

const LANGS = ["en", "hi", "pa"] as const;
type Entry = Record<string, unknown>;

const entries = Object.entries(STRINGS as Record<string, Entry>);

describe("every string exists in every language", () => {
  it("has at least the strings the app is known to use", () => {
    // A floor, so that a refactor which accidentally empties STRINGS fails here loudly
    // rather than making every other test in this file pass vacuously.
    expect(entries.length).toBeGreaterThan(150);
  });

  it("carries en, hi and pa for every key", () => {
    const missing = entries
      .filter(([, value]) => LANGS.some((l) => typeof value?.[l] !== "string"))
      .map(([key, value]) => `${key} -> has [${LANGS.filter((l) => typeof value?.[l] === "string").join(", ")}]`);
    expect(missing).toEqual([]);
  });

  it("has no blank or whitespace-only translation", () => {
    // An empty string is worse than a missing one: `t()` returns it happily and the
    // patient sees a button with no label at all.
    const blank: string[] = [];
    for (const [key, value] of entries) {
      for (const lang of LANGS) {
        const text = value?.[lang];
        if (typeof text === "string" && text.trim() === "") blank.push(`${key}.${lang}`);
      }
    }
    expect(blank).toEqual([]);
  });

  it("keeps every {placeholder} in all three languages", () => {
    // A translation that drops `{done}` renders the literal word to the patient, or
    // silently loses the number. Word ORDER is expected to differ between languages —
    // that is why these are placeholders and not concatenation — so this compares the SET
    // of placeholders, never their position.
    const broken: string[] = [];
    for (const [key, value] of entries) {
      const en = value?.en;
      if (typeof en !== "string") continue;
      const expected = new Set(en.match(/\{[a-z_]+\}/gi) ?? []);
      if (expected.size === 0) continue;
      for (const lang of ["hi", "pa"] as const) {
        const text = value?.[lang];
        if (typeof text !== "string") continue;
        const got = new Set(text.match(/\{[a-z_]+\}/gi) ?? []);
        if (got.size !== expected.size || [...expected].some((p) => !got.has(p))) {
          broken.push(`${key}.${lang}: expected ${[...expected].join(",")} got ${[...got].join(",") || "none"}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("untranslated copy does not hide behind a duplicate", () => {
  /**
   * Latin script in a Hindi or Punjabi string is the signature of a key that was added in
   * English and copied across to satisfy a "has all three languages" check without ever
   * being translated — which is exactly the mixed-language rendering this part exists to
   * fix, and which the presence check above would happily pass.
   *
   * Proper nouns and clinical acronyms legitimately stay in Latin script in all three, so
   * the rule is about RUNS of Latin words, and the known-good terms are listed rather than
   * the check being loosened. Anything added here should be a term a Punjabi speaker would
   * genuinely see in Latin script on a real form.
   */
  const ALLOWED_LATIN = [
    "NeuroTrace", "Awaaz", "FAST", "PHQ", "EAT", "FSS", "DHI", "NIHSS", "ASHA", "SVV",
    "PWA", "SMS", "WhatsApp", "OK", "ml", "mg", "bpm", "SpO2", "BP", "ID", "PIN",
  ];

  const stripAllowed = (text: string) => {
    let out = text;
    for (const term of ALLOWED_LATIN) out = out.replaceAll(term, " ");
    return out;
  };

  it("has no run of English words left in a Hindi or Punjabi string", () => {
    const suspects: string[] = [];
    for (const [key, value] of entries) {
      for (const lang of ["hi", "pa"] as const) {
        const text = value?.[lang];
        if (typeof text !== "string") continue;
        // Three or more consecutive Latin words: one is a term, three is a sentence.
        const run = /[A-Za-z]{2,}(?:[^A-Za-z\n]{1,3}[A-Za-z]{2,}){2,}/.exec(stripAllowed(text));
        if (run) suspects.push(`${key}.${lang}: "${run[0].slice(0, 60)}"`);
      }
    }
    expect(suspects).toEqual([]);
  });

  it("THE PIN: the Latin-run check still catches an untranslated string", () => {
    // Without this, tightening ALLOWED_LATIN far enough would silently disable the check
    // above and every future untranslated key would sail through.
    const untranslated = "Stop this check-in now";
    const run = /[A-Za-z]{2,}(?:[^A-Za-z\n]{1,3}[A-Za-z]{2,}){2,}/.exec(stripAllowed(untranslated));
    expect(run).not.toBeNull();
  });
});
