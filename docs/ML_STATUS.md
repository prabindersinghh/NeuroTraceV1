# ML_STATUS

One table. Every model. One column that says REAL DATA or SYNTHETIC, with no ambiguity.

We will be asked this, and the honest answer is better than a good-looking one. Paraspeak
published their word error rate and won on it.

**Last verified:** August 2026, by running every pipeline and reading its metrics file.

---

## Status

| Model | Data | ROC-AUC | Purpose | Blocks on |
|---|---|---|---|---|
| `voice_dysarthria_clf` | **SYNTHETIC** | 0.987 (meaningless) | one advisory feature into the engine | TORGO + UASpeech access |
| `rhythm_irregularity_clf` | **SYNTHETIC** | 0.973 (meaningless) | "get an ECG" advisory | PhysioNet AF — **openly downloadable, no excuse** |
| `asymmetry_discriminator` | **SYNTHETIC** | 0.976 (meaningless) | the empirical basis for Gate 3 | mPower — **publicly available after certification** |
| `personalised_asr_adapter` | **SYNTHETIC** | — | per-patient Awaaz ASR | harvested pairs from a real patient |
| `voice_clone` | **SYNTHETIC** | — | family-archive voice for Awaaz | a consented 2-minute clip |

**Every model is currently synthetic.** The AUCs above are produced by generated data whose
classes were separated by construction; they measure nothing except that the pipeline runs
end to end. Every metrics file carries `"synthetic": true` or a limitations note beginning
`SYNTHETIC RUN`, so no artefact can be mistaken for evidence.

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

The training harness refuses to write a metrics file with an empty limitations list. An
unqualified number is the thing this project exists not to produce.
