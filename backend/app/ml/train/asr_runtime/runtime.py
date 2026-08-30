"""Fail-closed MMS/Wav2Vec2-CTC LoRA training runtime for Awaaz.

This module is intentionally isolated from the API process.  Importing it never imports
PyTorch, Transformers, PEFT, or patient media.  A real training run is reachable only after
all of these gates pass:

* a cryptographically verified, time-bounded governance receipt explicitly authorises the
  single-patient CTC-LoRA purpose;
* the receipt is bound to the exact archive, patient UUID, language, and local base-model
  tree by SHA-256;
* the existing non-extracting Awaaz archive verifier accepts every member;
* duplicate-audio groups and exact normalised phrases form disjoint train/validation/test
  components; and
* the local-only ML runtime and a Wav2Vec2 CTC checkpoint are present.

The synthetic smoke command exercises deterministic splitting and private manifest writing.
It deliberately creates no model and reports no metric.  The real trainer performs an
actual PEFT LoRA optimisation loop over in-memory 16 kHz PCM WAVs, but its resulting adapter
is labelled unvalidated and not deployment-ready.  Patient IDs, transcripts, capture IDs,
audio bytes, and audio hashes are never printed or written to the run manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib
import importlib.metadata
import importlib.util
import io
import json
import math
import os
import random
import re
import shutil
import stat
import sys
import tempfile
import unicodedata
import uuid
import wave
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any, Iterable, Protocol, Sequence

from ..awaaz_archive import VerifiedAwaazArchive, VerifiedAwaazPair, verify_awaaz_training_archive


SCHEMA_VERSION = 1
RECEIPT_SCHEMA_VERSION = 1
RECEIPT_TYPE = "awaaz_asr_training_governance"
APPROVED_PURPOSE = "single_patient_mms_wav2vec2_ctc_lora"
REQUIRED_CONSENT_SCOPES = frozenset({"asr_training", "patient_specific_adapter_storage"})
SUPPORTED_LANGUAGES = frozenset({"en", "hi", "pa"})
SUPPORTED_MODEL_TYPES = frozenset({"wav2vec2"})
MMS_LANGUAGE_CODES = {"en": "eng", "hi": "hin", "pa": "pan"}
DEFAULT_TARGET_MODULES = ("q_proj", "v_proj")
MANIFEST_NAME = "manifest.json"
MAX_RECEIPT_BYTES = 256_000
MAX_KEY_BYTES = 4_096
MAX_RECEIPT_VALIDITY = timedelta(hours=24)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
TARGET_FRACTIONS = {"train": 0.70, "validation": 0.15, "test": 0.15}
SPLIT_NAMES = tuple(TARGET_FRACTIONS)
HARD_MINIMUM_PAIRS = 50
HARD_MINIMUM_COMPONENTS = 10
# Split adequacy.  Disjointness alone admits a legal split whose test partition is a single
# utterance while the manifest still advertises a 70/15/15 target.  Every partition must
# therefore hold at least MINIMUM_SPLIT_SAMPLES rows and at least half of its target share,
# and none may swallow more than twice its target share -- the bound that stops validation
# taking a third of a corpus it is supposed to take a seventh of.
MINIMUM_SPLIT_SAMPLES = 5
MINIMUM_SPLIT_SHARE_OF_TARGET = 0.5
MAXIMUM_SPLIT_SHARE_OF_TARGET = 2.0
# Generated-metadata screening.  See `_screened_phrases` for why short utterances are
# deliberately excluded, and `_safetensors_header_text` for what is and is not read.
MINIMUM_SCREENED_PHRASE_CHARACTERS = 12
MINIMUM_SCREENED_PHRASE_WORDS = 2
MAX_SCREENED_TEXT_BYTES = 2_000_000
MAX_SAFETENSORS_HEADER_BYTES = 1_000_000
SCREENED_TEXT_SUFFIXES = frozenset(
    {".json", ".jsonl", ".md", ".markdown", ".txt", ".text", ".yaml", ".yml", ".cfg", ".ini"}
)
# Present only while an output directory is mid-publication; see `_publish_staging`.
INCOMPLETE_PUBLICATION_SENTINEL = ".incomplete"
PINNED_DEPENDENCY_VERSIONS = {
    "numpy": "1.26.4",
    "torch": "2.4.1",
    "transformers": "4.44.2",
    "peft": "0.12.0",
    "accelerate": "0.34.2",
    "safetensors": "0.4.5",
}


class _PairLike(Protocol):
    lang: str
    target_text: str


class PrivacySafeRuntimeError(RuntimeError):
    """An error whose public string never incorporates sensitive input values."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(f"{code}: {message}")


class PreflightError(PrivacySafeRuntimeError):
    """A privacy-safe refusal raised before the ML stack can be imported."""


class TrainingRuntimeError(PrivacySafeRuntimeError):
    """A privacy-safe failure from the local training or artifact stage."""


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    """Configuration for one explicitly authorised, single-patient adapter run."""

    archive_path: Path = field(repr=False)
    receipt_path: Path = field(repr=False)
    base_model_path: Path = field(repr=False)
    output_dir: Path = field(repr=False)
    governance_key_id: str = ""
    governance_key_sha256: str = ""
    language: str = "en"
    seed: int = 42
    epochs: int = 1
    batch_size: int = 2
    gradient_accumulation_steps: int = 1
    learning_rate: float = 1e-4
    max_optimizer_steps: int = 100
    max_grad_norm: float = 1.0
    minimum_pairs: int = HARD_MINIMUM_PAIRS
    minimum_components: int = HARD_MINIMUM_COMPONENTS
    lora_rank: int = 8
    lora_alpha: int = 16
    lora_dropout: float = 0.05
    target_modules: tuple[str, ...] = DEFAULT_TARGET_MODULES
    device: str = "auto"


@dataclass(frozen=True, slots=True)
class SplitPlan:
    """Index-only split plan; sensitive grouping keys never leave process memory."""

    train: tuple[int, ...]
    validation: tuple[int, ...]
    test: tuple[int, ...]
    component_counts: dict[str, int]
    sample_counts: dict[str, int]
    seed: int
    group_unit: str

    def as_manifest(self) -> dict[str, Any]:
        total = sum(self.sample_counts.values())
        bounds = _split_size_bounds(total)
        return {
            "unit": "group_phrase_connected_component",
            "group_unit": self.group_unit,
            "allocation": "minimum_size_floor_first_then_target_fraction_greedy",
            "seed": self.seed,
            "target_sample_fractions": dict(TARGET_FRACTIONS),
            # Connected components are indivisible, so the achieved split is routinely
            # coarser than the target.  A manifest that states only the target lets a reader
            # believe the test partition holds 15% of the corpus when it may hold 2%; the
            # achieved fractions and the bounds they had to satisfy are stated beside it.
            "actual_sample_fractions": {
                name: (round(self.sample_counts[name] / total, 4) if total else 0.0)
                for name in SPLIT_NAMES
            },
            "required_sample_count_bounds": {
                name: {"minimum": bounds[name][0], "maximum": bounds[name][1]}
                for name in SPLIT_NAMES
            },
            "component_counts": dict(self.component_counts),
            "sample_counts": dict(self.sample_counts),
            "assignments_in_manifest": False,
            "invariants": {
                "group_disjoint": True,
                "exact_normalised_phrase_within_language_disjoint": True,
                "speaker_disjoint": False,
            },
            "scope": "within_patient_held_out_phrase_evaluation",
        }


@dataclass(frozen=True, slots=True)
class VerifiedGovernanceReceipt:
    receipt_sha256: str
    archive_sha256: str
    base_model_sha256: str
    language: str
    key_id: str
    patient_id: uuid.UUID = field(repr=False)


@dataclass(frozen=True, slots=True)
class DependencyReport:
    versions: dict[str, str]


@dataclass(frozen=True, slots=True)
class PreparedRun:
    """Preflight result.  The verified media object is deliberately hidden from repr."""

    config: RuntimeConfig = field(repr=False)
    receipt: VerifiedGovernanceReceipt = field(repr=False)
    split: SplitPlan
    dependencies: DependencyReport
    pair_count: int
    component_count: int
    total_duration_seconds: float
    source_counts: dict[str, int]
    base_model_type: str
    uses_mms_language_adapter: bool
    archive: VerifiedAwaazArchive = field(repr=False)
    selected_pairs: tuple[VerifiedAwaazPair, ...] = field(repr=False)


@dataclass(frozen=True, slots=True)
class _SyntheticPair:
    lang: str
    target_text: str


def normalise_phrase(text: str) -> str:
    """Normalise only for in-memory leakage checks; never persist the result."""
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def sha256_file(path: Path) -> str:
    """Hash one regular file without loading it into memory."""
    candidate = Path(path)
    if not candidate.is_file():
        raise PreflightError("input_not_regular_file", "A required input is not a regular file.")
    digest = hashlib.sha256()
    try:
        with candidate.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        raise PreflightError("input_unreadable", "A required input cannot be read.") from None
    return digest.hexdigest()


def sha256_directory(path: Path) -> str:
    """Hash relative filenames and contents for a complete local checkpoint tree."""
    root = Path(path)
    if root.is_symlink() or not root.is_dir():
        raise PreflightError("base_model_missing", "The local base-model directory is missing.")
    digest = hashlib.sha256()
    file_count = 0
    try:
        all_items = tuple(root.rglob("*"))
        if any(item.is_symlink() for item in all_items):
            raise PreflightError(
                "base_model_symlink_rejected",
                "The local base-model tree must be a self-contained snapshot without symlinks.",
            )
        candidates = sorted(
            (item for item in all_items if item.is_file()),
            key=lambda item: item.relative_to(root).as_posix(),
        )
        for item in candidates:
            relative = item.relative_to(root).as_posix().encode("utf-8")
            digest.update(len(relative).to_bytes(8, "big"))
            digest.update(relative)
            size = item.stat().st_size
            digest.update(size.to_bytes(8, "big"))
            with item.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            file_count += 1
    except (OSError, UnicodeError, ValueError):
        raise PreflightError(
            "base_model_unreadable", "The local base-model directory cannot be hashed safely."
        ) from None
    if file_count == 0:
        raise PreflightError("base_model_empty", "The local base-model directory is empty.")
    return digest.hexdigest()


def _canonical_receipt_bytes(receipt: dict[str, Any]) -> bytes:
    unsigned = dict(receipt)
    signature = unsigned.get("signature")
    if isinstance(signature, dict):
        unsigned["signature"] = {
            key: value for key, value in signature.items() if key != "digest"
        }
    try:
        return json.dumps(
            unsigned,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise PreflightError("receipt_invalid", "The governance receipt is not canonical JSON.") from None


def governance_receipt_signature(receipt: dict[str, Any], key: bytes) -> str:
    """Return the HMAC digest used by the external governance receipt issuer.

    This helper makes the canonicalisation contract testable.  Possession and protection of
    the signing key remain an operational governance responsibility; the trainer never
    creates or amends receipts.
    """
    if not isinstance(key, bytes) or not 32 <= len(key) <= MAX_KEY_BYTES:
        raise PreflightError(
            "receipt_key_invalid", "The governance verification key has an invalid length."
        )
    return hmac.new(key, _canonical_receipt_bytes(receipt), hashlib.sha256).hexdigest()


def _parse_aware_timestamp(value: Any, *, field_name: str) -> datetime:
    if not isinstance(value, str):
        raise PreflightError("receipt_invalid", f"The receipt {field_name} timestamp is invalid.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise PreflightError("receipt_invalid", f"The receipt {field_name} timestamp is invalid.") from None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise PreflightError(
            "receipt_invalid", f"The receipt {field_name} timestamp must include a timezone."
        )
    return parsed.astimezone(timezone.utc)


def _read_json_object(path: Path, *, maximum_bytes: int, error_code: str) -> tuple[dict[str, Any], bytes]:
    candidate = Path(path)
    if not candidate.is_file():
        raise PreflightError(error_code, "A required JSON input is missing.")
    try:
        size = candidate.stat().st_size
        if not 1 <= size <= maximum_bytes:
            raise PreflightError(error_code, "A required JSON input has an invalid size.")
        raw = candidate.read_bytes()
        def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate JSON key")
                result[key] = value
            return result

        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    except PreflightError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise PreflightError(error_code, "A required JSON input is not valid UTF-8 JSON.") from None
    if not isinstance(parsed, dict):
        raise PreflightError(error_code, "A required JSON input must be an object.")
    return parsed, raw


def verify_governance_receipt(
    path: Path,
    key: bytes,
    *,
    expected_archive_sha256: str | None,
    expected_base_model_sha256: str | None,
    expected_patient_id: uuid.UUID | None,
    expected_language: str,
    now: datetime | None = None,
) -> VerifiedGovernanceReceipt:
    """Verify authenticity, expiry, scope, and exact input/subject binding."""
    receipt, raw = _read_json_object(
        Path(path), maximum_bytes=MAX_RECEIPT_BYTES, error_code="receipt_invalid"
    )
    if not isinstance(key, bytes) or not 32 <= len(key) <= MAX_KEY_BYTES:
        raise PreflightError(
            "receipt_key_invalid", "The governance verification key has an invalid length."
        )

    signature = receipt.get("signature")
    if not isinstance(signature, dict):
        raise PreflightError("receipt_signature_invalid", "The governance receipt has no valid signature.")
    if (
        signature.get("algorithm") != "HMAC-SHA256"
        or not isinstance(signature.get("key_id"), str)
        or not signature["key_id"].strip()
    ):
        raise PreflightError("receipt_signature_invalid", "The governance receipt signature is unsupported.")
    supplied_digest = signature.get("digest")
    if not isinstance(supplied_digest, str) or SHA256_PATTERN.fullmatch(supplied_digest) is None:
        raise PreflightError("receipt_signature_invalid", "The governance receipt signature is malformed.")
    expected_digest = governance_receipt_signature(receipt, key)
    if not hmac.compare_digest(supplied_digest, expected_digest):
        raise PreflightError("receipt_signature_invalid", "The governance receipt signature did not verify.")

    if receipt.get("schema_version") != RECEIPT_SCHEMA_VERSION or receipt.get("receipt_type") != RECEIPT_TYPE:
        raise PreflightError("receipt_schema_unsupported", "The governance receipt schema is unsupported.")
    try:
        uuid.UUID(str(receipt.get("receipt_id")))
        receipt_patient = uuid.UUID(str(receipt.get("data_subject_id")))
    except (TypeError, ValueError, AttributeError):
        raise PreflightError("receipt_invalid", "The governance receipt identifiers are invalid.") from None
    if receipt.get("status") != "approved" or receipt.get("purpose") != APPROVED_PURPOSE:
        raise PreflightError("receipt_not_approved", "The governance receipt does not approve this purpose.")
    if receipt.get("archive_export_receipt_acknowledged") is not True:
        raise PreflightError("receipt_not_approved", "The local archive handoff is not acknowledged.")
    if receipt.get("language") != expected_language:
        raise PreflightError(
            "receipt_input_mismatch", "The receipt does not authorise the selected language."
        )

    archive_digest = receipt.get("archive_sha256")
    model_digest = receipt.get("base_model_sha256")
    if (
        not isinstance(archive_digest, str)
        or not isinstance(model_digest, str)
        or SHA256_PATTERN.fullmatch(archive_digest) is None
        or SHA256_PATTERN.fullmatch(model_digest) is None
    ):
        raise PreflightError("receipt_input_mismatch", "The receipt is not bound to both training inputs.")
    if expected_archive_sha256 is not None:
        if SHA256_PATTERN.fullmatch(expected_archive_sha256) is None or not hmac.compare_digest(
            archive_digest, expected_archive_sha256
        ):
            raise PreflightError(
                "receipt_input_mismatch", "The archive does not match the approved receipt."
            )
    if expected_base_model_sha256 is not None:
        if SHA256_PATTERN.fullmatch(expected_base_model_sha256) is None or not hmac.compare_digest(
            model_digest, expected_base_model_sha256
        ):
            raise PreflightError(
                "receipt_input_mismatch", "The base model does not match the approved receipt."
            )
    if expected_patient_id is not None and not hmac.compare_digest(
        str(receipt_patient), str(expected_patient_id)
    ):
        raise PreflightError(
            "receipt_subject_mismatch", "The archive subject does not match the approved receipt."
        )

    consent = receipt.get("consent")
    if not isinstance(consent, dict):
        raise PreflightError("consent_missing", "Explicit training consent is missing.")
    raw_scopes = consent.get("scopes")
    scopes = (
        set(raw_scopes)
        if isinstance(raw_scopes, list) and all(isinstance(value, str) for value in raw_scopes)
        else set()
    )
    if consent.get("granted") is not True or consent.get("revoked") is not False:
        raise PreflightError("consent_not_active", "Explicit training consent is not active.")
    if not REQUIRED_CONSENT_SCOPES.issubset(scopes):
        raise PreflightError(
            "consent_scope_missing", "Explicit consent does not cover this training purpose."
        )

    governance = receipt.get("governance")
    if not isinstance(governance, dict) or governance.get("approved") is not True:
        raise PreflightError("governance_not_approved", "The governance protocol is not approved.")
    if not all(
        isinstance(governance.get(name), str) and governance[name].strip()
        for name in ("protocol_id", "approval_id")
    ):
        raise PreflightError("governance_not_approved", "The governance approval references are incomplete.")

    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    approved_at = _parse_aware_timestamp(receipt.get("approved_at"), field_name="approved_at")
    expires_at = _parse_aware_timestamp(receipt.get("expires_at"), field_name="expires_at")
    consent_at = _parse_aware_timestamp(consent.get("recorded_at"), field_name="consent.recorded_at")
    governance_at = _parse_aware_timestamp(
        governance.get("approved_at"), field_name="governance.approved_at"
    )
    revocation_checked_at = _parse_aware_timestamp(
        receipt.get("revocation_checked_at"), field_name="revocation_checked_at"
    )
    if any(
        moment > current
        for moment in (approved_at, consent_at, governance_at, revocation_checked_at)
    ):
        raise PreflightError("receipt_not_yet_valid", "The governance receipt is not yet valid.")
    if expires_at <= current or expires_at <= approved_at:
        raise PreflightError("receipt_expired", "The governance receipt has expired.")
    if current - revocation_checked_at > MAX_RECEIPT_VALIDITY:
        raise PreflightError(
            "revocation_check_stale", "The signed consent revocation check is too old."
        )
    if consent_at > approved_at or governance_at > approved_at or revocation_checked_at < approved_at:
        raise PreflightError(
            "receipt_time_order_invalid", "The signed consent and approval timestamps are inconsistent."
        )
    if expires_at - approved_at > MAX_RECEIPT_VALIDITY:
        raise PreflightError(
            "receipt_validity_too_long", "The governance receipt validity window is too long."
        )

    return VerifiedGovernanceReceipt(
        receipt_sha256=hashlib.sha256(raw).hexdigest(),
        archive_sha256=archive_digest,
        base_model_sha256=model_digest,
        language=expected_language,
        key_id=signature["key_id"],
        patient_id=receipt_patient,
    )


def _component_digest(
    indexes: Iterable[int],
    samples: Sequence[_PairLike],
    seed: int,
) -> str:
    """Stable in-memory ordering material; this digest is never persisted."""
    material = [str(seed)]
    for index in sorted(indexes):
        sample = samples[index]
        material.append(f"{sample.lang}\0{normalise_phrase(sample.target_text)}")
    return hashlib.sha256("\0".join(sorted(material)).encode("utf-8")).hexdigest()


def _split_size_bounds(total_samples: int) -> dict[str, tuple[int, int]]:
    """Return the inclusive (minimum, maximum) sample count each partition must hold.

    The floor is relative to the target share rather than a flat count so that it scales
    with the corpus, with an absolute floor underneath it: a two-row test partition is
    equally useless at 50 pairs and at 5,000, but only the second reads as obviously wrong.
    For a corpus far below the authorised minimum the relative maximum can fall under the
    absolute floor; it is clamped so the reported bounds are never self-contradictory.
    Such a corpus cannot reach real training anyway -- `corpus_too_small` refuses it first.
    """
    bounds: dict[str, tuple[int, int]] = {}
    for name, fraction in TARGET_FRACTIONS.items():
        target = fraction * total_samples
        minimum = min(
            max(MINIMUM_SPLIT_SAMPLES, math.ceil(target * MINIMUM_SPLIT_SHARE_OF_TARGET)),
            max(total_samples, 1),
        )
        maximum = max(math.floor(target * MAXIMUM_SPLIT_SHARE_OF_TARGET), minimum)
        bounds[name] = (minimum, maximum)
    return bounds


def _assert_split_adequate(split: SplitPlan) -> None:
    """Refuse a split whose partitions are too small or too large to support any claim.

    Disjointness is necessary but not sufficient.  A one-sample test partition is perfectly
    disjoint and passes every invariant in `build_group_phrase_disjoint_split`, yet nothing
    computed on it means anything -- and the manifest would still print a 15% target beside
    it.  Refusing here is the fail-closed reading: an inadequate corpus is not trained on.
    """
    total = sum(split.sample_counts.values())
    bounds = _split_size_bounds(total)
    for name in SPLIT_NAMES:
        minimum, maximum = bounds[name]
        count = split.sample_counts[name]
        if count < minimum:
            raise PreflightError(
                "split_too_small",
                "A train, validation, or test partition is below the minimum usable size.",
            )
        if count > maximum:
            raise PreflightError(
                "split_unbalanced",
                "A train, validation, or test partition exceeds its share of the corpus.",
            )


def build_group_phrase_disjoint_split(
    samples: Sequence[_PairLike],
    group_keys: Sequence[str],
    *,
    seed: int = 42,
    group_unit: str = "caller_supplied_group",
) -> SplitPlan:
    """Split samples by transitive group/phrase connected components.

    If A and B share a group, and B and C share a normalised phrase, all three remain in
    one component.  This is stronger than independently grouping and then shuffling: no
    bridge can leak a duplicate group or phrase across a boundary.
    """
    rows = tuple(samples)
    groups = tuple(group_keys)
    if len(rows) != len(groups) or not rows:
        raise PreflightError(
            "split_input_invalid", "Samples and grouping keys must be non-empty and aligned."
        )
    if any(not isinstance(value, str) or not value for value in groups):
        raise PreflightError("split_input_invalid", "Every sample requires a non-empty grouping key.")

    parents = list(range(len(rows)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            if left_root < right_root:
                parents[right_root] = left_root
            else:
                parents[left_root] = right_root

    first_by_group: dict[str, int] = {}
    first_by_phrase: dict[tuple[str, str], int] = {}
    for index, (sample, group_key) in enumerate(zip(rows, groups, strict=True)):
        phrase = normalise_phrase(sample.target_text)
        if sample.lang not in SUPPORTED_LANGUAGES or not phrase:
            raise PreflightError("split_input_invalid", "A split sample has invalid language or text.")
        if group_key in first_by_group:
            union(first_by_group[group_key], index)
        else:
            first_by_group[group_key] = index
        phrase_key = (sample.lang, phrase)
        if phrase_key in first_by_phrase:
            union(first_by_phrase[phrase_key], index)
        else:
            first_by_phrase[phrase_key] = index

    grouped: dict[int, list[int]] = defaultdict(list)
    for index in range(len(rows)):
        grouped[find(index)].append(index)
    components = sorted(
        (tuple(indexes) for indexes in grouped.values()),
        key=lambda indexes: (
            -len(indexes),
            _component_digest(indexes, rows, seed),
        ),
    )
    if len(components) < 3:
        raise PreflightError(
            "split_not_ready", "At least three independent group/phrase components are required."
        )

    assigned: dict[str, list[tuple[int, ...]]] = {name: [] for name in SPLIT_NAMES}
    loads = {name: 0 for name in SPLIT_NAMES}
    for name, component in zip(SPLIT_NAMES, components[:3], strict=True):
        assigned[name].append(component)
        loads[name] += len(component)
    minimum_samples = {
        name: bound[0] for name, bound in _split_size_bounds(len(rows)).items()
    }
    for component in components[3:]:
        # Bring every partition up to its adequacy floor before optimising the target
        # ratio.  Ratio-first allocation from the very first component is what allowed a
        # lumpy corpus to leave test on a single row while satisfying every disjointness
        # check.  This cannot weaken disjointness: components remain indivisible and each
        # still lands in exactly one partition, and the phase stops once no partition is
        # starved.  `_assert_split_adequate` still refuses a corpus that cannot get there.
        starved = [name for name in SPLIT_NAMES if loads[name] < minimum_samples[name]]
        candidates = starved or list(SPLIT_NAMES)
        weights = minimum_samples if starved else TARGET_FRACTIONS
        destination = min(
            candidates,
            key=lambda name: (
                loads[name] / weights[name],
                SPLIT_NAMES.index(name),
            ),
        )
        assigned[destination].append(component)
        loads[destination] += len(component)

    indexes_by_split = {
        name: tuple(sorted(index for component in assigned[name] for index in component))
        for name in SPLIT_NAMES
    }
    all_indexes = [index for name in SPLIT_NAMES for index in indexes_by_split[name]]
    if sorted(all_indexes) != list(range(len(rows))) or len(all_indexes) != len(set(all_indexes)):
        raise PreflightError("split_invariant_failed", "The split does not cover each sample exactly once.")

    group_destinations: dict[str, set[str]] = defaultdict(set)
    phrase_destinations: dict[tuple[str, str], set[str]] = defaultdict(set)
    for name in SPLIT_NAMES:
        for index in indexes_by_split[name]:
            group_destinations[groups[index]].add(name)
            phrase_destinations[(rows[index].lang, normalise_phrase(rows[index].target_text))].add(name)
    if any(len(names) != 1 for names in group_destinations.values()) or any(
        len(names) != 1 for names in phrase_destinations.values()
    ):
        raise PreflightError("split_invariant_failed", "A grouping key or phrase crosses split boundaries.")

    return SplitPlan(
        train=indexes_by_split["train"],
        validation=indexes_by_split["validation"],
        test=indexes_by_split["test"],
        component_counts={name: len(assigned[name]) for name in SPLIT_NAMES},
        sample_counts={name: len(indexes_by_split[name]) for name in SPLIT_NAMES},
        seed=seed,
        group_unit=group_unit,
    )


def build_phrase_disjoint_split(
    samples: Sequence[_PairLike],
    *,
    seed: int = 42,
) -> SplitPlan:
    """Convenience split where phrases are the only meaningful grouping boundary."""
    return build_group_phrase_disjoint_split(
        samples,
        [f"sample-{index}" for index in range(len(samples))],
        seed=seed,
        group_unit="unique_sample",
    )


def _validate_config(config: RuntimeConfig) -> None:
    if os.name != "posix":
        raise PreflightError(
            "platform_unsupported",
            "Private ASR training currently requires POSIX file modes and directory fsync.",
        )
    if config.language not in SUPPORTED_LANGUAGES:
        raise PreflightError("config_invalid", "The selected language is not supported.")
    if (
        not config.governance_key_id.strip()
        or SHA256_PATTERN.fullmatch(config.governance_key_sha256) is None
    ):
        raise PreflightError(
            "governance_trust_root_missing",
            "A pinned governance key identifier and SHA-256 fingerprint are required.",
        )
    if sys.version_info[:2] != (3, 11):
        raise PreflightError("python_runtime_unsupported", "Real ASR training requires Python 3.11.")
    integer_values = (
        config.seed,
        config.epochs,
        config.batch_size,
        config.gradient_accumulation_steps,
        config.max_optimizer_steps,
        config.minimum_pairs,
        config.minimum_components,
        config.lora_rank,
        config.lora_alpha,
    )
    if any(type(value) is not int for value in integer_values):
        raise PreflightError("config_invalid", "Integer training limits must use integer values.")
    if config.seed < 0 or any(value < 1 for value in integer_values[1:]):
        raise PreflightError("config_invalid", "Positive integer training limits are required.")
    if (
        config.minimum_pairs < HARD_MINIMUM_PAIRS
        or config.minimum_components < HARD_MINIMUM_COMPONENTS
    ):
        raise PreflightError(
            "config_invalid", "Corpus readiness thresholds may be made stricter but not weaker."
        )
    if (
        config.epochs > 100
        or config.batch_size > 64
        or config.gradient_accumulation_steps > 128
        or config.max_optimizer_steps > 1_000_000
        or config.minimum_pairs > 1_000
        or config.minimum_components > 1_000
        or config.lora_rank > 512
        or config.lora_alpha > 4_096
    ):
        raise PreflightError("config_invalid", "A training limit exceeds the runtime safety cap.")
    if (
        isinstance(config.learning_rate, bool)
        or isinstance(config.max_grad_norm, bool)
        or not isinstance(config.learning_rate, (int, float))
        or not isinstance(config.max_grad_norm, (int, float))
        or not math.isfinite(config.learning_rate)
        or not math.isfinite(config.max_grad_norm)
        or not 0 < config.learning_rate <= 0.01
        or not 0 < config.max_grad_norm <= 100
    ):
        raise PreflightError("config_invalid", "The optimiser configuration is outside safe bounds.")
    if (
        isinstance(config.lora_dropout, bool)
        or not isinstance(config.lora_dropout, (int, float))
        or not math.isfinite(config.lora_dropout)
        or not 0 <= config.lora_dropout < 1
        or not isinstance(config.target_modules, tuple)
        or not config.target_modules
    ):
        raise PreflightError("config_invalid", "The LoRA configuration is outside safe bounds.")
    if any(
        not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9_]+", name) is None
        for name in config.target_modules
    ):
        raise PreflightError("config_invalid", "LoRA target module names are invalid.")
    if config.device not in {"auto", "cpu", "cuda", "mps"}:
        raise PreflightError("config_invalid", "The requested runtime device is unsupported.")
    _assert_output_location_contained(
        config.output_dir, base_model_path=config.base_model_path
    )


def _assert_output_location_contained(
    output_dir: Path,
    *,
    base_model_path: Path | None = None,
) -> None:
    """Refuse an output location that is not a fresh directory inside an approved parent.

    This lives outside `_validate_config` because the synthetic smoke never builds a
    `RuntimeConfig` and so never reached those checks: `synthetic-smoke --output-dir` could
    create a directory and a manifest anywhere, including inside the tracked source tree
    that this module's own rule reserves for `data/`.  Every writing path now passes through
    here, before any mkdir.
    """
    output = Path(output_dir)
    if os.path.lexists(output):
        raise PreflightError(
            "output_exists", "The output directory already exists; it will not be overwritten."
        )
    if not output.parent.is_dir():
        # Refusing to create intermediate levels *is* the containment.  `mkdir(parents=True)`
        # turns one mistyped path segment into a whole new tree of private artifacts, and
        # nothing distinguishes that from an intended run root.  The operator provisions the
        # run root deliberately; the runtime only ever adds the final component -- which also
        # means a failed publish can leave no directory behind that the runtime created.
        raise PreflightError(
            "output_parent_missing",
            "The parent of the output directory must already exist; it is not created here.",
        )
    repo_root = Path(__file__).resolve().parents[5]
    private_repo_root = repo_root / "data"
    try:
        output.resolve().relative_to(repo_root)
    except ValueError:
        pass
    else:
        try:
            output.resolve().relative_to(private_repo_root)
        except ValueError:
            raise PreflightError(
                "unsafe_output_location",
                "Inside this repository, patient-specific artifacts may be written only under data/.",
            ) from None
    if base_model_path is not None:
        try:
            output.resolve().relative_to(Path(base_model_path).resolve())
        except ValueError:
            pass
        else:
            raise PreflightError(
                "unsafe_output_location",
                "The output directory cannot be inside the approved base-model tree.",
            )


def _stable_verify_archive(
    path: Path,
    *,
    expected_sha256: str | None = None,
) -> tuple[VerifiedAwaazArchive, str]:
    """Hash and verify one private snapshot read from a single source descriptor."""
    candidate = Path(path)
    snapshot_path: Path | None = None
    try:
        path_metadata = candidate.lstat()
        if stat.S_ISLNK(path_metadata.st_mode) or not stat.S_ISREG(path_metadata.st_mode):
            raise PreflightError("archive_invalid", "The training archive is not a regular file.")
    except OSError:
        raise PreflightError("archive_missing", "The approved training archive is missing.") from None
    try:
        source_descriptor = os.open(candidate, os.O_RDONLY)
        try:
            before = os.fstat(source_descriptor)
            # `dir=` is load-bearing, not tidiness. Without it mkstemp writes to the
            # shared system temp directory, which would put a byte-for-byte copy of every
            # consented WAV in this archive under /tmp -- contradicting INV-1 and
            # `awaaz_archive`'s own promise that it "never writes patient audio to disk".
            # The unlink below covers a normal exit and an exception, but not SIGKILL or a
            # power loss, and /tmp is outside data/, outside the ignore rules, and is not
            # encrypted at rest on many hosts. The archive's own directory already holds
            # this audio, so snapshotting beside it adds no exposure the operator has not
            # already accepted. An unwritable parent raises OSError and fails closed into
            # `archive_unreadable`, which is the correct outcome.
            temporary_descriptor, temporary_name = tempfile.mkstemp(
                prefix=".neurotrace-awaaz-approved-",
                suffix=".tar",
                dir=candidate.parent,
            )
            snapshot_path = Path(temporary_name)
            os.chmod(snapshot_path, 0o600)
            digest = hashlib.sha256()
            with os.fdopen(temporary_descriptor, "wb") as destination:
                while True:
                    chunk = os.read(source_descriptor, 1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
                    destination.write(chunk)
                destination.flush()
                os.fsync(destination.fileno())
            after = os.fstat(source_descriptor)
        finally:
            os.close(source_descriptor)
        before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        if before_identity != after_identity:
            raise PreflightError("archive_changed", "The training archive changed during verification.")
        archive_sha256 = digest.hexdigest()
        if expected_sha256 is not None and not hmac.compare_digest(
            archive_sha256, expected_sha256
        ):
            raise PreflightError(
                "receipt_input_mismatch", "The archive does not match the approved receipt."
            )
        try:
            archive = verify_awaaz_training_archive(snapshot_path)
        except (ValueError, OSError, EOFError):
            raise PreflightError(
                "archive_invalid", "The training archive failed strict verification."
            ) from None
        return archive, archive_sha256
    except PreflightError:
        raise
    except OSError:
        raise PreflightError(
            "archive_unreadable", "The training archive could not be privately snapshotted."
        ) from None
    finally:
        if snapshot_path is not None:
            snapshot_path.unlink(missing_ok=True)


def _validate_pcm_audio(pairs: Sequence[VerifiedAwaazPair]) -> None:
    for pair in pairs:
        try:
            with wave.open(io.BytesIO(pair.audio), "rb") as source:
                channels = source.getnchannels()
                width = source.getsampwidth()
                rate = source.getframerate()
                compression = source.getcomptype()
                frames = source.getnframes()
                expected_bytes = frames * channels * width
                payload = source.readframes(frames)
                trailing = source.readframes(1)
        except (wave.Error, EOFError, OSError):
            raise PreflightError("audio_contract_invalid", "An archive WAV failed PCM validation.") from None
        if (channels, width, rate, compression) != (1, 2, 16_000, "NONE"):
            raise PreflightError(
                "audio_contract_invalid", "Every training WAV must be mono 16-bit PCM at 16 kHz."
            )
        if frames < 4_000 or len(payload) != expected_bytes or trailing:
            raise PreflightError("audio_contract_invalid", "An archive WAV has an invalid frame payload.")
        actual_duration = frames / rate
        if abs(actual_duration - pair.duration_seconds) > max(0.05, 0.02 * actual_duration):
            raise PreflightError("audio_contract_invalid", "An archive WAV duration receipt is inconsistent.")


def _validate_no_conflicting_audio_labels(pairs: Sequence[VerifiedAwaazPair]) -> None:
    labels: dict[tuple[str, str], set[str]] = defaultdict(set)
    for pair in pairs:
        labels[(pair.lang, pair.sha256)].add(normalise_phrase(pair.target_text))
    if any(len(values) != 1 for values in labels.values()):
        raise PreflightError(
            "conflicting_audio_labels", "Identical audio is associated with conflicting target text."
        )


def _inspect_base_model(path: Path, *, language: str) -> tuple[str, bool]:
    root = Path(path)
    config_path = root / "config.json"
    config, _ = _read_json_object(
        config_path, maximum_bytes=2_000_000, error_code="base_model_invalid"
    )
    model_type = config.get("model_type")
    if model_type not in SUPPORTED_MODEL_TYPES:
        raise PreflightError(
            "base_model_unsupported", "Only a local Wav2Vec2 CTC checkpoint is accepted."
        )
    architectures = config.get("architectures")
    if (
        not isinstance(architectures, list)
        or "Wav2Vec2ForCTC" not in architectures
    ):
        raise PreflightError("base_model_unsupported", "The checkpoint is not a Wav2Vec2 CTC model.")
    weight_files = sorted(
        item
        for item in root.rglob("*")
        if (
            item.is_file()
            and item.suffix == ".safetensors"
            and not item.name.startswith("adapter.")
        )
    )
    if not weight_files or sum(item.stat().st_size for item in weight_files) <= 0:
        raise PreflightError("base_weights_missing", "The local checkpoint has no model weights.")
    for index_path in root.glob("*.index.json"):
        index, _ = _read_json_object(
            index_path, maximum_bytes=10_000_000, error_code="base_model_invalid"
        )
        weight_map = index.get("weight_map")
        if not isinstance(weight_map, dict):
            raise PreflightError("base_weights_missing", "A checkpoint shard is missing.")
        for name in weight_map.values():
            if not isinstance(name, str):
                raise PreflightError("base_weights_missing", "A checkpoint shard is missing.")
            relative = PurePosixPath(name)
            if (
                not name
                or relative.is_absolute()
                or ".." in relative.parts
                or "\\" in name
            ):
                raise PreflightError(
                    "base_weights_unsafe", "A checkpoint shard path escapes the approved model tree."
                )
            shard = root.joinpath(*relative.parts)
            try:
                shard.resolve().relative_to(root.resolve())
            except ValueError:
                raise PreflightError(
                    "base_weights_unsafe", "A checkpoint shard path escapes the approved model tree."
                ) from None
            if shard.suffix != ".safetensors":
                raise PreflightError(
                    "unsafe_weight_format",
                    "Only non-executable safetensors checkpoint shards are accepted.",
                )
            if shard.is_symlink() or not shard.is_file():
                raise PreflightError("base_weights_missing", "A checkpoint shard is missing.")
    mms_code = MMS_LANGUAGE_CODES[language]
    uses_mms_language_adapter = any(
        (root / f"adapter.{mms_code}{suffix}").is_file()
        for suffix in (".safetensors",)
    )
    adapter_dimension = config.get("adapter_attn_dim")
    if (
        isinstance(adapter_dimension, int)
        and adapter_dimension > 0
        and not uses_mms_language_adapter
    ):
        raise PreflightError(
            "mms_language_adapter_missing",
            "The local MMS snapshot lacks the selected language adapter weights.",
        )
    return str(model_type), uses_mms_language_adapter


def _check_dependencies() -> DependencyReport:
    versions: dict[str, str] = {}
    missing: list[str] = []
    incompatible: list[str] = []
    for package, pinned in PINNED_DEPENDENCY_VERSIONS.items():
        if importlib.util.find_spec(package) is None:
            missing.append(package)
            continue
        try:
            version = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(package)
            continue
        versions[package] = version
        # Accept platform-local build suffixes such as ``+cu124``, while refusing
        # pre-releases and version drift from the isolated requirements contract.
        if version.split("+", 1)[0] != pinned:
            incompatible.append(package)
    if missing:
        raise PreflightError(
            "dependencies_missing", "Required optional ASR training dependencies are not installed."
        )
    if incompatible:
        raise PreflightError(
            "dependencies_incompatible",
            "Optional ASR training dependencies do not match the pinned runtime.",
        )
    return DependencyReport(versions=dict(sorted(versions.items())))


def _preflight_real_training_impl(
    config: RuntimeConfig,
    key: bytes,
    *,
    now: datetime | None = None,
) -> PreparedRun:
    """Perform every non-ML gate before any heavy optional dependency is imported."""
    _validate_config(config)
    if not hmac.compare_digest(
        hashlib.sha256(key).hexdigest(), config.governance_key_sha256
    ):
        raise PreflightError(
            "governance_trust_root_mismatch",
            "The governance verification key does not match the pinned trust root.",
        )
    # Authenticate and authorise the receipt before opening or hashing patient media.
    receipt = verify_governance_receipt(
        config.receipt_path,
        key,
        expected_archive_sha256=None,
        expected_base_model_sha256=None,
        expected_patient_id=None,
        expected_language=config.language,
        now=now,
    )
    if not hmac.compare_digest(receipt.key_id, config.governance_key_id):
        raise PreflightError(
            "governance_trust_root_mismatch",
            "The receipt key identifier does not match the pinned trust root.",
        )
    archive, archive_sha256 = _stable_verify_archive(
        config.archive_path,
        expected_sha256=receipt.archive_sha256,
    )
    model_type, uses_mms_language_adapter = _inspect_base_model(
        config.base_model_path,
        language=config.language,
    )
    base_model_sha256 = sha256_directory(config.base_model_path)
    if not hmac.compare_digest(base_model_sha256, receipt.base_model_sha256):
        raise PreflightError(
            "receipt_input_mismatch", "The base model does not match the approved receipt."
        )
    if not hmac.compare_digest(str(receipt.patient_id), str(archive.patient_id)):
        raise PreflightError(
            "receipt_subject_mismatch", "The archive subject does not match the approved receipt."
        )
    if any(pair.lang != config.language for pair in archive.pairs):
        raise PreflightError(
            "archive_language_mismatch", "A single adapter archive must contain only the authorised language."
        )
    selected_pairs = tuple(archive.pairs)
    _validate_pcm_audio(selected_pairs)
    _validate_no_conflicting_audio_labels(selected_pairs)
    if len(selected_pairs) < config.minimum_pairs:
        raise PreflightError(
            "corpus_too_small", "The authorised corpus does not meet the minimum pair count."
        )

    split = build_group_phrase_disjoint_split(
        selected_pairs,
        [pair.sha256 for pair in selected_pairs],
        seed=config.seed,
        group_unit="duplicate_audio_content",
    )
    total_components = sum(split.component_counts.values())
    if total_components < config.minimum_components:
        raise PreflightError(
            "corpus_not_varied_enough", "The authorised corpus lacks enough independent split components."
        )
    # Adequacy is judged after variety: a corpus with too few components is refused for that
    # reason, which is the more useful answer, and a lopsided split is a symptom of it.
    _assert_split_adequate(split)
    dependencies = _check_dependencies()
    if not hmac.compare_digest(
        sha256_directory(config.base_model_path), receipt.base_model_sha256
    ) or not hmac.compare_digest(
        sha256_file(config.receipt_path), receipt.receipt_sha256
    ):
        raise PreflightError("input_changed", "An approved input changed during preflight.")
    source_counts: dict[str, int] = defaultdict(int)
    for pair in selected_pairs:
        source_counts[pair.source] += 1
    return PreparedRun(
        config=config,
        receipt=receipt,
        split=split,
        dependencies=dependencies,
        pair_count=len(selected_pairs),
        component_count=total_components,
        total_duration_seconds=round(sum(pair.duration_seconds for pair in selected_pairs), 3),
        source_counts=dict(sorted(source_counts.items())),
        base_model_type=model_type,
        uses_mms_language_adapter=uses_mms_language_adapter,
        archive=archive,
        selected_pairs=selected_pairs,
    )


def preflight_real_training(
    config: RuntimeConfig,
    key: bytes,
    *,
    now: datetime | None = None,
) -> PreparedRun:
    """Run preflight while ensuring unexpected failures cannot disclose private paths."""
    try:
        return _preflight_real_training_impl(config, key, now=now)
    except PrivacySafeRuntimeError:
        raise
    except Exception:
        raise PreflightError(
            "preflight_failed", "An unexpected error blocked the private training preflight."
        ) from None


def _private_configuration_payload(config: RuntimeConfig) -> dict[str, Any]:
    """Return reproducibility fields that contain no source or destination paths."""
    return {
        "language": config.language,
        "governance_key_id": config.governance_key_id,
        "governance_key_sha256": config.governance_key_sha256,
        "seed": config.seed,
        "epochs": config.epochs,
        "batch_size": config.batch_size,
        "gradient_accumulation_steps": config.gradient_accumulation_steps,
        "learning_rate": config.learning_rate,
        "max_optimizer_steps": config.max_optimizer_steps,
        "max_grad_norm": config.max_grad_norm,
        "minimum_pairs": config.minimum_pairs,
        "minimum_components": config.minimum_components,
        "lora": {
            "rank": config.lora_rank,
            "alpha": config.lora_alpha,
            "dropout": config.lora_dropout,
            "target_modules": list(config.target_modules),
            "bias": "none",
        },
        "requested_device": config.device,
        "network_access": "disabled_local_files_only",
    }


def _json_sha256(payload: Any) -> str:
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _claims(*, model_trained: bool) -> dict[str, bool]:
    return {
        "model_trained": model_trained,
        "patient_specific_adapter": model_trained,
        "evaluation_run": False,
        "performance_metrics_reported": False,
        "clinical_metrics": False,
        "listener_intelligibility_measured": False,
        "speaker_generalisation_measured": False,
        "deployment_ready": False,
    }


def _preflight_manifest(prepared: PreparedRun) -> dict[str, Any]:
    config_payload = _private_configuration_payload(prepared.config)
    return {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "awaaz_asr_lora_runtime_manifest",
        "status": "preflight_passed_training_not_started",
        "mode": "real_inputs_preflight_only",
        "model_family": "mms_or_wav2vec2_ctc_lora",
        "claims": _claims(model_trained=False),
        "inputs": {
            "governance_receipt_verified": True,
            "archive_strictly_verified": True,
            "archive_sha256": prepared.receipt.archive_sha256,
            "governance_receipt_sha256": prepared.receipt.receipt_sha256,
            "base_model_tree_sha256": prepared.receipt.base_model_sha256,
            "base_model_type": prepared.base_model_type,
            "mms_language_adapter_present_in_local_snapshot": (
                prepared.uses_mms_language_adapter
            ),
            "configuration_sha256": _json_sha256(config_payload),
        },
        "configuration": config_payload,
        "runtime": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "dependencies": dict(prepared.dependencies.versions),
            "heavy_dependencies_imported_by_preflight": False,
        },
        "corpus": {
            "pair_count": prepared.pair_count,
            "independent_components": prepared.component_count,
            "total_duration_seconds": prepared.total_duration_seconds,
            "languages": {prepared.config.language: prepared.pair_count},
            "sources": dict(prepared.source_counts),
        },
        "split": prepared.split.as_manifest(),
        "evaluation": {
            "status": "not_run",
            "validation_set_used": False,
            "test_set_used": False,
        },
        "artifacts": [],
        "integrity": {
            "artifact_hash_algorithm": "sha256",
            "manifest_self_hash": None,
            "manifest_excluded_from_artifact_hashes": True,
        },
        "privacy": {
            "contains_audio": False,
            "contains_transcripts": False,
            "contains_patient_id": False,
            "contains_capture_ids": False,
            "contains_pair_audio_hashes": False,
            "contains_archive_integrity_hash": True,
            "contains_patient_derived_weights": False,
            "runtime_code_emits_patient_data_to_logs": False,
            "manifest_mode": "0600",
        },
        "limitations": [
            "Passing preflight is not training, evaluation, validation, or deployment.",
            "The split is within one patient and cannot measure unseen-speaker generalisation.",
            "Exact normalised phrase matching does not detect paraphrases or translations.",
            "A short-lived signed receipt is a point-in-time revocation check, not an online registry.",
        ],
    }


def _create_staging_directory(output_dir: Path) -> Path:
    output = Path(output_dir)
    # Fail closed before any mkdir.  The smoke path reaches here without `_validate_config`,
    # so this call -- not the caller -- is what keeps every written artifact contained.
    _assert_output_location_contained(output)
    try:
        staging = Path(tempfile.mkdtemp(prefix=".asr-runtime-", dir=output.parent))
        os.chmod(staging, 0o700)
        return staging
    except OSError:
        raise TrainingRuntimeError(
            "output_unavailable", "A private staging directory could not be created."
        ) from None


def _write_private_json(path: Path, payload: dict[str, Any]) -> None:
    encoded = (json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(encoded)
            destination.flush()
            os.fsync(destination.fileno())
    except (OSError, TypeError, ValueError):
        raise TrainingRuntimeError(
            "manifest_write_failed", "The private run manifest could not be written."
        ) from None


def _harden_and_fsync_tree(root: Path) -> None:
    try:
        for directory in sorted((item for item in root.rglob("*") if item.is_dir())):
            os.chmod(directory, 0o700)
        for path in sorted(item for item in root.rglob("*") if item.is_file()):
            os.chmod(path, 0o600)
            with path.open("rb") as source:
                os.fsync(source.fileno())
        descriptor = os.open(root, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        raise TrainingRuntimeError(
            "artifact_fsync_failed", "Training artifacts could not be durably staged."
        ) from None


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def verify_published_artifact(output_dir: Path) -> Path:
    """Return the manifest path of a *complete* publication, or refuse the directory.

    Any consumer of an artifact directory -- a registry, a packaging step, a person -- must
    ask this rather than trusting that adapter weights are there.  A directory still
    carrying the sentinel was interrupted mid-publication: the weights in it are
    patient-derived, and the manifest that labels them unvalidated, unevaluated, and
    `deployment_ready: false` may never have been written.
    """
    output = Path(output_dir)
    manifest_path = output / MANIFEST_NAME
    if os.path.lexists(output / INCOMPLETE_PUBLICATION_SENTINEL) or not manifest_path.is_file():
        raise TrainingRuntimeError(
            "artifact_incomplete",
            "The artifact directory is an interrupted publication and cannot be used.",
        )
    return manifest_path


def _publish_staging(staging: Path, output_dir: Path) -> Path:
    output = Path(output_dir)
    _harden_and_fsync_tree(staging)
    reserved = False
    try:
        # mkdir is the portable atomic no-replace operation for a directory.  It refuses
        # files, directories, and symlinks that appear after the earlier advisory check.
        os.mkdir(output, 0o700)
        reserved = True
        # The ordering below is the whole point, and it is the reverse of the rename order.
        # The sentinel is created and fsynced *before* the first child moves, and unlinked
        # only after the last one -- manifest.json, kept last on purpose -- has landed.  So
        # every window in which this directory holds patient-derived LoRA weights without
        # the manifest that states their limitations is a window in which the sentinel is on
        # disk.  A crash (SIGKILL, power loss) cannot run the rollback below; the sentinel is
        # then the only evidence that what a later reader found is not a finished artifact,
        # and `verify_published_artifact` refuses any directory carrying it.
        sentinel = output / INCOMPLETE_PUBLICATION_SENTINEL
        os.close(os.open(sentinel, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
        _fsync_directory(output)
        children = sorted(
            staging.iterdir(),
            key=lambda item: (item.name == MANIFEST_NAME, item.name),
        )
        for child in children:
            os.rename(child, output / child.name)
        staging.rmdir()
        _fsync_directory(output)
        os.unlink(sentinel)
        _fsync_directory(output)
        _fsync_directory(output.parent)
    except OSError:
        if reserved and output.exists():
            try:
                if staging.exists():
                    shutil.rmtree(staging)
                os.rename(output, staging)
            except OSError:
                shutil.rmtree(output, ignore_errors=True)
        raise TrainingRuntimeError(
            "artifact_publish_failed", "The private output directory could not be published."
        ) from None
    # Self-check: a publication that reaches here without a manifest, or with its sentinel
    # still in place, is not a finished artifact and must not be reported as one.
    return verify_published_artifact(output)


def _write_manifest_directory(output_dir: Path, payload: dict[str, Any]) -> Path:
    staging = _create_staging_directory(output_dir)
    published = False
    try:
        _write_private_json(staging / MANIFEST_NAME, payload)
        manifest_path = _publish_staging(staging, output_dir)
        published = True
        return manifest_path
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def run_synthetic_smoke(output_dir: Path, *, seed: int = 42) -> Path:
    """Exercise split and manifest mechanics without reading media or importing ML code."""
    rows: list[_SyntheticPair] = []
    group_keys: list[str] = []
    for phrase_index in range(12):
        for repetition in range(2):
            text = (
                f"  SYNTHETIC   PHRASE {phrase_index}  "
                if repetition
                else f"synthetic phrase {phrase_index}"
            )
            rows.append(_SyntheticPair(lang="en", target_text=text))
            group_keys.append(f"synthetic-audio-{phrase_index}-{repetition}")
    split = build_group_phrase_disjoint_split(
        rows,
        group_keys,
        seed=seed,
        group_unit="synthetic_fixture_group",
    )
    # The smoke exercises the real gates or it is not a smoke test.
    _assert_split_adequate(split)
    fixture_description = {
        "seed": seed,
        "pair_count": len(rows),
        "phrase_groups": 12,
        "audio_present": False,
        "model_instantiated": False,
    }
    payload = {
        "schema_version": SCHEMA_VERSION,
        "artifact_type": "awaaz_asr_lora_runtime_manifest",
        "status": "synthetic_smoke_completed_no_model",
        "mode": "synthetic_metadata_smoke",
        "model_family": "mms_or_wav2vec2_ctc_lora",
        "claims": _claims(model_trained=False),
        "inputs": {
            "fixture": "generated_metadata_only",
            "fixture_configuration_sha256": _json_sha256(fixture_description),
            "real_archive_read": False,
            "governance_receipt_used": False,
            "base_model_loaded": False,
        },
        "split": split.as_manifest(),
        "evaluation": {"status": "not_run"},
        "artifacts": [],
        "integrity": {
            "artifact_hash_algorithm": "sha256",
            "manifest_self_hash": None,
            "manifest_excluded_from_artifact_hashes": True,
        },
        "privacy": {
            "contains_audio": False,
            "contains_transcripts": False,
            "contains_patient_id": False,
            "contains_capture_ids": False,
            "contains_pair_audio_hashes": False,
            "contains_archive_integrity_hash": False,
            "contains_patient_derived_weights": False,
            "runtime_code_emits_patient_data_to_logs": False,
            "manifest_mode": "0600",
        },
        "limitations": [
            "SYNTHETIC METADATA SMOKE ONLY: no acoustic model or adapter was instantiated or trained.",
            "No evaluation or performance metric was produced.",
            "This run makes no claim about patient speech, clinical performance, or deployment.",
        ],
    }
    return _write_manifest_directory(Path(output_dir), payload)


def run_preflight(
    config: RuntimeConfig,
    key: bytes,
    *,
    now: datetime | None = None,
) -> Path:
    """Verify all real-run gates and publish a no-training manifest."""
    prepared = preflight_real_training(config, key, now=now)
    _assert_inputs_unchanged(prepared, key, now=now)
    return _write_manifest_directory(config.output_dir, _preflight_manifest(prepared))


def _assert_inputs_unchanged(
    prepared: PreparedRun,
    key: bytes,
    *,
    now: datetime | None = None,
) -> None:
    try:
        archive_hash = sha256_file(prepared.config.archive_path)
        model_hash = sha256_directory(prepared.config.base_model_path)
        receipt_hash = sha256_file(prepared.config.receipt_path)
    except PreflightError:
        raise PreflightError("input_changed", "An approved input changed after preflight.") from None
    if not all(
        (
            hmac.compare_digest(archive_hash, prepared.receipt.archive_sha256),
            hmac.compare_digest(model_hash, prepared.receipt.base_model_sha256),
            hmac.compare_digest(receipt_hash, prepared.receipt.receipt_sha256),
        )
    ):
        raise PreflightError("input_changed", "An approved input changed after preflight.")
    verify_governance_receipt(
        prepared.config.receipt_path,
        key,
        expected_archive_sha256=archive_hash,
        expected_base_model_sha256=model_hash,
        expected_patient_id=prepared.archive.patient_id,
        expected_language=prepared.config.language,
        now=now,
    )


def _load_ml_runtime() -> tuple[Any, Any, Any, Any]:
    """Import the optional stack only after every governance and data gate passes."""
    try:
        numpy = importlib.import_module("numpy")
        torch = importlib.import_module("torch")
        transformers = importlib.import_module("transformers")
        peft = importlib.import_module("peft")
    except Exception:
        raise TrainingRuntimeError(
            "runtime_import_failed", "The optional ASR training runtime could not be imported."
        ) from None
    return numpy, torch, transformers, peft


def _resolve_device(torch: Any, requested: str) -> Any:
    if requested == "auto":
        if torch.cuda.is_available():
            requested = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            requested = "mps"
        else:
            requested = "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise TrainingRuntimeError("device_unavailable", "The requested CUDA runtime is unavailable.")
    if requested == "mps" and not (
        hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
    ):
        raise TrainingRuntimeError("device_unavailable", "The requested MPS runtime is unavailable.")
    return torch.device(requested)


def _decode_pcm_to_float(pair: VerifiedAwaazPair, numpy: Any) -> Any:
    try:
        with wave.open(io.BytesIO(pair.audio), "rb") as source:
            frames = source.readframes(source.getnframes())
        return numpy.frombuffer(frames, dtype="<i2").astype(numpy.float32) / 32768.0
    except Exception:
        raise TrainingRuntimeError(
            "audio_decode_failed", "A verified PCM sample could not be decoded."
        ) from None


def _encode_labels(processor: Any, text: str) -> list[int]:
    try:
        try:
            encoded = processor(text=text, return_attention_mask=False)
        except (TypeError, ValueError):
            target_context = getattr(processor, "as_target_processor", None)
            if target_context is None:
                raise
            with target_context():
                encoded = processor(text, return_attention_mask=False)
        labels = list(encoded["input_ids"])
    except Exception:
        raise TrainingRuntimeError(
            "target_encoding_failed", "A target could not be represented by the local CTC tokenizer."
        ) from None
    if not labels:
        raise TrainingRuntimeError(
            "target_encoding_failed", "A target encoded to an empty CTC label sequence."
        )
    tokenizer = getattr(processor, "tokenizer", None)
    unknown_id = getattr(tokenizer, "unk_token_id", None)
    if unknown_id is not None and unknown_id in labels:
        raise TrainingRuntimeError(
            "target_vocabulary_mismatch", "The local CTC vocabulary cannot represent every target."
        )
    return labels


def _collate_batch(
    pairs: Sequence[VerifiedAwaazPair],
    indexes: Sequence[int],
    processor: Any,
    numpy: Any,
    device: Any,
) -> dict[str, Any]:
    input_features = []
    label_features = []
    for index in indexes:
        pair = pairs[index]
        waveform = _decode_pcm_to_float(pair, numpy)
        try:
            encoded = processor(
                waveform,
                sampling_rate=16_000,
                return_attention_mask=True,
            )
            input_values = encoded["input_values"]
            if len(input_values) == 1 and isinstance(input_values[0], (list, tuple, numpy.ndarray)):
                input_values = input_values[0]
        except Exception:
            raise TrainingRuntimeError(
                "audio_feature_failed", "A verified audio sample could not be featurised."
            ) from None
        input_features.append({"input_values": input_values})
        label_features.append({"input_ids": _encode_labels(processor, pair.target_text)})
    try:
        batch = processor.pad(input_features, padding=True, return_tensors="pt")
        try:
            label_batch = processor.pad(labels=label_features, padding=True, return_tensors="pt")
        except (TypeError, ValueError):
            target_context = getattr(processor, "as_target_processor")
            with target_context():
                label_batch = processor.pad(label_features, padding=True, return_tensors="pt")
        labels = label_batch["input_ids"]
        attention = label_batch.get("attention_mask")
        if attention is not None:
            labels = labels.masked_fill(attention.ne(1), -100)
        batch["labels"] = labels
        return {name: value.to(device) for name, value in batch.items()}
    except TrainingRuntimeError:
        raise
    except Exception:
        raise TrainingRuntimeError(
            "batch_collation_failed", "A private training batch could not be padded."
        ) from None


def _seed_runtime(seed: int, numpy: Any, torch: Any) -> None:
    random.seed(seed)
    numpy.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    try:
        torch.use_deterministic_algorithms(True)
    except Exception:
        raise TrainingRuntimeError(
            "determinism_unavailable", "The selected runtime cannot guarantee deterministic operations."
        ) from None
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True


def _snapshot_approved_base_model(prepared: PreparedRun) -> tuple[Path, Path]:
    # `dir=` is load-bearing, not tidiness -- the same reasoning as the archive snapshot in
    # `_stable_verify_archive`.  Without it mkdtemp puts a multi-gigabyte copy of the
    # licensed checkpoint in the shared system temp directory, where the rmtree below covers
    # a normal exit and an exception but not SIGKILL or a power loss, and where it can
    # exhaust a shared tmpfs mid-run.  The approved base-model tree's own parent already
    # holds these exact bytes, so snapshotting beside it adds no exposure the operator has
    # not already accepted.  An unwritable parent raises OSError and fails closed into
    # `base_model_snapshot_failed`, which is the correct outcome.
    try:
        snapshot_root = Path(
            tempfile.mkdtemp(
                prefix=".neurotrace-approved-base-",
                dir=Path(prepared.config.base_model_path).resolve().parent,
            )
        )
        os.chmod(snapshot_root, 0o700)
    except OSError:
        raise TrainingRuntimeError(
            "base_model_snapshot_failed",
            "The approved local checkpoint could not be privately snapshotted.",
        ) from None
    snapshot = snapshot_root / "model"
    try:
        shutil.copytree(
            prepared.config.base_model_path,
            snapshot,
            symlinks=True,
        )
        snapshot_hash = sha256_directory(snapshot)
        if not hmac.compare_digest(snapshot_hash, prepared.receipt.base_model_sha256):
            raise PreflightError(
                "base_model_changed",
                "The base model changed while creating its approved private snapshot.",
            )
        model_type, uses_mms_adapter = _inspect_base_model(
            snapshot,
            language=prepared.config.language,
        )
        if (
            model_type != prepared.base_model_type
            or uses_mms_adapter != prepared.uses_mms_language_adapter
        ):
            raise PreflightError(
                "base_model_changed", "The private model snapshot changed checkpoint identity."
            )
        return snapshot_root, snapshot
    except PrivacySafeRuntimeError:
        shutil.rmtree(snapshot_root, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(snapshot_root, ignore_errors=True)
        raise TrainingRuntimeError(
            "base_model_snapshot_failed",
            "The approved local checkpoint could not be privately snapshotted.",
        ) from None


def _load_local_processor_and_model(
    prepared: PreparedRun,
    transformers: Any,
) -> tuple[Any, Any, str]:
    snapshot_root, snapshot = _snapshot_approved_base_model(prepared)
    model_path = str(snapshot.resolve())
    previous_offline = {
        name: os.environ.get(name) for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE")
    }
    transformers_logging = getattr(transformers, "logging", None)
    previous_verbosity = None
    if transformers_logging is not None:
        try:
            previous_verbosity = transformers_logging.get_verbosity()
            transformers_logging.set_verbosity_error()
        except Exception:
            raise TrainingRuntimeError(
                "runtime_logging_control_failed",
                "The Transformers runtime could not disable diagnostic logging.",
            ) from None
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        language_kwargs: dict[str, Any] = {}
        model_language_kwargs: dict[str, Any] = {}
        if prepared.uses_mms_language_adapter:
            target_lang = MMS_LANGUAGE_CODES[prepared.config.language]
            language_kwargs["target_lang"] = target_lang
            model_language_kwargs.update(
                target_lang=target_lang,
                ignore_mismatched_sizes=True,
            )
        processor = transformers.AutoProcessor.from_pretrained(
            model_path,
            local_files_only=True,
            trust_remote_code=False,
            **language_kwargs,
        )
        model = transformers.AutoModelForCTC.from_pretrained(
            model_path,
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=True,
            **model_language_kwargs,
        )
    except Exception:
        raise TrainingRuntimeError(
            "base_model_load_failed", "The approved local Wav2Vec2 CTC checkpoint could not be loaded."
        ) from None
    finally:
        if transformers_logging is not None and previous_verbosity is not None:
            try:
                transformers_logging.set_verbosity(previous_verbosity)
            except Exception:
                pass
        for name, value in previous_offline.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        shutil.rmtree(snapshot_root, ignore_errors=True)
    if getattr(model.config, "model_type", None) != "wav2vec2":
        raise TrainingRuntimeError("base_model_unsupported", "The loaded checkpoint is not Wav2Vec2 CTC.")
    return processor, model, model_path


def _apply_lora(model: Any, config: RuntimeConfig, peft: Any) -> tuple[Any, int]:
    module_names = tuple(name for name, _module in model.named_modules())
    if any(not any(name.endswith(target) for name in module_names) for target in config.target_modules):
        raise TrainingRuntimeError(
            "lora_target_missing", "The approved base model lacks a configured LoRA target module."
        )
    try:
        lora_config = peft.LoraConfig(
            r=config.lora_rank,
            lora_alpha=config.lora_alpha,
            lora_dropout=config.lora_dropout,
            target_modules=list(config.target_modules),
            bias="none",
        )
        adapted = peft.get_peft_model(model, lora_config)
        trainable_named = [
            (name, parameter)
            for name, parameter in adapted.named_parameters()
            if parameter.requires_grad
        ]
        trainable = sum(parameter.numel() for _name, parameter in trainable_named)
    except Exception:
        raise TrainingRuntimeError(
            "lora_initialisation_failed", "The PEFT LoRA adapter could not be initialised."
        ) from None
    if trainable <= 0:
        raise TrainingRuntimeError(
            "lora_initialisation_failed", "The LoRA adapter has no trainable parameters."
        )
    if any("lora_" not in name for name, _parameter in trainable_named):
        raise TrainingRuntimeError(
            "unexpected_trainable_parameter", "A non-LoRA base-model parameter remained trainable."
        )
    return adapted, int(trainable)


def _screened_phrases(prepared: PreparedRun) -> frozenset[str]:
    """Return the normalised utterances that generated metadata is screened for.

    `target_text` is the highest-value INV-1 content in the archive and was screened for
    nowhere: the identifier set covered the patient UUID, capture ids, and audio hashes only.

    Screening is deliberately limited to utterances of at least
    MINIMUM_SCREENED_PHRASE_WORDS words and MINIMUM_SCREENED_PHRASE_CHARACTERS characters,
    and matched on word boundaries.  A one-word target ("yes", a drink, a name) occurs
    verbatim inside tokenizer vocabularies, label maps, and configuration keys, so screening
    it would abort every real run on a false positive -- and a check that always fires is a
    check that gets deleted.  The tradeoff is real and is not hidden: a short utterance that
    does leak into third-party metadata is not caught here.  What backs the short cases is
    that this runtime never writes `target_text` into any artifact itself; this screen exists
    for the metadata a third-party library generates, where we cannot make that promise.
    """
    phrases = set()
    for pair in prepared.selected_pairs:
        normalised = normalise_phrase(pair.target_text)
        if (
            len(normalised) >= MINIMUM_SCREENED_PHRASE_CHARACTERS
            and len(normalised.split()) >= MINIMUM_SCREENED_PHRASE_WORDS
        ):
            phrases.add(normalised)
    return frozenset(phrases)


def _contains_screened_phrase(text: str, phrases: frozenset[str]) -> bool:
    """Match phrases against the normalised text so casing and wrapping cannot hide them."""
    if not phrases:
        return False
    haystack = normalise_phrase(text)
    return any(
        re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", haystack) is not None
        for phrase in phrases
    )


def _safetensors_header_text(path: Path) -> str | None:
    """Return the length-prefixed JSON header of a safetensors file, or None.

    Reading the header costs one seek and at most MAX_SAFETENSORS_HEADER_BYTES, so the
    tensor payload -- which may be gigabytes -- is never read.  Anything that does not look
    like a header (short file, implausible length, non-UTF-8) returns None rather than
    failing the run: adapter weights written by a test double or a future format are not
    evidence of a leak, and refusing them would make the screen unusable.  This is an
    explicit gap: content hidden in a tensor payload is not covered, and headers are
    screened only, never rewritten, so a private path there would survive sanitisation.
    """
    try:
        with path.open("rb") as source:
            prefix = source.read(8)
            if len(prefix) != 8:
                return None
            length = int.from_bytes(prefix, "little")
            if not 1 <= length <= MAX_SAFETENSORS_HEADER_BYTES:
                return None
            return source.read(length).decode("utf-8")
    except UnicodeDecodeError:
        return None
    except OSError:
        raise TrainingRuntimeError(
            "artifact_metadata_invalid", "Generated adapter metadata could not be inspected."
        ) from None


def _sanitize_adapter_metadata(
    adapter_dir: Path,
    prepared: PreparedRun,
    *,
    additional_private_paths: Sequence[str] = (),
) -> None:
    """Strip local paths from, and refuse private content in, generated adapter metadata.

    Screened: textual metadata (see SCREENED_TEXT_SUFFIXES) up to MAX_SCREENED_TEXT_BYTES,
    plus the JSON header of any safetensors file.  Screened for: the patient UUID, capture
    ids, audio hashes, and -- newly -- the patients' own utterances.  Not screened: tensor
    payloads, oversized text, and any other binary format; and a private path found in a
    safetensors header is refused nowhere and rewritten nowhere, because rewriting a file we
    only partially parse is worse than leaving it.
    """
    private_paths = {
        str(prepared.config.archive_path),
        str(prepared.config.receipt_path),
        str(prepared.config.base_model_path),
        str(prepared.config.output_dir),
        str(prepared.config.archive_path.resolve()),
        str(prepared.config.receipt_path.resolve()),
        str(prepared.config.base_model_path.resolve()),
        str(prepared.config.output_dir.resolve()),
    }
    private_paths.update(additional_private_paths)
    forbidden_identifiers = {str(prepared.archive.patient_id)}
    forbidden_identifiers.update(str(pair.capture_id) for pair in prepared.selected_pairs)
    forbidden_identifiers.update(pair.sha256 for pair in prepared.selected_pairs)
    screened_phrases = _screened_phrases(prepared)
    for path in sorted(item for item in adapter_dir.rglob("*") if item.is_file()):
        # Rewritable files are the textual formats a model card or config lands in.  A
        # safetensors file is screened through its header only; everything else (binary
        # blobs, oversized text) is not inspected at all and is not claimed to be.
        rewritable = (
            path.suffix.lower() in SCREENED_TEXT_SUFFIXES
            and path.stat().st_size <= MAX_SCREENED_TEXT_BYTES
        )
        if rewritable:
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                raise TrainingRuntimeError(
                    "artifact_metadata_invalid", "Generated adapter metadata could not be inspected."
                ) from None
        elif path.suffix.lower() == ".safetensors":
            text = _safetensors_header_text(path)
        else:
            text = None
        if text is None:
            continue
        if any(value and value in text for value in forbidden_identifiers):
            raise TrainingRuntimeError(
                "artifact_privacy_violation", "Generated adapter metadata contains a private identifier."
            )
        if _contains_screened_phrase(text, screened_phrases):
            raise TrainingRuntimeError(
                "artifact_privacy_violation", "Generated adapter metadata contains a patient utterance."
            )
        if not rewritable:
            continue
        sanitized = text
        for value in sorted(private_paths, key=len, reverse=True):
            if value:
                sanitized = sanitized.replace(value, "[private-local-path]")
        if sanitized != text:
            try:
                path.write_text(sanitized, encoding="utf-8")
                os.chmod(path, 0o600)
            except OSError:
                raise TrainingRuntimeError(
                    "artifact_metadata_invalid", "Generated adapter metadata could not be sanitized."
                ) from None


def _optimise_lora(
    prepared: PreparedRun,
    processor: Any,
    model: Any,
    numpy: Any,
    torch: Any,
    device: Any,
) -> dict[str, int]:
    config = prepared.config
    trainable_parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    try:
        optimizer = torch.optim.AdamW(trainable_parameters, lr=config.learning_rate)
        model.to(device)
        model.train()
    except Exception:
        raise TrainingRuntimeError(
            "optimiser_initialisation_failed", "The optimiser could not be initialised."
        ) from None

    optimizer_steps = 0
    examples_seen = 0
    epochs_completed = 0
    stopped_at_step_limit = False
    order = list(prepared.split.train)
    generator = random.Random(config.seed)
    optimizer.zero_grad(set_to_none=True)
    try:
        for _epoch in range(config.epochs):
            generator.shuffle(order)
            accumulation = 0
            for start in range(0, len(order), config.batch_size):
                indexes = order[start : start + config.batch_size]
                batch = _collate_batch(
                    prepared.selected_pairs,
                    indexes,
                    processor,
                    numpy,
                    device,
                )
                outputs = model(**batch)
                loss = outputs.loss
                if loss is None or not bool(torch.isfinite(loss).item()):
                    raise TrainingRuntimeError("non_finite_loss", "The CTC training loss became non-finite.")
                (loss / config.gradient_accumulation_steps).backward()
                accumulation += 1
                examples_seen += len(indexes)
                last_batch = start + config.batch_size >= len(order)
                if accumulation >= config.gradient_accumulation_steps or last_batch:
                    torch.nn.utils.clip_grad_norm_(trainable_parameters, config.max_grad_norm)
                    optimizer.step()
                    optimizer.zero_grad(set_to_none=True)
                    optimizer_steps += 1
                    accumulation = 0
                if optimizer_steps >= config.max_optimizer_steps:
                    stopped_at_step_limit = True
                    # An epoch is counted only when every batch of the training split was
                    # seen.  Incrementing on the way out of a truncated epoch made the
                    # manifest -- the one document whose purpose is to not overstate what
                    # was done -- report a completed epoch after a single batch.  The limit
                    # landing exactly on the final batch is a genuinely complete epoch, so
                    # that case still counts.
                    if last_batch:
                        epochs_completed += 1
                    break
            else:
                epochs_completed += 1
            if stopped_at_step_limit:
                break
    except TrainingRuntimeError:
        raise
    except Exception:
        raise TrainingRuntimeError(
            "training_step_failed", "The local LoRA optimisation step failed."
        ) from None
    if optimizer_steps == 0:
        raise TrainingRuntimeError("training_step_failed", "No optimiser step completed.")
    return {
        "optimizer_steps": optimizer_steps,
        "examples_seen": examples_seen,
        "epochs_requested": config.epochs,
        "epochs_completed": epochs_completed,
        "stopped_at_step_limit": stopped_at_step_limit,
    }


def _artifact_records(root: Path) -> list[dict[str, Any]]:
    records = []
    all_items = tuple(root.rglob("*"))
    if any(item.is_symlink() for item in all_items):
        raise TrainingRuntimeError(
            "artifact_symlink_rejected", "Generated adapter artifacts may not contain symlinks."
        )
    for path in sorted(item for item in all_items if item.is_file()):
        if path.name == MANIFEST_NAME:
            continue
        records.append(
            {
                "path": path.relative_to(root).as_posix(),
                "size_bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )
    if not records:
        raise TrainingRuntimeError("adapter_save_failed", "The LoRA save produced no artifact files.")
    return records


def _training_manifest(
    prepared: PreparedRun,
    *,
    device_type: str,
    trainable_parameters: int,
    run_facts: dict[str, int],
    artifacts: list[dict[str, Any]],
) -> dict[str, Any]:
    payload = _preflight_manifest(prepared)
    payload["privacy"]["contains_patient_derived_weights"] = True
    # "completed" means every requested epoch ran to the end of the training split.  The
    # previous code hard-coded it, so a run the optimiser-step limit cut off after one batch
    # still published `"status": "completed"`.  A missing fact is read as truncated: the
    # conservative direction for a manifest is to understate, never to overstate.
    epochs_completed = int(run_facts.get("epochs_completed", 0))
    completed = epochs_completed >= prepared.config.epochs
    limitations = [
        "The adapter was optimised on authorised real pairs but has not been evaluated.",
        "Validation and test partitions remain untouched; no WER, CER, loss, or "
        "intelligibility metric is claimed.",
        "The split is within one patient and cannot measure unseen-speaker generalisation.",
        "The adapter is not registered, shipped, or deployment-ready.",
        "A short-lived signed receipt is a point-in-time revocation check, not an online registry.",
    ]
    if not completed:
        limitations.insert(
            1,
            "The run stopped before every requested epoch finished; the training split was "
            "not seen in full.",
        )
    payload.update(
        {
            "status": "trained_not_evaluated",
            "mode": "authorised_real_training",
            "claims": _claims(model_trained=True),
            "runtime": {
                **payload["runtime"],
                "heavy_dependencies_imported_by_preflight": False,
                "device_type": device_type,
            },
            "training": {
                "status": "completed" if completed else "truncated_before_completion",
                "epochs_requested": prepared.config.epochs,
                "trainable_lora_parameters": trainable_parameters,
                **run_facts,
            },
            "artifacts": artifacts,
            "limitations": limitations,
        }
    )
    return payload


def run_training(
    config: RuntimeConfig,
    key: bytes,
    *,
    now: datetime | None = None,
) -> Path:
    """Run actual local CTC-LoRA optimisation after a fresh, complete preflight."""
    prepared = preflight_real_training(config, key, now=now)
    _assert_inputs_unchanged(prepared, key, now=now)
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    numpy, torch, transformers, peft = _load_ml_runtime()
    _seed_runtime(config.seed, numpy, torch)
    device = _resolve_device(torch, config.device)
    processor, base_model, private_model_snapshot = _load_local_processor_and_model(
        prepared, transformers
    )
    _assert_inputs_unchanged(prepared, key, now=now)
    model, trainable_parameters = _apply_lora(base_model, config, peft)
    staging = _create_staging_directory(config.output_dir)
    published = False
    try:
        run_facts = _optimise_lora(prepared, processor, model, numpy, torch, device)
        adapter_dir = staging / "adapter"
        adapter_dir.mkdir(mode=0o700)
        try:
            model.save_pretrained(
                adapter_dir,
                safe_serialization=True,
                save_embedding_layers=False,
            )
        except Exception:
            raise TrainingRuntimeError(
                "adapter_save_failed", "The LoRA adapter could not be saved."
            ) from None
        _sanitize_adapter_metadata(
            adapter_dir,
            prepared,
            additional_private_paths=(private_model_snapshot,),
        )
        artifacts = _artifact_records(staging)
        manifest = _training_manifest(
            prepared,
            device_type=str(device.type),
            trainable_parameters=trainable_parameters,
            run_facts=run_facts,
            artifacts=artifacts,
        )
        _write_private_json(staging / MANIFEST_NAME, manifest)
        manifest_path = _publish_staging(staging, config.output_dir)
        published = True
        return manifest_path
    except PrivacySafeRuntimeError:
        raise
    except Exception:
        raise TrainingRuntimeError(
            "training_runtime_failed", "An unexpected error stopped the private training run."
        ) from None
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def _read_verification_key(path: Path) -> bytes:
    candidate = Path(path)
    try:
        metadata = candidate.lstat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
            raise PreflightError("receipt_key_invalid", "The governance key must be a regular file.")
        if stat.S_IMODE(metadata.st_mode) & 0o077:
            raise PreflightError(
                "receipt_key_permissions",
                "The governance key file must not be accessible by group or others.",
            )
        if not 32 <= metadata.st_size <= MAX_KEY_BYTES:
            raise PreflightError(
                "receipt_key_invalid", "The governance verification key has an invalid length."
            )
        return candidate.read_bytes()
    except PreflightError:
        raise
    except OSError:
        raise PreflightError(
            "receipt_key_missing", "The governance verification key cannot be read."
        ) from None


def _add_real_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument(
        "--receipt-key-file",
        type=Path,
        required=True,
        help="Dedicated governance HMAC verification key file; never pass key material directly.",
    )
    parser.add_argument("--base-model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--language", choices=sorted(SUPPORTED_LANGUAGES), default="en")


def _config_from_args(args: argparse.Namespace) -> RuntimeConfig:
    return RuntimeConfig(
        archive_path=args.archive,
        receipt_path=args.receipt,
        base_model_path=args.base_model,
        output_dir=args.output_dir,
        governance_key_id=os.environ.get("AWAAZ_GOVERNANCE_KEY_ID", ""),
        governance_key_sha256=os.environ.get("AWAAZ_GOVERNANCE_KEY_SHA256", ""),
        language=args.language,
        epochs=getattr(args, "epochs", 1),
        batch_size=getattr(args, "batch_size", 2),
        gradient_accumulation_steps=getattr(args, "gradient_accumulation_steps", 1),
        learning_rate=getattr(args, "learning_rate", 1e-4),
        max_optimizer_steps=getattr(args, "max_optimizer_steps", 100),
        device=getattr(args, "device", "auto"),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.ml.train.asr_runtime",
        description="Fail-closed local MMS/Wav2Vec2-CTC LoRA training runtime.",
        epilog=(
            "Real commands also require AWAAZ_GOVERNANCE_KEY_ID and the pinned "
            "AWAAZ_GOVERNANCE_KEY_SHA256 fingerprint in the trusted process environment."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    smoke = subparsers.add_parser(
        "synthetic-smoke",
        help="Exercise splitting/manifest code; creates no model and reports no metrics.",
    )
    smoke.add_argument("--output-dir", type=Path, required=True)
    smoke.add_argument("--seed", type=int, default=42)

    preflight = subparsers.add_parser(
        "preflight",
        help="Verify real inputs/dependencies and write a no-training manifest.",
    )
    _add_real_arguments(preflight)

    train = subparsers.add_parser("train", help="Run authorised local CTC-LoRA optimisation.")
    _add_real_arguments(train)
    train.add_argument("--epochs", type=int, default=1)
    train.add_argument("--batch-size", type=int, default=2)
    train.add_argument("--gradient-accumulation-steps", type=int, default=1)
    train.add_argument("--learning-rate", type=float, default=1e-4)
    train.add_argument("--max-optimizer-steps", type=int, default=100)
    train.add_argument("--device", choices=("auto", "cpu", "cuda", "mps"), default="auto")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "synthetic-smoke":
            run_synthetic_smoke(args.output_dir, seed=args.seed)
            print(
                "synthetic smoke complete; model_trained=false; evaluation_run=false; "
                "metrics_reported=false"
            )
            return 0
        key = _read_verification_key(args.receipt_key_file)
        config = _config_from_args(args)
        if args.command == "preflight":
            run_preflight(config, key)
            print("preflight passed; model_trained=false; evaluation_run=false; metrics_reported=false")
            return 0
        run_training(config, key)
        print(
            "LoRA optimisation complete; evaluation_run=false; clinical_metrics=false; "
            "deployment_ready=false"
        )
        return 0
    except PrivacySafeRuntimeError as exc:
        parser.exit(2, f"asr-runtime blocked [{exc.code}]\n")


if __name__ == "__main__":
    raise SystemExit(main())
