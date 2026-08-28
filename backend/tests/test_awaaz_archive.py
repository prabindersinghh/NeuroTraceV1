from __future__ import annotations

import hashlib
import io
import json
import stat
import struct
import tarfile
import uuid

import pytest

from app.ml.train.awaaz_archive import (
    VerifiedAwaazArchive,
    VerifiedAwaazPair,
    verify_awaaz_training_archive,
)
from app.ml.train.awaaz_evaluation_plan import (
    build_awaaz_corpus_plan,
    main as evaluation_plan_main,
)
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


def test_a_small_archive_produces_only_a_privacy_safe_collect_more_report():
    patient_id = uuid.uuid4()
    audio = _wav()
    private_text = "Private patient phrase"
    pair = VerifiedAwaazPair(
        capture_id=uuid.uuid4(),
        source="card_tap",
        target_text=private_text,
        lang="en",
        duration_seconds=0.25,
        sha256=hashlib.sha256(audio).hexdigest(),
        audio=audio,
    )
    archive = VerifiedAwaazArchive(
        patient_id=patient_id,
        exported_at="2026-08-28T03:00:00.000Z",
        pairs=(pair,),
    )

    report = build_awaaz_corpus_plan(archive)
    encoded = json.dumps(report)

    assert report["status"] == "collect_more"
    assert "split_plan" not in report
    assert report["claims"] == {
        "model_trained": False,
        "evaluation_run": False,
        "clinical_metrics": False,
        "deployment_ready": False,
    }
    assert str(patient_id) not in encoded
    assert str(pair.capture_id) not in encoded
    assert private_text not in encoded
    assert pair.sha256 not in encoded
    assert "RIFF" not in encoded


def test_ready_split_is_deterministic_and_keeps_normalised_phrases_together():
    patient_id = uuid.uuid4()
    audio = _wav()
    pairs = []
    for index in range(60):
        phrase_index = index % 12
        phrase = (
            f"  Phrase   {phrase_index}  "
            if (index // 12) % 2
            else f"phrase {phrase_index}"
        )
        pairs.append(VerifiedAwaazPair(
            capture_id=uuid.UUID(int=index + 1),
            source="card_tap" if index % 2 else "caregiver_review",
            target_text=phrase,
            lang="en",
            duration_seconds=0.25,
            sha256=hashlib.sha256(audio).hexdigest(),
            audio=audio,
        ))
    archive = VerifiedAwaazArchive(
        patient_id=patient_id,
        exported_at="2026-08-28T03:00:00.000Z",
        pairs=tuple(pairs),
    )
    reversed_archive = VerifiedAwaazArchive(
        patient_id=patient_id,
        exported_at=archive.exported_at,
        pairs=tuple(reversed(pairs)),
    )

    report = build_awaaz_corpus_plan(archive)
    reversed_report = build_awaaz_corpus_plan(reversed_archive)
    split = report["split_plan"]

    assert report["status"] == "split_plan_ready"
    assert split == reversed_report["split_plan"]
    assert "phrase 0" not in json.dumps(report)
    assert pairs[0].sha256 not in json.dumps(report)
    assert sum(split["pair_counts"].values()) == 60
    assert all(split["group_counts"][name] > 0 for name in ("train", "validation", "test"))
    capture_to_split = {
        capture_id: name
        for name, capture_ids in split["capture_ids"].items()
        for capture_id in capture_ids
    }
    for phrase_index in range(12):
        ids = [
            str(pair.capture_id)
            for pair in pairs
            if (int(pair.capture_id) - 1) % 12 == phrase_index
        ]
        assert len({capture_to_split[capture_id] for capture_id in ids}) == 1


def test_evaluation_plan_cli_writes_no_model_or_metric_claims(tmp_path, monkeypatch, capsys):
    archive_path = tmp_path / "awaaz.tar"
    _write_archive(archive_path)
    out = tmp_path / "readiness.json"
    monkeypatch.setattr("sys.argv", [
        "awaaz_evaluation_plan", "--archive", str(archive_path), "--out", str(out),
    ])

    evaluation_plan_main()

    payload = json.loads(out.read_text())
    assert payload["status"] == "collect_more"
    assert payload["artifact_type"] == "awaaz_corpus_readiness"
    assert payload["privacy"]["contains_transcripts"] is False
    assert stat.S_IMODE(out.stat().st_mode) == 0o600
    assert "model_trained=false" in capsys.readouterr().out


def test_evaluation_plan_cli_never_overwrites_an_existing_report(
    tmp_path, monkeypatch,
):
    archive_path = tmp_path / "awaaz.tar"
    _write_archive(archive_path)
    out = tmp_path / "readiness.json"
    out.write_text("keep me")
    monkeypatch.setattr("sys.argv", [
        "awaaz_evaluation_plan", "--archive", str(archive_path), "--out", str(out),
    ])

    with pytest.raises(SystemExit, match="already exists"):
        evaluation_plan_main()

    assert out.read_text() == "keep me"
