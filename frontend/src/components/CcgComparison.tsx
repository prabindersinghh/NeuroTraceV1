/**
 * Craniocorpography: today beside the reference.
 *
 * A single CCG trace is nearly unreadable in isolation. Everyone sways; the question is
 * whether THIS person sways more, or differently, than they did. So the comparison is the
 * primary view and the single trace is the fallback, not the other way round.
 *
 * WHAT THE REFERENCE IS
 * ---------------------
 * The earliest capture inside the LOCKED baseline window — not the earliest capture ever.
 * A first-ever attempt is where the patient is still working out what is being asked of
 * them, and measuring today against somebody's first confused attempt manufactures an
 * improvement that never happened. If no baseline is locked the backend returns 409 and
 * this component says the comparison is not available yet rather than substituting
 * something plausible.
 *
 * WHY DELTAS ARE NOT COLOURED GREEN AND RED
 * -----------------------------------------
 * A larger sway area is not automatically "worse" and a smaller one is not automatically
 * "better" — a patient who has learned to brace, or who is being held, produces a smaller
 * area with no change in their vestibular function. Direction is shown with an arrow and
 * the magnitude is shown; the judgement stays with the clinician. Colour would make that
 * judgement for them, silently, on every row.
 */
import { useEffect, useState } from "react";

import { CcgTrace, type CcgTraceData } from "@/components/CcgTrace";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { api } from "@/lib/api";

/** Metrics where the two captures can legitimately be compared side by side. */
function sharedMetricKeys(a: CcgTraceData, b: CcgTraceData): string[] {
  return Object.keys(a.metrics).filter((k) => k in b.metrics).sort();
}

function DeltaRow({ label, now, ref }: { label: string; now: number; ref: number }) {
  const delta = now - ref;
  // Percent of the reference, which is the only scale that means anything across metrics
  // measured in cm, cm², degrees and cm/s. Guarded: a reference of 0 has no percentage.
  const pct = ref !== 0 ? (delta / Math.abs(ref)) * 100 : null;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-2 pr-3 text-muted-foreground">{label}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{ref.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{now.toFixed(2)}</td>
      <td className="py-2 text-right tabular-nums">
        <span aria-hidden>{arrow}</span> {Math.abs(delta).toFixed(2)}
        {pct !== null && (
          <span className="ml-1 text-xs text-muted-foreground">
            ({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)
          </span>
        )}
      </td>
    </tr>
  );
}

export function CcgComparison({ patientId }: { patientId: string }) {
  const [now, setNow] = useState<CcgTraceData | null>(null);
  const [reference, setReference] = useState<CcgTraceData | null>(null);
  const [noReference, setNoReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.movementTrace(patientId)
      .then((d) => live && setNow(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));

    // A missing reference is an expected state, not an error: every patient has one until
    // their baseline locks. Handled separately so it never reads as a fault.
    api.movementTrace(patientId, { reference: true })
      .then((d) => live && setReference(d))
      .catch((e) => live && setNoReference(e instanceof Error ? e.message : String(e)));

    return () => { live = false; };
  }, [patientId]);

  if (error) return <ErrorState message={error} />;
  if (!now) return <LoadingState />;

  const days = reference
    ? Math.round(
        (new Date(now.date).getTime() - new Date(reference.date).getTime()) / 86_400_000,
      )
    : 0;

  return (
    <section className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            {reference
              ? `Reference · ${reference.date.slice(0, 10)}`
              : "Reference · not available"}
          </h3>
          {reference ? (
            <CcgTrace data={reference} />
          ) : (
            <EmptyState>
              {noReference ??
                "No locked baseline yet, so there is nothing to compare against."}
            </EmptyState>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            Latest · {now.date.slice(0, 10)}
            {reference && days > 0 && ` · ${days} days later`}
          </h3>
          <CcgTrace data={now} />
        </div>
      </div>

      {/* A partial capture on either side makes the comparison partial. Saying it once,
          here, is better than a caveat buried on each panel. */}
      {(!now.complete || (reference && !reference.complete)) && (
        <p className="rounded border border-amber-400 bg-amber-50 p-3 text-sm">
          <strong>Partial capture.</strong> The walking and stepping tests need someone
          present and were not recorded in {!now.complete && reference && !reference.complete
            ? "either capture"
            : !now.complete
              ? "the latest capture"
              : "the reference capture"}. Sway is measured; the direction of deviation is
          not, so any laterality reading from balance is unavailable for this comparison.
        </p>
      )}

      {reference && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="py-2 pr-3 font-medium">Measure ({now.units})</th>
              <th className="py-2 pr-3 text-right font-medium">Reference</th>
              <th className="py-2 pr-3 text-right font-medium">Latest</th>
              <th className="py-2 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {sharedMetricKeys(now, reference).map((k) => (
              <DeltaRow
                key={k}
                label={k.replace(/_/g, " ")}
                now={now.metrics[k]}
                ref={reference.metrics[k]}
              />
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-muted-foreground">
        Change is shown as direction and magnitude only. A smaller sway area is not
        necessarily an improvement — bracing, or being steadied by someone, produces the
        same reduction with no change in vestibular function.
      </p>
    </section>
  );
}

export default CcgComparison;
