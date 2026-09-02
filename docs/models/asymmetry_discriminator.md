# Model card — `asymmetry_discriminator`

**Data: SYNTHETIC FIXTURES**

<!-- hand-written: purpose -->
## Purpose
Demonstrate empirically that our asymmetry ratio separates Parkinson's (bilateral) from stroke (lateralised).

**Crucially:** This is the evidence behind Gate 3. Without real data, Gate 3 rests on an anatomical argument that is correct but unquantified.
<!-- end hand-written -->

## Training data
- Dataset: synthetic cohort (rate-matched)
- n = 240  (positive 120, negative 120, groups 240)
- Split: held-out threshold sweep on a rate-matched synthetic cohort
- Seed: 42

## Metrics

| Metric | Value |
|---|---|
| ROC-AUC | 0.976 |
| Sensitivity | 0.900 |
| Specificity | 0.942 |
| Precision | 0.939 |
| Accuracy | 0.921 |
| Threshold | 0.29 |

Confusion matrix:

| | predicted + | predicted − |
|---|---|---|
| **actual +** | 108 | 12 |
| **actual −** | 7 | 113 |

> These figures are produced by generated data whose classes are separated by construction. They measure that the pipeline runs, and nothing else. Do not quote them.

## Limitations

- The default cohort is simulated. It demonstrates that the asymmetry ratio separates two groups that tap rate cannot, but it is not clinical evidence.
- The two groups are rate-matched by construction. Real Parkinson's patients are often slower overall, which would make rate look better than it deserves.
- The bilateral group carries normal handedness asymmetry, and the mildest simulated lesions overlap that distribution - which is why separation is strong but not perfect, and why the deployed system compares each patient against their own baseline asymmetry rather than against zero.
- mPower alone cannot validate a Parkinson's-vs-stroke claim. The --mpower path verifies normalised records and then fails closed until a preregistered comparison against a separately consented stroke cohort is implemented.
- The ratio is unsigned. Which side is weak is a property of the patient's existing lesion and is already known at enrolment.

*Generated from `asymmetry_discriminator.metrics.json` by `backend/app/ml/train/render_model_cards.py`; re-run the training script, then the renderer, to update. Only the `## Purpose` section above is hand-written — every other line on this page, including each limitation, is rendered from that artifact, and a test re-renders this file and compares it byte for byte. The rendered part cannot drift from the metrics it describes.*
