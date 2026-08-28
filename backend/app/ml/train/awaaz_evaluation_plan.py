"""Privacy-safe readiness and split planning for a verified local Awaaz archive.

This module does not train or evaluate a model. It converts an already verified,
single-patient archive into an aggregate corpus-readiness report and, only when the corpus
is large and varied enough, a deterministic phrase-disjoint split plan. The report contains
capture UUIDs but never patient identity, transcripts, audio, or audio hashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from .awaaz_archive import (
    VerifiedAwaazArchive,
    VerifiedAwaazPair,
    verify_awaaz_training_archive,
)
from .common import SEED
from .personalised_asr_adapter import MIN_PAIRS_TO_TRAIN

SCHEMA_VERSION = 1
PILOT_PAIR_TARGET = 200
MIN_PHRASE_GROUPS_FOR_SPLIT = 10
VALIDATION_FRACTION = 0.15
TEST_FRACTION = 0.15


def _normalise_phrase(text: str) -> str:
    """Return the comparison form used only in memory to prevent phrase leakage."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _group_digest(pair: VerifiedAwaazPair, seed: int) -> str:
    """Order phrase groups reproducibly without publishing a transcript-derived hash."""
    normalised = _normalise_phrase(pair.target_text)
    material = f"{seed}\0{pair.lang}\0{normalised}".encode()
    return hashlib.sha256(material).hexdigest()


def _split_group_counts(n_groups: int) -> tuple[int, int, int]:
    """Allocate whole phrase groups while guaranteeing all three splits are present."""
    n_validation = max(1, round(n_groups * VALIDATION_FRACTION))
    n_test = max(1, round(n_groups * TEST_FRACTION))
    n_train = n_groups - n_validation - n_test
    if n_train < 1:
        raise ValueError("at least three phrase groups are required for a three-way split")
    return n_train, n_validation, n_test


def _build_split_plan(
    phrase_groups: dict[tuple[str, str], list[VerifiedAwaazPair]],
    seed: int,
) -> dict:
    ordered_groups = sorted(
        phrase_groups.values(),
        key=lambda pairs: (
            _group_digest(pairs[0], seed),
            min(str(pair.capture_id) for pair in pairs),
        ),
    )
    n_train, n_validation, _ = _split_group_counts(len(ordered_groups))
    grouped_splits = {
        "train": ordered_groups[:n_train],
        "validation": ordered_groups[n_train:n_train + n_validation],
        "test": ordered_groups[n_train + n_validation:],
    }
    assignments = {
        name: sorted(str(pair.capture_id) for group in groups for pair in group)
        for name, groups in grouped_splits.items()
    }
    return {
        "status": "planned_not_executed",
        "seed": seed,
        "unit": "exact_normalised_phrase_within_language",
        "target_group_fractions": {
            "train": 1 - VALIDATION_FRACTION - TEST_FRACTION,
            "validation": VALIDATION_FRACTION,
            "test": TEST_FRACTION,
        },
        "group_counts": {
            name: len(groups) for name, groups in grouped_splits.items()
        },
        "pair_counts": {
            name: len(capture_ids) for name, capture_ids in assignments.items()
        },
        "capture_ids": assignments,
    }


def build_awaaz_corpus_plan(
    archive: VerifiedAwaazArchive,
    *,
    seed: int = SEED,
) -> dict:
    """Build a non-clinical readiness report without exposing archive contents."""
    phrase_groups: dict[tuple[str, str], list[VerifiedAwaazPair]] = defaultdict(list)
    for pair in archive.pairs:
        phrase_groups[(pair.lang, _normalise_phrase(pair.target_text))].append(pair)

    n_pairs = len(archive.pairs)
    n_phrase_groups = len(phrase_groups)
    pair_gate_passed = n_pairs >= MIN_PAIRS_TO_TRAIN
    phrase_gate_passed = n_phrase_groups >= MIN_PHRASE_GROUPS_FOR_SPLIT
    ready = pair_gate_passed and phrase_gate_passed
    blockers = []
    if not pair_gate_passed:
        blockers.append("minimum_pair_count_not_met")
    if not phrase_gate_passed:
        blockers.append("minimum_distinct_phrase_count_not_met")

    payload = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "awaaz_corpus_readiness",
        "status": "split_plan_ready" if ready else "collect_more",
        "source": "verified_local_awaaz_archive",
        "claims": {
            "model_trained": False,
            "evaluation_run": False,
            "clinical_metrics": False,
            "deployment_ready": False,
        },
        "privacy": {
            "contains_audio": False,
            "contains_transcripts": False,
            "contains_audio_hashes": False,
            "contains_patient_id": False,
            "contains_capture_ids": ready,
        },
        "corpus": {
            "pair_count": n_pairs,
            "distinct_phrase_groups": n_phrase_groups,
            "total_duration_seconds": round(
                sum(pair.duration_seconds for pair in archive.pairs), 3,
            ),
            "languages": dict(sorted(Counter(pair.lang for pair in archive.pairs).items())),
            "sources": dict(sorted(Counter(pair.source for pair in archive.pairs).items())),
        },
        "readiness_gates": {
            "minimum_pairs": {
                "required": MIN_PAIRS_TO_TRAIN,
                "observed": n_pairs,
                "passed": pair_gate_passed,
            },
            "minimum_phrase_groups": {
                "required": MIN_PHRASE_GROUPS_FOR_SPLIT,
                "observed": n_phrase_groups,
                "passed": phrase_gate_passed,
            },
            "pilot_pair_target": {
                "target": PILOT_PAIR_TARGET,
                "observed": n_pairs,
                "met": n_pairs >= PILOT_PAIR_TARGET,
                "hard_gate": False,
            },
        },
        "blockers": blockers,
        "human_listener_evaluation": {
            "status": "not_run",
            "primary_metric": "listener_intelligibility_gain",
            "requires": [
                "approved human-participant protocol",
                "consented listener ratings",
                "predefined statistical analysis",
            ],
        },
        "shared_model_evaluation": {
            "status": "blocked",
            "reason": (
                "A single-patient archive cannot provide a speaker-disjoint split. "
                "A separately consented multi-patient cohort is required."
            ),
        },
        "limitations": [
            "This artifact is corpus planning only; it contains no model or performance metric.",
            "Phrase groups use exact Unicode-normalised text within each language and do not "
            "detect paraphrases or translated equivalents.",
            "A per-patient adapter necessarily uses one speaker. The planned split measures "
            "held-out phrase generalisation, not generalisation to unseen speakers.",
            "Word error rate is not a substitute for listener intelligibility gain.",
        ],
    }
    if ready:
        payload["split_plan"] = _build_split_plan(phrase_groups, seed)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit("Output already exists; choose a new path instead of overwriting it.")
    created_output = False
    try:
        if args.archive.resolve() == args.out.resolve():
            raise SystemExit("Output path must be different from the source archive.")
        verified = verify_awaaz_training_archive(args.archive)
        payload = build_awaaz_corpus_plan(verified)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created_output = True
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(payload, destination, indent=2)
            destination.write("\n")
    except Exception:
        if created_output:
            args.out.unlink(missing_ok=True)
        raise

    print(
        f"verified {len(verified.pairs)} local Awaaz pairs; wrote a corpus-readiness "
        f"artifact with status={payload['status']}; model_trained=false; evaluation_run=false"
    )


if __name__ == "__main__":
    main()
