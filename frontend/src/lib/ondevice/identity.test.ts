/**
 * The identity check decides whether a measurement is trusted, so its two failure
 * directions are both tested here — and they are not symmetric:
 *
 *  - A FALSE NEGATIVE (flagging the real patient) costs a confounder on a good session.
 *    Annoying, recoverable, and it must not happen because their face changed — which is
 *    the very thing this product measures.
 *  - A FALSE POSITIVE (accepting a different person) silently poisons a baseline, and
 *    nobody ever finds out. That is the expensive one.
 */
import { describe, expect, it } from "vitest";

import { buildSignature, verifyAgainst } from "./identity";
import type { Landmark } from "./face";

/** A synthetic face: 468 points, with the landmarks the check reads placed deliberately. */
function face(opts: {
  interocular?: number; noseWidth?: number; mouthWidth?: number;
  jaw?: number; height?: number; jitter?: number; seed?: number;
} = {}): Landmark[] {
  const {
    interocular = 0.30, noseWidth = 0.12, mouthWidth = 0.18,
    jaw = 0.40, height = 0.50, jitter = 0, seed = 1,
  } = opts;
  // Deterministic pseudo-jitter: a test that flakes on identity is worse than no test.
  let n = seed;
  const rnd = () => { n = (n * 1103515245 + 12345) % 2147483648; return (n / 2147483648 - 0.5) * 2; };
  const j = () => (jitter ? rnd() * jitter : 0);

  const pts: Landmark[] = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const set = (i: number, x: number, y: number) => { pts[i] = { x: x + j(), y: y + j(), z: 0 }; };

  set(168, 0.5, 0.30);                       // bridge
  set(152, 0.5, 0.30 + height);              // chin
  set(33, 0.5 - interocular / 2, 0.35);      // eye outer L
  set(263, 0.5 + interocular / 2, 0.35);     // eye outer R
  set(133, 0.5 - interocular / 6, 0.35);     // eye inner L
  set(362, 0.5 + interocular / 6, 0.35);     // eye inner R
  set(129, 0.5 - noseWidth / 2, 0.48);       // nose ala L
  set(358, 0.5 + noseWidth / 2, 0.48);       // nose ala R
  set(61, 0.5 - mouthWidth / 2, 0.60);       // mouth L
  set(291, 0.5 + mouthWidth / 2, 0.60);      // mouth R
  set(234, 0.5 - jaw / 2, 0.55);             // jaw L
  set(454, 0.5 + jaw / 2, 0.55);             // jaw R
  set(105, 0.5 - interocular / 3, 0.31);     // brow L
  set(334, 0.5 + interocular / 3, 0.31);     // brow R
  return pts;
}

const many = (n: number, o: Parameters<typeof face>[0] = {}) =>
  Array.from({ length: n }, (_, i) => face({ ...o, seed: i + 1 }));

describe("enrolment", () => {
  it("needs enough frames to have a spread at all", () => {
    expect(buildSignature(many(10, { jitter: 0.002 }))).toBeNull();
  });

  it("builds a signature from a steady capture", () => {
    const sig = buildSignature(many(40, { jitter: 0.002 }));
    expect(sig).not.toBeNull();
    expect(Object.keys(sig!.values).length).toBeGreaterThanOrEqual(4);
    // Spread is floored so a perfectly still enrolment cannot make everything look wrong.
    for (const k of Object.keys(sig!.values)) expect(sig!.spread[k]).toBeGreaterThan(0);
  });

  it("rejects frames that are not faces", () => {
    expect(buildSignature([[{ x: 0, y: 0, z: 0 }]])).toBeNull();
  });
});

describe("verification", () => {
  const enrolled = buildSignature(many(40, { jitter: 0.002 }))!;

  it("accepts the same person on a later day", () => {
    const v = verifyAgainst(enrolled, many(20, { jitter: 0.004, seed: 500 }));
    expect(v.unenrolled).toBe(false);
    expect(v.verified).toBe(true);
  });

  it("accepts the patient whose FACE HAS CHANGED — the case that matters most", () => {
    // Facial weakness: the mouth pulls to one side and the face is less symmetric. This
    // is exactly what the product is measuring, and it must never read as a stranger.
    const drooped = many(20, { mouthWidth: 0.165, jitter: 0.004, seed: 900 });
    expect(verifyAgainst(enrolled, drooped).verified).toBe(true);
  });

  it("flags a genuinely different face", () => {
    const other = many(20, {
      interocular: 0.24, noseWidth: 0.20, mouthWidth: 0.28, jaw: 0.30, height: 0.62,
      jitter: 0.002, seed: 77,
    });
    expect(verifyAgainst(enrolled, other).verified).toBe(false);
  });

  it("reports 'not checked' rather than a confident pass when nobody enrolled", () => {
    const v = verifyAgainst(null, many(20));
    expect(v.unenrolled).toBe(true);
    expect(v.verified).toBe(true); // stored as verified: never-checked is not a failure
  });

  it("does not judge on too few frames", () => {
    expect(verifyAgainst(enrolled, many(2)).unenrolled).toBe(true);
  });
});
