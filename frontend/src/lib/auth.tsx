import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  clearSession,
  getStoredUser,
  getTokens,
  setStoredUser,
  setTokens,
} from "./api";
import { shouldKeepStoredIdentity } from "./authOffline";
import type { Role, User } from "./types";

interface AuthValue {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (payload: { email: string; password: string; role: Role; full_name?: string }) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [ready, setReady] = useState(false);

  // Revalidate the stored session on boot — the refresh token may have expired.
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

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setTokens(res.tokens);
    setStoredUser(res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (payload: { email: string; password: string; role: Role; full_name?: string }) => {
      const res = await api.register(payload);
      setTokens(res.tokens);
      setStoredUser(res.user);
      setUser(res.user);
      return res.user;
    },
    [],
  );

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, ready, login, register, logout }),
    [user, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
