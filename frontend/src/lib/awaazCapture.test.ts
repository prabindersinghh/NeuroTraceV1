import { describe, expect, it } from "vitest";

import {
  MAX_CAPTURE_SECONDS,
  advanceEndpoint,
  startEndpointState,
} from "./awaazCapture";
import { sha256Blob } from "./awaazAudioVault";

describe("Awaaz dysarthria-aware endpointing", () => {
  it("never treats pre-speech thinking time as end-of-utterance silence", () => {
    const initial = startEndpointState(0);
    const afterFourSeconds = advanceEndpoint(initial, 0, 4_000, 3.5);
    expect(afterFourSeconds.shouldStop).toBe(false);
    expect(afterFourSeconds.state.heardSpeech).toBe(false);
  });

  it("honours the patient's full configured pause after speech", () => {
    const heard = advanceEndpoint(startEndpointState(0), 0.2, 1_000, 4).state;
    expect(advanceEndpoint(heard, 0, 4_999, 4).shouldStop).toBe(false);
    expect(advanceEndpoint(heard, 0, 5_000, 4)).toMatchObject({
      shouldStop: true,
      reason: "silence",
    });
  });

  it("a new sound restarts the pause window", () => {
    const first = advanceEndpoint(startEndpointState(0), 0.2, 1_000, 3).state;
    const resumed = advanceEndpoint(first, 0.1, 3_500, 3).state;
    expect(advanceEndpoint(resumed, 0, 6_499, 3).shouldStop).toBe(false);
    expect(advanceEndpoint(resumed, 0, 6_500, 3).shouldStop).toBe(true);
  });

  it("bounds a manual recording even when no speech is detected", () => {
    const initial = startEndpointState(0);
    expect(advanceEndpoint(
      initial, 0, MAX_CAPTURE_SECONDS * 1000, 4,
    )).toMatchObject({ shouldStop: true, reason: "maximum" });
  });

  it("fingerprints the local WAV so a later exporter can verify it", async () => {
    expect(await sha256Blob(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
