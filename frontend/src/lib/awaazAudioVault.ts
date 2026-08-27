/**
 * Local-only Awaaz training-pair vault.
 *
 * The Blob is stored in IndexedDB under this browser origin. Only its UUID, duration,
 * target text, and consent receipt are registered with the API; no method in api.ts accepts
 * this Blob. Deletion is available from the Awaaz screen so consent remains revocable.
 */

const DB_NAME = "neurotrace-awaaz-vault";
const DB_VERSION = 1;
const STORE = "audio_pairs";
const PATIENT_INDEX = "patient_id";

export interface LocalAudioPair {
  capture_id: string;
  patient_id: string;
  card_id: string;
  target_text: string;
  lang: string;
  duration_seconds: number;
  sha256: string;
  created_at: string;
  audio: Blob;
}

export async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function openVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("On-device audio storage is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "capture_id" });
        store.createIndex(PATIENT_INDEX, "patient_id", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open audio storage"));
  });
}

function waitFor(request: IDBRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Audio storage operation failed"));
  });
}

export async function saveLocalAudioPair(pair: LocalAudioPair): Promise<void> {
  const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    await waitFor(transaction.objectStore(STORE).put(pair));
  } finally {
    db.close();
  }
}

export async function countLocalAudioPairs(patientId: string): Promise<number> {
  const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).index(PATIENT_INDEX).count(patientId);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not read audio storage"));
    });
  } finally {
    db.close();
  }
}

/** IDs only: listing or counting a large vault must never load every WAV into memory. */
export async function listLocalAudioPairIds(patientId: string): Promise<string[]> {
  const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).index(PATIENT_INDEX).getAllKeys(patientId);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result.map(String));
      request.onerror = () => reject(request.error ?? new Error("Could not read audio storage"));
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalAudioPair(captureId: string): Promise<void> {
  const db = await openVault();
  try {
    const transaction = db.transaction(STORE, "readwrite");
    await waitFor(transaction.objectStore(STORE).delete(captureId));
  } finally {
    db.close();
  }
}
