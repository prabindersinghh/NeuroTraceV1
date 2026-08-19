/**
 * The FAST card — TRD §8. Rendered at the end of every session and on every dashboard.
 *
 * Not conditional on the band, and deliberately so. This system watches for slow change
 * over days and structurally cannot see an acute stroke, which evolves in seconds. The
 * human-recognisable warning signs therefore have to be in front of the family every
 * single day, independent of whatever we computed.
 *
 * The limitation notice at the bottom is the honest part. It says what we cannot do.
 */
import { PhoneCall } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import type { FastCard as FastCardData } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FastCard({ card, className }: { card: FastCardData; className?: string }) {
  const { t } = useI18n();
  if (!card?.items?.length) return null;

  return (
    <section
      className={cn("rounded-2xl border-2 border-alert/30 bg-alert-soft p-5", className)}
      aria-label={card.title}
    >
      <h2 className="text-lg font-semibold text-alert">{card.title}</h2>

      <ul className="mt-4 flex flex-col gap-3">
        {card.items.map((item) => (
          <li key={item.letter} className="flex items-start gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-alert text-lg font-bold text-white"
              aria-hidden
            >
              {item.letter}
            </span>
            <span className="pt-1 leading-snug">
              <strong className="font-semibold">{item.label}</strong>
              <span className="text-muted-foreground"> — {item.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2">
        {card.emergency_numbers.map((n) => (
          <a
            key={n.number}
            href={`tel:${n.number}`}
            className="inline-flex items-center gap-2 rounded-lg bg-alert px-4 py-2.5 text-base font-semibold text-white focus-ring"
          >
            <PhoneCall className="h-4 w-4" aria-hidden />
            {n.label} · {n.number}
          </a>
        ))}
      </div>

      <p className="mt-4 border-t border-alert/20 pt-3 text-sm text-muted-foreground">
        {card.limitation_notice}
      </p>
      <span className="sr-only">{t("emergency")}</span>
    </section>
  );
}
