# Phone test results — Part 7.5

**Status: EMPTY TEMPLATE. Nothing in this document has been run.**

Nothing in NeuroTrace has ever executed on a physical handset. Every row below is blank on
purpose, and no row may be filled in from a desktop browser, an emulator, or an assumption.
If a cell cannot be filled from an observed run on a real device, write `NOT RUN` — never a
plausible-looking value.

This document exists so the first real handset session produces a complete, comparable
record instead of a set of impressions.

---

## 0. Before you start

- [ ] Load the app **once while online** so the service worker caches the MediaPipe model
      assets. Offline mode cannot work before this has happened once.
- [ ] Open `/diagnostics`, press **Copy JSON**, and paste the result into §2 for each
      device. That single blob captures device/browser/OS, FaceMesh and PoseLandmarker init
      times and success rates, measured camera FPS with its timing source, WASM SIMD
      availability, memory, and storage quota.
- [ ] Note the room: lighting (window / ceiling light / lamp), time of day, and roughly how
      far the phone is from the person. Half the failures in field CV work are the room.
- [ ] Have a second person present. Do not test the fall-risk gate alone.

---

## 1. Devices under test

| # | Device | Android version | Browser + version | RAM | Chipset | Screen | Tester | Date |
|---|---|---|---|---|---|---|---|---|
| D1 | | | | | | | | |
| D2 | | | | | | | | |
| D3 | | | | | | | | |

Target the low end deliberately. A flagship result tells you nothing about the phone this
product is actually for.

---

## 2. `/diagnostics` capture

Paste the copied JSON verbatim. Do not summarise it.

### D1
```json

```

### D2
```json

```

### D3
```json

```

---

## 3. Per-module results

One row per module per device. `Ran?` means the capture completed and produced features —
not that it looked right.

| Device | Module | Task | Ran? | Time taken | Quality flag | Retries used | Notes |
|---|---|---|---|---|---|---|---|
| D1 | M1 | face | | | | | |
| D1 | M3 | oculomotor (4 tasks, aggregated) | | | | | |
| D1 | M4 | speech / DDK | | | | | |
| D1 | M7 | tapping | | | | | |
| D1 | M9 | balance / CCG (3 tasks, aggregated) | | | | | |
| D1 | M10 | attention / reaction | | | | | |
| D1 | M13 | pronator | | | | | |
| D1 | M19 | PPG | | | | | |
| D1 | M21 | SVV | | | | | |

Repeat the block for D2 and D3.

**The two aggregated modules are the ones to watch.** M3 and M9 accumulate across several
protocol steps and submit once, on the last step of the group. If a retry mid-group does not
rewind the shared buffer correctly, the submitted payload is wrong in a way nothing on
screen would show.

---

## 4. Failure modes

Each of these has specific handling in the app (Part 7.2). Provoke each one deliberately and
record the message you actually saw, verbatim. A generic error, a silent bad measurement, or
a frozen screen is a finding.

| Failure mode | How to provoke | Device | Message shown (verbatim) | Recoverable? | Finding |
|---|---|---|---|---|---|
| No face detected | Point the camera at a wall | | | | |
| Partial body | Stand too close for the pose tasks | | | | |
| Too dark | Curtains closed, lights off | | | | |
| Motion blur | Move during capture | | | | |
| Camera permission denied | Deny at the prompt | | | | |
| Camera permission revoked mid-session | Revoke in settings while running | | | | |
| Model load failed | Throttle to offline before first cache | | | | |
| Microphone unavailable | Another app holding the mic | | | | |
| Interrupted by a phone call | Call the device mid-session | | | | |
| Screen lock mid-session | Let it time out | | | | |

---

## 5. The three safety guarantees

These are not features; they are the product's safety floor. Each must be verified by
observation on each device, not by reading the code.

| Guarantee | Device | Verified? | How you checked | Notes |
|---|---|---|---|---|
| FAST / emergency card reachable at all times | | | | |
| No score, band, praise or criticism shown at performance time | | | | |
| Pause always visible, and pausing never invalidates the session | | | | |
| Fall-risk gate appears before standing tasks and can be skipped without penalty | | | | |

---

## 6. Offline behaviour

The airplane-mode demo must be **certain**, not assumed.

| Check | Device | Result | Notes |
|---|---|---|---|
| Load app fully offline (after one online load) | | | |
| MediaPipe models load from cache offline | | | |
| Complete a full session offline | | | |
| Session queues, and the queue count is accurate | | | |
| "Send now" drains the queue on reconnect | | | |
| Queue survives an app close and reopen | | | |
| Queue survives a device reboot | | | |

**Known gap, not a test failure:** there is no automatic drain today — a queued session sends
only when someone taps "Send now" on a caregiver surface, and that strip does not appear
during a session. See `docs/plans/PLAN_offline_auto_drain.md`. Record how many taps it took
and whether a realistic user would have found them.

---

## 7. Battery, thermal, latency

| Metric | Device | Daily Pulse | Comprehensive | Notes |
|---|---|---|---|---|
| Wall-clock duration | | | | |
| Battery % consumed | | | | |
| Device temperature (subjective: cool / warm / hot) | | | | |
| Any thermal throttling observed | | | | |
| Frame rate at start vs end | | | | |

Daily Pulse is **195s of raw task time** — realistically 3–4 minutes wall clock once
instructions and framing are included (D-045). Record the real number. If it is materially
longer on a real device, that is a finding worth acting on, not a number to round down.

---

## 8. Legibility and reach

Tested with the actual intended user, not a developer.

| Check | Device | Result | Notes |
|---|---|---|---|
| 20px text floor readable at arm's length | | | |
| 64px tap targets hittable with a weak or tremoring hand | | | |
| Instructions understood without explanation | | | |
| Hindi rendering correct | | | |
| Punjabi rendering correct | | | |
| Any untranslated string leaking to the patient | | | |

---

## 9. Findings

Number each, state what happened, on which device, and what it blocks.

| # | Severity | Device | What happened | Root cause (if known) | Blocks what |
|---|---|---|---|---|---|
| 1 | | | | | |

---

## 10. Sign-off

| | |
|---|---|
| Tested by | |
| Date | |
| Devices covered | |
| Verdict | |
| Outstanding blockers | |
