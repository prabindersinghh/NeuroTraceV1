"""Strict, non-extracting verifier for user-exported Awaaz training archives.

The verifier reads tar members in memory and never writes patient audio to disk. It rejects
path traversal, links, undeclared files, oversized corpora, invalid metadata, hash/size
mismatches, and non-WAV payloads before a training process can see a pair.
"""
from __future__ import annotations

import hashlib
import json
import re
import tarfile
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath

MAX_PAIRS = 1_000
MAX_MANIFEST_BYTES = 2_000_000
MAX_AUDIO_BYTES = 1_100_000
MAX_TOTAL_AUDIO_BYTES = 512_000_000
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class VerifiedAwaazPair:
    capture_id: uuid.UUID
    source: str
    target_text: str
    lang: str
    duration_seconds: float
    sha256: str
    audio: bytes


@dataclass(frozen=True, slots=True)
class VerifiedAwaazArchive:
    patient_id: uuid.UUID
    exported_at: str
    pairs: tuple[VerifiedAwaazPair, ...]


def _safe_member_name(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts


def _required(mapping: dict, key: str):
    if key not in mapping:
        raise ValueError(f"manifest field is required: {key}")
    return mapping[key]


def verify_awaaz_training_archive(path: Path) -> VerifiedAwaazArchive:
    """Verify one archive completely without extracting it or printing sensitive fields."""
    try:
        archive = tarfile.open(path, mode="r:")
    except (tarfile.TarError, OSError) as exc:
        raise ValueError("not a readable POSIX tar archive") from exc

    with archive:
        members = archive.getmembers()
        if len(members) > MAX_PAIRS + 2:
            raise ValueError("archive contains too many files")
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            raise ValueError("archive contains duplicate member names")
        if any(not _safe_member_name(name) for name in names):
            raise ValueError("archive contains an unsafe member path")
        if any(not member.isfile() for member in members):
            raise ValueError("archive may contain regular files only")

        by_name = {member.name: member for member in members}
        manifest_member = by_name.get("manifest.json")
        if manifest_member is None or manifest_member.size > MAX_MANIFEST_BYTES:
            raise ValueError("archive manifest is missing or too large")
        manifest_file = archive.extractfile(manifest_member)
        if manifest_file is None:
            raise ValueError("archive manifest cannot be read")
        try:
            manifest = json.loads(manifest_file.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("archive manifest is not valid UTF-8 JSON") from exc

        if manifest.get("schema_version") != 1:
            raise ValueError("unsupported Awaaz archive schema")
        if manifest.get("media_uploaded_by_app") is not False:
            raise ValueError("archive does not carry the local-export receipt")
        try:
            patient_id = uuid.UUID(str(_required(manifest, "patient_id")))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ValueError("manifest patient_id is not a UUID") from exc
        exported_at = str(_required(manifest, "exported_at"))
        try:
            datetime.fromisoformat(exported_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("manifest exported_at is not an ISO timestamp") from exc
        raw_pairs = _required(manifest, "pairs")
        if not isinstance(raw_pairs, list) or not 1 <= len(raw_pairs) <= MAX_PAIRS:
            raise ValueError("archive pair count is outside the supported range")

        verified: list[VerifiedAwaazPair] = []
        expected_names = {"README.txt", "manifest.json"}
        total_audio_bytes = 0
        seen_capture_ids: set[uuid.UUID] = set()
        for raw in raw_pairs:
            if not isinstance(raw, dict):
                raise ValueError("each manifest pair must be an object")
            try:
                capture_id = uuid.UUID(str(_required(raw, "capture_id")))
            except (TypeError, ValueError, AttributeError) as exc:
                raise ValueError("pair capture_id is not a UUID") from exc
            if capture_id in seen_capture_ids:
                raise ValueError("manifest repeats an audio capture")
            seen_capture_ids.add(capture_id)

            source = str(_required(raw, "source"))
            if source not in {"card_tap", "caregiver_review"}:
                raise ValueError("pair source is not supported")
            if source == "card_tap" and not raw.get("card_id"):
                raise ValueError("a card-tap pair requires card_id")
            if source == "caregiver_review" and not raw.get("utterance_id"):
                raise ValueError("a reviewed pair requires utterance_id")
            association_id = raw.get(
                "card_id" if source == "card_tap" else "utterance_id",
            )
            try:
                uuid.UUID(str(association_id))
            except (TypeError, ValueError, AttributeError) as exc:
                raise ValueError("pair association id is not a UUID") from exc
            target_text = str(_required(raw, "target_text")).strip()
            if not target_text or len(target_text) > 500:
                raise ValueError("pair target_text is empty or too long")
            lang = str(_required(raw, "lang"))
            if lang not in {"en", "hi", "pa"}:
                raise ValueError("pair language is not supported")
            try:
                duration_seconds = float(_required(raw, "duration_seconds"))
                size_bytes = int(_required(raw, "size_bytes"))
            except (TypeError, ValueError) as exc:
                raise ValueError("pair duration or size is invalid") from exc
            if not 0.25 <= duration_seconds <= 30.0:
                raise ValueError("pair duration is outside the capture contract")
            if not 44 <= size_bytes <= MAX_AUDIO_BYTES:
                raise ValueError("pair audio size is outside the capture contract")
            expected_hash = str(_required(raw, "sha256"))
            if SHA256_RE.fullmatch(expected_hash) is None:
                raise ValueError("pair sha256 is invalid")

            audio_name = str(_required(raw, "audio_file"))
            if audio_name != f"audio/{capture_id}.wav":
                raise ValueError("pair audio_file does not match capture_id")
            expected_names.add(audio_name)
            audio_member = by_name.get(audio_name)
            if audio_member is None or audio_member.size != size_bytes:
                raise ValueError("pair audio is missing or has the wrong size")
            total_audio_bytes += audio_member.size
            if total_audio_bytes > MAX_TOTAL_AUDIO_BYTES:
                raise ValueError("archive audio exceeds the supported total size")
            audio_file = archive.extractfile(audio_member)
            if audio_file is None:
                raise ValueError("pair audio cannot be read")
            audio_bytes = audio_file.read()
            if not (audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"):
                raise ValueError("pair media is not a WAV file")
            if hashlib.sha256(audio_bytes).hexdigest() != expected_hash:
                raise ValueError("pair audio failed SHA-256 verification")
            verified.append(VerifiedAwaazPair(
                capture_id=capture_id,
                source=source,
                target_text=target_text,
                lang=lang,
                duration_seconds=duration_seconds,
                sha256=expected_hash,
                audio=audio_bytes,
            ))

        if set(names) != expected_names:
            raise ValueError("archive contains undeclared or missing files")
        return VerifiedAwaazArchive(
            patient_id=patient_id,
            exported_at=exported_at,
            pairs=tuple(verified),
        )
