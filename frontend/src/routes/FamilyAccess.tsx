/**
 * Where the owning caregiver adds and removes family access — D-054.
 *
 * ONLY THE OWNING CAREGIVER REACHES THIS. A caretaker adding another caretaker would void
 * the boundary the moment one account is compromised, and the patient account is the least
 * protected one in the system, so neither may call these routes. The server 403s both; this
 * screen simply does not offer the controls, because a control that always fails is worse
 * than no control.
 *
 * TWO THINGS THIS SCREEN HAS TO SAY OUT LOUD, because getting them wrong is a privacy
 * problem rather than a usability one:
 *
 *   1. Adding a family member grants them the FULL clinical picture. Not a summary — the
 *      same bands, trends and reports the caregiver sees. Somebody clicking "add my brother"
 *      should know that before they click it, not after.
 *   2. Removing access keeps the record. The row is revoked, never deleted, so who could see
 *      this patient and until when stays answerable (INV-8).
 */
import { Trash2, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState, Spinner } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { CaretakerLink, CaretakerRelationship } from "@/lib/types";

const RELATIONSHIPS: CaretakerRelationship[] = [
  "SON", "DAUGHTER", "SPOUSE", "SIBLING", "OTHER",
];

export function FamilyAccess() {
  const { patientId = "" } = useParams();
  const { t } = useI18n();
  const [links, setLinks] = useState<CaretakerLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLinks((await api.listCaretakers(patientId)).caretakers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load family access");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <AppShell>
        <ErrorState message={error} onRetry={load} />
      </AppShell>
    );
  }
  if (!links) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  const active = links.filter((l) => l.active);
  const past = links.filter((l) => !l.active);

  return (
    <AppShell>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">
          <Users className="h-3.5 w-3.5" aria-hidden />
          {t("caregiverEyebrow")}
        </span>}
        title={t("familyAccessTitle")}
        subtitle={t("familyAccessSubtitle")}
      />

      {/* Stated before the form, not after it. */}
      <p className="mb-6 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
        {t("familyAccessWarning")}
      </p>

      {adding ? (
        <AddCaretakerForm
          patientId={patientId}
          onCancel={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      ) : (
        <Button onClick={() => setAdding(true)} className="mb-6">
          <UserPlus className="mr-2 h-4 w-4" aria-hidden />
          {t("familyAdd")}
        </Button>
      )}

      <section aria-labelledby="active-family">
        <h2 id="active-family" className="mb-3 text-title-2 font-medium">
          {t("familyActive")}
        </h2>
        {active.length === 0 ? (
          <EmptyState>{t("familyNone")}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((link) => (
              <CaretakerRow key={link.id} link={link} onChanged={load} />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="past-family" className="mt-8">
          <h2 id="past-family" className="mb-1 text-title-2 font-medium">
            {t("familyPast")}
          </h2>
          {/* The revoked rows are shown rather than hidden: "who could see this, and until
              when" is a question the record has to be able to answer (INV-8). */}
          <p className="mb-3 text-sm text-muted-foreground">{t("familyPastNote")}</p>
          <ul className="flex flex-col gap-2">
            {past.map((link) => (
              <li
                key={link.id}
                className="rounded-lg border border-line bg-surface p-3 text-sm text-muted-foreground"
              >
                {link.full_name ?? t("familyMember")} ·{" "}
                {t(`rel${link.relationship}` as Parameters<typeof t>[0])} ·{" "}
                {t("familyRemovedOn")}{" "}
                {link.unlinked_at ? new Date(link.unlinked_at).toLocaleDateString() : "—"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

function CaretakerRow({ link, onChanged }: { link: CaretakerLink; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    // A reason is required by the API, and it is required for a reason: an access change
    // with no recorded why is not much of a record.
    const reason = window.prompt(t("familyRemoveReason")) ?? "";
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeCaretaker(link.id, reason.trim());
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove access");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{link.full_name ?? t("familyMember")}</p>
          <p className="text-sm text-muted-foreground">
            {t(`rel${link.relationship}` as Parameters<typeof t>[0])} ·{" "}
            {t("familyAddedOn")} {new Date(link.linked_at).toLocaleDateString()}
          </p>
        </div>
        <Button variant="outline" onClick={revoke} disabled={busy}>
          {busy ? <Spinner /> : <Trash2 className="mr-2 h-4 w-4" aria-hidden />}
          {t("familyRemove")}
        </Button>
      </div>
      {error && <FormError>{error}</FormError>}
    </li>
  );
}

function AddCaretakerForm({
  patientId,
  onCancel,
  onAdded,
}: {
  patientId: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData(event.target as HTMLFormElement);
    setBusy(true);
    setError(null);
    try {
      const created = await api.addCaretaker({
        patient_id: patientId,
        email: String(form.get("email") ?? "").trim(),
        full_name: String(form.get("full_name") ?? "").trim(),
        relationship: String(form.get("relationship") ?? "OTHER") as CaretakerRelationship,
      });
      // Say plainly that they cannot sign in yet. Implying an invite went out when none
      // did would be the kind of small dishonesty that makes a family stop trusting the
      // rest of the screen.
      if (!created.login_enabled) setNotice(t("familyInvitePending"));
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add this family member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">{t("familyAdd")}</CardTitle>
        <CardDescription>{t("familyAddHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <Label htmlFor="full_name">{t("familyName")}</Label>
            <Input id="full_name" name="full_name" required maxLength={120} />
          </div>
          <div>
            <Label htmlFor="email">{t("familyEmail")}</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="relationship">{t("familyRelationship")}</Label>
            <Select id="relationship" name="relationship" defaultValue="SON">
              {RELATIONSHIPS.map((rel) => (
                <option key={rel} value={rel}>
                  {t(`rel${rel}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </Select>
          </div>
          {error && <FormError>{error}</FormError>}
          {notice && (
            <p className="rounded-lg border border-line bg-surface p-3 text-sm">{notice}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t("familyAdd")}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
