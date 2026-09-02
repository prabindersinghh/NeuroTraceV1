import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  isCachedAwaazBoardFor,
  mayUseOfflineBoard,
  offlineBoardCacheKey,
  type CachedAwaazBoard,
} from "./awaazOfflineBoard";
import type { AwaazBoard } from "./types";

const BOARD = {
  patient_id: "patient-1",
  profile: {
    patient_id: "patient-1",
    speech_profile: "dysarthria_dominant",
    auto_speak_enabled: false,
    auto_speak_threshold: 0.85,
    voice_status: "none",
    endpoint_silence_seconds: 2.5,
  },
  cards: [{
    id: "card-1",
    text: "ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ",
    lang: "pa",
    icon: "water",
    category: "needs",
    slot: 1,
    use_count: 2,
    is_emergency: false,
  }],
} satisfies AwaazBoard;

function snapshot(): CachedAwaazBoard {
  return {
    key: offlineBoardCacheKey("user-1", "patient-1"),
    schema_version: 1,
    owner_user_id: "user-1",
    patient_id: "patient-1",
    cached_at: "2026-08-29T03:00:00.000Z",
    board: BOARD,
  };
}

describe("Awaaz offline board authorization boundary", () => {
  it("uses a cached board only when the server cannot be reached", () => {
    expect(mayUseOfflineBoard(new ApiError(0, "offline"))).toBe(true);
    expect(mayUseOfflineBoard(new ApiError(401, "expired"))).toBe(false);
    expect(mayUseOfflineBoard(new ApiError(403, "revoked"))).toBe(false);
    expect(mayUseOfflineBoard(new ApiError(404, "missing"))).toBe(false);
    expect(mayUseOfflineBoard(new Error("unexpected"))).toBe(false);
  });

  it("binds a snapshot to both the authenticated user and patient", () => {
    expect(offlineBoardCacheKey("user-1", "patient-1"))
      .not.toBe(offlineBoardCacheKey("user-2", "patient-1"));
    expect(isCachedAwaazBoardFor(snapshot(), "user-1", "patient-1")).toBe(true);
    expect(isCachedAwaazBoardFor(snapshot(), "user-2", "patient-1")).toBe(false);
    expect(isCachedAwaazBoardFor(snapshot(), "user-1", "patient-2")).toBe(false);
  });

  it("fails closed on a corrupt or cross-patient snapshot", () => {
    const wrongBoard = snapshot();
    wrongBoard.board = { ...BOARD, patient_id: "patient-2" };
    expect(isCachedAwaazBoardFor(wrongBoard, "user-1", "patient-1")).toBe(false);

    const corruptCard = snapshot() as unknown as Record<string, unknown>;
    corruptCard.board = { ...BOARD, cards: [{ id: "card-1", text: null }] };
    expect(isCachedAwaazBoardFor(corruptCard, "user-1", "patient-1")).toBe(false);

    const corruptProfile = snapshot() as unknown as Record<string, unknown>;
    corruptProfile.board = {
      ...BOARD,
      profile: { ...BOARD.profile, endpoint_silence_seconds: "two" },
    };
    expect(isCachedAwaazBoardFor(corruptProfile, "user-1", "patient-1")).toBe(false);
  });
});
