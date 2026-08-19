/**
 * M13 mood (PHQ-2) and M19 medication adherence. ~12 seconds total.
 *
 * PHQ-2 is here for two reasons, and the second is the less obvious one:
 *
 *   1. Post-stroke depression affects 11-41% and is a monitored condition in its own right.
 *   2. Depression slows reaction time, flattens prosody and reduces speech output. Without
 *      measuring mood, a depressive episode is indistinguishable from neurological decline
 *      on every other module in the battery. A PHQ shift is wired into the confounder layer
 *      precisely so it can *explain* other domains rather than compete with them.
 *
 * Answers are the four validated PHQ response options, rendered as large buttons rather
 * than a slider or a number — the patient may be aphasic, and a slider requires reading a
 * scale.
 */
import { Pill } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n, type StringKey } from "@/lib/i18n";
import { speak } from "@/lib/speech-synthesis";
import { cn } from "@/lib/utils";

const OPTIONS: { value: number; label: StringKey }[] = [
  { value: 0, label: "phqNever" },
  { value: 1, label: "phqSome" },
  { value: 2, label: "phqMost" },
  { value: 3, label: "phqEvery" },
];

const QUESTIONS: StringKey[] = ["phq1", "phq2"];

export interface QuestionsResult {
  phq2: number[];
  medicationTaken: boolean;
}

interface Props {
  onDone: (result: QuestionsResult) => void;
  onSkip: () => void;
}

export function StepQuestions({ onDone, onSkip }: Props) {
  const { t, lang } = useI18n();
  const [answers, setAnswers] = useState<number[]>([]);
  const [step, setStep] = useState(0);

  function answer(value: number) {
    const next = [...answers, value];
    setAnswers(next);
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1);
      speak(t(QUESTIONS[step + 1]), lang);
    } else {
      setStep(QUESTIONS.length);
      speak(t("medsTitle"), lang);
    }
  }

  const onMedication = (taken: boolean) => onDone({ phq2: answers, medicationTaken: taken });
  const askingMeds = step >= QUESTIONS.length;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h2 className="text-2xl font-semibold">{askingMeds ? t("medsTitle") : t("moodTitle")}</h2>

      {askingMeds ? (
        <>
          <Pill className="h-16 w-16 text-accent" aria-hidden />
          <div className="flex w-full max-w-sm flex-col gap-3">
            <Button size="touch" variant="accent" onClick={() => onMedication(true)}>
              {t("yes")}
            </Button>
            <Button size="touch" variant="outline" onClick={() => onMedication(false)}>
              {t("notYet")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xl leading-relaxed" aria-live="polite">
            {t(QUESTIONS[step])}
          </p>
          <div className="flex w-full max-w-sm flex-col gap-3">
            {OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => answer(option.value)}
                className={cn(
                  "rounded-xl border-2 border-border bg-card px-5 py-4 text-xl font-medium",
                  "transition-colors hover:border-accent hover:bg-accent/5 focus-ring",
                )}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          <div className="flex gap-2" aria-label="progress">
            {QUESTIONS.map((q, i) => (
              <span
                key={q}
                className={cn(
                  "h-2.5 w-10 rounded-full",
                  i < step ? "bg-stable" : i === step ? "bg-accent" : "bg-secondary",
                )}
              />
            ))}
          </div>
          <Button variant="link" onClick={onSkip}>
            {t("skipStep")}
          </Button>
        </>
      )}
    </div>
  );
}
