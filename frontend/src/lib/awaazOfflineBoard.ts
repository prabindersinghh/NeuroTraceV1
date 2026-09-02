/**
 * Authenticated on-device snapshot of the Awaaz phrase board.
 *
 * The board contains personal phrases, so a patient id alone is not an access boundary.
 * Every snapshot is keyed by the exact user who successfully fetched it while online and
 * can be recovered only for that same stored identity. A snapshot is used only for a
 * network-unreachable error: 401/403/404 responses must never fall back to stale access.
 *
 * This stores text/profile metadata only. Audio remains in its separate purpose-bound
 * vaults, and the cached board does not create an offline audit or sync claim.
 */
import { ApiError } from "./api";
import type { AwaazBoard } from "./types";

const DB_NAME = "neurotrace-awaaz-board";
const DB_VERSION = 1;
const STORE = "boards";
const SCHEMA_VERSION = 1;

export interface CachedAwaazBoard {
  key: string;
  schema_version: 1;
  owner_user_id: string;
  patient_id: string;
  cached_at: string;
  board: AwaazBoard;
}

export function offlineBoardCacheKey(userId: string, patientId: string): string {
  return `${userId}:${patientId}`;
}

/** An authorization response is authoritative even when a snapshot exists. */
export function mayUseOfflineBoard(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCachedAwaazBoardFor(
  value: unknown,
  userId: string,
  patientId: string,
): value is CachedAwaazBoard {
  if (!isRecord(value) || !isRecord(value.board)) {
    return false;
  }
  const board = value.board;
  const profile = board.profile;
  if (!isRecord(profile)) return false;
  if (
    value.schema_version !== SCHEMA_VERSION
    || value.key !== offlineBoardCacheKey(userId, patientId)
    || value.owner_user_id !== userId
    || value.patient_id !== patientId
    || board.patient_id !== patientId
    || profile.patient_id !== patientId
    || typeof profile.speech_profile !== "string"
    || typeof profile.auto_speak_enabled !== "boolean"
    || typeof profile.auto_speak_threshold !== "number"
    || !Number.isFinite(profile.auto_speak_threshold)
    || typeof profile.voice_status !== "string"
    || typeof profile.endpoint_silence_seconds !== "number"
    || !Number.isFinite(profile.endpoint_silence_seconds)
    || typeof value.cached_at !== "string"
    || !Array.isArray(board.cards)
  ) {
    return false;
  }
  return board.cards.every((card) => (
    isRecord(card)
    && typeof card.id === "string"
    && typeof card.text === "string"
    && typeof card.lang === "string"
    && (typeof card.icon === "string" || card.icon === null)
    && typeof card.category === "string"
    && typeof card.slot === "number"
    && Number.isFinite(card.slot)
    && typeof card.use_count === "number"
    && Number.isFinite(card.use_count)
    && typeof card.is_emergency === "boolean"
  ));
}

function openBoardCache(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("On-device phrase-board storage is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Could not open phrase-board storage"),
    );
  });
}

function waitFor<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Phrase-board storage operation failed"),
    );
  });
}

export async function saveCachedAwaazBoard(
  userId: string,
  board: AwaazBoard,
): Promise<void> {
  const db = await openBoardCache();
  const snapshot: CachedAwaazBoard = {
    key: offlineBoardCacheKey(userId, board.patient_id),
    schema_version: SCHEMA_VERSION,
    owner_user_id: userId,
    patient_id: board.patient_id,
    cached_at: new Date().toISOString(),
    board,
  };
  try {
    await waitFor(db.transaction(STORE, "readwrite").objectStore(STORE).put(snapshot));
    await navigator.storage?.persist?.().catch(() => false);
  } finally {
    db.close();
  }
}

export async function getCachedAwaazBoard(
  userId: string,
  patientId: string,
): Promise<AwaazBoard | null> {
  const db = await openBoardCache();
  try {
    const request = db.transaction(STORE, "readonly").objectStore(STORE)
      .get(offlineBoardCacheKey(userId, patientId)) as IDBRequest<unknown>;
    const snapshot = await waitFor(request);
    return isCachedAwaazBoardFor(snapshot, userId, patientId) ? snapshot.board : null;
  } finally {
    db.close();
  }
}
