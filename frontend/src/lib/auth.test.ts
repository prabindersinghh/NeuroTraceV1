import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { shouldKeepStoredIdentity } from "./authOffline";

describe("offline authentication startup", () => {
  it("keeps the last authenticated identity when the server cannot be reached", () => {
    expect(shouldKeepStoredIdentity(new ApiError(0, "offline"))).toBe(true);
  });

  /**
   * Widened deliberately. The rule used to be "keep it only when the network is missing",
   * which signed a patient out of their local safety surfaces because the server returned
   * a 500 — and left them unable to sign back in, because the server was returning 500s.
   * Neither a server fault nor an unrecognised throw says anything about whether the
   * session is valid, so neither may end it.
   */
  it("keeps it when the failure says nothing about the session", () => {
    expect(shouldKeepStoredIdentity(new ApiError(500, "server error"))).toBe(true);
    expect(shouldKeepStoredIdentity(new Error("unexpected"))).toBe(true);
  });

  it("drops it only when the server rejects the session outright", () => {
    expect(shouldKeepStoredIdentity(new ApiError(401, "invalid"))).toBe(false);
  });
});
