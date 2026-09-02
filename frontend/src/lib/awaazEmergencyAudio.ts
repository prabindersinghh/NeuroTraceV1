/**
 * Patient-specific emergency phrase stored only in this browser.
 *
 * This uses its own IndexedDB database so upgrades to the practice-pair vault cannot make
 * the emergency path unavailable. The WAV is read while the board loads and held behind a
 * blob URL; pressing the emergency button therefore does not wait for either IndexedDB or
 * the network before playback starts.
 */

const DB_NAME = "neurotrace-awaaz-emergency";
const DB_VERSION = 1;
const STORE = "phrases";

export interface LocalEmergencyAudio {
  patient_id: string;
  target_text: string;
  lang: string;
  duration_seconds: number;
  sha256: string;
  created_at: string;
  last_tested_at?: string;
  audio: Blob;
}

function openVault(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("On-device emergency audio storage is not available"));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "patient_id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Could not open emergency audio storage"),
    );
  });
}

function waitFor<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("Emergency audio storage operation failed"),
    );
  });
}

export async function getLocalEmergencyAudio(
  patientId: string,
): Promise<LocalEmergencyAudio | null> {
  const db = await openVault();
  try {
    const request = db.transaction(STORE, "readonly")
      .objectStore(STORE).get(patientId) as IDBRequest<LocalEmergencyAudio | undefined>;
    return (await waitFor(request)) ?? null;
  } finally {
    db.close();
  }
}

export async function saveLocalEmergencyAudio(
  phrase: LocalEmergencyAudio,
): Promise<void> {
  const db = await openVault();
  try {
    await waitFor(db.transaction(STORE, "readwrite").objectStore(STORE).put(phrase));
    // Best effort: browsers may otherwise evict IndexedDB under storage pressure. The
    // visible self-test remains the source of truth even when persistence is declined.
    await navigator.storage?.persist?.().catch(() => false);
  } finally {
    db.close();
  }
}

export async function deleteLocalEmergencyAudio(patientId: string): Promise<void> {
  const db = await openVault();
  try {
    await waitFor(db.transaction(STORE, "readwrite").objectStore(STORE).delete(patientId));
  } finally {
    db.close();
  }
}

export function isEmergencyAudioCurrent(
  phrase: LocalEmergencyAudio | null,
  patientId: string,
  targetText: string,
  lang: string,
): phrase is LocalEmergencyAudio {
  return Boolean(
    phrase
    && phrase.patient_id === patientId
    && phrase.target_text === targetText
    && phrase.lang === lang,
  );
}

/** True means the browser accepted playback and the local WAV started, not merely existed. */
export async function startEmergencyPlayback(audio: Pick<HTMLAudioElement, "play">): Promise<boolean> {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
