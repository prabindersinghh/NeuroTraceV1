"""Render `docs/models/*.md` from `artifacts/*.metrics.json`.

The cards used to *claim* they were generated while being hand-maintained prose. That is
the worst kind of unsupported claim — an unsupported claim about the mechanism that is
supposed to stop unsupported claims — and it had already failed once: a card had to be
hand-corrected after asserting REAL DATA for a synthetic run. This module makes the claim
true for everything a machine can know, and narrows it to exactly that.

**What is generated.** Title, the `**Data:**` line, the training-data block, the metrics
table and confusion matrix, the synthetic caveat, and every `limitations` entry — all read
straight from the artifact. Nothing here computes, rounds up, or invents a number that is
not in the JSON.

**What is not.** The `## Purpose` section: why the model exists and what it must never be
used for. That is a human judgement about clinical intent, it is nowhere in the metrics,
and pretending otherwise would repeat the original defect one level down. It lives between
`<!-- hand-written: purpose -->` markers, is carried through untouched, and is named as
hand-written in the card's own footer.

So the round trip is: the artifact owns the numbers, the card owns the prose, and
`test_train.py` re-renders every card and compares it byte for byte. A metrics file that
changes without a re-render fails the suite.

    python -m app.ml.train.render_model_cards           # write
    python -m app.ml.train.render_model_cards --check   # fail if any card is stale
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent / "artifacts"
CARDS_DIR = Path(__file__).resolve().parents[4] / "docs" / "models"

HAND_WRITTEN_BEGIN = "<!-- hand-written: purpose -->"
HAND_WRITTEN_END = "<!-- end hand-written -->"

# The exact strings `test_train.py` greps for against the artifact's `synthetic` bool.
DATA_SYNTHETIC = "**Data: SYNTHETIC FIXTURES**"
DATA_REAL = "**Data: REAL DATA**"

SYNTHETIC_CAVEAT = (
    "> These figures are produced by generated data whose classes are separated by "
    "construction. They measure that the pipeline runs, and nothing else. Do not quote them."
)

NOT_APPLICABLE = "n/a"


def _f3(value: float) -> str:
    return f"{float(value):.3f}"


def _f2(value: float) -> str:
    return f"{float(value):.2f}"


def hand_written_purpose(text: str) -> str:
    """Return the purpose block of an existing card, markers excluded.

    Fails closed. A card whose markers are missing is either brand new or was edited by
    someone who did not know the file is rendered; guessing a purpose for a clinical model
    is precisely the invention this module exists to prevent.
    """
    try:
        _, rest = text.split(HAND_WRITTEN_BEGIN, 1)
        block, _ = rest.split(HAND_WRITTEN_END, 1)
    except ValueError:
        raise ValueError(
            f"no {HAND_WRITTEN_BEGIN} ... {HAND_WRITTEN_END} block found. The purpose "
            "section is hand-written and cannot be derived from the metrics — add the "
            "markers around it (or write the section) before rendering."
        ) from None
    return block.strip("\n")


def render_card(payload: dict, purpose: str) -> str:
    """Render one card from its metrics payload plus the hand-written purpose block."""
    model = payload["model"]
    synthetic = payload["synthetic"]
    # `spec.seed` is where the two scaffold trainers keep it; the classifiers use the
    # top-level field that `Metrics` writes.
    seed = payload.get("seed", payload.get("spec", {}).get("seed", NOT_APPLICABLE))
    has_metrics = "roc_auc" in payload

    parts: list[str] = [
        f"# Model card — `{model}`",
        DATA_SYNTHETIC if synthetic else DATA_REAL,
        f"{HAND_WRITTEN_BEGIN}\n{purpose}\n{HAND_WRITTEN_END}",
        "## Training data\n"
        f"- Dataset: {payload.get('dataset', NOT_APPLICABLE)}\n"
        f"- n = {payload.get('n_total', NOT_APPLICABLE)}"
        f"  (positive {payload.get('n_positive', NOT_APPLICABLE)},"
        f" negative {payload.get('n_negative', NOT_APPLICABLE)},"
        f" groups {payload.get('n_groups', NOT_APPLICABLE)})\n"
        f"- Split: {payload.get('split', NOT_APPLICABLE)}\n"
        f"- Seed: {seed}",
    ]

    if has_metrics:
        confusion = payload["confusion"]
        parts += [
            "## Metrics\n"
            "\n"
            "| Metric | Value |\n"
            "|---|---|\n"
            f"| ROC-AUC | {_f3(payload['roc_auc'])} |\n"
            f"| Sensitivity | {_f3(payload['sensitivity'])} |\n"
            f"| Specificity | {_f3(payload['specificity'])} |\n"
            f"| Precision | {_f3(payload['precision'])} |\n"
            f"| Accuracy | {_f3(payload['accuracy'])} |\n"
            f"| Threshold | {_f2(payload['threshold'])} |",
            "Confusion matrix:\n"
            "\n"
            "| | predicted + | predicted − |\n"
            "|---|---|---|\n"
            f"| **actual +** | {confusion['tp']} | {confusion['fn']} |\n"
            f"| **actual −** | {confusion['fp']} | {confusion['tn']} |",
        ]
        if synthetic:
            parts.append(SYNTHETIC_CAVEAT)

    limitations = payload["limitations"]
    if not limitations:
        # `Metrics.save` already refuses this; assert it again at the point of publication.
        raise ValueError(f"{model}: refusing to render a card with no limitations note")
    parts.append("## Limitations\n\n" + "\n".join(f"- {line}" for line in limitations))

    parts.append(
        f"*Generated from `{model}.metrics.json` by "
        "`backend/app/ml/train/render_model_cards.py`; re-run the training script, then the "
        "renderer, to update. Only the `## Purpose` section above is hand-written — every "
        "other line on this page, including each limitation, is rendered from that artifact, "
        "and a test re-renders this file and compares it byte for byte. The rendered part "
        "cannot drift from the metrics it describes.*"
    )

    return "\n\n".join(parts) + "\n"


def card_path(model: str, cards_dir: Path = CARDS_DIR) -> Path:
    return cards_dir / f"{model}.md"


def render_all(models_dir: Path = MODELS_DIR, cards_dir: Path = CARDS_DIR) -> dict[Path, str]:
    """Map every artifact to the card text it implies. A model with no artifact gets none."""
    rendered: dict[Path, str] = {}
    for artifact in sorted(models_dir.glob("*.metrics.json")):
        payload = json.loads(artifact.read_text(encoding="utf-8"))
        path = card_path(payload["model"], cards_dir)
        if not path.exists():
            raise SystemExit(
                f"{path} does not exist. Create it with a hand-written purpose section "
                f"between {HAND_WRITTEN_BEGIN} and {HAND_WRITTEN_END}, then re-run."
            )
        rendered[path] = render_card(payload, hand_written_purpose(path.read_text(encoding="utf-8")))
    return rendered


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true",
                    help="report stale cards and exit non-zero; write nothing")
    args = ap.parse_args(argv)

    stale: list[Path] = []
    for path, text in render_all().items():
        if path.read_text(encoding="utf-8") == text:
            print(f"  ok      {path.name}")
            continue
        stale.append(path)
        if args.check:
            print(f"  STALE   {path.name}")
        else:
            path.write_text(text, encoding="utf-8")
            print(f"  written {path.name}")

    orphans = sorted(p.name for p in CARDS_DIR.glob("*.md")
                     if not (MODELS_DIR / f"{p.stem}.metrics.json").exists())
    for name in orphans:
        print(f"  ORPHAN  {name} (no metrics artifact)")

    if args.check and (stale or orphans):
        print("\nrun `python -m app.ml.train.render_model_cards` to re-render")
        return 1
    return 1 if orphans else 0


if __name__ == "__main__":
    sys.exit(main())
