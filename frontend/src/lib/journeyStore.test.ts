/**
 * A session in progress must survive a reload, and must NOT be resumed into the wrong
 * morning. The clock after a restore is the property that matters clinically: elapsed
 * time is task time, and the gap counts as a pause.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_SNAPSHOT_AGE_MS, SNAPSHOT_VERSION, clearSnapshot, loadSnapshot, restoredClock,
  saveSnapshot, type JourneySnapshot, type KeyValueStore,
} from "./journeyStore";
import { emptyOculomotorRaw } from "./ondevice/ocular";
import { emptyBalanceRaw } from "./ondevice/pose";
import { DEFAULT_PREFS, readPrefs, resetPrefsCache, writePrefs } from "./prefs";

function fakeStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function snapshot(over: Partial<JourneySnapshot> = {}): JourneySnapshot {
  return {
    version: SNAPSHOT_VERSION,
    patientId: "p1",
    sessionType: "COMPREHENSIVE",
    plan: { intensity: "full", planned_seconds: 0, fall_gate_before_position: null, steps: [] },
    index: 7,
    modules: [{ code: "M10", features: { rt_median: 412 }, quality_flag: true, session_position: 1 }],
    ocular: emptyOculomotorRaw(),
    balance: emptyBalanceRaw(),
    retries: [[3, 1]],
    gatePassed: false,
    gateSkipped: null,
    questions: { phq2: [0, 1], medicationTaken: true },
    identity: null,
    activeMs: 184_000,
    savedAt: new Date(1_700_000_000_000).toISOString(),
    ...over,
  };
}

describe("snapshot round trip", () => {
  it("restores exactly what was saved", () => {
    const store = fakeStore();
    const snap = snapshot();
    expect(saveSnapshot(store, snap)).toBe(true);
    expect(loadSnapshot(store, "p1", 1_700_000_000_000 + 60_000)).toEqual(snap);
  });

  it("is keyed by patient, so another patient's snapshot is never offered", () => {
    const store = fakeStore();
    saveSnapshot(store, snapshot());
    expect(loadSnapshot(store, "p2", 1_700_000_000_000)).toBeNull();
  });

  it("refuses a stale snapshot — yesterday's session is not today's", () => {
    const store = fakeStore();
    saveSnapshot(store, snapshot());
    const later = 1_700_000_000_000 + MAX_SNAPSHOT_AGE_MS + 1;
    expect(loadSnapshot(store, "p1", later)).toBeNull();
    // ...and accepts one just inside the window.
    expect(loadSnapshot(store, "p1", later - 2)).not.toBeNull();
  });

  it("refuses a snapshot from the future or with a broken timestamp", () => {
    const store = fakeStore();
    saveSnapshot(store, snapshot({ savedAt: "not a date" }));
    expect(loadSnapshot(store, "p1")).toBeNull();
    saveSnapshot(store, snapshot());
    expect(loadSnapshot(store, "p1", 1_700_000_000_000 - 5_000)).toBeNull();
  });

  it("refuses a different version rather than restoring a shape it cannot read", () => {
    const store = fakeStore();
    store.setItem("nt.journey.p1", JSON.stringify({ ...snapshot(), version: 99 }));
    expect(loadSnapshot(store, "p1", 1_700_000_000_000)).toBeNull();
  });

  it("treats unreadable storage as no snapshot", () => {
    const store = fakeStore();
    store.setItem("nt.journey.p1", "{not json");
    expect(loadSnapshot(store, "p1")).toBeNull();
    const throwing: KeyValueStore = {
      getItem: () => { throw new Error("quota"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("quota"); },
    };
    expect(loadSnapshot(throwing, "p1")).toBeNull();
    expect(saveSnapshot(throwing, snapshot())).toBe(false);
    expect(() => clearSnapshot(throwing, "p1")).not.toThrow();
  });

  it("clears", () => {
    const store = fakeStore();
    saveSnapshot(store, snapshot());
    clearSnapshot(store, "p1");
    expect(store.map.size).toBe(0);
  });
});

describe("the clock after a restore", () => {
  it("resumes elapsed time from the saved ACTIVE time, not from page load", () => {
    const now = 5_000_000;
    const { startedAt, totalPausedMs } = restoredClock(184_000, now);
    // The runner's own expression: performance.now() - startedAt - totalPausedMs.
    expect(now - startedAt - totalPausedMs).toBe(184_000);
  });

  it("never restores a negative active time", () => {
    const { startedAt } = restoredClock(-10, 1000);
    expect(1000 - startedAt).toBe(0);
  });
});

describe("comfort preferences", () => {
  it("default to voice on, motion on, text at the floor", () => {
    resetPrefsCache();
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("patch and read back without storage present", () => {
    // vitest runs in node: no localStorage. The write must still apply in-memory.
    resetPrefsCache();
    expect(writePrefs({ voice: false }).voice).toBe(false);
    expect(readPrefs().lowMotion).toBe(false);
    resetPrefsCache();
  });
});
