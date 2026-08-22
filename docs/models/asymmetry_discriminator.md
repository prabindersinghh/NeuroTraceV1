# Model card — `asymmetry_discriminator`

**Data: REAL DATA**

## Purpose
Demonstrate empirically that our asymmetry ratio separates Parkinson's (bilateral) from stroke (lateralised).

**Crucially:** This is the evidence behind Gate 3. Without real data, Gate 3 rests on an anatomical argument that is correct but unquantified.

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

## Limitations

- The default cohort is simulated. It demonstrates that the asymmetry ratio separates two groups that tap rate cannot, but it is not clinical evidence.
- The two groups are rate-matched by construction. Real Parkinson's patients are often slower overall, which would make rate look better than it deserves.
- The bilateral group carries normal handedness asymmetry, and the mildest simulated lesions overlap that distribution - which is why separation is strong but not perfect, and why the deployed system compares each patient against their own baseline asymmetry rather than against zero.
- Validating against mPower (real Parkinson's tapping) is the next step and is what should appear in the pitch; pass --mpower once access is granted.
- The ratio is unsigned. Which side is weak is a property of the patient's existing lesion and is already known at enrolment.

*Generated from `asymmetry_discriminator.metrics.json`. Re-run the training script to update — this card is derived, so it cannot drift from the metrics it describes.*
