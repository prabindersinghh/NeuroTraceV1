import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  authErrorKey, emailProblem, passwordProblem, passwordStrength, safeReturnPath,
} from "./authForm";

describe("emailProblem", () => {
  it("wants something, then an @ and a dot", () => {
    expect(emailProblem("")).toBe("errEmailRequired");
    expect(emailProblem("   ")).toBe("errEmailRequired");
    expect(emailProblem("ramesh")).toBe("errEmailInvalid");
    expect(emailProblem("ramesh@neurotrace")).toBe("errEmailInvalid");
    expect(emailProblem("ramesh@neurotrace.app")).toBeNull();
    expect(emailProblem("  ramesh@neurotrace.app ")).toBeNull();
  });
});

describe("passwordProblem", () => {
  it("on sign-in only asks for a value", () => {
    expect(passwordProblem("")).toBe("errPasswordRequired");
    expect(passwordProblem("ab")).toBeNull();
  });

  it("on sign-up enforces the server's rules before the round trip", () => {
    expect(passwordProblem("short", { signup: true })).toBe("errPasswordShort");
    expect(passwordProblem("x".repeat(129), { signup: true })).toBe("errPasswordLong");
    expect(passwordProblem("Ramesh@neurotrace.app", { signup: true, email: "ramesh@neurotrace.app" }))
      .toBe("errPasswordIsEmail");
    expect(passwordProblem("rameshkumar", { signup: true, email: "RameshKumar@x.in" }))
      .toBe("errPasswordIsEmail");
    expect(passwordProblem("correct-horse", { signup: true, email: "ramesh@neurotrace.app" })).toBeNull();
  });

  it("does not treat a two-letter local part as the password", () => {
    // "ab" is inside almost anything; the rule would fire on every password.
    expect(passwordProblem("abababab", { signup: true, email: "ab@x.in" })).toBeNull();
  });
});

describe("passwordStrength", () => {
  it("is monotone in length and variety", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("abcdefgh")).toBe(2);
    expect(passwordStrength("abcdefghijkl")).toBe(2);       // long, one class
    expect(passwordStrength("abcdefghijk1")).toBe(3);       // 12, two classes
    expect(passwordStrength("Correct-Horse-Battery-9")).toBe(4);
  });
});

describe("authErrorKey", () => {
  const status = (s: number, kind?: "network" | "timeout") => new ApiError(s, "server words", kind);

  it("never surfaces the server's wording", () => {
    expect(authErrorKey(status(401), "login")).toBe("errWrongCredentials");
    expect(authErrorKey(status(409), "register")).toBe("errEmailTaken");
    expect(authErrorKey(status(403), "register")).toBe("errRoleProvisioned");
    expect(authErrorKey(status(422), "register")).toBe("errPasswordWeak");
    expect(authErrorKey(status(403), "demo")).toBe("errDemoOff");
    expect(authErrorKey(status(401), "password")).toBe("errWrongCurrentPassword");
  });

  it("separates the network from the account", () => {
    expect(authErrorKey(status(0, "network"), "login")).toBe("errOffline");
    expect(authErrorKey(status(0, "timeout"), "login")).toBe("errTimeout");
    expect(authErrorKey(status(429), "login")).toBe("errTooManyAttempts");
    expect(authErrorKey(status(503), "login")).toBe("errServer");
  });

  it("has a floor for anything else", () => {
    expect(authErrorKey(new Error("boom"), "login")).toBe("errAuthGeneric");
    expect(authErrorKey(status(418), "register")).toBe("errAuthGeneric");
    // A 401 on REGISTER is not "wrong password"; it is something unexpected.
    expect(authErrorKey(status(401), "register")).toBe("errAuthGeneric");
  });
});

describe("safeReturnPath", () => {
  it("honours a same-origin path and nothing else", () => {
    expect(safeReturnPath("/dashboard/abc")).toBe("/dashboard/abc");
    expect(safeReturnPath("/exam/abc?x=1")).toBe("/exam/abc?x=1");
    expect(safeReturnPath("https://evil.example/")).toBe("/");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath({ pathname: "/x" })).toBe("/");
  });

  it("never bounces back onto the auth screens", () => {
    expect(safeReturnPath("/login")).toBe("/");
    expect(safeReturnPath("/register?x")).toBe("/");
  });
});
