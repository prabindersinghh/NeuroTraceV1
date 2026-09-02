import { describe, expect, it } from "vitest";

import {
  confirmedCandidatePayload,
  emergencyPhrase,
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
});
