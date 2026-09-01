/**
 * A session in progress, saved so a refresh does not throw it away.
 *
 * BEFORE THIS, nothing survived a reload. The runner held every captured module in a
 * ref and only created the server-side session at the very end, so closing the tab at
 * step fourteen lost fourteen steps, and `GET /sessions/{id}/current` — built for
 * resume — had nothing to return because no session existed yet.
 *
 * WHAT IS SAVED. Numbers only: extracted features, the raw landmark-derived points the
 * server extracts from (M3/M9/M6/M17), retries, the gate decision, the questionnaire
 * answers, and how much ACTIVE time had elapsed. Never media — the same rule as the
 * offline queue (INV-1). sessionStorage, not localStorage: a check-in belongs to a tab
 * and a morning, not to the phone forever.
 *
 * WHAT RESTORING MEANS CLINICALLY. The time away counts as a pause, so the next task is
 * recorded `paused_before_task` — exactly what the pause button records, because a task
 * performed after a rest is measured against a baseline built without one. The elapsed
 * clock resumes from the saved active time, so `elapsed_seconds_at_task_start` is task
 * time, not wall time. Positions never renumber, so fatigue position is preserved.
 *
 * WHY SIX HOURS. Longer than any plausible break within one check-in, shorter than
 * "tomorrow": a snapshot from yesterday must not be resumed into today's session, whose
 * type the server may have scheduled differently.
 */
import type { QueuedModule } from "./offline";
import type { OculomotorRaw } from "./ondevice/ocular";
import type { BalanceRaw } from "./ondevice/pose";
import type { SessionPlan } from "./protocol";
import type { SessionType } from "./types";

export const SNAPSHOT_VERSION = 1;
export const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;

export interface JourneySnapshot {
  version: typeof SNAPSHOT_VERSION;
  patientId: string;
  sessionType: SessionType;
  plan: SessionPlan;
  index: number;
  modules: QueuedModule[];
  ocular: OculomotorRaw;
  balance: BalanceRaw;
  retries: [number, number][];
  gatePassed: boolean;
  gateSkipped: string | null;
  questions: { phq2?: number[]; medicationTaken?: boolean };
  identity: { score: number; verified: boolean; unenrolled: boolean } | null;
  /** Active milliseconds — pauses already excluded. */
  activeMs: number;
  savedAt: string;
}

/** The subset of Storage this module needs, so tests can hand it a Map. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function snapshotKey(patientId: string): string {
  return `nt.journey.${patientId}`;
}

/** Best effort. A quota failure loses the snapshot, never the session. */
export function saveSnapshot(store: KeyValueStore | null, snap: JourneySnapshot): boolean {
  if (!store) return false;
  try {
    store.setItem(snapshotKey(snap.patientId), JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

/** The saved session, or null when there is none, it is stale, or it is unreadable. */
export function loadSnapshot(
  store: KeyValueStore | null, patientId: string, now: number = Date.now(),
): JourneySnapshot | null {
  if (!store) return null;
  try {
    const raw = store.getItem(snapshotKey(patientId));
    if (!raw) return null;
    const snap = JSON.parse(raw) as JourneySnapshot;
    if (snap.version !== SNAPSHOT_VERSION || snap.patientId !== patientId) return null;
    if (!Array.isArray(snap.plan?.steps) || !Number.isFinite(snap.index)) return null;
    const age = now - Date.parse(snap.savedAt);
    if (!Number.isFinite(age) || age < 0 || age > MAX_SNAPSHOT_AGE_MS) return null;
    return snap;
  } catch {
    return null;
  }
}

export function clearSnapshot(store: KeyValueStore | null, patientId: string): void {
  if (!store) return;
  try {
    store.removeItem(snapshotKey(patientId));
  } catch {
    /* nothing to clear, or nowhere to clear it from */
  }
}

/**
 * The clock after a restore. `elapsed = now - startedAt - totalPausedMs` must equal the
 * saved active time at the instant of resuming, so the session carries on from where the
 * task clock stopped rather than from when the tab was opened.
 */
export function restoredClock(activeMs: number, now: number): {
  startedAt: number; totalPausedMs: number;
} {
  return { startedAt: now - Math.max(0, activeMs), totalPausedMs: 0 };
}

/** The browser's sessionStorage, or null where it is unavailable. */
export function sessionStore(): KeyValueStore | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
