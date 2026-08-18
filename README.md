<div align="center">

# NeuroTrace

**A 45-second daily neurological check-in for stroke survivors at home.**

Captures voice, facial movement and reaction time · learns each patient's *personal*
baseline · alerts only when two or more signals deviate together for three days ·
explains every alert in plain English and Hindi.

No wearable. No clinic visit. Any phone browser.

</div>

---

## The problem

After a stroke, the most dangerous period is at home — the weeks between monthly
appointments, when nobody is watching. Speech slurs slightly. One side of the smile weakens.
Reactions slow. These changes are gradual and invisible day to day, and by the time family
notices, it is an emergency.

India sees roughly **1.8 million strokes a year**, and **1 in 4 survivors has a second one**.
The gap is not medical knowledge. It is that nobody is measuring.

## What NeuroTrace does

Once a day, the patient opens a web page and spends 45 seconds:

| Step | What happens | What it detects |
|---|---|---|
| **Speak** | Reads one sentence aloud, 10s | Dysarthria — unstable pitch, breathy voice, longer pauses, slower articulation |
| **Look** | Smiles and blinks at the camera, 10s | Unilateral facial weakness — mouth asymmetry, corner droop, uneven eye aperture, micro-tremor |
| **Tap** | 12-trial reaction game | Slowed processing, and above all *increased variability* — the most sensitive early marker of cognitive change |

The system learns what normal looks like **for that one person** over their first four days,
then measures every later day against it. A caregiver sees a status — **Stable / Watch /
Alert** — with a sentence they can act on.

The patient never sees a score, a band, or the word "risk". Ever.

## The idea that makes it usable

Anyone can build something that fires when a number crosses a line. That product gets muted
in a week.

NeuroTrace raises an alert **only** when:

- **two or more independent signals** deviate, *and*
- they stay deviated for **three consecutive days**

A high score on a single bad day is capped at **Watch** and never reaches the family. One
poor night's sleep moves one signal for one day — that is noise, and noise is what destroys
trust in a monitoring product.

In the ten-day reference run the score hits 99/100 on day 8. No alert. Day 9, still 99.
Still no alert. The alert fires on **day 10** — the first day the evidence is actually real.

```
Day  1-4  baseline   dev 0.00/0.00/0.00   score   3.9   STABLE   <- learning his normal
Day  5    stable     dev 1.40/1.07/1.84   score  28.8   STABLE
Day  6    stable     dev 1.18/1.24/0.91   score  19.4   STABLE
Day  7    stable     dev 1.20/1.61/0.91   score  22.9   STABLE
Day  8    decline    dev 6.00/5.41/6.00   score  99.8   WATCH    <- high, but unsustained
Day  9    decline    dev 6.00/5.52/6.00   score  99.8   WATCH    <- still not cross-validated
Day 10    decline    dev 6.00/5.62/6.00   score  99.8   ALERT    <- 3 signals, 3+ days
```

> **Day 10, to the caregiver:** *"Please check on them today: more attention lapses during
> the test, pitch is more variable than usual and the eyes are opening unevenly. These
> changes have continued for several days across more than one signal."*

> **उसी दिन, हिंदी में:** *"आज उनका हाल ज़रूर देखें: जाँच के दौरान ध्यान ज़्यादा भटका, आवाज़ का सुर सामान्य
> से ज़्यादा बदल रहा है और आँखें बराबर नहीं खुल रही हैं।"*

No black box. Every alert names the three features that drove it.

---

## Repository layout

```
NeuroTraceV1/
├── backend/       FastAPI · async SQLAlchemy · PostgreSQL · the ML core
├── frontend/      React 18 · Vite · TypeScript · Tailwind · Recharts
├── infra/         render.yaml, deployment env template
├── docs/
│   ├── PRD.md              product requirements
│   ├── TRD.md              technical requirements — stack, schema, API, ML design
│   ├── DEVELOPMENT.md      full build, run, test and deploy guide
│   ├── DEMO_SCRIPT.md      3-minute live pitch walkthrough
│   └── BUILD_PLAN.md       the phased plan this was built from
└── legacy/v1/     the original single-file Streamlit prototype, kept for reference
```

`legacy/v1/` proved the concept in Streamlit: one process, local JSON files, no accounts.
The current app is the real thing — multi-user, authenticated, database-backed, deployable,
tested. The repo root follows the layout specified in [docs/TRD.md](docs/TRD.md) §2.

---

## Quick start

Requires **Python 3.11** (MediaPipe publishes no 3.12/3.13 wheels for the pinned version),
**Node 18+**, and **PostgreSQL 15**.

```bash
git clone https://github.com/prabindersinghh/NeuroTraceV1.git
cd NeuroTraceV1
```

**Backend**

```bash
cd backend
py -3.11 -m venv .venv && .venv/Scripts/activate   # macOS/Linux: python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.lock.txt               # exact verified set; or requirements.txt
cp .env.example .env                               # set JWT_SECRET and DATABASE_URL
alembic upgrade head
python -m app.seed                                 # demo data: demo@neurotrace.app / neurotrace-demo
uvicorn app.main:app --reload                      # http://localhost:8000/docs
```

**Frontend** (second terminal)

```bash
cd frontend
npm install
cp .env.example .env.development
npm run dev                                        # http://localhost:5173
```

Open http://localhost:5173 and press **Open the demo**. You land on a seeded patient —
Ramesh, 67 — with ten days of history ending in an alert.

No PostgreSQL handy? The test suite runs entirely on SQLite:

```bash
cd backend && pytest                     # 105 passed
```

Full documentation — architecture, the scoring maths, the API reference, privacy notes and
the deploy checklist — lives in **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.

---

## How the scoring works

1. **Extract** — per modality, server-side, CPU only.
   *Voice*: MFCC 1–13 mean/std, jitter, shimmer, HNR, pause ratio, pauses/sec, articulation
   rate, F0 mean/std/CV, spectral centroid (librosa + Praat).
   *Face*: 468 MediaPipe FaceMesh landmarks → mouth symmetry, corner drop, eye aspect ratio
   L/R, brow asymmetry, landmark tremor, blink rate.
   *Reaction*: median RT, IQR, coefficient of variation, lapse rate, attention-decay slope,
   fatigue delta, miss rate.

2. **Baseline** — the first **4** valid days per modality become a personal mean and standard
   deviation, then freeze. The standard deviation is floored so a flat feature cannot explode
   a z-score.

3. **Deviate** — `d_m = mean(|z|)` across that modality's features, each `|z|` clipped at 6 so
   one broken feature cannot dominate.

4. **Score** — `S = 100 / (1 + e^(-1.6·(d̄ − 2.0)))`, where `d̄` is the quality-weighted mean
   deviation. Modalities whose capture failed are dropped and the rest renormalised — a dead
   webcam must not look like a perfect day.
   Bands: **Stable** 0–39 · **Watch** 40–69 · **Alert** 70–100.

5. **Gate** — the cross-validation described above. This is the part that matters.

6. **Explain** — the top three z-scores, filtered to the clinically meaningful direction,
   rendered as sentences in English and Hindi.

Every threshold is a named constant in [backend/app/ml/scoring.py](backend/app/ml/scoring.py).
Nothing is hidden in a model file.

---

## Testing

**105 tests**, covering the maths, the pipeline, the HTTP layer and the migration.

The one worth knowing about is `tests/test_api_checkin.py`: it drives ten complete check-ins
over HTTP using **real generated media** — WAV files that go through librosa and Praat, and
WebM videos that go through MediaPipe FaceMesh. Nothing in it is mocked. It asserts no alert
across the stable days and an alert on the third sustained decline day.

```bash
cd backend
pytest                                   # everything
pytest tests/test_alert_gate_sim.py -v   # just the alert gate
```

---

## Status

Tier 1 (per the PRD) is complete and runs end to end: authentication with roles, the full
capture pipeline, personal baselines, scoring, the alert gate, bilingual explanations, the
patient check-in flow, the caregiver dashboard, demo seeding and deployment configuration.

Deliberately **not** built yet (Tier 2): rolling baseline updates, a trained
dysarthria-likelihood classifier, native mobile apps, and real WhatsApp delivery — the sender
is a working mock that logs.

---

## Privacy

Raw audio and video are deleted immediately after feature extraction; only numeric feature
vectors persist. No personally identifying information is written to logs. Secrets come from
environment variables only, and CORS is locked to a single configured origin.

This is a monitoring aid, not a diagnostic device. It does not detect strokes and it does not
replace a clinician. It exists so that somebody notices in time.
