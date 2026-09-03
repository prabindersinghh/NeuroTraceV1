/**
 * The cortex field is geometry, so it is testable without a GPU — which is the whole
 * reason it is a separate module from the renderer.
 *
 * What is actually worth pinning here is not "does it produce numbers". It is the
 * properties the page's argument rests on: the point cloud is ONE cloud across all seven
 * arrangements (so a point that was perfused tissue is the same point that becomes a day),
 * every arrangement is finite and bounded (a stray NaN or a runaway coordinate is a
 * blank canvas, silently), the blend weights are a two-state lerp everywhere so no
 * scroll position can ever show a third arrangement bleeding through, and the first act's
 * occlusion is lateralised and confined to the vessel it is supposed to be in.
 */
import { describe, expect, it } from "vitest";

import {
  CLOT_FLOW, DOMAIN_COUNT, DOMAIN_RGB, STATE, STATE_COUNT, STATE_VIEW, STATE_WAVE,
  buildLines, createField, particleBudget, stateWeights, treeParam,
} from "./cortex";

describe("the cortex field", () => {
  const field = createField(700, 42);

  it("is one cloud: every arrangement holds the same points", () => {
    expect(field.positions).toHaveLength(STATE_COUNT);
    for (const buffer of field.positions) {
      expect(buffer).toHaveLength(field.count * 3);
    }
    expect(field.domain).toHaveLength(field.count);
    expect(field.seed).toHaveLength(field.count);
    expect(field.size).toHaveLength(field.count);
    expect(field.flow).toHaveLength(field.count);
    expect(field.risk).toHaveLength(field.count);
  });

  it("has a camera and a wave defined for every arrangement", () => {
    // Both tables are indexed by state in the renderer's hot loop, so a table one row
    // short reads undefined into a uniform and the whole cloud collapses to the origin.
    expect(STATE_VIEW).toHaveLength(STATE_COUNT * 2);
    expect(STATE_WAVE).toHaveLength(STATE_COUNT * 3);
  });

  it("is deterministic, so the page draws identically on every visit", () => {
    const again = createField(700, 42);
    expect(Array.from(again.positions[STATE.cortex].slice(0, 60)))
      .toEqual(Array.from(field.positions[STATE.cortex].slice(0, 60)));
  });

  it("has no NaN and no runaway coordinate in any arrangement", () => {
    // A single NaN propagates through the perspective divide and the canvas goes blank
    // with nothing in the console — the exact failure this test exists to make loud.
    field.positions.forEach((buffer, state) => {
      for (let i = 0; i < buffer.length; i += 1) {
        if (!Number.isFinite(buffer[i]) || Math.abs(buffer[i]) > 4) {
          throw new Error(`state ${state}, component ${i}: ${buffer[i]}`);
        }
      }
    });
  });

  it("gives every domain a share of the points, and a colour", () => {
    const perDomain = new Array(DOMAIN_COUNT).fill(0);
    for (const d of field.domain) perDomain[d] += 1;
    expect(perDomain.every((n) => n > 0)).toBe(true);
    expect(DOMAIN_RGB).toHaveLength(DOMAIN_COUNT * 3);
  });

  it("separates the domains into lobes, so a highlight reads as a region", () => {
    // Mean position per domain in the cortex arrangement; two different domains must not
    // land on top of each other or the highlight interaction says nothing.
    const centres = Array.from({ length: DOMAIN_COUNT }, () => [0, 0, 0, 0]);
    for (let i = 0; i < field.count; i += 1) {
      const c = centres[field.domain[i]];
      c[0] += field.positions[STATE.cortex][i * 3];
      c[1] += field.positions[STATE.cortex][i * 3 + 1];
      c[2] += field.positions[STATE.cortex][i * 3 + 2];
      c[3] += 1;
    }
    const means = centres.map(([x, y, z, n]) => [x / n, y / n, z / n]);
    for (let a = 0; a < DOMAIN_COUNT; a += 1) {
      for (let b = a + 1; b < DOMAIN_COUNT; b += 1) {
        const d = Math.hypot(means[a][0] - means[b][0], means[a][1] - means[b][1], means[a][2] - means[b][2]);
        expect(d).toBeGreaterThan(0.2);
      }
    }
  });

  it("keeps the midline empty and the cerebellum under the back of the cerebrum", () => {
    // The two features that make this read as a brain rather than as a glowing ball, and
    // the two a tuning pass could quietly delete: a gap you can see through, and a mass
    // below and behind. Both are cheap to assert and neither is visible in a unit of
    // "does it produce numbers".
    let inMidline = 0;
    let cerebellumY = 0;
    let cerebellumZ = 0;
    let cerebellumN = 0;
    let cerebrumY = 0;
    let cerebrumN = 0;
    for (let i = 0; i < field.count; i += 1) {
      const [x, y, z] = [0, 1, 2].map((k) => field.positions[STATE.cortex][i * 3 + k]);
      if (Math.abs(x) < 0.03) inMidline += 1;
      if (field.domain[i] === 5) { cerebellumY += y; cerebellumZ += z; cerebellumN += 1; }
      else { cerebrumY += y; cerebrumN += 1; }
    }
    expect(inMidline).toBe(0);
    expect(cerebellumY / cerebellumN).toBeLessThan(cerebrumY / cerebrumN - 0.25);
    expect(cerebellumZ / cerebellumN).toBeLessThan(-0.25);
  });

  it("grows the arterial tree from one shared stem, not seven floating arcs", () => {
    // The base of the tree is the single feature that makes the first act read as ONE
    // vessel system rather than as seven unrelated curves, and it is exactly the kind of
    // thing a tuning pass deletes by moving a control point.
    //
    // Asserted as CONVERGENCE rather than against a threshold in `flow`, because the tree
    // reparametrises flow (see `createField`) and any fixed cut here would silently start
    // sampling the arcs instead of the trunk the next time that mapping is retuned. Every
    // branch's most proximal point must sit in the same small place, low and near the
    // midline — which is what "one shared stem" means, whatever the mapping is.
    const proximal = new Map<number, number>();
    for (let i = 0; i < field.count; i += 1) {
      const best = proximal.get(field.domain[i]);
      if (best === undefined || field.flow[i] < field.flow[best]) proximal.set(field.domain[i], i);
    }
    expect(proximal.size).toBe(DOMAIN_COUNT);
    const roots = [...proximal.values()].map(
      (i) => [0, 1, 2].map((k) => field.positions[STATE.territory][i * 3 + k]),
    );
    const mid = [0, 1, 2].map((k) => roots.reduce((a, r) => a + r[k], 0) / roots.length);
    expect(Math.abs(mid[0])).toBeLessThan(0.2);   // near the midline
    expect(mid[1]).toBeLessThan(-0.32);           // and below the middle of the brain
    for (const r of roots) {
      expect(Math.hypot(r[0] - mid[0], r[1] - mid[1], r[2] - mid[2])).toBeLessThan(0.32);
    }
  });

  it("terminates the tree in the tissue it feeds, so the morph has no seam", () => {
    // The distal end of every vessel IS that point's place in the cortex arrangement —
    // the territory was not invented as a second shape, it is where the point already
    // lives four acts later. If that handover drifts, the page's first transition starts
    // with a visible jump, and the continuity claim the whole cloud rests on is broken at
    // the one seam a visitor sees first.
    let far = 0;
    for (let i = 0; i < field.count; i += 1) {
      if (field.flow[i] < 0.99) continue;
      far += 1;
      const d = Math.hypot(
        field.positions[STATE.territory][i * 3] - field.positions[STATE.cortex][i * 3],
        field.positions[STATE.territory][i * 3 + 1] - field.positions[STATE.cortex][i * 3 + 1],
        field.positions[STATE.territory][i * 3 + 2] - field.positions[STATE.cortex][i * 3 + 2],
      );
      expect(d).toBeLessThan(0.01);   // well under one point's radius on screen
    }
    expect(far).toBeGreaterThan(3);
  });

  it("keeps the occlusion on one vessel and one side — INV-2 is laterality", () => {
    // A stroke that took both hemispheres at once would be a picture of something else,
    // and the act's text says one territory, one side. Only the two domains a middle
    // cerebral occlusion actually takes may carry risk, and only on one side of midline.
    const sides = new Set<number>();
    const domains = new Set<number>();
    let affected = 0;
    for (let i = 0; i < field.count; i += 1) {
      if (field.risk[i] <= 0) continue;
      affected += 1;
      domains.add(field.domain[i]);
      sides.add(Math.sign(field.positions[STATE.cortex][i * 3]));
    }
    expect(affected).toBeGreaterThan(0);
    expect([...domains].sort()).toEqual([1, 3]);
    expect(sides.size).toBe(1);
    // And it stays a territory rather than becoming the whole brain going out. Weighted
    // by risk, because `risk` is a ramp and it is the LIGHT that a viewer reads, not the
    // point count: this is the fraction of the field that dims. The bound is loose on
    // purpose — a middle cerebral territory really is a large part of one hemisphere, so
    // this guards against the picture becoming a whole-brain event, not against anatomy.
    let lost = 0;
    for (let i = 0; i < field.count; i += 1) lost += field.risk[i];
    expect(lost / field.count).toBeLessThan(0.25);
  });

  it("puts the occlusion mark where the occlusion is", () => {
    // The renderer draws its one warm mark at CLOT_FLOW along the tree, and it has no
    // other way to know where that is. If the two ever disagree the page shows a clot
    // sitting in mid-air somewhere on a healthy vessel, which is worse than showing none.
    expect(treeParam(CLOT_FLOW)).toBeCloseTo(0.46, 6);
    // And it is on the vessel, not out in the tissue, or the mark lands on the cortex.
    expect(CLOT_FLOW).toBeLessThan(0.16);
    // Points at the mark must be ones that actually carry risk, since the shader gates on
    // it: a mark with nothing to gate it would appear on every branch at once.
    let atMark = 0;
    for (let i = 0; i < field.count; i += 1) {
      if (Math.abs(field.flow[i] - CLOT_FLOW) < 0.01 && field.risk[i] > 0) atMark += 1;
    }
    expect(atMark).toBeGreaterThan(0);
  });

  it("keeps the territory graded rather than binary, so there is a core and a margin", () => {
    // The act draws a territory losing its supply, not a hole punched in a brain. If risk
    // collapses to a step, the picture becomes a black bite and the second clinical idea
    // in the act — that the middle fares worst and the margins fare better — is gone.
    const values = Array.from(field.risk).filter((r) => r > 0.02);
    const mid = values.filter((r) => r > 0.2 && r < 0.8).length;
    expect(mid / values.length).toBeGreaterThan(0.1);
  });

  it("gives every point one flow parameter in range, since the shader indexes a wave by it", () => {
    for (let i = 0; i < field.count; i += 1) {
      expect(field.flow[i]).toBeGreaterThanOrEqual(0);
      expect(field.flow[i]).toBeLessThanOrEqual(1);
      expect(field.risk[i]).toBeGreaterThanOrEqual(0);
      expect(field.risk[i]).toBeLessThanOrEqual(1);
    }
  });

  it("makes the seven tracts behave differently from each other", () => {
    // The act these belong to says recovery moves in seven systems SEPARATELY and at
    // different speeds. Seven identical rows would illustrate the opposite, which is what
    // the arrangement used to be. Measured as vertical spread about each tract's own mean.
    const spread = new Array(DOMAIN_COUNT).fill(0).map(() => ({ sum: 0, sq: 0, n: 0 }));
    for (let i = 0; i < field.count; i += 1) {
      if (field.flow[i] < 0.4) continue;          // past the part still leaving the cortex
      const y = field.positions[STATE.pathways][i * 3 + 1];
      const s = spread[field.domain[i]];
      s.sum += y; s.sq += y * y; s.n += 1;
    }
    const sd = spread.map(({ sum, sq, n }) => Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)));
    expect(Math.max(...sd)).toBeGreaterThan(Math.min(...sd) * 2);
  });

  it("draws lines only between hubs, and never a point to itself", () => {
    expect(field.lines.length).toBeGreaterThan(0);
    expect(field.lines.length % 2).toBe(0);
    for (let i = 0; i < field.lines.length; i += 2) {
      expect(field.lines[i]).not.toBe(field.lines[i + 1]);
      expect(field.lines[i]).toBeLessThan(200);
      expect(field.lines[i + 1]).toBeLessThan(200);
    }
  });

  it("survives a field smaller than the requested hub count", () => {
    const tiny = createField(6, 1);
    expect(tiny.count).toBe(6);
    for (let i = 0; i < tiny.lines.length; i += 1) expect(tiny.lines[i]).toBeLessThan(6);
  });

  it("buildLines is symmetric-deduplicated: each pair appears once", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    const lines = buildLines(positions, 4);
    const keys = new Set<string>();
    for (let i = 0; i < lines.length; i += 2) {
      const key = [lines[i], lines[i + 1]].sort((a, b) => a - b).join("-");
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  });
});

describe("state blending", () => {
  it("is a two-state lerp everywhere, so a third arrangement never bleeds through", () => {
    for (let s = 0; s <= (STATE_COUNT - 1) * 20; s += 1) {
      const w = stateWeights(s / 20);
      const active = Array.from(w).filter((v) => v > 0);
      expect(active.length).toBeLessThanOrEqual(2);
      const total = Array.from(w).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("lands exactly on an arrangement at an integer, and clamps outside the range", () => {
    const expectedCortex = new Array(STATE_COUNT).fill(0);
    expectedCortex[STATE.cortex] = 1;
    const expectedFirst = new Array(STATE_COUNT).fill(0);
    expectedFirst[0] = 1;
    const expectedLast = new Array(STATE_COUNT).fill(0);
    expectedLast[STATE_COUNT - 1] = 1;

    expect(Array.from(stateWeights(STATE.cortex))).toEqual(expectedCortex);
    expect(Array.from(stateWeights(-3))).toEqual(expectedFirst);
    expect(Array.from(stateWeights(99))).toEqual(expectedLast);
  });

  it("writes into a caller-supplied buffer so the ticker allocates nothing", () => {
    const out = new Float32Array(STATE_COUNT);
    expect(stateWeights(1.5, out)).toBe(out);
  });
});

describe("the device budget", () => {
  it("refuses to draw at all where drawing would cost the user", () => {
    expect(particleBudget({ coarse: true, cores: 8, saveData: true, memory: 8 })).toBe(0);
    expect(particleBudget({ coarse: true, cores: 2, saveData: false, memory: 8 })).toBe(0);
    expect(particleBudget({ coarse: true, cores: 8, saveData: false, memory: 2 })).toBe(0);
  });

  it("scales down for a phone before it scales down for a slow laptop", () => {
    const phone = particleBudget({ coarse: true, cores: 8, saveData: false, memory: 8 });
    const laptop = particleBudget({ coarse: false, cores: 4, saveData: false, memory: 8 });
    const desktop = particleBudget({ coarse: false, cores: 12, saveData: false, memory: 8 });
    expect(phone).toBeGreaterThan(0);
    expect(phone).toBeLessThan(laptop);
    expect(laptop).toBeLessThan(desktop);
  });

  it("treats an unreported core count or memory as no evidence, not as low-end", () => {
    // Asserted against the well-specified desktop tier rather than against a literal: the
    // counts are a tuning dial (they were raised once already, when the full-screen scene
    // measured 2.4x less dense than the hero drawing the same geometry) and pinning the
    // number here only ever fails for the wrong reason. What must not change is that a
    // browser reporting nothing is given the benefit of the doubt.
    const known = particleBudget({ coarse: false, cores: 12, saveData: false, memory: 8 });
    expect(particleBudget({ coarse: false, cores: 0, saveData: false, memory: 0 })).toBe(known);
  });
});
