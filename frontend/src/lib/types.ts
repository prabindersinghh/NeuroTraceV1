export type Role = "patient" | "caregiver" | "clinician";
/** PATTERN_ATYPICAL is a real band the engine emits, not a placeholder: persistent,
 *  cross-modal, but SYMMETRIC change. Leaving it out of this union is how the dashboard
 *  came to crash on it — `BAND_STYLE[band]` returned undefined and `style.ring` threw,
 *  for exactly the patient the laterality gate exists to protect. */
export type Band = "STABLE" | "WATCH" | "ALERT" | "PATTERN_ATYPICAL";
export type Lang = "en" | "hi" | "pa";
export type SessionType = "daily" | "weekly" | "monthly";
export type BaselineState = "not_started" | "collecting" | "locked";
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
