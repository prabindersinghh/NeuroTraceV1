import { ApiError } from "./api";

/** A missing network is not evidence that the last authenticated local identity is invalid. */
export function shouldKeepStoredIdentity(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}
