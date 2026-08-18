export type Role = "patient" | "caregiver" | "clinician";
export type Band = "STABLE" | "WATCH" | "ALERT";
export type Modality = "voice" | "face" | "reaction";

export interface User {
  id: string;
  email: string;
  role: Role;
  full_name: string | null;
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
  user_id: string | null;
  name: string;
  age: number | null;
  sex: string | null;
  language: string;
  baseline_ready: boolean;
  created_at: string;
}

export interface ReactionPayload {
  latencies_ms: number[];
  misses: number;
  false_starts: number;
}

export interface FeatureExtractionResult {
  sample_id: string;
  modality: Modality;
  valid: boolean;
  n_features: number;
  features: Record<string, number>;
}

export interface CheckinResult {
  sample_id: string;
  patient_id: string;
  stability_score: number;
  band: Band;
  reason: string;
  baseline_day: boolean;
  baseline_ready: boolean;
  deviations: Record<Modality, number>;
  modalities_flagged: Modality[];
  valid_modalities: Record<Modality, boolean>;
  top_drivers: [string, number][];
  explanation_en: string;
  explanation_hi: string;
  alert_id: string | null;
}

export interface TrendPoint {
  date: string;
  sample_id: string;
  voice_dev: number;
  face_dev: number;
  reaction_dev: number;
  stability_score: number;
  band: Band;
  baseline_day: boolean;
}

export interface HistoryRow {
  date: string;
  band: Band;
  stability_score: number;
  reason: string | null;
  explanation_en: string | null;
  explanation_hi: string | null;
  baseline_day: boolean;
}

export interface Alert {
  id: string;
  patient_id: string;
  score_id: string;
  band: Band;
  explanation: string;
  explanation_hi: string | null;
  whatsapp_sent: boolean;
  created_at: string;
}

export interface Score {
  id: string;
  patient_id: string;
  sample_id: string;
  voice_dev: number;
  face_dev: number;
  reaction_dev: number;
  stability_score: number;
  band: Band;
  reason: string | null;
  modalities_flagged: string[] | null;
  explanation_en: string | null;
  explanation_hi: string | null;
  baseline_day: boolean;
  created_at: string;
}

export interface Dashboard {
  patient: Patient;
  baseline_ready: boolean;
  baseline_days_recorded: number;
  baseline_days_required: number;
  latest: Score | null;
  latest_explanation_en: string | null;
  latest_explanation_hi: string | null;
  trends: TrendPoint[];
  history: HistoryRow[];
  alerts: Alert[];
  dev_threshold: number;
  band_thresholds: Record<string, number>;
}

export interface DailySample {
  id: string;
  patient_id: string;
  ts: string;
  audio_path: string | null;
  video_path: string | null;
  reaction_json: ReactionPayload | null;
  status: "processing" | "done";
}
