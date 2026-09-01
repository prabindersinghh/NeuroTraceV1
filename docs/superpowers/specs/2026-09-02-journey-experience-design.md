# The patient journey — design proposal (2026-09-02)

The brief: make the daily check-in feel like **one continuous, calm, guided experience**
while the application collects exactly the same structured longitudinal data it collects
today. The patient thinks "I am moving through something"; the system thinks "I am
recording eighteen protocol positions".

This document is the Phase 30 proposal from the brief: architecture summary, assessment
inventory, problems, concepts, selection, journey map, transformation map, component and
state architecture, accessibility, motion, performance, migration, risks, validation.
It was written after a full read of the exam path, the design system, the tests that pin
patient-facing copy, and the backend session routes. Nothing below changes a stimulus,
timing, randomisation, threshold, scorer or protocol position; the two behavioural
changes it does make are called out as decisions (§Q) so they cannot pass unnoticed.

---

## A. Current architecture, in one screen

- **Frontend** React 18 + Vite 8 + Tailwind 3, no animation library. Tokens in
  `index.css` (blue/white, 8px radius, 1px borders, *no shadows, no gradients*), motion
  vocabulary in `lib/motion.ts` (`DURATION`, `EASE`, `usePrefersReducedMotion`) and CSS
  variables (`--dur-*`, `--ease-*`). Patient surfaces wear `.patient-scale` (20px text
  floor, 64px tap targets).
- **The exam** is one route (`/exam/:patientId`, `/exam/:patientId/practice`) rendering
  `routes/exam/ProtocolRunner.tsx` (741 lines). It loads the patient, asks the server
  which session type is due, loads the plan (server, else the offline mirror in
  `lib/protocol.ts`), filters to `WEB_RUNNABLE` (18 of 21 tasks), and renders one of
  eleven `Step*` components per position. It owns: the fall-risk gate (structural), the
  M3/M9 aggregate buffers, the two-retry quality gate, pause bookkeeping, view-only back
  (D-059), exit-with-abandon, offline queueing, and submission (`startSession` →
  `submitModule`×n → questionnaire → adherence → `finalizeSession`) — **all at the end**.
  No server session exists until the patient finishes or exits.
- **Rules pinned by tests**, which any redesign must keep passing:
  `lib/taskFlow.test.ts` scans the runner's *source* for the finished block, the pause
  control in the header, `pausedBeforeNext = true`, `totalPausedMs`, the elapsed-clock
  expression, `key={…attempt}` on the eight gated steps and a memoised `done`;
  `lib/hardcodedStrings.test.ts` scans `routes/exam/*.tsx` for untranslated copy;
  `lib/typeScale.test.ts` forbids ad-hoc heading sizes; `backend/tests/
  test_regulatory_claims.py` scans user-facing source for overclaims and the stale
  "ninety-second" figure; `test_protocol_runtime.py` pins `PROTOCOL_MIRROR` and
  `WEB_RUNNABLE` to the Python protocol.
- **Onboarding** is the caregiver's (`routes/Onboarding.tsx`: consent, eligibility, the
  scope disclosure that is a safety control, calibration, placement, a practice run, the
  baseline explanation). The patient's own first contact is step 6, the practice run,
  which simply launches the runner.
- **Persistence**: none mid-session. Refresh loses everything; the recall words survive
  in `sessionStorage`; the finished session is queued in IndexedDB when offline.
- **Speech**: every instruction is spoken (`lib/speech-synthesis.ts`); no mute, no
  repeat, and `speak()` cancels whatever is playing.

## B. The eighteen web-runnable assessments

Order is the **Comprehensive** order (Daily Pulse is the first six). `Pos` is the protocol
position that is recorded with the result (D-044): the six Daily Pulse modules sit at
1–6 in both session types, the rest follow renumbered.

| Pos | Module · task | Domain | Current UX | Input | ≈s | Data captured | Scoring | Friction today | Loads (cog/motor/vis) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | M10 `simple_and_choice_rt` | attention / processing speed | "Tap when the circle turns blue", 10 trials, "Tap 3/10" | tap | 60 | latencies, misses, false starts | `extractAttentionSpeed` (rt_cov headline) | "TAP" caps, red "Too soon", raw counter | L/L/M |
| 2 | M4 `sustained_ddk_sentence` | motor speech | mic circle, 3 sub-tasks, big numeral | voice | 40 | PCM → DSP features on device | `extractDysarthria` | numeral countdown, abrupt sub-task swaps | M/L/L |
| 3 | M1 `facial_battery` | cranial nerves (+identity) | camera, 4×4s cues, numbered dots | camera | 40 | landmark frames → features; identity vector | `extractFacialMotor`, `verifyAgainst` | camera opens on Begin; small red-ish chip timer | L/L/M |
| 4 | M7 `finger_tapping` | fine motor (laterality) | one circle, 10s per hand, count + numeral | tap | 25 | tap timestamps L/R | `extractFineMotor` (ratio) | count shown = performance pressure | L/H/M |
| 5 | M13 `phq2` | mood (confounder) | 2 questions, 4 options | tap | 20 | PHQ-2 answers | server `PHQ2` scorer | **submits the whole session** (see §C-1) | M/L/L |
| 6 | M19 `medication_confirm` | adherence | yes / not yet | tap | 10 | boolean | adherence | absorbed into 5 | L/L/L |
| 7 | M11 `word_encoding` | memory (encoding) | 5 words + numeral | none | 30 | words fixed per session | — (pairs with 20) | words not actually spoken (cancelled by label) | M/L/M |
| 8–11 | M3 `horizontal_saccades`, `vertical_saccades`, `smooth_pursuit`, `gaze_holding` | oculomotor / posterior | dark field, white dot, tiny preview, numeral | camera (eyes) | 140 | gaze samples paired with target per frame, fps | server extractor; one payload after 11 | camera opens instantly on mount, four hard cuts | M/L/H |
| 12 | M21 `svv_static_and_dynamic` | graviceptive | line + slider, 18 trials, rotating dots | slider | 60 | per-trial angles, tilt compensation | server extractor | unavoidably long; abort exists | M/M/H |
| 13–15 | M9 `romberg_eyes_open`, `romberg_eyes_closed`, `tandem_stance` | balance / posterior | video, framing outline, numeral | camera (body) | 90 | head centroid per frame | server sway extractor; one payload after 15 | behind the fall gate (must stay) | L/H/M |
| 16 | M6 `pronator_drift` | motor (laterality) | video, seated | camera (body) | 15 | 33-point pose frames | server extractor | as above | L/M/M |
| 17 | M11 `delayed_recall` | memory (recognition) | 8 word buttons, Done | tap | 30 | hits, false alarms, seconds | recognition features | label says "What were the five words?" (free-recall wording) | M/L/M |
| 18 | M17 `ppg_rhythm` | cardiac rhythm | rear camera, cover check, 60s numeral | finger on lens | 60 | red-channel series, fs | server rhythm extractor | never reached before D-044's renumbering (§C-1) | L/L/L |

Not runnable and skipped (never faked): `tongue_palate`, `finger_to_nose`,
`rapid_alternating`.

## C. The problems that matter

1. **A Comprehensive session ends at step 5 of 18.** `StepQuestions` handles PHQ-2 *and*
   medicines in one component and calls `submit()` when done. Since D-044 moved those
   two modules to positions 5–6, the questionnaire submits and finishes the session with
   twelve steps left. (Before D-044 the same shape skipped PPG at 21.) Not a UX problem
   — a data problem the redesign has to fix on the way through.
2. **Eighteen separate tests.** A "3 / 18" counter, a `Skip this step` underline on every
   screen, a fresh heading per step, and hard cuts between them.
3. **Camera steps start capturing the instant they mount** (M3, M9, M6, M17): the patient
   is looking at a spoken label one frame and a dark field or their own body the next.
4. **Countdown pressure**: large raw numerals on nine steps; a tap counter on M7.
5. **Copy that judges**: "TAP", "Too soon — wait for blue" in destructive red.
6. **Nothing survives a refresh.** The session is only created server-side at the end;
   closing the tab at step 14 loses fourteen steps, and `GET /sessions/{id}/current`
   (built for resume) has nothing to return.
7. **Instructions are spoken once, cannot be repeated, cannot be muted**; the five
   recall words are never actually heard because the label's `speak()` cancels them.
8. **The finish is abrupt**: a tick, "All done ✓", the FAST card, a button.
9. **No comfort controls** on the patient surface: no low-motion, no bigger text, no
   voice toggle. Aphasia mode exists but is the caregiver's setting.
10. **The practice run has no framing** — onboarding step 6 just opens the runner.

## D. Five concepts

| | Concept | What the patient sees |
|---|---|---|
| A | **Landscape** | A calm scene that changes region by region; each activity is a place. |
| B | **Constellation / path of lights** | A line of stops that light up one by one; activities *are* lights (tap the light, follow the light, hold the light). |
| C | **Garden** | Each activity brings something to life; the garden fills in over the session. |
| D | **Light journey** | Light as the single interactive medium — respond to it, follow it, remember it, steady it. |
| E | **Abstract exploration** | A soft environment where completing one activity reveals the next. |

## E. Evaluation

Scored 1 (poor) – 5 (strong).

| Criterion | A Landscape | B Path of lights | C Garden | D Light medium | E Exploration |
|---|---|---|---|---|---|
| Clinical appropriateness (vertigo: no parallax/rotation; no green "all clear") | 2 | 5 | 3 | 5 | 3 |
| Cognitive load | 3 | 5 | 4 | 5 | 2 |
| Accessibility (textual equivalent, colour-independence) | 3 | 5 | 3 | 4 | 2 |
| Implementation cost (no new deps, no WebGL, SVG/CSS only) | 2 | 5 | 2 | 4 | 3 |
| Scales across 18 heterogeneous tasks (camera, mic, slider, standing) | 3 | 5 | 3 | 4 | 4 |
| Emotional comfort | 4 | 4 | 5 | 4 | 3 |
| Older-adult suitability (not childish) | 3 | 5 | 3 | 5 | 3 |
| Mobile usability | 3 | 5 | 4 | 5 | 3 |
| Performance on a cheap Android | 2 | 5 | 3 | 5 | 3 |
| Visual consistency with the blue/white, no-gradient system | 2 | 5 | 2 | 5 | 3 |
| **Total** | 27 | **49** | 32 | 46 | 29 |

## F. Selected: **a path of lights** (B, with D as the interaction medium)

One line runs across the top of every screen with a stop for each activity. Completed
stops are lit; the current stop breathes slowly; the rest are faint. Chapter boundaries
are where the line pauses for a moment. The tasks that involve responding to a stimulus
*are* lights: tap the light (M10, M7, the warm-up), follow the light (M3), hold the light
steady (M21's line), remember the words that appear under the light (M11).

Why it wins: it is static (safe for a cohort we screen for vertigo), abstract and adult,
draws with one SVG and ≤18 circles, degrades to a sentence ("About halfway") for a
screen reader, fits the existing palette without a gradient, and the dark oculomotor
field — already the product's most striking screen — becomes the metaphor's centrepiece
instead of an anomaly.

The word on the screens is **"path"**, never "test", "exam" or "assessment".

## G. Emotional journey → what the screen does

| State | Where | How |
|---|---|---|
| "I am safe." | Welcome | One sentence, the path shown unlit, comfort toggles, "You can rest whenever you like." Exit and pause visible from the first screen. |
| "I understand." | Warm-up | Two interactions that teach the two gestures the path uses (tap, hold). Says plainly nothing is recorded. |
| "This is easy." | Chapter 1 | Hands and voice — the four shortest, most familiar tasks. |
| "This is interesting." | Chapter 3 | The dark field and the moving light. |
| "I can try again." | Any quality failure | "Let's try that again" in the watch tone, never red; two prompts then move on (unchanged rule). |
| "I am allowed to pause." | Every chapter boundary | "Would you like a short rest first?" — Continue first, Rest second, no guilt copy. |
| "I am making progress." | The path | Lights accumulate; phrase changes ("More than halfway"). |
| "I did something meaningful." | Completion | "That's everything for today. Thank you." Then the FAST card, as today. |

Never: a score, a band, praise ("well done"), criticism ("wrong", "failed"), a
diagnosis. The existing `violatesConfirmNeutrality` lexicon is extended to the new
completion strings.

## H. Patient journey map

```
Home ("Begin")
 └─ WELCOME        "Let's get comfortable."  · comfort toggles · [I'm ready] · [Go straight in]
     └─ WARM-UP    "Tap the light." → "Now hold it until it fills."   (nothing recorded)
         └─ CHAPTER 1 · Hands and voice      M10 · M4 · M1 · M7
             └─ MOMENT (rest offer) · CHAPTER 2 · A quick check-in       M13 · M19
                 ── Daily Pulse ends here → COMPLETION ──
                 └─ MOMENT · CHAPTER 3 · Your eyes   M11 encode · M3 ×4 · M21
                     └─ FALL GATE (unchanged semantics) · CHAPTER 4 · On your feet   M9 ×3 · M6
                         └─ MOMENT · CHAPTER 5 · Winding down    M11 recall · M17
                             └─ COMPLETION  "That's everything for today." · FAST card · Home
```

Chapters are a **presentation grouping**, derived from the runnable steps by task, not
from the clinical block (the six Daily Pulse modules span three clinical blocks, so
grouping by block would scatter them). Positions, order and timings are untouched.

Pause, Exit and the path are present on every screen from Welcome to the last step.
Refreshing at any point offers "Welcome back — continue where you left off?".

## I. Transformation map

Clinical purpose → patient-facing activity → interaction → measurement → feedback → transition.
Measurement columns are **unchanged** from today.

| Module | Patient-facing line | Interaction (surface) | Measurement (unchanged) | Feedback | Transition |
|---|---|---|---|---|---|
| M10 | "Tap the light the moment it comes on." | One large light; dim while waiting, bright + "Tap" + haptic when on; a row of ten small dots fills as trials pass | latency from paint, misses, false starts | early tap → "A little early — wait for the light" in watch tone | dots complete → path stop lights |
| M4 | "Say 'aaah' and hold it" … (as today) | Mic light that swells with level; soft ring timer | PCM → features | level ring = "we can hear you" | sub-task chips fill |
| M1 | "Look at the camera" … four cues | Camera in a soft frame, cue text large, ring timer in the corner | landmarks → features + identity | four dots fill | — |
| M7 | "Tap as fast as you can", left then right | Light that dims slightly on each tap (acknowledgement without a count); ring timer; hand label | timestamps L/R | none numeric | — |
| M13/M19 | "Two quick questions" / "Did you take today's medicines?" | Large option buttons, one question per screen | answers | selection state | — |
| M11 enc | "Five words to keep in mind." | Words appear one by one under the light and are **spoken after the instruction**, ring timer | 5 words fixed per session | — | — |
| M3 ×4 | "Keep your head still. Follow the light." | Dark field, the light; ring timer beneath; face preview minimal | gaze per frame paired with target | — | field stays dark across the four, only the light's behaviour changes |
| M21 | "Turn the line until it looks upright to you." | Unchanged stimulus; controls restyled; stop button always visible | angles | — | — |
| M9 ×3 / M6 | Existing copy | Camera frame with framing outline; ring timer chip | centroids / pose frames | outline lights when in frame | — |
| M11 rec | "Which of these words did you see earlier? Tap them." | Eight word lights, selected ones lit | hits, false alarms, seconds | selection state, never right/wrong | — |
| M17 | "Rest your fingertip over the back camera." | Small preview, "Good. Keep it still." when covered, ring timer | red-channel series | — | — |

## J. Component architecture

The minimum set of abstractions; every one has one job.

```
routes/exam/ProtocolRunner.tsx      the orchestrator — unchanged responsibilities, gains a
                                    `phase` and renders the journey components
components/journey/
  JourneyShell.tsx                  the frame on every screen: controls strip (Pause, Exit),
                                    PathProgress, a content area that crossfades on scene change
  PathProgress.tsx                  the SVG path of lights + its textual equivalent
  Moment.tsx                        one primitive, three uses: chapter intro (+ rest offer),
                                    resume offer, exit confirm
  Welcome.tsx                       welcome + warm-up (tap, hold); comfort toggles
  Completion.tsx                    the calm end; FAST card; Home
  Instruction.tsx                   the instruction card: text at patient/aphasia/large scale,
                                    "Listen again", the demo clip when one exists
  Light.tsx                         the shared light (idle / waiting / on / done)
  Ring.tsx                          the soft ring timer (fills, number inside, aria-live at thresholds)
  ComfortControls.tsx               voice · less motion · bigger text
lib/journey.ts                      PURE: chapters(steps), progressPhrase(index,total), labels
lib/journeyStore.ts                 PURE + storage: snapshot / restore of a session in progress
lib/prefs.ts                        PURE + storage: the three comfort preferences
```

Retired: nothing yet. `TaskShell.tsx` stays untouched (its retirement is its own plan,
`docs/plans/PLAN_taskshell_unification.md`).

## K. State architecture

The runner keeps every piece of state it has today and adds one discriminant:

```
phase: "welcome" | "warmup" | "resume" | "chapter" | "step" | "gate" | "paused" | "exit" | "finished"
```

- `welcome` → `warmup` → first `chapter` → `step`… The session clock (`startedAt`) starts
  when the first chapter is entered, not at plan load, so warm-up and reading time do not
  count as task time (§Q, D-062).
- A `chapter` phase is entered whenever `chapters(steps)[index]` differs from the previous
  step's chapter. It shows the intro and, from the second chapter on, the rest offer.
  Choosing Rest is exactly today's pause (records `paused_before_task` on the next task).
- `gate` is today's fall gate, rendered inside the shell.
- `resume` is offered when a snapshot for this patient exists, is younger than six hours,
  and is not a practice run. Continue restores everything; Start again uploads the partial
  as abandoned (D-059) and clears it.
- Snapshot after every `record()` and gate decision: `{version, patientId, sessionType,
  plan, index, modules, ocular, balance, retries, gatePassed, gateSkipped, questions,
  identity, activeMs, savedAt}` to `sessionStorage` (numbers only, no media, ≤ ~1 MB).
  On restore `startedAt = performance.now() − activeMs`, `pausedBeforeNext = true`.
- Cleared on finish, exit and start-again.

## L. Data flow

Unchanged: step → `record()` → in-memory store → at the end `startSession` →
`submitModule`×n → `submitQuestionnaire` → `submitAdherence` → `finalizeSession`, or the
IndexedDB queue when offline. **Change**: the PHQ-2 and medicine answers are recorded into
the store at positions 5 and 6 and submitted with everything else at the end, instead of
ending the session (§C-1, D-061).

No new fields are sent. The warm-up records nothing. Comfort preferences never leave the
device.

## M. Accessibility

- Every scene has one `h1`/`h2` from the type scale; focus moves to it on scene change
  (`preventScroll`), so a screen-reader user hears where they are.
- PathProgress carries `role="img"` with an `aria-label` of the phrase + "step n of N";
  a visually-hidden `aria-live="polite"` line announces chapter changes.
- The light is a `<button>`; Space/Enter work for M10 and M7 (`e.repeat` ignored).
- Colour never carries meaning alone: the "on" state is brighter *and* larger *and*
  labelled *and* haptic; selected words are filled *and* ticked; the framing outline is
  described in words.
- Reduced motion: `prefers-reduced-motion` (already a global backstop) **or** the "Less
  motion" preference disables the path animation, the breathe, and crossfades.
- Text: 20px floor stays; "Bigger text" raises `.patient-scale` to 24px; aphasia mode
  stays as today (larger instruction, caregiver-controlled).
- Touch: nothing tappable under 64px on the patient surface; the light is ≥176px.
- No time-limited *decisions*: timers are capture windows, not response deadlines
  (except M10's 2 s miss window, which is the measurement).

## N. Motion

Existing tokens only (`--dur-base` 240ms, `--dur-slow` 380ms, `--ease-out`,
`DURATION.medium` 620ms). Four patterns:

| Pattern | What | Spec |
|---|---|---|
| Arrive | a scene's content | opacity 0→1, translateY 8px→0, 380ms `--ease-out` |
| Light | a path stop completing | radius and opacity, 620ms `--ease-out`; line draws to it |
| Breathe | the current stop / a waiting light | opacity 0.55↔1 over 2.4s, ease-in-out; ≤ 0.5 Hz, never a flash |
| Fill | the ring timer | `stroke-dashoffset` driven by the same countdown the capture uses |

Transform and opacity only. Nothing bounces, nothing scales past 1.04, nothing rotates
except M21's stimulus (which is the measurement). Low-motion collapses all four.

## O. Performance

No new dependency. One SVG (≤ 18 circles, one path), CSS transitions, no canvas, no
WebGL. The exam chunk is already route-split; the journey components add a few KB. The
face and pose models are memoised loaders, so they are **pre-warmed** during the "Your
eyes" and "On your feet" chapter intros to remove the "Loading…" frame the patient sees
today when a camera step mounts. The snapshot write is debounced to once per `record()`.

## P. Migration order

1. `lib/journey.ts`, `lib/prefs.ts`, `lib/journeyStore.ts` + tests (pure, node).
2. `speech-synthesis.ts`: mute + queued speech (so the recall words are actually heard).
3. `Light`, `Ring`, `PathProgress`, `Instruction`, `Moment`, `Welcome`, `Completion`,
   `ComfortControls`, `JourneyShell`; CSS keyframes in `index.css`.
4. Wire `ProtocolRunner`: phases, snapshot/resume, the questionnaire fix, session-clock
   start, chapter pre-warm; keep every source marker `taskFlow.test.ts` scans.
5. Restyle steps in place: M10, M7 (Light + dots), M11 (words under the light, queued
   speech), M13/M19 (split per position), M4, M1, M3, M9/M6/M17, M21 (Ring, frames).
6. `FallRiskGate` inside the shell; `Onboarding` step 6 framing; `PatientHome` copy.
7. i18n: every new string in en/hi/pa; extend the hardcoded-string scan to
   `components/journey/*.tsx`; extend the confirm-neutrality keys.
8. QA loop: vitest, `tsc -b`, build, oxlint, the backend copy scanners, Playwright at
   320/375/390/414/768/1024/1280 with reduced-motion on and off.

## Q. Risks and decisions

- **D-061 (proposed): questionnaire answers are recorded at their positions and
  submitted at the end.** Fixes §C-1. Changes what a Comprehensive session contains
  (all 18 steps instead of 5). No schema change.
- **D-062 (proposed): the session clock starts at the first chapter, not at plan load.**
  `elapsed_seconds_at_task_start` becomes task time; the warm-up and reading time are
  constant-shaped and excluded. Chapter-intro reading time between steps *is* counted,
  like instruction time today.
- The source scans in `taskFlow.test.ts` constrain the runner's text; they are kept
  deliberately and re-run after every edit.
- The backend overclaim scanner reads frontend source: no "detect", "diagnose",
  "clinically…", no accuracy figure, no ninety-second claim in any new copy.
- A snapshot restore after a *long* gap (hours) is offered up to six hours; beyond that
  the partial is uploaded as abandoned on the next start. Fatigue position is preserved
  either way because positions never renumber.
- Nothing here has run on a physical phone; that remains the owner's run
  (`docs/PHONE_TEST_RESULTS.md`).

## R. Validation

- Unit: `journey.test.ts` (chapter derivation for both session types and both
  intensities; every runnable task has a chapter; progress phrases; no chapter empty),
  `journeyStore.test.ts` (round-trip, elapsed restore, expiry, practice never offered),
  `prefs.test.ts`; existing suites unchanged and green.
- Copy: `hardcodedStrings.test.ts` extended; `i18n.test.ts` (all three languages);
  a scan that no `journey*`/`ch*` string carries "test", "exam", "wrong", "fail".
- Build: `tsc -b`, `vite build`, `oxlint` at baseline.
- Backend: `test_regulatory_claims.py`, `test_protocol_runtime.py`, `test_privacy.py`.
- Browser: Playwright walk of the practice journey and a comprehensive journey with
  camera steps skipped, at seven widths, reduced-motion on/off, refresh mid-session →
  resume, exit → abandoned, console clean.
