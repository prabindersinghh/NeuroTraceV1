/** Pure endpointing state for optional Awaaz silence auto-stop. */

export const SPEECH_LEVEL_THRESHOLD = 0.025;
export const MAX_CAPTURE_SECONDS = 30;

export interface EndpointState {
  startedAtMs: number;
  heardSpeech: boolean;
  lastSpeechAtMs: number;
}

export interface EndpointUpdate {
  state: EndpointState;
  shouldStop: boolean;
  reason: "silence" | "maximum" | null;
}

export function startEndpointState(nowMs: number): EndpointState {
  return { startedAtMs: nowMs, heardSpeech: false, lastSpeechAtMs: nowMs };
}

/**
 * Advance one level sample. Silence can stop only after speech was observed, so opening
 * the microphone while somebody gathers their words never starts a cutoff timer. The
 * caller chooses whether to honour the silence result; the 30-second safety cap is always
 * honoured to keep local recordings bounded.
 */
export function advanceEndpoint(
  current: EndpointState,
  level: number,
  nowMs: number,
  silenceSeconds: number,
): EndpointUpdate {
  const state = { ...current };
  if (Number.isFinite(level) && level >= SPEECH_LEVEL_THRESHOLD) {
    state.heardSpeech = true;
    state.lastSpeechAtMs = nowMs;
  }

  if (nowMs - state.startedAtMs >= MAX_CAPTURE_SECONDS * 1000) {
    return { state, shouldStop: true, reason: "maximum" };
  }
  if (
    state.heardSpeech
    && nowMs - state.lastSpeechAtMs >= silenceSeconds * 1000
  ) {
    return { state, shouldStop: true, reason: "silence" };
  }
  return { state, shouldStop: false, reason: null };
}
