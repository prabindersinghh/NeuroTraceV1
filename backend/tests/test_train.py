"""Training utilities and the asymmetry claim — DATASETS §MODEL STRATEGY.

The dataset-backed trainers cannot run here (TORGO and PhysioNet need manual download and,
in TORGO's case, registration), so what is tested is everything around them: the metrics
contract, the grouped split, and the one claim that does not need external data — that the
tap asymmetry ratio separates a unilateral lesion from bilateral slowing when tap rate
cannot.

That last one is a design-decision regression test. If someone later "simplifies" the
motor module down to tap rate, this fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

from app.ml.train.asymmetry_discriminator import (
    LESION_ASYMMETRY_RANGE,
    _auc_for,
    _rate_matched_strong_hand,
    synthetic_cohort,
    main as asymmetry_main,
)
from app.ml.train.common import DATA_DIR, SEED, Metrics, binary_metrics, grouped_cv_predict
from app.ml.train.voice_clone import main as voice_clone_main


REPO = Path(__file__).resolve().parents[2]


# --------------------------------------------------------------------------- metrics
def test_binary_metrics_computes_the_standard_quantities():
    y_true = [1, 1, 1, 0, 0, 0]
    y_prob = [0.9, 0.8, 0.4, 0.3, 0.2, 0.1]
    m = binary_metrics(y_true, y_prob, threshold=0.5)

    assert m["confusion"] == {"tp": 2, "fp": 0, "tn": 3, "fn": 1}
    assert m["sensitivity"] == pytest.approx(2 / 3)
    assert m["specificity"] == 1.0
    assert m["precision"] == 1.0
    assert m["accuracy"] == pytest.approx(5 / 6)
    assert 0.0 <= m["roc_auc"] <= 1.0


def test_metrics_refuses_to_publish_a_number_without_its_limits(tmp_path: Path):
    """An unqualified metric is exactly what this project exists not to produce."""
    common = dict(
        model="m", synthetic=True, dataset="d", n_total=10, n_positive=5,
        n_negative=5, n_groups=5,
        split="GroupKFold", roc_auc=0.9, sensitivity=0.9, specificity=0.9,
        precision=0.9, accuracy=0.9, threshold=0.5,
        confusion={"tp": 4, "fp": 1, "tn": 4, "fn": 1}, features=["a"],
    )
    with pytest.raises(ValueError, match="limitations"):
        Metrics(limitations=[], **common).save(tmp_path / "bad.json")

    path = Metrics(limitations=["small n"], **common).save(tmp_path / "good.json")
    written = json.loads(path.read_text())
    assert written["limitations"] == ["small n"]
    assert written["seed"] == SEED
    assert written["trained_at"]


def test_metrics_summary_leads_with_sensitivity_and_prints_limits():
    m = Metrics(
        model="m", synthetic=True, dataset="d", n_total=10, n_positive=5,
        n_negative=5, n_groups=5,
        split="GroupKFold", roc_auc=0.9, sensitivity=0.88, specificity=0.7,
        precision=0.8, accuracy=0.8, threshold=0.5,
        confusion={"tp": 4, "fp": 1, "tn": 4, "fn": 1}, features=["a"],
        limitations=["tiny cohort"],
    )
    text = m.summary()
    assert "sensitivity  0.880" in text
    assert "tiny cohort" in text


def test_private_data_root_is_the_repository_gitignored_data_directory():
    assert DATA_DIR == REPO / "data"


def test_tracked_metric_artifacts_publish_machine_readable_data_status():
    artifacts = REPO / "backend" / "app" / "ml" / "train" / "artifacts"
    for path in sorted(artifacts.glob("*.metrics.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert isinstance(payload.get("synthetic"), bool), path.name
        card = REPO / "docs" / "models" / f"{payload['model']}.md"
        text = card.read_text(encoding="utf-8")
        expected = "**Data: SYNTHETIC FIXTURES**" if payload["synthetic"] else "**Data: REAL DATA**"
        assert expected in text, f"{card.name} contradicts {path.name}"


def test_voice_clone_refuses_to_call_an_existing_path_training_data(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    out = tmp_path / "out"
    sample = tmp_path / "consented-sample"
    sample.mkdir()
    monkeypatch.setattr(sys, "argv", [
        "voice_clone", "--data", str(sample), "--out", str(out),
    ])
    with pytest.raises(SystemExit, match="training is not implemented"):
        voice_clone_main()
    assert not out.exists()


def test_mpower_flag_never_turns_a_synthetic_run_into_a_real_claim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
):
    out = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", [
        "asymmetry_discriminator", "--mpower", str(tmp_path / "missing"),
        "--out", str(out),
    ])
    with pytest.raises(SystemExit, match="no metrics artifact was written"):
        asymmetry_main()
    assert not out.exists()


# --------------------------------------------------------------------------- split
def test_grouped_cv_never_puts_a_subject_on_both_sides():
    """A random sample split would leak the same speaker into train and test."""
    rng = np.random.default_rng(SEED)
    groups = np.repeat([f"s{i}" for i in range(10)], 6)
    y = np.repeat([0, 1], 30)
    X = rng.normal(size=(60, 3)) + y[:, None]

    seen: list[set] = []

    class Recorder:
        def fit(self, X_, y_):
            self.mean = X_.mean(axis=0)
            return self

        def predict_proba(self, X_):
            p = 1 / (1 + np.exp(-(X_ - self.mean).sum(axis=1)))
            return np.column_stack([1 - p, p])

    from sklearn.model_selection import GroupKFold

    for train_idx, test_idx in GroupKFold(n_splits=5).split(X, y, groups):
        seen.append(set(groups[train_idx]) & set(groups[test_idx]))
    assert all(not overlap for overlap in seen)

    oof, n_splits = grouped_cv_predict(X, y, groups, Recorder)
    assert n_splits == 5
    assert oof.shape == (60,)
    assert ((oof >= 0) & (oof <= 1)).all()


def test_grouped_cv_refuses_a_single_subject():
    with pytest.raises(ValueError, match="two distinct subjects"):
        grouped_cv_predict(np.zeros((4, 2)), np.array([0, 1, 0, 1]),
                           np.array(["a"] * 4), lambda: None)


# --------------------------------------------------------------------------- the claim
def test_the_two_cohorts_are_rate_matched():
    """If they were not, the comparison below would be rigged."""
    rates, _asym, labels = synthetic_cohort(np.random.default_rng(SEED))
    bilateral = rates[labels == 0].mean()
    unilateral = rates[labels == 1].mean()
    assert abs(bilateral - unilateral) / bilateral < 0.05


def test_tap_rate_alone_cannot_separate_a_lesion_from_bilateral_slowing():
    rates, _asym, labels = synthetic_cohort(np.random.default_rng(SEED))
    by_rate = _auc_for(rates, labels, invert=True)
    # At chance, in both directions.
    assert 0.35 < by_rate["roc_auc"] < 0.65


def test_the_asymmetry_ratio_does_separate_them():
    """The design decision this whole module exists to justify."""
    _rates, asymmetries, labels = synthetic_cohort(np.random.default_rng(SEED))
    by_asymmetry = _auc_for(asymmetries, labels)
    assert by_asymmetry["roc_auc"] > 0.90
    assert by_asymmetry["sensitivity"] > 0.80
    assert by_asymmetry["specificity"] > 0.80


def test_the_bilateral_group_carries_normal_handedness_asymmetry():
    """Separating pathology from zero would be easy and useless.

    Healthy people are asymmetric — the dominant hand is faster. The comparison is only
    meaningful because the control group has that asymmetry too.
    """
    _rates, asymmetries, labels = synthetic_cohort(np.random.default_rng(SEED))
    controls = asymmetries[labels == 0]
    assert controls.mean() > 0.02, "controls are unrealistically symmetric"
    # ...and the mildest lesions overlap that distribution, so this is not a trivial split.
    lesions = asymmetries[labels == 1]
    assert lesions.min() < controls.max()


def test_the_rate_match_is_derived_not_hardcoded():
    factor = _rate_matched_strong_hand()
    assert 0.4 < factor < 1.0
    assert LESION_ASYMMETRY_RANGE[0] < LESION_ASYMMETRY_RANGE[1]


# --------------------------------------------------------------------------- model cards
def test_every_model_card_is_a_faithful_render_of_its_artifact():
    """The cards claim they cannot drift from the metrics. This is that claim's teeth.

    Only the rendered region is pinned — the hand-written `## Purpose` block is carried
    through from the file, so this compares like with like and still fails if a number, a
    limitation, the data status or the footer diverges from the JSON.
    """
    from app.ml.train.render_model_cards import (
        CARDS_DIR, MODELS_DIR, HAND_WRITTEN_BEGIN, render_all,
    )

    rendered = render_all()
    assert {p.stem for p in rendered} == {p.name.removesuffix(".metrics.json")
                                          for p in MODELS_DIR.glob("*.metrics.json")}
    # No card without an artifact — a card nobody can regenerate is prose again.
    assert {p.name for p in CARDS_DIR.glob("*.md")} == {p.name for p in rendered}

    for path, text in rendered.items():
        assert path.read_text(encoding="utf-8") == text, (
            f"{path.name} is stale — run `python -m app.ml.train.render_model_cards`"
        )
        assert HAND_WRITTEN_BEGIN in text


def test_the_renderer_carries_every_limitation_and_refuses_an_empty_one():
    from app.ml.train.render_model_cards import MODELS_DIR, render_card

    for artifact in sorted(MODELS_DIR.glob("*.metrics.json")):
        payload = json.loads(artifact.read_text(encoding="utf-8"))
        card = render_card(payload, "## Purpose\nstub")
        for limitation in payload["limitations"]:
            assert f"- {limitation}" in card, artifact.name
        expected = "**Data: SYNTHETIC FIXTURES**" if payload["synthetic"] else "**Data: REAL DATA**"
        assert expected in card

    with pytest.raises(ValueError, match="limitations"):
        render_card({"model": "m", "synthetic": True, "limitations": []}, "## Purpose\nstub")


def test_a_card_missing_its_hand_written_markers_fails_rather_than_inventing_a_purpose():
    from app.ml.train.render_model_cards import hand_written_purpose

    with pytest.raises(ValueError, match="hand-written"):
        hand_written_purpose("# Model card — `m`\n\n## Purpose\nno markers here\n")
