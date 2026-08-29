/**
 * The caretaker role's frontend contract, pinned — D-054.
 *
 * These are source assertions rather than rendered ones, for the reason recorded in
 * `taskFlow.test.ts`: vitest runs `environment: "node"` and the project has no DOM harness,
 * so adding one inside a feature branch would be its own change. The scans below are chosen
 * to fail on the specific regressions that would actually happen, not on the mere presence
 * of a keyword.
 *
 * The regression that matters most: before `CaretakerHome` existed, `Home()` fell through to
 * `CaregiverHome` for any unrecognised role. A caretaker would have been shown an "add a
 * patient" form and an enrolment flow that the server 403s. A control that always fails
 * reads as a broken product rather than a deliberate boundary.
 */
// Vite's `?raw` rather than node:fs — the app tsconfig types are ["vite/client"] with no
// node types, so `readFileSync` typechecks in vitest and fails `tsc -b`. Same idiom as
// `taskFlow.test.ts`, which hit this first.
import { describe, expect, it } from "vitest";

import appSource from "../App.tsx?raw";
import i18nSource from "./i18n.tsx?raw";
import typesSource from "./types.ts?raw";
import caretakerHomeSource from "../routes/CaretakerHome.tsx?raw";
import familyAccessSource from "../routes/FamilyAccess.tsx?raw";

const SOURCES: Record<string, string> = {
  "App.tsx": appSource,
  "lib/i18n.tsx": i18nSource,
  "lib/types.ts": typesSource,
  "routes/CaretakerHome.tsx": caretakerHomeSource,
  "routes/FamilyAccess.tsx": familyAccessSource,
};

const read = (rel: string) => SOURCES[rel];

describe("role dispatch", () => {
  it("sends a caretaker to their own home, not the caregiver's", () => {
    const app = read("App.tsx");
    expect(app).toContain('user?.role === "caretaker"');
    expect(app).toContain("<CaretakerHome />");

    // The caretaker branch must come BEFORE the caregiver fallthrough, or it never runs.
    expect(app.indexOf('user?.role === "caretaker"'))
      .toBeLessThan(app.indexOf("return <CaregiverHome />;"));
  });

  it("declares caretaker on the Role union so a typo cannot slip through", () => {
    expect(read("lib/types.ts")).toMatch(/\|\s*"caretaker"/);
  });
});

describe("what the family surface offers", () => {
  const home = read("routes/CaretakerHome.tsx");

  it("gives family the full clinical picture, not a summary", () => {
    // "Family sees everything" is half of the locked rule; a summary-only screen would
    // quietly break it while looking fine.
    expect(home).toContain("/dashboard/${patient.id}");
    expect(home).toContain("/report/${patient.id}");
  });

  it("keeps the emergency control reachable", () => {
    // One of the three safety guarantees. The person in the house is often the one who
    // needs it, so it must not be caregiver-only.
    expect(home).toContain("EmergencyButton");
  });

  it("offers no control the server would refuse", () => {
    // The other half of the locked rule: family see everything and change nothing. Each of
    // these 403s for a caretaker, so offering it would be offering a dead button.
    for (const forbidden of ["/enrol/", "/family/", "api.addCaretaker", "api.createPatient"]) {
      expect(home).not.toContain(forbidden);
    }
  });

  it("does not filter the patient list itself", () => {
    // `GET /patients` is already scoped to active links with C7 in force. Re-filtering here
    // would suggest the UI is the boundary, and INV-6 says it never is.
    expect(home).not.toMatch(/patients\.filter\(/);
  });
});

describe("the caregiver's family-access surface", () => {
  const family = read("routes/FamilyAccess.tsx");

  it("warns that adding a family member shares everything, before the form", () => {
    expect(family).toContain("familyAccessWarning");
    expect(family.indexOf("familyAccessWarning")).toBeLessThan(family.indexOf("AddCaretakerForm"));
  });

  it("requires a reason to remove access", () => {
    // An access change with no recorded why is not much of a record. The API demands it too;
    // this keeps the UI from sending an empty one.
    expect(family).toContain("familyRemoveReason");
    expect(family).toMatch(/if \(!reason\.trim\(\)\) return;/);
  });

  it("shows revoked links rather than hiding them", () => {
    // INV-8: who could see this patient, and until when, has to stay answerable.
    expect(family).toContain("familyPast");
    expect(family).toMatch(/links\.filter\(\(l\) => !l\.active\)/);
  });

  it("says plainly that an added member cannot sign in yet", () => {
    // Auth is deferred, so accounts are created disabled. Implying an invite was sent when
    // none was is the small dishonesty that makes a family distrust the rest of the screen.
    expect(family).toContain("login_enabled");
    expect(family).toContain("familyInvitePending");
  });
});

describe("translations", () => {
  const i18n = read("lib/i18n.tsx");

  it("has every caretaker string in all three languages", () => {
    const keys = [
      "familyTitle", "familySubtitle", "familyNoPatients", "familyOpenStatus",
      "familyOpenReport", "familyScopeNote", "familyAccessTitle", "familyAccessSubtitle",
      "familyAccessWarning", "familyAdd", "familyAddHint", "familyInvitePending",
      "familyName", "familyEmail", "familyRelationship", "familyActive", "familyNone",
      "familyPast", "familyPastNote", "familyMember", "familyRemove", "familyRemoveReason",
      "familyAddedOn", "familyRemovedOn",
      "relSON", "relDAUGHTER", "relSPOUSE", "relSIBLING", "relOTHER",
    ];
    const missing = keys.filter((k) => !i18n.includes(`${k}:`));
    expect(missing).toEqual([]);

    // An untranslated fallback leaking to a patient or their family is a real defect, so
    // every entry must carry hi and pa, not just en. Each entry is matched as a whole
    // `key: { ... }` object rather than by slicing a fixed window, which was fragile and
    // could silently read into the NEXT key's translations and pass on borrowed evidence.
    const withoutBoth = keys.filter((key) => {
      const entry = new RegExp(`\\b${key}:\\s*\\{[\\s\\S]*?\\}`).exec(i18n)?.[0] ?? "";
      return !entry.includes("hi:") || !entry.includes("pa:");
    });
    expect(withoutBoth).toEqual([]);
  });

  it("calls them family, not caretakers, in the words a person reads", () => {
    // Nobody calls their son a caretaker. `caretaker` is the schema's word; "family" is the
    // household's, and this product is read by a 70-year-old and their adult child.
    const at = i18n.indexOf("familyTitle:");
    const block = i18n.slice(at, at + 4000);
    expect(block.toLowerCase()).not.toContain('en: "caretaker');
  });
});
