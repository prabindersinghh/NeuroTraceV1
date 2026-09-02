"""Leakage-safe cohort planning across verified local Awaaz archives.

This command does not pool, extract, train on, or evaluate patient media. It verifies each
single-patient archive in memory, then plans only when whole speakers and exact normalised
phrases can both remain isolated between train, validation, and test. Shared phrases connect
speakers into an indivisible component; if fewer than three components remain, the command
reports the blocker instead of manufacturing a leaky split.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from .awaaz_archive import (
    VerifiedAwaazArchive,
    VerifiedAwaazPair,
    verify_awaaz_training_archive,
)
from .awaaz_evaluation_plan import normalise_phrase
from .common import SEED

SCHEMA_VERSION = 1
MIN_SPEAKERS_FOR_THREE_WAY_SPLIT = 3
MIN_COMPONENTS_FOR_THREE_WAY_SPLIT = 3
PILOT_SPEAKER_TARGET = 10
TARGET_FRACTIONS = {"train": 0.70, "validation": 0.15, "test": 0.15}
SPLIT_NAMES = tuple(TARGET_FRACTIONS)


@dataclass(frozen=True, slots=True)
class _CohortComponent:
    speaker_indexes: tuple[int, ...]
    pairs: tuple[VerifiedAwaazPair, ...]


def _component_digest(
    component: _CohortComponent,
    archives: tuple[VerifiedAwaazArchive, ...],
    seed: int,
) -> str:
    material = "\0".join(
        [str(seed)]
        + sorted(str(archives[index].patient_id) for index in component.speaker_indexes)
    )
    return hashlib.sha256(material.encode()).hexdigest()


def _build_components(
    archives: tuple[VerifiedAwaazArchive, ...],
) -> tuple[list[_CohortComponent], dict[tuple[str, str], set[int]]]:
    parents = list(range(len(archives)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    phrase_speakers: dict[tuple[str, str], set[int]] = defaultdict(set)
    for speaker_index, archive in enumerate(archives):
        for pair in archive.pairs:
            phrase_speakers[(pair.lang, normalise_phrase(pair.target_text))].add(
                speaker_index,
            )
    for speaker_indexes in phrase_speakers.values():
        ordered = sorted(speaker_indexes)
        for other in ordered[1:]:
            union(ordered[0], other)

    grouped_speakers: dict[int, list[int]] = defaultdict(list)
    for speaker_index in range(len(archives)):
        grouped_speakers[find(speaker_index)].append(speaker_index)

    components = []
    for speaker_indexes in grouped_speakers.values():
        pairs = tuple(
            pair
            for speaker_index in speaker_indexes
            for pair in archives[speaker_index].pairs
        )
        components.append(_CohortComponent(tuple(sorted(speaker_indexes)), pairs))
    return components, phrase_speakers


def _build_split_plan(
    components: list[_CohortComponent],
    archives: tuple[VerifiedAwaazArchive, ...],
    seed: int,
) -> dict:
    ordered = sorted(
        components,
        key=lambda component: (
            -len(component.pairs),
            -len(component.speaker_indexes),
            _component_digest(component, archives, seed),
        ),
    )
    assigned: dict[str, list[_CohortComponent]] = {name: [] for name in SPLIT_NAMES}
    pair_load = {name: 0 for name in SPLIT_NAMES}

    # Seed every split before balancing the remainder. The largest component belongs in
    # train; the next two establish non-empty validation and test sets.
    for name, component in zip(SPLIT_NAMES, ordered[:3], strict=True):
        assigned[name].append(component)
        pair_load[name] += len(component.pairs)
    for component in ordered[3:]:
        destination = min(
            SPLIT_NAMES,
            key=lambda name: (
                pair_load[name] / TARGET_FRACTIONS[name],
                SPLIT_NAMES.index(name),
            ),
        )
        assigned[destination].append(component)
        pair_load[destination] += len(component.pairs)

    capture_ids = {
        name: sorted(
            str(pair.capture_id)
            for component in split_components
            for pair in component.pairs
        )
        for name, split_components in assigned.items()
    }
    return {
        "status": "planned_not_executed",
        "seed": seed,
        "unit": "speaker_phrase_connected_component",
        "allocation": "largest_component_first_then_target_fraction_greedy",
        "invariants": {
            "speaker_disjoint": True,
            "exact_normalised_phrase_within_language_disjoint": True,
        },
        "target_pair_fractions": TARGET_FRACTIONS,
        "component_counts": {
            name: len(split_components)
            for name, split_components in assigned.items()
        },
        "speaker_counts": {
            name: sum(
                len(component.speaker_indexes) for component in split_components
            )
            for name, split_components in assigned.items()
        },
        "pair_counts": {
            name: len(ids) for name, ids in capture_ids.items()
        },
        "capture_ids": capture_ids,
    }


def build_awaaz_cohort_plan(
    archives: list[VerifiedAwaazArchive] | tuple[VerifiedAwaazArchive, ...],
    *,
    seed: int = SEED,
) -> dict:
    """Build a privacy-safe shared-model split plan from verified patient archives."""
    verified = tuple(archives)
    if not verified:
        raise ValueError("at least one verified Awaaz archive is required")
    patient_ids = [archive.patient_id for archive in verified]
    if len(patient_ids) != len(set(patient_ids)):
        raise ValueError("the cohort repeats a patient archive")
    capture_ids = [pair.capture_id for archive in verified for pair in archive.pairs]
    if len(capture_ids) != len(set(capture_ids)):
        raise ValueError("the cohort repeats an audio capture")

    components, phrase_speakers = _build_components(verified)
    pairs = tuple(pair for archive in verified for pair in archive.pairs)
    n_speakers = len(verified)
    n_components = len(components)
    speaker_gate = n_speakers >= MIN_SPEAKERS_FOR_THREE_WAY_SPLIT
    component_gate = n_components >= MIN_COMPONENTS_FOR_THREE_WAY_SPLIT
    ready = speaker_gate and component_gate
    blockers = []
    if not speaker_gate:
        blockers.append("minimum_speaker_count_not_met")
    if not component_gate:
        blockers.append("speaker_phrase_components_cannot_fill_three_splits")

    payload = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "awaaz_cohort_readiness",
        "status": "split_plan_ready" if ready else "collect_more_or_redesign_prompts",
        "source": "verified_local_awaaz_archives",
        "claims": {
            "archives_pooled": False,
            "model_trained": False,
            "evaluation_run": False,
            "clinical_metrics": False,
            "deployment_ready": False,
        },
        "privacy": {
            "contains_audio": False,
            "contains_transcripts": False,
            "contains_audio_hashes": False,
            "contains_patient_ids": False,
            "contains_capture_ids": ready,
        },
        "cohort": {
            "speaker_count": n_speakers,
            "pair_count": len(pairs),
            "distinct_phrase_groups": len(phrase_speakers),
            "speaker_phrase_components": n_components,
            "cross_speaker_phrase_groups": sum(
                len(speaker_indexes) > 1
                for speaker_indexes in phrase_speakers.values()
            ),
            "largest_component_speakers": max(
                len(component.speaker_indexes) for component in components
            ),
            "total_duration_seconds": round(
                sum(pair.duration_seconds for pair in pairs), 3,
            ),
            "languages": dict(sorted(Counter(pair.lang for pair in pairs).items())),
            "sources": dict(sorted(Counter(pair.source for pair in pairs).items())),
        },
        "readiness_gates": {
            "minimum_speakers_for_three_way_split": {
                "required": MIN_SPEAKERS_FOR_THREE_WAY_SPLIT,
                "observed": n_speakers,
                "passed": speaker_gate,
            },
            "minimum_independent_components": {
                "required": MIN_COMPONENTS_FOR_THREE_WAY_SPLIT,
                "observed": n_components,
                "passed": component_gate,
            },
            "pilot_speaker_target": {
                "target": PILOT_SPEAKER_TARGET,
                "observed": n_speakers,
                "met": n_speakers >= PILOT_SPEAKER_TARGET,
                "hard_gate": False,
            },
        },
        "blockers": blockers,
        "human_listener_evaluation": {
            "status": "not_run",
            "primary_metric": "listener_intelligibility_gain",
        },
        "limitations": [
            "This artifact is cohort planning only; archives remain separate and no model "
            "or performance metric is produced.",
            "Exact Unicode-normalised phrases connect speakers. Shared default board phrases "
            "may collapse a cohort into one component and require prospectively reserved "
            "test prompts.",
            "Exact matching does not detect paraphrases or translated equivalents.",
            "Archive schema v1 has no severity, etiology, gender, or SLP-annotation fields, "
            "so clinical test-set diversity cannot be checked here.",
            "Local export consent is not pooled-research consent; a separate approved data "
            "governance protocol remains required.",
        ],
    }
    if ready:
        payload["split_plan"] = _build_split_plan(components, verified, seed)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--archive", type=Path, action="append", required=True,
        help="One verified single-patient tar; repeat this option for every patient.",
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit("Output already exists; choose a new path instead of overwriting it.")
    created_output = False
    try:
        resolved_output = args.out.resolve()
        if any(path.resolve() == resolved_output for path in args.archive):
            raise SystemExit("Output path must be different from every source archive.")
        archives = [verify_awaaz_training_archive(path) for path in args.archive]
        payload = build_awaaz_cohort_plan(archives)
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
        f"verified {len(archives)} patient archives and "
        f"{sum(len(archive.pairs) for archive in archives)} pairs; wrote a cohort-readiness "
        f"artifact with status={payload['status']}; model_trained=false; evaluation_run=false"
    )


if __name__ == "__main__":
    main()
