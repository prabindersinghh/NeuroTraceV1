/**
 * Nothing may open a camera or a microphone without arranging to give it back.
 *
 * Every capture in this app already releases its tracks on unmount, and every one of those
 * was written on purpose. The failure this pins is the one none of them can see: the page
 * itself going away — or, for the user-driven recorders, going off screen — while a track
 * is still live. FaceMeshShowcase shipped that bug once and its fix is a paragraph of
 * comment; the guard now lives with the openers instead, so the NEXT capture function
 * inherits it rather than needing somebody to remember.
 *
 * A source scan rather than a behavioural test, in the shape `hardcodedStrings.test.ts`
 * already uses here: the suite runs in a node environment with no DOM, and stubbing
 * `getUserMedia`, `AudioContext` and `MediaStream` to observe a listener would be more
 * fixture than the thing it checks. What can go wrong is somebody adding a sixth opener
 * and forgetting, and this catches exactly that.
 */
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("./{capture,recording}.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The body of each exported `start*` function, split on the next top-level declaration. */
function openers(source: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const heads = [...source.matchAll(/^export async function (start\w+)/gm)];
  heads.forEach((head, i) => {
    const from = head.index ?? 0;
    const to = i + 1 < heads.length ? (heads[i + 1].index ?? source.length) : source.length;
    found.push({ name: head[1], body: source.slice(from, to) });
  });
  return found;
}

describe("every capture opener gives the hardware back", () => {
  it("found the two modules that open a camera or microphone", () => {
    // Without this a glob that matched nothing would pass while checking zero files —
    // the vacuous-pass shape this repo has been bitten by before.
    expect(Object.keys(SOURCES)).toHaveLength(2);
  });

  it("registers a release for the page going away", () => {
    const missing: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      for (const { name, body } of openers(source)) {
        if (!body.includes("getUserMedia")) continue; // not an opener, just a helper
        const releases = body.includes("releaseOnPageHide(")
          || body.includes('addEventListener("pagehide"');
        if (!releases) missing.push(`${path.split("/").pop()}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  /**
   * Stronger for the two recorders a person starts and stops by hand. `pagehide` does not
   * fire when a phone is locked or the user switches to another app, and a microphone
   * held open behind WhatsApp is the exact thing this product promises does not happen.
   * The exam's camera deliberately does NOT do this — see the note in `capture.ts`.
   */
  it("also releases the microphone when the app leaves the screen", () => {
    const recording = SOURCES["./recording.ts"];
    expect(recording).toBeDefined();
    expect(recording).toContain('document.addEventListener("visibilitychange"');
    expect(recording).toContain('document.visibilityState === "hidden"');
  });

  it("THE PIN: an opener with no release is caught", () => {
    const bad = `export async function startNothing(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  return stream;
}
`;
    const [only] = openers(bad);
    expect(only.name).toBe("startNothing");
    expect(only.body.includes("releaseOnPageHide(")).toBe(false);
  });
});
