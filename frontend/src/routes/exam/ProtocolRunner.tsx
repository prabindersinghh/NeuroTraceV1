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
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, Pause, WifiOff, X } from "lucide-react";
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
import {
  MAX_RETRIES,
  canGoBack,
  canGoForward,
  exitSummary,
  mayCapture,
  stepBack,
  stepForward,
  viewFor,
} from "@/lib/taskFlow";
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

/** Tasks whose step component renders its own skip control, so the runner must not add a
 *  second one. Keyed on `task` because that is what the render below branches on. */
const STEPS_WITH_OWN_SKIP = new Set([
  "simple_and_choice_rt",     // StepAttention
  "sustained_ddk_sentence",   // StepSpeech
  "facial_battery",           // StepFace
  "finger_tapping",           // StepTapping
  "phq2", "medication_confirm", // StepQuestions
]);

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
  /** Which step is on screen. Equals `index` normally; lower while reviewing an earlier
   *  step. Kept separate so that going back cannot move where the session resumes. */
  const [viewIndex, setViewIndex] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
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
    setIndex((i) => {
      // The view follows the live step forward. Without this a patient who reviewed an
      // earlier step and then let the session advance would be left looking at the old
      // one, and `viewFor` would keep rendering it read-only while the real session had
      // moved on — the session would look frozen.
      setViewIndex(i + 1);
      return i + 1;
    });
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

  /**
   * The per-module completion handler, MEMOISED — and that is the point, not tidiness.
   *
   * This was rebuilt on every render, so each step received a new `onDone` identity every
   * time the runner re-rendered. A step whose finish effect depends on that identity then
   * re-fires it: `gateQuality` sets state -> the runner re-renders -> `done` is a new
   * function -> the effect fires again. StepTapping (M7) did exactly this and consumed
   * BOTH retries in a few synchronous passes, so the patient saw the retry banner flash
   * and the session move on without ever being offered the retry they were just promised.
   *
   * `useMemo` over a map rather than `useCallback` per code, because the codes are known
   * and this keeps one stable function per module for the life of the dependencies.
   */
  const done = useMemo(() => {
    const cache = new Map<string, (f: ModuleFeatures, q: Quality) => void>();
    return (code: string) => {
      let handler = cache.get(code);
      if (!handler) {
        handler = (features: ModuleFeatures, quality: Quality) => {
          if (!gateQuality(quality)) return;
          record(code, features, quality);
          advance();
        };
        cache.set(code, handler);
      }
      return handler;
    };
  }, [gateQuality, record, advance]);

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
    // `sessionType` MUST be here. Without it `submit` closes over the value from the
    // render that created it — which is the "COMPREHENSIVE" useState default, not the
    // type the scheduler actually returned — so every Daily Pulse session would be posted
    // mislabelled as Comprehensive, and the offline queue would store it wrong too.
    // Caught by oxlint's exhaustive-deps warning, not by any test.
  }, [gateSkipped, lang, patientId, practice, sessionType]);

  /**
   * The patient chose to stop. Keep everything measured so far; score none of it.
   *
   * This is `submit` with a different ending, deliberately not folded into it: the two
   * differ in the one respect that matters clinically, and a shared function with a
   * `finish: boolean` would put that difference behind a parameter that is easy to pass
   * wrong. What was captured still uploads — the family should see the check-in was
   * started and adherence should count the attempt — and the session is then marked
   * abandoned, which is what keeps it out of every baseline and out of scoring.
   *
   * Offline, it queues with the same marker; `syncPending` branches on it and calls
   * abandon rather than finalize, because draining a partial session through finalize
   * would score it (INV-14).
   */
  const exitSession = useCallback(async () => {
    setConfirmExit(false);
    setBusy(true);
    const st = store.current;
    const collected = [...st.modules.values()];
    const summary = exitSummary(index, steps.length);
    const deviceInfo = { userAgent: navigator.userAgent, language: lang, online: isOnline(),
                         gate_skipped: gateSkipped ?? undefined };
    try {
      if (!isOnline()) throw new Error("offline");
      const session = await api.startSession(patientId, {
        type: sessionType, device_info: deviceInfo, is_practice: practice,
      });
      for (const m of collected) {
        await api.submitModule(session.id, m.code, m.features, {
          quality_flag: m.quality_flag, quality_detail: m.quality_detail, raw: m.raw,
          session_position: m.session_position,
          elapsed_seconds_at_task_start: m.elapsed_seconds_at_task_start,
          intensity: m.intensity, paused_before_task: m.paused_before_task,
        });
      }
      await api.abandonSession(session.id, summary);
    } catch {
      await enqueueSession({
        localId: newLocalId(), patientId, type: sessionType,
        capturedAt: new Date().toISOString(), deviceInfo,
        modules: collected, attempts: 0, isPractice: practice,
        abandoned: summary,
      });
    } finally {
      setBusy(false);
      navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true });
    }
  }, [gateSkipped, index, lang, navigate, patientId, practice, sessionType, steps.length,
      user?.role]);

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

  if (confirmExit) {
    const summary = exitSummary(index, steps.length);
    return (
      <Frame patientId={patientId}>
        {/* The count is stated plainly rather than framed as a loss ("you'll lose your
            progress"). Nothing is lost — what was measured is kept — and pressuring a
            tired stroke survivor to stay in a check-in is not something this product
            should do. The continue option is listed first and styled as the primary,
            because it is the more common intent after an accidental tap, not because
            stopping is discouraged. */}
        <div role="dialog" aria-modal="true" aria-labelledby="exit-title"
             className="flex flex-col items-center gap-6 py-12 text-center">
          <h2 id="exit-title" className="text-3xl font-semibold">{t("exitTitle")}</h2>
          <p className="text-xl" aria-live="polite">
            {t("exitProgress")
              .replace("{done}", String(summary.completed))
              .replace("{total}", String(summary.total))}
          </p>
          <p className="max-w-sm text-lg text-muted-foreground">{t("exitKept")}</p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Button size="touch" onClick={() => setConfirmExit(false)}>
              {t("exitCancel")}
            </Button>
            <button type="button" onClick={() => void exitSession()}
              className="focus-ring min-h-16 rounded-xl border-2 border-line px-4 text-lg font-medium">
              {t("exitConfirm")}
            </button>
          </div>
        </div>
      </Frame>
    );
  }

  if (!step) return <Frame patientId={patientId}><LoadingState /></Frame>;

  // ---- per-step render ----
  // `step` stays the LIVE step for every capture path — `record`, `gateQuality` and the
  // fatigue fields all close over it. `view` only decides what is on screen. Keeping the
  // two apart is what makes it impossible for a reviewed step to be recorded into: there
  // is no code path where the thing being displayed is also the thing being written.
  const view = viewFor(viewIndex, index);
  const viewedStep = steps[view.index] ?? step;
  const capturing = mayCapture(view);
  const demo = demoClipFor(viewedStep.module, viewedStep.task);

  return (
    <Frame patientId={patientId}>
      <header className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {view.index + 1} / {steps.length}
        </span>
        <div className="flex items-center gap-2">
          {/* Both always visible, never behind a menu — the same rule pause has always
              had. Someone who wants to stop should not have to hunt for how. */}
          <button type="button" onClick={togglePause}
            className="focus-ring min-h-11 rounded-lg border border-line px-4 text-base">
            {t("pause")}
          </button>
          {/* No aria-label. It used to carry "Stop this check-in" while the button read
              "Exit", so the accessible name did not contain the visible one — WCAG 2.5.3,
              and a real failure rather than a technicality: a voice-control user saying
              what is written on the button would not activate it. The visible text is the
              accessible name, and the confirmation step supplies the detail. */}
          <button type="button" onClick={() => setConfirmExit(true)}
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-4 text-base">
            <X className="h-5 w-5" aria-hidden />
            {t("exitShort")}
          </button>
        </div>
      </header>

      {/* Back is offered from the second step onward. It is a way to SEE what you did. */}
      {(canGoBack(view.index) || view.mode === "review") && (
        <nav aria-label={t("reviewNavLabel")} className="mb-4 flex items-center gap-2">
          <button type="button"
            onClick={() => setViewIndex((v) => stepBack(v))}
            disabled={!canGoBack(view.index)}
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-4 text-base disabled:opacity-40">
            <ArrowLeft className="h-5 w-5" aria-hidden />
            {t("stepBack")}
          </button>
          {view.mode === "review" && (
            <button type="button"
              onClick={() => setViewIndex((v) => stepForward(v, index))}
              disabled={!canGoForward(view.index, index)}
              className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-4 text-base disabled:opacity-40">
              {t("stepForward")}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
          )}
        </nav>
      )}

      {view.mode === "review" && (
        <div role="status"
          className="mb-4 flex items-start gap-3 rounded-xl border-2 border-accent/40 bg-secondary px-4 py-3 text-left">
          <Eye className="mt-0.5 h-6 w-6 shrink-0 text-accent" aria-hidden />
          <div>
            <p className="text-lg font-medium">{t("reviewTitle")}</p>
            {/* Says plainly that this cannot be redone, and why, so the absence of a
                retake button reads as a decision rather than a missing feature. */}
            <p className="text-base text-muted-foreground">{t("reviewBody")}</p>
          </div>
        </div>
      )}

      <p className={[
        "mb-4 leading-snug",
        // Aphasia mode: bigger, fewer words on screen at once. Presentation only —
        // the measured task is identical.
        patient.aphasia_mode ? "text-3xl" : "text-xl",
      ].join(" ")}>{taskLabel(viewedStep.task, viewedStep.label_en, lang)}</p>
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

      {/* THE GUARD, in one place. No capture component exists in the tree while an
          earlier step is being reviewed, so there is no path by which a completed step's
          result can be discarded and retaken. Unlimited retakes would teach the baseline
          the patient's best attempt rather than their typical one. */}
      {capturing && (<>
      {step.task === "simple_and_choice_rt" && (
        <StepAttention key={`m10-${attempt}`} onDone={done("M10")} onSkip={advance} />
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
        <StepTapping key={`m7-${attempt}`} onDone={done("M7")} onSkip={advance} />
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

      {/* Only for steps that do NOT provide their own skip. Five of them do — M10, M4,
          M1, M7 and the questionnaire — and this generic one rendered underneath, so a
          patient on those steps saw TWO identical "Skip this step" buttons stacked, doing
          exactly the same thing. Found by driving the app, not by any test: both buttons
          are individually correct and only the pair is wrong. */}
      {!STEPS_WITH_OWN_SKIP.has(viewedStep.task) && (
        <button type="button" onClick={advance}
          className="focus-ring mt-6 min-h-12 w-full text-sm text-muted-foreground underline">
          {t("skipStep")}
        </button>
      )}
      </>)}
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
