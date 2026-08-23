/**
 * The daily session engine — runs the 21-step protocol from `session_plan.py`.
 *
 * This replaces the v1 five-step battery. What it holds constant, and why:
 *
 * FIXED ORDER. Each step renders at its protocol position, so every module's baseline
 * absorbs its own place on the fatigue curve. `session_position` and
 * `elapsed_seconds_at_task_start` are recorded on every result — an intensity change or a
 * pause moves a task earlier, biases toward MASKING decline, and must be visible.
 *
 * THE FALL-RISK GATE IS STRUCTURAL. The standing block cannot be reached except through
 * `FallRiskGate` — skipping it skips the block, and that skip is first-class data.
 *
 * AGGREGATED MODULES. M3's four steps fill one payload (per-direction asymmetry needs all
 * directions); M9's three standing tasks fill one payload (the Romberg quotient needs the
 * pair). Each is submitted once, after its last step, with raw landmark-derived POINTS —
 * the server runs the extractor the test suite pins.
 *
 * PAUSE NEVER INVALIDATES. It sets `paused_before_task` on the NEXT task, because a task
 * performed rested is measured against a baseline built without rest.
 *
 * NEVER A SCORE. The finish screen is "all done" and the FAST card. Bands go to the
 * caregiver dashboard, after aggregation, never at the moment of performance.
 */
import { CheckCircle2, Pause, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { FallRiskGate } from "@/components/FallRiskGate";
import { FastCard } from "@/components/FastCard";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { demoClipFor } from "@/lib/demoClips";
import { useI18n } from "@/lib/i18n";
import { enqueueSession, isOnline, newLocalId, type QueuedModule } from "@/lib/offline";
import { emptyOculomotorRaw } from "@/lib/ondevice/ocular";
import { emptyBalanceRaw } from "@/lib/ondevice/pose";
import { loadPlan, runnableSteps, type Intensity, type PlanStep, type SessionPlan } from "@/lib/protocol";
import { speak, warmUpVoices } from "@/lib/speech-synthesis";
import type { FastCard as FastCardData, ModuleFeatures, Patient } from "@/lib/types";

import { StepAttention } from "./StepAttention";
import { StepBalance, type BalanceTask } from "./StepBalance";
import { StepFace } from "./StepFace";
import { StepOcular, type OcularTask } from "./StepOcular";
import { StepPpg } from "./StepPpg";
import { StepPronator } from "./StepPronator";
import { StepQuestions, type QuestionsResult } from "./StepQuestions";
import { StepRecall } from "./StepRecall";
import { StepSpeech } from "./StepSpeech";
import StepSvv from "./StepSvv";
import { StepTapping } from "./StepTapping";

type Quality = { ok: boolean; reason?: string };

interface Props {
  /** Practice sessions run a short subset, are stored, and are never scored (0009). */
  practice?: boolean;
}

export function ProtocolRunner({ practice = false }: Props) {
  const { patientId = "" } = useParams();
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [gatePassed, setGatePassed] = useState(false);
  const [gateSkipped, setGateSkipped] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [fast, setFast] = useState<FastCardData | null>(null);

  // ---- session-scoped mutable state ----
  const store = useRef({
    modules: new Map<string, QueuedModule>(),
    startedAt: 0,
    pausedBeforeNext: false,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    ocular: emptyOculomotorRaw(),
    balance: emptyBalanceRaw(),
  });

  useEffect(() => {
    void warmUpVoices();
    api.fastCard(lang).then(setFast).catch(() => undefined);
    (async () => {
      try {
        const p = await api.getPatient(patientId);
        setPatient(p);
        const intensity = (practice ? "light" : (p.intensity ?? "FULL").toLowerCase()) as Intensity;
        const loaded = await loadPlan(intensity);
        setPlan(loaded);
        store.current.startedAt = performance.now();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [patientId, practice, lang]);

  const steps = useMemo(() => (plan ? runnableSteps(plan) : []), [plan]);
  const step: PlanStep | undefined = steps[index];

  // Standing block entry: the first step whose block is C_*, among the runnable steps.
  const standingEntryIndex = useMemo(
    () => steps.findIndex((s) => s.block.startsWith("C_")),
    [steps],
  );

  /** Elapsed ACTIVE seconds — pauses excluded, which is the point of recording them. */
  const elapsedSeconds = useCallback(() => {
    const st = store.current;
    return Math.round((performance.now() - st.startedAt - st.totalPausedMs) / 100) / 100;
  }, []);

  const fatigueFields = useCallback((s: PlanStep) => ({
    session_position: s.position,
    elapsed_seconds_at_task_start: elapsedSeconds(),
    intensity: plan?.intensity ?? "full",
    paused_before_task: store.current.pausedBeforeNext,
  }), [elapsedSeconds, plan]);

  const record = useCallback((code: string, features: ModuleFeatures, quality: Quality,
                              extra?: Partial<QueuedModule>) => {
    const s = step!;
    store.current.modules.set(code, {
      code,
      features,
      quality_flag: quality.ok,
      quality_detail: quality.reason ? { reason: quality.reason } : undefined,
      ...fatigueFields(s),
      ...extra,
    });
    store.current.pausedBeforeNext = false;
  }, [fatigueFields, step]);

  const advance = useCallback(() => {
    setStepError(null);
    setIndex((i) => i + 1);
  }, []);

  // ---- pause ----
  const togglePause = useCallback(() => {
    const st = store.current;
    if (!paused) {
      st.pauseStartedAt = performance.now();
      setPaused(true);
    } else {
      st.totalPausedMs += performance.now() - st.pauseStartedAt;
      st.pausedBeforeNext = true; // the NEXT task was performed rested
      setPaused(false);
    }
  }, [paused]);

  // Speak each step's instruction as it arrives.
  useEffect(() => {
    if (step && !paused) speak(step.label_en, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.position, paused]);

  // ---- submission ----
  const submit = useCallback(async (questions?: QuestionsResult) => {
    setBusy(true);
    const st = store.current;
    const collected = [...st.modules.values()];
    const deviceInfo = { userAgent: navigator.userAgent, language: lang, online: isOnline(),
                         gate_skipped: gateSkipped ?? undefined };
    try {
      if (!isOnline()) throw new Error("offline");
      const session = await api.startSession(patientId, {
        type: "daily", device_info: deviceInfo, is_practice: practice,
      });
      for (const m of collected) {
        await api.submitModule(session.id, m.code, m.features, {
          quality_flag: m.quality_flag,
          quality_detail: m.quality_detail,
          raw: m.raw,
          session_position: m.session_position,
          elapsed_seconds_at_task_start: m.elapsed_seconds_at_task_start,
          intensity: m.intensity,
          paused_before_task: m.paused_before_task,
        });
      }
      if (questions) {
        await api.submitQuestionnaire(patientId, "PHQ2", questions.phq2, session.id);
        await api.submitAdherence(patientId, questions.medicationTaken);
      }
      const finalized = await api.finalizeSession(session.id);
      if (finalized.fast) setFast(finalized.fast);
    } catch {
      await enqueueSession({
        localId: newLocalId(), patientId, type: "daily",
        capturedAt: new Date().toISOString(), deviceInfo,
        modules: collected, attempts: 0, isPractice: practice,
      });
      setQueuedOffline(true);
    } finally {
      setBusy(false);
      setFinished(true);
    }
  }, [gateSkipped, lang, patientId, practice]);

  // Reaching past the last step submits.
  useEffect(() => {
    if (plan && steps.length > 0 && index >= steps.length && !finished && !busy) {
      void submit();
    }
  }, [index, steps.length, plan, finished, busy, submit]);

  // ---- flow-control renders ----
  if (loadError) return <Frame patientId={patientId}><ErrorState message={loadError} /></Frame>;
  if (!patient || !plan) return <Frame patientId={patientId}><LoadingState /></Frame>;

  if (finished) {
    return (
      <Frame patientId={patientId}>
        <div className="flex flex-col items-center gap-6 py-8 text-center">
          <CheckCircle2 className="h-24 w-24 text-stable" aria-hidden />
          <h2 className="text-4xl font-semibold">{t("allDone")}</h2>
          {practice && <p className="text-lg text-muted-foreground">{t("practiceDone")}</p>}
          {queuedOffline && (
            <p className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm">
              <WifiOff className="h-4 w-4" aria-hidden /> {t("offline")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t("onDevice")}</p>
          {fast && <FastCard card={fast} className="mt-2 text-left" />}
          <Button size="touch" className="max-w-sm" onClick={() =>
            navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true })}>
            {t("finish")}
          </Button>
        </div>
      </Frame>
    );
  }

  if (busy) return <Frame patientId={patientId}><LoadingState label={t("uploading")} /></Frame>;

  // ---- fall-risk gate: structural, not advisory ----
  const atStandingEntry = standingEntryIndex >= 0 && index === standingEntryIndex;
  if (atStandingEntry && !gatePassed && !gateSkipped) {
    return (
      <FallRiskGate
        onProceed={() => setGatePassed(true)}
        onSkip={(reason) => {
          setGateSkipped(reason);
          // Skip every standing-block step; the skip itself is recorded on the session.
          const next = steps.findIndex((s, i) => i >= index && !s.block.startsWith("C_"));
          setIndex(next === -1 ? steps.length : next);
        }}
      />
    );
  }

  if (paused) {
    return (
      <Frame patientId={patientId}>
        <div className="flex flex-col items-center gap-6 py-16 text-center">
          <Pause className="h-16 w-16 text-accent" aria-hidden />
          <p className="text-2xl">{t("pausedTitle")}</p>
          <p className="max-w-sm text-muted-foreground">{t("pausedBody")}</p>
          <Button size="touch" className="max-w-sm" onClick={togglePause}>{t("resume")}</Button>
        </div>
      </Frame>
    );
  }

  if (!step) return <Frame patientId={patientId}><LoadingState /></Frame>;

  // ---- per-step render ----
  const done = (code: string) => (features: ModuleFeatures, quality: Quality) => {
    record(code, features, quality);
    advance();
  };
  const demo = demoClipFor(step.module, step.task);

  return (
    <Frame patientId={patientId}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {index + 1} / {steps.length}
        </span>
        {/* Always visible. Never behind a menu. */}
        <button type="button" onClick={togglePause}
          className="min-h-11 rounded-lg border border-line px-4 text-base">
          {t("pause")}
        </button>
      </header>

      <p className="mb-4 text-xl leading-snug">{step.label_en}</p>
      {demo && (
        <video src={demo} autoPlay loop muted playsInline
          className="mb-4 max-h-44 w-full rounded-lg border border-line object-cover" />
      )}
      {stepError && <div className="mb-4"><ErrorState message={stepError} /></div>}

      {step.task === "simple_and_choice_rt" && (
        <StepAttention onDone={done("M10")} onSkip={advance} />
      )}
      {step.task === "word_encoding" && (
        <StepRecall mode="encode" seconds={step.seconds}
          onDone={(f, q) => { record("M11", f, q); advance(); }} />
      )}
      {step.task === "delayed_recall" && (
        <StepRecall mode="recall" seconds={step.seconds}
          onDone={(f, q) => {
            const prev = store.current.modules.get("M11");
            record("M11", { ...(prev?.features ?? {}), ...f }, q);
            advance();
          }} />
      )}
      {step.task === "sustained_ddk_sentence" && (
        <StepSpeech onDone={done("M4")} onError={setStepError} onSkip={advance} />
      )}
      {step.task === "facial_battery" && (
        <StepFace onDone={done("M1")} onError={setStepError} onSkip={advance} />
      )}
      {["horizontal_saccades", "vertical_saccades", "smooth_pursuit", "gaze_holding"].includes(step.task) && (
        <StepOcular
          key={step.task}
          task={step.task as OcularTask}
          seconds={step.seconds}
          raw={store.current.ocular}
          onError={setStepError}
          onDone={(q) => {
            // Submit M3 once, after its last step.
            if (step.task === "gaze_holding") {
              record("M3", {}, q, { raw: store.current.ocular as unknown as Record<string, unknown> });
            }
            advance();
          }}
        />
      )}
      {step.task === "svv_static_and_dynamic" && (
        <StepSvv
          onComplete={(r) => {
            // The M21 extractor runs server-side on the per-trial angles.
            record("M21", {}, { ok: !r.aborted, reason: r.aborted ? "svv_aborted" : undefined },
              { raw: r as unknown as Record<string, unknown> });
            advance();
          }}
        />
      )}
      {["romberg_eyes_open", "romberg_eyes_closed", "tandem_stance"].includes(step.task) && (
        <StepBalance
          key={step.task}
          task={step.task as BalanceTask}
          seconds={step.seconds}
          raw={store.current.balance}
          onError={setStepError}
          onDone={(q) => {
            if (step.task === "tandem_stance") {
              record("M9", {}, q, { raw: store.current.balance as unknown as Record<string, unknown> });
            }
            advance();
          }}
        />
      )}
      {step.task === "pronator_drift" && (
        <StepPronator seconds={step.seconds} onError={setStepError}
          onDone={(raw, q) => {
            record("M6", {}, q, { raw: raw as unknown as Record<string, unknown> });
            advance();
          }} />
      )}
      {step.task === "finger_tapping" && (
        <StepTapping onDone={done("M7")} onSkip={advance} />
      )}
      {(step.task === "phq2" || step.task === "medication_confirm") && (
        <StepQuestions
          onDone={(result) => void submit(result)}
          onSkip={() => void submit({ phq2: [], medicationTaken: false })}
        />
      )}
      {step.task === "ppg_rhythm" && (
        <StepPpg seconds={step.seconds} onError={setStepError}
          onDone={(raw, q, detail) => {
            record("M17", {}, { ok: q.ok, reason: q.reason },
              { raw: raw as unknown as Record<string, unknown>, quality_detail: detail });
            advance();
          }} />
      )}

      <button type="button" onClick={advance}
        className="mt-6 min-h-12 w-full text-sm text-muted-foreground underline">
        {t("skipStep")}
      </button>
    </Frame>
  );
}

function Frame({ children, patientId }: { children: React.ReactNode; patientId: string }) {
  void patientId;
  return (
    <div className="patient-scale mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-5">
      {children}
    </div>
  );
}

export default ProtocolRunner;
