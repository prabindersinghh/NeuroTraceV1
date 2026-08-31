/**
 * The page and section furniture every app screen uses.
 *
 * WHY THIS EXISTS. The landing page reads as a serious piece of software and the app did
 * not, and the difference was not taste — it was a vocabulary the app simply never had.
 * Measured on the landing page: `font-mono` 75 times, `uppercase` + `tracking-[0.2em]` 26
 * times, `border-t`/`border-b` 15 times, `py-16` 8 times, and a fluid
 * `clamp(1.75rem,3.4vw,2.6rem)` title. The app instead had sans-serif labels inside
 * rounded boxes with no rhythm.
 *
 * So: a mono, wide-tracked, uppercase eyebrow; a fluid title; a hairline rule instead of
 * another card border; and one vertical rhythm. Screens compose these rather than
 * hand-rolling a heading each time, which is how twenty-one different heading treatments
 * accumulated in the first place.
 *
 * THIS IS THE SOFTWARE CHROME, and it is deliberately NOT friendly. The exam surfaces —
 * where a stroke survivor is performing a task — keep `.patient-scale` and its 20px floor
 * and 64px targets. Those two audiences want opposite things, and trying to serve both
 * with one treatment is what made the whole product look like a phone app on a laptop.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** The mono, wide-tracked caps line above the title. Short — it is a category, not a sentence. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Actions, right-aligned on the title's baseline. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-8 border-b border-border pb-6", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="text-label text-muted-foreground">{eyebrow}</p>}
          <h1 className={cn("text-title-fluid text-foreground", eyebrow && "mt-2")}>{title}</h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

interface SectionProps {
  /** Mono caps label. The landing page numbers its sections; app sections name theirs. */
  label?: ReactNode;
  title?: ReactNode;
  /** Right-aligned controls on the section's own baseline. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ label, title, actions, children, className }: SectionProps) {
  return (
    <section className={cn("mt-10 first:mt-0", className)}>
      {(label || title || actions) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            {label && <p className="text-label text-muted-foreground">{label}</p>}
            {title && <h2 className={cn("text-title-2", label && "mt-1.5")}>{title}</h2>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export default PageHeader;
