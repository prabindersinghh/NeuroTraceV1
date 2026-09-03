/** `caretaker` is family ADDITIONAL to the caregiver who enrolled the patient — a second
 *  sibling, a relative abroad. They see everything clinical about their own linked patient
 *  and nothing about anyone else's; the caregiver keeps consent, linking and erasure.
 *  See docs/plans/PLAN_caretaker_onboarding.md and D-054. */
export type Role =
  | "patient"
  | "caregiver"
  | "clinician"
  | "asha_worker"
  | "admin"
  | "caretaker";

export type CaretakerRelationship = "SON" | "DAUGHTER" | "SPOUSE" | "SIBLING" | "OTHER";
export type NotificationChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface CaretakerLink {
  id: string;
  caretaker_id: string;
  full_name: string | null;
  relationship: CaretakerRelationship;
  active: boolean;
  linked_at: string;
  unlinked_at: string | null;
}
/** PATTERN_ATYPICAL is a real band the engine emits, not a placeholder: persistent,
 *  cross-modal, but SYMMETRIC change. Leaving it out of this union is how the dashboard
 *  came to crash on it — `BAND_STYLE[band]` returned undefined and `style.ring` threw,
 *  for exactly the patient the laterality gate exists to protect. */
export type Band = "STABLE" | "WATCH" | "ALERT" | "PATTERN_ATYPICAL";
export type Lang = "en" | "hi" | "pa";
/** Part 2 (D-044): renamed from "daily" | "weekly" | "monthly", which described a
 *  MODULE's measurement schedule, not a session, and never differentiated live content —
 *  every session ran the full battery regardless. These four values now genuinely drive
 *  what the server's `/sessions/plan-v2/{session_type}` returns. */
export type SessionType = "DAILY_PULSE" | "COMPREHENSIVE" | "MONTHLY" | "ASHA_VISIT";
/** Migration 0015 replaced the three lowercase values with these five. Part 3 added
 *  DOCTOR_REVIEW_PENDING (criteria met, no clinician has confirmed) and ABANDONED. */
export type BaselineState =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "DOCTOR_REVIEW_PENDING"
  | "LOCKED"
  | "ABANDONED";
export type StrokeSide = "left" | "right" | "bilateral" | "unknown";
// DHI added with the posterior-circulation scope widening: for a patient whose deficits
// are vertigo and imbalance rather than weakness, it is the closest thing to a functional
// outcome measure we have.
export type Instrument = "PHQ2" | "PHQ9" | "EAT10" | "FSS" | "BARTHEL" | "DHI";

/** What the questionnaire endpoint returns. Shape is common to every instrument. */
export interface QuestionnaireResult {
  instrument: Instrument;
  total: number;
  band: string;
  escalate: boolean;
  note?: string | null;
  /** DHI only: physical / emotional / functional subscores. */
  physical?: number;
  emotional?: number;
  functional?: number;
}

export interface User {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
  lang: string;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthResponse {
  user: User;
  tokens: TokenPair;
}

export interface Patient {
  id: string;
  caregiver_id: string;
  clinician_id: string | null;
  user_id: string | null;
  name: string;
  age: number | null;
  sex: string | null;
  stroke_side: StrokeSide;
  stroke_date: string | null;
  enrolment_date: string;
  languages: string[];
  preferred_hour: number | null;
  education_band: string | null;
  baseline_state: BaselineState;
  created_at: string;
  intensity: string;
  aphasia_mode: boolean;
  consent_version: string | null;
  onboarding_complete: boolean;
  /** Part 5.4. Non-null means this row is an erasure TOMBSTONE: every measurement is gone
   *  and every identifying field is cleared, so `name` is `""`. The row survives because
   *  `audit_log.patient_id` cascades on delete and removing it would destroy the record of
   *  who saw this person's data. Check this before rendering a patient's name. */
  erased_at: string | null;
}

/** One exam module, as described by GET /sessions/battery/{schedule}. */
export interface BatteryModule {
  code: string;
  name: string;
  domain: string;
  tasks: string[];
  seconds: number;
  nihss_item: number | null;
  instructions: { en: string; hi: string };
}

export interface Battery {
  schedule: SessionType;
  total_seconds: number;
  modules: BatteryModule[];
}

export interface ExamSession {
  id: string;
  patient_id: string;
  ts: string;
  type: SessionType;
  quality_score: number;
  identity_verified: boolean;
  off_window: boolean;
  completed: boolean;
  offline_captured: boolean;
  /** Present only when the patient exited part-way: {at, steps_completed, steps_total}. */
  abandoned?: { at: string; steps_completed: number; steps_total: number } | null;
}

export interface ModuleResult {
  id: string;
  session_id: string;
  module_code: string;
  domain: string;
  features_json: Record<string, number>;
  quality_flag: boolean;
  created_at: string;
}

export interface FastItem {
  letter: string;
  label: string;
  detail: string;
}

export interface FastCard {
  title: string;
  items: FastItem[];
  emergency_numbers: { label: string; number: string }[];
  limitation_notice: string;
}

export interface Confounders {
  active: string[];
  confidence: number;
  labels_en: string[];
  labels_hi: string[];
}

export interface FinalizeResult {
  session_id: string;
  patient_id: string;
  band: Band;
  reason: string;
  gate1_passed: boolean;
  gate2_passed: boolean;
  persistent_domains: string[];
  domain_deviations: Record<string, number>;
  drivers: [string, number][];
  confounders: Confounders;
  confidence: number;
  improving: boolean;
  sustained_sessions: number;
  baseline_phase: boolean;
  baseline_state: BaselineState;
  explanation_en: string;
  explanation_hi: string;
  explanation_source: "slm" | "template";
  guardrail_violations: string[];
  clinician_line: string;
  alert_id: string | null;
  fast: FastCard;
}

export interface TrendPoint {
  date: string;
  session_id: string;
  band: Band;
  domain_devs: Record<string, number>;
  confidence: number;
  baseline_phase: boolean;
}

export interface HistoryRow {
  date: string;
  band: Band;
  reason: string | null;
  explanation_en: string | null;
  explanation_hi: string | null;
  confidence: number;
  baseline_phase: boolean;
  confounders: string[];
}

export interface Alert {
  id: string;
  patient_id: string;
  score_id: string;
  band: Band;
  drivers_json: [string, number][] | null;
  confounders_json: Confounders | null;
  explanation_en: string;
  explanation_hi: string | null;
  clinician_line: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}

export interface Score {
  id: string;
  patient_id: string;
  session_id: string;
  domain_devs_json: Record<string, number>;
  band: Band;
  gate1_passed: boolean;
  gate2_passed: boolean;
  persistent_domains: string[] | null;
  drivers_json: [string, number][] | null;
  confounders_json: Confounders | null;
  confidence: number;
  improving: boolean;
  reason: string | null;
  baseline_phase: boolean;
  explanation_en: string | null;
  explanation_hi: string | null;
  explanation_source: string;
  created_at: string;
}

export interface BaselineProgress {
  state: BaselineState;
  modules_locked: number;
  modules_total: number;
  min_sessions: number;
  required_sessions: number;
  window_min_days: number;
  window_max_days: number;
}

/** One module's evidence in the doctor's baseline review — `build_review` in
 *  `services/baseline_review.py`. The cadence asymmetry is deliberately visible: a
 *  twice-weekly module carries ~6 observations to a daily module's ~21, and a doctor
 *  who is not shown `cadence_note` reads six points as thin data (D-043/D-044). */
export interface BaselineReviewModule {
  module_code: string;
  name: string;
  domain: string | null;
  schedule: string;
  cadence_note: string;
  n_sessions: number;
  n_rejected: number;
  n_discarded_as_practice: number;
  capture_quality_rate: number | null;
  locked: boolean;
  reason: string | null;
  window_start: string | null;
  window_end: string | null;
  median: Record<string, number>;
  variability_mad: Record<string, number>;
  trajectory: Record<string, number>;
}

export interface BaselineCompletion {
  ready_for_review: boolean;
  blockers: string[];
  all_modules_locked: boolean;
  days_elapsed: number;
  sessions: number;
  adherence: number;
  first_session: string | null;
  last_session: string | null;
}

export type BaselineReviewAction = "CONFIRM" | "EXTEND" | "FLAG_CONCERN";

export interface BaselineReviewEntry {
  action: BaselineReviewAction;
  note: string | null;
  reviewed_at: string;
  clinician_id: string | null;
  sessions_in_window: number | null;
}

export interface BaselineReviewView {
  patient_id: string;
  baseline_state: BaselineState;
  completion: BaselineCompletion;
  modules: BaselineReviewModule[];
  summary: string;
  previous_reviews: BaselineReviewEntry[];
  /** Stated on every render: the advisory models behind these numbers are synthetic
   *  (ML_STATUS.md), and a clinician signing a baseline should know that. */
  disclosure: string;
}

/** The seven consents, Part 4. `models.py:ConsentType` is the source of truth — C7
 *  (`CARETAKER_SHARING`) was added with the caretaker work and every docstring around it
 *  still says "six", which is why this list is spelled out rather than counted. */
export type ConsentType =
  | "FOLLOW_UP"
  | "DATA_PROCESSING"
  | "CLINICIAN_SHARING"
  | "RESEARCH"
  | "MEDIA_TESTIMONIAL"
  | "TELECONSULTATION"
  | "CARETAKER_SHARING";

export interface ConsentState {
  granted: boolean;
  /** The wording version actually agreed to. Null when never asked — which is NOT consent. */
  version: string | null;
  current_version: string;
  /** In force, but agreed at older wording. A prompt to re-ask, never an access gate:
   *  `services/consent.py` is explicit that yesterday's wording is still valid consent. */
  stale: boolean;
  granted_at: string | null;
  withdrawn_at: string | null;
  /** C4/C5 only. The product works without them, so silence must not read as yes. */
  default_off: boolean;
}

/** `GET /consents/{id}` — every type, always all of them, keyed by `ConsentType`. */
export type ConsentStatus = Record<ConsentType, ConsentState>;

export interface QuestionnaireRead {
  id: string;
  patient_id: string;
  instrument: Instrument;
  score: number;
  flags_json: Record<string, unknown> | null;
  ts: string;
}

export interface Dashboard {
  patient: Patient;
  baseline: BaselineProgress;
  latest: Score | null;
  trends: TrendPoint[];
  history: HistoryRow[];
  alerts: Alert[];
  adherence_streak: number;
  adherence_rate_30d: number;
  latest_questionnaires: QuestionnaireRead[];
  dev_threshold: number;
  fast: FastCard;
}

export interface ClinicPatientRow {
  patient_id: string;
  name: string;
  age: number | null;
  band: Band | null;
  sustained_domains: string[];
  confidence: number;
  last_session: string | null;
  unacknowledged_alerts: number;
  baseline_state: BaselineState;
}

export interface AcuteResponse {
  escalate: boolean;
  scoring_bypassed: boolean;
  reported: string[];
  reported_labels: string[];
  message: string;
  fast: FastCard;
  emergency_number: string;
}

export interface AcuteSymptom {
  code: string;
  label: string;
}

/** Features extracted on-device and POSTed. Raw media never leaves the phone. */
export type ModuleFeatures = Record<string, number>;

// --- wearables -------------------------------------------------------------
export type WearableMetric =
  | "heart_rate" | "irregular_rhythm" | "sleep_quality" | "step_count"
  | "spo2" | "blood_pressure_systolic" | "blood_pressure_diastolic";

export interface WearableReading {
  metric: WearableMetric;
  value: number;
  unit: string | null;
  ts: string;
  source: string;
  device_id: string | null;
}

export interface FallEvent {
  id: string;
  patient_id: string;
  ts: string;
  source: string;
  dismissed_by_patient: boolean;
  /** Always true — a fall never enters the deviation engine. */
  scoring_bypassed: boolean;
  caregiver_notified: boolean;
  acknowledged?: boolean;
  message: string;
  /** The device vendor owns the measurement; we own only the trend. */
  claim_notice: string;
}

// --- ASHA ------------------------------------------------------------------
export interface AshaHousehold {
  patient_id: string;
  name: string;
  age: number | null;
  village?: string | null;
  deployment_tier: string;
  last_session: string | null;
  last_visit: string | null;
  due_modules: string[];
  /** Which TASKS within each module — a worker must not repeat what the family did. */
  due_tasks: Record<string, string[]>;
}

export interface AshaSessionResult {
  visit_id: string;
  patient_id: string;
  session_id: string | null;
  modules_stored: string[];
  modules_rejected: string[];
  created: boolean;
  detail: string;
}

/** `GET /report/{id}` — drives both the on-screen clinician view and the printed export. */
export interface ExamReport {
  patient: {
    id: string;
    name: string;
    age: number | null;
    sex: string | null;
    stroke_side: string;
    stroke_date: string | null;
    enrolment_date: string;
    baseline_state: string;
  };
  baselines: {
    module_code: string;
    locked: boolean;
    n_sessions: number;
    /** Captures thrown out for quality. A baseline of 12 with 20 rejections is not the
     *  same object as one with none, so the report shows it. */
    n_rejected: number;
    n_discarded: number;
    window_start: string | null;
    window_end: string | null;
  }[];
  sessions: {
    date: string;
    band: string;
    reason: string;
    domain_deviations: Record<string, number> | null;
    /** All three gates. An ALERT needs every one of them, laterality included. */
    gate1: boolean;
    gate2: boolean;
    gate3: boolean;
    lateralised: boolean;
    lateralised_domains: string[];
    confidence: number;
    confounders: string[];
    clinician_note: string;
  }[];
  method_note: string;
  fast: unknown;
}


// ------------------------------------------------------------------ Awaaz
/**
 * Which impairment dominates — the gate INV-9 turns on. Mirrors `SpeechProfile` in
 * `backend/app/awaaz/safety.py`; the server is the authority and rejects anything else.
 * `unassessed` is not offered as a choice, only reported: it is the state of not having
 * decided, and choosing it deliberately is not a thing a clinician does.
 */
export const AWAAZ_SPEECH_PROFILES = [
  "dysarthria_dominant",
  "aphasia_dominant",
  "mixed",
] as const;

export type AwaazSpeechProfile = (typeof AWAAZ_SPEECH_PROFILES)[number] | "unassessed";

export interface AwaazProfileUpdate {
  speech_profile?: AwaazSpeechProfile;
  auto_speak_enabled?: boolean;
  /** Clamped server-side to >= 0.70. Nobody may buy fewer taps below that. */
  auto_speak_threshold?: number;
  endpoint_silence_seconds?: number;
}

export interface AwaazProfile {
  patient_id: string;
  /** dysarthria_dominant may auto-speak; everything else confirms first (INV-9). */
  speech_profile: string;
  auto_speak_enabled: boolean;
  auto_speak_threshold: number;
  voice_status: string;
  endpoint_silence_seconds: number;
}

export interface AwaazCard {
  id: string;
  text: string;
  lang: string;
  icon: string | null;
  category: string;
  slot: number;
  use_count: number;
  is_emergency: boolean;
}

export interface AwaazCardCreatePayload {
  text: string;
  lang: Lang;
  category: "personal";
}

export interface AwaazBoard {
  patient_id: string;
  profile: AwaazProfile;
  cards: AwaazCard[];
}

export interface AwaazSpeakPayload {
  card_id?: string;
  text?: string;
  candidates?: string[];
  lang?: string;
  confidence?: number;
  /** Set only after the person taps a candidate that was offered for confirmation. */
  confirmed_candidate?: boolean;
  /** UUID of a WAV kept in this browser's IndexedDB vault; the WAV never enters the API. */
  audio_capture_id?: string;
  audio_duration_seconds?: number;
  audio_sha256?: string;
  audio_size_bytes?: number;
  audio_capture_consent?: boolean;
}

export interface AwaazSpeakResult {
  patient_id: string;
  text: string | null;
  lang: string;
  mode: string;
  speak_now: boolean;
  candidates: string[];
  reason: string;
  requires_confirmation: boolean;
  utterance_id: string | null;
  /** A local audio receipt was registered; this does not mean media was uploaded. */
  audio_pair_registered: boolean;
}

// --- candidate-ranking policy events (AWA-FR-014). Opaque ids and scores only: both
// request models are `extra="forbid"` server-side precisely so no transcript, phrase text
// or patient identifier can be smuggled onto this table. See `lib/awaazPolicyLog.ts`.
export interface AwaazPolicyCandidatePayload {
  candidate_id: string;
  score: number;
}

export interface AwaazPolicyDecisionPayload {
  /** Minted by the client when the slate was rendered; the server's idempotency key. */
  event_id: string;
  candidates: AwaazPolicyCandidatePayload[];
  /** Only ever true. The server refuses to randomise anything off the confirmation path. */
  requires_confirmation: true;
  policy_logging_consent: true;
}

export interface AwaazPolicyDecision {
  event_id: string;
  behavior_policy_id: string;
  /** Display order. Index 0 is the logged action. The client must not reorder this. */
  offered_candidate_ids: string[];
  logged_action_id: string;
  logged_action_probability: number;
  top_ranked_action_id: string;
  randomised: boolean;
  exploration_epsilon: number;
  near_tie_margin: number;
}

export type AwaazPolicyOutcome =
  | "selected"
  | "rejected"
  | "corrected"
  | "phrase_board_fallback"
  | "no_explicit_signal";

export interface AwaazPolicyOutcomePayload {
  event_id: string;
  outcome: AwaazPolicyOutcome;
  selected_action_id: string | null;
  rejected_action_ids: string[];
  confirmation_observed: boolean;
  output_spoken: boolean;
}

export interface AwaazReviewLabelPayload {
  corrected_text: string;
  /** UUID of a caregiver-reviewed patient repeat held only in local IndexedDB. */
  audio_capture_id?: string;
  audio_duration_seconds?: number;
  audio_sha256?: string;
  audio_size_bytes?: number;
  audio_capture_consent?: boolean;
}

export interface AwaazEmergencyResult {
  patient_id: string;
  spoken_text: string;
  lang: string;
  location: { lat: number; lon: number } | null;
  caregiver_notified: boolean;
  works_offline: boolean;
  used_speech_recognition: boolean;
  message: string;
}

export interface AwaazEmergencyPayload {
  /** Client-generated correlation id for this deliberate activation. */
  event_id: string;
  /** True only after a patient-specific WAV stored on this device started playing. */
  offline_audio_played: boolean;
  /** Coordinates are present only after the person explicitly enables location sharing. */
  location_consent: boolean;
  lat?: number;
  lon?: number;
  location_accuracy_m?: number;
}
