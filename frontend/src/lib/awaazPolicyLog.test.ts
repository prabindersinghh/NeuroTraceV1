import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "./api";
import {
  correctedOutcome,
  noExplicitSignalOutcome,
  openPolicySlate,
  phraseBoardFallbackOutcome,
  rejectedOutcome,
  reportPolicyOutcome,
  scoredSlateFromSpeakResult,
  selectedOutcome,
  type PolicyLogClient,
  type PolicySlate,
  type ScoredCandidate,
} from "./awaazPolicyLog";
import type {
  AwaazPolicyDecision,
  AwaazPolicyDecisionPayload,
  AwaazPolicyOutcomePayload,
  AwaazSpeakResult,
} from "./types";

const SLATE: ScoredCandidate[] = [
  { text: "ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ", score: 0.62 },
  { text: "ਮੈਨੂੰ ਦਵਾਈ ਚਾਹੀਦੀ ਹੈ", score: 0.60 },
  { text: "ਮੈਨੂੰ ਆਰਾਮ ਚਾਹੀਦਾ ਹੈ", score: 0.31 },
];

interface Recorder extends PolicyLogClient {
  decisions: AwaazPolicyDecisionPayload[];
  outcomes: AwaazPolicyOutcomePayload[];
}

/**
 * A server that hands back a genuinely different order from the one it was sent, so a
 * client that quietly re-sorted would fail every ordering assertion below.
 */
function recorder(options: {
  order?: (ids: string[]) => string[];
  decisionFails?: unknown;
  outcomeFailsTimes?: number;
} = {}): Recorder {
  let outcomeFailures = options.outcomeFailsTimes ?? 0;
  const client: Recorder = {
    decisions: [],
    outcomes: [],
    async awaazPolicyDecision(_patientId, payload) {
      client.decisions.push(payload);
      if (options.decisionFails) throw options.decisionFails;
      const sent = payload.candidates.map((candidate) => candidate.candidate_id);
      const offered = (options.order ?? ((ids) => [...ids].reverse()))(sent);
      return {
        event_id: payload.event_id,
        behavior_policy_id: "awaaz-rank-v1",
        offered_candidate_ids: offered,
        logged_action_id: offered[0],
        logged_action_probability: 0.08,
        top_ranked_action_id: sent[0],
        randomised: true,
        exploration_epsilon: 0.08,
        near_tie_margin: 0.05,
      } satisfies AwaazPolicyDecision;
    },
    async awaazPolicyOutcome(_patientId, payload) {
      client.outcomes.push(payload);
      if (outcomeFailures > 0) {
        outcomeFailures -= 1;
        throw new ApiError(0, "offline");
      }
      return {};
    },
  };
  return client;
}

async function drawnSlate(client: Recorder): Promise<PolicySlate> {
  const opened = await openPolicySlate(client, "patient-1", SLATE, {
    consent: true, online: true,
  });
  if (!opened.slate) throw new Error("expected a drawn slate");
  return opened.slate;
}

let online: boolean;

beforeEach(() => {
  online = true;
});

describe("Awaaz candidate-ranking decision", () => {
  it("displays the slate in the order the server returned, not the order it was sent", async () => {
    const client = recorder();
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online,
    });

    expect(client.decisions).toHaveLength(1);
    const sent = client.decisions[0].candidates.map((c) => c.candidate_id);
    expect(opened.slate?.offeredIds).toEqual([...sent].reverse());
    expect(opened.texts).toEqual([
      "ਮੈਨੂੰ ਆਰਾਮ ਚਾਹੀਦਾ ਹੈ", "ਮੈਨੂੰ ਦਵਾਈ ਚਾਹੀਦੀ ਹੈ", "ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ",
    ]);
    expect(opened.texts).not.toEqual(SLATE.map((c) => c.text));
  });

  it("sends opaque ids, the scores, and nothing a transcript could be rebuilt from", async () => {
    const client = recorder();
    await openPolicySlate(client, "patient-1", SLATE, { consent: true, online });

    const payload = client.decisions[0];
    expect(Object.keys(payload).sort()).toEqual([
      "candidates", "event_id", "policy_logging_consent", "requires_confirmation",
    ]);
    expect(payload.requires_confirmation).toBe(true);
    expect(payload.candidates.map((c) => c.score)).toEqual([0.62, 0.60, 0.31]);
    expect(JSON.stringify(payload)).not.toContain("ਪਾਣੀ");
  });

  it("shows the original order and logs nothing when the decision call fails", async () => {
    const client = recorder({ decisionFails: new ApiError(500, "boom") });
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online,
    });

    expect(opened.slate).toBeNull();
    expect(opened.texts).toEqual(SLATE.map((c) => c.text));
    // Nothing may be reported for an event the server never drew a propensity for.
    expect(client.outcomes).toEqual([]);
  });

  it("shows the original order and logs nothing when the decision call times out", async () => {
    const client: PolicyLogClient = {
      awaazPolicyDecision: () => new Promise(() => undefined),
      awaazPolicyOutcome: async () => ({}),
    };
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online, timeoutMs: 5,
    });

    expect(opened.slate).toBeNull();
    expect(opened.texts).toEqual(SLATE.map((c) => c.text));
  });

  it("treats absent consent as a normal state: no call, no event, same slate", async () => {
    const client = recorder();
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: false, online,
    });

    expect(client.decisions).toEqual([]);
    expect(opened.slate).toBeNull();
    expect(opened.texts).toEqual(SLATE.map((c) => c.text));
  });

  it("does not log or queue anything offline", async () => {
    const client = recorder();
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online: false,
    });

    expect(client.decisions).toEqual([]);
    expect(client.outcomes).toEqual([]);
    expect(opened.slate).toBeNull();
    expect(opened.texts).toEqual(SLATE.map((c) => c.text));
  });

  it("refuses an ordering that is not the slate it offered", async () => {
    const client = recorder({ order: (ids) => [ids[0], ids[1], crypto.randomUUID()] });
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online,
    });

    expect(opened.slate).toBeNull();
    expect(opened.texts).toEqual(SLATE.map((c) => c.text));
  });

  it("has no scored slate to draw from, because /speak carries no candidate scores", () => {
    const result = {
      patient_id: "patient-1",
      text: null,
      lang: "pa",
      mode: "confirm",
      speak_now: false,
      candidates: ["ਮੈਨੂੰ ਪਾਣੀ ਚਾਹੀਦਾ ਹੈ", "ਮੈਨੂੰ ਦਵਾਈ ਚਾਹੀਦੀ ਹੈ"],
      reason: "word-finding is affected",
      requires_confirmation: true,
      utterance_id: null,
      audio_pair_registered: false,
    } satisfies AwaazSpeakResult;

    // Pinned deliberately. Inventing scores would manufacture the near-tie structure the
    // exploration distribution is derived from, so no event is logged until the speak
    // contract carries the ranker's scores.
    expect(scoredSlateFromSpeakResult(result)).toBeNull();
  });
});

describe("Awaaz candidate-ranking outcome", () => {
  it("reports a selection with the tapped candidate and the confirmation that spoke it", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, selectedOutcome(slate.texts[1]));

    expect(client.outcomes).toEqual([{
      event_id: slate.eventId,
      outcome: "selected",
      selected_action_id: slate.offeredIds[1],
      rejected_action_ids: [],
      confirmation_observed: true,
      output_spoken: true,
    }]);
  });

  it("reports a rejection of every candidate that was offered", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, rejectedOutcome(slate.texts));

    expect(client.outcomes[0]).toEqual({
      event_id: slate.eventId,
      outcome: "rejected",
      selected_action_id: null,
      rejected_action_ids: slate.offeredIds,
      confirmation_observed: false,
      output_spoken: false,
    });
  });

  it("reports a correction with no selection and nothing spoken", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, correctedOutcome());

    expect(client.outcomes[0]).toEqual({
      event_id: slate.eventId,
      outcome: "corrected",
      selected_action_id: null,
      rejected_action_ids: [],
      confirmation_observed: false,
      output_spoken: false,
    });
  });

  it("reports leaving for the phrase board as the fallback, not as a rejection", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, phraseBoardFallbackOutcome());

    expect(client.outcomes[0].outcome).toBe("phrase_board_fallback");
    expect(client.outcomes[0].selected_action_id).toBeNull();
    expect(client.outcomes[0].rejected_action_ids).toEqual([]);
  });

  it("reports no_explicit_signal carrying no evidence of a signal", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, noExplicitSignalOutcome());

    expect(client.outcomes[0]).toEqual({
      event_id: slate.eventId,
      outcome: "no_explicit_signal",
      selected_action_id: null,
      rejected_action_ids: [],
      confirmation_observed: false,
      output_spoken: false,
    });
  });

  it("reuses the event id and the first outcome on a retry, never minting a second", async () => {
    const client = recorder({ outcomeFailsTimes: 1 });
    const slate = await drawnSlate(client);

    await reportPolicyOutcome(client, "patient-1", slate, selectedOutcome(slate.texts[0]));
    expect(slate.settled).toBe(false);
    // A later trigger reports a different outcome; the retry must still be the first one,
    // or one decision becomes two observations in every weighted sum.
    await reportPolicyOutcome(client, "patient-1", slate, noExplicitSignalOutcome());

    expect(client.outcomes).toHaveLength(2);
    expect(client.outcomes[0]).toEqual(client.outcomes[1]);
    expect(client.outcomes[1].event_id).toBe(slate.eventId);
    expect(slate.settled).toBe(true);
  });

  it("sends one accepted report and never sends again", async () => {
    const client = recorder();
    const slate = await drawnSlate(client);
    await reportPolicyOutcome(client, "patient-1", slate, correctedOutcome());
    await reportPolicyOutcome(client, "patient-1", slate, correctedOutcome());

    expect(client.outcomes).toHaveLength(1);
  });

  it("reports nothing for a slate the server never drew", async () => {
    const client = recorder({ decisionFails: new ApiError(0, "offline") });
    const opened = await openPolicySlate(client, "patient-1", SLATE, {
      consent: true, online,
    });
    expect(opened.slate).toBeNull();
    expect(client.outcomes).toEqual([]);
  });

  it("swallows an outcome failure rather than surfacing it to the patient", async () => {
    const client = recorder({ outcomeFailsTimes: 5 });
    const slate = await drawnSlate(client);
    await expect(
      reportPolicyOutcome(client, "patient-1", slate, correctedOutcome()),
    ).resolves.toBeUndefined();
  });
});
