/**
 * The caregiver's patient list and enrolment form.
 *
 * The enrolment form asks for the stroke date because the server refuses to enrol anyone
 * less than three months post-discharge (PRD §3). That is not paperwork: this system
 * reasons over days, an acute stroke evolves in seconds, and enrolling an acute patient
 * would put them in a product that structurally cannot watch for what threatens them.
 * The form says so plainly rather than letting the server reject it silently.
 */
import { ChevronRight, Plus, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { EmergencyButton } from "@/components/EmergencyButton";
import { WeekStrip } from "@/components/WeekStrip";
import { Tour } from "@/components/Tour";
import { PageHeader } from "@/components/ui/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/field";
import { Metric } from "@/components/ui/metric";
import { EmptyState, ErrorState, LoadingState, Spinner } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { ExamSession, Lang, Patient } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

export function CaregiverHome() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [history, setHistory] = useState<Record<string, ExamSession[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPatients(await api.listPatients());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errLoadPatients"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Check-in history per patient, fetched after the roster and deliberately NON-FATAL:
   * the list of people you look after is the page, and a failed history request should
   * cost a "last check-in" line, not the roster. `/sessions/{id}/history` carries no
   * band or score — see the endpoint's own comment — so nothing clinical is being
   * fetched here, only whether the check-ins happened.
   */
  useEffect(() => {
    if (!patients?.length) return;
    let cancelled = false;
    void Promise.all(
      patients.map(async (p) => {
        try {
          return [p.id, await api.sessionHistory(p.id, 30)] as const;
        } catch {
          return [p.id, [] as ExamSession[]] as const;
        }
      }),
    ).then((pairs) => {
      if (!cancelled) setHistory(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [patients]);

  /** The roster's shape before the roster — DESIGN_LANGUAGE §1.4. Adherence only. */
  const summary = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const thisWeek = Object.values(history)
      .flat()
      .filter((s) => s.completed && new Date(s.ts).getTime() >= weekAgo).length;
    return {
      thisWeek,
      setupPending: (patients ?? []).filter((p) => !p.onboarding_complete).length,
    };
  }, [history, patients]);

  const canAdd = user?.role === "caregiver";

  return (
    <AppShell>
      <PageHeader
        eyebrow={t("caregiverEyebrow")}
        title={t("yourPatients")}
        subtitle={user?.role === "clinician" ? t("readOnly") : undefined}
        actions={<>
          <EmergencyButton patientId={patients?.[0]?.id} />
          {canAdd && !adding && (
            <Button data-tour="add-patient" variant="accent" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("addPatient")}
            </Button>
          )}
        </>}
      />

      {adding && (
        <AddPatientForm
          onCancel={() => setAdding(false)}
          onCreated={(patientId) => {
            setAdding(false);
            void load();
            // Straight into onboarding. Step 3 — "this cannot detect a stroke happening
            // now, call 108" — is a safety control, and it was unreachable: nothing in the
            // app ever navigated into this flow, so a family could start measuring having
            // never been told what the product cannot do.
            if (patientId) navigate(`/onboarding/${patientId}`);
          }}
        />
      )}

      {error && <ErrorState message={error} onRetry={load} />}
      {!error && patients === null && <LoadingState />}
      {!error && patients?.length === 0 && !adding && <EmptyState>{t("noPatients")}</EmptyState>}

      {!!patients?.length && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Metric label={t("yourPatients")} value={patients.length}
                  context={t("carePeopleContext")} />
          <Metric label={t("careWeekLabel")} value={summary.thisWeek}
                  context={t("careWeekContext")} />
          <Metric
            label={t("careSetupLabel")}
            value={summary.setupPending}
            // Watch only when something is actually waiting. A permanent amber zero is
            // the kind of decoration that teaches people to stop reading the colour.
            tone={summary.setupPending > 0 ? "watch" : "neutral"}
            context={t("careSetupContext")}
          />
        </div>
      )}

      <div data-tour="patient-list" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {patients?.map((patient) => (
          <PatientCard key={patient.id} patient={patient} sessions={history[patient.id] ?? []} />
        ))}
      </div>
      <Tour role="caregiver" />
    </AppShell>
  );
}

function PatientCard({ patient, sessions }: { patient: Patient; sessions: ExamSession[] }) {
  const { t, lang } = useI18n();
  const locale = lang === "hi" ? "hi-IN" : lang === "pa" ? "pa-IN" : "en-IN";
  const last = sessions.find((s) => s.completed);
  // Setup first, then the daily job. Exactly ONE action carries the accent at a time:
  // before this the card offered "Finish setup" AND "Start check-in" both in accent, so
  // the screen shouted two different next steps at a caregiver who wanted one.
  const setupPending = !patient.onboarding_complete;
  const learning = patient.baseline_state !== "LOCKED";
  // Part 5.4 tombstone: every measurement is gone and every identifying field is cleared.
  // Nothing on this card would work against it — the dashboard has no data, the exam has
  // no baseline to build, and a second erasure 409s — so the card becomes a record of what
  // happened rather than a set of dead controls.
  const erased = patient.erased_at !== null;

  return (
    <Card
      className="chip-edge flex flex-col"
      style={{
        ["--chip-edge-color" as string]:
          erased ? "hsl(var(--border))"
          : setupPending || learning ? "hsl(var(--watch))" : "hsl(var(--stable))",
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* `name` is "" after an erasure — the row survives so `audit_log.patient_id`
                keeps its foreign key (Part 5.4). Without this branch the card rendered as
                a permanently blank, broken-looking entry with no explanation. */}
            <CardTitle className="text-title-3">
              {erased ? t("erasedBadge") : patient.name}
            </CardTitle>
            <CardDescription>
              {[
                patient.age ? `${patient.age}` : null,
                patient.sex,
                patient.languages?.[0]?.toUpperCase(),
              ]
                .filter(Boolean)
                .join(" · ")}
            </CardDescription>
          </div>
          {/* The state belongs beside the name, where the eye already is — not stranded
              between two buttons further down, which is where it used to sit. */}
          {learning && !erased && (
            <span className="shrink-0 rounded-full bg-watch-soft px-2.5 py-1 text-sm font-medium text-watch">
              {t("buildingBaseline")}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="mt-auto flex flex-col gap-2">
        {erased ? (
          <p className="text-sm text-muted-foreground">
            {t("erasedRosterNote").replace("{d}", formatDateTime(patient.erased_at!, locale))}
          </p>
        ) : (
        <>
        {/* How the week has gone, above the actions — the question a caregiver opens
            this screen with, answered before they have to click into anything. */}
        <div className="mb-1">
          <WeekStrip sessions={sessions} />
          <p className="mt-2 text-sm text-muted-foreground">
            {last
              ? t("lastCheckin").replace("{when}", formatDateTime(last.ts, locale))
              : t("noCheckinsYet")}
          </p>
        </div>

        {setupPending ? (
          <Link
            to={`/onboarding/${patient.id}`}
            className={cn(buttonVariants({ variant: "accent", size: "sm" }), "w-full")}
          >
            {t("finishSetup")}
          </Link>
        ) : (
          <Link
            to={`/exam/${patient.id}`}
            className={cn(buttonVariants({ variant: "accent", size: "sm" }), "w-full")}
          >
            {t("startCheckin")}
          </Link>
        )}

        <div className="flex gap-2">
          <Link
            to={`/dashboard/${patient.id}`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
          >
            {t("openDashboard")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          {/* Still offered while setup is pending — a check-in is not blocked by it, and
              hiding it would imply otherwise. */}
          {setupPending && (
            <Link
              to={`/exam/${patient.id}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
            >
              {t("startCheckin")}
            </Link>
          )}
        </div>

        {/* Family access lives on the patient card because it is a per-patient decision,
            not an account-wide one: a caregiver managing two parents shares each of them
            with a different set of relatives. Owning-caregiver only (D-054) — the server
            403s anyone else, and this surface is simply not offered to them. */}
        <Link
          to={`/family/${patient.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
        >
          <Users className="mr-1 h-4 w-4" aria-hidden />
          {t("familyAccessTitle")}
        </Link>

        {/* Consent and erasure, per patient for the same reason family access is: a
            caregiver looking after two parents makes these decisions separately for each.
            Owning-caregiver only, enforced on every route behind it. */}
        <Link
          to={`/privacy/${patient.id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
        >
          <ShieldCheck className="mr-1 h-4 w-4" aria-hidden />
          {t("privacyOpen")}
        </Link>
        </>
        )}
      </CardContent>
    </Card>
  );
}

function AddPatientForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (patientId?: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [sex, setSex] = useState("");
  const [strokeDate, setStrokeDate] = useState("");
  const [strokeSide, setStrokeSide] = useState("unknown");
  const [language, setLanguage] = useState<Lang>("en");
  const [hour, setHour] = useState("9");
  // PRD §3 exclusion. Asked at enrolment because the answer decides eligibility, and
  // because a caregiver who finds out later has already been given readings we cannot
  // stand behind.
  const [movementDisorder, setMovementDisorder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The server enforces this; showing it in the picker avoids a rejected submission.
  const latestAllowed = new Date(Date.now() - 90 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await api.createPatient({
        name,
        stroke_date: new Date(strokeDate).toISOString(),
        age: age ? Number(age) : null,
        sex: sex || null,
        stroke_side: strokeSide,
        languages: [language, "en"].filter((v, i, a) => a.indexOf(v) === i),
        preferred_hour: hour ? Number(hour) : null,
        other_movement_disorder: movementDisorder,
      });
      onCreated(created?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errEnrolPatient"));
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
          <div className="sm:col-span-2">
            <FormError>{error}</FormError>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="p-name">{t("patientName")}</Label>
            <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* The scope limit, stated before enrolment rather than discovered after it. */}
          <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3
                          dark:border-amber-800 dark:bg-amber-950/40">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={movementDisorder}
                onChange={(e) => setMovementDisorder(e.target.checked)}
              />
              <span>
                <span className="font-medium">{t("movementDisorderQ")}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("movementDisorderWhy")}
                </span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-age">{t("age")}</Label>
            <Input
              id="p-age"
              type="number"
              min={0}
              max={130}
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-stroke">{t("strokeDate")}</Label>
            <Input
              id="p-stroke"
              type="date"
              required
              max={latestAllowed}
              value={strokeDate}
              onChange={(e) => setStrokeDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("strokeDateHint")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-side">{t("affectedSide")}</Label>
            <Select id="p-side" value={strokeSide} onChange={(e) => setStrokeSide(e.target.value)}>
              <option value="left">{t("sideLeft")}</option>
              <option value="right">{t("sideRight")}</option>
              <option value="unknown">{t("sideUnknown")}</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-lang">{t("language")}</Label>
            <Select
              id="p-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as Lang)}
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
              <option value="pa">ਪੰਜਾਬੀ</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-hour">{t("usualTime")}</Label>
            <Select id="p-hour" value={hour} onChange={(e) => setHour(e.target.value)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {`${String(h).padStart(2, "0")}:00`}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">{t("usualTimeHint")}</p>
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
