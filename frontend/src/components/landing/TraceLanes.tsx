/**
 * THE SIGNATURE VISUAL: seven lanes, one per domain, twenty-one days wide.
 *
 * Everything else on the page is built out of this one primitive, because it is not a
 * decoration — it is the product's actual argument drawn to scale:
 *
 *   · a lane is a domain over time, so PERSISTENCE is a horizontal fact;
 *   · seven lanes stacked means CROSS-MODALITY is a vertical fact;
 *   · the tick under a node is LATERALITY, and only four lanes can ever have one;
 *   · and the band is the person's own learned normal, which is why it does not exist
 *     for the first fifteen days and then appears around wherever they happen to sit.
 *
 * IMPERATIVE ON PURPOSE. The day is NOT a prop. Scrubbing twenty-one days through a React
 * prop re-renders this component — and its parent's paragraphs — sixty times a second for
 * a picture whose only change is a canvas blit. The parent calls `ref.current.setDay(d)`
 * from the scroll ticker instead, and React is not involved between mount and unmount.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import {
  BASELINE_UNTIL, DEV_THRESHOLD, DOMAINS, RUN_DAYS,
  type Series, verdictOn,
} from "./traceData";

/**
 * The instrument palette.
 *
 * The product surfaces are light by decision (D-034 revised) and stay light. The plate is
 * near-black because it is an INSTRUMENT inside the page, not the page's theme — and
 * because the token blues are tuned for contrast on white and go muddy below 4.5:1 on a
 * dark ground. These are the same hues, lifted in lightness until they read.
 */
const INK = {
  plate: "#0A121C",
  grid: "rgba(255,255,255,0.055)",
  label: "rgba(226,236,247,0.62)",
  learning: "#5A6B7D",
  stable: "#7FB2F0",
  band: "rgba(127,178,240,0.12)",
  bandEdge: "rgba(127,178,240,0.30)",
  watch: "#E8A33D",
  alert: "#E5675C",
} as const;

export interface TraceLanesHandle {
  /** Draw the run up to `day`. Fractional for a continuous sweep. */
  setDay: (day: number) => void;
}

export interface TraceLanesProps {
  series: Series;
  /** Starting day. After mount the parent drives it through the handle. */
  day?: number;
  /** Lane height in CSS px. ~20 on a phone plate, ~34 on a desktop one. */
  laneHeight?: number;
  /** Draw the domain name in the left gutter. Off on the narrowest plates. */
  labels?: boolean;
  /** Pointer x in 0..1 across the plate, or null. Lights the nearest day column. */
  focus?: number | null;
  className?: string;
}

export const TraceLanes = forwardRef<TraceLanesHandle, TraceLanesProps>(function TraceLanes(
  { series, day = 1, laneHeight = 32, labels = true, focus = null, className },
  handleRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dayRef = useRef(day);
  const focusRef = useRef(focus);
  const paintRef = useRef<() => void>(() => {});
  focusRef.current = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const shown = dayRef.current;
      const cssW = box.clientWidth;
      if (!cssW) return;
      const gutter = labels ? Math.min(148, Math.max(96, cssW * 0.19)) : 12;
      const padR = 16;
      const padY = 14;
      const cssH = DOMAINS.length * laneHeight + padY * 2 + 22;

      // Cap DPR at 2: a 3x phone gains nothing visible here and pays three times the fill.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const wantW = Math.round(cssW * dpr);
      const wantH = Math.round(cssH * dpr);
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width = wantW;
        canvas.height = wantH;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = INK.plate;
      ctx.fillRect(0, 0, cssW, cssH);

      const plotW = cssW - gutter - padR;
      const x = (d: number) => gutter + ((d - 1) / (RUN_DAYS - 1)) * plotW;
      // A lane is ±3.2 robust z tall, so the 2.0 threshold sits two thirds out from centre.
      const zSpan = 3.2;

      ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";

      // The column under the pointer, drawn behind everything. It is a readout, not a
      // glow: the visitor is inspecting one morning across all seven domains at once.
      const focusX = focusRef.current;
      let focusDay = 0;
      if (focusX !== null && focusX !== undefined) {
        const raw = 1 + ((focusX * cssW - gutter) / plotW) * (RUN_DAYS - 1);
        focusDay = Math.round(Math.min(shown, Math.max(1, raw)));
        if (focusDay >= 1 && focusDay <= shown) {
          ctx.fillStyle = "rgba(255,255,255,0.045)";
          ctx.fillRect(x(focusDay) - 7, padY + 4, 14, cssH - padY * 2 - 18);
        }
      }

      // The rule between "learning their normal" and "judging against it".
      const boundary = x(BASELINE_UNTIL + 0.5);
      if (shown > BASELINE_UNTIL) {
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(boundary, padY - 6);
        ctx.lineTo(boundary, cssH - padY - 14);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK.label;
        // On a phone the plot is ~240px wide and this label starts three quarters of the
        // way along it, so the long form ran off the canvas and was clipped mid-word.
        const caption = plotW > 380 ? "BASELINE LEARNED" : "BASELINE";
        const captionW = ctx.measureText(caption).width;
        ctx.fillText(caption, Math.min(boundary + 6, gutter + plotW - captionW), padY - 1);
      }

      DOMAINS.forEach((domain, lane) => {
        const top = padY + 10 + lane * laneHeight;
        const mid = top + laneHeight / 2;
        const halfH = laneHeight / 2 - 4;
        const y = (z: number) => mid - (z / zSpan) * halfH;
        const points = series[domain.key];

        if (labels) {
          ctx.fillStyle = INK.label;
          ctx.textAlign = "right";
          ctx.fillText(domain.lane, gutter - 14, mid);
          // Only four domains carry a side. Marking which is a fact about the anatomy,
          // and it is what makes Gate 3 legible rather than arbitrary.
          if (domain.lateral) {
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            ctx.fillRect(gutter - 8, mid - 4, 2, 8);
          }
          ctx.textAlign = "left";
        }

        ctx.strokeStyle = INK.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gutter, mid);
        ctx.lineTo(gutter + plotW, mid);
        ctx.stroke();

        // The learned band — drawn only once the baseline exists, and only across the days
        // it governs. Before that the engine has no opinion and neither does this.
        if (shown > BASELINE_UNTIL) {
          const bandTop = y(DEV_THRESHOLD);
          const bandBottom = y(-DEV_THRESHOLD);
          const bandRight = x(Math.min(shown, RUN_DAYS));
          ctx.fillStyle = INK.band;
          ctx.fillRect(boundary, bandTop, Math.max(0, bandRight - boundary), bandBottom - bandTop);
          ctx.strokeStyle = INK.bandEdge;
          ctx.beginPath();
          ctx.moveTo(boundary, bandTop);
          ctx.lineTo(bandRight, bandTop);
          ctx.moveTo(boundary, bandBottom);
          ctx.lineTo(bandRight, bandBottom);
          ctx.stroke();
        }

        // The trace, in two colours that mean two different things: the collection days
        // stay grey FOREVER, because nothing that happened in them was ever judged.
        const end = Math.min(RUN_DAYS, Math.floor(shown));
        const frac = shown - Math.floor(shown);
        const last = Math.floor(shown);
        const segment = (from: number, to: number, colour: string) => {
          if (to < from) return;
          ctx.lineWidth = 1.6;
          ctx.lineJoin = "round";
          ctx.strokeStyle = colour;
          ctx.beginPath();
          for (let d = from; d <= to; d += 1) {
            const px = x(d);
            const py = y(points[d - 1].z);
            if (d === from) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          if (to === last && frac > 0 && last < RUN_DAYS && last >= 1) {
            const a = points[last - 1].z;
            const b = points[last].z;
            ctx.lineTo(x(last + frac), y(a + (b - a) * frac));
          }
          ctx.stroke();
        };
        segment(1, Math.min(end, BASELINE_UNTIL), INK.learning);
        if (end > BASELINE_UNTIL) segment(BASELINE_UNTIL, end, INK.stable);

        // Days that broke the band, coloured by what the ENGINE said that day — not by how
        // big the number is. A large deviation on one day is still only a WATCH.
        for (let d = BASELINE_UNTIL + 1; d <= end; d += 1) {
          const point = points[d - 1];
          if (Math.abs(point.z) < DEV_THRESHOLD) continue;
          const verdict = verdictOn(series, d);
          const alert = verdict.band === "ALERT";
          const px = x(d);
          const py = y(point.z);
          // The newest breach gets a halo for two frames' worth of scroll, so an arriving
          // finding is noticed rather than silently appearing under the reader's eye.
          const age = shown - d;
          if (age >= 0 && age < 1.2) {
            ctx.globalAlpha = (1 - age / 1.2) * 0.5;
            ctx.fillStyle = alert ? INK.alert : INK.watch;
            ctx.beginPath();
            ctx.arc(px, py, 3 + age * 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          ctx.fillStyle = alert ? INK.alert : INK.watch;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
          if (point.asymmetry !== 0) ctx.fillRect(px - 0.75, py + 5, 1.5, 4);
        }

        // The focused morning: mark this lane's value on the inspected column.
        if (focusDay >= 1 && focusDay <= end) {
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x(focusDay), y(points[focusDay - 1].z), 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      // Leading edge.
      if (shown >= 1 && shown < RUN_DAYS + 0.5) {
        const cx = x(Math.min(shown, RUN_DAYS));
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, padY);
        ctx.lineTo(cx, cssH - padY - 14);
        ctx.stroke();
      }

      ctx.fillStyle = INK.label;
      ctx.textAlign = "left";
      for (const d of [1, 5, 10, 15, 20]) {
        if (d > shown + 0.5) break;
        ctx.fillText(`D${d}`, x(d) - (d === 1 ? 0 : 6), cssH - padY - 2);
      }
      if (focusDay >= 1 && focusDay <= shown) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.textAlign = "center";
        ctx.fillText(`DAY ${focusDay}`, x(focusDay), padY - 1);
        ctx.textAlign = "left";
      }
    };

    paintRef.current = paint;
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(box);
    return () => ro.disconnect();
  }, [series, laneHeight, labels]);

  // Repaint when the pointer column changes; the day comes through the handle instead.
  useEffect(() => { paintRef.current(); }, [focus]);

  useImperativeHandle(handleRef, () => ({
    setDay: (next: number) => {
      if (next === dayRef.current) return;
      dayRef.current = next;
      paintRef.current();
    },
  }), []);

  const final = verdictOn(series, Math.min(RUN_DAYS, Math.max(1, Math.round(day))));

  return (
    <div ref={boxRef} className={className}>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-xl"
        role="img"
        aria-label={`Seven domain traces across ${RUN_DAYS} days of the seeded demo run.`}
      />
      {/* The canvas is the picture; this is the content. Screen readers get the state. */}
      <ul className="sr-only">
        {DOMAINS.map((d) => (
          <li key={d.key}>
            {d.label}: {final.gate1.includes(d.key) ? "deviating on consecutive sessions" : "within the learned band"}
            {d.lateral ? ", carries a left/right side" : ", has no left/right axis"}
          </li>
        ))}
      </ul>
    </div>
  );
});
