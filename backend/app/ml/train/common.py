"""Shared training utilities — DATASETS §"MODEL STRATEGY".

Two rules govern everything in this package:

1. **Nothing trained here makes a decision.** Each model outputs a per-modality likelihood
   that enters the deterministic engine as one additional *feature*, alongside jitter and
   tap rate. The band, the gates and the thresholds stay in `app/engine/`. A model that
   could move a band would put a 200-sample classifier in the clinical path.

2. **Every model publishes its limits.** Paraspeak won this theme partly by publishing its
   word error rate. Every run here writes ROC-AUC, sensitivity, specificity, a confusion
   matrix, the split method, n, and a plain-language limitations note. A metrics file
   without a limitations note is treated as an incomplete run.

Everything is seeded at 42 and splits are grouped by speaker/subject, never by sample —
random sample splits leak the same person into train and test and inflate every number.
"""
from __future__ import annotations

import json
import platform
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import numpy as np

SEED = 42
MODELS_DIR = Path(__file__).resolve().parent / "artifacts"
DATA_DIR = Path(__file__).resolve().parents[3] / "data"


@dataclass(slots=True)
class Metrics:
    """Everything we publish about a trained model."""

    model: str
    dataset: str
    n_total: int
    n_positive: int
    n_negative: int
    n_groups: int
    split: str
    roc_auc: float
    sensitivity: float
    specificity: float
    precision: float
    accuracy: float
    threshold: float
    confusion: dict[str, int]
    features: list[str]
    limitations: list[str]
    seed: int = SEED
    trained_at: str = ""
    python: str = ""

    def __post_init__(self) -> None:
        if not self.trained_at:
            self.trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if not self.python:
            self.python = platform.python_version()

    def save(self, path: Path) -> Path:
        if not self.limitations:
            raise ValueError(
                "refusing to write metrics with no limitations note - an unqualified "
                "number is the thing this project exists not to produce"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")
        return path

    def summary(self) -> str:
        return (
            f"{self.model}\n"
            f"  dataset      {self.dataset}\n"
            f"  n            {self.n_total} ({self.n_positive} pos / {self.n_negative} neg)"
            f" across {self.n_groups} subjects\n"
            f"  split        {self.split}\n"
            f"  ROC-AUC      {self.roc_auc:.3f}\n"
            f"  sensitivity  {self.sensitivity:.3f}\n"
            f"  specificity  {self.specificity:.3f}\n"
            f"  precision    {self.precision:.3f}\n"
            f"  accuracy     {self.accuracy:.3f}\n"
            f"  confusion    {self.confusion}\n"
            f"  limitations  " + "\n               ".join(self.limitations)
        )


def binary_metrics(y_true: Sequence[int], y_prob: Sequence[float],
                   threshold: float = 0.5) -> dict:
    """ROC-AUC plus the operating-point metrics at `threshold`.

    Sensitivity is reported first and deliberately: for a screening tool the cost of a
    miss is not symmetric with the cost of a false positive, and a model tuned to look
    good on accuracy alone will quietly trade away the thing that matters.
    """
    from sklearn.metrics import confusion_matrix, roc_auc_score

    y_true = np.asarray(y_true, dtype=int)
    y_prob = np.asarray(y_prob, dtype=float)
    y_pred = (y_prob >= threshold).astype(int)

    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    auc = float(roc_auc_score(y_true, y_prob)) if len(set(y_true)) > 1 else float("nan")

    return {
        "roc_auc": auc,
        "sensitivity": float(tp / (tp + fn)) if (tp + fn) else 0.0,
        "specificity": float(tn / (tn + fp)) if (tn + fp) else 0.0,
        "precision": float(tp / (tp + fp)) if (tp + fp) else 0.0,
        "accuracy": float((tp + tn) / max(1, tp + tn + fp + fn)),
        "confusion": {"tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)},
    }


def grouped_cv_predict(X, y, groups, model_factory, n_splits: int = 5):
    """Out-of-fold probabilities using GroupKFold.

    Grouping is by speaker or subject. A random split would put two recordings of the same
    person on both sides of the fold, and the model would be scored on its ability to
    recognise a voice rather than a pathology. Reported numbers would roughly double and
    would be meaningless.
    """
    from sklearn.model_selection import GroupKFold

    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=int)
    groups = np.asarray(groups)

    n_splits = min(n_splits, len(np.unique(groups)))
    if n_splits < 2:
        raise ValueError("need at least two distinct subjects to cross-validate")

    oof = np.zeros(len(y), dtype=float)
    for train_idx, test_idx in GroupKFold(n_splits=n_splits).split(X, y, groups):
        model = model_factory()
        model.fit(X[train_idx], y[train_idx])
        oof[test_idx] = model.predict_proba(X[test_idx])[:, 1]
    return oof, n_splits


def require_dataset(path: Path, name: str, url: str) -> Path:
    """Fail with an actionable message rather than a stack trace."""
    if not path.exists():
        raise SystemExit(
            f"\n{name} not found at {path}\n"
            f"  1. download it from {url}\n"
            f"  2. place it at that path\n"
            f"  3. re-run this script\n"
            f"See docs/DATASETS.md for the full list and access notes.\n"
        )
    return path
