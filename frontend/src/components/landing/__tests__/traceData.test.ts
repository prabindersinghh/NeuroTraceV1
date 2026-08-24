/**
 * The landing page tells a specific story about a specific run. This pins it.
 *
 * The point is not to test arithmetic — it is that the illustrated verdicts are COMPUTED
 * from the series by the same rules the engine uses, so nobody can nudge the picture and
 * leave the page asserting something the gates would not have produced. If the seeded run
 * is edited, this fails before the page ships a claim that is no longer true.
 */
import { describe, expect, it } from "vitest";

import {
  BASELINE_UNTIL, DEV_THRESHOLD, DOMAINS, RUN_DAYS, buildRun, deviatingOn, verdictOn,
} from "../traceData";

describe("the seeded 21-day run", () => {
  const series = buildRun(42);

  it("is deterministic", () => {
    expect(buildRun(42)).toEqual(series);
  });

  it("has one lane per gating domain, RUN_DAYS long", () => {
    expect(DOMAINS).toHaveLength(7);
    for (const domain of DOMAINS) expect(series[domain.key]).toHaveLength(RUN_DAYS);
  });

  it("passes no judgement while the baseline is still being learned", () => {
    for (let day = 1; day <= BASELINE_UNTIL; day += 1) {
      expect(verdictOn(series, day).band).toBe("BASELINE");
    }
  });

  it("is stable on days 16 to 18", () => {
    for (const day of [16, 17, 18]) {
      expect(deviatingOn(series, day)).toEqual([]);
      expect(verdictOn(series, day).band).toBe("STABLE");
    }
  });

  it("reaches WATCH on day 19 — three domains moved, but only for one session", () => {
    const day19 = verdictOn(series, 19);
    expect(deviatingOn(series, 19).sort()).toEqual(["cranial_nerves", "motor", "motor_speech"]);
    expect(day19.gate1).toEqual([]);          // gate 1 is what stops it
    expect(day19.band).toBe("WATCH");
  });

  it("reaches ALERT on day 20 with all three gates satisfied", () => {
    const day20 = verdictOn(series, 20);
    expect(day20.gate1.sort()).toEqual(["cranial_nerves", "motor", "motor_speech"]);
    expect(day20.gate2).toBe(true);
    // Only the lateralisable domains can satisfy gate 3; motor_speech never can.
    expect(day20.gate3.sort()).toEqual(["cranial_nerves", "motor"]);
    expect(day20.gate3).not.toContain("motor_speech");
    expect(day20.band).toBe("ALERT");
    expect(day20.repeat).toBe(false);         // the one notification
  });

  it("holds the band on day 21 without notifying again", () => {
    const day21 = verdictOn(series, 21);
    expect(day21.band).toBe("ALERT");
    expect(day21.repeat).toBe(true);
  });

  it("never marks a non-lateralisable domain as carrying a side", () => {
    for (const domain of DOMAINS.filter((d) => !d.lateral)) {
      for (const point of series[domain.key]) expect(point.asymmetry).toBe(0);
    }
  });

  it("keeps every quiet day inside the deviation threshold", () => {
    for (const domain of DOMAINS) {
      for (let day = 1; day <= 18; day += 1) {
        expect(Math.abs(series[domain.key][day - 1].z)).toBeLessThan(DEV_THRESHOLD);
      }
    }
  });
});
