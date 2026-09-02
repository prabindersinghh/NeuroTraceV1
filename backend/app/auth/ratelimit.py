"""Sliding-window rate limits for the credential endpoints. Stdlib only.

Why this exists: bcrypt at 12 rounds slows a guess to ~250 ms, which is brute-force
resistance against one thread and nothing against a hundred. `docs/SECURITY.md` listed
"no rate limiting on /auth/login" as a known gap since the first deploy.

ponytail: in-process dicts, which is correct for railway.json's single replica and wrong
the day `numReplicas` goes above 1 — each replica would then allow the full budget. Move
the windows to Redis (same keys, same arithmetic) when that happens.
"""
from __future__ import annotations

import math
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindow:
    """`limit` events per `window` seconds, per key."""

    def __init__(self, limit: int, window: float) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._hits[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if not q:
            self._hits.pop(key, None)
        return q

    def retry_after(self, key: str) -> float | None:
        """Seconds until the window admits `key` again, or None if it is admitted now."""
        now = time.monotonic()
        q = self._prune(key, now)
        if len(q) < self.limit:
            return None
        return q[0] + self.window - now

    def record(self, key: str) -> None:
        self._hits[key].append(time.monotonic())

    def clear(self, key: str) -> None:
        self._hits.pop(key, None)

    def reset(self) -> None:
        self._hits.clear()


_MIN = 60.0
#: Login counts FAILURES only, so a household that shares one connection is never locked
#: out by its own successful sign-ins. Two keys: the (ip, email) pair stops a targeted
#: guess, the bare ip stops a spray across many emails.
LOGIN_PER_ACCOUNT = SlidingWindow(limit=5, window=15 * _MIN)
LOGIN_PER_IP = SlidingWindow(limit=20, window=15 * _MIN)
REGISTER_PER_IP = SlidingWindow(limit=10, window=60 * _MIN)
REFRESH_PER_IP = SlidingWindow(limit=60, window=_MIN)

ALL_WINDOWS = (LOGIN_PER_ACCOUNT, LOGIN_PER_IP, REGISTER_PER_IP, REFRESH_PER_IP)


def reset_all() -> None:
    for w in ALL_WINDOWS:
        w.reset()


def client_ip(request: Request) -> str:
    # Railway terminates TLS and forwards; the first X-Forwarded-For entry is the client.
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def too_many(retry_after: float) -> HTTPException:
    minutes = max(1, math.ceil(retry_after / 60))
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"Too many attempts. Try again in {minutes} minute{'s' if minutes > 1 else ''}.",
        headers={"Retry-After": str(math.ceil(retry_after))},
    )


def enforce(window: SlidingWindow, key: str, *, record: bool = True) -> None:
    """Raise 429 if `key` is over `window`; otherwise (optionally) count this request."""
    wait = window.retry_after(key)
    if wait is not None:
        raise too_many(wait)
    if record:
        window.record(key)
