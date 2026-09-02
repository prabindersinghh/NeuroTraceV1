import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AUTH_EVENTS, SESSION_EXPIRED, api, clearSession, getStoredUser, getTokens,
  setStoredUser, setTokens,
} from "./api";
import { shouldKeepStoredIdentity } from "./authOffline";
import type { Role, User } from "./types";

interface AuthValue {
  user: User | null;
  /** The stored session has been checked against the server (or the server is unreachable). */
  ready: boolean;
  /**
   * The last session ended without the user asking — a refresh the server refused. The
   * sign-in screen reads this once to explain WHY it is being shown, then clears it.
   */
  expired: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: { email: string; password: string; role: Role; full_name?: string }) => Promise<User>;
  /** Seeds the demo, signs in as its caregiver, returns the demo patient's id. */
  loginDemo: () => Promise<string>;
  logout: () => void;
  clearExpired: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

const TOKENS_KEY = "neurotrace.tokens";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  // Revalidate the stored session on boot.
  //
  // ONLY A 401 SIGNS THE USER OUT. The first version cleared the session on ANY failure,
  // which included the network being absent — so a patient who opened the installed app
  // in airplane mode, which is the product's own demo, was signed out at the door and
  // could not sign back in until they found a signal. Offline, a server error or a
  // timeout leave the stored user in place; the next successful request re-checks.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getTokens()) {
        setReady(true);
        return;
      }
      try {
        const fresh = await api.me();
        if (!cancelled) {
          setUser(fresh);
          setStoredUser(fresh);
        }
      } catch (error) {
        // An offline boot is not evidence that the saved session is invalid. Keep the last
        // authenticated identity so local-only safety surfaces (especially the Awaaz
        // emergency phrase) remain reachable. Authenticated API calls still fail closed,
        // and a real 401 clears the session in api.ts.
        if (!cancelled && !shouldKeepStoredIdentity(error)) {
          clearSession();
          setUser(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API layer discovered the session is over (see AUTH_EVENTS in api.ts).
  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setExpired(true);
    };
    AUTH_EVENTS.addEventListener(SESSION_EXPIRED, onExpired);
    return () => AUTH_EVENTS.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  // Other tabs. Signing out in one tab must sign out the rest — a shared laptop in a
  // clinic is the normal case, not the edge case — and signing in should not leave a
  // second tab stuck on the sign-in screen. The `storage` event fires only in OTHER
  // documents, which is exactly the set that needs telling.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOKENS_KEY && event.key !== null) return;
      const stored = getStoredUser();
      setUser(getTokens() ? stored : null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const adopt = useCallback((res: { user: User; tokens: Parameters<typeof setTokens>[0] }) => {
    setTokens(res.tokens);
    setStoredUser(res.user);
    setUser(res.user);
    setExpired(false);
    return res.user;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    return adopt(await api.login({ email: email.trim(), password }));
  }, [adopt]);

  const register = useCallback(
    async (payload: { email: string; password: string; role: Role; full_name?: string }) => {
      return adopt(await api.register({ ...payload, email: payload.email.trim() }));
    },
    [adopt],
  );

  const loginDemo = useCallback(async () => {
    const seeded = await api.seedDemo();
    adopt(await api.login({ email: seeded.email, password: seeded.password }));
    return seeded.patient_id;
  }, [adopt]);

  const logout = useCallback(() => {
    // Revoke server-side, best effort: the local sign-out must not wait on the network,
    // and a token that could not be revoked now expires on its own.
    const refresh = getTokens()?.refresh_token;
    clearSession();
    setUser(null);
    if (refresh) void api.logout(refresh).catch(() => undefined);
  }, []);

  const clearExpired = useCallback(() => setExpired(false), []);

  const value = useMemo<AuthValue>(
    () => ({ user, ready, expired, login, register, loginDemo, logout, clearExpired }),
    [user, ready, expired, login, register, loginDemo, logout, clearExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
