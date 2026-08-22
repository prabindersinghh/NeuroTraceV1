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

type Probe = { label: string; value: string; verdict: "good" | "warn" | "bad" | "info" };

/** Measured frame delivery, not the requested rate. These differ, and only this one counts. */
interface FpsResult {
  requested: number;
  measured: number;
  frames: number;
  seconds: number;
  width: number;
  height: number;
  /** Worst gap between frames. A high value means dropped frames, which a mean FPS hides. */
  worstGapMs: number;
}

async function measureFps(requestedFps: number, seconds = 6): Promise<FpsResult> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      frameRate: { ideal: requestedFps },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();

  let frames = 0;
  let last = 0;
  let worstGapMs = 0;
  const started = performance.now();

  await new Promise<void>((resolve) => {
    // requestVideoFrameCallback fires once per DECODED FRAME. rAF fires once per display
    // repaint, which is 60 Hz regardless of what the camera is doing — using it here would
    // report 60 fps on a 30 fps camera, which is exactly the wrong answer.
    const rvfc = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    }).requestVideoFrameCallback?.bind(video);

    const tick = () => {
      const now = performance.now();
      if (last) worstGapMs = Math.max(worstGapMs, now - last);
      last = now;
      frames += 1;
      if (now - started >= seconds * 1000) return resolve();
      if (rvfc) rvfc(tick);
      else requestAnimationFrame(tick);
    };
    if (rvfc) rvfc(tick);
    else requestAnimationFrame(tick);
  });

  const elapsed = (performance.now() - started) / 1000;
  stream.getTracks().forEach((t) => t.stop());

  return {
    requested: requestedFps,
    measured: Number((frames / elapsed).toFixed(1)),
    frames,
    seconds: Number(elapsed.toFixed(2)),
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    worstGapMs: Number(worstGapMs.toFixed(1)),
  };
}

/** Does this browser get the SIMD wasm build? The non-SIMD fallback is several times slower. */
function hasWasmSimd(): boolean {
  try {
    // Minimal module containing one v128 instruction. Validates only where SIMD is supported.
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10,
        10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

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
      const quotaMb = Math.round((e.quota ?? 0) / 1e6);
      setProbes((p) => [
        ...p,
        {
          label: "Storage quota",
          // The precache is ~40 MB, most of it the face model and wasm.
          value: `${quotaMb} MB (offline precache needs ~40 MB)`,
          verdict: quotaMb > 200 ? "good" : quotaMb > 60 ? "warn" : "bad",
        },
      ]);
    }).catch(() => undefined);
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
                        ? "text-red-600"
                        : p.verdict === "warn"
                          ? "text-amber-600"
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
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error} — if this says permission denied, allow camera access and run it again.
        </p>
      )}

      {fps.map((r) => (
        <div key={r.requested} className="rounded-lg border border-line p-4">
          <p className="text-lg">
            Requested {r.requested} fps →{" "}
            <strong
              className={
                verdictFor(r.measured) === "bad"
                  ? "text-red-600"
                  : verdictFor(r.measured) === "warn"
                    ? "text-amber-600"
                    : "text-green-700"
              }
            >
              {r.measured} fps measured
            </strong>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {r.width}×{r.height} · {r.frames} frames in {r.seconds}s · worst gap{" "}
            {r.worstGapMs} ms
          </p>
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
