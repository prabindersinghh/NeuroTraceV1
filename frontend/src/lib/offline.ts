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
import type { ModuleFeatures, SessionType } from "./types";

const DB_NAME = "neurotrace";
const DB_VERSION = 1;
const STORE = "pending_sessions";

export interface QueuedModule {
  code: string;
  features: ModuleFeatures;
  quality_flag: boolean;
  quality_detail?: unknown;
}

export interface QueuedSession {
  /** Local id; the server id is assigned on sync. */
  localId: string;
  patientId: string;
  type: SessionType;
  capturedAt: string;
  deviceInfo: Record<string, unknown>;
  modules: QueuedModule[];
  attempts: number;
  lastError?: string;
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
    startSession: (patientId: string, payload: { type: SessionType; device_info?: unknown; offline_captured?: boolean }) => Promise<{ id: string }>;
    submitModule: (sessionId: string, code: string, features: ModuleFeatures, quality?: { quality_flag?: boolean; quality_detail?: unknown }) => Promise<unknown>;
    finalizeSession: (sessionId: string) => Promise<{ band: string }>;
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
      });
      for (const module of session.modules) {
        await api.submitModule(started.id, module.code, module.features, {
          quality_flag: module.quality_flag,
          quality_detail: module.quality_detail,
        });
      }
      const result = await api.finalizeSession(started.id);
      outcome.bands.push(result.band);
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
