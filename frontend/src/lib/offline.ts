/**
 * Offline session queue — TRD §1 ("Service worker for full offline operation").
 *
 * The exam must complete with the phone in airplane mode. That is not a resilience nicety;
 * it is the product claim. A patient in a Tier-2/3 town with intermittent data cannot have
 * their daily check-in fail because a tower was busy, and the pitch's strongest moment is
 * turning airplane mode on and running a full exam anyway.
 *
 * What that means concretely: feature extraction already runs entirely on-device, so the
 * only thing the network is needed for is *sync*. This module queues extracted features in
 * IndexedDB and drains them when connectivity returns. Nothing queued here is media — the
 * queue holds numbers, so even a stolen phone with a full queue leaks no biometric data.
 */
import { useEffect, useState } from "react";

import type { ModuleFeatures, SessionType } from "./types";

const DB_NAME = "neurotrace";
const DB_VERSION = 1;
const STORE = "pending_sessions";

export interface QueuedModule {
  code: string;
  features: ModuleFeatures;
  quality_flag: boolean;
  quality_detail?: unknown;
  /** Raw landmark-derived points for server-side extraction (M3/M9/M6/M17). */
  raw?: Record<string, unknown>;
  // Fatigue instrumentation — travels with the result through the offline queue too,
  // because a queued session is still a session performed at those positions.
  session_position?: number;
  elapsed_seconds_at_task_start?: number;
  intensity?: string;
  paused_before_task?: boolean;
}

export interface QueuedSession {
  /** Local id; the server id is assigned on sync. */
  localId: string;
  patientId: string;
  isPractice?: boolean;
  type: SessionType;
  capturedAt: string;
  deviceInfo: Record<string, unknown>;
  modules: QueuedModule[];
  /** PHQ-2 and medicines, answered at their positions (D-061). Absent when skipped. */
  questions?: { phq2?: number[]; medicationTaken?: boolean };
  attempts: number;
  lastError?: string;
  /**
   * Set when the patient EXITED this session part-way. Present here and not only on the
   * server because the exit happens offline too, and a queued partial session that drained
   * through `finalizeSession` would be scored — which is precisely the INV-14 violation the
   * exit path exists to avoid. The drain below branches on this.
   */
  abandoned?: { completed: number; total: number };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = fn(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export function isOfflineStorageSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

export function newLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueSession(session: QueuedSession): Promise<void> {
  await withStore("readwrite", (store) => store.put(session) as IDBRequest<IDBValidKey>);
}

export async function pendingSessions(): Promise<QueuedSession[]> {
  const all = await withStore("readonly", (store) => store.getAll() as IDBRequest<QueuedSession[]>);
  return (all ?? []).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function removeSession(localId: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(localId) as unknown as IDBRequest<undefined>);
}

export async function markAttempt(localId: string, error: string): Promise<void> {
  const existing = await withStore(
    "readonly",
    (store) => store.get(localId) as IDBRequest<QueuedSession | undefined>,
  );
  if (!existing) return;
  existing.attempts += 1;
  existing.lastError = error;
  await enqueueSession(existing);
}

export async function pendingCount(): Promise<number> {
  return (await pendingSessions()).length;
}

export interface SyncOutcome {
  synced: number;
  failed: number;
  bands: string[];
}

/**
 * Drain the queue.
 *
 * Sessions are replayed in capture order, because the alert gate is a function of
 * *consecutive* sessions: replaying yesterday after today would compute the persistence
 * window against the wrong history and could manufacture or suppress an alert.
 */
export async function syncPending(
  api: {
    startSession: (patientId: string, payload: { type: SessionType; device_info?: unknown; offline_captured?: boolean; is_practice?: boolean }) => Promise<{ id: string }>;
    submitModule: (sessionId: string, code: string, features: ModuleFeatures, quality?: {
      quality_flag?: boolean; quality_detail?: unknown; raw?: Record<string, unknown>;
      session_position?: number; elapsed_seconds_at_task_start?: number;
      intensity?: string; paused_before_task?: boolean;
    }) => Promise<unknown>;
    finalizeSession: (sessionId: string) => Promise<{ band: string }>;
    abandonSession: (sessionId: string,
                     steps: { completed: number; total: number }) => Promise<unknown>;
    submitQuestionnaire?: (patientId: string, instrument: "PHQ2", responses: number[],
                           sessionId?: string) => Promise<unknown>;
    submitAdherence?: (patientId: string, taken: boolean) => Promise<unknown>;
  },
): Promise<SyncOutcome> {
  const queue = await pendingSessions();
  const outcome: SyncOutcome = { synced: 0, failed: 0, bands: [] };

  for (const session of queue) {
    try {
      const started = await api.startSession(session.patientId, {
        type: session.type,
        device_info: session.deviceInfo,
        offline_captured: true,
        is_practice: session.isPractice ?? false,
      });
      for (const module of session.modules) {
        await api.submitModule(started.id, module.code, module.features, {
          quality_flag: module.quality_flag,
          quality_detail: module.quality_detail,
          raw: module.raw,
          session_position: module.session_position,
          elapsed_seconds_at_task_start: module.elapsed_seconds_at_task_start,
          intensity: module.intensity,
          paused_before_task: module.paused_before_task,
        });
      }
      if (session.abandoned) {
        // A session the patient walked out of. It uploads in full — the results are kept —
        // and is then marked abandoned rather than finalised, so it never reaches a
        // baseline or a band. Finalising it here would score a truncated session, which is
        // the INV-14 failure this whole path exists to prevent. No band is pushed onto the
        // outcome because there is none, and inventing one would surface a score for a
        // check-in that was never completed.
        await api.abandonSession(started.id, session.abandoned);
      } else {
        // Answers travel with the session they belong to, and only what was answered.
        if (session.questions?.phq2?.length && api.submitQuestionnaire) {
          await api.submitQuestionnaire(session.patientId, "PHQ2", session.questions.phq2, started.id);
        }
        if (session.questions?.medicationTaken !== undefined && api.submitAdherence) {
          await api.submitAdherence(session.patientId, session.questions.medicationTaken);
        }
        const result = await api.finalizeSession(started.id);
        outcome.bands.push(result.band);
      }
      outcome.synced += 1;
      await removeSession(session.localId);
    } catch (error) {
      outcome.failed += 1;
      await markAttempt(session.localId, error instanceof Error ? error.message : "unknown");
      // Stop on the first failure. Continuing would push later sessions ahead of this one
      // and break the consecutive ordering the gate depends on.
      break;
    }
  }
  return outcome;
}

export function onConnectivityChange(handler: (online: boolean) => void): () => void {
  const online = () => handler(true);
  const offline = () => handler(false);
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  return () => {
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * Connectivity as React state. The sign-in screen uses it to say "you are offline" before
 * the person types a password into a form that cannot be sent, rather than after.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(isOnline());
  useEffect(() => onConnectivityChange(setOnline), []);
  return online;
}
