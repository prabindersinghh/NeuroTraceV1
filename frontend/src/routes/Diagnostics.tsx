/**
 * Device diagnostics — `/diagnostics`. No login required.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every measurement this product makes rests on assumptions about the hardware, and until
 * now every one of those assumptions has been checked on a desktop browser. The most
 * important is frame rate: a saccade lasts 30–80 ms, so at 30 fps it spans one to three
 * frames and "peak velocity" is really a two-frame average that understates the true peak.
 * `velocity_confidence` already reports 0.00 at 30 fps. Whether a real phone in a real room
 * gives us 30 or 60 decides whether M3 velocity is a usable signal at all — and on TIER_1
 * phone-only patients, M3 is the *only* source of posterior laterality.
 *
 * Reading a spec sheet does not answer that. A spec sheet says the sensor does 60 fps; it
 * does not say what the browser delivers through `getUserMedia` at this resolution, in this
 * light, with MediaPipe competing for the CPU. So this page measures it.
 *
 * It writes nothing, uploads nothing, and needs no account. Output is copyable JSON with no
 * identifier in it — see the `report` object, which is the whole payload.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { hasWasmSimd, measureFps, type FpsResult } from "@/lib/deviceProbes";

type Probe = { label: string; value: string; verdict: "good" | "warn" | "bad" | "info" };

function verdictFor(measured: number): Probe["verdict"] {
  if (measured >= 55) return "good";
  if (measured >= 45) return "warn";
  return "bad";
}

export default function Diagnostics() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [fps, setFps] = useState<FpsResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedAt = useRef(new Date().toISOString());

  useEffect(() => {
    // StrictMode runs effects twice in development. Without this guard the async storage
    // probe below appends "Storage quota" once per run, so the row rendered twice with the
    // same React key — and in production the same thing happens if the effect is ever
    // re-run, or fires setState after the page has been left.
    let cancelled = false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const out: Probe[] = [
      { label: "User agent", value: navigator.userAgent, verdict: "info" },
      {
        label: "Secure context (HTTPS)",
        value: String(window.isSecureContext),
        // getUserMedia is refused outright on plain HTTP. Without this nothing else matters.
        verdict: window.isSecureContext ? "good" : "bad",
      },
      {
        label: "wasm SIMD",
        value: hasWasmSimd() ? "supported" : "NOT supported (slow fallback build)",
        verdict: hasWasmSimd() ? "good" : "warn",
      },
      { label: "CPU cores", value: String(navigator.hardwareConcurrency ?? "unknown"), verdict: "info" },
      { label: "Device memory (GB)", value: String(nav.deviceMemory ?? "not reported"), verdict: "info" },
      {
        label: "Screen",
        value: `${window.screen.width}×${window.screen.height} @ dpr ${window.devicePixelRatio}`,
        verdict: "info",
      },
      {
        label: "Orientation sensor",
        value:
          typeof DeviceOrientationEvent === "undefined"
            ? "absent — SVV handset-tilt input will not work"
            : // iOS gates this behind a permission call that must follow a user gesture.
              "requestPermission" in (DeviceOrientationEvent as unknown as Record<string, unknown>)
              ? "present, needs explicit permission (iOS)"
              : "present",
        verdict: typeof DeviceOrientationEvent === "undefined" ? "bad" : "good",
      },
    ];
    setProbes(out);

    navigator.storage?.estimate?.().then((e) => {
      if (cancelled) return;
      const quotaMb = Math.round((e.quota ?? 0) / 1e6);
      setProbes((p) => [
        ...p.filter((existing) => existing.label !== "Storage quota"),
        {
          label: "Storage quota",
          // The precache is ~40 MB, most of it the face model and wasm.
          value: `${quotaMb} MB (offline precache needs ~40 MB)`,
          verdict: quotaMb > 200 ? "good" : quotaMb > 60 ? "warn" : "bad",
        },
      ]);
    }).catch(() => undefined);

    return () => { cancelled = true; };
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setFps([]);
    try {
      // 60 first, then 30. If 60 is not granted the camera falls back on its own and the
      // measured number says so — which is the finding, not a failure of the test.
      for (const target of [60, 30]) {
        const r = await measureFps(target);
        setFps((prev) => [...prev, r]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const report = {
    schema: "neurotrace.diagnostics/1",
    capturedAt: startedAt.current,
    // Deliberately no patient, account, or location field. This file gets pasted into a
    // chat or an email, and the safest payload is one that cannot identify anybody.
    probes: Object.fromEntries(probes.map((p) => [p.label, p.value])),
    fps,
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Device diagnostics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Measures what this phone actually delivers. Nothing is uploaded and no account is
          needed. Run it in the room and the light where check-ins will happen — frame rate
          drops in dim light because the camera lengthens its exposure.
        </p>
      </header>

      <section className="rounded-lg border border-line">
        <table className="w-full text-sm">
          <tbody>
            {probes.map((p) => (
              <tr key={p.label} className="border-b border-line last:border-0">
                <td className="p-3 align-top text-muted-foreground">{p.label}</td>
                <td className="p-3 break-all">
                  <span
                    className={
                      p.verdict === "bad"
                        ? "text-alert"
                        : p.verdict === "warn"
                          ? "text-watch"
                          : ""
                    }
                  >
                    {p.value}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <Button className="min-h-14 w-full text-lg" onClick={run} disabled={running}>
        {running ? "Measuring — hold the phone still…" : "Measure camera frame rate (~15 s)"}
      </Button>

      {error && (
        <p className="rounded-lg border border-alert/40 bg-alert-soft p-3 text-sm text-foreground">
          {error} — if this says permission denied, allow camera access and run it again.
        </p>
      )}

      {fps.map((r) => (
        <div key={r.requested} className="rounded-lg border border-line p-4">
          <p className="text-lg">
            Requested {r.requested} fps →{" "}
            <strong
              // Token palette, not raw Tailwind. These were red-600/amber-600/green-700,
              // which are visibly different hues from --alert/--watch and taught a reader
              // a second, conflicting colour vocabulary. Green is also forbidden as a
              // status colour anywhere in this product, and `stable` IS the accent blue
              // for exactly that reason (index.css).
              className={
                verdictFor(r.measured) === "bad"
                  ? "text-alert"
                  : verdictFor(r.measured) === "warn"
                    ? "text-watch"
                    : "text-stable"
              }
            >
              {r.measured} fps measured
            </strong>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.width}×{r.height} · {r.frames} frames in {r.seconds}s · worst gap{" "}
            {r.worstGapMs} ms · clock: {r.timing_source}
          </p>
          {r.timing_source === "raf" && (
            <p className="mt-2 text-sm text-watch">
              Measured with requestAnimationFrame — this browser lacks per-frame callbacks,
              so the number above is the DISPLAY rate, not the camera rate. Treat it as an
              upper bound only.
            </p>
          )}
          {r.requested === 60 && r.measured < 45 && (
            <p className="mt-2 text-sm">
              Below ~45 fps, saccade <em>peak velocity</em> is not trustworthy on this
              device — a saccade spans too few frames. Saccade <em>latency</em> and the
              left-versus-right asymmetry still trend usefully, and asymmetry is what the
              laterality gate actually needs.
            </p>
          )}
        </div>
      ))}

      {fps.length > 0 && (
        <>
          <pre className="overflow-x-auto rounded-lg border border-line bg-surface p-3 text-xs">
            {JSON.stringify(report, null, 2)}
          </pre>
          <Button
            className="min-h-12 w-full"
            onClick={() => {
              navigator.clipboard
                ?.writeText(JSON.stringify(report, null, 2))
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "Copied" : "Copy report"}
          </Button>
        </>
      )}
    </div>
  );
}
