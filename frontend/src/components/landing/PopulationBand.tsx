/**
 * The turn in the argument, drawn: a population normal against a personal one.
 *
 * This exists because the objection every reviewer raises first is "why not just set a
 * threshold?" — and the answer is not a paragraph, it is a picture. A stroke survivor's
 * tapping asymmetry sits outside the population's normal range on the day they come home
 * and on every day after, because that is what a stroke IS. A population threshold set to
 * catch deterioration therefore fires on day one and every morning afterwards; set wide
 * enough to stay quiet, it can no longer see the deterioration it was for.
 *
 * `progress` scrubs between the two readings of the same data. The person's line never
 * moves. Only what we compare it to does.
 */
import { useEffect, useMemo, useRef } from "react";

const INK = {
  plate: "#0A121C",
  crowd: "rgba(158,182,208,0.22)",
  popBand: "rgba(232,163,61,0.13)",
  popEdge: "rgba(232,163,61,0.55)",
  person: "#7FB2F0",
  personBand: "rgba(127,178,240,0.14)",
  personEdge: "rgba(127,178,240,0.40)",
  alert: "#E5675C",
  label: "rgba(226,236,247,0.72)",
} as const;

const DAYS = 21;
const CROWD = 90;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values are a unitless stand-in for a laterality ratio: 1.0 is perfectly symmetric. */
function build() {
  const r = rng(42);
  const crowd: number[][] = [];
  for (let i = 0; i < CROWD; i += 1) {
    const centre = 0.94 + r() * 0.12;
    crowd.push(Array.from({ length: DAYS }, () => centre + (r() - 0.5) * 0.05));
  }
  // One survivor: markedly asymmetric from the start, steady, then a small late drift that
  // is trivial against the population and enormous against himself.
  const person = Array.from({ length: DAYS }, (_, i) => {
    const day = i + 1;
    const base = 0.63 + (r() - 0.5) * 0.022;
    if (day === 19) return base - 0.055;
    if (day === 20) return base - 0.072;
    if (day === 21) return base - 0.066;
    return base;
  });
  return { crowd, person };
}

export function PopulationBand({ progress, className }: { progress: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const data = useMemo(build, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box) return;

    const paint = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = box.clientWidth;
      const h = Math.max(250, Math.min(340, w * 0.44));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = INK.plate;
      ctx.fillRect(0, 0, w, h);

      const padX = 20;
      const padY = 26;
      const plotW = w - padX * 2;
      const x = (d: number) => padX + ((d - 1) / (DAYS - 1)) * plotW;
      // Fixed value window so nothing rescales under the scrub — the whole point is that
      // the data holds still while the comparison changes.
      const lo = 0.48;
      const hi = 1.10;
      const y = (v: number) => padY + (1 - (v - lo) / (hi - lo)) * (h - padY * 2);

      const p = Math.min(1, Math.max(0, progress));
      const fadeCrowd = 1 - p;

      ctx.font = "500 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textBaseline = "middle";

      // --- the population --------------------------------------------------------
      if (fadeCrowd > 0.01) {
        ctx.globalAlpha = fadeCrowd;
        ctx.strokeStyle = INK.crowd;
        ctx.lineWidth = 1;
        for (const line of data.crowd) {
          ctx.beginPath();
          line.forEach((v, i) => (i ? ctx.lineTo(x(i + 1), y(v)) : ctx.moveTo(x(1), y(v))));
          ctx.stroke();
        }
        ctx.fillStyle = INK.popBand;
        ctx.fillRect(padX, y(1.04), plotW, y(0.86) - y(1.04));
        ctx.strokeStyle = INK.popEdge;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(padX, y(0.86));
        ctx.lineTo(padX + plotW, y(0.86));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK.label;
        ctx.fillText("POPULATION NORMAL — 5th to 95th", padX + 2, y(0.95));

        // The distance between the population's floor and where he actually lives is the
        // entire argument, and leaving it as empty plate wastes the one gap that means
        // something. Measure it on the canvas instead.
        const gapX = padX + plotW * 0.62;
        ctx.strokeStyle = INK.popEdge;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(gapX, y(0.86));
        ctx.lineTo(gapX, y(0.645));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.textAlign = "center";
        ctx.fillText("HE IS DOWN HERE.", gapX, y(0.775));
        ctx.fillText("EVERY SINGLE DAY.", gapX, y(0.745));
        ctx.textAlign = "left";
        ctx.globalAlpha = 1;
      }

      // --- their own band --------------------------------------------------------
      if (p > 0.01) {
        const centre = data.person.slice(0, 18).reduce((a, b) => a + b, 0) / 18;
        // The band contracts from the population's width onto the person's own spread.
        const half = 0.09 * (1 - p) + 0.028 * p;
        ctx.globalAlpha = p;
        ctx.fillStyle = INK.personBand;
        ctx.fillRect(padX, y(centre + half), plotW, y(centre - half) - y(centre + half));
        ctx.strokeStyle = INK.personEdge;
        ctx.beginPath();
        ctx.moveTo(padX, y(centre + half));
        ctx.lineTo(padX + plotW, y(centre + half));
        ctx.moveTo(padX, y(centre - half));
        ctx.lineTo(padX + plotW, y(centre - half));
        ctx.stroke();
        ctx.fillStyle = INK.label;
        ctx.fillText("THEIR OWN NORMAL RANGE", padX + 2, y(centre + half) - 10);
        ctx.globalAlpha = 1;
      }

      // Keep the population's floor on the plate after the crowd has gone. The section's
      // whole claim is the distance between that line and where he actually lives, and
      // erasing the line erases the comparison at the exact moment it is being made.
      if (p > 0.45) {
        ctx.globalAlpha = (p - 0.45) / 0.55 * 0.5;
        ctx.strokeStyle = INK.popEdge;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(padX, y(0.86));
        ctx.lineTo(padX + plotW, y(0.86));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = INK.label;
        ctx.fillText("WHERE A POPULATION THRESHOLD WOULD SIT", padX + 2, y(0.895));
        ctx.globalAlpha = 1;
      }

      // --- the one person, unchanged throughout ----------------------------------
      ctx.strokeStyle = INK.person;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      data.person.forEach((v, i) => (i ? ctx.lineTo(x(i + 1), y(v)) : ctx.moveTo(x(1), y(v))));
      ctx.stroke();

      // The late drift only earns a colour once there is a band it can break.
      if (p > 0.55) {
        ctx.globalAlpha = (p - 0.55) / 0.45;
        ctx.fillStyle = INK.alert;
        for (const d of [19, 20, 21]) {
          ctx.beginPath();
          ctx.arc(x(d), y(data.person[d - 1]), 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillText("DAYS 19–21", x(19) - 34, y(data.person[19]) + 22);
        ctx.globalAlpha = 1;
      }
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(box);
    return () => ro.disconnect();
  }, [data, progress]);

  return (
    <div ref={boxRef} className={className}>
      <canvas
        ref={canvasRef}
        className="block w-full rounded-xl"
        role="img"
        aria-label={
          "One stroke survivor's limb asymmetry plotted against ninety other people. "
          + "Against the population's normal range he is outside it every day, so a population "
          + "threshold flags him constantly. Against his own median and MAD, the same data is "
          + "flat until day nineteen, when it moves."
        }
      />
    </div>
  );
}
