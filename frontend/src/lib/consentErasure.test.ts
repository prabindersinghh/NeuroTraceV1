/**
 * Consent and erasure must stay reachable, and this screen must not overclaim enforcement.
 *
 * Same bug class as `baselineGate.test.ts`: Part 4 shipped seven independently withdrawable
 * consents and Part 5.4 shipped a real erasure, and the client called neither. Consents were
 * WRITTEN by enrolment and by `POST /clinician/links` and never read back, so a caregiver
 * could grant C3 by adding a doctor and had no way to see it, let alone withdraw it.
 *
 * The client-method assertions run against the exported `api` object, not the source text —
 * a `toContain` on the file still passes after the method is renamed.
 */
import { describe, expect, it } from "vitest";

import { api } from "./api";
import { STRINGS } from "./i18n";

const API_SOURCE = (await import("./api.ts?raw")).default as string;
const PRIVACY_SOURCE = (await import("../routes/Privacy.tsx?raw")).default as string;
const APP_SOURCE = (await import("../App.tsx?raw")).default as string;
const ROSTER_SOURCE = (await import("../routes/CaregiverHome.tsx?raw")).default as string;

/** `models.py:ConsentType`. Seven — C7 arrived with the caretaker work and the docstrings
 *  around it still say "six", which is exactly why this list is written out. */
const CONSENT_TYPES = [
  "FOLLOW_UP",
  "DATA_PROCESSING",
  "CLINICIAN_SHARING",
  "RESEARCH",
  "MEDIA_TESTIMONIAL",
  "TELECONSULTATION",
  "CARETAKER_SHARING",
] as const;

describe("consent is reachable and complete", () => {
  it("exposes read and write, not just read", () => {
    expect(typeof api.consents).toBe("function");
    expect(typeof api.setConsent).toBe("function");
  });

  it.each(CONSENT_TYPES)("offers %s", (type) => {
    // A consent the server can hold but the screen never lists is one nobody can withdraw.
    expect(PRIVACY_SOURCE).toContain(`type: "${type}"`);
  });

  it("names exactly the two consents that actually gate access", () => {
    // `consent_currently_granted` is read by `clinician_may_access_patient` and
    // `caretaker_may_access_patient`. The other five are recorded decisions with no runtime
    // gate, and telling a caregiver that switching off DATA_PROCESSING stops the processing
    // would be a lie the backend does not back up.
    expect(PRIVACY_SOURCE).toContain(
      'const ENFORCED: ReadonlySet<ConsentType> = new Set(["CLINICIAN_SHARING", "CARETAKER_SHARING"])',
    );
  });

  it("distinguishes never-asked from withdrawn", () => {
    // `consent_currently_granted` returns false for a missing row. An unchecked box alone
    // could read as a chosen default, so the absence is stated in words.
    expect(PRIVACY_SOURCE).toContain('t("consentNeverAsked")');
    expect(PRIVACY_SOURCE).toContain('t("consentWithdrawnOn")');
  });

  it("re-renders from the server's own status after a toggle", () => {
    // `PUT` returns the full status. A screen that trusted its optimistic guess could show
    // a consent as off while the row still said granted, which is the worst lie this page
    // could tell.
    expect(PRIVACY_SOURCE).toMatch(/setConsents\(await api\.setConsent\(/);
  });
});

describe("erasure is reachable and honest", () => {
  it("exposes the delete", () => {
    expect(typeof api.erasePatient).toBe("function");
  });

  it("sends the reason as a query parameter, not a body field", () => {
    // `routers/patients.py:delete_patient` declares `reason: str | None = None` — a bare
    // default arg, which FastAPI reads from the query string. Same trap as invalidate.
    expect(API_SOURCE).toMatch(/patients\/\$\{patientId\}\?reason=\$\{encodeURIComponent\(reason\)\}/);
  });

  it("states what SURVIVES an erasure, not only what is deleted", () => {
    // Audit and consent history are retained (INV-8), and that is the part people are most
    // surprised by. Saying only "everything is deleted" would be the comfortable lie.
    expect(PRIVACY_SOURCE).toContain('t("eraseWhatStays")');
    expect(PRIVACY_SOURCE).toContain('t("eraseWhatGoes")');
  });

  it("requires two deliberate acts and offers a way out", () => {
    expect(PRIVACY_SOURCE).toMatch(/disabled=\{erasing \|\| !understood \|\| !reason\.trim\(\)\}/);
    expect(PRIVACY_SOURCE).toContain('t("eraseCancel")');
  });

  it("renders a tombstone as a tombstone, on both surfaces", () => {
    // `erase_patient_data` sets `patient.name = ""` and the row survives so
    // `audit_log.patient_id` keeps its foreign key. Without this the roster showed a blank
    // card forever.
    expect(ROSTER_SOURCE).toContain("const erased = patient.erased_at !== null");
    expect(PRIVACY_SOURCE).toContain("const erased = patient.erased_at !== null");
  });
});

describe("the screen is routed and reachable by a caregiver", () => {
  it("has a route", () => {
    expect(APP_SOURCE).toContain('path="/privacy/:patientId"');
  });

  it("is linked from the patient card", () => {
    expect(ROSTER_SOURCE).toContain("`/privacy/${patient.id}`");
  });
});

describe("the copy exists in all three languages", () => {
  const KEYS = [
    "privacyTitle", "privacyIntro", "privacyOwnerOnly",
    "consentNeverAsked", "consentStale", "consentEnforcedNow", "consentRecordedOnly",
    "c1Title", "c1Body", "c2Title", "c2Body", "c3Title", "c3Body", "c4Title", "c4Body",
    "c5Title", "c5Body", "c6Title", "c6Body", "c7Title", "c7Body",
    "eraseTitle", "eraseWhatGoes", "eraseWhatStays", "eraseIrreversible",
    "eraseUnderstand", "eraseConfirm", "eraseCancel", "erasedBadge", "erasedRosterNote",
  ] as const;

  it.each(KEYS)("%s is translated, not copied", (key) => {
    const entry = STRINGS[key];
    expect(entry.en.length).toBeGreaterThan(0);
    expect(entry.hi.length).toBeGreaterThan(0);
    expect(entry.pa.length).toBeGreaterThan(0);
    // A translation byte-identical to the English is an untranslated string wearing a key.
    expect(entry.hi, `${key} hi`).not.toBe(entry.en);
    expect(entry.pa, `${key} pa`).not.toBe(entry.en);
  });
});
