/**
 * M17 · fingertip photoplethysmography from the camera.
 *
 * A fingertip pressed over the lens turns the whole frame into one big pulse oximeter
 * window: each heartbeat changes how much light the tissue transmits, so MEAN FRAME
 * BRIGHTNESS over time IS the PPG waveform. The device samples one number per frame; beat
 * detection and rhythm features run on the server (`extract_rhythm`), which expects
 * exactly `{ppg: [...], fs}`.
 *
 * The red channel carries most of the signal through tissue, so it is weighted up.
 *
 * TORCH: `applyConstraints({advanced: [{torch: true}]})` exists on Android Chrome and
 * simply does not exist on iOS Safari — there is no web API for the iPhone flash. The
 * capture works in both cases (a bright room backlights the finger well enough); torch
 * failure is recorded in the quality detail rather than treated as an error, because a
 * missing flash is a fact about the phone, not a failed measurement.
 *
 * COVERAGE CHECK: a covered lens is dark-ish and RED (tissue transmits red); an uncovered
 * lens is brighter and colour-balanced. `looksCovered` gates capture start so we never
 * record 60 seconds of somebody's ceiling.
 */

export interface PpgFrameStats {
  /** Red-weighted mean brightness 0..255 — one PPG sample. */
  value: number;
  redFraction: number;
  brightness: number;
}

export function frameStats(data: Uint8ClampedArray): PpgFrameStats {
  let r = 0, g = 0, b = 0;
  const px = data.length / 4;
  // Sample every 4th pixel — the PPG signal is global, resolution adds nothing.
  for (let i = 0; i < data.length; i += 16) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  const n = Math.max(1, Math.floor(px / 4));
  r /= n; g /= n; b /= n;
  const sum = r + g + b + 1e-6;
  return {
    value: 0.7 * r + 0.2 * g + 0.1 * b,
    redFraction: r / sum,
    brightness: sum / 3,
  };
}

/** Finger over lens: strongly red-dominant. */
export function looksCovered(s: PpgFrameStats): boolean {
  return s.redFraction > 0.55 && s.brightness > 8;
}

export async function tryEnableTorch(track: MediaStreamTrack): Promise<boolean> {
  try {
    const caps = track.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    if (!caps || !("torch" in caps) || !caps.torch) return false;
    await track.applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export interface PpgRaw {
  ppg: number[];
  fs: number;
  [k: string]: unknown;
}
