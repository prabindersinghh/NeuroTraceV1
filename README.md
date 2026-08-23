<div align="center">

# NeuroTrace

**A neurological examination, performed daily at home, entirely on the patient's own
phone.** Ninety seconds of capture for the daily core; about twelve minutes for the full
twenty-one-task protocol.

Learns what is normal *for one person*, then reports deviation from that — to their family
in plain Hindi, Punjabi or English, and to their clinician with the numbers behind it.

Nothing is diagnosed. No recording ever leaves the device.

</div>

---

## The problem

After an ischemic stroke, survivors go home and effectively disappear from clinical view. A
neurologist examines them for about twenty minutes once every one to three months. In
between, nobody measures anything.

- **39–47%** develop post-stroke cognitive impairment
- **~60%** still have aphasia or dysarthria past six months
- **11–41%** develop post-stroke depression
- **1 in 4** has a second stroke

All of it progresses silently, and is noticed when it becomes a crisis.

## What this is

A digital replication of the neurological follow-up examination, run daily at home. Twenty
exam modules across seven clinical domains, executed by a **21-step session plan** at four
intensities — FULL and RESEARCH run all 21 steps in ~11m35s, STANDARD 18 steps in ~9m45s,
LIGHT 11 steps in ~6m35s, for the days when a patient cannot manage more.

Six of those modules form the **daily core**, and it is those six that fit the 90-second
capture budget:

| | Module | What it measures | NIHSS |
|---|---|---|---|
| **Face** | M1 | Smile symmetry, mouth droop, eye aperture, and the **forehead raise** — the finding that separates a central palsy from Bell's palsy | 4 |
| **Speech** | M4 | Jitter, shimmer, breathiness, maximum phonation time, "pa-ta-ka" rate and *regularity*, pause structure | 10 |
| **Hands** | M7 | Tap rate per hand and the **left/right asymmetry ratio** — the signal that separates a lesion from Parkinson's | — |
| **Attention** | M10 | Reaction time, and above all its **coefficient of variation** | — |
| **Mood** | M13 | PHQ-2 | — |
| **Medication** | M19 | Two-tap adherence | — |

Weekly adds language (M5), arm drift (M6), coordination (M8), memory (M11), fatigue (M14),
rhythm via PPG (M17) and blood pressure (M18). Monthly adds eye movement (M3), gait (M9),
neglect (M12), function (M15) and swallowing (M16).

---

## The idea that makes it usable

Anything that fires when a number crosses a line gets muted within a week. A muted tool
detects nothing, so a false alert does not cost you one notification — it costs you the
product.

An **ALERT** therefore requires two independent things at once:

```
GATE 1  persistence      the same domain deviating across >= 2 consecutive valid sessions
GATE 2  cross-modality   >= 2 INDEPENDENT domains each passing Gate 1
```

Gate 1 kills a bad night's sleep, a cold, a noisy room, one poor capture. Gate 2 kills a
hoarse throat — which moves every speech feature at once and looks dramatic. "Many features
moved" is weak evidence because those features are correlated. "Speech *and* hand movement
moved" is strong evidence, because no single artefact plausibly produces both.

Anything clearing one gate but not both is **WATCH**: recorded, visible to a clinician,
deliberately silent to the family. And an **improving** trajectory never alerts, however
large the deviation — a recovering patient deviates enormously from a baseline taken when
they were worse, and that is success.

Observed on the seeded 21-day run:

```
days  1-15  baseline    recorded, never judged — we have not learned their normal yet
days 16-18  stable      STABLE, zero alerts
day     19  declining   WATCH   speech + hands + face all moved... but only for one session
day     20  declining   ALERT   two consecutive sessions, three independent domains
day     21  declining   ALERT   band persists, but no second notification
```

**One alert for the episode**, not one every morning.

> *"Please check on them today. What changed: one corner of the mouth sat lower than the
> other, and the eyebrows lifted unevenly. These changes have shown up across more than one
> kind of check, on more than one day. Bear in mind: the personal baseline is still close to
> its minimum length."*

---

## On-device, and why that is structural

Feature extraction runs in the browser: MediaPipe FaceMesh for the face, Web Audio DSP for
speech, plain arithmetic for tapping and reaction time. What syncs is a dictionary of
numbers.

This is not a policy we follow carefully — **the server has no endpoint that accepts media.**
There is no upload route for audio, video or images anywhere in the API, and no column in
the schema that could hold them. A deployment mistake cannot leak a recording that was never
sent.

The exam completes in airplane mode. The MediaPipe runtime and model are served from our own
origin and precached by the service worker, so first use offline works; sessions queue in
IndexedDB and drain when signal returns, replayed in capture order because the alert gate is
a function of *consecutive* sessions.

The maths is pinned across the two implementations by
[`parity.test.ts`](frontend/src/lib/ondevice/__tests__/parity.test.ts) against a fixture
generated from the Python side. If they drift, a baseline built on one becomes incomparable
to sessions scored by the other — nothing would crash, and every z-score after would be
quietly wrong.

---

## The safety layer

Three rules, none conditional on any score:

1. **A FAST card renders at the end of every session and on every dashboard.** Always — not
   when the band is high. This system watches slow change over days and *structurally
   cannot see an acute stroke*, which evolves in seconds. The human-recognisable signs have
   to be in front of the family regardless of what we computed.
2. **An acute symptom report bypasses the entire engine.** No baseline lookup, no gates, no
   band, no explanation. It records and escalates.
3. **Nothing may assert wellness.** "You are fine", "all clear", "nothing to worry about" are
   forbidden strings in three languages, enforced by a test that sweeps the shipped source.
   Telling someone they are fine on the morning they are having a stroke is the worst output
   this product could produce.

## The explanation layer

An on-device small language model turns the verdict into two sentences. Its entire input is
`{band, drivers, confounders, language}` — **it never receives a number**, asserted by test.

Every generation is validated before display: it must agree with the engine's band, contain
no diagnostic or wellness language, invent no numbers, and stay within length. Any failure
falls back to a deterministic template that always renders. The engine's verdict cannot be
changed by the model; the worst case is plainer wording.

---

## Repository layout

```
NeuroTraceV1/
├── backend/
│   ├── app/
│   │   ├── engine/        baseline (median+MAD) · deviation (robust z, RCI, CUSUM) · gates · confounders
│   │   ├── exam/          the 20 exam modules, M1-M20
│   │   ├── safety/        FAST card · acute bypass · forbidden-language guards
│   │   ├── slm/           prompt · guardrail · deterministic templates
│   │   ├── ml/            reference extractors (ported verbatim) + train/
│   │   ├── routers/       auth · patients · sessions · clinical_data · dashboard · safety · demo
│   │   └── services/      session_pipeline · seed · synthetic
│   ├── tests/             pytest suite
│   └── tools/             parity-fixture generator
├── frontend/
│   └── src/
│       ├── lib/ondevice/  the on-device extractors + the JS↔Python parity test
│       ├── lib/           api · auth · i18n (EN/HI/PA) · capture · offline queue · speech synthesis
│       ├── components/    FastCard · EmergencyButton · DomainChart · AppShell · ui/
│       └── routes/        Login · CaregiverHome · PatientHome · Exam · Dashboard · Clinic
├── infra/                 render.yaml, deployment env template
└── docs/
    ├── CONTEXT_BRIEF.md   why this is being built and what wins
    ├── PRD.md · TRD.md    product and technical specs (v2)
    ├── DATASETS.md        data and model strategy
    ├── DEVELOPMENT.md     build, run, test, deploy
    ├── DEMO_SCRIPT.md     the 3-minute pitch walkthrough
    └── V1_AUDIT.md        what the Streamlit prototype contributed, honestly
```

---

## Quick start

Requires **Python 3.11**, **Node 18+**, **PostgreSQL 15**.

```bash
git clone https://github.com/prabindersinghh/NeuroTraceV1.git
cd NeuroTraceV1

# backend
cd backend
py -3.11 -m venv .venv && .venv/Scripts/activate    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.lock.txt
cp .env.example .env                                # set JWT_SECRET and DATABASE_URL
alembic upgrade head
python -m app.seed                                  # demo@neurotrace.app / neurotrace-demo
uvicorn app.main:app --reload

# frontend (second terminal)
cd ../frontend
npm install
npm run fetch:mediapipe                             # the on-device face model, ~4 MB
cp .env.example .env.development
npm run dev
```

Open http://localhost:5173 and press **Open the demo**.

No PostgreSQL? The whole backend suite runs on SQLite: `cd backend && pytest`.

Full documentation: **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)**.
Pitch walkthrough: **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)**.

---

## Scope, stated honestly

**In scope.** Anterior-circulation ischemic stroke survivors, ≥3 months post-discharge,
clinically stable, living at home, with residual deficit in at least one of aphasia,
dysarthria, central facial palsy or cognitive slowing. Enrolment is refused below three
months — enforced in one place, `POST /patients`, so no other route can bypass it.

**Explicitly out of scope**, and stated in onboarding and in-app:

- acute stroke of any kind (onset in seconds; our logic works over days)
- posterior circulation strokes
- hemorrhagic stroke
- TIA, silent infarcts, pure motor or pure sensory lacunar strokes

**What we do not claim.** We do not diagnose. We do not detect stroke. We measure specific
findings against a person's own history and report what changed. Every trained model in
`app/ml/train/` publishes its ROC-AUC, sensitivity, specificity, confusion matrix, split
method and a limitations note — `Metrics.save` refuses to write a file without one.

---

## Privacy

- No raw biometric media leaves the device, and the API has no route that would accept it.
- The database has no column capable of holding audio, video or images.
- No PII in logs.
- Secrets from environment only; CORS locked to one configured origin.
- `seed=42` throughout; every clinical computation is deterministic, reproducible and
  auditable, with an audit log of who viewed what.

This is a monitoring aid, not a diagnostic device. It does not detect strokes and does not
replace a clinician. It exists so that somebody notices in time.
