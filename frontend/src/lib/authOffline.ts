import { ApiError } from "./api";

/**
 * Should a failed session check leave the last authenticated identity in place?
 *
 * Yes for everything except a definitive rejection. A missing network is the obvious case
 * — that is the airplane-mode demo, and it is what keeps local-only safety surfaces
 * reachable, the Awaaz emergency phrase above all.
 *
 * But a 500, a timeout or an unrecognised throw are not evidence about the session either,
 * and signing someone out because the server is broken also means they cannot sign back in
 * until it is fixed. So only a 401 — the server actually saying the session is invalid —
 * clears it. Widened from "status === 0" when the two branches that each solved this met:
 * `auth.tsx`'s own rule was already the broader one and it is the safer default.
 */
export function shouldKeepStoredIdentity(error: unknown): boolean {
  return !(error instanceof ApiError && error.status === 401);
}
