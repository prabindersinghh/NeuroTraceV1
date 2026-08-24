/**
 * Ninety days — one measured, then all ninety.
 *
 * The README's number, drawn, and then answered. At the top of the section this is the
 * record a neurologist actually has between appointments: one square out of ninety, and no
 * information at all about the other eighty-nine. As the visitor scrolls, the rest fill in.
 * That sweep is the product in one image, and it costs less to understand than the
 * paragraph beside it.
 *
 * HOW IT MOVES. Two stacked grids — the sparse record underneath, the complete one on top
 * — and the top one is revealed by a soft mask whose edge is driven from the scroll ticker
 * as a single CSS custom property. One style write per frame on one element, instead of
 * ninety. The wave is the mask's gradient, so the fill has a leading edge rather than a
 * hard wipe.
 */
import { useRef, useState } from "react";

import { DURATION, EASE, useInView, usePrefersReducedMotion, useScrollScene } from "@/lib/motion";

const DAYS = 90;
/** The appointment. Late in the window, because that is when it is remembered. */
const CLINIC_DAY = 74;

const GRID = "grid gap-[5px] [grid-template-columns:repeat(auto-fill,minmax(14px,1fr))]";

function Cells({ variant }: { variant: "record" | "measured" }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: DAYS }, (_, i) => (
        <span
          key={i}
          className="block aspect-square rounded-[3px]"
          style={{
            background: variant === "measured"
              ? "hsl(var(--accent))"
              : i === CLINIC_DAY ? "hsl(var(--foreground))" : "hsl(var(--muted))",
          }}
        />
      ))}
    </div>
  );
}

export function NinetyDays({ complete = false }: { complete?: boolean }) {
  if (complete) {
    // The closing echo: the same ninety days, all of them measured. No scroll behaviour —
    // by the time this is on screen the argument has already been made.
    return (
      <div role="img" aria-label="Ninety consecutive days, every one of them measured at home.">
        <Cells variant="measured" />
      </div>
    );
  }
  return <NinetyDaysScene />;
}

function NinetyDaysScene() {
  const reduced = usePrefersReducedMotion();
  const { ref: seenRef, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -15% 0px" });
  const maskRef = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(reduced);

  const sceneRef = useScrollScene<HTMLDivElement>((p) => {
    if (reduced) return;
    // Hold the sparse record for the first third — the visitor has to see the problem
    // before it is answered, and a fill that starts immediately reads as decoration.
    const edge = Math.min(1, Math.max(0, (p - 0.34) / 0.42));
    maskRef.current?.style.setProperty("--edge", `${edge * 118 - 9}%`);
    setFilled((prev) => (prev === edge > 0.55 ? prev : edge > 0.55));
  }, "through");

  const attach = (el: HTMLDivElement | null) => {
    sceneRef.current = el;
    (seenRef as { current: HTMLDivElement | null }).current = el;
  };

  return (
    <div ref={attach}>
      <div
        className="relative"
        role="img"
        aria-label={
          "Ninety days between neurology appointments. One day is examined and eighty-nine "
          + "are not — then every one of them is measured at home."
        }
      >
        <div
          style={{
            opacity: reduced || inView ? 1 : 0,
            transition: reduced ? undefined : `opacity ${DURATION.medium}ms ${EASE.out}`,
          }}
        >
          <Cells variant="record" />
        </div>

        <div
          ref={maskRef}
          className="absolute inset-0"
          style={{
            // The leading edge of the fill. `--edge` is written from the ticker.
            ["--edge" as string]: reduced ? "109%" : "-9%",
            WebkitMaskImage:
              "linear-gradient(90deg, #000 0%, #000 var(--edge), transparent calc(var(--edge) + 9%))",
            maskImage:
              "linear-gradient(90deg, #000 0%, #000 var(--edge), transparent calc(var(--edge) + 9%))",
          }}
        >
          <Cells variant="measured" />
        </div>
      </div>

      <p className="mt-3.5 font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-muted-foreground">
        <span
          style={{
            opacity: filled ? 0 : 1,
            transition: `opacity ${DURATION.fast}ms ${EASE.standard}`,
          }}
        >
          ■ examined&nbsp;&nbsp;·&nbsp;&nbsp;□ eighty-nine days nobody looked
        </span>
        <span
          className="block"
          style={{
            marginTop: filled ? "-1.05rem" : 0,
            opacity: filled ? 1 : 0,
            color: filled ? "hsl(var(--accent))" : undefined,
            transition: `opacity ${DURATION.fast}ms ${EASE.standard}`,
          }}
        >
          ■ ninety mornings, ninety seconds each
        </span>
      </p>
    </div>
  );
}
