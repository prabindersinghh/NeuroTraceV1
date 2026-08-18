/**
 * API client.
 *
 * Holds the token pair in localStorage and transparently retries a 401 once after
 * refreshing. Concurrent 401s share a single in-flight refresh so a page that fires four
 * requests at once does not burn four refresh tokens.
 */
import type {
  AuthResponse,
  CheckinResult,
  DailySample,
  Dashboard,
  FeatureExtractionResult,
  Patient,
  ReactionPayload,
  Role,
  TokenPair,
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
      // /auth/refresh returns a fresh pair; keep the new refresh token too
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
      // FastAPI validation errors
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
  body?: BodyInit;
  auth?: boolean;
  retry?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", json, body, auth = true, retry = true } = opts;
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
      body: json !== undefined ? JSON.stringify(json) : body,
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

  register: (payload: { email: string; password: string; role: Role; full_name?: string }) =>
    request<AuthResponse>("/auth/register", { method: "POST", json: payload, auth: false }),

  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>("/auth/login", { method: "POST", json: payload, auth: false }),

  me: () => request<AuthResponse["user"]>("/auth/me"),

  listPatients: () => request<Patient[]>("/patients"),

  getPatient: (id: string) => request<Patient>(`/patients/${id}`),

  createPatient: (payload: {
    name: string;
    age?: number | null;
    sex?: string | null;
    language?: string;
    user_id?: string | null;
  }) => request<Patient>("/patients", { method: "POST", json: payload }),

  updatePatient: (id: string, payload: Partial<Pick<Patient, "name" | "age" | "sex" | "language">>) =>
    request<Patient>(`/patients/${id}`, { method: "PATCH", json: payload }),

  deletePatient: (id: string) =>
    request<{ detail: string }>(`/patients/${id}`, { method: "DELETE" }),

  currentCheckin: (patientId: string) =>
    request<DailySample | null>(`/checkin/${patientId}/current`),

  uploadAudio: (patientId: string, blob: Blob, filename = "checkin.wav") => {
    const form = new FormData();
    form.append("file", blob, filename);
    return request<FeatureExtractionResult>(`/checkin/${patientId}/audio`, {
      method: "POST",
      body: form,
    });
  },

  uploadVideo: (patientId: string, blob: Blob, filename = "checkin.webm") => {
    const form = new FormData();
    form.append("file", blob, filename);
    return request<FeatureExtractionResult>(`/checkin/${patientId}/video`, {
      method: "POST",
      body: form,
    });
  },

  uploadReaction: (patientId: string, payload: ReactionPayload) =>
    request<FeatureExtractionResult>(`/checkin/${patientId}/reaction`, {
      method: "POST",
      json: payload,
    }),

  finalize: (patientId: string) =>
    request<CheckinResult>(`/checkin/${patientId}/finalize`, { method: "POST" }),

  dashboard: (patientId: string, days = 30) =>
    request<Dashboard>(`/dashboard/${patientId}?days=${days}`),

  seedDemo: () =>
    request<{ email: string; password: string; patient_id: string; detail: string }>("/demo/seed", {
      method: "POST",
      auth: false,
    }),
};

export { BASE as API_BASE };
