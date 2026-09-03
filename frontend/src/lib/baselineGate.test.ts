/**
 * The doctor-in-the-loop gate must stay reachable from the app.
 *
 * The bug this pins was not a wrong value anywhere — every suite was green. The backend
 * put a patient into DOCTOR_REVIEW_PENDING once their modules locked, `record_review` was
 * the only exit, and NOTHING on this side could call it. A real patient completed their
 * baseline and was then never monitored. The demo passed because `services/seed.py` calls
 * `record_review` in Python, so the only exercised path skipped HTTP entirely.
 *
 * A route with no caller is invisible to a type checker and to every runtime test, so this
 * is about REACHABILITY rather than behaviour — the cheapest thing that fails if someone
 * removes the client method again. The client methods are asserted against the EXPORTED
 * object; only the wiring that has no runtime handle (which component renders where) falls
 * back to a source scan.
 */
import { describe, expect, it } from "vitest";

import { api } from "./api";
import { STRINGS } from "./i18n";

const API_SOURCE = (await import("./api.ts?raw")).default as string;
const PANEL_SOURCE = (await import("../components/BaselineReviewPanel.tsx?raw"))
  .default as string;
const DASHBOARD_SOURCE = (await import("../routes/Dashboard.tsx?raw")).default as string;

/** Every clinician baseline route, as `routers/clinician.py` declares it. */
const BASELINE_ROUTES = [
  "/clinician/baseline-review/",
  "/clinician/baseline/",
] as const;

describe("the baseline gate is reachable from the client", () => {
  it.each(BASELINE_ROUTES)("api.ts calls %s", (route) => {
    expect(API_SOURCE).toContain(route);
  });

  it("exposes a way OUT of DOCTOR_REVIEW_PENDING, not just a way to read it", () => {
    // Reading the review changes nothing. `record_review` is the only exit from the state,
    // and this POST is its only caller outside the seed.
    //
    // Asserted against the EXPORTED OBJECT, not the source text: a `toContain` on the file
    // still matches after the method is renamed to `submitBaselineReviewXX`, which is
    // exactly the mutation this test has to catch.
    expect(typeof api.baselineReview).toBe("function");
    expect(typeof api.submitBaselineReview).toBe("function");
    expect(typeof api.invalidateBaseline).toBe("function");
  });

  it("sends invalidate's reason as a query parameter, not a body field", () => {
    // `routers/clinician.py:invalidate` takes a bare `reason: str`, which FastAPI reads
    // from the query string. Sending it as JSON 422s with no obvious cause.
    expect(API_SOURCE).toMatch(/invalidate\?reason=\$\{encodeURIComponent\(reason\)\}/);
  });

  it("renders the decision panel for a clinician on a patient awaiting review", () => {
    expect(DASHBOARD_SOURCE).toContain("BaselineReviewPanel");
    expect(DASHBOARD_SOURCE).toMatch(
      /readOnly && data\.baseline\.state === "DOCTOR_REVIEW_PENDING"/,
    );
  });

  it("offers all three actions the server accepts, and only those", () => {
    // The server's pattern is ^(CONFIRM|EXTEND|FLAG_CONCERN)$. An action offered here that
    // it does not accept is a 422 the clinician cannot act on.
    expect(PANEL_SOURCE).toContain('["CONFIRM", "EXTEND", "FLAG_CONCERN"] as const');
  });

  it("requires a note for exactly the actions the server requires one for", () => {
    // `record_review` raises for EXTEND and FLAG_CONCERN with a blank note. CONFIRM's note
    // is optional there, and must stay optional here — a required field on the common
    // action is how a clinical gate becomes a box someone types "ok" into.
    expect(PANEL_SOURCE).toContain(
      'const NOTE_REQUIRED: ReadonlySet<BaselineReviewAction> = new Set(["EXTEND", "FLAG_CONCERN"])',
    );
  });
});

describe("the caregiver is told what the wait is", () => {
  it("distinguishes awaiting-review and abandoned from still-collecting", () => {
    // One card for every non-LOCKED state rendered "progress 12/12" with the bar pinned at
    // 100% forever, and the identical card for an abandoned baseline.
    expect(PANEL_SOURCE).toContain('state === "DOCTOR_REVIEW_PENDING"');
    expect(PANEL_SOURCE).toContain('state === "ABANDONED"');
  });

  it("says plainly that nobody is being monitored yet, in all three languages", () => {
    for (const key of [
      "baselinePendingTitle",
      "baselinePendingNote",
      "baselineAbandonedTitle",
      "baselineAbandonedNote",
      "reviewNotMonitored",
    ] as const) {
      const entry = STRINGS[key];
      expect(entry.en.length, `${key} en`).toBeGreaterThan(0);
      expect(entry.hi.length, `${key} hi`).toBeGreaterThan(0);
      expect(entry.pa.length, `${key} pa`).toBeGreaterThan(0);
      // A translation that is byte-identical to the English is an untranslated string
      // wearing a key. The whole cohort is Tier-2/3 Punjab.
      expect(entry.hi, `${key} hi is untranslated`).not.toBe(entry.en);
      expect(entry.pa, `${key} pa is untranslated`).not.toBe(entry.en);
    }
  });
});
