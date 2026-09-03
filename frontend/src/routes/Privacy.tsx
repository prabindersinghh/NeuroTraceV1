/**
 * Consent and erasure — Part 4 and Part 5.4, and the surface both of them were missing.
 *
 * The backend has had seven independently withdrawable consents and a real erasure since
 * Part 4/5. Nothing in the app read `GET /consents/{id}`, called `PUT /consents/{id}/{type}`,
 * or called `DELETE /patients/{id}`. Consents were only ever WRITTEN — by enrolment and by
 * `POST /clinician/links` — so a caregiver could grant C3 by adding a doctor and then had
 * no way to see it, let alone take it back. A right that cannot be exercised is not a right.
 *
 * ONLY THE OWNING CAREGIVER REACHES THIS, and the server enforces it on both routes
 * (`_require_owning_caregiver`, and `patient.caregiver_id != user.id` on the delete). The
 * same reasoning as `FamilyAccess`: a clinician has an interest in C3 being granted, and
 * the patient account is the least protected one in the system.
 *
 * THREE THINGS THIS SCREEN MUST NOT GET WRONG
 *
 *  1. **It must not claim enforcement it does not have.** C3 and C7 really do gate access —
 *     `consent_currently_granted` is read by `clinician_may_access_patient` and
 *     `caretaker_may_access_patient` on every scoped route, so a withdrawal bites
 *     immediately and independently of whether the link row is still active. The other five
 *     are recorded decisions with no runtime gate behind them. Saying "turning this off
 *     stops it" under C2 would be a lie, so those rows say what is actually true and point
 *     at erasure, which is the control that really removes data.
 *  2. **Never asked is not consent.** `consent_currently_granted` returns false for a
 *     missing row, and this screen says so in words rather than showing an unchecked box
 *     that could read as "off by default, probably fine".
 *  3. **`stale` is a prompt, not a gate.** `services/consent.py` is explicit that a
 *     caregiver who agreed to yesterday's wording is still validly consented. It is
 *     surfaced as "please read it again", never as a loss of permission.
 *
 * WHY THE ERASURE CONFIRMATION IS TWO DELIBERATE ACTS AND NOT A TYPED NAME. The usual
 * "type the patient's name to confirm" is hostile here: names in this cohort are in
 * Devanagari or Gurmukhi, the phone keyboard is frequently set to English, and the person
 * confirming is 55-75. That gesture would block the legitimate case far more often than the
 * accidental one. A required free-text reason plus an explicit acknowledgement checkbox is
 * two considered actions with no script trap, and the reason is independently useful — it
 * is stored on the tombstone and in the audit row.
 */
import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormError, Label } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { ErrorState, LoadingState, Spinner } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n, type StringKey } from "@/lib/i18n";
import type { ConsentStatus, ConsentType, Patient } from "@/lib/types";
import { formatDateTime, usableLocale } from "@/lib/utils";

/** In `models.py:ConsentType` order. Seven, not six — C7 arrived with the caretaker work
 *  and the docstrings around it were never updated. */
const CONSENTS: { type: ConsentType; title: StringKey; body: StringKey }[] = [
  { type: "FOLLOW_UP", title: "c1Title", body: "c1Body" },
  { type: "DATA_PROCESSING", title: "c2Title", body: "c2Body" },
  { type: "CLINICIAN_SHARING", title: "c3Title", body: "c3Body" },
  { type: "RESEARCH", title: "c4Title", body: "c4Body" },
  { type: "MEDIA_TESTIMONIAL", title: "c5Title", body: "c5Body" },
  { type: "TELECONSULTATION", title: "c6Title", body: "c6Body" },
  { type: "CARETAKER_SHARING", title: "c7Title", body: "c7Body" },
];

/** The two with a runtime gate behind them. Everything else is a recorded decision, and
 *  this screen must not imply otherwise — see the header note. */
const ENFORCED: ReadonlySet<ConsentType> = new Set(["CLINICIAN_SHARING", "CARETAKER_SHARING"]);

export function Privacy() {
  const { patientId = "" } = useParams();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const locale = usableLocale(lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [consents, setConsents] = useState<ConsentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<ConsentType | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [eraseOpen, setEraseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, c] = await Promise.all([api.getPatient(patientId), api.consents(patientId)]);
      setPatient(p);
      setConsents(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load consent settings");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (type: ConsentType, granted: boolean) => {
    setSaving(type);
    setSaveError(null);
    try {
      // The PUT returns the FULL status, so the screen re-renders from the server's answer
      // rather than from an optimistic guess. On a consent screen the difference matters:
      // a toggle that looks off while the row still says granted is the worst possible lie
      // this page could tell.
      setConsents(await api.setConsent(patientId, type, { granted }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t("consentSaveFailed"));
      // Re-read rather than leave the checkbox showing what the user wanted. `set_consent`
      // treats a redundant toggle as a no-op, so this is always safe to call.
      await load();
    } finally {
      setSaving(null);
    }
  };

  const erase = async () => {
    setErasing(true);
    setEraseError(null);
    try {
      await api.erasePatient(patientId, reason.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setEraseError(err instanceof Error ? err.message : "Could not remove the data");
      setErasing(false);
    }
  };

  if (error) {
    return (
      <AppShell>
        <ErrorState message={error} onRetry={load} />
      </AppShell>
    );
  }
  if (!patient || !consents) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  // Already a tombstone: there is nothing left to consent about and nothing left to remove.
  const erased = patient.erased_at !== null;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader
          eyebrow={t("privacyEyebrow")}
          title={t("privacyTitle")}
          subtitle={erased ? t("erasedBadge") : patient.name}
        />

        {erased ? (
          <Card>
            <CardContent className="p-5">
              <p className="font-medium">{t("erasedBadge")}</p>
              <p className="mt-1 text-muted-foreground">
                {t("erasedRosterNote").replace("{d}", formatDateTime(patient.erased_at!, locale))}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="max-w-prose leading-relaxed">{t("privacyIntro")}</p>
            <p className="mt-2 max-w-prose text-muted-foreground">{t("privacyOwnerOnly")}</p>

            <FormError>{saveError}</FormError>

            <div className="mt-6 flex flex-col gap-3">
              {CONSENTS.map(({ type, title, body }) => {
                const state = consents[type];
                // A type the server added that this build does not know about yet. Skip it
                // rather than crash — but never render it as "off", which would misreport
                // a consent that may well be granted.
                if (!state) return null;
                const busy = saving === type;
                return (
                  <Card key={type}>
                    <CardContent className="p-5">
                      <label className="flex items-start gap-4">
                        <input
                          type="checkbox"
                          className="mt-1 h-6 w-6 shrink-0"
                          checked={state.granted}
                          disabled={busy}
                          onChange={(e) => void toggle(type, e.target.checked)}
                        />
                        <span className="flex-1">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="text-title-3">{t(title)}</span>
                            {busy && <Spinner className="h-4 w-4" />}
                          </span>
                          <span className="mt-1.5 block max-w-prose leading-relaxed text-muted-foreground">
                            {t(body)}
                          </span>
                        </span>
                      </label>

                      <div className="mt-3 ps-10 text-sm">
                        {/* What is true right now, in dates rather than adjectives. */}
                        {state.granted && state.granted_at ? (
                          <p className="tabular-nums text-muted-foreground">
                            {t("consentGrantedOn").replace(
                              "{d}", formatDateTime(state.granted_at, locale))}
                          </p>
                        ) : state.withdrawn_at ? (
                          <p className="tabular-nums text-muted-foreground">
                            {t("consentWithdrawnOn").replace(
                              "{d}", formatDateTime(state.withdrawn_at, locale))}
                          </p>
                        ) : (
                          // No row at all. Deliberately spelled out: an unchecked box on its
                          // own could read as a default someone chose.
                          <p className="text-muted-foreground">{t("consentNeverAsked")}</p>
                        )}

                        {state.stale && (
                          <p className="mt-1 font-medium text-watch">{t("consentStale")}</p>
                        )}

                        {/* The honesty line. Only C3 and C7 have a gate behind them. */}
                        {state.granted && (
                          <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            {ENFORCED.has(type)
                              ? t("consentEnforcedNow")
                              : t("consentRecordedOnly")}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* --- erasure ------------------------------------------------------------ */}
            <section className="mt-10" aria-labelledby="erase-h">
              <Card className="border-2 border-destructive/40">
                <CardContent className="p-5">
                  <h2 id="erase-h" className="flex items-center gap-2 text-title-3">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
                    {t("eraseTitle")}
                  </h2>

                  {/* Both halves, always — before the button, not behind it. What survives
                      an erasure is the part people are most surprised by, and the reason it
                      survives is what makes the erasure itself accountable. */}
                  <p className="mt-3 max-w-prose leading-relaxed">{t("eraseWhatGoes")}</p>
                  <p className="mt-2 max-w-prose leading-relaxed text-muted-foreground">
                    {t("eraseWhatStays")}
                  </p>
                  <p className="mt-2 max-w-prose font-medium">{t("eraseIrreversible")}</p>

                  {!eraseOpen ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4"
                      onClick={() => setEraseOpen(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                      {t("eraseOpen")}
                    </Button>
                  ) : (
                    <div className="mt-5 border-t border-border pt-5">
                      <Label htmlFor="erase-reason">{t("eraseReasonLabel")}</Label>
                      <textarea
                        id="erase-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        maxLength={200}
                        rows={2}
                        className="mt-1.5 w-full rounded-xl border border-input bg-card p-3 text-[0.95rem] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />

                      <label className="mt-4 flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-6 w-6 shrink-0"
                          checked={understood}
                          onChange={(e) => setUnderstood(e.target.checked)}
                        />
                        <span className="font-medium">{t("eraseUnderstand")}</span>
                      </label>

                      <FormError>{eraseError}</FormError>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={erasing || !understood || !reason.trim()}
                          onClick={() => void erase()}
                        >
                          {erasing && <Spinner className="mr-2 h-4 w-4" />}
                          {t("eraseConfirm")}
                        </Button>
                        {/* The way out is a real button beside the destructive one, not a
                            corner X — the person who opened this by accident is the one
                            least likely to find a subtle escape. */}
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={erasing}
                          onClick={() => {
                            setEraseOpen(false);
                            setUnderstood(false);
                            setReason("");
                            setEraseError(null);
                          }}
                        >
                          {t("eraseCancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
