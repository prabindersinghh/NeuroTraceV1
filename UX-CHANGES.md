# UX-CHANGES — `ux/system-upgrade`

```
 frontend/src/components/AppShell.tsx        |  14 +-
 frontend/src/components/CcgTrace.tsx        |  26 +++-
 frontend/src/components/TaskShell.tsx       |  34 +++-
 frontend/src/components/WearableLanes.tsx   |  26 ++--
 frontend/src/components/ui/SyncStatus.tsx   | 100 ++++++++++++
 frontend/src/components/ui/card.tsx         |  16 +-
 frontend/src/components/ui/field.tsx        |   4 +-
 frontend/src/lib/i18n.tsx                   |  14 +-
 frontend/src/lib/taskFlow.test.ts           | 231 ++++++++++++++++++++++++++++
 frontend/src/lib/taskFlow.ts                | 126 +++++++++++++++
 frontend/src/routes/AshaHome.tsx            |  11 +-
 frontend/src/routes/Diagnostics.tsx         |  19 ++-
 frontend/src/routes/exam/ProtocolRunner.tsx |  47 ++++--
 frontend/src/routes/exam/StepBalance.tsx    |   2 +-
 14 files changed, 625 insertions(+), 45 deletions(-)
```

---

## 1. Summary

This pass deliberately did **not** restyle the app. Reading the surfaces showed the visual
language was largely fine and the real problems were elsewhere: rules the product promises
but no longer enforced, a second colour vocabulary competing with the locked one, and a
feature that existed in `lib/` but was wired to nothing.

So the work went three ways. First, the patient session's behavioural rules — two retries,
a neutral confirm, an always-visible pause — were extracted into `lib/taskFlow.ts` and
pinned by tests; writing those tests found **two live bugs where the retry rule had
silently stopped working**, plus a third caught by the linter. Second, the raw-Tailwind
status colours running alongside `--watch`/`--alert`/`--stable` were mapped onto the tokens,
which also removed the two greens sitting on clinical surfaces in a product whose design
system forbids green as a status. Third, the shell gained the offline/queued-sync strip the
brief asks for — `pendingCount` and `syncPending` were already written, exported, and called
from nowhere, so offline sessions were being saved and then silently never sent.

Restraint was the operating rule: where a change would have been a large restyle with no UX
gain (the 78 non-token border radii), it is written down as a deferred decision rather than
swept.

---

## 2. Per-surface changes

### Shared shell and `ui/` primitives

- **`ui/SyncStatus.tsx` (new)** — a connectivity + queued-session strip in `AppShell`.
  *Why:* `lib/offline.ts` exports `pendingCount` and `syncPending`; both were called from
  nowhere, and the `pendingSync` string existed in all three languages and was referenced
  nowhere. A session captured offline was written to IndexedDB and then became invisible —
  the patient saw one chip on the finish screen, tapped Finish, and the record was never
  sent or mentioned again, while the caregiver in another city watched a dashboard simply
  stop updating. It renders **nothing** when online with an empty queue.
  *Files:* `components/ui/SyncStatus.tsx`, `components/AppShell.tsx`, `lib/i18n.tsx`.

- **`AppShell` sign-out had no accessible name on phones** — the label was
  `hidden sm:inline` next to an `aria-hidden` icon, so below the `sm` breakpoint (i.e. on
  every phone this product targets) the shell's only destructive control announced as
  "button". Now `sr-only sm:not-sr-only`: identical rendering at every width, correct
  accessibility tree. *File:* `components/AppShell.tsx`.

- **Shadows removed from `Card` and `field`** — `index.css` states the system plainly
  ("8px radius, 1px borders. No shadows, no gradients, no glassmorphism") and `Card` is
  composed by nearly every surface, so one shadow there put one everywhere.
  **`StepOcular`'s shadow is deliberately kept**: it is a functional glow that makes the
  moving gaze target visible, not decoration. *Files:* `ui/card.tsx`, `ui/field.tsx`.

### Patient session flow

- **Behavioural rules extracted and pinned** — `lib/taskFlow.ts` now holds the retry rule
  and the confirm-neutrality lexicon as pure functions, with `lib/taskFlow.test.ts` pinning
  them. `MAX_RETRIES` had been declared twice, independently, in `TaskShell` and
  `ProtocolRunner`; it is now single-source.

- **Two retry bugs, both live, both found by writing the tests:**
  - **M10 (`StepAttention`)** had no `key={...attempt}`, so a retry never remounted it. The
    runner displayed "let's try again" above a component still sitting in its finished
    state, with **no retry control on screen at all**.
  - **M7 (`StepTapping`)** had no key *and* received a fresh `done("M7")` closure on every
    render, so its finish effect re-fired on its own identity change and **consumed both
    retries in a few synchronous passes**. The patient saw the banner flash and the session
    advance, never actually offered the retry they had just been promised.

  `done` is now memoised and both steps are keyed, so all eight quality-gated steps behave
  identically. *File:* `routes/exam/ProtocolRunner.tsx`.

- **A stale closure caught by the linter, not by any test** — `submit` read `sessionType`
  without listing it as a dependency, so it captured the `"COMPREHENSIVE"` `useState`
  default rather than what the scheduler returned. Every Daily Pulse session would have
  been posted mislabelled as Comprehensive. Introduced in the Part 2 work on `main`; fixed
  here. *File:* `routes/exam/ProtocolRunner.tsx`.

- **`TaskShell` — honesty, not behaviour.** Left unrendered and undeleted per instruction.
  Its header claimed "the universal task pattern — every task, no exceptions", which every
  subsequent reader took as a statement of fact about the running app. It is not: nothing
  renders this component. The header now says so. A comment asserting a safety property the
  code does not enforce is worse than no comment.

- **The "green outline" copy was wrong in all three languages.** `COPY.position` said the
  outline "turns green" (`हरी हो जाए` / `ਹਰੀ ਹੋ ਜਾਵੇ`) while the component renders
  `border-accent` — **blue** — and green is forbidden as a status colour. Reworded to
  describe the outline lighting up, which is true, survives re-theming, and works for a
  patient who cannot distinguish the two hues.
  **`StepBalance` was a comment-only fix**: its comment said "flips the framing light
  green" but its user-visible strings (`balanceReady`/`balanceFraming`) never mention a
  colour, so the copy was already correct and was left alone.
  *Files:* `components/TaskShell.tsx`, `routes/exam/StepBalance.tsx`.

### Caregiver / clinician / ASHA surfaces

- **Status colours moved onto the token palette.** A second, raw-Tailwind palette
  (amber/rose/emerald/sky) ran alongside `--watch`/`--alert`/`--stable`. The palette is a
  teaching device — a caregiver learns "amber means worth watching" from the band card and
  should read every amber thing the same way — and raw `amber-50` is a visibly different
  hue from `watch-soft`, so the lesson did not transfer.
  - **`WearableLanes` fall banner** was the worst instance: a fall bypasses the engine
    entirely (INV-3), making it the most urgent thing a caregiver ever sees, and it was
    painted in a red matching nothing else in the product.
  - **`CcgTrace`** start/end dots were emerald and rose. In a *clinical* trace that reads as
    a verdict ("began well, ended badly") when it only marks where a stepping path started
    and finished — now accent and ink.
  - **`AshaHome`** "Online" pill was emerald. Connectivity is not a clinical status and must
    not borrow the band palette; online is now quiet (it is the normal case and needs no
    colour) and offline uses `watch`, because offline is the state a worker needs to notice.
  - **`Diagnostics`** used `red-600`/`amber-600`/`green-700` for its FPS verdict.
  *Files:* `components/WearableLanes.tsx`, `components/CcgTrace.tsx`, `routes/AshaHome.tsx`,
  `routes/Diagnostics.tsx`.

- **Colour was the sole carrier of meaning on `CcgTrace`** — the caption named neither dot.
  Added `<title>` elements and a start/end legend.

- **Dead `dark:` variants dropped** where encountered. `darkMode: ["class"]` is configured
  but no `.dark` palette exists in `index.css` and nothing ever adds the class, so every
  `dark:` variant in the codebase is unreachable.

---

## 3. New / updated shared primitives

**`components/ui/SyncStatus.tsx`** (new)

```tsx
<SyncStatus />   // no props
```
Self-contained. Reads `isOnline()`, `onConnectivityChange()`, `pendingCount()` from
`lib/offline`, and drains via `syncPending(api)` on an explicit tap. Renders `null` when
online with an empty queue. `role="status"` + `aria-live="polite"` — never `assertive`,
because it must not interrupt a patient mid-task.

**`lib/taskFlow.ts`** (new)

```ts
MAX_RETRIES: number                                            // = 2, single source
assessCapture(quality, retriesUsed, max?): QualityOutcome       // accept | retry | accept_low_quality
retriesRemaining(retriesUsed, max?): number
violatesConfirmNeutrality(text): string[]                       // [] when clean
FORBIDDEN_AT_CONFIRM: { praise, criticism, score }
```

**`lib/i18n.tsx`** — `STRINGS` is now exported (added export only; no rename, no call-site
change) so tests can assert against the copy the app actually renders rather than a
duplicate of it. Added `sendNow` and `sending` in EN/HI/PA.

---

## 4. Before/after — the five highest-impact changes

1. **A patient asked to retry M7 now actually gets to.** Before, the retry banner appeared
   and the session moved on in the same breath; both attempts were consumed before a hand
   reached the screen. Being told "try once more" and then not being allowed to is the
   single most demoralising thing this flow could do.
2. **A patient asked to retry M10 now has a control to press.** Before, the prompt appeared
   above a dead, disabled component and the only escape was a 14px underlined skip link.
3. **Offline sessions are now visible and sendable.** Before, they were saved and silently
   never sent — the app's "works offline" promise held for the capture and quietly failed at
   the delivery.
4. **The fall banner now looks as serious as it is.** It is the one thing that bypasses the
   engine entirely, and it no longer renders in a red that appears nowhere else.
5. **The shell's sign-out button has a name on a phone.** Before, a screen-reader user on the
   product's target device chose between two unlabelled buttons for a destructive action.

---

## 5. Deferred

### Deferred — needs its own PLAN

- **Unify the task pattern: route `ProtocolRunner` through `TaskShell`, or retire
  `TaskShell`.** `TaskShell` is never rendered — `ProtocolRunner` imports the eleven `Step*`
  components directly and wraps them in its own frame — so the
  `DEMO → INSTRUCT → POSITION → COUNTDOWN → PERFORM → QUALITY → CONFIRM` machine does not
  exist in the shipped app. No task has a countdown phase or a confirm phase; each `Step*`
  is its own small state machine, so a patient re-learns where the start control is on every
  step. This is an architectural fork about the most safety-critical flow in the product and
  should not be resolved inside a whole-system UX diff. **Owner decision: do it on its own
  branch, ideally after physical-phone validation.** In the meantime the live rules are
  enforced in `ProtocolRunner` and pinned by `lib/taskFlow.test.ts`, and `TaskShell`'s header
  no longer claims to be live.

- **Automatic drain of the offline queue on reconnect.** `SyncStatus` sends on an explicit
  tap only. Replaying captured clinical sessions unattended is a data-path behaviour change,
  not UX polish: `syncPending` replays in strict capture order *because the alert gate is a
  function of consecutive sessions*, so an unattended retry loop needs its own thinking about
  concurrency, partial failure and duplicate submission.

- **Doc-vs-practice drift on border radius.** `index.css` states "8px radius" and
  `tailwind.config.js` maps only `lg`/`md`/`sm` to `--radius`. But 47 sites use `rounded-xl`
  and 31 use `rounded-2xl`, which bypass the token and resolve to Tailwind's defaults (12px
  and 16px) — against 50 sites on `rounded-lg`. So roughly half the app has opted out of the
  documented radius, led by `Card`, the primitive every surface composes. **This is a
  decision, not a bug**: either the doc is stale and the practiced 12/16px language is the
  real one, or the app should be swept back to 8px. Rewriting 78 sites inside a UX pass would
  be a restyle with no UX gain and would fight the language the app actually practices, so it
  is recorded here for a later call.

### Deferred — needs backend

Nothing in this pass required a backend change, so this section is empty. The one item that
came close — the offline queue never draining — turned out to be entirely frontend
(`syncPending` already takes the API client).

### Deferred — testing infrastructure

- **A render-level test harness.** `vitest` runs `environment: "node"` and includes only
  `.test.ts`, with no `jsdom`/`happy-dom` and no `@testing-library/react`. So the behavioural
  tests here combine pure-function assertions with source scanning — which is already this
  codebase's idiom for this class of guard (`test_privacy.py`, `test_invariants.py`,
  `test_regulatory_claims.py` all work this way) — rather than adding dependencies inside a
  UX branch. The scans are written to fail on the specific regressions that actually
  occurred, not merely on a keyword. A DOM harness would let the M7 retry loop be asserted
  by driving the component rather than by checking that its handler is memoised, and is the
  right follow-up.

### Not done, deliberately

- **No new npm dependencies were added.** The one place it was tempting (a DOM test harness)
  is deferred above. `lib/taskFlow.test.ts` reads `ProtocolRunner.tsx` through Vite's
  built-in `?raw` import rather than `node:fs`, because the app's tsconfig `types` is
  `["vite/client"]` with no node types — this needed no dependency and no config change.
- **Pitch and landing-page copy untouched.** `routes/Landing.tsx` keeps all eleven of its
  "ninety seconds" references; the public-facing duration figure is being handled separately
  by the owner.

---

## 6. Verification

All four commands run from `frontend/`.

```
$ npm run typecheck        # tsc -b
   exit 0

$ npm run lint             # oxlint
   exit 0   (warnings only — see note)

$ npm run test             # vitest
   Test Files  5 passed (5)
        Tests  62 passed (62)
   exit 0

$ npm run build            # incl. the mediapipe prebuild step
   exit 0
```

**Lint note.** `oxlint` exits 0 with pre-existing warnings that were present before this
branch: `react(only-export-components)` fast-refresh warnings in `button.tsx`, `i18n.tsx`
and `auth.tsx`, and two `exhaustive-deps` ref-cleanup warnings in `StepPpg.tsx`. None were
introduced here and none were "fixed" by weakening anything. The one warning this branch
*did* own — `exhaustive-deps` on `ProtocolRunner`'s `submit` — was a genuine bug and is
fixed, not silenced.

**No test was deleted or weakened.** The suite went from 37 to 62 tests; the 25 added are
all new. One existing file changed for a non-test reason (`i18n.tsx` gained an `export`).

**Manual reasoning against the brief's three questions:**

- *Does the patient session still run end-to-end in airplane mode?* Yes, and it is better
  than before. Nothing added here performs a network call on render: `SyncStatus` reads
  `navigator.onLine` and an IndexedDB count, and only calls the API when tapped. The
  session itself is unchanged; the previously-stranded offline queue is now at least
  visible and drainable.
- *Does every band still pair colour with a word?* Yes — and one place where it did **not**
  was fixed: `CcgTrace`'s start/end dots were distinguished by colour alone and now carry
  `<title>` elements and a text legend.
- *Is the FAST/emergency path still one tap from everywhere it was before?* Yes. No routing,
  gating or emergency affordance was touched. `SyncStatus` renders above `<main>` and, when
  visible at all, adds a single 44px-min row without displacing or covering any control.
