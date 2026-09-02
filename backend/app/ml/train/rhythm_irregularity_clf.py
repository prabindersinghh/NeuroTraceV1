"""Calibrate the irregular-rhythm operating point — DATASETS §MODEL STRATEGY.

    python -m app.ml.train.rhythm_irregularity_clf --data data/physionet_af

Uses the PhysioNet/CinC 2017 AF Challenge to choose the threshold for M17's
`rr_irregularity_index` from data, rather than leaving it at a guessed constant.

The output is a threshold and a calibrated probability, not a diagnosis. M17's user-facing
string stays "an irregular rhythm was seen - please arrange an ECG" no matter how confident
the model is, because atrial fibrillation is an ECG diagnosis and a fingertip PPG is not
an ECG.

Sensitivity is weighted above specificity deliberately: a missed AF is a preventable
stroke, whereas a false positive costs one ECG.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

from ...exam.vitals import rr_features
from .common import MODELS_DIR, SEED, Metrics, binary_metrics, grouped_cv_predict

FEATURES = ["rr_irregularity_index", "rmssd", "pnn50", "sdnn",
            "poincare_sd1", "poincare_sd2", "poincare_ratio", "mean_hr"]

MIN_SENSITIVITY = 0.85
CHALLENGE_FS = 300.0


def load_reference(root: Path) -> dict[str, str]:
    """REFERENCE.csv maps record id to class: N normal, A atrial fibrillation, O other."""
    reference = root / "REFERENCE.csv"
    if not reference.exists():
        raise SystemExit(f"REFERENCE.csv not found in {root}. See docs/DATASETS.md.")
    with reference.open(newline="", encoding="utf-8") as fh:
        return {row[0]: row[1] for row in csv.reader(fh) if len(row) >= 2}


def load_rr(root: Path, record: str) -> np.ndarray | None:
    """Beat intervals for one record, in milliseconds.

    Prefers a precomputed `<record>.rr` file (one interval per line). Falls back to
    detecting beats from the raw waveform when scipy is available.
    """
    rr_path = root / f"{record}.rr"
    if rr_path.exists():
        values = [float(v) for v in rr_path.read_text().split() if v.strip()]
        return np.asarray(values, dtype=float) if len(values) >= 6 else None

    mat = root / f"{record}.mat"
    if not mat.exists():
        return None
    try:
        from scipy.io import loadmat

        from ...exam.vitals import detect_beats

        signal = np.asarray(loadmat(mat)["val"], dtype=float).ravel()
        beats = detect_beats(signal, fs=CHALLENGE_FS)
        return np.diff(beats) * 1000.0 if beats.size >= 7 else None
    except Exception:
        return None


def build_model():
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    return Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced",
                                   random_state=SEED)),
    ])


def choose_threshold(y: np.ndarray, oof: np.ndarray) -> float:
    """Maximise Youden's J subject to sensitivity >= MIN_SENSITIVITY.

    An accuracy-optimal threshold on an imbalanced screening problem drifts toward calling
    everything normal. Constraining sensitivity first, then optimising, keeps the model
    doing the job it exists for.
    """
    best_threshold, best_j = 0.5, -1.0
    for candidate in np.linspace(0.05, 0.95, 91):
        m = binary_metrics(y, oof, float(candidate))
        if m["sensitivity"] < MIN_SENSITIVITY:
            continue
        j = m["sensitivity"] + m["specificity"] - 1.0
        if j > best_j:
            best_threshold, best_j = float(candidate), j
    return best_threshold


def _run_synthetic(args) -> None:
    """Exercise the pipeline before the dataset is downloaded.

    PhysioNet AF is openly available, so this path exists for a fresh clone rather than for
    an access wait. The figures are generated and marked as such.
    """
    rng = np.random.default_rng(SEED)
    n = 300
    y = np.array([1] * 90 + [0] * 210)
    prob = np.clip(0.5 + np.where(y == 1, 1, -1) * rng.normal(0.20, 0.17, n), 0.001, 0.999)

    scores = binary_metrics(y.tolist(), prob.tolist(), threshold=0.5)
    metrics = Metrics(
        model="rhythm_irregularity_clf",
        synthetic=True,
        dataset="SYNTHETIC FIXTURES (no PhysioNet data present)",
        n_total=n, n_positive=int(y.sum()), n_negative=int((1 - y).sum()),
        n_groups=n, split="synthetic, one record per subject",
        threshold=0.5, features=list(FEATURES),
        limitations=[
            "SYNTHETIC RUN. No PhysioNet data was present, so these figures are generated "
            "and mean nothing. They demonstrate that the pipeline executes end to end.",
            "The challenge data is single-lead ECG. We derive intervals from a PPG, which "
            "is noisier and far more motion-sensitive, so field performance will be lower.",
            "Atrial fibrillation is an ECG diagnosis. This model informs an advisory to "
            "obtain an ECG and never asserts the diagnosis.",
        ],
        **scores,
    )
    print(metrics.summary())
    print()
    print("wrote", metrics.save(args.out / "rhythm_irregularity_clf.metrics.json"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate rhythm_irregularity_clf")
    parser.add_argument("--data", type=Path, default=None,
                        help="root of the PhysioNet 2017 training set")
    parser.add_argument("--synthetic", action="store_true",
                        help="run on generated fixtures before the dataset is downloaded")
    parser.add_argument("--out", type=Path, default=MODELS_DIR)
    args = parser.parse_args()

    if args.synthetic or args.data is None or not args.data.exists():
        print("PhysioNet AF 2017 not present - running on synthetic fixtures.")
        print("Download it with: ./scripts/download_datasets.sh physionet")
        _run_synthetic(args)
        return

    reference = load_reference(args.data)
    rows, labels, groups = [], [], []

    for record, label in sorted(reference.items()):
        if label == "~":        # too noisy to classify; excluded by the challenge as well
            continue
        rr = load_rr(args.data, record)
        if rr is None:
            continue
        feats = rr_features(rr)
        if not feats:
            continue
        rows.append([float(feats.get(k, 0.0)) for k in FEATURES])
        labels.append(1 if label == "A" else 0)
        groups.append(record)   # one recording per subject in this challenge

    if len(rows) < 20:
        raise SystemExit(f"only {len(rows)} usable records found - check the data layout")

    X, y = np.asarray(rows, dtype=float), np.asarray(labels, dtype=int)
    oof, n_splits = grouped_cv_predict(X, y, np.asarray(groups), build_model)
    threshold = choose_threshold(y, oof)
    scores = binary_metrics(y, oof, threshold)

    final = build_model()
    final.fit(X, y)

    args.out.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump({"model": final, "features": FEATURES, "threshold": threshold,
                 "seed": SEED}, args.out / "rhythm_irregularity_clf.joblib")

    metrics = Metrics(
        model="rhythm_irregularity_clf",
        synthetic=False,
        dataset="PhysioNet/CinC 2017 AF Challenge",
        n_total=len(y), n_positive=int(y.sum()), n_negative=int((1 - y).sum()),
        n_groups=len(set(groups)), split=f"GroupKFold by record, {n_splits} folds",
        threshold=threshold, features=FEATURES,
        limitations=[
            "The challenge data is single-lead ECG. We derive intervals from a fingertip "
            "PPG, which is noisier and far more motion-sensitive, so field performance "
            "will be lower than these figures.",
            "Records labelled '~' (too noisy) were excluded, as in the original challenge. "
            "In the field those recordings still occur and are handled by capture-quality "
            "gating instead.",
            "Atrial fibrillation is an ECG diagnosis. This model informs an advisory to "
            "obtain an ECG and never asserts the diagnosis.",
            f"The operating point is constrained to sensitivity >= {MIN_SENSITIVITY}, so "
            "the false positive rate is deliberately higher than an accuracy-optimal "
            "threshold would give.",
        ],
        **scores,
    )
    print(metrics.summary())
    print("\nwrote", metrics.save(args.out / "rhythm_irregularity_clf.metrics.json"))


if __name__ == "__main__":
    main()
