# ML_STATUS

One table. Every model. One column that says REAL DATA or SYNTHETIC, with no ambiguity.

We will be asked this, and the honest answer is better than a good-looking one. Paraspeak
published their word error rate and won on it.

**Last verified:** 2026-08-31, including the Awaaz archive, single-patient corpus-readiness,
multi-patient cohort-readiness boundaries, and the untrained ASR training runtime.
The face identity check was added the same day and is listed here for the same reason
everything else is: it makes a decision about a patient off a threshold, and the threshold
is not calibrated on real data.

---

## Status

| Model | Data | ROC-AUC | Purpose | Blocks on |
|---|---|---|---|---|
| `voice_dysarthria_clf` | **SYNTHETIC** | 0.987 (meaningless) | one advisory feature into the engine | TORGO + UASpeech access |
| `rhythm_irregularity_clf` | **SYNTHETIC** | 0.973 (meaningless) | "get an ECG" advisory | PhysioNet AF — **openly downloadable, no excuse** |
| `asymmetry_discriminator` | **SYNTHETIC** | 0.976 (meaningless) | the empirical basis for Gate 3 | mPower — **publicly available after certification** |
| `personalised_asr_adapter` | **SYNTHETIC SCAFFOLD** | — | future per-patient Awaaz ASR | governance receipt issuance; local base-model weights and a GPU runtime; held-out evaluation; human-listener intelligibility; deployment approval |
| `voice_clone` | **SYNTHETIC** | — | family-archive voice for Awaaz | a consented 2-minute clip |
| `face_identity` (not a model — a threshold) | **SYNTHETIC CALIBRATION** | — | same-person check; flags a session as a confounder | enrolment pairs from real households |

**Every model is currently synthetic.** The AUCs above are produced by generated data whose
classes were separated by construction; they measure nothing except that the pipeline runs
end to end. Every metrics file carries `"synthetic": true` or a limitations note beginning
`SYNTHETIC RUN`, so no artefact can be mistaken for evidence.

The personalised-ASR command previously inferred `synthetic = false` from the mere
existence of a data directory while still generating synthetic pairs. That path is removed.
It now accepts a user-exported Awaaz tar only to validate member paths, schema, UUID
associations, size bounds, RIFF/WAVE headers and SHA-256, then exits without writing an
adapter or metrics.

A real LoRA/PEFT training runtime for MMS / Wav2Vec2 CTC now exists at
`backend/app/ml/train/asr_runtime/`, and its existence changes nothing in the table above.
The runtime is executable and fail-closed; it has never been run against patient data and no
adapter, WER, or intelligibility number exists for Awaaz ASR anywhere in this repository.
Its synthetic dry-run writes a private manifest and no model and no clinical metric — the
output directory contains exactly `manifest.json`. A real run additionally requires a
consented archive, local base-model weights, a signed purpose-specific governance receipt, a
GPU host, and a held-out human intelligibility evaluation, none of which exist here. The
blocker is therefore governance and evaluation, not missing code, and no real-data claim is
possible until a governed run has happened and been independently reviewed.
The separate `awaaz_corpus_readiness` command may write aggregate counts and deterministic
phrase-disjoint capture-ID assignments. Its claim flags remain false because planning a
split is not training or evaluation. The `awaaz_cohort_readiness` command extends that
boundary across separately verified patient archives: it assigns whole connected
speaker/phrase components, blocks when shared board prompts leave fewer than three clean
components, and discloses neither patient identity nor phrase text. It does not pool media,
and the local export receipt does not establish consent for a pooled study.

### The identity check is not a model, and is listed anyway

`face_identity` is six ratios between bone-structure landmarks compared to an enrolment
vector — no network, no training, no artefact. It appears in this table because it does the
thing this document exists to police: it makes a call about a patient from a number
(`VERIFY_THRESHOLD = 0.45`, `z / 12` scaling) that was set against **synthetic geometry
only** — a same-person case, a facial-weakness case and a clearly-different-face case in
`identity.test.ts`. The separation between "same person in worse light" and "different
person" in the field is unmeasured.

Its blocker is internal rather than a dataset request: enrolment pairs from real households
and a look at how often the flag fires in the pilot. Until then it errs deliberately loose,
because the cheap error is letting a session through unflagged and the expensive one is
accusing a patient. It flags, never blocks — so a miscalibration costs a confounder, not a
locked-out survivor. D-015, D-017.

### Two of these have no external blocker

`rhythm_irregularity_clf` needs PhysioNet AF 2017 — open, ODC-BY, one `curl` away
(`./scripts/download_datasets.sh physionet`). `asymmetry_discriminator` needs mPower, which
requires a Synapse account and a short certification quiz but no human approval. Both are
downloadable today. Only TORGO and UASpeech carry real calendar lead time.

**`asymmetry_discriminator` is the highest priority.** It is the empirical basis for Gate 3.
At present Gate 3 rests on an anatomical argument — stroke is focal, Parkinson's is
symmetric — which is correct but unquantified. Real mPower data turns it into a confusion
matrix, and that is the difference between a claim a clinical reviewer accepts and one they
probe.

---

## Verification against Part 5

| # | Check | Result |
|---|---|---|
| 1 | `voice_dysarthria_clf` synthetic, stated | ✅ metrics note leads `SYNTHETIC RUN` |
| 2 | `rhythm_irregularity_clf` real or stated | ✅ synthetic, stated; PhysioNet obtainable |
| 3 | `asymmetry_discriminator` real-data priority | ✅ named highest priority; mPower is public |
| 4 | JS↔Python feature parity | ✅ `parity.test.ts`, relative tolerance 1e-9 |
| 5 | FPS honesty in saccade velocity | ✅ sample below |
| 6 | SLM guardrail: band match, forbidden tokens, fallback | ✅ 71 tests in `test_safety_slm.py` |
| 7 | Identity threshold declared synthetic wherever it appears | ✅ source comment, this table, D-017 |

### 5 · FPS honesty — sample output

```
--- 30 fps (phone default) ---            --- 120 fps (slow-motion) ---
  capture_fps                30             capture_fps               120
  frame_interval_ms        33.3             frame_interval_ms         8.3
  saccade_latency_mean    200 ms            saccade_latency_mean    200 ms
  saccade_latency_res    ±33 ms             saccade_latency_res      ±8 ms
  saccade_frames_median       2             saccade_frames_median       8
  velocity_confidence      0.00             velocity_confidence      1.00
  velocity_undersampled    True             velocity_undersampled   False
```

At 30 fps the caveat reads, verbatim:

> Captured at 30 fps (frame every 33 ms). A saccade lasts 30–80 ms and spanned ~2 frame(s)
> here, so peak velocity is averaged across the movement and **UNDERSTATES** the true peak.
> Latency is resolved only to ±33 ms. Trend this patient against their own earlier captures
> at the same frame rate; do not compare it to published normative velocities.

It names the *direction* of the error. "Less accurate" would let a reader take a low velocity
for pathology when it is sampling.

### 4 · Parity — why it is an invariant

The PWA extracts features on the phone; the backend holds the authoritative implementation
and runs it when raw signal is available to it. A patient's baseline is built from whichever
side ran on each day. If the two drift, the baseline stops being comparable to later
sessions, every subsequent z-score is quietly wrong, **nothing crashes and no other test
fails**. That silent-but-confident failure mode is why parity is pinned rather than trusted.

---

## Model cards

One per model in `docs/models/`. Each states purpose, training data with n and source, split
method, metrics, limitations, and — plainly — whether it runs on synthetic fixtures or real
data.

The cards are rendered from `app/ml/train/artifacts/*.metrics.json` by
`python -m app.ml.train.render_model_cards`, so every number, split description and
limitation in them comes from the artifact rather than from a person's memory of it. The one
exception is the `## Purpose` section, which is hand-written and carried through untouched
between `<!-- hand-written: purpose -->` markers; a card missing those markers fails closed
rather than being silently regenerated without its prose. `--check` exits 1 on a stale card,
and a test re-renders each card and compares it byte-for-byte, so the generated portion
cannot drift from the artifact. The Purpose prose can still drift, because nothing generates
it.

The training harness refuses to write a metrics file with an empty limitations list. An
unqualified number is the thing this project exists not to produce.
