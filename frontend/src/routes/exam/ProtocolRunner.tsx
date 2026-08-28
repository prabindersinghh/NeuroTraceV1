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
import { useI18n, type StringKey } from "@/lib/i18n";
import { enqueueSession, isOnline, newLocalId, type QueuedModule } from "@/lib/offline";
import { emptyOculomotorRaw } from "@/lib/ondevice/ocular";
import { emptyBalanceRaw } from "@/lib/ondevice/pose";
import { loadPlan, runnableSteps, type Intensity, type PlanStep, type SessionPlan } from "@/lib/protocol";
import { speak, warmUpVoices } from "@/lib/speech-synthesis";
import { taskLabel } from "@/lib/taskLabels";
import type { FastCard as FastCardData, ModuleFeatures, Patient, SessionType } from "@/lib/types";

import { StepAttention } from "./StepAttention";
import { StepBalance, type BalanceTask } from "./StepBalance";
import type { IdentitySignature } from "@/lib/ondevice/identity";
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

/** Capture-failure reason → the sentence the patient sees. Anything unmapped falls back
 *  to the generic retake line — a reason must never surface as a raw code. */
const QUALITY_MESSAGE: Record<string, StringKey> = {
  too_noisy: "qualityTooNoisy",
  no_speech_detected: "qualityNoSpeech",
  too_loud: "qualityTooLoud",
  face_not_detected: "qualityNoFace",
  face_kept_leaving_frame: "qualityNoFace",
  person_not_detected: "qualityNoPerson",
  person_kept_leaving_frame: "qualityNoPerson",
  finger_moved_off_lens: "qualityFinger",
};

const MAX_RETRIES = 2;

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
  const [sessionType, setSessionType] = useState<SessionType>("COMPREHENSIVE");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [gatePassed, setGatePassed] = useState(false);
  const [gateSkipped, setGateSkipped] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  // Forces a clean remount of the step's capture component on retry.
  const [attempt, setAttempt] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [fast, setFast] = useState<FastCardData | null>(null);

  // ---- session-scoped mutable state ----
  const store = useRef({
    modules: new Map<string, QueuedModule>(),
    identity: null as { score: number; verified: boolean; unenrolled: boolean } | null,
    startedAt: 0,
    pausedBeforeNext: false,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    ocular: emptyOculomotorRaw(),
    balance: emptyBalanceRaw(),
    retries: new Map<number, number>(),
    // Lengths of the shared M3 arrays at step entry — a retry truncates back to these,
    // otherwise the failed attempt's trials stay in the payload alongside the retry's.
    ocularMark: { pursuit: 0, saccades: 0, holding: -1 },
  });

  useEffect(() => {
    void warmUpVoices();
    api.fastCard(lang).then(setFast).catch(() => undefined);
    (async () => {
      try {
        const p = await api.getPatient(patientId);
        setPatient(p);
        const intensity = (practice ? "light" : (p.intensity ?? "FULL").toLowerCase()) as Intensity;
        // Which session is due is the SERVER's decision (Part 2.3) — never recomputed here,
        // so the app and the caregiver's dashboard cannot disagree about what today is.
        // A practice run is always the short one: familiarisation should not cost twelve
        // minutes. If the due-check fails we fall back to COMPREHENSIVE rather than the
        // shorter session — missing a module is a worse failure than running extra ones.
        let dueType: SessionType = practice ? "DAILY_PULSE" : "COMPREHENSIVE";
        if (!practice) {
          try {
            dueType = (await api.sessionDue(patientId)).session_type;
          } catch {
            /* offline or unreachable: keep the COMPREHENSIVE default */
          }
        }
        setSessionType(dueType);
        const loaded = await loadPlan(intensity, dueType);
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
    setRetryNotice(null);
    setIndex((i) => i + 1);
  }, []);

  /**
   * TaskShell's rule, enforced at the one choke point every capture passes through:
   * a failed quality check re-prompts up to twice, then the capture is ACCEPTED with the
   * flag set — stored, kept out of the baseline, surfaced as a confounder. Asking a third
   * time tells a patient they are failing; silently keeping a bad capture without ever
   * offering a retry (what this runner did until now) wastes a recoverable measurement.
   */
  const gateQuality = useCallback((quality: Quality, rewind?: () => void): boolean => {
    const s = step!;
    if (quality.ok || !quality.reason) return true;
    const used = store.current.retries.get(s.position) ?? 0;
    if (used >= MAX_RETRIES) return true;
    store.current.retries.set(s.position, used + 1);
    rewind?.();
    const key = QUALITY_MESSAGE[quality.reason];
    setRetryNotice(key ? t(key) : t("retake"));
    setAttempt((a) => a + 1); // remount the capture component clean
    return false;
  }, [step, t]);

  const rewindOcular = useCallback(() => {
    const st = store.current;
    st.ocular.pursuit.length = st.ocularMark.pursuit;
    st.ocular.saccades.length = st.ocularMark.saccades;
    if (st.ocularMark.holding < 0) delete st.ocular.gaze_holding;
    else if (st.ocular.gaze_holding) st.ocular.gaze_holding.length = st.ocularMark.holding;
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

  // Mark the aggregate buffers at each step entry, so a retry can rewind them.
  useEffect(() => {
    const st = store.current;
    st.ocularMark = {
      pursuit: st.ocular.pursuit.length,
      saccades: st.ocular.saccades.length,
      holding: st.ocular.gaze_holding?.length ?? -1,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.position]);

  // The enrolled signature, fetched once. If this fails or the patient never enrolled,
  // `null` means "not checked" and the session is recorded as verified.
  const [identitySignature, setIdentitySignature] =
    useState<IdentitySignature | null>(null);
  useEffect(() => {
    if (!patientId) return;
    void api.getIdentitySignature(patientId)
      .then((r) => setIdentitySignature((r.signature as IdentitySignature) ?? null))
      .catch(() => setIdentitySignature(null));
  }, [patientId]);

  // Speak each step's instruction as it arrives.
  useEffect(() => {
    if (step && !paused) speak(taskLabel(step.task, step.label_en, lang), lang);
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
      const identity = st.identity;
      const session = await api.startSession(patientId, {
        type: sessionType, device_info: deviceInfo, is_practice: practice,
        // Unenrolled means "not checked": send verified, so a clinician never reads a
        // missing enrolment as a failed identity check.
        identity_verified: identity ? identity.unenrolled || identity.verified : true,
        identity_score: identity && !identity.unenrolled ? identity.score : undefined,
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
        localId: newLocalId(), patientId, type: sessionType,
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
    if (!gateQuality(quality)) return;
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

      <p className={[
        "mb-4 leading-snug",
        // Aphasia mode: bigger, fewer words on screen at once. Presentation only —
        // the measured task is identical.
        patient.aphasia_mode ? "text-3xl" : "text-xl",
      ].join(" ")}>{taskLabel(step.task, step.label_en, lang)}</p>
      {demo && (
        <video src={demo} autoPlay loop muted playsInline
          className="mb-4 max-h-44 w-full rounded-lg border border-line object-cover" />
      )}
      {stepError && <div className="mb-4"><ErrorState message={stepError} /></div>}
      {retryNotice && (
        <p role="status"
          className="mb-4 rounded-xl border-2 border-watch/40 bg-watch-soft px-4 py-3 text-center text-lg">
          {retryNotice}
        </p>
      )}

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
        <StepSpeech key={`m4-${attempt}`} onDone={done("M4")} onError={setStepError} onSkip={advance} />
      )}
      {step.task === "facial_battery" && (
        <StepFace
          key={`m1-${attempt}`}
          onDone={done("M1")}
          onError={setStepError}
          onSkip={advance}
          identitySignature={identitySignature}
          onIdentity={(v) => { store.current.identity = v; }}
        />
      )}
      {["horizontal_saccades", "vertical_saccades", "smooth_pursuit", "gaze_holding"].includes(step.task) && (
        <StepOcular
          key={`${step.task}-${attempt}`}
          task={step.task as OcularTask}
          seconds={step.seconds}
          raw={store.current.ocular}
          onError={setStepError}
          onDone={(q) => {
            if (!gateQuality(q, rewindOcular)) return;
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
          key={`${step.task}-${attempt}`}
          task={step.task as BalanceTask}
          seconds={step.seconds}
          raw={store.current.balance}
          onError={setStepError}
          onDone={(q) => {
            // A balance retry just overwrites tests[task] on the next finish; clearing it
            // here keeps a half-failed capture out of the payload if the retry is skipped.
            if (!gateQuality(q, () => { delete store.current.balance.tests[step.task]; })) return;
            if (step.task === "tandem_stance") {
              record("M9", {}, q, { raw: store.current.balance as unknown as Record<string, unknown> });
            }
            advance();
          }}
        />
      )}
      {step.task === "pronator_drift" && (
        <StepPronator key={`m6-${attempt}`} seconds={step.seconds} onError={setStepError}
          onDone={(raw, q) => {
            if (!gateQuality(q)) return;
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
        <StepPpg key={`m17-${attempt}`} seconds={step.seconds} onError={setStepError}
          onDone={(raw, q, detail) => {
            if (!gateQuality(q)) return;
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
