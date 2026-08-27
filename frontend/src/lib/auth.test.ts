import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { shouldKeepStoredIdentity } from "./authOffline";

describe("offline authentication startup", () => {
  it("keeps the last authenticated identity when the server cannot be reached", () => {
    expect(shouldKeepStoredIdentity(new ApiError(0, "offline"))).toBe(true);
  });

  it("does not preserve an identity after an authenticated rejection", () => {
    expect(shouldKeepStoredIdentity(new ApiError(401, "invalid"))).toBe(false);
    expect(shouldKeepStoredIdentity(new Error("unexpected"))).toBe(false);
  });
});
