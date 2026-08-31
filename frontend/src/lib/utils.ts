import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string, locale = "en-IN") {
  return new Date(iso).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
  });
}

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
};

/**
 * A locale whose month names the runtime does not actually have leaks the raw CLDR field
 * instead — `M08` where `ਅਗ` should be.
 *
 * `supportedLocalesOf` does not catch it: the browser reports `pa-IN` as supported and then
 * renders "M08 31 9:00 AM", because a trimmed ICU build carries the locale's structure
 * without its month names. Observed in a real browser on the clinician roster while the
 * same call under Node produced "31 ਅਗ" correctly — so this is a property of the device,
 * not of the code, and the devices this product targets are low-end Android handsets where
 * trimmed ICU is common.
 *
 * A date a patient or clinician cannot read is worse than one in the wrong language, so a
 * detected leak falls back to `en-IN`. Cached per locale: the probe is a formatting call,
 * and this runs inside list rendering.
 */
const localeUsable = new Map<string, boolean>();

function usableLocale(locale: string): string {
  let ok = localeUsable.get(locale);
  if (ok === undefined) {
    try {
      // A fixed date with a known month. If the month comes back as a CLDR field name
      // (`M08`) rather than a word, the runtime has no month names for this locale.
      const probe = new Date(Date.UTC(2026, 7, 31, 9, 0)).toLocaleString(locale, DATE_OPTS);
      ok = !/\bM\d/.test(probe);
    } catch {
      ok = false;
    }
    localeUsable.set(locale, ok);
  }
  return ok ? locale : "en-IN";
}

export function formatDateTime(iso: string, locale = "en-IN") {
  return new Date(iso).toLocaleString(usableLocale(locale), DATE_OPTS);
}
