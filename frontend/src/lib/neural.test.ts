import { describe, expect, it } from "vitest";

import {
  ACTIVITY, approach, createField, mulberry32, nodeBudget, project, stepSignals,
  type SignalState,
} from "./neural";

describe("createField", () => {
  it("is deterministic for a seed", () => {
    const a = createField(7, 40);
    const b = createField(7, 40);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
    expect(createField(8, 40).nodes).not.toEqual(a.nodes);
  });

  it("places every node on a bounded shell and connects all of them", () => {
    const field = createField(42, 96);
    expect(field.nodes).toHaveLength(96);
    for (const n of field.nodes) {
      expect(Math.abs(n.x)).toBeLessThan(1.3);
      expect(Math.abs(n.y)).toBeLessThan(1);
      expect(Math.abs(n.z)).toBeLessThan(1);
    }
    field.adjacency.forEach((edges) => expect(edges.length).toBeGreaterThan(0));
  });

  it("has no duplicate or self edges", () => {
    const { edges } = createField(1, 60);
    const keys = new Set(edges.map(([a, b]) => `${a}-${b}`));
    expect(keys.size).toBe(edges.length);
    for (const [a, b] of edges) expect(a).toBeLessThan(b);
  });

  it("opens a cleft along the middle", () => {
    // No node sits within the gap the hemispheres were pushed apart to make.
    const { nodes } = createField(3, 120);
    expect(nodes.every((n) => Math.abs(n.x) >= 0.05)).toBe(true);
  });
});

describe("project", () => {
  it("puts the origin at the centre and scales nearer points larger", () => {
    const centre = project({ x: 0, y: 0, z: 0 }, 0.3, 0.1, 100, 50, 40);
    expect(centre.x).toBeCloseTo(100);
    expect(centre.y).toBeCloseTo(50);
    const near = project({ x: 0, y: 0, z: -0.9 }, 0, 0, 0, 0, 1);
    const far = project({ x: 0, y: 0, z: 0.9 }, 0, 0, 0, 0, 1);
    expect(near.s).toBeGreaterThan(far.s);
  });

  it("a half turn of yaw mirrors x", () => {
    const p = project({ x: 0.5, y: 0, z: 0 }, 0, 0, 0, 0, 100);
    const q = project({ x: 0.5, y: 0, z: 0 }, Math.PI, 0, 0, 0, 100);
    expect(q.x).toBeCloseTo(-p.x, 5);
  });
});

describe("stepSignals", () => {
  const field = createField(5, 50);
  const rng = mulberry32(9);
  const empty: SignalState = { signals: [], budget: 0 };

  it("spawns nothing at rate zero and never exceeds the cap", () => {
    const still = stepSignals(empty, field, 1, { ...ACTIVITY.idle, rate: 0 }, rng, 10);
    expect(still.signals).toHaveLength(0);
    let state = empty;
    for (let i = 0; i < 60; i++) state = stepSignals(state, field, 0.1, ACTIVITY.busy, rng, 12);
    expect(state.signals.length).toBeLessThanOrEqual(12);
    // A capped frame drops its backlog instead of banking a burst for later.
    expect(state.budget).toBeLessThanOrEqual(1);
  });

  it("keeps t inside [0, 1) and hops under the limit", () => {
    let state = empty;
    for (let i = 0; i < 200; i++) {
      state = stepSignals(state, field, 0.05, ACTIVITY.structured, rng, 20);
      for (const s of state.signals) {
        expect(s.t).toBeGreaterThanOrEqual(0);
        expect(s.t).toBeLessThan(1);
        expect(s.hops).toBeLessThan(ACTIVITY.structured.maxHops);
        expect([field.edges[s.edge][0], field.edges[s.edge][1]]).toContain(s.from);
      }
    }
  });

  it("continues onto a DIFFERENT edge from the node it arrived at", () => {
    const edge = 0;
    const [a, b] = field.edges[edge];
    const arriving: SignalState = { signals: [{ edge, from: a, t: 0.95, hops: 0 }], budget: 0 };
    const always = { rate: 0, speed: 1, branch: 1, maxHops: 5 };
    const next = stepSignals(arriving, field, 0.1, always, () => 0.99, 10);
    expect(next.signals).toHaveLength(1);
    const s = next.signals[0];
    expect(s.edge).not.toBe(edge);
    expect(s.from).toBe(b);
    expect(s.hops).toBe(1);
    expect(field.adjacency[b]).toContain(s.edge);
  });

  it("drops a signal at its last hop", () => {
    const [a] = field.edges[0];
    const last: SignalState = { signals: [{ edge: 0, from: a, t: 0.99, hops: 3 }], budget: 0 };
    const next = stepSignals(last, field, 0.1, { rate: 0, speed: 1, branch: 1, maxHops: 4 }, () => 0, 10);
    expect(next.signals).toHaveLength(0);
  });
});

describe("approach", () => {
  it("moves toward the target without overshooting", () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = approach(v, 1, 0.05, 4);
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
    expect(approach(1, 0, 10, 4)).toBeCloseTo(0, 5);
  });
});

describe("nodeBudget", () => {
  it("gives the full field to a desktop and nothing to a constrained handset", () => {
    expect(nodeBudget({ coarse: false, cores: 8, saveData: false })).toBe(96);
    expect(nodeBudget({ coarse: false, cores: 4, saveData: false })).toBe(60);
    expect(nodeBudget({ coarse: true, cores: 8, saveData: false })).toBe(44);
    expect(nodeBudget({ coarse: true, cores: 2, saveData: false })).toBe(0);
    expect(nodeBudget({ coarse: false, cores: 8, saveData: true })).toBe(0);
    // Unknown core count (Safari reports nothing) is not treated as a weak device.
    expect(nodeBudget({ coarse: false, cores: 0, saveData: false })).toBe(96);
  });
});
