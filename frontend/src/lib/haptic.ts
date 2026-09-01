/**
 * A gentle tick on phones that can. Never required for anything: the "on" state of a
 * light is also brighter, larger and labelled, so a phone without a motor loses nothing.
 */
export function haptic(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported, or not allowed — the light still lit */
  }
}
