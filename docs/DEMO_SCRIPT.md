# NeuroTrace — 3-minute live demo

Two browser tabs and a phone. Nothing here is faked: the seeded history is produced by the
same engine a live check-in goes through.

**Before you walk on stage**

1. Backend and frontend up. `GET /health` returns `database: up`.
2. `npm run fetch:mediapipe` has been run, and you have loaded the app once on the phone so
   the service worker has cached the model. *Do this — the airplane-mode moment depends on it.*
3. Login screen open in tab 1. Do **not** press the demo button yet.
4. Phone on the deployed HTTPS URL, signed in, sitting on the patient's home screen.

---

## 0:00 — 0:25 · The problem

> "After a stroke, a survivor goes home and effectively disappears. A neurologist sees them
> for twenty minutes once every one to three months. In between, nobody measures anything.
> Forty percent develop cognitive impairment. Sixty percent still have speech difficulty at
> six months. A third become depressed. All of it progresses silently, and gets noticed when
> it becomes a crisis."

---

## 0:25 — 0:45 · Load the demo

Press **Open the demo**. You land on Ramesh's dashboard — 67, left MCA infarct, five months
post-discharge, Punjabi speaker. Status: **Please check on them**.

> "Three weeks of daily check-ins. Each one is ninety seconds on his own phone."

---

## 0:45 — 1:25 · Read the dashboard top to bottom

Point at the **status card**:

> "Not a score. A sentence: *'Please check on them today. What changed: one corner of the
> mouth sat lower than the other, and the eyebrows lifted unevenly.'* His daughter, in
> another city, can act on that."

**Tap the हिं / ਪੰ toggle.** Same finding, in Hindi and Punjabi.

Point at the **confounder line**:

> "And it tells you why it might be wrong. That is the difference between decision support
> and a black box."

Point at the **domain charts**:

> "Face, speech, hands, attention. The green band is *his* usual range — learned from his
> own first fifteen sessions, not from a population average, because a man with a chronic
> facial weakness has an asymmetry that is pathological in anyone else and normal for him.
> Hollow dots are the days we were still learning. Then two lines cross together."

---

## 1:25 — 1:55 · The part that matters

Point at the history table — the first decline day is **WATCH**, not ALERT.

> "Here is the decision that makes this usable. On the first bad day, several signals had
> already moved. We did **not** alert.
>
> An alert needs two things at once: the same domain deviating across **two consecutive
> sessions**, and **two independent domains** agreeing. One bad night's sleep moves one
> signal for one day — that is noise, and noise never reaches the family. A hoarse throat
> moves every speech feature at once, which looks dramatic and means nothing, so speech
> alone is capped at Watch no matter how large it gets.
>
> Only when speech *and* hand movement both hold for two days does it become an alert. One
> alert for the whole episode, not one every morning — because a product that cries wolf
> gets muted, and a muted product detects nothing."

---

## 1:55 — 2:40 · Run a live exam, offline

Pick up the phone. **Turn on airplane mode.** Show the toggle to the room.

Open the app → **Start check-in**.

**Face (16s)** — smile, raise eyebrows, close eyes, puff cheeks.
> "MediaPipe, 468 landmarks, running in the browser. Watch the forehead task — the forehead
> has innervation from both sides of the brain, so a stroke spares it while the lower face
> droops. Bell's palsy takes the whole side. Without that task we would raise a
> stroke-shaped alarm for something self-limiting."

**Speech (20s)** — hold "aaah", then "pa-ta-ka", then read the sentence.
> "Jitter, shimmer, how long he can hold a sound, how evenly he can switch consonants.
> Analysed in the browser with the Web Audio API."

**Hands (22s)** — tap with left, then right.
> "Both hands, always. Parkinson's and ageing slow *both*. A stroke slows *one*. The ratio
> is the signal — and we can show you the numbers: on rate alone the two are
> indistinguishable at chance, ROC-AUC 0.48. On the asymmetry ratio, 0.98."

**Attention (20s)** — tap when the circle turns blue.
> "What matters is not speed, it is consistency. Variability of response time is the most
> sensitive cognitive marker there is."

Land on **All done ✓** with the offline badge visible.

> "Still in airplane mode. The exam completed. Nothing was uploaded because there was
> nothing to upload — the audio and the video never left the phone. Only the numbers
> queue, and they sync when signal returns.
>
> This is the same posture Samsung took with Brain Health at CES: on-device, voice and
> movement, explicitly not diagnosing. We are that, for stroke."

**Turn airplane mode off.** The queue drains; the dashboard updates.

---

## 2:40 — 3:00 · Close

Tap **Emergency** on any screen.

> "And the thing we are honest about. This watches for slow change over days. It cannot see
> a stroke happening — that takes seconds. So the FAST card is on every screen, every day,
> and one tap reaches an ambulance. If the family reports a sudden symptom, we skip our
> entire engine and escalate immediately. We never tell anyone they are fine.
>
> We are not diagnosing strokes. We are making sure somebody notices in time."

---

## If something breaks

| Problem | Do this |
|---|---|
| Demo button spins | Backend asleep (free tier). Hit `/health`, wait 30s, retry. |
| Camera or mic blocked | Must be HTTPS — use the deployed URL, not a LAN IP. Or press **Skip this step**; the score renormalises around whichever modules captured. |
| Face model fails offline | The service worker had not cached it. Load the app once online first. This is step 2 of the setup for a reason. |
| Live exam shows nothing | Expected — a new patient is in the baseline phase for fifteen sessions, and the app says so. The story lives in the seeded three weeks. Say this; it makes the point that we do not judge before we have learned. |
| Everything is on fire | `python -m app.seed` against a local database and demo from localhost. A working local demo beats a broken deployed one. |

---

## The one-line version

> **NeuroTrace learns what normal looks like for one person, and tells their family — in
> their own language, on their own phone — when two independent things change together for
> more than one day.**
