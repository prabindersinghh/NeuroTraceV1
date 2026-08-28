/**
 * What reaches a caregiver — Part 6.2, pinned.
 *
 * The two rules that are easiest to erode:
 *
 *   1. WATCH does NOT notify. It is the band the engine sits in while it waits for a
 *      second corroborating domain, and pushing it to a family trains them to ignore the
 *      one that matters.
 *   2. A patient who is not being monitored yet produces no band-derived notification. A
 *      baseline still collecting, awaiting a doctor, or abandoned has no band the product
 *      stands behind (Part 3), so reporting one would be reporting a number we suppress
 *      everywhere else.
 */
import { describe, expect, it } from "vitest";

import {
  ADHERENCE_FLOOR,
  LOW_QUALITY_STREAK_FLOOR,
  MISSED_DAYS_FLOOR,
  NOTIFY_MESSAGE_KEY,
  type PatientSignals,
  notificationsFor,
  shouldNotify,
} from "./notify";

const calm: PatientSignals = {
  band: "STABLE",
  missedSessionDays: 0,
  lowQualityStreak: 0,
  adherence: 1,
  monitoring: true,
};

const reasons = (s: Partial<PatientSignals>) =>
  notificationsFor({ ...calm, ...s }).map((n) => n.reason);

describe("what notifies", () => {
  it("an ALERT notifies", () => {
    expect(reasons({ band: "ALERT" })).toContain("ALERT");
  });

  it("PATTERN_ATYPICAL notifies — it is not our alert, which is why a human is needed", () => {
    expect(reasons({ band: "PATTERN_ATYPICAL" })).toContain("PATTERN_ATYPICAL");
  });

  it("missed sessions notify once they are a pattern, not after one skipped day", () => {
    expect(reasons({ missedSessionDays: MISSED_DAYS_FLOOR - 1 })).toEqual([]);
    expect(reasons({ missedSessionDays: MISSED_DAYS_FLOOR })).toContain("MISSED_SESSIONS");
  });

  it("a low-quality streak notifies; a single bad capture does not", () => {
    expect(reasons({ lowQualityStreak: LOW_QUALITY_STREAK_FLOOR - 1 })).toEqual([]);
    expect(reasons({ lowQualityStreak: LOW_QUALITY_STREAK_FLOOR })).toContain(
      "LOW_QUALITY_STREAK",
    );
  });

  it("an adherence drop notifies", () => {
    expect(reasons({ adherence: ADHERENCE_FLOOR - 0.01 })).toContain("ADHERENCE_DROP");
    expect(reasons({ adherence: ADHERENCE_FLOOR })).toEqual([]);
  });

  it("unknown adherence is not treated as a drop", () => {
    expect(reasons({ adherence: null })).toEqual([]);
  });
});

describe("what deliberately does NOT notify", () => {
  it("WATCH does not notify", () => {
    expect(reasons({ band: "WATCH" })).toEqual([]);
    expect(shouldNotify({ ...calm, band: "WATCH" })).toBe(false);
  });

  it("a stable, adherent patient produces nothing at all", () => {
    expect(notificationsFor(calm)).toEqual([]);
    expect(shouldNotify(calm)).toBe(false);
  });

  it("no band-derived notification while the patient is not being monitored", () => {
    // The baseline is still collecting / awaiting a doctor / abandoned. Bands and alerts
    // are suppressed everywhere else in the product; they must be suppressed here too.
    expect(reasons({ band: "ALERT", monitoring: false })).not.toContain("ALERT");
    expect(reasons({ band: "PATTERN_ATYPICAL", monitoring: false })).not.toContain(
      "PATTERN_ATYPICAL",
    );
  });

  it("but a record nobody is completing still speaks up while not monitoring", () => {
    // Adherence and quality are facts about the RECORD, not claims about the person, so
    // they survive suppression — a baseline nobody is completing is worth saying out loud.
    const out = reasons({ monitoring: false, missedSessionDays: MISSED_DAYS_FLOOR });
    expect(out).toContain("MISSED_SESSIONS");
  });
});

describe("ordering and rendering", () => {
  it("returns every matching reason, most urgent first", () => {
    const out = reasons({
      band: "ALERT",
      missedSessionDays: 10,
      lowQualityStreak: 5,
      adherence: 0.1,
    });
    expect(out[0]).toBe("ALERT");
    expect(out).toEqual([
      "ALERT",
      "MISSED_SESSIONS",
      "LOW_QUALITY_STREAK",
      "ADHERENCE_DROP",
    ]);
  });

  it("every reason has a message key, so a raw enum name can never reach a family", () => {
    const all = reasons({
      band: "ALERT",
      missedSessionDays: 10,
      lowQualityStreak: 5,
      adherence: 0.1,
    });
    for (const reason of [...all, "PATTERN_ATYPICAL" as const]) {
      expect(NOTIFY_MESSAGE_KEY[reason]).toBeTruthy();
    }
  });
});
