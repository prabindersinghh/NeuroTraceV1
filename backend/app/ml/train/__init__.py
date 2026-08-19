"""Offline training and validation — TRD §2, DATASETS §MODEL STRATEGY.

Three scripts, none of which produces anything that can make a decision:

  voice_dysarthria_clf      TORGO vs LibriSpeech/CommonVoice -> dysarthria likelihood
  rhythm_irregularity_clf   PhysioNet AF Challenge -> the M17 operating point
  asymmetry_discriminator   evidence that tap asymmetry separates a lesion from
                            bilateral slowing, which tap rate alone cannot

Each writes a `.metrics.json` carrying ROC-AUC, sensitivity, specificity, the confusion
matrix, the split method and a limitations note. `Metrics.save` refuses to write a file
with no limitations, because an unqualified number is the thing this project exists not
to produce.

Run them with the module path, from `backend/`:

    python -m app.ml.train.asymmetry_discriminator
    python -m app.ml.train.voice_dysarthria_clf --data data/torgo --controls data/librispeech
    python -m app.ml.train.rhythm_irregularity_clf --data data/physionet_af
"""
from .common import MODELS_DIR, SEED, Metrics, binary_metrics, grouped_cv_predict

__all__ = ["MODELS_DIR", "SEED", "Metrics", "binary_metrics", "grouped_cv_predict"]
