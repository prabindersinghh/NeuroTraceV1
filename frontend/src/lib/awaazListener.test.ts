import { describe, expect, it } from "vitest";

import {
  LISTENER_COPY,
  listenerSharePath,
  normaliseListenerLanguage,
} from "./awaazListener";

describe("Awaaz public listener localization", () => {
  it("ships a complete shell in every supported language", () => {
    for (const copy of Object.values(LISTENER_COPY)) {
      for (const value of Object.values(copy)) {
        if (typeof value === "string") expect(value.trim()).not.toBe("");
      }
      expect(copy.expiresIn(0)).not.toContain("undefined");
      expect(copy.expiresIn(1)).not.toContain("undefined");
      expect(copy.expiresIn(5)).not.toContain("undefined");
    }
  });

  it("falls back to English for an absent or unsupported capability language", () => {
    expect(normaliseListenerLanguage("hi")).toBe("hi");
    expect(normaliseListenerLanguage("pa")).toBe("pa");
    expect(normaliseListenerLanguage("fr")).toBe("en");
    expect(normaliseListenerLanguage(null)).toBe("en");
  });

  it("carries language in new share links for pre-load and expired states", () => {
    expect(listenerSharePath("abc/123", "pa")).toBe("/listen/abc%2F123?lang=pa");
  });
});
