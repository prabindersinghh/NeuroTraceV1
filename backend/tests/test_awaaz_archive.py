from __future__ import annotations

import hashlib
import io
import json
import struct
import tarfile
import uuid

import pytest

from app.ml.train.awaaz_archive import verify_awaaz_training_archive
from app.ml.train.personalised_asr_adapter import main as adapter_main


def _wav() -> bytes:
    pcm = b"\x00\x00" * 4_000
    return (
        b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16_000, 32_000, 2, 16)
        + b"data" + struct.pack("<I", len(pcm)) + pcm
    )


def _write_archive(path, *, corrupt_hash: bool = False, extra_name: str | None = None):
    patient_id = uuid.uuid4()
    capture_id = uuid.uuid4()
    card_id = uuid.uuid4()
    audio = _wav()
    digest = "00" * 32 if corrupt_hash else hashlib.sha256(audio).hexdigest()
    audio_name = f"audio/{capture_id}.wav"
    manifest = {
        "schema_version": 1,
        "patient_id": str(patient_id),
        "exported_at": "2026-08-28T03:00:00.000Z",
        "media_uploaded_by_app": False,
        "pairs": [{
            "capture_id": str(capture_id),
            "source": "card_tap",
            "card_id": str(card_id),
            "utterance_id": None,
            "target_text": "Water",
            "lang": "en",
            "duration_seconds": 0.25,
            "sha256": digest,
            "size_bytes": len(audio),
            "created_at": "2026-08-28T02:00:00.000Z",
            "audio_file": audio_name,
        }],
    }
    files = {
        "README.txt": b"sensitive local export\n",
        "manifest.json": (json.dumps(manifest) + "\n").encode(),
        audio_name: audio,
    }
    if extra_name:
        files[extra_name] = b"unexpected"
    with tarfile.open(path, "w") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(content))
    return patient_id, capture_id


def test_a_local_training_archive_is_verified_without_extraction(tmp_path):
    path = tmp_path / "awaaz.tar"
    patient_id, capture_id = _write_archive(path)
    verified = verify_awaaz_training_archive(path)

    assert verified.patient_id == patient_id
    assert len(verified.pairs) == 1
    assert verified.pairs[0].capture_id == capture_id
    assert verified.pairs[0].target_text == "Water"
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("variant", ["corrupt_hash", "undeclared_file"])
def test_archive_verification_fails_closed(variant, tmp_path):
    path = tmp_path / "awaaz.tar"
    _write_archive(
        path,
        corrupt_hash=variant == "corrupt_hash",
        extra_name="audio/undeclared.wav" if variant == "undeclared_file" else None,
    )
    with pytest.raises(ValueError):
        verify_awaaz_training_archive(path)


def test_the_adapter_scaffold_refuses_to_label_archive_data_as_real(
    tmp_path, monkeypatch, capsys,
):
    path = tmp_path / "awaaz.tar"
    _write_archive(path)
    out = tmp_path / "models"
    monkeypatch.setattr("sys.argv", [
        "personalised_asr_adapter", "--archive", str(path), "--out", str(out),
    ])

    with pytest.raises(SystemExit, match="Real LoRA training is not implemented"):
        adapter_main()
    assert "verified 1 local Awaaz pairs" in capsys.readouterr().out
    assert not out.exists()
