from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import stat
import struct
import tarfile
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.ml.train.asr_runtime.runtime as runtime
from app.ml.train.asr_runtime import (
    APPROVED_PURPOSE,
    PreflightError,
    RuntimeConfig,
    TrainingRuntimeError,
    build_group_phrase_disjoint_split,
    build_phrase_disjoint_split,
    governance_receipt_signature,
    preflight_real_training,
    run_preflight,
    run_synthetic_smoke,
    run_training,
    sha256_directory,
    sha256_file,
    verify_governance_receipt,
)


NOW = datetime(2026, 8, 31, 6, 0, tzinfo=timezone.utc)
PATIENT_ID = uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
KEY = b"dedicated-awaaz-governance-key!" * 2
KEY_ID = "awaaz-governance-test"
KEY_SHA256 = hashlib.sha256(KEY).hexdigest()


@dataclass(frozen=True)
class SplitRow:
    token: str
    lang: str
    target_text: str


def _wav(index: int, *, rate: int = 16_000, channels: int = 1, width: int = 2) -> bytes:
    frames = rate // 4
    if width == 2:
        one_frame = struct.pack("<h", (index % 200) + 1) * channels
    else:
        one_frame = bytes([(index % 200) + 1]) * channels
    pcm = one_frame * frames
    byte_rate = rate * channels * width
    block_align = channels * width
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(pcm))
        + b"WAVE"
        + b"fmt "
        + struct.pack("<IHHIIHH", 16, 1, channels, rate, byte_rate, block_align, width * 8)
        + b"data"
        + struct.pack("<I", len(pcm))
        + pcm
    )


def _write_archive(
    path: Path,
    *,
    patient_id: uuid.UUID = PATIENT_ID,
    count: int = 50,
    phrase_groups: int = 10,
    bad_language_at: int | None = None,
    bad_pcm_at: int | None = None,
) -> tuple[list[str], list[str]]:
    files: dict[str, bytes] = {"README.txt": b"sensitive authorised handoff\n"}
    pairs = []
    phrases = []
    audio_hashes = []
    for index in range(count):
        capture_id = uuid.UUID(int=1_000 + index)
        card_id = uuid.UUID(int=2_000 + index)
        phrase_number = index % phrase_groups
        phrase = f"Private phrase {phrase_number}"
        audio = _wav(index, rate=8_000 if index == bad_pcm_at else 16_000)
        digest = hashlib.sha256(audio).hexdigest()
        audio_name = f"audio/{capture_id}.wav"
        files[audio_name] = audio
        pairs.append(
            {
                "capture_id": str(capture_id),
                "source": "card_tap",
                "card_id": str(card_id),
                "utterance_id": None,
                "target_text": phrase,
                "lang": "hi" if index == bad_language_at else "en",
                "duration_seconds": 0.25,
                "sha256": digest,
                "size_bytes": len(audio),
                "created_at": "2026-08-31T05:00:00Z",
                "audio_file": audio_name,
            }
        )
        phrases.append(phrase)
        audio_hashes.append(digest)
    manifest = {
        "schema_version": 1,
        "patient_id": str(patient_id),
        "exported_at": "2026-08-31T05:30:00Z",
        "media_uploaded_by_app": False,
        "pairs": pairs,
    }
    files["manifest.json"] = (json.dumps(manifest) + "\n").encode()
    with tarfile.open(path, "w") as archive:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = 0o600
            archive.addfile(info, io.BytesIO(content))
    return phrases, audio_hashes


def _write_base_model(path: Path) -> None:
    path.mkdir()
    (path / "config.json").write_text(
        json.dumps({"model_type": "wav2vec2", "architectures": ["Wav2Vec2ForCTC"]})
    )
    (path / "model.safetensors").write_bytes(b"structural-preflight-weight-placeholder")


def _receipt_body(
    archive_path: Path,
    base_model_path: Path,
    *,
    patient_id: uuid.UUID = PATIENT_ID,
) -> dict:
    approved_at = NOW - timedelta(hours=1)
    return {
        "schema_version": 1,
        "receipt_type": "awaaz_asr_training_governance",
        "receipt_id": str(uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")),
        "status": "approved",
        "purpose": APPROVED_PURPOSE,
        "data_subject_id": str(patient_id),
        "language": "en",
        "archive_sha256": sha256_file(archive_path),
        "base_model_sha256": sha256_directory(base_model_path),
        "archive_export_receipt_acknowledged": True,
        "approved_at": approved_at.isoformat(),
        "expires_at": (NOW + timedelta(hours=2)).isoformat(),
        "revocation_checked_at": (NOW - timedelta(minutes=5)).isoformat(),
        "consent": {
            "granted": True,
            "revoked": False,
            "recorded_at": (NOW - timedelta(hours=2)).isoformat(),
            "scopes": ["asr_training", "patient_specific_adapter_storage"],
        },
        "governance": {
            "approved": True,
            "protocol_id": "AWA-AUTH-001",
            "approval_id": "APPROVAL-001",
            "approved_at": (NOW - timedelta(hours=3)).isoformat(),
        },
    }


def _sign_receipt(body: dict, path: Path, *, key: bytes = KEY) -> dict:
    receipt = copy.deepcopy(body)
    receipt["signature"] = {
        "algorithm": "HMAC-SHA256",
        "key_id": KEY_ID,
    }
    receipt["signature"]["digest"] = governance_receipt_signature(receipt, key)
    path.write_text(json.dumps(receipt, indent=2) + "\n")
    os.chmod(path, 0o600)
    return receipt


def _fixture(tmp_path: Path, **archive_options):
    archive_path = tmp_path / "patient-secret-archive.tar"
    phrases, audio_hashes = _write_archive(archive_path, **archive_options)
    base_model_path = tmp_path / "patient-secret-base-model"
    _write_base_model(base_model_path)
    receipt_path = tmp_path / "patient-secret-governance.json"
    receipt = _sign_receipt(_receipt_body(archive_path, base_model_path), receipt_path)
    output_dir = tmp_path / "private-output"
    config = RuntimeConfig(
        archive_path=archive_path,
        receipt_path=receipt_path,
        base_model_path=base_model_path,
        output_dir=output_dir,
        governance_key_id=KEY_ID,
        governance_key_sha256=KEY_SHA256,
    )
    return SimpleNamespace(
        archive=archive_path,
        base=base_model_path,
        receipt_path=receipt_path,
        receipt=receipt,
        output=output_dir,
        config=config,
        phrases=phrases,
        audio_hashes=audio_hashes,
    )


def _fake_dependencies() -> runtime.DependencyReport:
    return runtime.DependencyReport(
        versions={
            "numpy": "1.26.4",
            "torch": "2.4.1",
            "transformers": "4.44.2",
            "peft": "0.12.0",
            "accelerate": "0.34.2",
            "safetensors": "0.4.5",
        }
    )


def _split_membership(plan, rows):
    return {
        name: frozenset(rows[index].token for index in getattr(plan, name))
        for name in ("train", "validation", "test")
    }


def test_dependency_contract_is_pinned_and_preflight_rejects_version_drift(monkeypatch):
    requirements = (
        Path(runtime.__file__).with_name("requirements.txt").read_text().splitlines()
    )
    declared = {
        line.split("==", 1)[0]: line.split("==", 1)[1]
        for line in requirements
        if line and not line.startswith("#")
    }
    assert declared == runtime.PINNED_DEPENDENCY_VERSIONS

    installed = dict(runtime.PINNED_DEPENDENCY_VERSIONS)
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda _package: object())
    monkeypatch.setattr(runtime.importlib.metadata, "version", installed.__getitem__)
    report = runtime._check_dependencies()
    assert report.versions == dict(sorted(installed.items()))

    installed["torch"] = "2.4.0"
    with pytest.raises(PreflightError, match="dependencies_incompatible"):
        runtime._check_dependencies()

    installed["torch"] = "2.4.1+cu124"
    assert runtime._check_dependencies().versions["torch"] == "2.4.1+cu124"


def test_import_help_and_synthetic_smoke_need_no_heavy_dependencies(
    tmp_path, monkeypatch, capsys,
):
    imported = []

    def blocked_import(name):
        imported.append(name)
        raise AssertionError("heavy import attempted")

    monkeypatch.setattr(runtime.importlib, "import_module", blocked_import)
    with pytest.raises(SystemExit) as help_exit:
        runtime.main(["--help"])
    assert help_exit.value.code == 0

    manifest_path = run_synthetic_smoke(tmp_path / "smoke")
    payload = json.loads(manifest_path.read_text())
    assert imported == []
    assert payload["status"] == "synthetic_smoke_completed_no_model"
    assert payload["mode"] == "synthetic_metadata_smoke"
    assert not any(payload["claims"].values())
    assert "metrics" not in payload
    assert payload["artifacts"] == []
    assert payload["inputs"]["real_archive_read"] is False
    assert payload["split"]["invariants"] == {
        "group_disjoint": True,
        "exact_normalised_phrase_within_language_disjoint": True,
        "speaker_disjoint": False,
    }
    assert stat.S_IMODE(manifest_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(manifest_path.parent.stat().st_mode) == 0o700
    assert "model_trained=false" not in capsys.readouterr().err


def test_hashes_are_reproducible_content_and_path_sensitive_and_reject_symlinks(tmp_path):
    sample = tmp_path / "sample"
    sample.write_bytes(b"abc")
    assert sha256_file(sample) == hashlib.sha256(b"abc").hexdigest()

    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    (first / "a").write_bytes(b"one")
    (first / "b").write_bytes(b"two")
    (second / "b").write_bytes(b"two")
    (second / "a").write_bytes(b"one")
    os.utime(second / "a", (1, 1))
    assert sha256_directory(first) == sha256_directory(second)
    (second / "b").write_bytes(b"changed")
    assert sha256_directory(first) != sha256_directory(second)
    (second / "b").write_bytes(b"two")
    (second / "b").rename(second / "c")
    assert sha256_directory(first) != sha256_directory(second)

    outside = tmp_path / "outside"
    outside.write_bytes(b"secret")
    (first / "link").symlink_to(outside)
    with pytest.raises(PreflightError, match="base_model_symlink_rejected"):
        sha256_directory(first)


def test_group_phrase_split_uses_transitive_components_and_is_order_independent():
    rows = [
        SplitRow("a", "en", "Ａlpha"),
        SplitRow("b", "en", "Beta"),
        SplitRow("c", "en", "  beta  "),
        SplitRow("d", "en", "Gamma"),
        SplitRow("e", "en", "Delta"),
        SplitRow("f", "en", "Epsilon"),
    ]
    groups = ["audio-1", "audio-1", "audio-2", "audio-3", "audio-4", "audio-5"]
    plan = build_group_phrase_disjoint_split(rows, groups, seed=42)
    membership = _split_membership(plan, rows)
    assert sum(map(len, membership.values())) == len(rows)
    assert not (membership["train"] & membership["validation"])
    assert not (membership["train"] & membership["test"])
    assert any({"a", "b", "c"}.issubset(values) for values in membership.values())

    order = [5, 2, 0, 4, 1, 3]
    reordered_rows = [rows[index] for index in order]
    reordered_groups = [groups[index] for index in order]
    reordered = build_group_phrase_disjoint_split(reordered_rows, reordered_groups, seed=42)
    assert _split_membership(reordered, reordered_rows) == membership

    phrase_plan = build_phrase_disjoint_split(
        [
            SplitRow("x", "en", "  HELLO  world"),
            SplitRow("y", "en", "hello world"),
            SplitRow("z", "en", "third"),
            SplitRow("q", "en", "fourth"),
        ]
    )
    assert any({0, 1}.issubset(set(getattr(phrase_plan, name))) for name in ("train", "validation", "test"))


@pytest.mark.parametrize(
    "mutation, expected_code",
    [
        (lambda value: value.__setitem__("status", "pending"), "receipt_not_approved"),
        (lambda value: value.__setitem__("purpose", "generic_training"), "receipt_not_approved"),
        (lambda value: value.__setitem__("archive_sha256", "0" * 64), "receipt_input_mismatch"),
        (lambda value: value.__setitem__("base_model_sha256", "1" * 64), "receipt_input_mismatch"),
        (lambda value: value.__setitem__("data_subject_id", str(uuid.uuid4())), "receipt_subject_mismatch"),
        (lambda value: value["consent"].__setitem__("revoked", True), "consent_not_active"),
        (lambda value: value["consent"].__setitem__("scopes", ["asr_training"]), "consent_scope_missing"),
        (lambda value: value["governance"].__setitem__("approved", False), "governance_not_approved"),
        (
            lambda value: value.__setitem__("expires_at", (NOW - timedelta(seconds=1)).isoformat()),
            "receipt_expired",
        ),
        (
            lambda value: value.__setitem__(
                "revocation_checked_at", (NOW - timedelta(hours=25)).isoformat()
            ),
            "revocation_check_stale",
        ),
    ],
)
def test_governance_receipt_fails_closed_on_mutated_claims(
    tmp_path, mutation, expected_code,
):
    fixture = _fixture(tmp_path)
    mutated = copy.deepcopy(fixture.receipt)
    mutated.pop("signature")
    mutation(mutated)
    _sign_receipt(mutated, fixture.receipt_path)
    with pytest.raises(PreflightError, match=expected_code):
        verify_governance_receipt(
            fixture.receipt_path,
            KEY,
            expected_archive_sha256=sha256_file(fixture.archive),
            expected_base_model_sha256=sha256_directory(fixture.base),
            expected_patient_id=PATIENT_ID,
            expected_language="en",
            now=NOW,
        )


def test_receipt_rejects_bad_signature_duplicate_keys_and_short_key(tmp_path):
    fixture = _fixture(tmp_path)
    fixture.receipt["signature"]["key_id"] = "unauthenticated-key-id-change"
    fixture.receipt_path.write_text(json.dumps(fixture.receipt))
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        verify_governance_receipt(
            fixture.receipt_path,
            KEY,
            expected_archive_sha256=sha256_file(fixture.archive),
            expected_base_model_sha256=sha256_directory(fixture.base),
            expected_patient_id=PATIENT_ID,
            expected_language="en",
            now=NOW,
        )

    fixture.receipt = _sign_receipt(
        _receipt_body(fixture.archive, fixture.base), fixture.receipt_path
    )
    fixture.receipt["signature"]["digest"] = "0" * 64
    fixture.receipt_path.write_text(json.dumps(fixture.receipt))
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        verify_governance_receipt(
            fixture.receipt_path,
            KEY,
            expected_archive_sha256=sha256_file(fixture.archive),
            expected_base_model_sha256=sha256_directory(fixture.base),
            expected_patient_id=PATIENT_ID,
            expected_language="en",
            now=NOW,
        )

    encoded = json.dumps(fixture.receipt)
    fixture.receipt_path.write_text('{"status":"approved",' + encoded[1:])
    with pytest.raises(PreflightError, match="receipt_invalid"):
        verify_governance_receipt(
            fixture.receipt_path,
            KEY,
            expected_archive_sha256=sha256_file(fixture.archive),
            expected_base_model_sha256=sha256_directory(fixture.base),
            expected_patient_id=PATIENT_ID,
            expected_language="en",
            now=NOW,
        )

    with pytest.raises(PreflightError, match="receipt_key_invalid"):
        governance_receipt_signature({}, b"short")


def test_preflight_verifies_receipt_pcm_split_and_dependencies_without_private_output(
    tmp_path, monkeypatch,
):
    fixture = _fixture(tmp_path)
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    representation = repr(prepared)
    assert str(PATIENT_ID) not in representation
    assert str(fixture.archive) not in representation
    assert fixture.audio_hashes[0] not in representation
    assert prepared.pair_count == 50
    assert prepared.component_count == 10
    assert prepared.split.as_manifest()["invariants"]["speaker_disjoint"] is False

    manifest_path = run_preflight(fixture.config, KEY, now=NOW)
    payload = json.loads(manifest_path.read_text())
    encoded = json.dumps(payload)
    assert payload["status"] == "preflight_passed_training_not_started"
    assert payload["inputs"]["archive_sha256"] == sha256_file(fixture.archive)
    assert payload["inputs"]["base_model_tree_sha256"] == sha256_directory(fixture.base)
    assert not any(payload["claims"].values())
    assert stat.S_IMODE(manifest_path.stat().st_mode) == 0o600
    assert str(PATIENT_ID) not in encoded
    assert str(fixture.archive) not in encoded
    assert "Private phrase" not in encoded
    assert all(digest not in encoded for digest in fixture.audio_hashes)


@pytest.mark.parametrize(
    "options, expected_code",
    [
        ({"bad_language_at": 0}, "archive_language_mismatch"),
        ({"bad_pcm_at": 0}, "audio_contract_invalid"),
        ({"count": 49}, "corpus_too_small"),
        ({"phrase_groups": 2}, "split_not_ready"),
    ],
)
def test_real_preflight_rejects_unusable_archive_before_heavy_import(
    tmp_path, monkeypatch, options, expected_code,
):
    fixture = _fixture(tmp_path, **options)
    imported = False

    def should_not_import():
        nonlocal imported
        imported = True
        raise AssertionError("optional dependency gate reached too soon")

    monkeypatch.setattr(runtime, "_check_dependencies", should_not_import)
    with pytest.raises(PreflightError, match=expected_code):
        preflight_real_training(fixture.config, KEY, now=NOW)
    assert imported is False
    assert not fixture.output.exists()


def test_bad_receipt_blocks_before_archive_verifier_and_redacts_private_values(
    tmp_path, monkeypatch, capsys, caplog,
):
    fixture = _fixture(tmp_path)
    fixture.receipt["signature"]["digest"] = "0" * 64
    fixture.receipt_path.write_text(json.dumps(fixture.receipt))
    archive_verified = False
    archive_hashed = False
    original_sha256_file = runtime.sha256_file

    def forbidden_archive_verify(_path):
        nonlocal archive_verified
        archive_verified = True
        raise AssertionError("archive media was opened before receipt approval")

    def guarded_hash(path):
        nonlocal archive_hashed
        if Path(path) == fixture.archive:
            archive_hashed = True
            raise AssertionError("archive media was hashed before receipt approval")
        return original_sha256_file(path)

    monkeypatch.setattr(runtime, "verify_awaaz_training_archive", forbidden_archive_verify)
    monkeypatch.setattr(runtime, "sha256_file", guarded_hash)
    with pytest.raises(PreflightError) as caught:
        preflight_real_training(fixture.config, KEY, now=NOW)
    assert archive_verified is False
    assert archive_hashed is False
    captured = capsys.readouterr()
    public = str(caught.value) + captured.out + captured.err + caplog.text
    assert str(PATIENT_ID) not in public
    assert str(fixture.archive) not in public
    assert fixture.phrases[0] not in public
    assert fixture.audio_hashes[0] not in public
    assert KEY.hex() not in public
    assert not fixture.output.exists()


def test_hard_corpus_floors_and_pinned_trust_root_cannot_be_weakened(tmp_path):
    fixture = _fixture(tmp_path)
    with pytest.raises(PreflightError, match="config_invalid"):
        preflight_real_training(
            replace(fixture.config, minimum_pairs=1, minimum_components=1),
            KEY,
            now=NOW,
        )
    with pytest.raises(PreflightError, match="governance_trust_root_mismatch"):
        preflight_real_training(
            replace(fixture.config, governance_key_sha256="0" * 64),
            KEY,
            now=NOW,
        )


def test_checkpoint_index_cannot_escape_hash_tree_or_use_pickle_weights(tmp_path):
    fixture = _fixture(tmp_path)
    outside = tmp_path / "outside.safetensors"
    outside.write_bytes(b"unapproved")
    (fixture.base / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"encoder.weight": "../outside.safetensors"}})
    )
    fixture.receipt = _sign_receipt(
        _receipt_body(fixture.archive, fixture.base), fixture.receipt_path
    )
    with pytest.raises(PreflightError, match="base_weights_unsafe"):
        preflight_real_training(fixture.config, KEY, now=NOW)

    (fixture.base / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": {"encoder.weight": "model.bin"}})
    )
    (fixture.base / "model.bin").write_bytes(b"pickle-shaped-input-is-not-accepted")
    fixture.receipt = _sign_receipt(
        _receipt_body(fixture.archive, fixture.base), fixture.receipt_path
    )
    with pytest.raises(PreflightError, match="unsafe_weight_format"):
        preflight_real_training(fixture.config, KEY, now=NOW)


def test_publish_reservation_never_overwrites_a_racing_destination(tmp_path, monkeypatch):
    output = tmp_path / "racing-output"
    original_harden = runtime._harden_and_fsync_tree

    def create_racer(staging):
        output.mkdir()
        (output / "keep.txt").write_text("keep")
        original_harden(staging)

    monkeypatch.setattr(runtime, "_harden_and_fsync_tree", create_racer)
    with pytest.raises(TrainingRuntimeError, match="artifact_publish_failed"):
        run_synthetic_smoke(output)
    assert (output / "keep.txt").read_text() == "keep"
    assert not list(tmp_path.glob(".asr-runtime-*"))


def test_output_is_no_overwrite_not_stageable_and_not_inside_base_model(tmp_path, monkeypatch):
    fixture = _fixture(tmp_path)
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture.output.mkdir()
    with pytest.raises(PreflightError, match="output_exists"):
        preflight_real_training(fixture.config, KEY, now=NOW)

    nested_config = RuntimeConfig(
        archive_path=fixture.archive,
        receipt_path=fixture.receipt_path,
        base_model_path=fixture.base,
        output_dir=fixture.base / "private-adapter",
        governance_key_id=KEY_ID,
        governance_key_sha256=KEY_SHA256,
    )
    with pytest.raises(PreflightError, match="unsafe_output_location"):
        preflight_real_training(nested_config, KEY, now=NOW)

    repo_output = Path(__file__).resolve().parents[1] / "app" / "unsafe-private-adapter"
    repo_config = RuntimeConfig(
        archive_path=fixture.archive,
        receipt_path=fixture.receipt_path,
        base_model_path=fixture.base,
        output_dir=repo_output,
        governance_key_id=KEY_ID,
        governance_key_sha256=KEY_SHA256,
    )
    with pytest.raises(PreflightError, match="unsafe_output_location"):
        preflight_real_training(repo_config, KEY, now=NOW)


def test_training_orchestration_hashes_artifacts_and_sanitizes_paths(tmp_path, monkeypatch):
    fixture = _fixture(tmp_path)
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)

    class FakeModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"real-optimisation-placeholder")
            (destination / "adapter_config.json").write_text(
                json.dumps({"base_model_name_or_path": str(fixture.base.resolve())})
            )

    monkeypatch.setattr(runtime, "preflight_real_training", lambda *_args, **_kwargs: prepared)
    monkeypatch.setattr(runtime, "_assert_inputs_unchanged", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, "_load_ml_runtime", lambda: (object(), object(), object(), object()))
    monkeypatch.setattr(runtime, "_seed_runtime", lambda *_args: None)
    monkeypatch.setattr(runtime, "_resolve_device", lambda *_args: SimpleNamespace(type="cpu"))
    monkeypatch.setattr(
        runtime,
        "_load_local_processor_and_model",
        lambda *_args: (object(), object(), "/private/model/snapshot"),
    )
    monkeypatch.setattr(runtime, "_apply_lora", lambda *_args: (FakeModel(), 128))
    monkeypatch.setattr(
        runtime,
        "_optimise_lora",
        lambda *_args: {"optimizer_steps": 3, "examples_seen": 30, "epochs_completed": 1},
    )

    manifest_path = run_training(fixture.config, KEY, now=NOW)
    payload = json.loads(manifest_path.read_text())
    assert payload["status"] == "trained_not_evaluated"
    assert payload["claims"]["model_trained"] is True
    assert payload["claims"]["evaluation_run"] is False
    assert payload["claims"]["clinical_metrics"] is False
    assert payload["claims"]["deployment_ready"] is False
    assert "metrics" not in payload
    config_text = (fixture.output / "adapter" / "adapter_config.json").read_text()
    assert str(fixture.base) not in config_text
    artifact_paths = {item["path"] for item in payload["artifacts"]}
    assert artifact_paths == {
        "adapter/adapter_config.json",
        "adapter/adapter_model.safetensors",
    }
    for item in payload["artifacts"]:
        artifact = fixture.output / item["path"]
        assert item["sha256"] == hashlib.sha256(artifact.read_bytes()).hexdigest()
        assert stat.S_IMODE(artifact.stat().st_mode) == 0o600


def test_training_save_failure_leaves_no_completed_or_partial_output(tmp_path, monkeypatch):
    fixture = _fixture(tmp_path)
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)

    class BrokenModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "partial.bin").write_bytes(b"partial")
            raise OSError("private path should not escape")

    monkeypatch.setattr(runtime, "preflight_real_training", lambda *_args, **_kwargs: prepared)
    monkeypatch.setattr(runtime, "_assert_inputs_unchanged", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, "_load_ml_runtime", lambda: (object(), object(), object(), object()))
    monkeypatch.setattr(runtime, "_seed_runtime", lambda *_args: None)
    monkeypatch.setattr(runtime, "_resolve_device", lambda *_args: SimpleNamespace(type="cpu"))
    monkeypatch.setattr(
        runtime,
        "_load_local_processor_and_model",
        lambda *_args: (object(), object(), "/private/model/snapshot"),
    )
    monkeypatch.setattr(runtime, "_apply_lora", lambda *_args: (BrokenModel(), 128))
    monkeypatch.setattr(
        runtime,
        "_optimise_lora",
        lambda *_args: {"optimizer_steps": 1, "examples_seen": 10, "epochs_completed": 1},
    )
    with pytest.raises(TrainingRuntimeError, match="adapter_save_failed"):
        run_training(fixture.config, KEY, now=NOW)
    assert not fixture.output.exists()
    assert not list(tmp_path.glob(".asr-runtime-*"))
