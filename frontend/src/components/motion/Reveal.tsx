/**
 * The two reveal primitives the whole signed-out surface is built from.
 *
 * Deliberately only two. A page where every element has its own bespoke entrance reads as
 * restless; a page where everything arrives the same way, at the same speed, on the same
 * curve, reads as designed. `Reveal` is for blocks, `LineReveal` is for display type.
 */
import { type ElementType, type ReactNode } from "react";

import { DURATION, EASE, STAGGER, useInView, usePrefersReducedMotion } from "@/lib/motion";

interface RevealProps {
  children: ReactNode;
  /** Index in a sequence; multiplied by the shared stagger step. */
  step?: number;
  /** Extra delay in ms, on top of the stagger. */
  delay?: number;
  as?: ElementType;
  className?: string;
  /** Travel distance in px. 0 for a pure fade. */
  y?: number;
}

export function Reveal({ children, step = 0, delay = 0, as: Tag = "div", className, y = 16 }: RevealProps) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>();
  const shown = reduced || inView;

  return (
    <Tag
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : `translate3d(0, ${y}px, 0)`,
        transition: reduced
          ? undefined
          : `opacity ${DURATION.medium}ms ${EASE.out} ${step * STAGGER + delay}ms,`
            + ` transform ${DURATION.medium}ms ${EASE.out} ${step * STAGGER + delay}ms`,
        willChange: shown ? undefined : "opacity, transform",
      }}
    >
      {children}
    </Tag>
  );
}

/**
 * Display type, revealed a line at a time from behind its own baseline.
 *
 * The caller supplies the line breaks rather than the component measuring them: a
 * ResizeObserver-driven line splitter is the usual approach and it reflows the headline on
 * every breakpoint change, which is exactly the layout thrash this page cannot afford.
 * Each line stays a single text node, so the heading reads normally to a screen reader.
 */
export function LineReveal({
  lines, as: Tag = "span", className, lineClassName, step = 0,
}: {
  lines: ReactNode[];
  as?: ElementType;
  className?: string;
  lineClassName?: string;
  step?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLSpanElement>({ rootMargin: "0px" });
  const shown = reduced || inView;

  return (
    <Tag ref={ref} className={className}>
      {lines.map((line, i) => (
        // eslint-disable-next-line react/no-array-index-key -- the lines are static copy
        <span key={i} className="block overflow-hidden pb-[0.16em]">
          <span
            className={lineClassName ?? "block"}
            style={{
              display: "block",
              transform: shown ? "none" : "translate3d(0, 105%, 0)",
              opacity: shown ? 1 : 0,
              transition: reduced
                ? undefined
                : `transform ${DURATION.slow}ms ${EASE.out} ${(step + i) * 90}ms,`
                  + ` opacity ${DURATION.medium}ms linear ${(step + i) * 90}ms`,
            }}
          >
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}
