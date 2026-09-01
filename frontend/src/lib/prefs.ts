/**
 * Comfort preferences — the patient's own, kept on the device.
 *
 * Three switches the patient can reach without a caregiver: whether instructions are
 * spoken, whether the screen moves, and whether text is bigger. They live in
 * localStorage under one key, never travel to the server, and default to the safest
 * reading for someone we have not met: voice on (the population includes people who do
 * not read), motion on unless the OS says otherwise, text at the 20px floor.
 *
 * Aphasia mode is deliberately NOT here. That one changes what is on screen during a
 * measured task and is the caregiver's setting on the dashboard (`SessionSettings`).
 */
import { useSyncExternalStore } from "react";

export interface Prefs {
  voice: boolean;
  lowMotion: boolean;
  largeText: boolean;
}

export const DEFAULT_PREFS: Prefs = { voice: true, lowMotion: false, largeText: false };

const KEY = "neurotrace.comfort";
const listeners = new Set<() => void>();
let cached: Prefs | null = null;

export function readPrefs(): Prefs {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    cached = { ...DEFAULT_PREFS, ...parsed };
  } catch {
    // Private mode or storage disabled: defaults, and the choice lasts the session.
    cached = { ...DEFAULT_PREFS };
  }
  return cached;
}

export function writePrefs(patch: Partial<Prefs>): Prefs {
  cached = { ...readPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    /* the change still applies for this session */
  }
  listeners.forEach((l) => l());
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React binding. One store, so a toggle on the pause screen updates the shell at once. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, readPrefs, readPrefs);
  return [prefs, writePrefs];
}

/** Test seam: forget the cache so a fresh read hits storage again. */
export function resetPrefsCache(): void {
  cached = null;
}
