export const EMERGENCY_LONG_PRESS_MS = 1_200;
export const EMERGENCY_LONG_PRESS_MOVE_PX = 14;

export interface PointerPoint {
  x: number;
  y: number;
}

export interface EmergencyLocation {
  lat: number;
  lon: number;
  accuracy_m: number;
}

export function movedBeyondEmergencyHold(
  start: PointerPoint,
  current: PointerPoint,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y)
    > EMERGENCY_LONG_PRESS_MOVE_PX;
}

export function isEmergencyHoldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest(
    "button,a,input,textarea,select,summary,audio,[role='button'],[contenteditable='true']",
  );
}

const LOCATION_KEY_PREFIX = "neurotrace.awaaz.share-emergency-location.";

export function readEmergencyLocationConsent(patientId: string): boolean {
  try {
    return localStorage.getItem(`${LOCATION_KEY_PREFIX}${patientId}`) === "1";
  } catch {
    return false;
  }
}

export function writeEmergencyLocationConsent(patientId: string, enabled: boolean): void {
  try {
    const key = `${LOCATION_KEY_PREFIX}${patientId}`;
    if (enabled) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // The in-memory setting still applies for this page even if storage is unavailable.
  }
}

/** Resolve one location fix. Exact coordinates are kept in memory and sent only on a tap. */
export function getEmergencyLocation(timeoutMs = 4_000): Promise<EmergencyLocation | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
      }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: timeoutMs },
    );
  });
}
