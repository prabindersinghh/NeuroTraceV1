/**
 * The 45-second daily check-in.
 *
 * PRD §5: the patient never sees a risk number or a band — only "done, all good".
 * Every step is skippable: a failed webcam must not block the voice and tap data, because
 * the scorer renormalises around whichever modalities actually captured.
 */
import { CheckCircle2, Mic, Timer, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Patient, ReactionPayload } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StepAudio } from "./checkin/StepAudio";
import { StepReaction } from "./checkin/StepReaction";
import { StepVideo } from "./checkin/StepVideo";

type Step = 0 | 1 | 2 | 3;
const STEP_COUNT = 3;

export function Checkin() {
  const { patientId = "" } = useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

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
  }, [load]);

  const advance = () => setStep((s) => Math.min(STEP_COUNT, (s + 1)) as Step);

  async function send(work: () => Promise<unknown>) {
    setBusy(true);
    setStepError(null);
    try {
      await work();
      advance();
    } catch (err) {
      setStepError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  const onAudio = (blob: Blob) => void send(() => api.uploadAudio(patientId, blob));
  const onVideo = (blob: Blob) => void send(() => api.uploadVideo(patientId, blob));

  const onReaction = (payload: ReactionPayload) =>
    void send(async () => {
      await api.uploadReaction(patientId, payload);
      // The patient never sees the result — finalize, then show a calm confirmation.
      await api.finalize(patientId);
      setFinished(true);
    });

  if (loadError) {
    return (
      <CheckinFrame>
        <ErrorState message={loadError} onRetry={load} />
      </CheckinFrame>
    );
  }
  if (!patient) {
    return (
      <CheckinFrame>
        <LoadingState />
      </CheckinFrame>
    );
  }

  if (finished) {
    return (
      <CheckinFrame>
        <div className="flex flex-col items-center gap-6 py-10 text-center">
          <CheckCircle2 className="h-24 w-24 text-stable" aria-hidden />
          <h2 className="text-4xl font-semibold">{t("allDone")}</h2>
          <p className="max-w-sm text-xl text-muted-foreground">{t("allDoneBody")}</p>
          <Button
            size="touch"
            className="max-w-sm"
            onClick={() =>
              navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true })
            }
          >
            {t("doneAgain")}
          </Button>
        </div>
      </CheckinFrame>
    );
  }

  return (
    <CheckinFrame>
      <StepIndicator step={step} />

      {stepError && (
        <div className="mb-6">
          <ErrorState message={stepError} />
        </div>
      )}

      {busy ? (
        <LoadingState label={t("uploading")} />
      ) : (
        <>
          {step === 0 && <StepAudio onDone={onAudio} onError={setStepError} />}
          {step === 1 && <StepVideo onDone={onVideo} onError={setStepError} />}
          {step === 2 && <StepReaction onDone={onReaction} />}
        </>
      )}

      {!busy && step < 2 && (
        <div className="mt-10 text-center">
          <Button variant="link" onClick={advance}>
            {t("skipStep")}
          </Button>
        </div>
      )}
    </CheckinFrame>
  );
}

function CheckinFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="patient-scale mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary">{t("checkinTitle")}</h1>
        <LanguageToggle />
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const { t } = useI18n();
  const icons = [Mic, Video, Timer];
  return (
    <div className="mb-10">
      <div className="mb-3 flex items-center justify-center gap-3">
        {icons.map((Icon, index) => (
          <div
            key={index}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-full border-2 transition-colors",
              index < step && "border-stable bg-stable text-white",
              index === step && "border-accent bg-accent text-accent-foreground",
              index > step && "border-border bg-card text-muted-foreground",
            )}
            aria-current={index === step ? "step" : undefined}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </div>
        ))}
      </div>
      <p className="text-center text-base text-muted-foreground">
        {t("stepOf")} {Math.min(step + 1, STEP_COUNT)} {t("of")} {STEP_COUNT}
      </p>
    </div>
  );
}
