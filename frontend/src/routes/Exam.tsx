/**
 * The daily exam — the ~90 second battery.
 *
 * Three properties this component is built around, all of them non-negotiable:
 *
 * 1. **The patient never sees a score, a band, or the word "risk".** The session ends with
 *    "All done", full stop. Showing a worried 68-year-old a red number every morning is how
 *    you lose adherence, and a battery nobody completes detects nothing. The verdict goes
 *    to the caregiver dashboard.
 *
 * 2. **It completes offline.** Extraction already runs on-device, so the only thing the
 *    network is needed for is sync. If a request fails, the features are queued in
 *    IndexedDB and the session still finishes normally. This is the airplane-mode moment
 *    in the demo.
 *
 * 3. **Every step is skippable and a poor capture is re-prompted, never scored.** A dead
 *    webcam must not cost us the voice and tap data, and a bad recording entering the
 *    baseline is worse than a missing one — it widens the band and blinds the system.
 */
import { CheckCircle2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { EmergencyButton } from "@/components/EmergencyButton";
import { FastCard } from "@/components/FastCard";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n, type StringKey } from "@/lib/i18n";
import {
  enqueueSession,
  isOnline,
  newLocalId,
  type QueuedModule,
} from "@/lib/offline";
import { warmUpVoices } from "@/lib/speech-synthesis";
import type { FastCard as FastCardData, ModuleFeatures, Patient } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StepAttention } from "./exam/StepAttention";
import { StepFace } from "./exam/StepFace";
import { StepQuestions, type QuestionsResult } from "./exam/StepQuestions";
import { StepSpeech } from "./exam/StepSpeech";
import { StepTapping } from "./exam/StepTapping";

const QUALITY_MESSAGE: Record<string, StringKey> = {
  too_noisy: "qualityTooNoisy",
  no_speech_detected: "qualityNoSpeech",
  too_loud: "qualityTooLoud",
  face_not_detected: "qualityNoFace",
  face_kept_leaving_frame: "qualityNoFace",
};

type StepId = "face" | "speech" | "tapping" | "attention" | "questions";
const ORDER: StepId[] = ["face", "speech", "tapping", "attention", "questions"];

export function Exam() {
  const { patientId = "" } = useParams();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [fast, setFast] = useState<FastCardData | null>(null);

  const modules = useMemo(() => new Map<string, QueuedModule>(), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPatient(await api.getPatient(patientId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load the patient");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
    void warmUpVoices();
    // Fetch the FAST card up front so the completion screen renders it even offline.
    api.fastCard(lang).then(setFast).catch(() => undefined);
  }, [load, lang]);

  const record = useCallback(
    (code: string, features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => {
      modules.set(code, {
        code,
        features,
        quality_flag: quality.ok,
        quality_detail: quality.reason ? { reason: quality.reason } : undefined,
      });
    },
    [modules],
  );

  const advance = useCallback(() => {
    setRetryNotice(null);
    setStepIndex((i) => i + 1);
  }, []);

  /**
   * A failed quality check re-prompts once, then accepts the capture with the flag set.
   * Looping forever would strand a patient whose room is simply noisy; the flag means the
   * capture is stored, kept out of the baseline, and annotated as a confounder.
   */
  const [retried, setRetried] = useState<Set<StepId>>(new Set());

  const handleStep = useCallback(
    (step: StepId, code: string) =>
      (features: ModuleFeatures, quality: { ok: boolean; reason?: string }) => {
        if (!quality.ok && quality.reason && !retried.has(step)) {
          setRetried((prev) => new Set(prev).add(step));
          const key = QUALITY_MESSAGE[quality.reason];
          setRetryNotice(key ? t(key) : t("retake"));
          return; // stay on this step
        }
        record(code, features, quality);
        advance();
      },
    [advance, record, retried, t],
  );

  const submit = useCallback(
    async (result: QuestionsResult) => {
      setBusy(true);
      setStepError(null);

      const collected = [...modules.values()];
      const deviceInfo = {
        userAgent: navigator.userAgent,
        language: lang,
        online: isOnline(),
      };

      try {
        if (!isOnline()) throw new Error("offline");

        const session = await api.startSession(patientId, { type: "daily" });
        for (const module of collected) {
          await api.submitModule(session.id, module.code, module.features, {
            quality_flag: module.quality_flag,
            quality_detail: module.quality_detail,
          });
        }
        await api.submitQuestionnaire(patientId, "PHQ2", result.phq2, session.id);
        await api.submitAdherence(patientId, result.medicationTaken);

        const finalized = await api.finalizeSession(session.id);
        // The band is deliberately discarded here. The patient does not see it.
        if (finalized.fast) setFast(finalized.fast);
      } catch {
        // Offline, or the server is unreachable. The exam still succeeded — the numbers
        // are already extracted, so queue them and finish normally.
        await enqueueSession({
          localId: newLocalId(),
          patientId,
          type: "daily",
          capturedAt: new Date().toISOString(),
          deviceInfo,
          modules: collected,
          attempts: 0,
        });
        setQueuedOffline(true);
      } finally {
        setBusy(false);
        setFinished(true);
      }
    },
    [lang, modules, patientId],
  );

  if (loadError) {
    return (
      <ExamFrame patientId={patientId}>
        <ErrorState message={loadError} onRetry={load} />
      </ExamFrame>
    );
  }
  if (!patient) {
    return (
      <ExamFrame patientId={patientId}>
        <LoadingState />
      </ExamFrame>
    );
  }

  if (finished) {
    return (
      <ExamFrame patientId={patientId}>
        <div className="flex flex-col items-center gap-6 py-8 text-center">
          <CheckCircle2 className="h-24 w-24 text-stable" aria-hidden />
          <h2 className="text-4xl font-semibold">{t("allDone")}</h2>
          <p className="max-w-sm text-xl text-muted-foreground">{t("allDoneBody")}</p>

          {queuedOffline && (
            <p className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <WifiOff className="h-4 w-4" aria-hidden />
              {t("offline")}
            </p>
          )}

          <p className="text-xs text-muted-foreground">{t("onDevice")}</p>

          {fast && <FastCard card={fast} className="mt-2 text-left" />}

          <Button
            size="touch"
            className="max-w-sm"
            onClick={() =>
              navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true })
            }
          >
            {t("finish")}
          </Button>
        </div>
      </ExamFrame>
    );
  }

  const step = ORDER[stepIndex];

  return (
    <ExamFrame patientId={patientId}>
      <StepIndicator index={stepIndex} total={ORDER.length} />

      {stepError && (
        <div className="mb-5">
          <ErrorState message={stepError} />
        </div>
      )}
      {retryNotice && (
        <p
          className="mb-5 rounded-xl border-2 border-watch/40 bg-watch-soft px-4 py-3 text-center text-lg"
          role="status"
        >
          {retryNotice}
        </p>
      )}

      {busy ? (
        <LoadingState label={t("uploading")} />
      ) : (
        <>
          {step === "face" && (
            <StepFace
              key={`face-${retried.has("face")}`}
              onDone={handleStep("face", "M1")}
              onError={setStepError}
              onSkip={advance}
            />
          )}
          {step === "speech" && (
            <StepSpeech
              key={`speech-${retried.has("speech")}`}
              onDone={handleStep("speech", "M4")}
              onError={setStepError}
              onSkip={advance}
            />
          )}
          {step === "tapping" && (
            <StepTapping onDone={handleStep("tapping", "M7")} onSkip={advance} />
          )}
          {step === "attention" && (
            <StepAttention onDone={handleStep("attention", "M10")} onSkip={advance} />
          )}
          {step === "questions" && (
            <StepQuestions
              onDone={submit}
              onSkip={() => void submit({ phq2: [], medicationTaken: false })}
            />
          )}
        </>
      )}
    </ExamFrame>
  );
}

function ExamFrame({ children, patientId }: { children: React.ReactNode; patientId: string }) {
  const { t } = useI18n();
  return (
    <div className="patient-scale mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-5">
      <div className="mb-6 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-primary">{t("checkinTitle")}</h1>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          {/* TRD §8: reachable from every screen, including mid-exam. */}
          <EmergencyButton patientId={patientId} />
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function StepIndicator({ index, total }: { index: number; total: number }) {
  const { t } = useI18n();
  return (
    <div className="mb-8">
      <div className="mb-2 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 flex-1 rounded-full",
              i < index ? "bg-stable" : i === index ? "bg-accent" : "bg-secondary",
            )}
          />
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {t("stepOf")} {Math.min(index + 1, total)} {t("of")} {total}
      </p>
    </div>
  );
}
