/**
 * The cortex field is geometry, so it is testable without a GPU — which is the whole
 * reason it is a separate module from the renderer.
 *
 * What is actually worth pinning here is not "does it produce numbers". It is the three
 * properties the page's argument rests on: the point cloud is ONE cloud across all six
 * arrangements (so a point that was an observation is the same point that becomes a day),
 * every arrangement is finite and bounded (a stray NaN or a runaway coordinate is a
 * blank canvas, silently), and the blend weights are a two-state lerp everywhere so no
 * scroll position can ever show a third arrangement bleeding through.
 */
import { describe, expect, it } from "vitest";

import {
  DOMAIN_COUNT, DOMAIN_RGB, STATE, STATE_COUNT, buildLines, createField,
  particleBudget, stateWeights,
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
    expect(Array.from(stateWeights(STATE.cortex))).toEqual([0, 0, 1, 0, 0, 0]);
    expect(Array.from(stateWeights(-3))).toEqual([1, 0, 0, 0, 0, 0]);
    expect(Array.from(stateWeights(99))).toEqual([0, 0, 0, 0, 0, 1]);
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
    expect(particleBudget({ coarse: false, cores: 0, saveData: false, memory: 0 })).toBe(18000);
  });
});
