/**
 * Candidate-ranking policy logging for the Awaaz confirmation loop (AWA-FR-014, D-062/D-063).
 *
 * WHAT THIS IS FOR. `awaaz_policy_events` can only be estimated from if every row carries
 * the probability the behaviour policy assigned to the action the patient actually saw
 * first. That probability is drawn by the SERVER, never here: a client-reported propensity
 * is a number the estimator divides by on trust, and nothing downstream could tell a
 * mistaken one from an honest one. So this module mints an opaque event id, asks the server
 * for an ordering, renders exactly that ordering, and later reports what the patient did.
 * It never reorders, re-samples, or second-guesses the draw.
 *
 * WHAT IT IS NOT ALLOWED TO COST. Logging is an optional extra bolted onto a communication
 * aid used by people who cannot otherwise speak. Every function here is best-effort and
 * swallows its own failures: absent consent, a refusal, a timeout, an offline device and a
 * server error are all the same outcome — no event, and a confirmation loop that behaves
 * exactly as it would have if this file did not exist. Losing an event is correct.
 * Degrading communication is not.
 *
 * NO TEXT CROSSES THIS BOUNDARY. The endpoints take opaque UUIDs and scores and nothing
 * else (`extra="forbid"` on both request models). Candidate text is mapped to a per-slate
 * UUID here and the mapping stays on the device.
 */
import { isOnline } from "./offline";
import type {
  AwaazPolicyDecision,
  AwaazPolicyDecisionPayload,
  AwaazPolicyOutcome,
  AwaazPolicyOutcomePayload,
  AwaazSpeakResult,
} from "./types";

/** Mirrors `models.MIN_POLICY_CANDIDATES` / `MAX_POLICY_CANDIDATES`. */
export const MIN_POLICY_CANDIDATES = 2;
export const MAX_POLICY_CANDIDATES = 8;

/**
 * A hung decision call must never hold candidates off the screen. The patient is mid-
 * sentence; a slate that arrives late is worse than a slate that was never randomised, so
 * after this the original order is displayed and the event is simply not logged.
 */
export const POLICY_DECISION_TIMEOUT_MS = 1_200;

const CONSENT_KEY_PREFIX = "neurotrace.awaaz.policy-logging-consent.";

/** One already-screened option and the ranker's score for it. Text never leaves the device. */
export interface ScoredCandidate {
  text: string;
  score: number;
}

export interface PolicySlate {
  /** Minted when the slate was rendered; also the server's idempotency key. */
  eventId: string;
  /** Display order, as the server returned it. Parallel to `offeredIds`. */
  texts: string[];
  offeredIds: string[];
  /** The server drew and remembered a propensity, so an outcome may close this event. */
  drawn: boolean;
  /**
   * The first outcome reported for this slate. A retry resends THIS, with the same event
   * id: minting a new one would turn one decision into two observations in every weighted
   * sum, and reporting a different outcome would be refused by an append-only row anyway.
   */
  report: AwaazPolicyOutcomePayload | null;
  /** The server acknowledged the report. Nothing is ever sent for this slate again. */
  settled: boolean;
}

export interface PolicyLogClient {
  awaazPolicyDecision(
    patientId: string, payload: AwaazPolicyDecisionPayload,
  ): Promise<AwaazPolicyDecision>;
  awaazPolicyOutcome(
    patientId: string, payload: AwaazPolicyOutcomePayload,
  ): Promise<unknown>;
}

export interface PolicyLogOptions {
  /** PRD_AWAAZ §10.2: analytics logging is its own purpose and rides on no other consent. */
  consent: boolean;
  /** Defaults to `navigator.onLine`. Injected so the offline rule is testable. */
  online?: boolean;
  timeoutMs?: number;
}

// -------------------------------------------------------------------------- consent store
export function readPolicyLoggingConsent(patientId: string): boolean {
  try {
    return localStorage.getItem(`${CONSENT_KEY_PREFIX}${patientId}`) === "1";
  } catch {
    return false;
  }
}

export function writePolicyLoggingConsent(patientId: string, enabled: boolean): void {
  try {
    const key = `${CONSENT_KEY_PREFIX}${patientId}`;
    if (enabled) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // The in-memory setting still applies to this page even if storage is unavailable.
  }
}

// --------------------------------------------------------------------------- slate minting
/**
 * The scored slate for a confirmation-path response, or null when there is not one.
 *
 * THERE IS NEVER ONE TODAY, AND THAT IS A BACKEND CONTRACT GAP, NOT AN OVERSIGHT HERE.
 * `AwaazPolicyDecisionRequest` requires two or more candidates each carrying the ranker's
 * `score`, and `/awaaz/{id}/speak` returns `candidates: list[str]` — no scores, and in the
 * current product exactly one string, because nothing in this app produces alternatives.
 * The near-tie bound of D-063 is defined entirely in terms of those scores: a client that
 * invented them (all-equal, or a decay by position) would be manufacturing the tie
 * structure the exploration distribution is derived from, and every propensity recorded
 * afterwards would be the probability of a draw over a ranking that does not exist. That is
 * exactly the corruption the "server owns the randomisation" rule exists to prevent, so
 * this returns null and no decision is requested. Everything downstream of here is wired
 * and starts recording the day the speak contract carries per-candidate scores.
 */
export function scoredSlateFromSpeakResult(
  result: AwaazSpeakResult,
): ScoredCandidate[] | null {
  if (!result.requires_confirmation) return null;
  return null;
}

function isScorable(candidates: ScoredCandidate[]): boolean {
  if (candidates.length < MIN_POLICY_CANDIDATES) return false;
  if (candidates.length > MAX_POLICY_CANDIDATES) return false;
  const texts = new Set(candidates.map((candidate) => candidate.text));
  if (texts.size !== candidates.length) return false;
  return candidates.every((candidate) => (
    Number.isFinite(candidate.score) && candidate.score >= 0 && candidate.score <= 1
  ));
}

/** Mint the event id and one opaque id per candidate. No network, no side effects. */
export function mintPolicySlate(candidates: ScoredCandidate[]): PolicySlate | null {
  if (!isScorable(candidates)) return null;
  return {
    eventId: crypto.randomUUID(),
    texts: candidates.map((candidate) => candidate.text),
    offeredIds: candidates.map(() => crypto.randomUUID()),
    drawn: false,
    report: null,
    settled: false,
  };
}

export function policyDecisionPayload(
  slate: PolicySlate, candidates: ScoredCandidate[],
): AwaazPolicyDecisionPayload {
  return {
    event_id: slate.eventId,
    candidates: slate.offeredIds.map((candidateId, index) => ({
      candidate_id: candidateId,
      score: candidates[index].score,
    })),
    // Always true, and only ever sent from the confirmation path. INV-9: nothing that may
    // be spoken without the patient choosing it is reordered for the sake of an estimate.
    requires_confirmation: true,
    policy_logging_consent: true,
  };
}

/**
 * Reorder the slate into the order the server returned.
 *
 * Returns null if the response does not name exactly the ids we offered. That is a
 * disagreement about what the patient is about to see, and the only safe reading of it is
 * that this event has no trustworthy propensity — so the original order is displayed and
 * nothing is logged.
 */
export function applyServerOrder(
  slate: PolicySlate, decision: AwaazPolicyDecision,
): PolicySlate | null {
  const offered = decision.offered_candidate_ids;
  if (offered.length !== slate.offeredIds.length) return null;
  const positionOf = new Map(slate.offeredIds.map((id, index) => [id, index]));
  const texts: string[] = [];
  for (const id of offered) {
    const index = positionOf.get(id);
    if (index === undefined) return null;
    positionOf.delete(id);
    texts.push(slate.texts[index]);
  }
  return { ...slate, texts, offeredIds: [...offered], drawn: true };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("policy decision timed out")), timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export interface OpenedSlate {
  /** Null whenever nothing was logged; the loop behaves identically either way. */
  slate: PolicySlate | null;
  /** What to display, always. The server's order when it drew, the original order if not. */
  texts: string[];
}

/**
 * Ask the server for an ordering and a propensity. Never throws.
 *
 * OFFLINE DOES NOT QUEUE, DELIBERATELY. A propensity recorded now and uploaded later is
 * still a valid observation, but a decision the server never drew has no propensity at all.
 * Queueing would mean either shipping a fabricated denominator or shipping an outcome with
 * no decision behind it, and either one corrupts every weighted sum computed from this log.
 * An offline slate is therefore simply not an event. That loses observations, which is the
 * correct direction to fail.
 */
export async function openPolicySlate(
  client: PolicyLogClient,
  patientId: string,
  candidates: ScoredCandidate[],
  options: PolicyLogOptions,
): Promise<OpenedSlate> {
  const texts = candidates.map((candidate) => candidate.text);
  // Absent consent is a normal state, not a failure: the decision endpoint would refuse
  // with a 409 and the patient would gain nothing from the round trip.
  if (!options.consent) return { slate: null, texts };
  if (!(options.online ?? isOnline())) return { slate: null, texts };

  const slate = mintPolicySlate(candidates);
  if (!slate) return { slate: null, texts };

  try {
    const decision = await withTimeout(
      client.awaazPolicyDecision(patientId, policyDecisionPayload(slate, candidates)),
      options.timeoutMs ?? POLICY_DECISION_TIMEOUT_MS,
    );
    const drawn = applyServerOrder(slate, decision);
    if (!drawn) return { slate: null, texts };
    return { slate: drawn, texts: drawn.texts };
  } catch {
    // A refusal, a timeout, a dropped connection: all identical from here. Show what we
    // were going to show anyway and log nothing.
    return { slate: null, texts };
  }
}

// -------------------------------------------------------------------------------- outcomes
export interface PolicyOutcomeReport {
  outcome: AwaazPolicyOutcome;
  /** The candidate the patient tapped, by its display text. */
  selectedText?: string;
  rejectedTexts?: string[];
  confirmationObserved?: boolean;
  outputSpoken?: boolean;
}

export const selectedOutcome = (text: string): PolicyOutcomeReport => ({
  // A tap IS the confirmation event (INV-9), and it is the only thing that lets the server
  // accept `output_spoken`.
  outcome: "selected",
  selectedText: text,
  confirmationObserved: true,
  outputSpoken: true,
});

export const rejectedOutcome = (texts: string[]): PolicyOutcomeReport => ({
  outcome: "rejected", rejectedTexts: texts,
});

export const correctedOutcome = (): PolicyOutcomeReport => ({ outcome: "corrected" });

export const phraseBoardFallbackOutcome = (): PolicyOutcomeReport => ({
  outcome: "phrase_board_fallback",
});

/**
 * The patient did none of the four. Recorded rather than dropped: a log that exists only
 * when the patient reacted is a sample selected on the outcome.
 */
export const noExplicitSignalOutcome = (): PolicyOutcomeReport => ({
  outcome: "no_explicit_signal",
});

/**
 * Build the wire body, or null if the report cannot be expressed against this slate.
 *
 * The validity rules are the server's (`AwaazPolicyOutcomeRequest.outcome_matches_its_
 * evidence`); they are repeated here only so an unsendable body is never sent, not as a
 * second opinion.
 */
export function policyOutcomePayload(
  slate: PolicySlate, report: PolicyOutcomeReport,
): AwaazPolicyOutcomePayload | null {
  const idOf = (text: string): string | null => {
    const index = slate.texts.indexOf(text);
    return index === -1 ? null : slate.offeredIds[index];
  };
  const selected = report.selectedText === undefined ? null : idOf(report.selectedText);
  if (report.selectedText !== undefined && selected === null) return null;

  const rejected: string[] = [];
  for (const text of report.rejectedTexts ?? []) {
    const id = idOf(text);
    if (id === null) return null;
    if (id !== selected && !rejected.includes(id)) rejected.push(id);
  }

  const confirmed = Boolean(report.confirmationObserved) && selected !== null;
  const spoken = Boolean(report.outputSpoken) && confirmed;

  if (report.outcome === "selected" && selected === null) return null;
  if (report.outcome === "rejected" && rejected.length === 0) return null;
  if (
    (report.outcome === "phrase_board_fallback" || report.outcome === "no_explicit_signal")
    && selected !== null
  ) return null;
  if (
    report.outcome === "no_explicit_signal"
    && (rejected.length > 0 || confirmed || spoken)
  ) return null;

  return {
    event_id: slate.eventId,
    outcome: report.outcome,
    selected_action_id: selected,
    rejected_action_ids: rejected,
    confirmation_observed: confirmed,
    output_spoken: spoken,
  };
}

/**
 * Report what the patient did. Never throws, never blocks a tap, never retries on its own.
 *
 * `slate` is mutated in place so a caller holding it in a ref cannot accidentally mint a
 * second event id for one decision: the first report wins, a retry resends that same body,
 * and once the server has acknowledged it nothing is sent again.
 */
export async function reportPolicyOutcome(
  client: PolicyLogClient,
  patientId: string,
  slate: PolicySlate,
  report: PolicyOutcomeReport,
): Promise<void> {
  if (!slate.drawn || slate.settled) return;
  const body = slate.report ?? policyOutcomePayload(slate, report);
  if (!body) return;
  slate.report = body;
  try {
    await client.awaazPolicyOutcome(patientId, body);
    slate.settled = true;
  } catch {
    // Losing an event is correct. Retrying here would compete with the next thing the
    // patient is trying to say, and the loop has already moved on without it.
  }
}
