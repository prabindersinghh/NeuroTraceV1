"""Train the dysarthria-likelihood classifier — DATASETS §MODEL STRATEGY.

    python -m app.ml.train.voice_dysarthria_clf --data data/torgo --controls data/librispeech

Positives are dysarthric speakers (TORGO, optionally UA-Speech); negatives are healthy
controls (LibriSpeech train-clean-100, or Common Voice Hindi/Punjabi). Features are exactly
the ones `app/ml/speech.py` already extracts, so the trained output plugs in as one extra
feature with no new capture path.

What the output is, precisely: `dysarthria_likelihood` in [0, 1], appended to M4's feature
vector. It is baselined and z-scored like every other feature. It cannot set a band.

Honest caveat, stated here and written into the metrics file: TORGO speakers are mostly
cerebral-palsy and ALS dysarthria recorded in North American English. Our patients have
post-stroke dysarthria and speak Hindi and Punjabi. Transfer is partial — which is exactly
why ARM 2 of the datasets plan, our own Punjab corpus, is the differentiator rather than
a nice-to-have.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from ..speech import SPEECH_SCORING_KEYS, extract_speech_features
from .common import MODELS_DIR, SEED, Metrics, binary_metrics, grouped_cv_predict

AUDIO_SUFFIXES = (".wav", ".flac", ".mp3", ".m4a", ".ogg")


def collect(root: Path, label: int) -> tuple[list[dict], list[str], list[int]]:
    """Extract features from every audio file under `root`.

    The speaker id is the first path component below the root, which matches the TORGO
    (`F01/`, `M04/`) and LibriSpeech (`19/`, `26/`) layouts. That id becomes the CV group,
    so no speaker appears on both sides of a fold.
    """
    features, groups, labels = [], [], []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in AUDIO_SUFFIXES:
            continue
        try:
            feats = extract_speech_features(str(path))
        except Exception:
            continue
        if feats.get("valid") != 1.0:
            continue
        rel = path.relative_to(root).parts
        features.append(feats)
        groups.append(rel[0] if len(rel) > 1 else path.stem)
        labels.append(label)
    return features, groups, labels


def to_matrix(features: list[dict]) -> np.ndarray:
    return np.array(
        [[float(f.get(k, 0.0)) for k in SPEECH_SCORING_KEYS] for f in features],
        dtype=float,
    )


def build_model():
    """Logistic regression, not a boosted ensemble.

    With a few dozen speakers a linear model in a standardised feature space is better
    calibrated and does not memorise individuals, and its coefficients are inspectable —
    which matters when a clinician asks which acoustic feature drove the number.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    return Pipeline([
        ("scale", StandardScaler()),
        ("clf", LogisticRegression(max_iter=2000, class_weight="balanced",
                                   random_state=SEED)),
    ])


def _run_synthetic(args) -> None:
    """Exercise the whole pipeline on generated data.

    TORGO and UASpeech both need a signed agreement, which takes weeks. Without this the
    training code would sit unexecuted until then, and the first real run would be the
    first time anyone found out whether it works. The metrics are marked synthetic so they
    can never be mistaken for evidence.
    """
    import numpy as np

    from .common import Metrics, binary_metrics

    rng = np.random.default_rng(SEED)
    n = 240
    y = np.array([1] * (n // 2) + [0] * (n // 2))
    # Impaired speech: more jitter and shimmer, lower HNR, slower DDK. The separation is
    # built in by construction, which is exactly why the number means nothing.
    prob = np.clip(
        0.5 + np.where(y == 1, 1, -1) * rng.normal(0.22, 0.16, n), 0.001, 0.999)

    scores = binary_metrics(y.tolist(), prob.tolist(), threshold=0.5)
    metrics = Metrics(
        model="voice_dysarthria_clf",
        synthetic=True,
        dataset="SYNTHETIC FIXTURES (no corpus present)",
        n_total=n, n_positive=int(y.sum()), n_negative=int((1 - y).sum()),
        n_groups=n // 4, split="synthetic, grouped by speaker",
        threshold=0.5, features=list(SPEECH_SCORING_KEYS),
        limitations=[
            "SYNTHETIC RUN. No real corpus was present, so these figures are generated "
            "and mean nothing. They demonstrate that the pipeline executes end to end.",
            "TORGO and UASpeech are English and predominantly cerebral-palsy dysarthria, "
            "n < 20 impaired speakers each. Our users are Punjabi- and Hindi-speaking "
            "stroke survivors. That population mismatch cannot be trained away.",
            "The control corpora are read speech recorded in good conditions. A classifier "
            "may separate recording conditions rather than pathology.",
            "The output is ONE feature into a deterministic engine. It never decides.",
        ],
        **scores,
    )
    print(metrics.summary())
    print()
    print("wrote", metrics.save(args.out / "voice_dysarthria_clf.metrics.json"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train voice_dysarthria_clf")
    parser.add_argument("--data", type=Path, default=None,
                        help="root of the dysarthric corpus (TORGO)")
    parser.add_argument("--controls", type=Path, default=None,
                        help="root of the healthy control corpus")
    parser.add_argument("--synthetic", action="store_true",
                        help="run on generated fixtures. Exercises the pipeline before "
                             "any corpus has been granted; the resulting numbers are "
                             "meaningless and are marked as such.")
    parser.add_argument("--out", type=Path, default=MODELS_DIR)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    synthetic = args.synthetic or args.data is None or args.controls is None
    if not synthetic:
        for path, name in ((args.data, "dysarthric corpus"),
                           (args.controls, "control corpus")):
            if not path.exists():
                raise SystemExit(f"{name} not found at {path}. See data/README.md.")

    if synthetic:
        _run_synthetic(args)
        return

    print("extracting features (reads every file once) ...")
    pos_f, pos_g, pos_y = collect(args.data, 1)
    neg_f, neg_g, neg_y = collect(args.controls, 0)
    if not pos_f or not neg_f:
        raise SystemExit("no usable audio found in one of the corpora")

    X = to_matrix(pos_f + neg_f)
    y = np.array(pos_y + neg_y, dtype=int)
    groups = np.array([f"pos::{g}" for g in pos_g] + [f"neg::{g}" for g in neg_g])

    print("cross-validating, grouped by speaker ...")
    oof, n_splits = grouped_cv_predict(X, y, groups, build_model)
    scores = binary_metrics(y, oof, args.threshold)

    final = build_model()
    final.fit(X, y)

    args.out.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump({"model": final, "features": list(SPEECH_SCORING_KEYS), "seed": SEED},
                args.out / "voice_dysarthria_clf.joblib")

    metrics = Metrics(
        model="voice_dysarthria_clf",
        synthetic=False,
        dataset=f"{args.data.name} (positive) vs {args.controls.name} (control)",
        n_total=len(y), n_positive=int(y.sum()), n_negative=int((1 - y).sum()),
        n_groups=len(set(groups)), split=f"GroupKFold by speaker, {n_splits} folds",
        threshold=args.threshold, features=list(SPEECH_SCORING_KEYS),
        limitations=[
            "TORGO dysarthria is predominantly cerebral palsy and ALS, not post-stroke; "
            "the articulatory pattern differs and transfer is partial.",
            "All training audio is North American English. Our patients speak Hindi and "
            "Punjabi, whose phonetic inventory and prosody differ.",
            "Recording conditions are studio quality; ours are a phone microphone in a "
            "home with background noise.",
            "Speaker counts are small (tens, not thousands), so the confidence intervals "
            "around these figures are wide.",
            "Output is a per-modality likelihood used as one additional feature. It does "
            "not set a band and cannot raise an alert on its own.",
        ],
        **scores,
    )
    print()
    print(metrics.summary())
    print()
    print("wrote", metrics.save(args.out / "voice_dysarthria_clf.metrics.json"))


if __name__ == "__main__":
    main()
