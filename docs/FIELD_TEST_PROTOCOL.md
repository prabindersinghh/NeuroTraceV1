# FIELD TEST — first run on a real phone

Everything in this product has been verified in a desktop browser. That is the largest
untested surface we have, and this document is what turns one afternoon with a phone into
data I can act on.

**Privacy, first and non-negotiable.** No photographs, no video, no screen recordings of the
patient. No name, no age, no location in anything you send back. The diagnostics page and
the observation sheet are both designed to carry nothing that identifies anybody — keep them
that way. If you want to note *which* person a session belongs to, use `P1`, `P2`.

---

## Part 0 · What actually needs answering

Four questions. Everything below exists to answer one of them. If you only get through the
first two, that is still a good day.

| # | Question | Why it decides something |
|---|---|---|
| **Q1** | What frame rate does the camera really deliver? | A saccade lasts 30–80 ms. At 30 fps it spans one to three frames, so "peak velocity" is a two-frame average that understates the true peak. On a phone-only (TIER_1) patient, **M3 is the sole source of posterior laterality** — if velocity is unusable there, the laterality gate rests entirely on saccade *asymmetry* and latency. I need to know which world we are in. |
| **Q2** | Does pose tracking hold at 1.5 m? | M9 balance scales its measurements by head width to convert pixels to centimetres. At 1.5 m, on a phone camera, in a normal room, the head is small. If landmarks get noisy the CCG numbers are noise dressed as centimetres. |
| **Q3** | How long does framing actually take? | The design assumes a patient gets the outline green in a few seconds. If it takes 30 s per task, a 12-minute session is really 20 and the fatigue model is wrong. |
| **Q4** | Where does the patient tire? | The whole fixed-ordering argument rests on fatigue being smooth and predictable. If there is a cliff at a particular task, ordering needs to change. |

---

## Part 1 · Devices — bring more than one if you can

**Do not send me spec sheets.** A spec sheet says the sensor does 60 fps; it says nothing
about what the browser delivers through `getUserMedia` at 720p, in that room's light, with
MediaPipe competing for the CPU. So the app measures it instead.

Open **`https://<your-vercel-url>/diagnostics`** on each phone. No login. It reports:

- **measured** camera fps at 60 and at 30 requested, plus the worst frame gap (a mean hides
  dropped frames; the worst gap does not)
- actual capture resolution
- wasm SIMD support — without it MediaPipe falls back to a build several times slower
- CPU cores, device memory, screen, storage quota
- whether the orientation sensor exists, and whether it needs an iOS permission prompt
  (the SVV handset-tilt input depends on it)

Press **Copy report** and paste the JSON back. That is Part 1 done.

**Which phones matter most:** the cheapest Android you can find, whatever the family
actually uses, and one iPhone if available. The cheap Android is the important one — this
product's users are not on flagships, and a result from a flagship tells me almost nothing
about them. Run it in the **room and light where check-ins will happen**; a camera in dim
light lengthens its exposure and the frame rate falls, which is exactly the condition we
care about.

---

## Part 2 · Run real sessions

Sign in as the demo patient on the **deployed** instance and complete **three full sessions**
on different days, or three on one day if that is what you can get. The app already records
per task: `capture_fps`, `quality_flag`, retries, `session_position`,
`elapsed_seconds_at_task_start`, `intensity`, `paused_before_task`.

**Send me the session IDs and the deployed URL and I will pull the rest.** Do not transcribe
numbers by hand — that is a transcription error waiting to happen, and we have already been
bitten by one.

If a session cannot be submitted (offline, backend down), say so — the app queues it, and
knowing a session was queued rather than lost matters.

---

## Part 3 · The observation sheet — what instruments cannot see

This is the part only a person can do. Copy this block, fill it per session, keep it in
plain text.

```
SESSION __ of 3        person: P_      device: (short name, e.g. "cheap android")
room light:  bright daylight / indoor daylight / lamp only / dim
distance for the standing block:  ___ m (rough is fine)
who held the phone during the standing block:  patient / carer / propped

TASKS THAT WENT WRONG
  step __ (module __): what happened, in your words
  step __ (module __): ...
  (include: outline would not go green, camera froze, instruction unclear,
   patient could not physically do it, app crashed, sound did not play)

FRAMING TIME
  roughly how long to get the outline green:  fastest ___ s   slowest ___ s
  which task was the slowest to frame:  ___

FATIGUE — the important one
  first moment you noticed effort (step number and what you saw):
  did they ask how much longer?  at step ___
  did they want to stop?  at step ___
  did they finish?  yes / no — if no, which step ended it:

TOTAL WALL-CLOCK TIME
  start __:__   end __:__   any pause?  yes/no, how long, at which step

ANYTHING THAT ANNOYED THEM
  (free text — this is the most valuable box on the sheet)
```

**On the fatigue lines: record what you saw, not what you concluded.** "Sat down between
steps 14 and 15" and "sighed and asked how many left" are usable. "Got tired around the
middle" is not.

---

## Part 4 · Two things to test on purpose

**A · The standing block, with the fall-risk gate taken seriously.** Someone stands next to
the patient, close enough to catch them, for every eyes-closed task. This is not a
formality: the tasks deliberately make a stroke survivor unsteady with their eyes shut. If a
second person is not available, **skip the standing block** and say so — a skipped block is
data; a fall is not.

**B · Airplane mode.** Load the app once with data on, then turn on airplane mode and
complete a session. The whole offline claim rests on this. Tell me exactly where it breaks
if it does — which step, what the screen said.

---

## Part 5 · How to send it back

One message, three parts:

1. the diagnostics JSON, one block per phone (copy-paste, do not retype)
2. the session IDs and the deployed URL
3. the filled observation sheets, as plain text

No screenshots of the patient, no video, no identifiers.

---

## What I will do with it

- **Q1 → ML_STATUS and the M3 caveat.** If measured fps is below ~45, I will stop treating
  saccade peak velocity as a trendable feature on that tier and say so in the model card,
  rather than leaving a number in the output that looks meaningful and is not.
- **Q2 → M9's pixel-to-centimetre conversion.** If landmarks are noisy at 1.5 m, the
  conversion needs either a different scaling reference or an explicit distance check
  before capture.
- **Q3 → the session plan's timing.** `planned_seconds()` currently counts task time only.
  If framing is slow, the plan is lying about the length of the session.
- **Q4 → task ordering.** A fatigue cliff at a specific step is the one piece of evidence
  that would justify reordering the protocol, which is otherwise deliberately fixed.

If the answers say the phone tier cannot carry M3 reliably, that is a finding worth having
early — it makes the case for the watch tier concrete instead of theoretical.
