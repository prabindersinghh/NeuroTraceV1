/**
 * The soft timer — a ring that fills as a capture window passes.
 *
 * The number is still there, because "how long must I hold this?" is a fair question
 * and a hidden answer is its own anxiety. But it is small, tabular and quiet, and the
 * ring FILLS rather than drains: the same information, read as progress instead of as a
 * deadline. It is fed by the very countdown that closes the capture, so the ring and
 * the measurement can never disagree.
 *
 * Announced sparingly: every ten seconds and the last three, not every tick.
 */
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  seconds: number;
  remaining: number;
  /** Pixel size of the ring. */
  size?: number;
  /** Sits on top of a video frame: white on a dark scrim. */
  overlay?: boolean;
  className?: string;
}

const R = 44;
const C = 2 * Math.PI * R;

export function Ring({ seconds, remaining, size = 88, overlay = false, className }: Props) {
  const { t } = useI18n();
  const left = Math.max(0, Math.min(seconds, remaining));
  const done = seconds > 0 ? 1 - left / seconds : 1;
  const announce = left > 0 && (left % 10 === 0 || left <= 3);

  return (
    <div
      role="timer"
      className={cn(
        "relative grid place-items-center rounded-full",
        overlay && "bg-black/55 text-white",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle
          cx="50" cy="50" r={R} fill="none" strokeWidth="6"
          stroke={overlay ? "rgba(255,255,255,0.28)" : "hsl(var(--border))"}
        />
        <circle
          cx="50" cy="50" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
          stroke={overlay ? "#fff" : "hsl(var(--accent))"}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - done)}
          className="ring-fill"
        />
      </svg>
      <span
        aria-hidden
        className="relative font-semibold tabular-nums"
        style={{ fontSize: Math.round(size * 0.32) }}
      >
        {left}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce ? t("secondsLeft").replace("{n}", String(left)) : ""}
      </span>
    </div>
  );
}

export default Ring;
