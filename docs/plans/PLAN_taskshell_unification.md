# PLAN — TaskShell unify-or-retire (A2, plan-only)

**Status: PLAN ONLY. No refactor performed in this run.** This is the most safety-critical
frontend surface in the product — the fall-risk gate, the aggregated M3/M9 payloads,
pause-invalidation, and the offline queue all live in the code this plan discusses — and the
project rule is that surgery here is its own reviewed change, ideally after physical-phone
validation, never folded into a larger pass. Facts below were gathered by a read-only audit
of both files; nothing was edited to produce this plan.

## The situation, precisely

**TaskShell is confirmed dead code**, and — as of the earlier UX pass — says so in its own
header (`frontend/src/components/TaskShell.tsx:6-11`): *"NOT YET WIRED INTO THE LIVE
PROTOCOL... The header used to say 'every task, no exceptions'... it was not, and a comment
that asserts a safety property the code does not enforce is worse than no comment."* Zero
import sites exist anywhere outside its own file; every exam route (`/exam/:patientId`,
`/exam/:patientId/practice`) renders `ProtocolRunner` instead
(`frontend/src/routes/Exam.tsx`).

`ProtocolRunner` (`frontend/src/routes/exam/ProtocolRunner.tsx`, 560 lines) is the actual
live path. It has no phase-machine abstraction at all — no shared countdown, no shared
per-task confirm screen, no shared framing gate. Each of the eleven `Step*` capture
components is its own small state machine, and the safety rules (two-retry, neutral confirm,
visible non-invalidating pause) are enforced by discipline at each call site — pinned today
by `taskFlow.test.ts`, but as **static source-string/regex scans of the raw file text**, not
rendered/executed component tests (the project has no `jsdom`/React Testing Library
dependency — a separately-tracked gap, `UX-CHANGES.md`).

TaskShell, by contrast, has a real internal phase machine (`demo → instruct → position →
countdown → perform → quality → confirm`) but implements none of the things that make
ProtocolRunner safety-critical: no fall-risk gate, no aggregated M3/M9 accumulator, no
fatigue-field recording, no offline queue, no identity verification, no aphasia-mode
presentation. It is single-task-scoped by design (`TaskShellProps` takes one `module`, one
`position`, one `onFinish`) and has never been extended to know about any of these.

**The concrete risk either option carries:** ProtocolRunner's retry-remount discipline
depends entirely on the parent bumping an `attempt` counter and every gated `Step*` receiving
`key={...attempt}` — an external convention with no compiler enforcement. `taskFlow.ts`'s own
header names two real regressions this already caused (M10/`StepAttention`,
M7/`StepTapping`) before being caught. Any refactor here — either direction — touches the
exact mechanism that already broke twice.

## Option A — route ProtocolRunner's per-step rendering through TaskShell

Make the "every task, no exceptions" guarantee real by having TaskShell own the phase
machine, and ProtocolRunner supply per-task capture logic, the fall-risk gate, the
aggregated-module accumulators, and submission as composition around it.

**What would have to move into TaskShell (or be threaded through it) without loss:**
- The fall-risk gate (`ProtocolRunner.tsx:378-392`) — currently a structural block *before*
  certain steps, not a per-task concern. TaskShell's phase machine has no concept of "skip an
  entire group of upcoming tasks."
- The M3/M9 shared accumulators (`store.current.ocular`, `store.current.balance`) — passed by
  reference across *multiple* TaskShell instances if each task became one TaskShell run, with
  submission happening only on the last task of the group. TaskShell's `onFinish` is
  single-task-scoped and has no notion of "this task's data is not submitted, it's added to a
  buffer another task will submit."
- Fatigue-field recording (`fatigueFields()` — `session_position`, `elapsed_seconds_at_task_
  start`, `paused_before_task`, `intensity`) attached at `record()` per task.
- Pause semantics: TaskShell's `onPause` is a bare callback with no timer state; the actual
  `totalPausedMs`/`pausedBeforeNext` bookkeeping lives entirely in ProtocolRunner today.
- The offline queue and `submit()` pipeline, identity verification threading, aphasia-mode
  text sizing, and session-due/intensity plan loading — none exist in TaskShell.

**Risk.** This is not "move some code" — it is redesigning TaskShell's phase machine to
support cross-task shared state, group-level skip, and a submission model it was never built
for, while proving the fall-risk gate and pause-never-invalidates guarantees survive the
refactor unchanged. Given ProtocolRunner already has a demonstrated history of breaking these
guarantees under smaller changes (the two named regressions), a redesign of this size is the
highest-risk option on this list.

**Benefit.** If done correctly, the phase machine (countdown, confirm screen, framing gate)
becomes genuinely shared and enforced by one component rather than convention repeated eleven
times — closing the actual gap the dead header used to falsely claim was already closed.

## Option B — retire TaskShell, bless ProtocolRunner as the single implementation

Delete (or archive) TaskShell. Pin the three safety rules — two-retry, neutral confirm,
visible non-invalidating pause — against ProtocolRunner with tests, upgrading from the
current static source-scan to something that actually exercises behavior once the project has
a DOM-testing dependency (a separately deferred gap, not this plan's to close).

**What this actually requires, concretely:**
1. Confirm no other in-flight work references TaskShell (the dead-code header, `git log`, and
   this audit already establish zero import sites — a final `grep` immediately before deletion
   is still warranted since this plan and the deletion PR won't be the same commit).
2. Delete `TaskShell.tsx`, or move it to a clearly-marked `_archive/` location if the team
   wants the reference implementation kept for its explicit phase-machine design (countdown,
   confirm) as a future reference — a judgment call for whoever executes this, not decided
   here.
3. Remove the stale prose references to "TaskShell" in `lib/demoClips.ts:13,49` (comments
   only, not imports — but comments describing dead behavior are exactly the kind of drift
   this codebase's own house style calls out).
4. Strengthen `taskFlow.test.ts` from source-scanning to actual behavioral tests **once a DOM
   testing library is added** — until then, keep the current scans; they are real regression
   guards even if indirect, and removing them without a replacement would be a net loss of
   coverage, not a cleanup.
5. No production behavior changes at all under this option — it is a deletion plus doc/test
   cleanup, not a refactor of the live protocol.

**Risk.** Low, and bounded. The only way this goes wrong is deleting something that turns out
to have a non-obvious dependency this audit missed — mitigated by the final `grep` in step 1
and by archiving rather than hard-deleting if there's any doubt.

**Benefit.** Removes a maintenance trap (a "universal pattern" file that lies about its own
status is worse than no file) at minimal risk, and stops future contributors from being misled
into building a twelfth task against the wrong abstraction.

## Recommendation

**Option B.** The dead header's own conclusion — quoted above, written by whoever did the
earlier UX pass — already reasons through this: the false "every task, no exceptions" claim
was worse than having no claim at all, and TaskShell has been unrendered and undeleted "per
instruction" pending exactly this review. Option A's payoff (one enforced phase machine
instead of eleven disciplined call sites) is real, but the redesign surface it requires —
cross-task shared accumulators, group-level fall-risk skip, pause bookkeeping, an offline
queue, identity threading — is close to a full rewrite of ProtocolRunner wearing TaskShell's
name, on the exact code paths this project has already been burned by twice. That is a much
larger, much riskier change than "retire the file that admits it's unused."

If the *actual* felt pain driving this file's existence is "the retry-remount `key={attempt}`
convention is fragile and has broken twice" — that is a narrower, safer problem than a full
phase-machine unification, and worth its own much smaller follow-up: a lint rule or a single
shared `useRetryableCapture` hook that every `Step*` calls, rather than adopting TaskShell's
full state machine. That narrower option was not in the original brief for this plan and is
noted here only because the evidence points at it as the higher-value fix; it is not decided
or built in this run.

## Migration path if Option B is approved

1. Final `grep -r "TaskShell" frontend/src` immediately before the deletion PR, to catch
   anything landed between this plan and its execution.
2. Delete `TaskShell.tsx` (or archive per the team's call).
3. Remove the two stale `demoClips.ts` comment references.
4. No test deletions — `taskFlow.test.ts`'s TaskShell-adjacent assertions are actually
   ProtocolRunner assertions (confirmed above: it scans `ProtocolRunner.tsx`'s raw source, not
   TaskShell's) and are unaffected by TaskShell's removal.
5. Single commit, single PR, physical-phone validation of a full session run before merge —
   not because this change touches runtime behavior (it doesn't, under Option B), but because
   it is the safety-critical surface and the project's own rule is validate-before-touching
   here, not validate-because-of-this-specific-diff.

## Tests that must exist either way

Regardless of which option is chosen: `taskFlow.test.ts`'s five guarantees (two-retry-then-
accept, per-position not pooled retry counters, neutral confirm screen scanned across all
three languages, pause visible and non-invalidating, the five named retry-remount regression
sites) must continue to hold, and must be re-verified to pass unchanged after whichever
change is made — they are the only safety net this flow currently has.
