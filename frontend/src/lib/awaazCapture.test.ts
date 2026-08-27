import { describe, expect, it } from "vitest";

import {
  MAX_CAPTURE_SECONDS,
  advanceEndpoint,
  startEndpointState,
} from "./awaazCapture";
import { isLocalReviewPairFor, sha256Blob, type LocalAudioPair } from "./awaazAudioVault";
import { buildLocalTrainingArchive, trainingArchiveFilename } from "./awaazTrainingExport";
import {
  isEmergencyAudioCurrent,
  startEmergencyPlayback,
  type LocalEmergencyAudio,
} from "./awaazEmergencyAudio";
import {
  INDIA_EMERGENCY_DIAL_HREF,
  INDIA_EMERGENCY_NUMBER,
  EMERGENCY_LONG_PRESS_MOVE_PX,
  movedBeyondEmergencyHold,
} from "./awaazEmergency";

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

describe("Awaaz offline emergency playback receipt", () => {
  const phrase: LocalEmergencyAudio = {
    patient_id: "patient-1",
    target_text: "I need help",
    lang: "en",
    duration_seconds: 1.2,
    sha256: "ab".repeat(32),
    created_at: "2026-08-28T00:00:00.000Z",
    audio: new Blob(["wav"]),
  };

  it("only marks playback true after the browser accepts play", async () => {
    expect(await startEmergencyPlayback({ play: async () => undefined })).toBe(true);
    expect(await startEmergencyPlayback({
      play: async () => { throw new Error("blocked"); },
    })).toBe(false);
  });

  it("does not use a stale recording after the pinned phrase changes", () => {
    expect(isEmergencyAudioCurrent(phrase, "patient-1", "I need help", "en")).toBe(true);
    expect(isEmergencyAudioCurrent(phrase, "patient-2", "I need help", "en")).toBe(false);
    expect(isEmergencyAudioCurrent(phrase, "patient-1", "Help me now", "en")).toBe(false);
    expect(isEmergencyAudioCurrent(phrase, "patient-1", "I need help", "pa")).toBe(false);
  });
});

describe("Awaaz emergency long press", () => {
  it("ignores finger jitter but cancels when the person starts scrolling", () => {
    expect(movedBeyondEmergencyHold({ x: 20, y: 20 }, {
      x: 20 + EMERGENCY_LONG_PRESS_MOVE_PX,
      y: 20,
    })).toBe(false);
    expect(movedBeyondEmergencyHold({ x: 20, y: 20 }, {
      x: 21 + EMERGENCY_LONG_PRESS_MOVE_PX,
      y: 20,
    })).toBe(true);
  });

  it("pins the India ambulance dial target without claiming call completion", () => {
    expect(INDIA_EMERGENCY_NUMBER).toBe("108");
    expect(INDIA_EMERGENCY_DIAL_HREF).toBe("tel:108");
  });
});

describe("Awaaz caregiver-reviewed local audio", () => {
  const pair: LocalAudioPair = {
    capture_id: "capture-1",
    patient_id: "patient-1",
    source: "caregiver_review",
    utterance_id: "utterance-1",
    target_text: "Water",
    lang: "en",
    duration_seconds: 1.2,
    sha256: "ab".repeat(32),
    created_at: "2026-08-28T00:00:00.000Z",
    audio: new Blob(["wav"]),
  };

  it("restores only a review repeat for the same patient and utterance", () => {
    expect(isLocalReviewPairFor(pair, "patient-1", "utterance-1")).toBe(true);
    expect(isLocalReviewPairFor(pair, "patient-2", "utterance-1")).toBe(false);
    expect(isLocalReviewPairFor({ ...pair, source: "card_tap" },
      "patient-1", "utterance-1")).toBe(false);
  });
});

describe("Awaaz local training export", () => {
  const audio = new Blob(["abc"], { type: "audio/wav" });
  const pair: LocalAudioPair = {
    capture_id: "11111111-1111-4111-8111-111111111111",
    patient_id: "patient-12345678",
    source: "caregiver_review",
    utterance_id: "utterance-1",
    target_text: "Water",
    lang: "en",
    duration_seconds: 1.2,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    created_at: "2026-08-28T00:00:00.000Z",
    audio,
  };

  it("builds an integrity-checked tar with a manifest and the local WAV", async () => {
    const createdAt = new Date("2026-08-28T02:30:00.000Z");
    const archive = await buildLocalTrainingArchive([pair], createdAt);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const decoder = new TextDecoder();
    const entries = new Map<string, Uint8Array>();
    for (let offset = 0; offset < bytes.length - 1_024;) {
      const name = decoder.decode(bytes.slice(offset, offset + 100)).replace(/\0.*$/, "");
      if (!name) break;
      const sizeText = decoder.decode(bytes.slice(offset + 124, offset + 136))
        .replace(/\0.*$/, "").trim();
      const size = Number.parseInt(sizeText, 8);
      const start = offset + 512;
      entries.set(name, bytes.slice(start, start + size));
      offset = start + Math.ceil(size / 512) * 512;
    }
    expect(archive.type).toBe("application/x-tar");
    expect(bytes.length % 512).toBe(0);
    expect([...entries.keys()]).toEqual([
      "README.txt",
      "manifest.json",
      "audio/11111111-1111-4111-8111-111111111111.wav",
    ]);
    const manifest = JSON.parse(decoder.decode(entries.get("manifest.json")!));
    expect(manifest.media_uploaded_by_app).toBe(false);
    expect(manifest.pairs[0]).toMatchObject({ target_text: "Water" });
    expect(decoder.decode(entries.get(
      "audio/11111111-1111-4111-8111-111111111111.wav",
    )!)).toBe("abc");
    expect(bytes.slice(-1_024).every((byte) => byte === 0)).toBe(true);
    expect(trainingArchiveFilename(pair.patient_id, createdAt)).toBe(
      "awaaz-learning-patient1-2026-08-28T02-30-00-000Z.tar",
    );
  });

  it("refuses to export a WAV that no longer matches its registered hash", async () => {
    await expect(buildLocalTrainingArchive([{ ...pair, sha256: "00".repeat(32) }]))
      .rejects.toThrow("integrity check failed");
  });
});
