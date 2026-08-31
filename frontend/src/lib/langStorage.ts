/**
 * Where the language choice is kept, and how to tell "not chosen" from "chose English".
 *
 * A separate module from `i18n.tsx` for a small but real reason: that file exports a React
 * provider, so every non-component export added to it is another `only-export-components`
 * warning and another thing breaking fast refresh. This is pure, has no React in it, and is
 * the only place the storage key is written down.
 */
import type { Lang } from "./types";

const LANG_KEY = "neurotrace.lang";

/**
 * Has a human actually picked a language yet?
 *
 * The ABSENCE of the key is the signal, which is why nothing may write a default into it on
 * first read. "Nobody has chosen" and "somebody chose English" have to stay distinguishable,
 * or the language screen can never be shown to the people who most need it: a silent English
 * default is exactly how a Punjabi-speaking household ends up using an English app without
 * ever being offered anything else.
 */
export function hasChosenLang(): boolean {
  try {
    return localStorage.getItem(LANG_KEY) !== null;
  } catch {
    // Private mode, or storage disabled. Treat as "not chosen": showing the picker again
    // costs one tap, and assuming English would be the wrong way to fail.
    return false;
  }
}

/** The stored choice, or null if there is none. Never invents a default. */
export function readLang(): Lang | null {
  try {
    return (localStorage.getItem(LANG_KEY) as Lang | null) ?? null;
  } catch {
    return null;
  }
}

export function writeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // The choice still applies for this session; it just will not survive a reload.
  }
}
