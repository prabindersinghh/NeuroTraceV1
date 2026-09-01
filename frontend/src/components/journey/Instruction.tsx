/**
 * The instruction card — one sentence, spoken as it appears, repeatable on demand.
 *
 * Spoken HERE and not in the runner, for an ordering reason that cost the product its
 * recall words: React runs sibling effects in tree order, so a step that speaks its own
 * content (M11's five words) used to be cancelled by the runner's label a moment later.
 * The card is rendered above the step, its effect fires first, and a step that wants to
 * add speech queues it (`speak(..., { queue: true })`).
 *
 * Keyed by the caller on the step position, so a new step is a new card and a new
 * utterance; a retry of the same step is not.
 */
import { Volume2 } from "lucide-react";
import { useEffect } from "react";

import { useI18n } from "@/lib/i18n";
import { isSpeechSupported, speak } from "@/lib/speech-synthesis";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  /** Aphasia mode: bigger, fewer words on screen at once. Presentation only. */
  large?: boolean;
  /** A looping demonstration clip, when one exists (lib/demoClips.ts). */
  demo?: string;
  /** Speak on mount. Off while an earlier step is being reviewed. */
  speakOnMount?: boolean;
  className?: string;
}

export function Instruction({ text, large = false, demo, speakOnMount = true, className }: Props) {
  const { t, lang } = useI18n();

  useEffect(() => {
    if (speakOnMount) speak(text, lang);
    // Once per card: the card is keyed by step, and re-speaking on every render of the
    // same step would talk over the patient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <h2
        id="scene-title"
        tabIndex={-1}
        className={cn("focus:outline-none", large ? "text-title-1" : "text-title-2")}
      >
        {text}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {isSpeechSupported() && (
          <button
            type="button"
            onClick={() => speak(text, lang)}
            className="focus-ring tactile inline-flex min-h-12 items-center gap-2 rounded-lg px-3 text-base text-accent"
          >
            <Volume2 className="h-5 w-5" aria-hidden />
            {t("listenAgain")}
          </button>
        )}
      </div>
      {demo && (
        <video
          src={demo} autoPlay loop muted playsInline
          aria-label={t("watchHow")}
          className="max-h-44 w-full rounded-xl border border-line object-cover"
        />
      )}
    </div>
  );
}

export default Instruction;
