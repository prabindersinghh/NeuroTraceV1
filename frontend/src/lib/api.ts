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
  CaretakerLink,
  CaretakerRelationship,
  NotificationChannel,
  AcuteResponse,
  AcuteSymptom,
  AshaHousehold,
  AshaSessionResult,
  AuthResponse,
  AwaazCard,
  AwaazCardCreatePayload,
  AwaazEmergencyResult,
  AwaazEmergencyPayload,
  AwaazPolicyDecision,
  AwaazPolicyDecisionPayload,
  AwaazPolicyOutcomePayload,
  AwaazReviewLabelPayload,
  AwaazSpeakPayload,
  BaselineReviewAction,
  BaselineReviewView,
  BaselineState,
  Battery,
  ClinicPatientRow,
  ConsentStatus,
  ConsentType,
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
  /** Set only when `status` is 0: WHY the request never got an answer. */
  kind?: "network" | "timeout";

  constructor(status: number, message: string, kind?: "network" | "timeout") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
}

/**
 * How the session's end reaches the rest of the app.
 *
 * `request()` learns that a session is over — a refresh token the server rejected —
 * deep inside a call that some dashboard made. It used to clear storage and return, so
 * `AuthProvider` still held a user, the shell still showed "Sign out", and every screen
 * failed in its own way with "could not validate credentials" until the next reload.
 * Now it also says so, once, and the provider listens. A DOM event target rather than a
 * React context because this file has no React in it and must stay that way.
 */
export const AUTH_EVENTS = new EventTarget();
export const SESSION_EXPIRED = "session-expired";

/**
 * How long a request may take before it is reported as such. Long enough for a cold
 * Railway container to wake and for a 2G tower to answer; short enough that a sign-in
 * button does not spin forever on a connection that has silently died.
 */
const REQUEST_TIMEOUT_MS = 20_000;

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
      let res: Response;
      try {
        res = await fetchWithTimeout(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: current.refresh_token }),
        });
      } catch (err) {
        // The network failed, not the session. A patient reloading the app in airplane
        // mode must stay signed in; the caller sees an offline error instead.
        throw err instanceof ApiError ? err : new ApiError(0, "Cannot reach the NeuroTrace server. Check your connection.", "network");
      }
      if (!res.ok) {
        // The server refused the refresh token: expired, revoked, or rotated away by
        // another device. The session is over, and everyone needs to know.
        clearSession();
        AUTH_EVENTS.dispatchEvent(new Event(SESSION_EXPIRED));
        return null;
      }
      const next = (await res.json()) as TokenPair;
      setTokens(next);
      return next;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      0,
      timedOut
        ? "The NeuroTrace server is taking too long to answer."
        : "Cannot reach the NeuroTrace server. Check your connection.",
      timedOut ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }
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

  const res = await fetchWithTimeout(`${BASE}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    // A refresh that cannot reach the server throws an offline error from here, which is
    // the right answer: the caller was not signed out, it was disconnected. A refresh the
    // server REJECTS returns null, having already cleared the session and announced it.
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
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

  // --- caretakers: family access, owning-caregiver only (D-054) ---------------------
  //
  // Every one of these 403s for anyone but the owning caregiver, enforced server-side. The
  // UI hides them from other roles for clarity, never as the boundary — that is INV-6.
  listCaretakers: (patientId: string) =>
    request<{ patient_id: string; caretakers: CaretakerLink[] }>(
      `/caretakers/links/${patientId}`),

  addCaretaker: (payload: {
    patient_id: string;
    email: string;
    full_name: string;
    relationship: CaretakerRelationship;
  }) =>
    request<{
      id: string;
      caretaker_id: string;
      consent_ref: string | null;
      /** Always false for now: accounts are created disabled until the auth pass adds an
       *  invite flow. The UI says so rather than implying the person can sign in. */
      login_enabled: boolean;
      detail: string;
    }>("/caretakers/links", { method: "POST", json: payload }),

  revokeCaretaker: (linkId: string, reason: string) =>
    request<{ detail: string }>(
      `/caretakers/links/${linkId}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }),

  addCaretakerChannel: (payload: {
    patient_id: string;
    caretaker_id: string;
    channel: NotificationChannel;
    destination: string;
  }) =>
    request<{ id: string; channel: string; verified: boolean }>(
      "/caretakers/channels", { method: "POST", json: payload }),

  revokeCaretakerChannel: (channelId: string) =>
    request<{ detail: string }>(`/caretakers/channels/${channelId}`, { method: "DELETE" }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", json: payload, auth: false }),

  me: () => request<AuthResponse["user"]>("/auth/me"),

  /** Revokes the refresh token server-side. The token is the credential, so no bearer. */
  logout: (refreshToken: string) =>
    request<void>("/auth/logout", { method: "POST", json: { refresh_token: refreshToken }, auth: false }),

  /** Re-issues a session; every OTHER refresh token of the account is revoked by the server. */
  changePassword: (payload: { current_password: string; new_password: string }) =>
    request<AuthResponse>("/auth/password", { method: "POST", json: payload }),

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


  // --- consent and erasure (Part 4, Part 5.4) ---
  // Both are owning-caregiver-only server-side. Until these existed, the seven consents
  // could be granted (the enrolment flow and `POST /clinician/links` write them) but never
  // READ BACK OR WITHDRAWN by anyone, and erasure had no caller at all — a right that
  // cannot be exercised is not a right.
  consents: (patientId: string) => request<ConsentStatus>(`/consents/${patientId}`),

  // Returns the FULL status, not just the one that changed, so a settings screen re-renders
  // from the server's answer rather than from what it hoped happened. Withdrawing C3 or C7
  // takes effect immediately and server-side (`consent_currently_granted`), independently of
  // whether the link row is still active.
  setConsent: (
    patientId: string,
    consentType: ConsentType,
    payload: { granted: boolean; version?: string | null; device_context?: string | null },
  ) =>
    request<ConsentStatus>(`/consents/${patientId}/${consentType}`, {
      method: "PUT", json: payload,
    }),

  // `reason` is a QUERY parameter here, exactly as on `invalidateBaseline` — see
  // `routers/patients.py:delete_patient`, where it is a bare `str | None` default arg.
  // 409 if already erased; the response `detail` carries the per-table removal counts.
  erasePatient: (patientId: string, reason: string) =>
    request<{ detail: string }>(
      `/patients/${patientId}?reason=${encodeURIComponent(reason)}`,
      { method: "DELETE" }),

  // --- the doctor-in-the-loop baseline gate (Part 3.3/3.4) ---
  // Until these existed, `DOCTOR_REVIEW_PENDING` was a terminal state in practice: the
  // engine puts a patient there once every module locks, `record_review` is the only way
  // out, and nothing on this side could call it. A real patient completed their baseline
  // and was then never monitored, with no screen able to say so. The demo only worked
  // because `services/seed.py` calls `record_review` in Python, bypassing HTTP entirely.
  baselineReview: (patientId: string) =>
    request<BaselineReviewView>(`/clinician/baseline-review/${patientId}`),

  submitBaselineReview: (
    patientId: string, payload: { action: BaselineReviewAction; note?: string | null },
  ) =>
    request<{
      id: string;
      action: BaselineReviewAction;
      baseline_state: BaselineState;
      reviewed_at: string;
    }>(`/clinician/baseline/${patientId}/review`, { method: "POST", json: payload }),

  // `reason` is a QUERY parameter on this route, not a body field - see
  // `routers/clinician.py:invalidate`. Sending it as JSON silently 422s.
  invalidateBaseline: (patientId: string, reason: string) =>
    request<{ detail: string }>(
      `/clinician/baseline/${patientId}/invalidate?reason=${encodeURIComponent(reason)}`,
      { method: "POST" }),

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

  /** `lang` drives the method note and the FAST card in the report body. */
  examReport: (patientId: string, lang: Lang = "en") =>
    request<ExamReport>(`/report/${patientId}?lang=${lang}`),

  // --- Awaaz ---
  awaazBoard: (patientId: string) =>
    request<import("./types").AwaazBoard>(`/awaaz/${patientId}/board`),
  awaazAddCard: (patientId: string, payload: AwaazCardCreatePayload) =>
    request<AwaazCard>(`/awaaz/${patientId}/cards`, {
      method: "POST", json: payload,
    }),
  awaazDeleteCard: (cardId: string) =>
    request<{ detail: string }>(`/awaaz/cards/${cardId}`, { method: "DELETE" }),
  awaazSpeak: (patientId: string, payload: AwaazSpeakPayload) =>
    request<import("./types").AwaazSpeakResult>(`/awaaz/${patientId}/speak`, {
      method: "POST", json: payload,
    }),
  /**
   * Candidate-ranking policy logging (AWA-FR-014). Opaque ids and scores only — never
   * text. The decision endpoint answers 409 when `policy_logging_consent` is absent, which
   * is an expected state and not an error the patient may ever be shown.
   */
  awaazPolicyDecision: (patientId: string, payload: AwaazPolicyDecisionPayload) =>
    request<AwaazPolicyDecision>(`/awaaz/${patientId}/policy/decision`, {
      method: "POST", json: payload,
    }),
  awaazPolicyOutcome: (patientId: string, payload: AwaazPolicyOutcomePayload) =>
    // The response is the stored row; the client has no use for it beyond the ack.
    request<unknown>(`/awaaz/${patientId}/policy/outcome`, {
      method: "POST", json: payload,
    }),
  awaazUpdateProfile: (patientId: string, payload: import("./types").AwaazProfileUpdate) =>
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
  awaazActiveListener: (patientId: string) =>
    request<{
      active: boolean; token?: string; lang?: string; expires_at?: string; path?: string;
    }>(`/awaaz/${patientId}/listener`),
  awaazRevokeListener: (token: string) =>
    request<{ detail: string }>(`/awaaz/listener/${encodeURIComponent(token)}`, {
      method: "DELETE",
    }),
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
  /** Unused today; kept for the module-schedule battery view. `schedule` is registry.py's
   *  own daily|weekly|monthly|any vocabulary (module measurement frequency) — a DIFFERENT
   *  namespace from `SessionType` (D-044), not that enum, despite the old shared naming. */
  battery: (schedule: "daily" | "weekly" | "monthly" | "any") =>
    request<Battery>(`/sessions/battery/${schedule}`),

  startSession: (patientId: string, payload: { type: SessionType; device_info?: unknown; offline_captured?: boolean; is_practice?: boolean; identity_verified?: boolean; identity_score?: number }) =>
    request<ExamSession>(`/sessions/${patientId}/start`, { method: "POST", json: payload }),

  /** DEPRECATED — the pre-Part-2 single-protocol endpoint. Always returns COMPREHENSIVE
   *  at the given intensity now (what the old flat daily session actually ran). */
  sessionPlan: (intensity: string) =>
    request<import("./protocol").SessionPlan>(`/sessions/plan/${intensity}`, { auth: false }),

  /** Part 2: the session-type-aware protocol. Features only, no media, same as above. */
  sessionPlanV2: (sessionType: SessionType, intensity = "FULL", dayIndex = 0) =>
    request<import("./protocol").SessionPlan>(
      `/sessions/plan-v2/${sessionType}?intensity=${intensity}&day_index=${dayIndex}`,
      { auth: false },
    ),

  /** Which session is due today, per the server's cadence schedule (Part 2.3). The server
   *  decides so the caregiver dashboard and the patient app cannot disagree. */
  sessionDue: (patientId: string) =>
    request<{
      session_type: SessionType;
      estimated_seconds: number;
      step_count: number;
      comprehensive_days_per_week: number;
      next_comprehensive_date: string | null;
    }>(`/sessions/${patientId}/due`),

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

  /** `lang` decides the language of the FAST card in the response — the reader's choice,
   *  not the patient record's. Omitting it falls back to the record, server-side. */
  finalizeSession: (sessionId: string, lang: Lang = "en") =>
    request<FinalizeResult>(`/sessions/${sessionId}/finalize?lang=${lang}`, { method: "POST" }),

  /** The patient stopped part-way. Stored, kept, and never scored — see the endpoint. */
  abandonSession: (sessionId: string, steps: { completed: number; total: number }) =>
    request<ExamSession>(`/sessions/${sessionId}/abandon`, {
      method: "POST",
      json: { steps_completed: steps.completed, steps_total: steps.total },
    }),

  /** When, which type, finished or not — and deliberately no verdicts. Feeds the
   *  patient's history list and calendar; bands stay on /dashboard. */
  sessionHistory: (patientId: string, limit = 90) =>
    request<ExamSession[]>(`/sessions/${patientId}/history?limit=${limit}`),

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
  /** `lang` decides the language of the embedded FAST card. Callers refetch when the
   *  language changes, or the emergency card is left in the previous one. */
  dashboard: (patientId: string, days = 30, lang: Lang = "en") =>
    request<Dashboard>(`/dashboard/${patientId}?days=${days}&lang=${lang}`),

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
