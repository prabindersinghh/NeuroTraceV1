/**
 * One-tap emergency, reachable from every screen — TRD §8.
 *
 * Two paths, both of which skip the clinical engine entirely:
 *
 *   - the phone number, which dials immediately;
 *   - the symptom report, which records what was seen and returns emergency guidance.
 *
 * The report deliberately does not compute a band, consult a baseline, or wait on the
 * network before showing guidance. Someone reporting sudden one-sided weakness needs an
 * ambulance, not a z-score, and every millisecond spent computing one is stolen from that.
 */
import { AlertTriangle, PhoneCall, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AcuteResponse, AcuteSymptom } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { FastCard } from "./FastCard";

export function EmergencyButton({ patientId }: { patientId?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border-2 border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert focus-ring"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {t("emergency")}
      </button>
      {open && <EmergencySheet patientId={patientId} onClose={() => setOpen(false)} />}
    </>
  );
}

function EmergencySheet({
  patientId,
  onClose,
}: {
  patientId?: string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [symptoms, setSymptoms] = useState<AcuteSymptom[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<AcuteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Unauthenticated endpoint on purpose: emergency guidance must never 401.
    api
      .acuteSymptoms(lang)
      .then((r) => setSymptoms(r.symptoms))
      .catch(() => setSymptoms([]));
  }, [lang]);

  const toggle = useCallback((code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  async function submit() {
    if (!patientId || !selected.size) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.reportAcute(patientId, [...selected], undefined, lang));
    } catch (err) {
      // Even if the report cannot be filed, the guidance must still appear.
      setError(err instanceof Error ? err.message : "Could not send the report");
      const card = await api.fastCard(lang).catch(() => null);
      if (card) {
        setResult({
          escalate: true,
          scoring_bypassed: true,
          reported: [...selected],
          reported_labels: [],
          message: card.limitation_notice,
          fast: card,
          emergency_number: "108",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("emergency")}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-card p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-xl font-semibold text-alert">{t("acuteTitle")}</h2>
          <button type="button" onClick={onClose} aria-label={t("cancel")} className="focus-ring rounded p-1">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* The dial button is first and always present, before any list or form. */}
        <a
          href="tel:108"
          className="mb-5 flex w-full items-center justify-center gap-3 rounded-xl bg-alert px-4 py-4 text-xl font-bold text-white focus-ring"
        >
          <PhoneCall className="h-6 w-6" aria-hidden />
          {t("emergencyCall")}
        </a>

        {result ? (
          <div className="flex flex-col gap-4">
            <p className="rounded-xl bg-alert-soft p-4 text-lg leading-relaxed">{result.message}</p>
            {result.reported_labels.length > 0 && (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {result.reported_labels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
            <FastCard card={result.fast} />
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">{t("acuteHint")}</p>
            <div className="flex flex-col gap-2">
              {symptoms.map((symptom) => (
                <button
                  key={symptom.code}
                  type="button"
                  onClick={() => toggle(symptom.code)}
                  aria-pressed={selected.has(symptom.code)}
                  className={cn(
                    "rounded-xl border-2 px-4 py-3 text-left text-base focus-ring",
                    selected.has(symptom.code)
                      ? "border-alert bg-alert-soft font-semibold text-alert"
                      : "border-border bg-card",
                  )}
                >
                  {symptom.label}
                </button>
              ))}
            </div>

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            <Button
              variant="destructive"
              size="touch"
              className="mt-5"
              disabled={!patientId || !selected.size || busy}
              onClick={submit}
            >
              {t("acuteSubmit")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
