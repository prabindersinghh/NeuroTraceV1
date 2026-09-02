import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be TOLD about custom font sizes, or it silently deletes them.
 *
 * It resolves conflicts by class group, and it infers the group from the prefix. `text-*`
 * covers BOTH font size and text colour, so for any `text-<name>` it does not recognise as
 * a size it assumes a colour — and then `cn("text-title-fluid", "text-foreground")` drops
 * the first as an overridden colour.
 *
 * That is what happened: the page title rendered at 16px/400 with a class list of
 * `text-foreground mt-2`, the type token gone, and nothing anywhere reported it. Every
 * custom size was exposed the same way — the scale only survived where a callsite happened
 * to write a plain string instead of going through `cn()`, which is not a property anyone
 * can maintain.
 *
 * Registering them as font sizes makes the conflict resolve the right way round: a size and
 * a colour stop competing, and two sizes still override each other as they should.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "title-1", "title-2", "title-3", "title-fluid", "metric", "label"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}

export function formatDate(iso: string, locale = "en-IN") {
  // `usableLocale`, same as formatDateTime below. This one did not, so on a device with a
  // trimmed ICU build the chart axis and the history list rendered "M08 31" while every
  // date beside them read "31 ਅਗ" — the guard existed and half the callers skipped it.
  return new Date(iso).toLocaleDateString(usableLocale(locale), {
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

export function usableLocale(locale: string): string {
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
