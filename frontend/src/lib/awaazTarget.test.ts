/**
 * The header's Awaaz link must never build a URL from a value it cannot vouch for.
 *
 * The UUID guard is the load-bearing part: without it a stale or hand-edited localStorage
 * entry becomes a path segment, and the failure shows up as a 404 (or a 422 from the API)
 * on the header of every screen rather than at the one place the bad value entered.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetAwaazPatient, readAwaazPatient, rememberAwaazPatient,
} from "./awaazTarget";

const VALID = "73322159-8390-4ad0-a9d5-c439a79cf6ec";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("the remembered Awaaz patient", () => {
  it("round-trips a real id", () => {
    rememberAwaazPatient(VALID);
    expect(readAwaazPatient()).toBe(VALID);
  });

  it("is null before anything is remembered", () => {
    expect(readAwaazPatient()).toBeNull();
  });

  it("refuses anything that is not a UUID, so it cannot become a path segment", () => {
    for (const bad of [
      "", "   ", "undefined", "null", "1", "../../admin",
      "7332215983904ad0a9d5c439a79cf6ec",        // unhyphenated
      `${VALID}/../other`,                        // traversal via a valid prefix
      `${VALID} `,                                // trailing space
    ]) {
      rememberAwaazPatient(bad);
      expect(readAwaazPatient(), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("ignores null and undefined without throwing", () => {
    expect(() => rememberAwaazPatient(null)).not.toThrow();
    expect(() => rememberAwaazPatient(undefined)).not.toThrow();
    expect(readAwaazPatient()).toBeNull();
  });

  it("does not return a value written by something else in a bad shape", () => {
    localStorage.setItem("neurotrace.awaaz.patient", "not-a-uuid");
    expect(readAwaazPatient()).toBeNull();
  });

  it("clears on sign-out — the next user of a shared handset is often someone else", () => {
    rememberAwaazPatient(VALID);
    forgetAwaazPatient();
    expect(readAwaazPatient()).toBeNull();
  });

  it("survives storage being unavailable (private mode) rather than throwing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    });
    expect(() => rememberAwaazPatient(VALID)).not.toThrow();
    expect(readAwaazPatient()).toBeNull();
    expect(() => forgetAwaazPatient()).not.toThrow();
  });
});
