/**
 * The session-boundary behaviour of the API client — the part that used to be wrong.
 *
 * Stubs `fetch` and `localStorage` in Node rather than mocking the module, so the code
 * under test is the real request path with its real retry-after-refresh logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError, AUTH_EVENTS, SESSION_EXPIRED, api, getTokens, setStoredUser, setTokens,
} from "./api";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

type Reply = { status: number; body?: unknown } | Error;

function fetchScript(replies: Record<string, Reply[]>) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    calls.push(path);
    const queue = replies[path];
    const reply = queue?.shift();
    if (!reply) throw new Error(`unscripted request to ${path}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
  return { stub, calls };
}

const tokens = { access_token: "a1", refresh_token: "r1", token_type: "bearer", expires_in: 1800 };
const user = { id: "u", email: "x@y.z", role: "caregiver", full_name: null, lang: "en", created_at: "" };

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  setTokens(tokens);
  setStoredUser(user);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refresh the server rejects", () => {
  it("clears the session, announces it once, and the caller gets the original 401", async () => {
    const { stub, calls } = fetchScript({
      "/auth/me": [{ status: 401, body: { detail: "token has expired" } }],
      "/auth/refresh": [{ status: 401, body: { detail: "could not validate credentials" } }],
    });
    vi.stubGlobal("fetch", stub);
    const heard = vi.fn();
    AUTH_EVENTS.addEventListener(SESSION_EXPIRED, heard);

    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(["/auth/me", "/auth/refresh"]);
    expect(getTokens()).toBeNull();
    expect(localStorage.getItem("neurotrace.user")).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    AUTH_EVENTS.removeEventListener(SESSION_EXPIRED, heard);
  });
});

describe("a refresh that cannot reach the server", () => {
  it("keeps the session and reports the network, not the account", async () => {
    const { stub } = fetchScript({
      "/auth/me": [{ status: 401 }],
      "/auth/refresh": [new TypeError("Failed to fetch")],
    });
    vi.stubGlobal("fetch", stub);
    const heard = vi.fn();
    AUTH_EVENTS.addEventListener(SESSION_EXPIRED, heard);

    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).kind).toBe("network");
    expect(getTokens()).toEqual(tokens);          // still signed in
    expect(heard).not.toHaveBeenCalled();
    AUTH_EVENTS.removeEventListener(SESSION_EXPIRED, heard);
  });
});

describe("a refresh that works", () => {
  it("retries the original request once with the new access token", async () => {
    const fresh = { ...tokens, access_token: "a2", refresh_token: "r2" };
    const { stub, calls } = fetchScript({
      "/auth/me": [{ status: 401 }, { status: 200, body: user }],
      "/auth/refresh": [{ status: 200, body: fresh }],
    });
    vi.stubGlobal("fetch", stub);

    await expect(api.me()).resolves.toEqual(user);
    expect(calls).toEqual(["/auth/me", "/auth/refresh", "/auth/me"]);
    expect(getTokens()).toEqual(fresh);
    const lastInit = stub.mock.calls[2][1] as RequestInit;
    expect((lastInit.headers as Record<string, string>).authorization).toBe("Bearer a2");
  });
});

describe("a request that never answers", () => {
  it("is reported as a timeout, distinguishable from being offline", async () => {
    vi.stubGlobal("fetch", vi.fn((_: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    vi.useFakeTimers();
    // The handler is attached BEFORE the clock moves, or the rejection is unhandled for a tick.
    const pending = api.health().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_001);
    const err = await pending;
    vi.useRealTimers();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).kind).toBe("timeout");
  });
});

describe("a 401 on a call made without a session", () => {
  it("does not try to refresh", async () => {
    setTokens(null);
    const { stub, calls } = fetchScript({ "/auth/me": [{ status: 401 }] });
    vi.stubGlobal("fetch", stub);
    await expect(api.me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual(["/auth/me"]);
  });
});
