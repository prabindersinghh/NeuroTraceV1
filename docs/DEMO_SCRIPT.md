# NeuroTrace — 3-minute live demo

Two browser tabs, one phone. Total runtime 3:00. Nothing here is faked: the demo history
is generated from the same scoring pipeline a real check-in goes through.

**Before you walk on stage**

1. Backend and frontend both up (local or deployed) — check `/health` returns `database: up`.
2. Open the login page. Do **not** press the demo button yet.
3. Have a second tab already on the login page, for the live check-in.
4. Phone on the same network if you want to do the capture on mobile (needs HTTPS, so use
   the Vercel URL, not the laptop's IP).

---

## 0:00 — 0:25 · The problem

> "1.8 million strokes a year in India. One in four survivors has a second one. The most
> dangerous period is at home, between monthly appointments — where nobody is watching.
> Speech slurs a little. One side of the smile weakens. Reactions slow. By the time family
> notices, it's an emergency."

---

## 0:25 — 0:45 · Load the demo

Click **Open the demo**.

You land on Ramesh's dashboard: 67, ten days of history, status **ALERT** in red.

> "This is Ramesh, 67, four months post-stroke. NeuroTrace has watched him for ten days."

---

## 0:45 — 1:20 · The dashboard — read it top to bottom

Point at the **status card**:

> "Red. And underneath it, in plain language — not a probability, not a model output:
> *'Please check on them today: more attention lapses during the test, pitch is more
> variable than usual, and the eyes are opening unevenly. These changes have continued for
> several days across more than one signal.'*
> His daughter can act on that sentence. Tap the EN/HI toggle — same thing in Hindi."

**Toggle to हिं, then back to EN.**

Point at the **three charts**:

> "Voice, face, reaction time. The green band is *his* normal — learned from his first four
> days, not from a population average. The dashed red line is the alert threshold.
> Hollow dots are the baseline days. Flat for a week — then all three cross together."

---

## 1:20 — 1:45 · The part that matters — why it didn't cry wolf

Point at days 8 and 9 in the history table — both **WATCH**, not ALERT.

> "Here's the design decision that makes this clinically usable. On day 8 his score was
> already 99 out of 100. We did **not** alert. Day 9, still 99. Still no alert.
> An alert requires **two or more independent signals** deviating **three days running**.
> One bad night's sleep moves one signal for one day — that's noise, and it never reaches
> the family. Day 10 is the first time the evidence is real. That's the difference between
> a product a caregiver keeps and one they mute in a week."

Point at the **alert log**: one entry, WhatsApp sent.

---

## 1:45 — 2:40 · Do a live check-in

Second tab (or phone). Sign in as the demo caregiver → **Ramesh** → **Start check-in**.

**Step 1 — voice (10s).** Read the sentence on screen out loud.
> "Ten seconds of speech. We pull MFCCs, jitter, shimmer, harmonics-to-noise ratio, pause
> ratio, articulation rate — the actual acoustic markers of dysarthria."

**Step 2 — face (10s).** Smile, blink twice.
> "MediaPipe, 468 facial landmarks, running on the server. Mouth symmetry, corner droop,
> eye aperture left versus right, micro-tremor."

**Step 3 — tap test (12 taps).** Tap when the circle turns blue.
> "Reaction time — but what matters isn't speed, it's *variability*. Coefficient of
> variation is the most sensitive early marker of cognitive change."

Land on **All done ✓**.

> "That's it. Forty-five seconds. And notice — the patient never sees a score, a risk
> number, or the word 'alert'. Ever. He'd stop doing it."

---

## 2:40 — 3:00 · Close

> "No wearable. No clinic visit. Any phone browser. The whole thing runs on CPU in under
> five seconds. Every alert explains itself in English or Hindi, and it only fires when
> more than one signal agrees for more than one day.
> We're not diagnosing strokes. We're making sure somebody notices in time."

---

## If something breaks

| Problem | Do this |
|---|---|
| Demo button spins | Backend is asleep (Render free tier). Hit `/health` once, wait 30s, retry. |
| Mic/camera blocked | Must be HTTPS — use the deployed URL, not `http://<laptop-ip>`. Or press **Skip this step**; the score renormalises around the modalities that did capture. |
| Check-in shows STABLE | Expected — the live check-in is a fresh, healthy capture. The story lives in the seeded ten days. Say so; it makes the point that it doesn't fire spuriously. |
| Charts empty | Re-press **Open the demo** — it reseeds idempotently. |
| Everything is on fire | `python -m app.seed` against a local database and demo from localhost. A working local demo beats a broken deployed one. |

---

## The one-line version

> **NeuroTrace learns what normal looks like for one person, then tells their family — in
> their own language — when two things change at once for three days.**
