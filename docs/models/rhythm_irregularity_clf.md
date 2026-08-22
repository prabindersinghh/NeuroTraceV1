# Model card — `rhythm_irregularity_clf`

**Data: SYNTHETIC FIXTURES**

## Purpose
Detect irregular RR intervals and advise obtaining an ECG.

**Crucially:** It must NEVER assert atrial fibrillation. AF is an ECG diagnosis made by a clinician; a wrist optical sensor and a logistic regression are not that.

## Training data
- Dataset: SYNTHETIC FIXTURES (no PhysioNet data present)
- n = 300  (positive 90, negative 210, groups 300)
- Split: synthetic, one record per subject
- Seed: 42

## Metrics

| Metric | Value |
|---|---|
| ROC-AUC | 0.973 |
| Sensitivity | 0.933 |
| Specificity | 0.871 |
| Precision | 0.757 |
| Accuracy | 0.890 |
| Threshold | 0.50 |

Confusion matrix:

| | predicted + | predicted − |
|---|---|---|
| **actual +** | 84 | 6 |
| **actual −** | 27 | 183 |

> These figures are produced by generated data whose classes are separated by construction. They measure that the pipeline runs, and nothing else. Do not quote them.

## Limitations

- SYNTHETIC RUN. No PhysioNet data was present, so these figures are generated and mean nothing. They demonstrate that the pipeline executes end to end.
- The challenge data is single-lead ECG. We derive intervals from a PPG, which is noisier and far more motion-sensitive, so field performance will be lower.
- Atrial fibrillation is an ECG diagnosis. This model informs an advisory to obtain an ECG and never asserts the diagnosis.

*Generated from `rhythm_irregularity_clf.metrics.json`. Re-run the training script to update — this card is derived, so it cannot drift from the metrics it describes.*
