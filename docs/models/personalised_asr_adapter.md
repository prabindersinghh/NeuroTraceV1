# Model card — `personalised_asr_adapter`

**Data: SYNTHETIC FIXTURES**

## Purpose
Per-patient LoRA adapter over a frozen base, for Awaaz.

**Crucially:** Decoding deliberately reduces language-model weight. General ASR fails on dysarthric speech by producing fluent, confident, WRONG output; we want acoustic faithfulness.

## Training data
- Dataset: n/a
- n = n/a  (positive n/a, negative n/a, groups n/a)
- Split: n/a
- Seed: 42

## Limitations

- SYNTHETIC RUN. No harvested audio was present, so the figures below are generated and mean nothing clinically. They demonstrate the pipeline only.
- Trained on one patient's own speech. It is not a general model and must never be evaluated as one.
- The frozen-adapter drift metric assumes the day-30 recordings were representative. A patient already deteriorating at day 30 has a compromised reference, exactly as with the frozen baseline in the monitoring engine.
- Decoding uses a deliberately low language-model weight (0.15). Transcripts will read as less fluent than a general ASR system's, which is the intended trade: fluent-and-wrong is the failure mode this exists to avoid.
- Word error rate on a phrase-board vocabulary is not word error rate on open conversation, and the two must not be compared.

*Generated from `personalised_asr_adapter.metrics.json`. Re-run the training script to update — this card is derived, so it cannot drift from the metrics it describes.*
