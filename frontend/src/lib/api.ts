/**
 * API client.
 *
 * Note what is absent: there is no upload method for audio, video or image data. The
 * device extracts features locally and posts numbers. That is not a convention we follow
 * carefully — it is enforced by the server, which has no endpoint that accepts media.
 *
 * Holds the token pair in localStorage and transparently retries a 401 once after
 * refreshing. Concurrent 401s share a single in-flight refresh so a dashboard that fires
 * four requests at once does not burn four refresh tokens.
 */
import type {
  AcuteResponse,
  AcuteSymptom,
  AshaHousehold,
  AshaSessionResult,
  AuthResponse,
  AwaazEmergencyResult,
  AwaazEmergencyPayload,
  AwaazReviewLabelPayload,
  AwaazSpeakPayload,
  Battery,
  ClinicPatientRow,
  Dashboard,
  ExamReport,
  ExamSession,
  FallEvent,
  FastCard,
  FinalizeResult,
  Instrument,
  Lang,
  ModuleFeatures,
  ModuleResult,
  Patient,
  QuestionnaireResult,
  Role,
  SessionType,
  TokenPair,
  WearableReading,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const STORAGE_KEY = "neurotrace.tokens";
const USER_KEY = "neurotrace.user";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// --------------------------------------------------------------------------- token store
export function getTokens(): TokenPair | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

export function setTokens(tokens: TokenPair | null) {
  if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(STORAGE_KEY);
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown | null) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function clearSession() {
  setTokens(null);
  setStoredUser(null);
}

// --------------------------------------------------------------------------- core request
let refreshInFlight: Promise<TokenPair | null> | null = null;

async function refreshTokens(): Promise<TokenPair | null> {
  const current = getTokens();
  if (!current?.refresh_token) return null;

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!res.ok) {
        clearSession();
        return null;
      }
      const next = (await res.json()) as TokenPair;
      setTokens(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d: { msg?: string }) => d.msg ?? "invalid input").join("; ");
    }
  } catch {
    /* fall through */
  }
  return res.statusText || `Request failed (${res.status})`;
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  auth?: boolean;
  retry?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, auth = true, retry = true } = opts;
  const headers: Record<string, string> = {};

  if (json !== undefined) headers["content-type"] = "application/json";
  if (auth) {
    const token = getTokens()?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the NeuroTrace server. Check your connection.");
  }

  if (res.status === 401 && auth && retry) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
    clearSession();
  }

  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// --------------------------------------------------------------------------- endpoints
export const api = {
  health: () => request<{ status: string; database: string }>("/health", { auth: false }),

  // --- auth ---
  register: (payload: {
    email: string;
    password: string;
    role: Role;
    full_name?: string;
    lang?: string;
  }) => request<AuthResponse>("/auth/register", { method: "POST", json: payload, auth: false }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", json: payload, auth: false }),

  me: () => request<AuthResponse["user"]>("/auth/me"),

  // --- patients ---
  listPatients: () => request<Patient[]>("/patients"),
  getPatient: (id: string) => request<Patient>(`/patients/${id}`),
  createPatient: (payload: {
    name: string;
    stroke_date: string;
    age?: number | null;
    sex?: string | null;
    stroke_side?: string;
    languages?: string[];
    preferred_hour?: number | null;
    education_band?: string | null;
    user_id?: string | null;
    // PRD §3 exclusions. Either being true blocks enrolment server-side: a movement
    // disorder changes face, movement and voice together, which is the same combination
    // the alert gate reads as deterioration.
    pd_diagnosis?: boolean;
    other_movement_disorder?: boolean;
  }) => request<Patient>("/patients", { method: "POST", json: payload }),

  updatePatient: (id: string, payload: {
    name?: string;
    intensity?: string;
    aphasia_mode?: boolean;
    consent_version?: string;
    consent_lang?: string;
    calibration_json?: Record<string, unknown>;
    onboarding_complete?: boolean;
  }) => request<Patient>(`/patients/${id}`, { method: "PATCH", json: payload }),


  // --- wearables (TIER_2+) ---
  wearableSeries: (patientId: string, metric?: string, days = 30) =>
    request<WearableReading[]>(
      `/wearable/${patientId}?days=${days}` + (metric ? `&metric=${metric}` : "")),
  falls: (patientId: string, unacknowledgedOnly = false) =>
    request<FallEvent[]>(
      `/wearable/${patientId}/falls?unacknowledged_only=${unacknowledgedOnly}`),
  acknowledgeFall: (fallId: string) =>
    request<{ detail: string }>(`/wearable/fall/${fallId}/acknowledge`, { method: "POST" }),

  // --- ASHA worker ---
  ashaHouseholds: () =>
    request<{ households: AshaHousehold[]; total: number }>("/asha/households"),
  ashaSubmit: (payload: {
    patient_id: string;
    client_visit_id: string;
    ts: string;
    device_id?: string | null;
    notes?: string | null;
    modules: Record<string, Record<string, number>>;
  }) => request<AshaSessionResult>("/asha/session", { method: "POST", json: payload }),

  // --- craniocorpography trace ---
  movementTrace: (patientId: string, opts: { sessionId?: string; reference?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.sessionId) q.set("session_id", opts.sessionId);
    // The reference is the earliest capture INSIDE the locked baseline window, not the
    // earliest ever — see the endpoint. 409 when no baseline is locked, which the caller
    // must show as "not comparable yet" rather than falling back to something else.
    if (opts.reference) q.set("reference", "true");
    const qs = q.toString();
    return request<import("../components/CcgTrace").CcgTraceData>(
      `/trace/${patientId}` + (qs ? `?${qs}` : ""));
  },

  examReport: (patientId: string) =>
    request<ExamReport>(`/report/${patientId}`),

  // --- Awaaz ---
  awaazBoard: (patientId: string) =>
    request<import("./types").AwaazBoard>(`/awaaz/${patientId}/board`),
  awaazSpeak: (patientId: string, payload: AwaazSpeakPayload) =>
    request<import("./types").AwaazSpeakResult>(`/awaaz/${patientId}/speak`, {
      method: "POST", json: payload,
    }),
  awaazUpdateProfile: (patientId: string, payload: { endpoint_silence_seconds?: number }) =>
    request<import("./types").AwaazProfile>(`/awaaz/${patientId}/profile`, {
      method: "PATCH", json: payload,
    }),
  awaazDeleteAudioPair: (captureId: string) =>
    request<{ detail: string }>(`/awaaz/audio-pairs/${captureId}`, { method: "DELETE" }),
  awaazEmergency: (patientId: string, payload: AwaazEmergencyPayload) =>
    request<AwaazEmergencyResult>(`/awaaz/${patientId}/emergency`, {
      method: "POST", json: payload,
    }),

  awaazMintListener: (patientId: string, payload: { display_name: string; lang?: string; ttl_minutes?: number }) =>
    request<{ token: string; display_name: string; expires_at: string; path: string }>(
      `/awaaz/${patientId}/listener`, { method: "POST", json: payload }),
  /** No auth: the unguessable token IS the capability. */
  listenerView: (token: string) =>
    request<{
      display_name: string; lang: string; expires_at: string;
      coaching: { code: string; line: string };
      recent: { text: string; lang: string; ts: string }[];
    }>(`/awaaz/listen/${token}`, { auth: false }),
  awaazReviewQueue: (patientId: string) =>
    request<{ items: unknown[]; total_candidates: number }>(`/awaaz/${patientId}/review`),
  awaazLabel: (utteranceId: string, payload: AwaazReviewLabelPayload) =>
    request<{ detail: string }>(`/awaaz/review/${utteranceId}`, {
      method: "POST", json: payload,
    }),

  saveIdentitySignature: (patientId: string, signature: unknown) =>
    request<{ detail: string }>(`/patients/${patientId}/identity`, {
      method: "POST", json: { signature },
    }),
  getIdentitySignature: (patientId: string) =>
    request<{ signature: unknown | null }>(`/patients/${patientId}/identity`),

  // --- admin (operator surface: counts and audit only, never patient rows) ---
  adminOverview: () => request<unknown>("/admin/overview"),
  adminIdentity: () => request<unknown>("/admin/identity"),
  adminAudit: (limit = 50) => request<unknown>(`/admin/audit?limit=${limit}`),
  adminProvisionUser: (payload: {
    email: string; password: string; role: string; full_name?: string;
  }) => request<{ id: string; email: string; role: string }>("/admin/users", {
    method: "POST", json: payload,
  }),

  // --- sessions ---
  battery: (schedule: SessionType) => request<Battery>(`/sessions/battery/${schedule}`),

  startSession: (patientId: string, payload: { type: SessionType; device_info?: unknown; offline_captured?: boolean; is_practice?: boolean; identity_verified?: boolean; identity_score?: number }) =>
    request<ExamSession>(`/sessions/${patientId}/start`, { method: "POST", json: payload }),

  /** Features only. There is deliberately no media variant of this call. */
  sessionPlan: (intensity: string) =>
    request<import("./protocol").SessionPlan>(`/sessions/plan/${intensity}`, { auth: false }),

  submitModule: (
    sessionId: string,
    code: string,
    features: ModuleFeatures,
    quality: {
      quality_flag?: boolean;
      quality_detail?: unknown;
      /** Landmark-derived POINTS for modules with a server extractor. Numbers, never media. */
      raw?: Record<string, unknown>;
      session_position?: number;
      elapsed_seconds_at_task_start?: number;
      intensity?: string;
      paused_before_task?: boolean;
    } = {},
  ) =>
    request<ModuleResult>(`/sessions/${sessionId}/module/${code}`, {
      method: "POST",
      json: { features, extracted_on_device: true, ...quality },
    }),

  finalizeSession: (sessionId: string) =>
    request<FinalizeResult>(`/sessions/${sessionId}/finalize`, { method: "POST" }),

  currentSession: (patientId: string) =>
    request<ExamSession | null>(`/sessions/${patientId}/current`),

  // --- domain F/G ---
  submitQuestionnaire: (patientId: string, instrument: Instrument, responses: number[] | Record<string, number>, sessionId?: string) =>
    request<QuestionnaireResult>(`/questionnaire/${patientId}`, {
      method: "POST",
      json: { instrument, responses, session_id: sessionId ?? null },
    }),

  submitVitals: (patientId: string, payload: { bp_sys?: number; bp_dia?: number; ppg_features?: unknown }) =>
    request(`/vitals/${patientId}`, { method: "POST", json: payload }),

  submitAdherence: (patientId: string, taken: boolean) =>
    request(`/adherence/${patientId}`, { method: "POST", json: { taken } }),

  // --- safety (unauthenticated where it must be) ---
  fastCard: (lang: Lang = "en") =>
    request<FastCard>(`/safety/fast?lang=${lang}`, { auth: false }),

  acuteSymptoms: (lang: Lang = "en") =>
    request<{ symptoms: AcuteSymptom[] }>(`/safety/symptoms?lang=${lang}`, { auth: false }),

  reportAcute: (patientId: string, symptoms: string[], note: string | undefined, lang: Lang) =>
    request<AcuteResponse>(`/safety/acute/${patientId}`, {
      method: "POST",
      json: { symptoms, note, lang },
    }),

  // --- dashboards ---
  dashboard: (patientId: string, days = 30) =>
    request<Dashboard>(`/dashboard/${patientId}?days=${days}`),

  clinicPatients: () =>
    request<{ patients: ClinicPatientRow[] }>("/clinic/patients"),

  acknowledgeAlert: (alertId: string) =>
    request<{ detail: string }>(`/clinic/alerts/${alertId}/acknowledge`, { method: "POST" }),

  report: (patientId: string) => request<Record<string, unknown>>(`/report/${patientId}`),

  // --- demo ---
  seedDemo: () =>
    request<{
      email: string;
      password: string;
      patient_id: string;
      bands: string[];
      detail: string;
    }>("/demo/seed", { method: "POST", auth: false }),
};

export { BASE as API_BASE };
