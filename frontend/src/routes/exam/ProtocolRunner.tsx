/**
 * The daily session engine — runs the 21-step protocol from `session_plan.py`, and
 * presents it as ONE PATH with a few chapters rather than as eighteen tests.
 *
 * What it holds constant, and why:
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
 * performed rested is measured against a baseline built without rest. Coming back after
 * a reload is a pause of the same kind (lib/journeyStore.ts).
 *
 * NEVER A SCORE. The finish screen is "that's everything for today" and the FAST card.
 * Bands go to the caregiver dashboard, after aggregation, never at the moment of
 * performance.
 *
 * THE JOURNEY IS PRESENTATION. Scenes (welcome, chapter, step) are screens shown between
 * or around positions; `lib/journey.ts` derives them from the runnable steps and never
 * reorders anything. Two behavioural changes came with it and are recorded as decisions:
 * the questionnaire answers are recorded at their positions and submitted at the end
 * instead of ending the session (D-061), and the session clock starts when the first
 * chapter begins, not at plan load (D-062).
 */
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { FallRiskGate } from "@/components/FallRiskGate";
import { ComfortControls } from "@/components/journey/ComfortControls";
import { Completion } from "@/components/journey/Completion";
import { Instruction } from "@/components/journey/Instruction";
import { JourneyShell } from "@/components/journey/JourneyShell";
import { Moment } from "@/components/journey/Moment";
import { Welcome } from "@/components/journey/Welcome";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { demoClipFor } from "@/lib/demoClips";
import { useI18n, type StringKey } from "@/lib/i18n";
import {
  LABEL_OVERRIDE, PREWARM, chapterIndexAt, chapters, isChapterStart, type ChapterKey,
} from "@/lib/journey";
import {
  clearSnapshot, loadSnapshot, restoredClock, saveSnapshot, sessionStore,
  type JourneySnapshot,
} from "@/lib/journeyStore";
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

/** Which screen is up. The clinical state (index, gate, pause) is separate from this. */
type Scene = "welcome" | "resume" | "chapter" | "step";

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

const CHAPTER_TITLE: Record<ChapterKey, StringKey> = {
  hands: "chHands", checkin: "chCheckin", eyes: "chEyes", standing: "chStanding", close: "chClose",
};
const CHAPTER_INTRO: Record<ChapterKey, StringKey> = {
  hands: "chHandsIntro", checkin: "chCheckinIntro", eyes: "chEyesIntro",
  standing: "chStandingIntro", close: "chCloseIntro",
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
  const [scene, setScene] = useState<Scene>("welcome");
  const [pendingSnapshot, setPendingSnapshot] = useState<JourneySnapshot | null>(null);
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
    /** Set when the first chapter begins (D-062), or restored from a snapshot. */
    startedAt: 0,
    begun: false,
    pausedBeforeNext: false,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    ocular: emptyOculomotorRaw(),
    balance: emptyBalanceRaw(),
    retries: new Map<number, number>(),
    /** PHQ-2 and medicines, recorded at positions 5 and 6, submitted at the end (D-061). */
    questions: {} as { phq2?: number[]; medicationTaken?: boolean },
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
        // A session left part-way this morning is offered back. Practice runs are not:
        // they are short, unscored, and a fresh start is the better familiarisation.
        const saved = practice ? null : loadSnapshot(sessionStore(), patientId);
        if (saved) {
          setPendingSnapshot(saved);
          setScene("resume");
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [patientId, practice, lang]);

  const steps = useMemo(() => (plan ? runnableSteps(plan) : []), [plan]);
  const stepsRef = useRef<PlanStep[]>(steps);
  stepsRef.current = steps;
  const indexRef = useRef(index);
  indexRef.current = index;
  const step: PlanStep | undefined = steps[index];

  const chapterList = useMemo(() => chapters(steps), [steps]);
  const chapterStarts = useMemo(() => chapterList.map((c) => c.start), [chapterList]);

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

  /**
   * Move the live step to `i` and pick the scene for it: a chapter intro where a
   * chapter begins, the step itself otherwise. `list` is passed on restore, when the
   * plan in state may not have caught up with the snapshot's yet.
   */
  const enter = useCallback((i: number, list: PlanStep[] = stepsRef.current) => {
    setIndex(i);
    // The view follows the live step forward. Without this a patient who reviewed an
    // earlier step and then let the session advance would be left looking at the old
    // one, and `viewFor` would keep rendering it read-only while the real session had
    // moved on — the session would look frozen.
    setViewIndex(i);
    setScene(i < list.length && isChapterStart(list, i) ? "chapter" : "step");
  }, []);

  const advance = useCallback(() => {
    setStepError(null);
    setRetryNotice(null);
    enter(indexRef.current + 1);
  }, [enter]);

  /** The warm-up is over: the task clock starts now (D-062). */
  const beginSession = useCallback(() => {
    const st = store.current;
    st.startedAt = performance.now();
    st.begun = true;
    enter(0);
  }, [enter]);

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
    const notice = key ? t(key) : t("retake");
    setRetryNotice(notice);
    speak(notice, lang);
    setAttempt((a) => a + 1); // remount the capture component clean
    return false;
  }, [step, t, lang]);

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

  // ---- a session in progress survives a reload (lib/journeyStore.ts) ----
  useEffect(() => {
    const st = store.current;
    if (practice || !plan || !st.begun || finished) return;
    saveSnapshot(sessionStore(), {
      version: 1,
      patientId,
      sessionType,
      plan,
      index,
      modules: [...st.modules.values()],
      ocular: st.ocular,
      balance: st.balance,
      retries: [...st.retries.entries()],
      gatePassed,
      gateSkipped,
      questions: st.questions,
      identity: st.identity,
      activeMs: Math.round(elapsedSeconds() * 1000),
      savedAt: new Date().toISOString(),
    });
  }, [index, gatePassed, gateSkipped, scene, plan, sessionType, practice, finished, patientId, elapsedSeconds]);

  // Load the model the coming chapter needs while the patient reads its intro, so the
  // camera step does not open on a "Loading…" frame. Both loaders are memoised.
  useEffect(() => {
    if (scene !== "chapter") return;
    const key = chapterList[chapterIndexAt(chapterList, index)]?.key;
    const model = key ? PREWARM[key] : undefined;
    if (model === "face") void import("@/lib/ondevice/face").then((m) => m.loadFaceLandmarker()).catch(() => undefined);
    if (model === "pose") void import("@/lib/ondevice/pose").then((m) => m.loadPoseLandmarker()).catch(() => undefined);
  }, [scene, index, chapterList]);

  const continueFromSnapshot = useCallback((snap: JourneySnapshot) => {
    const st = store.current;
    st.modules = new Map(snap.modules.map((m) => [m.code, m]));
    st.identity = snap.identity;
    st.ocular = snap.ocular;
    st.balance = snap.balance;
    st.retries = new Map(snap.retries);
    st.questions = snap.questions ?? {};
    // The time away was a rest: the next task is recorded as performed after a pause,
    // and the elapsed clock carries on from the saved ACTIVE time.
    const clock = restoredClock(snap.activeMs, performance.now());
    st.startedAt = clock.startedAt;
    st.totalPausedMs = clock.totalPausedMs;
    st.pausedBeforeNext = true;
    st.begun = true;
    setSessionType(snap.sessionType);
    setPlan(snap.plan);
    setGatePassed(snap.gatePassed);
    setGateSkipped(snap.gateSkipped);
    setPendingSnapshot(null);
    enter(snap.index, runnableSteps(snap.plan));
  }, [enter]);

  // ---- submission ----
  /**
   * What was captured uploads and the session is marked abandoned — whether the patient
   * chose to stop, or chose to start again rather than continue a saved one. Offline it
   * queues with the same marker; `syncPending` branches on it and calls abandon rather
   * than finalize, because draining a partial session through finalize would score it
   * (INV-14).
   */
  const uploadPartial = useCallback(async (
    collected: QueuedModule[], summary: { completed: number; total: number }, type: SessionType,
  ) => {
    const deviceInfo = { userAgent: navigator.userAgent, language: lang, online: isOnline(),
                         gate_skipped: gateSkipped ?? undefined };
    try {
      if (!isOnline()) throw new Error("offline");
      const session = await api.startSession(patientId, {
        type, device_info: deviceInfo, is_practice: practice,
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
        localId: newLocalId(), patientId, type,
        capturedAt: new Date().toISOString(), deviceInfo,
        modules: collected, attempts: 0, isPractice: practice,
        abandoned: summary,
      });
    }
  }, [gateSkipped, lang, patientId, practice]);

  const startFresh = useCallback(async (snap: JourneySnapshot) => {
    setBusy(true);
    try {
      if (snap.modules.length) {
        await uploadPartial(snap.modules, exitSummary(snap.index, runnableSteps(snap.plan).length), snap.sessionType);
      }
    } finally {
      clearSnapshot(sessionStore(), patientId);
      setPendingSnapshot(null);
      setBusy(false);
      setScene("welcome");
    }
  }, [patientId, uploadPartial]);

  const submit = useCallback(async () => {
    setBusy(true);
    const st = store.current;
    const collected = [...st.modules.values()];
    const questions = st.questions;
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
      // Only what was actually answered. A skipped question is not "never" and a
      // skipped medicines check is not "not taken".
      if (questions.phq2?.length) {
        await api.submitQuestionnaire(patientId, "PHQ2", questions.phq2, session.id);
      }
      if (questions.medicationTaken !== undefined) {
        await api.submitAdherence(patientId, questions.medicationTaken);
      }
      const finalized = await api.finalizeSession(session.id);
      if (finalized.fast) setFast(finalized.fast);
    } catch {
      await enqueueSession({
        localId: newLocalId(), patientId, type: sessionType,
        capturedAt: new Date().toISOString(), deviceInfo,
        modules: collected, attempts: 0, isPractice: practice, questions,
      });
      setQueuedOffline(true);
    } finally {
      clearSnapshot(sessionStore(), patientId);
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
   */
  const exitSession = useCallback(async () => {
    setConfirmExit(false);
    setBusy(true);
    const st = store.current;
    const collected = [...st.modules.values()];
    const summary = exitSummary(index, steps.length);
    try {
      if (st.begun) await uploadPartial(collected, summary, sessionType);
    } finally {
      clearSnapshot(sessionStore(), patientId);
      setBusy(false);
      navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true });
    }
  }, [index, navigate, patientId, sessionType, steps.length, uploadPartial, user?.role]);

  // Reaching past the last step submits.
  useEffect(() => {
    if (plan && steps.length > 0 && store.current.begun && index >= steps.length && !finished && !busy) {
      void submit();
    }
  }, [index, steps.length, plan, finished, busy, submit]);

  const goHome = () =>
    navigate(user?.role === "patient" ? "/" : `/dashboard/${patientId}`, { replace: true });

  // ---- flow-control renders ----
  if (loadError) {
    return <JourneyShell sceneKey="error"><ErrorState message={loadError} /></JourneyShell>;
  }
  if (!patient || !plan) {
    return <JourneyShell sceneKey="loading"><LoadingState /></JourneyShell>;
  }

  const progress = { total: steps.length, completed: index, chapterStarts };

  if (finished) {
    return (
      <JourneyShell sceneKey="done" progress={{ ...progress, finished: true }}>
        <Completion practice={practice} queuedOffline={queuedOffline} fast={fast} onFinish={goHome} />
      </JourneyShell>
    );
  }

  if (busy) return <JourneyShell sceneKey="busy"><LoadingState label={t("uploading")} /></JourneyShell>;

  if (scene === "resume" && pendingSnapshot) {
    return (
      <JourneyShell sceneKey="resume" onExit={goHome}>
        <Moment
          title={t("resumeTitle")}
          body={t("resumeBody")}
          primary={{ label: t("resumeContinue"), onClick: () => continueFromSnapshot(pendingSnapshot) }}
          secondary={{ label: t("resumeFresh"), onClick: () => void startFresh(pendingSnapshot) }}
        />
      </JourneyShell>
    );
  }

  if (scene === "welcome") {
    return (
      <JourneyShell sceneKey="welcome" progress={progress} onExit={goHome}>
        <Welcome practice={practice} onBegin={beginSession} />
      </JourneyShell>
    );
  }

  // ---- fall-risk gate: structural, not advisory ----
  // Rendered before the chapter intro: for the standing chapter the gate IS the intro.
  const atStandingEntry = standingEntryIndex >= 0 && index === standingEntryIndex;
  if (atStandingEntry && !gatePassed && !gateSkipped) {
    return (
      <JourneyShell sceneKey="gate" progress={progress} onPause={togglePause} onExit={() => setConfirmExit(true)}>
        <FallRiskGate
          onProceed={() => { setGatePassed(true); setScene("step"); }}
          onSkip={(reason) => {
            setGateSkipped(reason);
            // Skip every standing-block step; the skip itself is recorded on the session.
            const next = steps.findIndex((s, i) => i >= index && !s.block.startsWith("C_"));
            enter(next === -1 ? steps.length : next);
          }}
        />
      </JourneyShell>
    );
  }

  if (confirmExit) {
    const summary = exitSummary(index, steps.length);
    return (
      <JourneyShell sceneKey="exit" progress={progress}>
        {/* The count is stated plainly rather than framed as a loss ("you'll lose your
            progress"). Nothing is lost — what was measured is kept — and pressuring a
            tired stroke survivor to stay in a check-in is not something this product
            should do. The continue option is listed first and styled as the primary,
            because it is the more common intent after an accidental tap, not because
            stopping is discouraged. */}
        <Moment
          dialog
          title={t("exitTitle")}
          body={t("exitProgress")
            .replace("{done}", String(summary.completed))
            .replace("{total}", String(summary.total))}
          note={t("exitKept")}
          primary={{ label: t("exitCancel"), onClick: () => setConfirmExit(false) }}
          secondary={{ label: t("exitConfirm"), onClick: () => void exitSession() }}
        />
      </JourneyShell>
    );
  }

  if (paused) {
    return (
      // Someone who paused and then decides to stop should not have to resume first.
      <JourneyShell sceneKey="paused" progress={progress} onExit={() => setConfirmExit(true)}>
        <Moment
          title={t("pausedTitle")}
          body={t("pausedBody")}
          primary={{ label: t("resume"), onClick: togglePause }}
        >
          <ComfortControls className="mx-auto w-full max-w-sm text-left" />
        </Moment>
      </JourneyShell>
    );
  }

  if (scene === "chapter" && step) {
    const chIdx = chapterIndexAt(chapterList, index);
    const key = chapterList[chIdx]?.key ?? "close";
    return (
      <JourneyShell sceneKey={`chapter-${chIdx}`} progress={progress} onPause={togglePause} onExit={() => setConfirmExit(true)}>
        <Moment
          eyebrow={t("chNext")}
          title={t(CHAPTER_TITLE[key])}
          body={t(CHAPTER_INTRO[key])}
          // The rest offer, from the second chapter on. Rest IS pause: recorded on the
          // next task, never a penalty.
          note={chIdx > 0 ? t("restPrompt") : undefined}
          primary={{ label: t("resume"), onClick: () => setScene("step") }}
          secondary={chIdx > 0 ? { label: t("restNow"), onClick: togglePause } : undefined}
        />
      </JourneyShell>
    );
  }

  if (!step) return <JourneyShell sceneKey="loading"><LoadingState /></JourneyShell>;

  // ---- per-step render ----
  // `step` stays the LIVE step for every capture path — `record`, `gateQuality` and the
  // fatigue fields all close over it. `view` only decides what is on screen. Keeping the
  // two apart is what makes it impossible for a reviewed step to be recorded into: there
  // is no code path where the thing being displayed is also the thing being written.
  const view = viewFor(viewIndex, index);
  const viewedStep = steps[view.index] ?? step;
  const capturing = mayCapture(view);
  const demo = demoClipFor(viewedStep.module, viewedStep.task);
  const override = LABEL_OVERRIDE[viewedStep.task];
  const label = override ? t(override) : taskLabel(viewedStep.task, viewedStep.label_en, lang);
  // The oculomotor field wants the whole page dark: the light is the only bright thing.
  const dark = capturing && step.module === "M3";

  return (
    <JourneyShell
      sceneKey={`step-${view.index}-${view.mode}`}
      progress={progress}
      // Both always visible, never behind a menu — the same rule pause has always had.
      // Someone who wants to stop should not have to hunt for how.
      onPause={togglePause}
      onExit={() => setConfirmExit(true)}
      dark={dark}
      // Back is offered from the second step onward. It is a way to SEE what you did.
      leading={(canGoBack(view.index) || view.mode === "review") && (
        <nav aria-label={t("reviewNavLabel")} className="flex items-center gap-1">
          <button type="button"
            onClick={() => setViewIndex((v) => stepBack(v))}
            disabled={!canGoBack(view.index)}
            aria-label={t("stepBack")}
            className={[
              "focus-ring tactile inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg px-2 text-base disabled:opacity-40",
              dark ? "text-slate-300" : "text-muted-foreground",
            ].join(" ")}>
            <ArrowLeft className="h-5 w-5" aria-hidden />
            <span className="hidden min-[420px]:inline">{t("stepBack")}</span>
          </button>
          {view.mode === "review" && (
            <button type="button"
              onClick={() => setViewIndex((v) => stepForward(v, index))}
              disabled={!canGoForward(view.index, index)}
              aria-label={t("stepForward")}
              className="focus-ring tactile inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-line px-2 text-base disabled:opacity-40">
              <span className="hidden min-[420px]:inline">{t("stepForward")}</span>
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
          )}
        </nav>
      )}
    >

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

      {/* Keyed on the position: a new step is a new card and a new utterance; a retry of
          the same step is not. Aphasia mode: bigger, fewer words on screen at once —
          presentation only, the measured task is identical. */}
      <Instruction
        key={`${viewedStep.position}-${view.mode}`}
        text={label}
        large={patient.aphasia_mode}
        demo={demo}
        speakOnMount={capturing}
        className="mb-5"
      />
      {stepError && <div className="mb-4"><ErrorState message={stepError} /></div>}
      {retryNotice && (
        <p role="status"
          className="mb-4 rounded-xl border-2 border-watch/40 bg-watch-soft px-4 py-3 text-center text-lg text-foreground">
          {retryNotice}
        </p>
      )}

      {/* THE GUARD, in one place. No capture component exists in the tree while an
          earlier step is being reviewed, so there is no path by which a completed step's
          result can be discarded and retaken. Unlimited retakes would teach the baseline
          the patient's best attempt rather than their typical one. */}
      {capturing && (<>
      {step.task === "simple_and_choice_rt" && (
        <StepAttention key={`m10-${attempt}`} onDone={done("M10")} />
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
        <StepSpeech key={`m4-${attempt}`} onDone={done("M4")} onError={setStepError} />
      )}
      {step.task === "facial_battery" && (
        <StepFace
          key={`m1-${attempt}`}
          onDone={done("M1")}
          onError={setStepError}
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
        <StepTapping key={`m7-${attempt}`} onDone={done("M7")} />
      )}
      {/* Each question step at ITS position (D-061). The answers are held with the
          modules and submitted together at the end; before this the questionnaire step
          submitted the whole session, which ended a Comprehensive session at step 5. */}
      {(step.task === "phq2" || step.task === "medication_confirm") && (
        <StepQuestions
          key={`${step.task}-${attempt}`}
          part={step.task === "phq2" ? "phq2" : "meds"}
          onDone={(result: Partial<QuestionsResult>) => {
            const q = store.current.questions;
            if (result.phq2) q.phq2 = result.phq2;
            if (result.medicationTaken !== undefined) q.medicationTaken = result.medicationTaken;
            advance();
          }}
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

      {/* One quiet way past a step that cannot be done today — a camera that will not
          open, a hand that will not cooperate. Always reachable, never prominent. */}
      <button type="button" onClick={advance}
        className={[
          "focus-ring mt-8 min-h-12 w-full text-base underline underline-offset-4",
          dark ? "text-slate-400" : "text-muted-foreground",
        ].join(" ")}>
        {t("skipStep")}
      </button>
      </>)}
    </JourneyShell>
  );
}

export default ProtocolRunner;
