# Model card — `voice_clone`

**Data: SYNTHETIC FIXTURES**

<!-- hand-written: purpose -->
## Purpose
Rebuild the patient's pre-stroke voice from a 2-minute family clip.

**Crucially:** This is impersonation technology. Consent is recorded, source audio is destroyed after training, and a clone is permanently deletable. The product works fully without one.
<!-- end hand-written -->

## Training data
- Dataset: n/a
- n = n/a  (positive n/a, negative n/a, groups n/a)
- Split: n/a
- Seed: 42

## Limitations

- SYNTHETIC RUN. No voice sample was present; this exercises the pipeline and produces no voice.
- This is impersonation technology. A cloned voice can say anything and the family cannot distinguish it from the real thing - that is the design goal, and it is why consent and deletion are enforced rather than encouraged.
- XTTS-v2 does not support Punjabi, which most of our patients speak at home. Punjabi routes to an Indic fine-tune that needs the full clip.
- A pre-stroke recording is not always available, and families without one correlate with families with less money. The product must work identically without a clone, and it does - the board falls back to a stock voice.
- Quality is judged by informal listening, not by a published MOS. We have not run a listening study and should not imply that we have.

*Generated from `voice_clone.metrics.json` by `backend/app/ml/train/render_model_cards.py`; re-run the training script, then the renderer, to update. Only the `## Purpose` section above is hand-written — every other line on this page, including each limitation, is rendered from that artifact, and a test re-renders this file and compares it byte for byte. The rendered part cannot drift from the metrics it describes.*
