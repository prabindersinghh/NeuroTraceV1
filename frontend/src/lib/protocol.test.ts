/**
 * The offline mirror must agree with the server's session-type split (D-044).
 *
 * `mirrorPlan` runs when the device is offline — which is a first-class supported state
 * here, not an edge case. If the mirror placed a module at a different position than the
 * server does, then an offline session and an online session would feed the SAME module's
 * baseline from two different points on the fatigue curve. That is exactly the silent
 * corruption the server-side position guarantee exists to prevent, reintroduced through
 * the offline path.
 *
 * These tests pin the mirror's own structure. The server-side equivalents live in
 * `backend/tests/test_session_type_protocols.py`; the two files assert the same
 * properties about the same protocol from opposite sides of the network boundary.
 */
import { describe, expect, it } from "vitest";

import { PROTOCOL_MIRROR, loadPlan, runnableSteps } from "./protocol";

/** Mirrors `session_plan.DAILY_PULSE_MODULES` — the six DAILY-schedule modules. */
const DAILY_PULSE_MODULES = new Set(["M1", "M4", "M7", "M10", "M13", "M19"]);

/** Forces the offline path: `loadPlan` falls back to the mirror when the API throws. */
async function mirrorFor(sessionType: "DAILY_PULSE" | "COMPREHENSIVE", intensity = "full") {
  // No API base configured in the test environment, so `api.sessionPlanV2` rejects and
  // `loadPlan` falls through to `mirrorPlan` — which is the code path under test.
  return loadPlan(intensity as Parameters<typeof loadPlan>[0], sessionType);
}

describe("offline mirror — daily pulse", () => {
  it("contains exactly the six daily pulse modules", async () => {
    const plan = await mirrorFor("DAILY_PULSE");
    const modules = new Set(plan.steps.map((s) => s.module));
    expect(modules).toEqual(DAILY_PULSE_MODULES);
  });

  it("numbers its steps 1..N consecutively", async () => {
    const plan = await mirrorFor("DAILY_PULSE");
    expect(plan.steps.map((s) => s.position)).toEqual(
      plan.steps.map((_, i) => i + 1),
    );
  });

  it("ignores intensity — there is nothing left to trim", async () => {
    const full = await mirrorFor("DAILY_PULSE", "full");
    const standard = await mirrorFor("DAILY_PULSE", "standard");
    expect(standard.steps).toEqual(full.steps);
  });

  it("has no standing block, so no fall-risk gate", async () => {
    const plan = await mirrorFor("DAILY_PULSE");
    expect(plan.steps.some((s) => s.block.startsWith("C_"))).toBe(false);
    expect(plan.fall_gate_before_position).toBeNull();
  });
});

describe("offline mirror — comprehensive", () => {
  it("places every daily pulse module at the identical position it has in daily pulse", async () => {
    const pulse = await mirrorFor("DAILY_PULSE");
    const comprehensive = await mirrorFor("COMPREHENSIVE");

    const pulseTriples = pulse.steps.map((s) => [s.module, s.task, s.position]);
    const comprehensivePrefix = comprehensive.steps
      .filter((s) => DAILY_PULSE_MODULES.has(s.module))
      .map((s) => [s.module, s.task, s.position]);

    expect(comprehensivePrefix).toEqual(pulseTriples);
  });

  it("contains every step from the source mirror exactly once", async () => {
    const plan = await mirrorFor("COMPREHENSIVE");
    const derived = plan.steps.map((s) => `${s.module}:${s.task}`).sort();
    const original = PROTOCOL_MIRROR.map((s) => `${s.module}:${s.task}`).sort();
    expect(derived).toEqual(original);
  });

  it("derives the fall-risk gate from the real standing block, not a stale constant", async () => {
    const plan = await mirrorFor("COMPREHENSIVE");
    const firstStanding = plan.steps.find((s) => s.block.startsWith("C_"));
    expect(firstStanding).toBeDefined();
    expect(plan.fall_gate_before_position).toBe(firstStanding!.position);
  });

  it("never lets STANDARD intensity drop a daily pulse module", async () => {
    const plan = await mirrorFor("COMPREHENSIVE", "standard");
    const present = new Set(
      plan.steps.filter((s) => DAILY_PULSE_MODULES.has(s.module)).map((s) => s.module),
    );
    expect(present).toEqual(DAILY_PULSE_MODULES);
  });

  it("is longer than daily pulse — it is the deeper battery", async () => {
    const pulse = await mirrorFor("DAILY_PULSE");
    const comprehensive = await mirrorFor("COMPREHENSIVE");
    expect(comprehensive.steps.length).toBeGreaterThan(pulse.steps.length);
    expect(comprehensive.planned_seconds).toBeGreaterThan(pulse.planned_seconds);
  });
});

describe("runnable steps", () => {
  it("keeps daily pulse runnable in the browser", async () => {
    // Daily Pulse is the every-day session; if its steps were filtered out as
    // non-web-runnable the patient would face an empty session.
    const plan = await mirrorFor("DAILY_PULSE");
    expect(runnableSteps(plan).length).toBeGreaterThan(0);
  });
});
