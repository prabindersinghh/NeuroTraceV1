import { describe, expect, it } from "vitest";

import {
  confirmedCandidatePayload,
  DEMO_MUFFLED_PRESETS,
  emergencyPhrase,
  getLocalizedCardText,
  personalPhrasePayload,
} from "./awaaz";
import type { AwaazBoard } from "./types";

describe("Awaaz interaction contract", () => {
  it("marks only the candidate tap as the confirmation event", () => {
    expect(confirmedCandidatePayload("  पानी  ", "hi", 0.43)).toEqual({
      text: "पानी",
      lang: "hi",
      confidence: 0.43,
      confirmed_candidate: true,
    });
  });

  it("speaks the patient's pinned emergency card instead of a second hard-coded phrase", () => {
    const board = {
      patient_id: "p1",
      profile: {
        patient_id: "p1",
        speech_profile: "unassessed",
        auto_speak_enabled: false,
        auto_speak_threshold: 0.85,
        voice_status: "none",
        endpoint_silence_seconds: 2.5,
      },
      cards: [{
        id: "c1", text: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ", lang: "pa", icon: "alert",
        category: "emergency", slot: 0, use_count: 0, is_emergency: true,
      }],
    } satisfies AwaazBoard;

    expect(emergencyPhrase(board, "pa")).toBe("ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ");
  });

  it("has a language fallback before the board loads", () => {
    expect(emergencyPhrase(null, "hi")).toBe("मुझे मदद चाहिए");
  });

  it("builds a trimmed patient-language personal phrase and refuses whitespace", () => {
    expect(personalPhrasePayload("  ਡਾਕਟਰ ਨੂੰ ਬੁਲਾਓ  ", "pa")).toEqual({
      text: "ਡਾਕਟਰ ਨੂੰ ਬੁਲਾਓ",
      lang: "pa",
      category: "personal",
    });
    expect(personalPhrasePayload("   ", "en")).toBeNull();
  });

  it("strictly isolates emergency phrase language when user toggles English vs Punjabi", () => {
    const englishBoard = {
      patient_id: "p1",
      profile: {
        patient_id: "p1",
        speech_profile: "unassessed",
        auto_speak_enabled: false,
        auto_speak_threshold: 0.85,
        voice_status: "none",
        endpoint_silence_seconds: 2.5,
      },
      cards: [{
        id: "c1", text: "I need help", lang: "en", icon: "alert",
        category: "emergency", slot: 0, use_count: 0, is_emergency: true,
      }],
    } satisfies AwaazBoard;

    // Toggling to Punjabi returns Punjabi emergency phrase
    expect(emergencyPhrase(englishBoard, "pa")).toBe("ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ");
    // Toggling to English returns English emergency phrase
    expect(emergencyPhrase(englishBoard, "en")).toBe("I need help");
  });

  it("localizes phrase board cards between English and Punjabi correctly", () => {
    // Slot 1 (Water / ਪਾਣੀ)
    expect(getLocalizedCardText({ slot: 1, text: "Water" }, "pa")).toBe("ਪਾਣੀ");
    expect(getLocalizedCardText({ slot: 1, text: "ਪਾਣੀ" }, "en")).toBe("Water");

    // Slot 2 (Toilet / ਪਖਾਨਾ)
    expect(getLocalizedCardText({ slot: 2, text: "Toilet" }, "pa")).toBe("ਪਖਾਨਾ");
    expect(getLocalizedCardText({ slot: 2, text: "ਪਖਾਨਾ" }, "en")).toBe("Toilet");

    // Match by text lookup when slot is null
    expect(getLocalizedCardText({ text: "Water" }, "pa")).toBe("ਪਾਣੀ");
    expect(getLocalizedCardText({ text: "ਪਾਣੀ" }, "en")).toBe("Water");

    // Custom personal phrase remains untouched
    expect(getLocalizedCardText({ text: "My eyeglasses" }, "pa")).toBe("My eyeglasses");
  });

  it("provides comprehensive demo presets for English and Punjabi neural reconstruction", () => {
    expect(DEMO_MUFFLED_PRESETS.length).toBeGreaterThanOrEqual(4);

    for (const preset of DEMO_MUFFLED_PRESETS) {
      expect(preset.title.en).toBeTruthy();
      expect(preset.title.pa).toBeTruthy();
      expect(preset.muffledPhonetic.en).toBeTruthy();
      expect(preset.muffledPhonetic.pa).toBeTruthy();
      expect(preset.reconstructedText.en).toBeTruthy();
      expect(preset.reconstructedText.pa).toBeTruthy();
      expect(preset.acousticMetrics.jitter).toBeGreaterThan(0);
      expect(preset.acousticMetrics.shimmer).toBeGreaterThan(0);
      expect(preset.acousticMetrics.hnr).toBeGreaterThan(0);
    }
  });
});
