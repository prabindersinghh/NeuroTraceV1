/**
 * Ninety days, one of them measured.
 *
 * The README's number, drawn: a neurologist examines a survivor for about twenty minutes
 * once every one to three months. At the far end of that interval this is what the record
 * looks like — one square out of ninety, and no information at all about the other
 * eighty-nine, which is where the deterioration happens.
 *
 * Plain DOM. Ninety divs with a staggered transition costs less than a canvas and stays
 * crisp, selectable and inspectable, which suits a section whose whole point is a count.
 */
import { DURATION, EASE, useInView, usePrefersReducedMotion } from "@/lib/motion";

const DAYS = 90;
/** The appointment. Late in the window, because that is when it is remembered. */
const CLINIC_DAY = 74;

export function NinetyDays({ measured }: { measured: boolean }) {
  const reduced = usePrefersReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: "0px 0px -20% 0px" });
  const on = reduced || inView;

  return (
    <div ref={ref}>
      <div
        className="grid gap-[5px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14px, 1fr))" }}
        role="img"
        aria-label={
          measured
            ? "Ninety consecutive days, every one of them measured at home."
            : "Ninety days between neurology appointments. One day is measured; eighty-nine are not."
        }
      >
        {Array.from({ length: DAYS }, (_, i) => {
          const clinic = i === CLINIC_DAY;
          const filled = on && (clinic || measured);
          return (
            <span
              key={i}
              className="block aspect-square rounded-[3px]"
              style={{
                background: filled
                  ? (clinic && !measured ? "hsl(var(--foreground))" : "hsl(var(--accent))")
                  : "hsl(var(--muted))",
                opacity: on ? 1 : 0,
                transform: on ? "none" : "scale(0.4)",
                transition: reduced ? undefined
                  : `opacity ${DURATION.fast}ms ${EASE.out} ${i * 7}ms,`
                    + ` transform ${DURATION.fast}ms ${EASE.out} ${i * 7}ms,`
                    + ` background-color ${DURATION.medium}ms ${EASE.out} ${i * 4}ms`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
