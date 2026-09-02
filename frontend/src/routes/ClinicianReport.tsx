/**
 * Clinician report — `/report/:patientId`. Print to PDF from the browser.
 *
 * WHY NOT A SERVER-GENERATED PDF
 * ------------------------------
 * Rendering the PDF server-side would mean a patient's full history assembled into a
 * binary on a shared host, written to a temp file, and handed back through a download URL —
 * three places for it to linger, on infrastructure we do not control. Rendering in the
 * browser keeps it on the clinician's machine, needs no extra dependency in a container
 * that already carries MediaPipe and ffmpeg, and works offline. `Ctrl/Cmd-P → Save as PDF`
 * produces a real, attachable, selectable-text PDF.
 *
 * What this is not: it is not a template a clinic can restyle without touching code, and it
 * cannot be generated on a schedule without a browser. If either becomes a requirement, the
 * `/report/{id}` endpoint already returns everything needed to render server-side — that is
 * why it returns JSON and not HTML.
 *
 * ONE RULE THIS PAGE ENFORCES
 * ---------------------------
 * Every number is shown with what it was measured against. A band with no baseline state,
 * or a deviation with no method note, is a number a clinician cannot act on and might act
 * on anyway. The method note prints on the page, not in a tooltip.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useI18n, type StringKey } from "@/lib/i18n";
import type { ExamReport } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";

const BAND_LABEL: Record<string, StringKey> = {
  STABLE: "bandStableShort",
  WATCH: "bandWatchShort",
  ALERT: "bandAlertShort",
  PATTERN_ATYPICAL: "bandAtypicalShort",
};

function Gate({ passed, n, label }: { passed: boolean; n: number; label: string }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs",
        passed ? "border-line font-medium" : "border-line text-muted-foreground",
      ].join(" ")}
    >
      <span aria-hidden>{passed ? "●" : "○"}</span>
      G{n} {label}
    </span>
  );
}

export default function ClinicianReport() {
  const { patientId = "" } = useParams();
  const { t, lang, locale, domain: domainLabel } = useI18n();
  const [report, setReport] = useState<ExamReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .examReport(patientId, lang)
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [patientId, lang]);

  if (error) return <ErrorState message={error} />;
  if (!report) return <LoadingState />;

  const { patient, sessions, baselines, method_note } = report;
  const locked = baselines.filter((b) => b.locked).length;

  return (
    <div className="mx-auto max-w-3xl p-6 print:max-w-none print:p-0">
      {/* Hidden when printing — a button in a PDF is noise. */}
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <p className="text-sm text-muted-foreground">{t("reportPrintHint")}</p>
        <Button className="min-h-11" onClick={() => window.print()}>
          {t("reportPrint")}
        </Button>
      </div>

      <header className="border-b border-line pb-4">
        <h1 className="text-title-fluid">{t("reportTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("reportGenerated")
            .replace("{when}", formatDateTime(new Date().toISOString(), locale))
            .replace("{n}", String(sessions.length))}
        </p>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><span className="text-muted-foreground">{t("reportPatient")}</span><br />{patient.name}</div>
        <div><span className="text-muted-foreground">{t("reportAgeSex")}</span><br />{patient.age ?? "—"} / {patient.sex ?? "—"}</div>
        <div><span className="text-muted-foreground">{t("reportSide")}</span><br />{patient.stroke_side}</div>
        <div><span className="text-muted-foreground">{t("reportStrokeDate")}</span><br />{patient.stroke_date ?? "—"}</div>
        <div><span className="text-muted-foreground">{t("reportEnrolled")}</span><br />{patient.enrolment_date}</div>
        <div>
          <span className="text-muted-foreground">{t("reportBaseline")}</span><br />
          {patient.baseline_state}
          {" "}
          {t("reportModulesLocked")
            .replace("{locked}", String(locked))
            .replace("{total}", String(baselines.length))}
        </div>
      </section>

      {/* A report built on an unlocked baseline compares against a moving target. Say so
          at the top, not in a footnote, because it changes how every row below reads. */}
      {patient.baseline_state !== "LOCKED" && (
        <p className="mt-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <strong>{t("reportUnlockedLead")}</strong> {t("reportUnlockedBody")}
        </p>
      )}

      <h2 className="mt-7 border-b border-line pb-1 text-title-2">{t("reportSessionHistory")}</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-3 font-medium">{t("reportColDate")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColBand")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColGates")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColLateralised")}</th>
            <th className="py-2 font-medium">{t("reportColReason")}</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s, i) => (
            <tr key={`${s.date}-${i}`} className="border-b border-line align-top">
              <td className="py-2 pr-3 whitespace-nowrap">{formatDate(s.date, locale)}</td>
              <td className="py-2 pr-3 font-medium">{BAND_LABEL[s.band] ? t(BAND_LABEL[s.band]) : s.band}</td>
              <td className="py-2 pr-3">
                <span className="flex flex-wrap gap-1">
                  <Gate n={1} passed={s.gate1} label={t("gatePersist")} />
                  <Gate n={2} passed={s.gate2} label={t("gateCross")} />
                  <Gate n={3} passed={s.gate3} label={t("gateLateral")} />
                </span>
              </td>
              <td className="py-2 pr-3">
                {/* Domain CODES were printed raw — "cranial_nerves, motor_speech" —
                    in the middle of an otherwise translated table. */}
                {s.lateralised_domains?.length
                  ? s.lateralised_domains.map(domainLabel).join(", ")
                  : "—"}
              </td>
              <td className="py-2">
                {s.reason}
                {s.confounders?.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {t("reportConfounders").replace("{list}", s.confounders.join(", "))}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-7 border-b border-line pb-1 text-title-2">{t("reportBaselines")}</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-3 font-medium">{t("reportColModule")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColLocked")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColSessionsUsed")}</th>
            <th className="py-2 pr-3 font-medium">{t("reportColRejected")}</th>
            <th className="py-2 font-medium">{t("reportColWindow")}</th>
          </tr>
        </thead>
        <tbody>
          {baselines.map((b) => (
            <tr key={b.module_code} className="border-b border-line">
              <td className="py-2 pr-3">{b.module_code}</td>
              <td className="py-2 pr-3">{b.locked ? t("reportYes") : t("reportNo")}</td>
              <td className="py-2 pr-3">{b.n_sessions}</td>
              {/* Rejected captures are shown because a baseline built from 12 sessions
                  with 20 rejections is a different object from one with none. */}
              <td className="py-2 pr-3">{b.n_rejected}</td>
              <td className="py-2">
                {b.window_start?.slice(0, 10) ?? "—"} → {b.window_end?.slice(0, 10) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-7 border-b border-line pb-1 text-title-2">{t("reportMethod")}</h2>
      <p className="mt-2 text-sm leading-relaxed">{method_note}</p>

      <p className="mt-6 border-t border-line pt-3 text-xs text-muted-foreground">
        {t("reportLimitation")}
      </p>
    </div>
  );
}
