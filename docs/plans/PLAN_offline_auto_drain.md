# PLAN — automatic offline drain (A1, plan-only)

**Status: PLAN ONLY. No drain code was written.** This is a 🔴 data-integrity change: it
replays clinical sessions unattended, and the persistence gate depends on
consecutive-session ORDER. A wrong implementation silently corrupts baselines and alert
timing for exactly the rural, intermittently-connected users the product exists for — and
it corrupts them quietly, in a way a green test suite and a working demo would both miss.

## Where things stand today

**The queue works. The drain is manual.** `frontend/src/lib/offline.ts` queues a session to
IndexedDB whenever submission fails or the device is offline (`enqueueSession`), and
`syncPending` already replays in strict capture order and stops at the first failure. But
`syncPending`'s only call site in the entire codebase is a manual "Send now" button in
`components/ui/SyncStatus.tsx`. Nothing calls it automatically — not on reconnect, not on
app load, not on a timer.

Worse for the specific case that matters: `ProtocolRunner` deliberately renders its own
`Frame` rather than `AppShell`, so `SyncStatus` never appears *during a session*. A patient
who completes a session offline sees "saved, will send later" and, unless someone later
opens a caregiver surface and taps the button, later never comes.

**What this run verified rather than assumed** (`backend/tests/test_offline_ordering.py`):
the backend half is already correct. Every history query in `session_pipeline.py` orders on
`ExamSession.ts` — capture time — never on insertion order. A test builds the same clinical
history twice, submitted chronologically and submitted deliberately reversed, and asserts
the two patients end up byte-identical in bands, gates, drift and baseline medians. So the
engine tolerates out-of-order arrival today. **The risk in auto-drain is not the engine; it
is the client-side replay loop.**

---

## What the plan must cover

### 1. Ordered replay, and first-failure behaviour
Sessions drain in capture order (`syncPending` already does this — preserve it). A single
failure **blocks the rest** rather than skipping ahead, so consecutive-session semantics
hold: if day 2 fails and day 3 succeeds, the engine sees day 1 → day 3 as consecutive, and
gate 1's "held across consecutive valid sessions" is now counting a gap it cannot see.
`syncPending` already stops at first failure. The auto-drain wrapper must not "improve" on
this by continuing past failures to maximise throughput.

### 2. Retry and backoff
- Exponential backoff from the first failure, capped (suggest 30s → 5min).
- A hard attempt ceiling per session, after which it stays queued but stops auto-retrying
  and surfaces to the caregiver — `markAttempt` already records attempts, so the counter
  exists.
- Never retry a 4xx. A 400/403 means the payload or the authorisation is wrong; retrying it
  forever is how a queue becomes permanently stuck while looking busy.

### 3. Idempotency / duplicate submission
**This is the gap that most needs closing before auto-drain ships.** Automatic retry
massively raises the chance of the same session being submitted twice (request succeeded,
response lost, retry fires). A session double-counted toward the persistence gate is a
fabricated consecutive session — it would make gate 1 pass a day early.

The plan must specify a client-generated idempotency key (`newLocalId` already exists in
`offline.ts` and is the obvious candidate), carried on `POST /sessions/{patient_id}/start`,
with a server-side uniqueness constraint so a repeat submission returns the existing session
rather than creating a second one. **Verify first whether any such protection exists today**
— the audit for this plan did not confirm one, and if none exists, that is a prerequisite
task, not a detail of the drain.

### 4. Concurrency
Two tabs, or a reload mid-drain, must not race. Options to evaluate: a Web Lock
(`navigator.locks`), a lease record in IndexedDB with a timestamp, or draining only from a
single designated context. Whatever is chosen must handle the tab being killed mid-drain
without leaving a permanent lock.

### 5. Interaction with the Part 3 baseline phase machine
- A drain that completes the baseline moves the patient to `DOCTOR_REVIEW_PENDING`, not
  `LOCKED`. The drain must not surface anything to the caregiver that reads as "your
  baseline is ready" — a clinician still has to confirm.
- **INV-4 interaction, the sharp edge:** the frozen reference is written once, on CONFIRM
  (D-048). If a clinician CONFIRMs while sessions are still queued on a phone, those
  sessions arrive *after* the reference was sealed against a window that did not include
  them. The plan must decide explicitly which of these it wants: (a) accept it — the
  reference reflects what the clinician actually saw, which is arguably correct; (b) warn
  the clinician at the gate that N sessions are still unsynced; (c) block CONFIRM while a
  known queue exists. Recommend (b): it preserves INV-4's "written once" while making the
  omission visible to the person making the decision. This decision is the owner's, not
  the implementer's.
- An `ABANDONED` baseline must not be resurrected by a late drain —
  `_refresh_baseline_state` already returns early for terminal states, so this holds, but
  it needs a test.

### 6. How it supersedes the manual strip
The "Send now" button should remain, not be removed — as a manual override when auto-drain
has backed off, and as the honest surface for "N sessions waiting". The strip's count must
stay accurate during an auto-drain (it currently updates on manual action only). Auto-drain
changes the strip from *the* mechanism to *a* mechanism.

Additionally: the strip must become reachable from the session-completion screen, or
auto-drain must be wired to fire on session completion — otherwise the specific case that
loses data today (session captured offline, app closed, never reopened on a caregiver
surface) is still not covered.

### 7. Tests that would pin it
- Out-of-order arrival (already exists — `test_offline_ordering.py`; extend to drive the
  real drain rather than direct `compute_session` calls).
- Mid-drain crash: kill after session 2 of 5, restart, assert 3–5 send and 1–2 do not
  re-send.
- Duplicate submission: send the same queued session twice, assert one `sessions` row and
  no double-count toward gate 1.
- First-failure blocking: fail session 2, assert 3–5 stay queued.
- Two-tab race: two drains started simultaneously, assert each session submitted once.
- Backoff: assert no tight retry loop against a persistently failing endpoint.
- A drain that completes a baseline lands in `DOCTOR_REVIEW_PENDING`, never `LOCKED`.
- A drain into an `ABANDONED` baseline does not revive it.

---

## Recommended sequencing

1. **Idempotency first, separately.** Establish (or build) duplicate-submission protection
   and land it on its own, with tests, before any auto-drain exists. Auto-drain without it
   is the risky combination.
2. Then the drain itself, behind a flag, with the tests above.
3. Then wire the trigger points (reconnect, app load, session completion).

Do not build these as one change. The first is safe in isolation and makes the second
meaningfully less dangerous; bundled together, a bug in either is attributed to the other.
