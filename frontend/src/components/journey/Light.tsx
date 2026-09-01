/**
 * The light — the one interactive surface the path is built from.
 *
 * Tap it (M10, M7, the warm-up), hold it (the warm-up), watch it (M3's field uses its
 * own, darker version). Four states, and the "on" state is carried FOUR ways — brighter,
 * larger halo, a word, a haptic tick — so a patient who cannot tell the two blues apart,
 * or cannot read, or cannot feel the phone, still has two of the four.
 *
 * The press handler fires on POINTERDOWN, because that is the closest thing the browser
 * offers to the moment of contact and M10's latency is measured from it. The keyboard
 * path is keydown with repeats ignored, so holding Space does not become ten taps.
 *
 * No box-shadow. The halo is a second circle scaled behind the button; this product
 * draws no elevation shadows, and a transform is cheaper to animate anyway.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type LightState = "idle" | "waiting" | "on" | "done";

interface Props {
  state: LightState;
  /** Visible text or icon inside the light. */
  children?: ReactNode;
  /** Accessible name when the children are not text. */
  label?: string;
  onPress?: () => void;
  /** Hold interactions (the warm-up). */
  onRelease?: () => void;
  disabled?: boolean;
  /** 0..1 — draws a ring around the light that fills. Undefined draws no ring. */
  fill?: number;
  size?: "lg" | "md";
  className?: string;
}

const SIZE = {
  lg: "h-[min(60vw,15rem)] w-[min(60vw,15rem)]",
  md: "h-[min(44vw,11rem)] w-[min(44vw,11rem)]",
};

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

export function Light({
  state, children, label, onPress, onRelease, disabled, fill, size = "lg", className,
}: Props) {
  const on = state === "on";
  return (
    <div className={cn("relative grid place-items-center", className)}>
      <span
        aria-hidden
        className={cn(
          "light-halo absolute rounded-full bg-accent/15",
          SIZE[size],
          on ? "scale-[1.28] opacity-100" : "scale-100 opacity-0",
        )}
      />
      {fill !== undefined && (
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className={cn("absolute -rotate-90", SIZE[size], "scale-[1.16]")}
        >
          <circle cx="50" cy="50" r={RING_R} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
          <circle
            cx="50" cy="50" r={RING_R} fill="none"
            stroke="hsl(var(--accent))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - Math.max(0, Math.min(1, fill)))}
          />
        </svg>
      )}
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.pointerType === "mouse") return;
          onPress?.();
        }}
        onPointerUp={() => onRelease?.()}
        onPointerCancel={() => onRelease?.()}
        onPointerLeave={() => onRelease?.()}
        onKeyDown={(e) => {
          if (e.repeat) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onPress?.();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") onRelease?.();
        }}
        className={cn(
          "focus-ring relative grid select-none place-items-center rounded-full border-2",
          "text-title-1 transition-[background-color,border-color,color] duration-150",
          "touch-manipulation disabled:opacity-100",
          SIZE[size],
          state === "idle" && "border-line bg-secondary text-primary",
          state === "waiting" && "breathe border-line bg-secondary text-muted-foreground",
          on && "border-accent bg-accent text-accent-foreground",
          state === "done" && "border-accent/40 bg-secondary text-accent",
        )}
      >
        {children}
      </button>
    </div>
  );
}

export default Light;
