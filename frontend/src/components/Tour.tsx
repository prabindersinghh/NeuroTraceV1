/**
 * A first-run guided tour — Part 3. In-house, and deliberately so.
 *
 * WHY NOT react-joyride. Measured rather than assumed: v3.2.0 bundles to **26.8 KB
 * gzipped** (77.9 KB raw, react excluded) and pulls in ten transitive dependencies. On a
 * 104 KB main bundle that is a quarter again, and every one of those packages joins the
 * SBOM of a medical PWA. That alone would be arguable either way.
 *
 * What settled it is architectural. Joyride's core mechanic is a MODAL SPOTLIGHT: a
 * full-screen overlay that blocks everything except the highlighted element. This product
 * has a hard rule that the FAST and emergency paths are always reachable — someone having
 * a second stroke during the tour must be able to hit the emergency button. Making Joyride
 * safe here would mean fighting its central abstraction on every screen it appears on, and
 * a safety guarantee held together by overriding a library's main behaviour is not one you
 * want to rely on.
 *
 * So this tour never blocks anything. It highlights with an outline and puts a caption in
 * a bar; the page underneath stays fully interactive throughout. That is less capable than
 * Joyride — no scroll management, no clever repositioning — and it is capable enough for
 * three short tours, while being impossible to get wrong in the way that matters.
 *
 * (Also worth knowing if this is revisited: v3 removed the default export, so most Joyride
 * examples in circulation are v2 and will not compile against it.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n, type StringKey } from "@/lib/i18n";
import type { Role } from "@/lib/types";

export interface TourStep {
  /** Matches `data-tour="…"` on the element to highlight. */
  target: string;
  body: StringKey;
}

/** Short on purpose. A tour someone has to sit through is a tour they dismiss. */
const TOURS: Partial<Record<Role, TourStep[]>> = {
  patient: [
    { target: "start-check-in", body: "tourPatientStart" },
    { target: "emergency", body: "tourPatientEmergency" },
  ],
  caregiver: [
    { target: "patient-list", body: "tourCaregiverList" },
    { target: "add-patient", body: "tourCaregiverAdd" },
  ],
  clinician: [
    { target: "roster", body: "tourClinicianRoster" },
    { target: "review-queue", body: "tourClinicianReview" },
  ],
};

const seenKey = (role: Role) => `neurotrace.tour.${role}`;

function alreadySeen(role: Role): boolean {
  try {
    return localStorage.getItem(seenKey(role)) !== null;
  } catch {
    // Storage unavailable: treat as seen. Showing a tour on every load to someone in
    // private mode is worse than never showing it.
    return true;
  }
}

function markSeen(role: Role): void {
  try {
    localStorage.setItem(seenKey(role), "1");
  } catch { /* nothing to do; the tour simply reappears next time */ }
}

/**
 * Highlights the current target by toggling an attribute on it. The ring itself is a
 * `:where([data-tour-active])` rule in index.css, so no inline styles and nothing that can
 * drift from the token palette.
 */
function useHighlight(target: string | null) {
  useEffect(() => {
    if (!target) return undefined;
    const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
    if (!el) return undefined;
    el.setAttribute("data-tour-active", "");
    // Bring it into view without stealing focus — focus belongs to the tour's own
    // controls, so a keyboard user is never dropped somewhere unexpected.
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return () => el.removeAttribute("data-tour-active");
  }, [target]);
}

export function Tour({ role }: { role: Role }) {
  const { t } = useI18n();
  const steps = useMemo(() => TOURS[role] ?? [], [role]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(() => steps.length > 0 && !alreadySeen(role));
  const barRef = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    markSeen(role);
    setOpen(false);
  }, [role]);

  const step = open ? steps[index] : undefined;
  useHighlight(step?.target ?? null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  /**
   * Reserve the bar's own height at the bottom of the page while it is open.
   *
   * Without this a FIXED bar simply covers whatever is at the end of the document —
   * on the patient home it was sitting on top of the emergency button, cutting it in
   * half. A tour that hides a control is worse than no tour, and this one hiding THAT
   * control is the exact thing the non-blocking design was chosen to avoid.
   */
  useEffect(() => {
    if (!open) return undefined;
    const bar = barRef.current;
    const apply = () => {
      const h = bar?.getBoundingClientRect().height ?? 0;
      document.body.style.paddingBottom = `${Math.ceil(h)}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.body.style.paddingBottom = "";
    };
  }, [open, index]);

  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    // `role="status"` and not `dialog`: this is not modal, nothing is trapped, and calling
    // it a dialog would tell a screen-reader user the rest of the page is unavailable when
    // it is not. Bottom-anchored, and the emergency control is deliberately never placed
    // in this band on any patient surface.
    <div
      ref={barRef}
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-5 py-3 backdrop-blur-sm"
    >
      <div className="container flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="text-sm leading-snug text-muted-foreground">{t(step.body)}</p>
        <div className="ms-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {index + 1} / {steps.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={finish}
              className="focus-ring min-h-9 rounded-lg px-3 text-sm underline"
            >
              {t("tourSkip")}
            </button>
            <button
              type="button"
              onClick={() => (last ? finish() : setIndex((i) => i + 1))}
              className="focus-ring tactile min-h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              {last ? t("tourDone") : t("tourNext")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Tour;
