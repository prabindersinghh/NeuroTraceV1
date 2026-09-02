# Model card — `voice_dysarthria_clf`

**Data: SYNTHETIC FIXTURES**

<!-- hand-written: purpose -->
## Purpose
Produce ONE advisory feature, `dysarthria_likelihood` in [0,1], as an additional input to the deterministic engine.

**Crucially:** It never decides anything. It is one feature among measured ones, and it passes through the same baseline, gates and confounder handling as everything else.
<!-- end hand-written -->

## Training data
- Dataset: SYNTHETIC FIXTURES (no corpus present)
- n = 240  (positive 120, negative 120, groups 60)
- Split: synthetic, grouped by speaker
- Seed: 42

## Metrics

| Metric | Value |
|---|---|
| ROC-AUC | 0.987 |
| Sensitivity | 0.942 |
| Specificity | 0.942 |
| Precision | 0.942 |
| Accuracy | 0.942 |
| Threshold | 0.50 |

Confusion matrix:

| | predicted + | predicted − |
|---|---|---|
| **actual +** | 113 | 7 |
| **actual −** | 7 | 113 |

> These figures are produced by generated data whose classes are separated by construction. They measure that the pipeline runs, and nothing else. Do not quote them.

## Limitations

- SYNTHETIC RUN. No real corpus was present, so these figures are generated and mean nothing. They demonstrate that the pipeline executes end to end.
- TORGO and UASpeech are English and predominantly cerebral-palsy dysarthria, n < 20 impaired speakers each. Our users are Punjabi- and Hindi-speaking stroke survivors. That population mismatch cannot be trained away.
- The control corpora are read speech recorded in good conditions. A classifier may separate recording conditions rather than pathology.
- The output is ONE feature into a deterministic engine. It never decides.

*Generated from `voice_dysarthria_clf.metrics.json` by `backend/app/ml/train/render_model_cards.py`; re-run the training script, then the renderer, to update. Only the `## Purpose` section above is hand-written — every other line on this page, including each limitation, is rendered from that artifact, and a test re-renders this file and compares it byte for byte. The rendered part cannot drift from the metrics it describes.*
