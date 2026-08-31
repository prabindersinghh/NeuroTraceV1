/**
 * `cn()` must not delete the type scale.
 *
 * THE BUG THIS PINS. tailwind-merge resolves conflicts by class group and infers the group
 * from the prefix. `text-*` covers both font size AND text colour, so any `text-<name>` it
 * does not recognise as a size is assumed to be a colour — and then
 * `cn("text-title-fluid", "text-foreground")` drops the first as an overridden colour.
 *
 * The page title rendered at 16px/400 with a class list of `text-foreground mt-2`, the
 * token silently gone. Nothing reported it: the build passed, the class was in the CSS,
 * and the element simply never received it. The scale survived only at callsites that
 * happened to write a plain string instead of going through `cn()`.
 */
import { describe, expect, it } from "vitest";

import { cn } from "./utils";

const SCALE = ["display", "title-1", "title-2", "title-3", "title-fluid", "metric", "label"];

describe("cn keeps a font size alongside a text colour", () => {
  it.each(SCALE)("text-%s survives being merged with a colour", (token) => {
    const out = cn(`text-${token} text-foreground`, "mt-2");
    expect(out).toContain(`text-${token}`);
    expect(out).toContain("text-foreground");
  });

  it("still lets one size override another", () => {
    // The merge must keep doing its job: two SIZES do conflict, and the last wins.
    const out = cn("text-title-1", "text-title-3");
    expect(out).toContain("text-title-3");
    expect(out).not.toContain("text-title-1");
  });

  it("still lets one colour override another", () => {
    const out = cn("text-muted-foreground", "text-foreground");
    expect(out).toContain("text-foreground");
    expect(out).not.toContain("text-muted-foreground");
  });

  it("THE PIN: a token NOT registered would still be dropped", () => {
    // Proves the test is detecting real behaviour rather than passing vacuously —
    // an unregistered text-* name is treated as a colour and loses to one.
    const out = cn("text-not-a-registered-size text-foreground");
    expect(out).not.toContain("text-not-a-registered-size");
  });
});
