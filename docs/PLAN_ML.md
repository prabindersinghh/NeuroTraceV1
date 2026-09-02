# PLAN_ML — models, datasets, and the training pipeline

**Status: PLANNED — synthetic-fixture path building now, real datasets require access.**

Everything lives in `backend/app/ml/train/`, seed = 42, reproducible.

---

## The rule every model in here obeys

**A model output is a FEATURE, never a decision.**

The deterministic engine decides. A model contributes at most one number to it, alongside
measured features, and that number goes through the same baseline, the same gates and the
same confounder handling as everything else. No model can raise an alert on its own, and
no model's output is ever shown to a family as a finding.

The reason is not modesty. These models are trained on populations that do not match ours —
English dysarthric speakers, American AF patients, largely white cohorts — and the honest
thing to do with a classifier whose training set does not contain your user is to let it
whisper, not vote.

---

## Models

### 1. `voice_dysarthria_clf`
**Data:** TORGO + UASpeech (impaired) vs LibriSpeech + Common Voice hi/pa (healthy).
**Model:** XGBoost or logistic regression over *our own* extracted speech features — the
same `M4` features the engine already computes, so nothing new has to be captured.
**Output:** `dysarthria_likelihood` ∈ [0,1], as **one additional feature**.
**Limitation to publish:** TORGO and UASpeech are English, mostly cerebral-palsy dysarthria,
n < 20 speakers each. Our users are Punjabi- and Hindi-speaking stroke survivors. This is a
population mismatch we cannot train away, and the model card must say so in those words.

### 2. `rhythm_irregularity_clf`
**Data:** PhysioNet AF Challenge 2017.
**Model:** threshold / logistic regression on an RR-irregularity index.
**Output:** *"An irregular rhythm was detected. Please get an ECG."*
**Never:** *"You have atrial fibrillation."* AF is diagnosed on an ECG by a clinician. A
wrist optical sensor and a logistic regression are not that, and saying otherwise would be
both wrong and, for a stroke survivor, frightening in a specific and useless way.

### 3. `asymmetry_discriminator`
**Data:** mPower (Parkinson's, bilateral) vs our stroke asymmetry logic.
**Purpose:** empirically demonstrate that `asymmetry_ratio` separates PD from stroke.
**This is the evidence behind Gate 3.** Gate 3 currently rests on an anatomical argument —
stroke is focal, Parkinson's is symmetric — which is correct but unquantified. This model
turns it into a number with a confusion matrix.

### 4. `personalised_asr_adapter`
LoRA fine-tuning per patient from harvested pairs (Awaaz D4). Few million parameters,
intended to train nightly and ship back for on-device inference. **Current executable status:
an untrained runtime.** `app/ml/train/asr_runtime/` implements real LoRA/PEFT fine-tuning of
an MMS / Wav2Vec2 CTC base, and it has produced nothing: no adapter, no WER, no
intelligibility number. A strict importer verifies the versioned local tar without
extraction, and the legacy `personalised_asr_adapter` command still refuses to write an
adapter or non-synthetic metrics. The runtime is unreachable without a signed
purpose-specific governance receipt, local base-model weights, and a GPU host, and its
synthetic dry-run writes a private manifest and no model and no clinical metric. Held-out
evaluation, human-listener intelligibility, and deployment approval remain prerequisites,
and they are now the whole of the blocker — the missing piece is governance and evidence,
not code.

The verified archive can be checked for experimental readiness without exposing its
contents:

```bash
python -m app.ml.train.awaaz_evaluation_plan \
  --archive /authorised/path/awaaz-training.tar \
  --out /authorised/path/awaaz-corpus-readiness.json
```

This creates an owner-readable planning artifact, not metrics. Fifty pairs and ten exact
Unicode-normalised phrase groups are the hard gates for a deterministic 70/15/15
phrase-disjoint plan at seed 42; 200 pairs remains a non-hard pilot target. The JSON contains
aggregate counts and, when ready, capture UUID assignments, but no patient ID, transcript,
audio, or audio hash. It explicitly records that a one-patient archive cannot support
speaker-disjoint shared-model evaluation and that human listener intelligibility has not
been measured.

A separately approved shared-model study can check whether multiple local archives permit
both speaker- and exact-phrase-disjoint evaluation without pooling or extracting them:

```bash
python -m app.ml.train.awaaz_cohort_plan \
  --archive /authorised/path/patient-1.tar \
  --archive /authorised/path/patient-2.tar \
  --archive /authorised/path/patient-3.tar \
  --out /authorised/path/awaaz-cohort-readiness.json
```

Every speaker is a whole assignment unit. If two speakers use the same phrase in the same
language after Unicode normalization, they are joined into the same indivisible component;
this prevents the shared board prompt from appearing on both sides of evaluation. Three
speakers are therefore not automatically three clean splits. If shared prompts leave fewer
than three independent components, the command emits an aggregate blocker with no capture
IDs instead of inventing a leakage-safe result. A ready artifact contains capture-ID
assignments but no patient IDs, phrases, audio, or hashes. It still performs no pooling,
training, evaluation, or clinical measurement, and local export consent is not pooled-study
consent.
**Keep the day-30 adapter permanently** — the frozen-reference trick (D-013) applied to a
model. If speech scores worse against the *frozen* adapter while the live one compensates
perfectly, that is objective deterioration.

### 5. `voice_clone`
XTTS-v2 / Indic TTS fine-tune from a 2-minute family archive clip. Sarvam evaluated for
Indic quality.

---

## Every model ships with

1. **`metrics.json`** — ROC-AUC, sensitivity, specificity, confusion matrix, n, split method.
2. **A plain-text limitations note** — language mismatch, population mismatch, small n.
   A metrics file without one is treated as an incomplete run and the training script fails.
3. **A model card** — what it does, what it must never be used for, who it was trained on.

Paraspeak published their word error rate and won on it. We publish ours.

---

## Datasets — what to request, and where to put it

| Dataset | Access | Target path |
|---|---|---|
| **TORGO** | Free, request by email to U. Toronto | `data/raw/torgo/` |
| **UASpeech** | Request form, Univ. of Illinois; licence agreement required | `data/raw/uaspeech/` |
| **LibriSpeech** | Open, direct download (`train-clean-100`) | `data/raw/librispeech/` |
| **Common Voice hi/pa** | Open, Mozilla, CC0 | `data/raw/commonvoice/{hi,pa}/` |
| **PhysioNet AF 2017** | Open, ODC-BY | `data/raw/physionet_af2017/` |
| **mPower** | Synapse account + data-use certification | `data/raw/mpower/` |

**Requires a formal request:** UASpeech (licence agreement), mPower (Synapse DUC), TORGO
(email). Start those first — they take days to weeks.
**Open, downloadable today:** LibriSpeech, Common Voice, PhysioNet AF.

`scripts/download_datasets.sh` carries the exact commands and target paths.
`data/README.md` records source, licence and consent status for each — judges will ask.

---

## Synthetic fixtures

Every training script runs end-to-end **before any real dataset is downloaded**, against
generated fixtures with the same shape. This is not a substitute for real data and the
resulting metrics are meaningless — the point is that the pipeline is exercised, the
artefacts are produced, and a missing dataset is a data problem rather than a code problem.

Scripts emit `"synthetic": true` in `metrics.json` so a synthetic run can never be mistaken
for a real one.

For `personalised_asr_adapter`, an archive or directory merely existing is never evidence
that training happened. Real-archive mode validates and fails closed; the synthetic mode is
the only mode that writes the current demonstration metrics.
