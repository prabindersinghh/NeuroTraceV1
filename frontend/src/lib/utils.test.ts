/**
 * Date formatting must survive a runtime that lacks the locale's month names.
 *
 * The failure this pins was seen in a real browser, not in Node: the clinician roster
 * rendered "M08 31 9:00 AM" for a Punjabi user because a trimmed ICU build reports `pa-IN`
 * as supported and then leaks the raw CLDR field where the month name should be. The
 * devices this product targets are low-end Android handsets, where trimmed ICU is common.
 */
import { describe, expect, it } from "vitest";

import { formatDateTime } from "./utils";

const ISO = "2026-08-31T09:00:00Z";

describe("formatDateTime", () => {
  it("never renders a raw CLDR field name", () => {
    // The specific shape of the bug: `M08` instead of a month.
    for (const locale of ["en-IN", "hi-IN", "pa-IN", "xx-YY"]) {
      expect(formatDateTime(ISO, locale)).not.toMatch(/\bM\d/);
    }
  });

  it("still produces something a person can read for every supported language", () => {
    for (const locale of ["en-IN", "hi-IN", "pa-IN"]) {
      const out = formatDateTime(ISO, locale);
      expect(out.length).toBeGreaterThan(4);
      expect(out).toMatch(/31/);
    }
  });

  it("falls back rather than throwing on a locale the runtime rejects", () => {
    expect(() => formatDateTime(ISO, "not-a-locale-at-all")).not.toThrow();
  });
});
