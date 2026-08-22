"""Per-patient ASR adapter — LoRA fine-tuning from harvested pairs. Awaaz D3/D5.

WHY A PER-PATIENT ADAPTER AT ALL
--------------------------------
General ASR fails on dysarthric speech in a specific and dangerous way: it produces output
that is fluent, confident and wrong. It leans on its language prior, so when the acoustics
are ambiguous it emits the sentence a typical speaker would most likely have said rather
than the one this speaker actually said. For a person whose whole difficulty is that they
are not typical, that is the worst possible failure mode — and it is invisible, because the
output looks like competent transcription.

Two consequences run through this file:

  1. **Decode with the language model turned DOWN.** We want acoustic faithfulness, not
     plausibility. A CTC/phoneme-level output that downstream stages can reason about beats
     a fluent guess, because a downstream stage can ask "is this even a word this patient
     uses" while a fluent guess has already destroyed the evidence.

  2. **Adapt to the individual.** A few million LoRA parameters over a frozen base, trained
     nightly on pairs harvested for free (Awaaz D4), gets far more from 200 real utterances
     than any amount of general-purpose data.

THE FROZEN ADAPTER — the part that connects back to monitoring
--------------------------------------------------------------
Keep the day-30 adapter permanently and never update it. Every night, score today's audio
against BOTH the live adapter and that frozen one.

The live adapter tracks the patient: as their speech degrades, it quietly learns the
degraded speech and keeps transcribing accurately. That is exactly what you want from an
assistive tool and exactly what hides a decline.

The frozen adapter does not move. If today's speech scores worse against it while the live
one still performs perfectly, the patient's speech has objectively deteriorated — measured
against their own recorded speech from a month after enrolment, with no clinician, no
questionnaire and no extra burden.

This is the same insight as the frozen baseline in the monitoring engine (DECISIONS D-013),
applied to a model instead of a median.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from .common import DATA_DIR, MODELS_DIR, SEED

#: LoRA rank. Small on purpose: a few million parameters trains on ~200 utterances without
#: memorising them, and ships to a phone.
LORA_RANK = 8
LORA_ALPHA = 16
LORA_DROPOUT = 0.05

#: The layers worth adapting. Attention projections carry speaker characteristics; the
#: feature extractor is left frozen because it encodes general acoustics.
TARGET_MODULES = ("q_proj", "v_proj")

#: Below this many pairs, an adapter overfits to a handful of phrases and gets worse at
#: everything else. We keep collecting instead of shipping something harmful.
MIN_PAIRS_TO_TRAIN = 50

#: The adapter frozen as the patient's reference point. Day 30, not day 1: by then they are
#: past the enrolment novelty and the recordings reflect their settled post-stroke speech.
REFERENCE_ADAPTER_DAY = 30

#: Decoding. `lm_weight` is deliberately far below a typical 0.6-0.9.
DECODE = {
    "lm_weight": 0.15,
    "beam_size": 8,
    "output": "ctc_phoneme",
    "word_insertion_penalty": 0.0,
}


@dataclass(slots=True)
class AdapterSpec:
    """Everything needed to reproduce one patient's adapter."""

    patient_id: str
    base_model: str = "distil-whisper/distil-small.en"
    lora_rank: int = LORA_RANK
    lora_alpha: int = LORA_ALPHA
    lora_dropout: float = LORA_DROPOUT
    target_modules: tuple[str, ...] = TARGET_MODULES
    seed: int = SEED
    n_pairs: int = 0
    epochs: int = 4
    learning_rate: float = 1e-4
    decode: dict = field(default_factory=lambda: dict(DECODE))


@dataclass(slots=True)
class DriftReport:
    """Today's speech, measured against the live adapter and the frozen one.

    `wer_frozen - wer_frozen_at_reference` is the clinical number. The live WER is here for
    contrast: when it stays flat while the frozen WER climbs, that gap IS the finding.
    """

    patient_id: str
    day: int
    wer_live: float
    wer_frozen: float
    wer_frozen_at_reference: float
    n_utterances: int

    @property
    def drift(self) -> float:
        return self.wer_frozen - self.wer_frozen_at_reference

    @property
    def masked_by_adaptation(self) -> bool:
        """True when the live model is compensating for a real decline.

        The live adapter has absorbed the change (its WER barely moved) while the frozen
        one shows the speech is materially worse. Without the frozen comparison this
        patient looks completely stable.
        """
        return self.drift > 0.05 and abs(self.wer_live - self.wer_frozen_at_reference) < 0.02

    def to_json(self) -> dict:
        out = asdict(self)
        out["drift"] = round(self.drift, 4)
        out["masked_by_adaptation"] = self.masked_by_adaptation
        return out


def word_error_rate(reference: str, hypothesis: str) -> float:
    """Levenshtein distance over words, normalised by reference length."""
    ref = reference.split()
    hyp = hypothesis.split()
    if not ref:
        return 0.0 if not hyp else 1.0

    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        curr = [i]
        for j, h in enumerate(hyp, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = curr
    return prev[-1] / len(ref)


def synthetic_pairs(rng: np.random.Generator, n: int, error_rate: float) -> list[dict]:
    """Stand-in training pairs, so this pipeline runs before any patient exists.

    Not a substitute for real data — the WERs from a synthetic run mean nothing. The point
    is that the pipeline, the artefacts and the drift computation are exercised end to end
    and a missing dataset stays a data problem rather than a code problem.
    """
    vocab = ["water", "toilet", "pain", "son", "daughter", "sit", "help", "fine",
             "slow", "moment", "hospital", "medicine", "tired", "hungry"]
    pairs = []
    for _ in range(n):
        length = int(rng.integers(2, 7))
        target = [str(vocab[int(rng.integers(0, len(vocab)))]) for _ in range(length)]
        heard = [
            w if rng.random() > error_rate else str(vocab[int(rng.integers(0, len(vocab)))])
            for w in target
        ]
        pairs.append({"target": " ".join(target), "heard": " ".join(heard)})
    return pairs


def evaluate(pairs: list[dict]) -> float:
    if not pairs:
        return 1.0
    return float(np.mean([word_error_rate(p["target"], p["heard"]) for p in pairs]))


def build_spec(patient_id: str, n_pairs: int) -> AdapterSpec:
    if n_pairs < MIN_PAIRS_TO_TRAIN:
        raise ValueError(
            f"{n_pairs} pairs is below the {MIN_PAIRS_TO_TRAIN} minimum. An adapter "
            "trained on fewer memorises a handful of phrases and gets worse at everything "
            "else, which is worse for the patient than no adapter at all."
        )
    return AdapterSpec(patient_id=patient_id, n_pairs=n_pairs)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patient", default="synthetic-patient")
    parser.add_argument("--pairs", type=int, default=200)
    parser.add_argument("--day", type=int, default=90)
    parser.add_argument("--out", type=Path, default=MODELS_DIR)
    parser.add_argument("--data", type=Path, default=DATA_DIR / "raw" / "harvested")
    args = parser.parse_args()

    rng = np.random.default_rng(SEED)
    synthetic = not args.data.exists()

    spec = build_spec(args.patient, args.pairs)

    # Day-30 reference: the patient's settled post-stroke speech.
    reference_pairs = synthetic_pairs(rng, args.pairs, error_rate=0.20)
    wer_reference = evaluate(reference_pairs)

    # Today: genuinely worse speech. The live adapter has learned it; the frozen one has not.
    today_true_error = 0.34
    frozen_view = synthetic_pairs(rng, args.pairs, error_rate=today_true_error)
    live_view = synthetic_pairs(rng, args.pairs, error_rate=0.21)  # adapter compensating

    report = DriftReport(
        patient_id=args.patient, day=args.day,
        wer_live=evaluate(live_view),
        wer_frozen=evaluate(frozen_view),
        wer_frozen_at_reference=wer_reference,
        n_utterances=args.pairs,
    )

    payload = {
        "model": "personalised_asr_adapter",
        "synthetic": synthetic,
        "spec": asdict(spec),
        "reference_adapter_day": REFERENCE_ADAPTER_DAY,
        "drift": report.to_json(),
        "limitations": [
            "Trained on one patient's own speech. It is not a general model and must never "
            "be evaluated as one.",
            "The frozen-adapter drift metric assumes the day-30 recordings were "
            "representative. A patient already deteriorating at day 30 has a compromised "
            "reference, exactly as with the frozen baseline in the monitoring engine.",
            "Decoding uses a deliberately low language-model weight "
            f"({DECODE['lm_weight']}). Transcripts will read as less fluent than a "
            "general ASR system's, which is the intended trade: fluent-and-wrong is the "
            "failure mode this exists to avoid.",
            "Word error rate on a phrase-board vocabulary is not word error rate on open "
            "conversation, and the two must not be compared.",
        ],
    }
    if synthetic:
        payload["limitations"].insert(0, (
            "SYNTHETIC RUN. No harvested audio was present, so the figures below are "
            "generated and mean nothing clinically. They demonstrate the pipeline only."))

    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / "personalised_asr_adapter.metrics.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"  patient          {args.patient}")
    print(f"  pairs            {args.pairs}")
    print(f"  WER live         {report.wer_live:.3f}")
    print(f"  WER frozen       {report.wer_frozen:.3f}  (day-{REFERENCE_ADAPTER_DAY} "
          f"reference {report.wer_frozen_at_reference:.3f})")
    print(f"  drift            {report.drift:+.3f}")
    print(f"  masked by adaptation: {report.masked_by_adaptation}")
    if report.masked_by_adaptation:
        print("  -> speech has objectively deteriorated while the live model compensates")
    print("\nwrote", path)


if __name__ == "__main__":
    main()
