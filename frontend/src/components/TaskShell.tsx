/**
 * The universal task pattern (SPEC v4 Part 3).
 *
 *   DEMO → INSTRUCT → POSITION → COUNTDOWN → PERFORM → QUALITY → CONFIRM
 *
 * ⚠ NOT YET WIRED INTO THE LIVE PROTOCOL. As of 2026-08, nothing renders this component.
 * `ProtocolRunner` imports the eleven Step* components directly and wraps them in its own
 * frame, so the machine described below is a design, not a shipped guarantee. The header
 * used to say "every task, no exceptions", which was read by every subsequent reader as a
 * statement of fact about the running app — it was not, and a comment that asserts a
 * safety property the code does not enforce is worse than no comment.
 *
 * Whether to route the runner through this component or retire it is a deliberate open
 * decision, to be taken on its own branch and ideally after physical-phone validation —
 * see UX-CHANGES.md, "Deferred — needs its own PLAN". Until then the LIVE rules are
 * enforced in `ProtocolRunner` and pinned by `lib/taskFlow.test.ts`; the two-retry limit
 * itself is shared from `lib/taskFlow.ts` so the two cannot drift apart.
 *
 * What the pattern is FOR, if it is adopted: guaranteeing that the twentieth task of a
 * twelve-minute session behaves exactly like the first, when whoever built it was tired
 * and tempted to skip the framing guide.
 *
 * THREE RULES THIS ENFORCES STRUCTURALLY
 *
 * NEVER SHOW A SCORE. The confirm state is a neutral tick. Not "good job" — patronising to
 * an adult who was recently independent — and never "poor", which teaches a patient that
 * the app is where they go to be told they are declining. Scores are for the caregiver
 * dashboard and the clinician, after aggregation, never at the moment of performance.
 *
 * TWO RETRIES, THEN MOVE ON. A patient asked a third time to repeat something they cannot
 * do is being told they are failing. We mark the capture low-quality and continue; a
 * missing measurement is recoverable, an abandoned patient is not.
 *
 * PAUSE IS ALWAYS VISIBLE. Not in a menu. The session resumes where it stopped and does not
 * invalidate — but the pause IS recorded, because tasks performed after a rest are measured
 * against a baseline built without one.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";
import { MAX_RETRIES } from "../lib/taskFlow";

export type Phase =
  | "demo" | "instruct" | "position" | "countdown" | "perform" | "quality" | "confirm";

export interface TaskShellProps {
  /** Module code, e.g. "M7". */
  module: string;
  /** 1-indexed position in the protocol — recorded with the result. */
  position: number;
  totalSteps: number;
  /** One short sentence. Never a paragraph. */
  instruction: string;
  /** Looping demo clip. Shown by default for the first 5 sessions. */
  demoSrc?: string;
  showDemoByDefault?: boolean;
  /** Seconds the perform phase runs; omit for trial-based tasks. */
  durationSeconds?: number;
  /** Trial-based tasks show "4 of 12" instead of a timer. */
  trialsDone?: number;
  trialsTotal?: number;
  /** Live framing check. Returns true when the patient is correctly positioned. */
  framingOk?: boolean;
  /** Rendered during the perform phase — the actual task. */
  children?: React.ReactNode;
  onStart?: () => void;
  onFinish: (outcome: { retries: number; skipped: boolean; lowQuality: boolean }) => void;
  onPause: () => void;
  /** Called after perform; false means "we could not see clearly". */
  assessQuality?: () => boolean;
}


const COPY = {
  ready: { en: "Ready", hi: "तैयार", pa: "ਤਿਆਰ" },
  watch: { en: "Watch how", hi: "देखिए कैसे", pa: "ਦੇਖੋ ਕਿਵੇਂ" },
  // The outline renders `border-accent` — BLUE. This copy said "green" in all three
  // languages, which was both factually wrong and a reference to a colour the design
  // system forbids as a status (index.css: a green "all clear" invites a family to stop
  // looking). Describing the shape rather than the colour also survives any future
  // re-theming, and works for a patient who cannot distinguish the two hues.
  position: {
    en: "Move until the outline lights up",
    hi: "रूपरेखा जगमगाने तक अपनी जगह ठीक कीजिए",
    pa: "ਰੂਪਰੇਖਾ ਜਗਮਗਾਉਣ ਤੱਕ ਆਪਣੀ ਥਾਂ ਠੀਕ ਕਰੋ",
  },
  start: { en: "Start", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" },
  pause: { en: "Pause", hi: "रोकें", pa: "ਰੋਕੋ" },
  skip: { en: "Skip this one", hi: "इसे छोड़ें", pa: "ਇਹ ਛੱਡੋ" },
  retry: {
    en: "We couldn't see clearly — try once more?",
    hi: "ठीक से दिखा नहीं — एक बार और?",
    pa: "ਠੀਕ ਤਰ੍ਹਾਂ ਦਿਖਿਆ ਨਹੀਂ — ਇੱਕ ਵਾਰ ਹੋਰ?",
  },
  again: { en: "Try again", hi: "फिर कोशिश करें", pa: "ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ" },
  done: { en: "Done", hi: "हो गया", pa: "ਹੋ ਗਿਆ" },
} as const;

export function TaskShell(props: TaskShellProps) {
  const { lang } = useI18n();
  const {
    instruction, demoSrc, showDemoByDefault = true, durationSeconds,
    trialsDone, trialsTotal, framingOk = true, children,
    onStart, onFinish, onPause, assessQuality, position, totalSteps,
  } = props;

  const [phase, setPhase] = useState<Phase>(showDemoByDefault && demoSrc ? "demo" : "instruct");
  const [count, setCount] = useState(3);
  const [remaining, setRemaining] = useState(durationSeconds ?? 0);
  const [retries, setRetries] = useState(0);
  const spoken = useRef(false);

  // Every instruction is spoken as well as shown. This population includes people with
  // aphasia and people who do not read; a written-only instruction excludes them.
  useEffect(() => {
    if (phase !== "instruct" || spoken.current) return;
    spoken.current = true;
    try {
      const u = new SpeechSynthesisUtterance(instruction);
      u.lang = { en: "en-IN", hi: "hi-IN", pa: "pa-IN" }[lang] ?? "en-IN";
      u.rate = 0.9;
      window.speechSynthesis?.speak(u);
    } catch {
      /* speech synthesis unavailable — the text is still on screen */
    }
  }, [phase, instruction, lang]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      setPhase("perform");
      onStart?.();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(t);
  }, [phase, count, onStart]);

  useEffect(() => {
    if (phase !== "perform" || !durationSeconds) return;
    if (remaining <= 0) {
      setPhase(assessQuality ? "quality" : "confirm");
      return;
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, durationSeconds, assessQuality]);

  useEffect(() => {
    if (phase !== "quality") return;
    const good = assessQuality?.() ?? true;
    if (good) setPhase("confirm");
    // A bad capture stays on the quality screen so the patient can choose to retry.
  }, [phase, assessQuality]);

  const retry = useCallback(() => {
    setRetries((r) => r + 1);
    setRemaining(durationSeconds ?? 0);
    setCount(3);
    setPhase("countdown");
  }, [durationSeconds]);

  const finish = useCallback(
    (opts: { skipped?: boolean; lowQuality?: boolean } = {}) =>
      onFinish({ retries, skipped: Boolean(opts.skipped), lowQuality: Boolean(opts.lowQuality) }),
    [onFinish, retries],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-5">
      <header className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {position} / {totalSteps}
        </span>
        {/* Always visible. Never behind a menu. */}
        <button
          type="button"
          onClick={onPause}
          className="min-h-11 rounded-lg border border-line px-4 text-base"
        >
          {COPY.pause[lang]}
        </button>
      </header>

      {phase === "demo" && demoSrc && (
        <>
          <p className="text-xl">{COPY.watch[lang]}</p>
          <video
            src={demoSrc}
            autoPlay loop muted playsInline
            className="w-full rounded-lg border"
          />
          <Button className="min-h-16 w-full text-lg" onClick={() => setPhase("instruct")}>
            {COPY.ready[lang]}
          </Button>
        </>
      )}

      {phase === "instruct" && (
        <>
          <p className="text-2xl leading-snug">{instruction}</p>
          {demoSrc && (
            <button
              type="button"
              onClick={() => setPhase("demo")}
              className="min-h-11 text-base text-accent underline"
            >
              {COPY.watch[lang]}
            </button>
          )}
          <Button className="min-h-16 w-full text-lg" onClick={() => setPhase("position")}>
            {COPY.ready[lang]}
          </Button>
        </>
      )}

      {phase === "position" && (
        <>
          <p className="text-xl">{COPY.position[lang]}</p>
          <div
            className={[
              "aspect-square w-full rounded-lg border-4 transition-colors",
              framingOk ? "border-accent" : "border-line",
            ].join(" ")}
          >
            {children}
          </div>
          {/* Cannot start until framing is correct — a badly framed capture is a wasted
              attempt and a retry the patient did not need to make. */}
          <Button
            className="min-h-16 w-full text-lg"
            disabled={!framingOk}
            onClick={() => setPhase("countdown")}
          >
            {COPY.start[lang]}
          </Button>
        </>
      )}

      {phase === "countdown" && (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-8xl font-semibold tabular-nums">{count || "•"}</span>
        </div>
      )}

      {phase === "perform" && (
        <>
          <p className="text-xl">{instruction}</p>
          <div className="flex-1">{children}</div>
          {durationSeconds ? (
            <p className="text-center text-4xl font-semibold tabular-nums">{remaining}</p>
          ) : trialsTotal ? (
            <p className="text-center text-xl tabular-nums">
              {trialsDone ?? 0} / {trialsTotal}
            </p>
          ) : null}
        </>
      )}

      {phase === "quality" && (
        <>
          <p className="text-xl">{COPY.retry[lang]}</p>
          {retries < MAX_RETRIES ? (
            <Button className="min-h-16 w-full text-lg" onClick={retry}>
              {COPY.again[lang]}
            </Button>
          ) : null}
          {/* After two retries we stop asking. A third request is telling someone they
              are failing. */}
          <button
            type="button"
            onClick={() => finish({ lowQuality: true })}
            className="min-h-14 w-full rounded-lg border border-line text-base"
          >
            {COPY.skip[lang]}
          </button>
        </>
      )}

      {phase === "confirm" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          {/* A neutral tick. Never a score, never praise, never criticism. */}
          <span className="text-6xl text-accent" aria-hidden>
            ✓
          </span>
          <p className="text-xl">{COPY.done[lang]}</p>
          <Button className="min-h-16 w-full text-lg" onClick={() => finish()}>
            {COPY.ready[lang]}
          </Button>
        </div>
      )}

      {phase !== "confirm" && phase !== "quality" && (
        <button
          type="button"
          onClick={() => finish({ skipped: true })}
          className="min-h-12 w-full text-sm text-muted-foreground underline"
        >
          {COPY.skip[lang]}
        </button>
      )}
    </div>
  );
}

export default TaskShell;
