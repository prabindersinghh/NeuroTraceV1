/**
 * The operator console — `/admin`. Role `admin` only.
 *
 * WHAT IS DELIBERATELY ABSENT: patients. There is no roster here, no names, no session
 * detail, no search box. An admin panel is the obvious place for "just let me look at the
 * data" to creep in, and in this product that would be a backdoor around INV-11 with a
 * friendlier name. Every number on this page is a count; the audit trail shows actions and
 * a truncated reference, never whose record it was. If someone needs to see one patient's
 * clinical data, that is a clinician's job through the clinician's authorisation path,
 * where it is logged as such.
 *
 * What an operator actually needs is here instead: is the system being used, is the engine
 * behaving, is the identity check firing too often, and what happened recently.
 */
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Metric } from "@/components/ui/metric";
import { PageHeader } from "@/components/ui/page";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils";

interface Overview {
  generated_at: string;
  users: { total: number; by_role: Record<string, number> };
  patients: { total: number; onboarding_complete: number };
  sessions: {
    total: number; last_7_days: number; practice: number;
    by_band: Record<string, number>;
  };
  modules: { total: number; quality_flagged: number };
  baselines: { by_state: Record<string, number> };
  gates: {
    scored: number; gate1_persistence: number;
    gate2_cross_modality: number; gate3_laterality: number;
  };
  models: { all_synthetic: boolean; note: string };
}

interface IdentityHealth {
  sessions_flagged: number; sessions_scored: number;
  patients_enrolled: number; note: string;
}

interface AuditEntry { ts: string; action: string; actor_id: string | null; patient_ref: string | null }

/** Thin wrapper over the shared Metric. This page had its own hand-rolled stat card with
 *  a different number size and label treatment from every other dashboard in the app. */
function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return <Metric label={label} value={value} context={hint} />;
}

function Distribution({ title, data }: { title: string; data: Record<string, number> }) {
  const { t } = useI18n();
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const total = entries.reduce((n, [, v]) => n + v, 0) || 1;
  return (
    <div className="rounded-2xl border border-line p-5">
      <p className="text-label text-muted-foreground">{title}</p>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("nothingYet")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 truncate">{k}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </span>
              <span className="w-10 text-right tabular-nums">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Admin() {
  const { t, locale } = useI18n();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [identity, setIdentity] = useState<IdentityHealth | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, i, a] = await Promise.all([
        api.adminOverview(), api.adminIdentity(), api.adminAudit(50),
      ]);
      setOverview(o as Overview);
      setIdentity(i as IdentityHealth);
      setAudit((a as { entries: AuditEntry[] }).entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <AppShell><ErrorState message={error} onRetry={load} /></AppShell>;
  if (!overview) return <AppShell><LoadingState /></AppShell>;

  const g = overview.gates;
  const pct = (n: number) => (g.scored ? `${Math.round((n / g.scored) * 100)}%` : "—");

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          className="mb-0"
          eyebrow="System"
          title="Operations"
          subtitle="Counts, system health and the audit trail. No patient records appear on
                    this page by design — reading one patient's data is a clinician's path,
                    not an operator's."
        />

        {/* The honesty banner. An operator asking "can I trust these numbers" gets the
            answer before the numbers, not in a footnote. */}
        <p className="rounded-2xl border-2 border-watch/40 bg-watch-soft p-4 text-sm">
          {overview.models.note}
        </p>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("adminPatients")} value={overview.patients.total}
                hint={t("adminFinishedSetup")
                  .replace("{n}", String(overview.patients.onboarding_complete))} />
          <Stat label={t("adminUsers")} value={overview.users.total} />
          <Stat label={t("adminSessions")} value={overview.sessions.total}
                hint={t("adminLast7").replace("{n}", String(overview.sessions.last_7_days))} />
          <Stat label={t("adminModules")} value={overview.modules.total}
                hint={t("adminQualityFlagged")
                  .replace("{n}", String(overview.modules.quality_flagged))} />
        </section>

        {/* The gate funnel — the one view that says whether the engine is behaving. */}
        <section className="rounded-2xl border border-line p-5">
          <p className="text-label text-muted-foreground">
            Gate funnel · all three must pass for an ALERT
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-4">
            {[
              [t("adminScored"), g.scored, ""],
              [t("adminGate1"), g.gate1_persistence, pct(g.gate1_persistence)],
              [t("adminGate2"), g.gate2_cross_modality, pct(g.gate2_cross_modality)],
              [t("adminGate3"), g.gate3_laterality, pct(g.gate3_laterality)],
            ].map(([label, value, share]) => (
              <div key={String(label)}>
                <p className="text-label text-muted-foreground">{label}</p>
                <p className="mt-1.5 text-metric text-foreground">{value}</p>
                {share ? <p className="mt-1 text-sm text-muted-foreground">{share} {t("adminOfScored")}</p> : null}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Distribution title={t("adminBands")} data={overview.sessions.by_band} />
          <Distribution title={t("adminBaselines")} data={overview.baselines.by_state} />
          <Distribution title={t("adminUsersByRole")} data={overview.users.by_role} />
        </section>

        {identity && (
          <section className="rounded-2xl border border-line p-5">
            <p className="text-label text-muted-foreground">{t("adminSamePerson")}</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-metric text-foreground">{identity.patients_enrolled}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("adminPatientsEnrolled")}</p>
              </div>
              <div>
                <p className="text-metric text-foreground">{identity.sessions_scored}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("adminSessionsChecked")}</p>
              </div>
              <div>
                <p className="text-metric text-foreground">{identity.sessions_flagged}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("adminFlagged")}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{identity.note}</p>
          </section>
        )}

        <section className="rounded-2xl border border-line p-5">
          <p className="text-label text-muted-foreground">{t("adminAudit")}</p>
          {!audit?.length ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("adminNothingRecorded")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {audit.map((e, i) => (
                <li key={`${e.ts}-${i}`} className="flex items-center gap-4 py-2">
                  <span className="w-44 shrink-0 font-mono text-xs text-muted-foreground">
                    {formatDateTime(e.ts, locale)}
                  </span>
                  <span className="flex-1 truncate">{e.action}</span>
                  {e.patient_ref && (
                    <span className="font-mono text-xs text-muted-foreground">
                      ref {e.patient_ref}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
