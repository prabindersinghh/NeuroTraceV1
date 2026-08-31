<div align="center">

# NeuroTrace

**Continuous neurological follow-up for stroke recovery — from a patient's own phone, at home.**

**~3-minute Daily Pulse** for lightweight, frequent tracking · **6–12 minute Comprehensive Sessions**
for deeper neurological follow-up.

NeuroTrace learns what is normal **for one person**, then measures persistent change against that
personal baseline. It reports what changed — never a diagnosis — to families in plain
Hindi, Punjabi or English and to clinicians with the measurements behind the result.

**Raw audio, video and image frames never leave the device.**

</div>

---

## Why NeuroTrace exists

After discharge, stroke recovery is usually observed through **intermittent clinic visits**.
The patient may be assessed thoroughly at one visit and then produce no objective
measurements for weeks.

That creates a simple problem:

> **Recovery is continuous. Follow-up is not.**

NeuroTrace is designed to fill that gap with short, repeatable, home-based measurements.

The system is intentionally built around **trend detection**, not one-off classification.
A patient is not compared with a generic population threshold. The system first learns that
patient's own baseline and then asks:

> **"Is this patient changing from their usual pattern, and is that change persistent and
> supported by more than one independent domain?"**

### Why this matters

- **39–47%** develop post-stroke cognitive impairment
- **~60%** may continue to have aphasia or dysarthria beyond six months
- **11–41%** develop post-stroke depression
- A recurrent stroke can occur after the patient has already returned home

The aim is not to replace the neurologist. It is to make the time **between** neurological
visits measurable.

---

# What NeuroTrace actually is

NeuroTrace is a **digital neurological follow-up system** composed of:

1. **A patient-facing examination** performed on an ordinary smartphone
2. **On-device signal extraction** from the camera, microphone and touch interaction
3. **A personal-baseline engine** that learns the patient's normal range
4. **A deterministic change-detection engine** using robust statistics, RCI and CUSUM
5. **Three clinical-safety gates** that suppress isolated or correlated false signals
6. **A clinician/caregiver dashboard** that shows the trajectory and the measurements behind it
7. **An on-device explanation layer** that turns the machine-readable result into simple language
8. **Optional hardware augmentation**, including the NeuroTrace Balance Belt prototype

The core philosophy is:

> **Measure → compare with personal baseline → look for persistent multi-domain change → report.**

NeuroTrace **does not diagnose**, **does not claim to detect acute stroke**, and **does not replace
clinical judgment**.

---

# The 3-minute vs 12-minute design

These are **not two conflicting claims**. They are two different levels of the same follow-up
system.

### 1. Daily Pulse — ~195s of capture (3–4 minutes wall-clock)

The Daily Pulse is a **rapid longitudinal capture layer**. It samples six high-value, low-friction
signals:

- **Face** — facial symmetry and movement, including forehead raise
- **Speech** — phonation/articulation features and speech regularity
- **Hands** — left/right finger-tapping performance
- **Attention** — reaction time and variability
- **Mood** — PHQ-2
- **Medication** — two-tap adherence

The purpose of this layer is **frequency**: collect a small, repeatable signal often enough to make
a patient's trajectory visible.

### 2. Comprehensive Follow-up — ~6 to 12 minutes

The longer session expands the assessment across the broader neurological examination.

Current session plans support four intensity levels:

| Intensity | Approx. duration | Purpose |
|---|---:|---|
| **FULL** | ~11m35s | Complete 21-step examination |
| **RESEARCH** | ~11m35s | Full protocol instrumentation / validation |
| **STANDARD** | ~9m45s | Reduced burden comprehensive assessment |
| **LIGHT** | ~6m35s | Lower-burden assessment when the patient cannot manage more |

So the product is better understood as:

> **A ~3-minute longitudinal pulse + a deeper 6–12 minute neurological follow-up when the
> workflow calls for it.**

The app does not have to force a full 12-minute examination every time. The intensity and
clinical workflow determine how much of the examination is performed.

---

# The 7 clinical domains

The comprehensive examination is organized around seven domains.

| Domain | Examples of NeuroTrace measurements |
|---|---|
| **A · Cranial nerves** | Facial movement, forehead raise, eye closure, cheek puff, tongue/palate, saccades, pursuit, gaze hold |
| **B · Speech & language** | Sustained phonation, /a/, pa-ta-ka, sentence production, naming, repetition, comprehension, fluency, picture description |
| **C · Motor** | Pronator drift, finger tapping, left/right asymmetry |
| **D · Coordination & gait** | Finger-nose, rapid alternating movements, Romberg, tandem stance, tandem walk, Unterberger |
| **E · Cognition** | Attention/reaction, memory/executive function, neglect |
| **F · Mood & function** | PHQ-2/9, fatigue, Barthel/mRS, EAT-10, DHI, vertigo log |
| **G · Vitals & adjuncts** | Camera PPG rhythm, blood pressure, medication adherence, SVV, hearing |

### Why the exam is multi-domain

A neurological change can express itself in very different ways.

A patient may have:

- normal gross movement but worsening speech,
- normal finger-nose testing but worsening balance,
- preserved walking but slower cognition,
- subtle facial asymmetry that is easier to quantify than to notice,
- or a combination of small changes that becomes important only when viewed together.

NeuroTrace therefore does **not** make one signal responsible for the whole decision.

---

# Personal baseline: the central idea

NeuroTrace does not ask:

> "Is this value abnormal for the average person?"

It asks:

> **"Is this value meaningfully different from this patient's own normal?"**

### Baseline protocol

A patient's reference period is designed around:

- **14–21 days** of baseline collection
- **≥3 sessions/week**
- first **3 sessions discarded** for learning effects
- a fixed time-of-day window of approximately **±2 hours**
- quality-gated, identity-verified sessions only
- independent baselines by module/feature
- baseline lock at **n ≥ 12 valid observations**
- a **frozen historical reference** retained so slow deterioration is not permanently absorbed
  into a moving baseline

### Robust statistics

NeuroTrace uses a median/MAD baseline rather than mean/standard deviation because the baseline
is small and must be robust to occasional outliers.

For an observation `x`:

```text
robust_z = 0.6745 × (x − median) / MAD
```

Feature-level change is combined into modality-level deviation, with RCI and CUSUM used to
reason about persistent change.

Current CUSUM parameters:

```text
k = 0.5
h = 4.0
```

The important point is architectural:

> **The change detector is deterministic and auditable. The language model is not allowed to
> decide whether a patient changed.**

---

# Three-gate decision engine

A single bad session should not turn into a family alarm.

NeuroTrace therefore uses three gates.

### Gate 1 — Persistence

The same domain must remain meaningfully deviated across **at least two consecutive valid
sessions**.

This suppresses transient noise such as poor sleep, a cold, one noisy capture or one weak
performance.

### Gate 2 — Cross-modality agreement

At least **two independent clinical domains** must agree.

This is stronger than counting many features inside one modality. For example, a sore throat can
move many speech features at once. That is still one domain. A simultaneous speech change and
hand-motor change is a more useful cross-domain signal.

### Gate 3 — Laterality

At least one **lateralised domain** is required for the standard neurological change alert.

This protects against symmetric deterioration being treated as a focal unilateral neurological
pattern.

### Output bands

```text
STABLE
WATCH
ALERT
PATTERN_ATYPICAL
```

**WATCH** means the system has observed a meaningful signal but has not met the complete alert
criteria.

**ALERT** represents persistent, cross-domain change meeting the configured gates.

**PATTERN_ATYPICAL** is used for a symmetric pattern that does not fit the expected focal,
one-sided trajectory. This does not diagnose another disease; it tells the clinician that the
pattern is atypical and deserves review.

### Important recovery rule

An improving patient may differ dramatically from an early baseline.

That is **not a reason to alert**.

The system is therefore directional: recovery should not be punished simply because the patient
has changed from a previously worse state.

---

# A real patient changed the product

The posterior-circulation scope was expanded after an anonymised, consented reference case.

The patient had:

- a prior stroke with speech difficulty and right-limb weakness
- recurrent vertigo
- worsening unsteadiness
- bilateral hearing loss
- abnormal balance findings
- abnormal saccade and vestibular measurements

The critical observation was:

> **Finger-nose, heel-knee-shin, dysdiadochokinesia and joint-position testing were all normal.**

Yet the patient's balance, ocular and vestibular measurements were abnormal.

That exposed a design failure: a system that focused too heavily on classic cerebellar
coordination could have produced a false negative.

The product was therefore expanded to give greater weight to:

- **oculomotor measurements**
- **posterior-vestibular measurements**
- **balance**
- **symptom burden**
- **DHI / vertigo tracking**
- **laterality from saccade asymmetry rather than angular deviation**

This is one of the most important design principles of NeuroTrace:

> **The examination evolves from real clinical findings, not from an arbitrary list of AI features.**

---

# Safety is independent of the AI score

NeuroTrace deliberately separates **slow change monitoring** from **acute emergency recognition**.

### FAST card — always

A FAST card appears at the end of every session and on dashboards.

It does not wait for an AI alert.

Why?

Because NeuroTrace is designed around **change over days**, while an acute stroke can evolve
over seconds. The monitoring engine is structurally not the right mechanism for detecting that
event.

### Acute symptom bypass

If an acute symptom is reported:

```text
acute symptom
      ↓
bypass baseline
      ↓
bypass gates
      ↓
bypass SLM explanation
      ↓
record + escalate
```

There is no "wait for the model."

### No false reassurance

The system explicitly forbids phrases such as:

- "You are fine"
- "All clear"
- "Nothing to worry about"

This is enforced in the product rather than left to an author's judgment.

---

# On-device by architecture, not by promise

Privacy is not merely a policy statement.

### What runs on the phone

- Face landmark extraction
- Speech feature extraction
- Touch/reaction measurements
- Balance/pose processing where applicable
- Baseline-compatible feature computation
- Local explanation generation

### What reaches the backend

**Numbers and structured events — not recordings.**

The backend has no route designed to accept raw audio, video or image media, and the schema does
not provide a place to store such recordings.

### Offline operation

The PWA can:

- run the examination in airplane mode,
- use precached on-device models,
- queue completed sessions locally in IndexedDB,
- synchronize later when connectivity returns.

Sessions are drained in capture order because the persistence gate depends on the order of
consecutive valid sessions.

---

# The explanation layer

NeuroTrace uses a small language model **only for wording**.

Its input is intentionally limited to:

```text
{band, drivers, confounders, language}
```

It does **not** receive raw recordings and does not receive the underlying numeric feature values
needed to change the decision.

Before display, generated text is checked for:

- agreement with the engine band,
- forbidden diagnostic language,
- forbidden wellness/reassurance language,
- invented numbers,
- length constraints.

If the generated explanation fails validation, NeuroTrace falls back to a deterministic
template.

Therefore:

> **The language model can make the explanation simpler. It cannot make the clinical decision.**

---

# NeuroTrace Balance Belt — hardware augmentation

The software-first system can be extended with a low-cost body-worn balance sensor.

### What it is

A belt-mounted sensor pod worn snugly around the lower back near **L4/L5**.

Prototype architecture:

```text
MPU-6050 / future IMU
       ↓
     ESP32
       ↓ BLE
   Patient phone
       ↓
NeuroTrace M9 / balance engine
```

The belt streams raw acceleration and rotation data. The phone remains the source of truth for
clinical calculations.

### Target measurements

- Sway path
- Sway area
- Angular deviation
- Displacement
- Lateral sway
- Body-axis spin
- Time held / step-off count
- Romberg ratio

### Why add hardware?

Phone-camera balance estimation can be affected by:

- camera placement
- lighting
- clothing
- distance
- field of view

An IMU mounted on the body measures movement directly and in three dimensions.

### Safety role

The belt can also provide **local haptic feedback** when tilt crosses a safety threshold during
balance tasks.

That haptic alert is a **fall-risk safety aid**, not a clinical diagnosis.

### Prototype bill of materials

| Component | Prototype role |
|---|---|
| ESP32 | BLE + real-time sensor streaming |
| MPU-6050 / BNO055 path | 6-axis motion sensing / sensor fusion option |
| 500–1000mAh LiPo | Portable power |
| TP4056 | Charging |
| Coin vibration motor | Haptic warning |
| Pushbutton | Start/stop marker |
| Elastic belt + enclosure | L4/L5 body mounting |

The current design target is approximately **₹850–₹1,300** for a single prototype, with a future
production design expected to use a more suitable sensor and enclosure.

### Hardware validation rule

The belt is a **prototype / concept demonstration**.

It must not be presented as:

- a certified medical device,
- a replacement for a human spotter,
- clinically validated craniocorpography,
- or a device that diagnoses neurological disease.

Before patient use, the prototype must pass:

1. static sensor checks,
2. known-angle motion checks,
3. healthy-volunteer balance tests,
4. safety-threshold tuning,
5. supervised evaluation of fall-risk tasks.

---

# Product tiers

NeuroTrace is designed to scale without making specialist hardware mandatory.

| Tier | Hardware | Purpose |
|---|---|---|
| **Tier 1 — Phone** | Smartphone only | Lowest-cost home follow-up |
| **Tier 2 — Watch** | Phone + compatible wearable | Passive HR/sleep/fall/ECG capabilities where available |
| **Tier 3 — ASHA** | Shared tablet + BP cuff + oximeter and related kit | Community-worker supported follow-up |

A community model can use an ASHA-worker kit rather than requiring every household to purchase
specialist hardware.

---

# Who NeuroTrace is designed for

### Current intended population

- ≥3 months post-discharge
- clinically stable
- living at home
- caregiver available where supervision is required
- residual deficit in at least one monitored neurological domain
- primarily designed around ischemic stroke recovery
- both anterior- and posterior-circulation ischemic patterns are considered in the current
  clinical scope

### Explicitly out of scope

- acute stroke of any type
- hemorrhagic stroke in the current product scope
- TIA
- silent infarcts
- pure motor / pure sensory lacunar presentations outside the defined monitored pathway

This boundary is intentional.

> **NeuroTrace is a follow-up and change-monitoring system, not a universal stroke detector.**

---

# What NeuroTrace does NOT claim

NeuroTrace does not claim to:

- diagnose stroke,
- diagnose Parkinson's disease,
- diagnose Bell's palsy,
- replace a neurologist,
- classify acute neurological emergencies from a slow longitudinal score,
- or provide clinical accuracy figures from synthetic training data.

The system measures specific findings, tracks them against the patient's own history and surfaces
persistent change for appropriate clinical review.

---

# Current implementation status

### Built and tested

- Baseline engine
- Robust deviation / RCI / CUSUM
- Three-gate logic
- Pattern-atypical pathway
- Posterior-circulation logic
- Balance / ocular / SVV pathways
- Tier logic
- ASHA pathway
- Wearable/hardware interfaces
- Onboarding
- Clinician report
- Caregiver flows
- Offline queue
- Accessibility
- Safety and FAST surfaces
- Deployment stack

### Important validation status

The project currently has **805 automated tests passing** across the implemented system.

However:

- the full computer-vision stack has **not yet been validated on a physical target phone**;
- the five current ML components are **synthetic / training-stage models**;
- synthetic model metrics must not be represented as clinical performance;
- the Balance Belt is still a prototype and requires hardware validation.

We publish these limitations deliberately.

---

# Demo architecture

A strong NeuroTrace demonstration follows the same logic as the product.

### Beat 1 — Offline

Put the phone into airplane mode.

The examination still runs because the critical capture and feature extraction layers are on
device.

### Beat 2 — Measurement

Show a live neurological task:

- facial movement,
- speech,
- tapping,
- reaction time,
- or balance.

### Beat 3 — Personal baseline

Show the patient's trajectory rather than a single score.

### Beat 4 — Gates

Demonstrate why:

```text
one bad session ≠ alert

one domain ≠ alert

persistent + independent + lateralised pattern → clinical follow-up signal
```

### Beat 5 — Explanation

Show the plain-language explanation without allowing the language model to change the engine
decision.

### Beat 6 — Emergency boundary

Show the FAST card and make the distinction explicit:

> **NeuroTrace monitors recovery. It is not the mechanism for diagnosing an acute stroke.**

---

# Technical architecture

```text
                    PATIENT DEVICE
┌─────────────────────────────────────────────────────┐
│                 NeuroTrace PWA                      │
│                                                     │
│  Camera ────────→ Face / Pose extraction            │
│  Microphone ────→ Speech DSP                        │
│  Touch ─────────→ Reaction / tapping                │
│  Optional IMU ──→ Balance / sway stream              │
│                                                     │
│              ↓ structured features only              │
│                                                     │
│       Personal Baseline + Change Engine             │
│       Median/MAD · RCI · CUSUM · Gates              │
│                                                     │
│              ↓ band + drivers + confounders          │
│                                                     │
│       On-device SLM / deterministic fallback         │
└─────────────────────────────────────────────────────┘
                         │
                         │ structured clinical events
                         ↓
┌─────────────────────────────────────────────────────┐
│                     Backend                         │
│  FastAPI · Auth/Roles · PostgreSQL · Audit Trail   │
│  Clinician / Caregiver / Patient workflows         │
└─────────────────────────────────────────────────────┘
```

### Technology stack

**Frontend**
- React 18
- Vite
- TypeScript
- Tailwind
- shadcn/ui
- Recharts
- PWA / service worker

**On-device**
- MediaPipe FaceMesh
- MediaPipe PoseLandmarker
- Web Audio DSP
- Camera PPG
- WebAssembly / SIMD fallback where applicable

**Backend**
- FastAPI
- Python 3.11
- SQLAlchemy 2.x
- Alembic
- JWT roles

**Data**
- PostgreSQL / Neon
- structured clinical events
- audit logging
- no raw biometric media storage

**Language layer**
- small on-device language model
- explanation-only
- guardrailed against band changes, diagnosis and fabricated numbers

---

# Repository layout

```text
NeuroTraceV1/
├── backend/
│   ├── app/
│   │   ├── engine/        baseline · robust deviation · RCI · CUSUM · gates · confounders
│   │   ├── exam/          neurological exam modules and session orchestration
│   │   ├── safety/        FAST · acute bypass · forbidden-language guards
│   │   ├── slm/           prompts · guardrails · deterministic templates
│   │   ├── ml/            reference extractors + training-stage models
│   │   ├── routers/       auth · patients · sessions · dashboards · clinical data · safety
│   │   └── services/      session pipeline · seed · synthetic fixtures
│   ├── tests/             backend test suite
│   └── tools/             parity-fixture generation
├── frontend/
│   └── src/
│       ├── lib/ondevice/  on-device extractors + JS↔Python parity tests
│       ├── lib/           API · auth · i18n · capture · offline queue · speech
│       ├── components/    FastCard · EmergencyButton · charts · app shell
│       └── routes/        Login · Patient · Caregiver · Exam · Dashboard · Clinic
└── docs/
    ├── CONTEXT_BRIEF.md
    ├── PRD.md
    ├── TRD.md
    ├── DATASETS.md
    ├── DEVELOPMENT.md
    ├── DEMO_SCRIPT.md
    └── DEPLOY.md
```

---

# Try the live prototype

**Live:** https://neuro-trace-v1.vercel.app

**API:** https://neurotracev1-production.up.railway.app

| Role | Email | Password |
|---|---|---|
| Clinician | `clinician@neurotrace.app` | `neurotrace-demo` |
| Caregiver | `demo@neurotrace.app` | `neurotrace-demo` |
| Patient | `ramesh@neurotrace.app` | `neurotrace-demo` |
| Admin | `admin@neurotrace.app` | `neurotrace-demo` |

**The first screen asks for a language** — English, हिंदी or ਪੰਜਾਬੀ. It appears once, before
sign-in, and the whole signed-in app follows that choice. Pick Punjabi to see the product as
the target household would. (This page itself is English only; see *Limits* below.)

These are **demonstration accounts on demonstration data**. There is no real patient record in
the demo environment. Passwords are the seeded defaults and are overridden by `DEMO_PASSWORD`
on any instance where that is set — on a deployment carrying real patients, `DEMO_MODE=false`
is the control that matters, not the password.

The clinician view contains a seeded longitudinal story showing baseline, drift, persistence,
cross-domain agreement and alert gating. The seed links the demo clinician to the demo patient
and grants the sharing consent, because access requires **both** an active link and current
consent — without them the roster is empty, which is exactly what it was until 2026-08-31.

The admin view exposes operational counts and events rather than patient clinical records.

---

# Quick start

Requires **Python 3.11**, **Node 18+**, **PostgreSQL 15**.

```bash
git clone https://github.com/prabindersinghh/NeuroTraceV1.git
cd NeuroTraceV1

# backend
cd backend
py -3.11 -m venv .venv && .venv/Scripts/activate    # macOS/Linux: source .venv/bin/activate
pip install -r requirements.lock.txt
cp .env.example .env
# configure JWT_SECRET and DATABASE_URL
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload

# frontend (second terminal)
cd ../frontend
npm install
npm run fetch:mediapipe
cp .env.example .env.development
npm run dev
```

Open:

```text
http://localhost:5173
```

No PostgreSQL? The backend test suite can run against SQLite:

```bash
cd backend
pytest
```

---

# Design principles

### 1. Personal baseline over population threshold

The patient's own history is the reference whenever the signal permits it.

### 2. Persistence over single observations

One noisy session should not create an alarm.

### 3. Independent domains over feature counting

Correlated features should not be mistaken for independent evidence.

### 4. Measurement over diagnosis

The product reports observed change and leaves diagnosis to clinicians.

### 5. Safety outside the model

FAST and acute-symptom escalation must not depend on an AI score.

### 6. Privacy by architecture

Raw biometric media is processed locally and is not an API payload.

### 7. Deterministic decision path

The alert engine remains auditable and testable.

### 8. Transparent limitations

Synthetic ML, unvalidated camera measurements and prototype hardware are labelled as such.

---

# Final statement

NeuroTrace is built around a simple shift:

> **Instead of asking only what a patient looks like at the next hospital visit, measure how that
> patient is changing between visits.**

The goal is not to turn a phone into a neurologist.

The goal is to make **longitudinal neurological recovery measurable, private, repeatable and
clinically reviewable at home.**

**NeuroTrace measures. It does not diagnose.**
