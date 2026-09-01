/**
 * The frame every screen of the check-in sits inside.
 *
 * What stays put: the controls (Pause and Exit — both always visible, never behind a
 * menu, the rule the runner has always had) and the path. What changes: the scene
 * inside, which arrives with one short motion. Because the frame never leaves, a step
 * ending and the next beginning reads as the same place rather than a cut to black.
 *
 * Focus follows the scene: whatever scene mounts, its `#scene-title` receives focus
 * without scrolling, so a screen-reader user hears where they are and a keyboard user
 * is never left on a control that just disappeared.
 *
 * `data-motion` and `data-text` carry the patient's comfort switches to CSS; the OS
 * reduced-motion setting is honoured by the global backstop regardless.
 */
import { Pause, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";

import { PathProgress } from "./PathProgress";

interface Progress {
  total: number;
  completed: number;
  chapterStarts: number[];
  finished?: boolean;
}

interface Props {
  /** Changes when the scene changes; replays the arrival motion and moves focus. */
  sceneKey: string;
  progress?: Progress | null;
  onPause?: () => void;
  onExit?: () => void;
  /** The oculomotor field wants the page dark behind it. */
  dark?: boolean;
  /** Left of the controls: the view-only Back / Forward on a step. */
  leading?: ReactNode;
  children: ReactNode;
}

export function JourneyShell({ sceneKey, progress, onPause, onExit, dark = false, leading, children }: Props) {
  const { t } = useI18n();
  const [prefs] = usePrefs();

  useEffect(() => {
    const el = document.getElementById("scene-title");
    el?.focus({ preventScroll: true });
  }, [sceneKey]);

  return (
    <div
      data-motion={prefs.lowMotion ? "low" : undefined}
      data-text={prefs.largeText ? "large" : undefined}
      className={cn(
        "patient-scale mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 py-4",
        "transition-colors duration-500",
        dark && "bg-slate-950 text-slate-100",
      )}
    >
      {(onPause || onExit || leading) && (
        <header className="mb-3 flex min-h-11 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">{leading}</div>
          <div className="flex shrink-0 items-center gap-2">
            {onPause && (
              <button
                type="button"
                onClick={onPause}
                className={cn(
                  "focus-ring tactile inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-4 text-base",
                  dark ? "border-slate-700" : "border-line",
                )}
              >
                <Pause className="h-5 w-5" aria-hidden />
                {t("pause")}
              </button>
            )}
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className={cn(
                  "focus-ring tactile inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-4 text-base",
                  dark ? "border-slate-700" : "border-line",
                )}
              >
                <X className="h-5 w-5" aria-hidden />
                {t("exitShort")}
              </button>
            )}
          </div>
        </header>
      )}

      {progress && (
        <PathProgress
          total={progress.total}
          completed={progress.completed}
          chapterStarts={progress.chapterStarts}
          finished={progress.finished}
          className={cn("mb-5", dark && "text-slate-200")}
        />
      )}

      <div key={sceneKey} className="journey-in flex flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}

export default JourneyShell;
