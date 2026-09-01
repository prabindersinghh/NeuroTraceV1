/**
 * A moment between steps — the path pausing for a breath.
 *
 * One primitive, three uses: the intro to a chapter (with the rest offer from the
 * second chapter on), the welcome-back after a reload, and the exit confirmation. Same
 * shape every time so the patient learns it once: an eyebrow, a title, one line, then
 * the thing they most likely want first and the other thing second.
 *
 * The primary is ALWAYS the continuing action and is listed first — not because
 * stopping is discouraged, but because after an accidental tap it is the more common
 * intent (the same reasoning as the exit dialog, D-059).
 */
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { speak } from "@/lib/speech-synthesis";
import type { ReactNode } from "react";

interface Action {
  label: string;
  onClick: () => void;
}

interface Props {
  eyebrow?: string;
  title: string;
  body?: string;
  /** A second line, rendered quieter — the rest offer, the "what is kept" line. */
  note?: string;
  primary: Action;
  secondary?: Action;
  children?: ReactNode;
  /** The exit confirmation is a dialog; the others are just the next screen. */
  dialog?: boolean;
}

export function Moment({ eyebrow, title, body, note, primary, secondary, children, dialog }: Props) {
  const { lang } = useI18n();

  useEffect(() => {
    speak([title, body].filter(Boolean).join(". "), lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <div
      role={dialog ? "dialog" : undefined}
      aria-modal={dialog ? "true" : undefined}
      aria-labelledby="scene-title"
      className="flex flex-1 flex-col justify-center gap-6 py-6 text-center"
    >
      <div className="flex flex-col gap-3">
        {eyebrow && <p className="text-label text-muted-foreground">{eyebrow}</p>}
        <h2 id="scene-title" tabIndex={-1} className="text-title-1 focus:outline-none">
          {title}
        </h2>
        {body && <p className="text-xl leading-relaxed text-muted-foreground">{body}</p>}
      </div>
      {children}
      {note && <p className="text-lg" aria-live="polite">{note}</p>}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
        <Button size="touch" variant="accent" onClick={primary.onClick}>
          {primary.label}
        </Button>
        {secondary && (
          <Button size="touch" variant="outline" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        )}
      </div>
    </div>
  );
}

export default Moment;
