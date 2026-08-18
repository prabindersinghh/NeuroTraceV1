import { ChevronRight, Plus, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState, Spinner } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Patient } from "@/lib/types";
import { cn } from "@/lib/utils";

export function CaregiverHome() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPatients(await api.listPatients());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load patients");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canAdd = user?.role === "caregiver";

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("yourPatients")}</h1>
          {user?.role === "clinician" && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Stethoscope className="h-4 w-4" aria-hidden />
              {t("readOnly")}
            </p>
          )}
        </div>
        {canAdd && !adding && (
          <Button variant="accent" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("addPatient")}
          </Button>
        )}
      </div>

      {adding && (
        <AddPatientForm
          onCancel={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && patients === null && <LoadingState />}
      {!error && patients?.length === 0 && !adding && <EmptyState>{t("noPatients")}</EmptyState>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {patients?.map((p) => (
          <PatientCard key={p.id} patient={p} />
        ))}
      </div>
    </AppShell>
  );
}

function PatientCard({ patient }: { patient: Patient }) {
  const { t } = useI18n();
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="text-lg">{patient.name}</CardTitle>
        <CardDescription>
          {[patient.age ? `${patient.age}` : null, patient.sex, patient.language?.toUpperCase()]
            .filter(Boolean)
            .join(" · ")}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-2">
        {!patient.baseline_ready && (
          <span className="inline-flex w-fit items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {t("buildingBaseline")}
          </span>
        )}
        <Link
          to={`/dashboard/${patient.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        >
          {t("openDashboard")}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
        <Link
          to={`/checkin/${patient.id}`}
          className={cn(buttonVariants({ variant: "accent", size: "sm" }), "w-full")}
        >
          {t("startCheckin")}
        </Link>
      </CardContent>
    </Card>
  );
}

function AddPatientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [language, setLanguage] = useState("en");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createPatient({
        name,
        age: age ? Number(age) : null,
        sex: sex || null,
        language,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the patient");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t("addPatient")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <FormError>{error}</FormError>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-name">{t("patientName")}</Label>
            <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-age">{t("age")}</Label>
            <Input id="p-age" type="number" min={0} max={130} value={age} onChange={(e) => setAge(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-sex">{t("sex")}</Label>
            <Select id="p-sex" value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-lang">{t("language")}</Label>
            <Select id="p-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
            </Select>
          </div>

          <div className="flex gap-3 sm:col-span-2">
            <Button type="submit" variant="accent" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {t("save")}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
