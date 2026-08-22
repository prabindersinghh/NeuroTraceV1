/**
 * M21 — Subjective Visual Vertical capture.
 *
 * The patient sees a line and turns a dial until it looks upright to them. The difference
 * between where they set it and true vertical is the measurement.
 *
 * Why this module exists: dynamic clockwise SVV was one of only three abnormalities on the
 * reference patient's entire 17-page vestibular battery, and nothing else we build touches
 * the graviceptive pathway. Sway says the patient is unsteady; SVV says their internal
 * sense of upright is wrong, which is a different and more localising thing.
 *
 * THREE THINGS THIS SCREEN MUST GET RIGHT
 *
 * 1. The phone's own orientation is the confound. If the patient tilts the handset, "true
 *    vertical" on screen is no longer true vertical in the world. We read the device
 *    orientation where the browser allows it and subtract it; where we cannot, we say so
 *    and mark the capture accordingly rather than reporting a number we cannot trust.
 *
 * 2. No feedback between trials. If the patient learns they were 5° clockwise last time
 *    they will correct for it, and the accumulation that made the reference patient's
 *    clockwise trials climb 3.5 → 17.5° would be trained away. The dial starts at a random
 *    offset each trial for the same reason.
 *
 * 3. Stopping must be one tap, always visible. A rotating full-field background given to
 *    someone who already has vertigo can make them genuinely sick. An aborted run is
 *    recorded as aborted — never as a score of zero, which would read as a perfect result.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../../components/ui/button";
import { useI18n } from "../../lib/i18n";

type Condition = "static" | "dynamic_cw" | "dynamic_acw";

const TRIALS_PER_CONDITION = 6;
const CONDITIONS: Condition[] = ["static", "dynamic_cw", "dynamic_acw"];
/** Degrees per second of background rotation. Slow enough to be tolerable. */
const ROTATION_DEG_S = 30;

const CONDITION_LABEL: Record<Condition, Record<string, string>> = {
  static: {
    en: "Set the line upright",
    hi: "रेखा को सीधा कीजिए",
    pa: "ਰੇਖਾ ਨੂੰ ਸਿੱਧਾ ਕਰੋ",
  },
  dynamic_cw: {
    en: "Set it upright — ignore the moving dots",
    hi: "इसे सीधा कीजिए — चलते बिंदुओं पर ध्यान न दें",
    pa: "ਇਸਨੂੰ ਸਿੱਧਾ ਕਰੋ — ਚੱਲਦੇ ਬਿੰਦੂਆਂ ਵੱਲ ਧਿਆਨ ਨਾ ਦਿਓ",
  },
  dynamic_acw: {
    en: "Set it upright — ignore the moving dots",
    hi: "इसे सीधा कीजिए — चलते बिंदुओं पर ध्यान न दें",
    pa: "ਇਸਨੂੰ ਸਿੱਧਾ ਕਰੋ — ਚੱਲਦੇ ਬਿੰਦੂਆਂ ਵੱਲ ਧਿਆਨ ਨਾ ਦਿਓ",
  },
};

export interface SvvResult {
  static: number[];
  dynamic_cw: number[];
  dynamic_acw: number[];
  aborted: boolean;
  device_tilt_compensated: boolean;
}

export default function StepSvv({
  onComplete,
}: {
  onComplete: (result: SvvResult) => void;
}) {
  const { lang } = useI18n();
  const [conditionIndex, setConditionIndex] = useState(0);
  const [trial, setTrial] = useState(0);
  // Random start each trial so the patient cannot carry a correction across trials.
  const [angle, setAngle] = useState(() => (Math.random() - 0.5) * 40);
  const [results, setResults] = useState<Record<Condition, number[]>>({
    static: [],
    dynamic_cw: [],
    dynamic_acw: [],
  });
  const [rotation, setRotation] = useState(0);
  const [deviceTilt, setDeviceTilt] = useState<number | null>(null);
  const raf = useRef<number | null>(null);

  const condition = CONDITIONS[conditionIndex];
  const isDynamic = condition !== "static";

  // --- device orientation: the confound, handled or declared ---
  useEffect(() => {
    function onOrient(e: DeviceOrientationEvent) {
      // gamma is left-right tilt in degrees. Null on desktop and on browsers that
      // withhold it without a permission gesture.
      if (typeof e.gamma === "number") setDeviceTilt(e.gamma);
    }
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, []);

  // --- rotating background for the dynamic conditions ---
  useEffect(() => {
    if (!isDynamic) {
      setRotation(0);
      return;
    }
    const dir = condition === "dynamic_cw" ? 1 : -1;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setRotation((r) => (r + dir * ROTATION_DEG_S * dt) % 360);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [condition, isDynamic]);

  const confirm = useCallback(() => {
    // Subtract the handset's own tilt so we measure the patient, not how they are holding
    // the phone. Where the browser withholds orientation we record the raw setting and
    // flag the capture as uncompensated.
    const corrected = deviceTilt === null ? angle : angle - deviceTilt;
    const next = { ...results, [condition]: [...results[condition], corrected] };
    setResults(next);

    if (trial + 1 < TRIALS_PER_CONDITION) {
      setTrial(trial + 1);
    } else if (conditionIndex + 1 < CONDITIONS.length) {
      setConditionIndex(conditionIndex + 1);
      setTrial(0);
    } else {
      onComplete({
        static: next.static,
        dynamic_cw: next.dynamic_cw,
        dynamic_acw: next.dynamic_acw,
        aborted: false,
        device_tilt_compensated: deviceTilt !== null,
      });
      return;
    }
    // New random start. No feedback about the previous trial, ever.
    setAngle((Math.random() - 0.5) * 40);
  }, [angle, condition, conditionIndex, deviceTilt, onComplete, results, trial]);

  function abort() {
    onComplete({
      static: results.static,
      dynamic_cw: results.dynamic_cw,
      dynamic_acw: results.dynamic_acw,
      aborted: true,
      device_tilt_compensated: deviceTilt !== null,
    });
  }

  const totalTrials = CONDITIONS.length * TRIALS_PER_CONDITION;
  const done = conditionIndex * TRIALS_PER_CONDITION + trial;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{CONDITION_LABEL[condition][lang]}</h2>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={totalTrials}
        >
          <div
            className="h-full bg-sky-600 transition-all"
            style={{ width: `${(done / totalTrials) * 100}%` }}
          />
        </div>
      </header>

      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
        {/* Rotating dot field. Only present in the dynamic conditions — it is the thing
            that drags perceived vertical, and it is also what can cause nausea. */}
        {isDynamic && (
          <div
            className="absolute inset-0"
            style={{ transform: `rotate(${rotation}deg)` }}
            aria-hidden
          >
            {Array.from({ length: 60 }, (_, i) => {
              const a = (i / 60) * Math.PI * 2;
              const r = 20 + ((i * 37) % 60);
              return (
                <span
                  key={i}
                  className="absolute h-1.5 w-1.5 rounded-full bg-slate-500"
                  style={{
                    left: `${50 + Math.cos(a) * r * 0.8}%`,
                    top: `${50 + Math.sin(a) * r * 0.8}%`,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* The line. No reference marks anywhere — a frame edge or a tick would give the
            patient a visual cue and turn this into a matching task. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ transform: `rotate(${angle}deg)` }}
        >
          <div className="h-[70%] w-1 rounded bg-amber-300" />
        </div>
      </div>

      <label className="space-y-1">
        <span className="text-sm text-muted-foreground">
          {{ en: "Turn until it looks upright", hi: "जब तक सीधा न लगे, घुमाइए",
             pa: "ਜਦੋਂ ਤੱਕ ਸਿੱਧਾ ਨਾ ਲੱਗੇ, ਘੁਮਾਓ" }[lang]}
        </span>
        <input
          type="range"
          min={-45}
          max={45}
          step={0.5}
          value={angle}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="h-12 w-full"
          aria-label="line angle"
        />
      </label>

      <Button className="min-h-14 w-full text-base" onClick={confirm}>
        {{ en: "This looks upright", hi: "यह सीधा लग रहा है",
           pa: "ਇਹ ਸਿੱਧਾ ਲੱਗ ਰਿਹਾ ਹੈ" }[lang]}
      </Button>

      {/* Always visible, never behind a menu. */}
      <button
        type="button"
        onClick={abort}
        className="min-h-12 w-full rounded-lg border border-amber-400 text-sm
                   text-amber-800 dark:text-amber-200"
      >
        {{ en: "Stop — I feel unwell", hi: "रोकिए — तबीयत ठीक नहीं",
           pa: "ਰੋਕੋ — ਤਬੀਅਤ ਠੀਕ ਨਹੀਂ" }[lang]}
      </button>

      {deviceTilt === null && (
        <p className="text-xs text-muted-foreground">
          Hold the phone straight up. This device does not report its own tilt, so the
          result assumes the phone is upright.
        </p>
      )}
    </div>
  );
}
