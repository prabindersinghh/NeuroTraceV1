# DEMO CLIPS — shot list

Every task shows a looping clip before the patient attempts it. This is not polish: the
users include people with aphasia, for whom a spoken sentence may not arrive at all, and
people who have never held a smartphone. Showing beats telling.

**Nothing is blocked on these.** A missing file resolves to `undefined`, `TaskShell` skips
the demo phase, and the task runs normally. Add them one at a time.

---

## Rules for every clip

| | |
|---|---|
| **Length** | 3–6 seconds, looping seamlessly. Longer and people wait instead of watching. |
| **Format** | MP4 / H.264, 720×720 square, ≤ 1 MB each. Square because the frame sits above the instruction on a phone. |
| **Sound** | **None.** The clip is muted and autoplays; the instruction is spoken separately in the patient's language. A clip with English narration excludes most of the users. |
| **Who is in it** | **Not the patient, and not any real patient.** Use yourself or a willing adult. No faces of people who have not agreed to appear in software. |
| **What they wear** | Plain clothes, plain wall behind. Busy backgrounds make the movement hard to read on a small screen. |
| **Speed** | Perform the movement at the speed you want copied. People match the pace they see, which matters for the timed tasks. |
| **Repetitions** | Show the movement 2–3 times within the loop so the pattern is unmistakable. |

**Do not show a person struggling, and do not show a "wrong" version.** These clips are
watched by someone about to attempt the same movement after a stroke; a demonstration of
failure sets the expectation that failing is what happens here.

---

## The list

Drop files into `frontend/public/demo/` with exactly these names.

| Step | Filename | What the clip shows |
|---|---|---|
| 1 | `M10-simple_and_choice_rt.mp4` | Tap the circle the moment it appears. |
| 2 | `M11-word_encoding.mp4` | Remember these five words. |
| 3 | `M4-sustained_ddk_sentence.mp4` | Take a breath and say aaah for as long as you can. |
| 4 | `M1-facial_battery.mp4` | Smile as wide as you can. |
| 5 | `M2-tongue_palate.mp4` | Stick your tongue straight out. |
| 6 | `M3-horizontal_saccades.mp4` | Keep your head still. Look at the dot each time it jumps. |
| 7 | `M3-vertical_saccades.mp4` | Look at the dot each time it jumps. |
| 8 | `M3-smooth_pursuit.mp4` | Follow the dot with your eyes. Don't move your head. |
| 9 | `M3-gaze_holding.mp4` | Hold your eyes on the dot. |
| 10 | `M21-svv_static_and_dynamic.mp4` | Turn the line until it looks perfectly upright to you. |
| 11 | `M9-romberg_eyes_open.mp4` | Stand with your feet together, arms by your side. |
| 12 | `M9-romberg_eyes_closed.mp4` | Now close your eyes. Someone should be beside you. |
| 13 | `M9-tandem_stance.mp4` | Put one foot directly in front of the other, heel to toe. |
| 14 | `M6-pronator_drift.mp4` | Hold both arms straight out, palms up, and close your eyes. |
| 15 | `M7-finger_tapping.mp4` | Tap the two circles, back and forth, as fast as you can. |
| 16 | `M8-finger_to_nose.mp4` | Touch the dot on the screen, then touch your nose. Repeat. |
| 17 | `M8-rapid_alternating.mp4` | Turn your hand over and back, as fast as you can. |
| 18 | `M11-delayed_recall.mp4` | What were the five words? |
| 19 | `M13-phq2.mp4` | Two quick questions about how you have been feeling. |
| 20 | `M19-medication_confirm.mp4` | Did they take their medicines today? |
| 21 | `M17-ppg_rhythm.mp4` | Cover the camera with your fingertip. Rest your hand. |

⚠ = fall-risk task. Film it with someone standing beside the performer, **in frame**. The
clip is also teaching the family that supervision is part of the task, and a demo of an
unsupervised eyes-closed stance teaches the opposite.

---

## Priority, if you are only filming a few

1. **Steps 11–14** — the standing block. Highest risk, hardest to describe in words, and the
   only tasks where a misunderstanding can cause a fall.
2. **Steps 6–9** — the ocular tasks. "Keep your head still and move only your eyes" is the
   single most misunderstood instruction in the battery, and head movement contaminates
   every saccade measurement.
3. **Step 21** — PPG. Covering the camera lens with a fingertip is unintuitive and people
   press too hard, which occludes the blood flow being measured.
4. Everything else.
