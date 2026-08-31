/**
 * What a family caretaker sees when they sign in — D-054.
 *
 * A caretaker is family ADDITIONAL to the caregiver who enrolled the patient: a second
 * sibling, a relative abroad. The rule this screen exists to express is that family see
 * EVERYTHING clinical about their own patient and nothing at all about anyone else's.
 *
 * WHY THIS IS NOT `CaregiverHome`. Before this file, `Home()` fell through to the caregiver
 * screen for any role it did not recognise, which would have shown a caretaker an "add a
 * patient" form and an enrolment flow they get a 403 from. Offering a control that cannot
 * work is worse than not offering it — it reads as a broken product rather than a boundary.
 *
 * The list is whatever `GET /patients` returns, which for this role is already scoped to
 * active links with C7 consent in force. The UI does no filtering of its own: hiding a row
 * would be presentation, and the boundary is the server's (INV-6).
 */
import { ChevronRight, HeartPulse, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { EmergencyButton } from "@/components/EmergencyButton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Patient } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CaretakerHome() {
  const { t } = useI18n();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPatients(await api.listPatients());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your family member");
    }
  }, []);

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
  if (!patients) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-title-2">
            <Users className="h-6 w-6 text-accent" aria-hidden />
            {t("familyTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("familySubtitle")}</p>
        </div>
        {/* Emergency stays reachable from every signed-in surface, family included — one of
            the three safety guarantees, and the person in the house is often the one who
            needs it. */}
        {patients[0] && <EmergencyButton patientId={patients[0].id} />}
      </div>

      {patients.length === 0 ? (
        <EmptyState>{t("familyNoPatients")}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {patients.map((patient) => (
            <Card key={patient.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <HeartPulse className="h-5 w-5 text-accent" aria-hidden />
                  {patient.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {[patient.age ? `${patient.age}` : null, patient.sex]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {/* Everything a caregiver can read, family can read. The dashboard is the
                    whole clinical picture: band, what changed, trends, confounders. */}
                <Link
                  to={`/dashboard/${patient.id}`}
                  className={cn(buttonVariants({ variant: "accent" }), "w-full")}
                >
                  {t("familyOpenStatus")}
                  <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
                <Link
                  to={`/report/${patient.id}`}
                  className={cn(buttonVariants({ variant: "outline" }), "w-full")}
                >
                  {t("familyOpenReport")}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Says plainly what family cannot do, so a missing button reads as a deliberate
          boundary rather than something broken. */}
      <p className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm text-muted-foreground">
        {t("familyScopeNote")}
      </p>
    </AppShell>
  );
}
