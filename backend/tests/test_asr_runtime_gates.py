"""Deletion-sensitive tests for the fail-closed ASR training runtime.

``tests/test_asr_runtime.py`` proves the happy path and a first tranche of refusals.  An
audit of that suite found a large set of gates in ``asr_runtime/runtime.py`` that could be
deleted outright without turning a single test red: the receipt time-window arithmetic, the
consent ``granted`` flag, the language and subject bindings, most of the audio contract, the
dependency check (every test monkeypatches it), and the corpus-variety floor.

Every test in this file is written so that removing the specific check it names makes it
fail.  Where a refusal happens on a path that could otherwise have produced an artifact, the
test also asserts that no output directory, no staging directory, and no partial file
survived — a refusal that leaves patient-derived bytes on disk is not a refusal.
"""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import tarfile
import uuid
from dataclasses import replace
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
OTHER_PATIENT_ID = uuid.UUID("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
KEY = b"dedicated-awaaz-governance-key!" * 2
KEY_ID = "awaaz-governance-test"
KEY_SHA256 = hashlib.sha256(KEY).hexdigest()

# The runtime refuses any WAV shorter than this; the shared fixture sits exactly on the
# boundary, which is why the "too short" case below uses the boundary minus one frame.
MINIMUM_FRAMES = 4_000


# --------------------------------------------------------------------------------------
# Fixture construction.
#
# These mirror the helpers in tests/test_asr_runtime.py, which are module-private there.
# They are widened rather than imported: several gates below need per-pair control over
# audio geometry, phrase, and subject that the original helpers do not expose.
# --------------------------------------------------------------------------------------


def _wav(
    index: int,
    *,
    rate: int = 16_000,
    channels: int = 1,
    width: int = 2,
    frames: int | None = None,
    format_tag: int = 1,
    declared_data_bytes: int | None = None,
) -> bytes:
    """Build one RIFF/WAVE payload with every geometry field independently controllable."""
    frame_count = rate // 4 if frames is None else frames
    if width == 2:
        one_frame = struct.pack("<h", (index % 200) + 1) * channels
    else:
        one_frame = bytes([(index % 200) + 1]) * channels
    pcm = one_frame * frame_count
    byte_rate = rate * channels * width
    block_align = channels * width
    # A declared length larger than the bytes that follow is the classic truncated-payload
    # case: the header still parses, so only an explicit length check catches it.
    declared = len(pcm) if declared_data_bytes is None else declared_data_bytes
    return (
        b"RIFF"
        + struct.pack("<I", 36 + declared)
        + b"WAVE"
        + b"fmt "
        + struct.pack(
            "<IHHIIHH", 16, format_tag, channels, rate, byte_rate, block_align, width * 8
        )
        + b"data"
        + struct.pack("<I", declared)
        + pcm
    )


def _pair_specs(
    *,
    count: int = 50,
    phrase_groups: int = 10,
    lang: str = "en",
) -> list[dict]:
    """Return editable per-pair specs; tests mutate individual entries before writing."""
    return [
        {
            "phrase": f"Private phrase {index % phrase_groups}",
            "lang": lang,
            "audio": _wav(index),
            "duration_seconds": 0.25,
        }
        for index in range(count)
    ]


def _write_archive(
    path: Path,
    specs: list[dict],
    *,
    patient_id: uuid.UUID = PATIENT_ID,
) -> list[str]:
    """Write a strictly-conformant Awaaz export tar and return the per-pair audio hashes."""
    files: dict[str, bytes] = {"README.txt": b"sensitive authorised handoff\n"}
    pairs = []
    audio_hashes = []
    for index, spec in enumerate(specs):
        capture_id = uuid.UUID(int=1_000 + index)
        card_id = uuid.UUID(int=2_000 + index)
        audio = spec["audio"]
        digest = hashlib.sha256(audio).hexdigest()
        audio_name = f"audio/{capture_id}.wav"
        files[audio_name] = audio
        pairs.append(
            {
                "capture_id": str(capture_id),
                "source": "card_tap",
                "card_id": str(card_id),
                "utterance_id": None,
                "target_text": spec["phrase"],
                "lang": spec["lang"],
                "duration_seconds": spec["duration_seconds"],
                "sha256": digest,
                "size_bytes": len(audio),
                "created_at": "2026-08-31T05:00:00Z",
                "audio_file": audio_name,
            }
        )
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
    return audio_hashes


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
    language: str = "en",
    reference_time: datetime = NOW,
) -> dict:
    approved_at = reference_time - timedelta(hours=1)
    return {
        "schema_version": 1,
        "receipt_type": "awaaz_asr_training_governance",
        "receipt_id": str(uuid.UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")),
        "status": "approved",
        "purpose": APPROVED_PURPOSE,
        "data_subject_id": str(patient_id),
        "language": language,
        "archive_sha256": sha256_file(archive_path),
        "base_model_sha256": sha256_directory(base_model_path),
        "archive_export_receipt_acknowledged": True,
        "approved_at": approved_at.isoformat(),
        "expires_at": (reference_time + timedelta(hours=2)).isoformat(),
        "revocation_checked_at": (reference_time - timedelta(minutes=5)).isoformat(),
        "consent": {
            "granted": True,
            "revoked": False,
            "recorded_at": (reference_time - timedelta(hours=2)).isoformat(),
            "scopes": ["asr_training", "patient_specific_adapter_storage"],
        },
        "governance": {
            "approved": True,
            "protocol_id": "AWA-AUTH-001",
            "approval_id": "APPROVAL-001",
            "approved_at": (reference_time - timedelta(hours=3)).isoformat(),
        },
    }


def _sign_receipt(body: dict, path: Path, *, key: bytes = KEY) -> dict:
    receipt = copy.deepcopy(body)
    receipt.pop("signature", None)
    receipt["signature"] = {"algorithm": "HMAC-SHA256", "key_id": KEY_ID}
    receipt["signature"]["digest"] = governance_receipt_signature(receipt, key)
    path.write_text(json.dumps(receipt, indent=2) + "\n")
    os.chmod(path, 0o600)
    return receipt


def _fixture(
    tmp_path: Path,
    *,
    specs: list[dict] | None = None,
    patient_id: uuid.UUID = PATIENT_ID,
    receipt_patient_id: uuid.UUID | None = None,
    receipt_language: str = "en",
    config_language: str = "en",
    reference_time: datetime = NOW,
):
    """Assemble a fully authorised run whose receipt is re-signed over the real inputs."""
    archive_path = tmp_path / "patient-secret-archive.tar"
    audio_hashes = _write_archive(
        archive_path, specs if specs is not None else _pair_specs(), patient_id=patient_id
    )
    base_model_path = tmp_path / "patient-secret-base-model"
    _write_base_model(base_model_path)
    receipt_path = tmp_path / "patient-secret-governance.json"
    body = _receipt_body(
        archive_path,
        base_model_path,
        patient_id=receipt_patient_id or patient_id,
        language=receipt_language,
        reference_time=reference_time,
    )
    receipt = _sign_receipt(body, receipt_path)
    output_dir = tmp_path / "private-output"
    config = RuntimeConfig(
        archive_path=archive_path,
        receipt_path=receipt_path,
        base_model_path=base_model_path,
        output_dir=output_dir,
        governance_key_id=KEY_ID,
        governance_key_sha256=KEY_SHA256,
        language=config_language,
    )
    return SimpleNamespace(
        archive=archive_path,
        base=base_model_path,
        receipt_path=receipt_path,
        receipt=receipt,
        body=body,
        output=output_dir,
        config=config,
        audio_hashes=audio_hashes,
        tmp_path=tmp_path,
    )


def _fake_dependencies() -> runtime.DependencyReport:
    """Stand in for the real pinned stack, which is deliberately not installed in CI."""
    return runtime.DependencyReport(versions=dict(runtime.PINNED_DEPENDENCY_VERSIONS))


def _assert_nothing_was_written(fixture) -> None:
    """A refusal must leave no output directory and no abandoned private staging tree."""
    assert not fixture.output.exists()
    assert not os.path.lexists(fixture.output)
    assert not list(fixture.tmp_path.glob(".asr-runtime-*"))
    assert not list(fixture.tmp_path.glob("**/.asr-runtime-*"))


def _resign(fixture, mutate) -> None:
    """Apply a mutation to the receipt body and re-sign it, so the signature stays valid.

    Mutating a signed receipt without re-signing would only ever prove that the HMAC works.
    Every semantic gate below must refuse a receipt that is perfectly authentic.
    """
    body = copy.deepcopy(fixture.body)
    mutate(body)
    fixture.receipt = _sign_receipt(body, fixture.receipt_path)


# --------------------------------------------------------------------------------------
# 1. Corpus variety floor.
# --------------------------------------------------------------------------------------


def test_a_corpus_with_enough_pairs_but_too_few_distinct_phrases_is_refused(
    tmp_path, monkeypatch,
):
    """Fifty recordings of four phrases is not fifty examples; it is four, repeated.

    A patient-specific adapter fitted to a handful of phrases memorises those phrases.  The
    pair-count floor alone cannot see this, and the split's own three-component floor is far
    too permissive.  The existing suite only ever tries two phrase groups (which trips the
    earlier ``split_not_ready``) and ten (which passes), so the variety floor between them
    was never exercised at all.
    """
    imported = False

    def should_not_import():
        nonlocal imported
        imported = True
        raise AssertionError("the dependency gate was reached despite an unusable corpus")

    monkeypatch.setattr(runtime, "_check_dependencies", should_not_import)
    fixture = _fixture(tmp_path, specs=_pair_specs(count=50, phrase_groups=5))
    with pytest.raises(PreflightError, match="corpus_not_varied_enough"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    assert imported is False
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize("phrase_groups", [3, 6, 9])
def test_every_phrase_count_below_the_variety_floor_is_refused(
    tmp_path, monkeypatch, phrase_groups,
):
    """Nine components is the last refused value; the floor is a cliff, not a suggestion."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path, specs=_pair_specs(count=50, phrase_groups=phrase_groups))
    with pytest.raises(PreflightError, match="corpus_not_varied_enough"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_ten_independent_components_is_the_first_accepted_corpus_variety(
    tmp_path, monkeypatch,
):
    """Pin the accepted side of the boundary so the floor cannot drift downward unnoticed."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path, specs=_pair_specs(count=50, phrase_groups=10))
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    assert prepared.component_count == 10
    assert prepared.component_count == runtime.HARD_MINIMUM_COMPONENTS


# --------------------------------------------------------------------------------------
# 2. The dependency gate, exercised for real.
# --------------------------------------------------------------------------------------


def _patch_dependency_probe(monkeypatch, installed: dict[str, str]) -> None:
    """Simulate an environment where exactly ``installed`` is importable, at ``version``."""
    monkeypatch.setattr(
        runtime.importlib.util,
        "find_spec",
        lambda package: object() if package in installed else None,
    )

    def version(package: str) -> str:
        if package not in installed:
            raise runtime.importlib.metadata.PackageNotFoundError(package)
        return installed[package]

    monkeypatch.setattr(runtime.importlib.metadata, "version", version)


@pytest.mark.parametrize("absent", sorted(runtime.PINNED_DEPENDENCY_VERSIONS))
def test_any_single_missing_training_dependency_blocks_the_run(monkeypatch, absent):
    """The trainer must never start on a partially installed stack.

    Every existing test monkeypatches ``_check_dependencies`` wholesale, so its body has
    never executed under test.  Each package is checked individually here because a loop
    that stops at the first name would still pass a test that only removes ``numpy``.
    """
    installed = {
        name: pinned
        for name, pinned in runtime.PINNED_DEPENDENCY_VERSIONS.items()
        if name != absent
    }
    _patch_dependency_probe(monkeypatch, installed)
    with pytest.raises(PreflightError, match="dependencies_missing"):
        runtime._check_dependencies()


def test_a_package_that_is_importable_but_unregistered_counts_as_missing(monkeypatch):
    """A shadowed or vendored copy has no recorded version, so it cannot be trusted."""
    monkeypatch.setattr(runtime.importlib.util, "find_spec", lambda _package: object())

    def version(package: str) -> str:
        if package == "peft":
            raise runtime.importlib.metadata.PackageNotFoundError(package)
        return runtime.PINNED_DEPENDENCY_VERSIONS[package]

    monkeypatch.setattr(runtime.importlib.metadata, "version", version)
    with pytest.raises(PreflightError, match="dependencies_missing"):
        runtime._check_dependencies()


@pytest.mark.parametrize(
    "installed_torch",
    ["2.0.1", "2.4.0", "2.5.0", "2.4.1rc1", "2.1.0+cu121"],
)
def test_a_training_dependency_off_the_pinned_version_blocks_the_run(
    monkeypatch, installed_torch,
):
    """Reproducibility of a clinical artifact depends on the exact optimiser stack.

    ``2.4.1rc1`` and ``2.1.0+cu121`` matter specifically: a naive prefix or "starts with"
    comparison would accept the first, and a parser that discarded everything after the
    first dot-separated segment would accept the second.
    """
    installed = dict(runtime.PINNED_DEPENDENCY_VERSIONS)
    installed["torch"] = installed_torch
    _patch_dependency_probe(monkeypatch, installed)
    with pytest.raises(PreflightError, match="dependencies_incompatible"):
        runtime._check_dependencies()


def test_a_local_build_suffix_on_the_pinned_version_is_accepted_and_reported_verbatim(
    monkeypatch,
):
    """A CUDA or Metal local build of the pinned release is the same release.

    PEP 440 local version labels (``+cu121``) identify the wheel build, not the source
    revision, so refusing them would make the runtime unusable on every accelerator host.
    The recorded version keeps the suffix so the manifest describes what actually ran.
    """
    installed = dict(runtime.PINNED_DEPENDENCY_VERSIONS)
    installed["torch"] = f"{runtime.PINNED_DEPENDENCY_VERSIONS['torch']}+cu121"
    _patch_dependency_probe(monkeypatch, installed)
    report = runtime._check_dependencies()
    assert report.versions["torch"] == installed["torch"]
    assert set(report.versions) == set(runtime.PINNED_DEPENDENCY_VERSIONS)


# --------------------------------------------------------------------------------------
# 3-4. Consent and export acknowledgement.
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mutate, expected_code, why",
    [
        pytest.param(
            lambda body: body["consent"].__setitem__("granted", False),
            "consent_not_active",
            "consent explicitly withheld",
            id="granted_false",
        ),
        pytest.param(
            lambda body: body["consent"].pop("granted"),
            "consent_not_active",
            "consent flag absent entirely",
            id="granted_absent",
        ),
        pytest.param(
            lambda body: body["consent"].__setitem__("granted", "yes"),
            "consent_not_active",
            "consent asserted with a truthy non-boolean",
            id="granted_truthy_string",
        ),
        pytest.param(
            lambda body: body["consent"].pop("revoked"),
            "consent_not_active",
            "revocation flag absent, so no negative attestation exists",
            id="revoked_absent",
        ),
        pytest.param(
            lambda body: body.pop("consent"),
            "consent_missing",
            "no consent object at all",
            id="consent_object_absent",
        ),
        pytest.param(
            lambda body: body.__setitem__("consent", ["asr_training"]),
            "consent_missing",
            "consent supplied as a bare list rather than an attested object",
            id="consent_not_an_object",
        ),
    ],
)
def test_a_receipt_whose_consent_was_never_granted_is_refused_before_any_work(
    tmp_path, monkeypatch, mutate, expected_code, why,
):
    """Only the ``revoked`` half of the consent test was covered; ``granted`` was not.

    Deleting ``consent.get("granted") is not True`` left the suite fully green, which means
    a receipt that never recorded an affirmative grant would have authorised training on a
    stroke survivor's voice.  ``granted: "yes"`` is included because a truthiness test would
    accept a string that a governance system might emit by mistake.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _resign(fixture, mutate)
    with pytest.raises(PreflightError, match=expected_code):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(
            lambda body: body.__setitem__("archive_export_receipt_acknowledged", False),
            id="acknowledgement_false",
        ),
        pytest.param(
            lambda body: body.pop("archive_export_receipt_acknowledged"),
            id="acknowledgement_absent",
        ),
        pytest.param(
            lambda body: body.__setitem__("archive_export_receipt_acknowledged", "true"),
            id="acknowledgement_stringly_typed",
        ),
    ],
)
def test_an_unacknowledged_local_archive_handoff_is_refused(tmp_path, monkeypatch, mutate):
    """The archive left the survivor's device; governance must say it accepted custody.

    Without this acknowledgement the receipt approves a purpose but never admits that a
    copy of the patient's recordings now exists on this machine, which is exactly the fact
    a data-protection audit needs recorded.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _resign(fixture, mutate)
    with pytest.raises(PreflightError, match="receipt_not_approved"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 5. Receipt-to-config language binding.
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "receipt_language, config_language",
    [("hi", "en"), ("en", "hi"), ("pa", "en"), ("en", "pa")],
)
def test_a_receipt_approved_for_one_language_cannot_authorise_another(
    tmp_path, monkeypatch, receipt_language, config_language,
):
    """An adapter is fitted to one language; approval for Hindi is not approval for English.

    MMS loads a per-language adapter and a per-language CTC vocabulary, so a mismatch here
    would silently train the wrong head on the patient's audio while the manifest recorded
    an approved run.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(
        tmp_path,
        receipt_language=receipt_language,
        config_language=config_language,
    )
    with pytest.raises(PreflightError, match="receipt_input_mismatch"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 6. Receipt time-window integrity.
# --------------------------------------------------------------------------------------


def test_a_receipt_approved_in_the_future_is_not_yet_valid(tmp_path, monkeypatch):
    """A post-dated approval is either a clock fault or a backdated authorisation.

    Both are reasons to stop: the run would otherwise claim it was covered by an approval
    that had not been given when the training happened.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _resign(
        fixture,
        lambda body: body.update(
            approved_at=(NOW + timedelta(hours=1)).isoformat(),
            expires_at=(NOW + timedelta(hours=2)).isoformat(),
        ),
    )
    with pytest.raises(PreflightError, match="receipt_not_yet_valid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_consent_recorded_after_the_approval_it_supposedly_justified_is_refused(
    tmp_path, monkeypatch,
):
    """Approval cannot precede the consent it rests on; that ordering is the whole point.

    A receipt where consent was captured half an hour after the approval describes a
    governance decision taken without the survivor's agreement and retro-fitted afterwards.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _resign(
        fixture,
        lambda body: body["consent"].__setitem__(
            "recorded_at", (NOW - timedelta(minutes=30)).isoformat()
        ),
    )
    with pytest.raises(PreflightError, match="receipt_time_order_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_governance_approved_after_the_receipt_it_authorises_is_refused(
    tmp_path, monkeypatch,
):
    """The same ordering rule applies to the protocol approval, not only to consent."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _resign(
        fixture,
        lambda body: body["governance"].__setitem__(
            "approved_at", (NOW - timedelta(minutes=30)).isoformat()
        ),
    )
    with pytest.raises(PreflightError, match="receipt_time_order_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize(
    "validity",
    [timedelta(hours=48), timedelta(days=3_650)],
    ids=["forty_eight_hours", "ten_years"],
)
def test_a_receipt_valid_for_longer_than_the_maximum_window_is_refused(
    tmp_path, monkeypatch, validity,
):
    """A signed receipt is a point-in-time revocation check, so its window must stay short.

    A ten-year authorisation is functionally a standing licence to retrain on this
    survivor's voice long after they, or their clinician, could still remember granting it.
    """
    assert validity > runtime.MAX_RECEIPT_VALIDITY
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    approved_at = NOW - timedelta(hours=1)
    _resign(
        fixture,
        lambda body: body.update(expires_at=(approved_at + validity).isoformat()),
    )
    with pytest.raises(PreflightError, match="receipt_validity_too_long"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize(
    "field_name",
    ["approved_at", "expires_at", "revocation_checked_at"],
)
def test_a_receipt_timestamp_without_a_timezone_offset_is_refused(
    tmp_path, monkeypatch, field_name,
):
    """A naive timestamp is silently reinterpreted as local time, which moves the window.

    ``datetime.astimezone`` on a naive value assumes the host's zone.  On a clinic machine
    in IST that shifts every comparison by five and a half hours, so an expired receipt can
    read as live and a future approval can read as past.  Only an explicit offset is safe.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    naive = fixture.body[field_name].replace("+00:00", "")
    assert "+" not in naive and not naive.endswith("Z")
    _resign(fixture, lambda body: body.__setitem__(field_name, naive))
    with pytest.raises(PreflightError, match="receipt_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_a_naive_consent_timestamp_is_refused(tmp_path, monkeypatch):
    """The nested consent timestamp needs the same offset discipline as the top-level ones."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    naive = "2026-08-31T05:00:00"
    _resign(fixture, lambda body: body["consent"].__setitem__("recorded_at", naive))
    with pytest.raises(PreflightError, match="receipt_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 7. Archive-to-receipt subject binding.
# --------------------------------------------------------------------------------------


def test_an_archive_belonging_to_a_different_patient_than_the_receipt_is_refused(
    tmp_path, monkeypatch,
):
    """Swapping the archive under a valid receipt is the single worst failure available.

    The receipt is authentic and approves training on patient B; the archive on disk holds
    patient A's recordings.  Without this binding the run would fit an adapter to A's voice
    and file it under B's authorisation — a consent breach that no later audit could undo,
    because the manifest would look entirely correct.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(
        tmp_path, patient_id=PATIENT_ID, receipt_patient_id=OTHER_PATIENT_ID
    )
    with pytest.raises(PreflightError, match="receipt_subject_mismatch") as caught:
        preflight_real_training(fixture.config, KEY, now=NOW)
    message = str(caught.value)
    assert str(PATIENT_ID) not in message
    assert str(OTHER_PATIENT_ID) not in message
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 8. The audio contract.
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "audio_kwargs, why",
    [
        pytest.param(
            {"channels": 2},
            "stereo doubles the sample stream the feature extractor expects",
            id="stereo",
        ),
        pytest.param(
            {"width": 1},
            "eight-bit samples decode to garbage under the little-endian int16 reader",
            id="eight_bit",
        ),
        pytest.param(
            {"format_tag": 6, "width": 1},
            "a companded (A-law) payload is not linear PCM",
            id="non_pcm_compression",
        ),
        pytest.param(
            {"frames": MINIMUM_FRAMES - 1},
            "one frame below the minimum duration the capture contract guarantees",
            id="one_frame_below_the_minimum",
        ),
        pytest.param(
            {"declared_data_bytes": MINIMUM_FRAMES * 2 + 2_000},
            "the declared data length exceeds the bytes actually present",
            id="truncated_payload",
        ),
        pytest.param(
            {"rate": 22_050},
            "a sample rate the processor was never configured for",
            id="wrong_sample_rate",
        ),
    ],
)
def test_every_violation_of_the_audio_contract_is_refused(
    tmp_path, monkeypatch, audio_kwargs, why,
):
    """Only the sample rate was pinned; the rest of the WAV geometry was unchecked.

    Each of these parses as a valid RIFF file and passes the archive verifier's hash and
    size checks, so nothing upstream catches them.  Downstream they would either crash
    inside the feature extractor or, worse, train quietly on misinterpreted audio.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs()
    specs[0]["audio"] = _wav(0, **audio_kwargs)
    fixture = _fixture(tmp_path, specs=specs)
    with pytest.raises(PreflightError, match="audio_contract_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_a_wav_whose_declared_duration_contradicts_its_frame_count_is_refused(
    tmp_path, monkeypatch,
):
    """The manifest duration is a receipt about the recording; it must match the bytes.

    Duration feeds the corpus totals reported to governance.  A pair claiming ten seconds
    while holding a quarter of a second would misstate how much of the survivor's speech
    was actually used.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs()
    specs[0]["duration_seconds"] = 10.0
    fixture = _fixture(tmp_path, specs=specs)
    with pytest.raises(PreflightError, match="audio_contract_invalid"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_the_shortest_accepted_wav_sits_exactly_on_the_minimum_frame_count(
    tmp_path, monkeypatch,
):
    """Pin the accepted side of the duration floor so the refusal above stays meaningful."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs()
    specs[0]["audio"] = _wav(0, frames=MINIMUM_FRAMES)
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    assert prepared.pair_count == 50


# --------------------------------------------------------------------------------------
# 9-10. Duplicate audio: conflicting labels and split grouping.
# --------------------------------------------------------------------------------------


def test_identical_audio_carrying_two_different_transcripts_is_refused(
    tmp_path, monkeypatch,
):
    """One recording cannot be two utterances; one of the two labels is simply wrong.

    This happens for real when a caregiver re-labels a capture during review and the export
    keeps both rows.  Training on it teaches the CTC head contradictory targets for the same
    acoustics, and — because the split groups by audio hash — the contradiction would also
    straddle a train/test boundary and inflate any later evaluation.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=12)
    specs[1]["audio"] = specs[0]["audio"]  # identical bytes ...
    assert specs[1]["phrase"] != specs[0]["phrase"]  # ... under a different transcript
    fixture = _fixture(tmp_path, specs=specs)
    with pytest.raises(PreflightError, match="conflicting_audio_labels"):
        preflight_real_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_case_and_whitespace_variants_of_one_transcript_do_not_count_as_a_conflict(
    tmp_path, monkeypatch,
):
    """Labels are compared after NFKC/casefold normalisation, so cosmetic drift is fine."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=12)
    specs[1]["audio"] = specs[0]["audio"]
    specs[1]["phrase"] = f"  {specs[0]['phrase'].upper()}  "
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    assert prepared.pair_count == 50


def test_the_split_groups_recordings_by_audio_content_not_by_capture_identity(
    tmp_path, monkeypatch,
):
    """Duplicate audio must not be able to straddle a train/test boundary.

    The grouping key handed to the splitter has to be the audio SHA-256.  If it were the
    capture id — which is unique per row by construction — two byte-identical recordings
    exported twice would become two independent components, one of which could be held out
    as "unseen" test data that the adapter had already been fitted on.

    The archive-level consequence of that swap is not observable from the outside, because
    ``conflicting_audio_labels`` already guarantees identical audio carries an identical
    normalised transcript, and the phrase key then merges the rows anyway.  So this test
    pins the call site directly: the keys passed to the splitter are the pairs' audio
    hashes, and the split reports itself as grouped by duplicate audio content.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    captured: dict[str, object] = {}
    original = runtime.build_group_phrase_disjoint_split

    def spy(samples, group_keys, **kwargs):
        captured["group_keys"] = list(group_keys)
        captured["kwargs"] = dict(kwargs)
        return original(samples, group_keys, **kwargs)

    monkeypatch.setattr(runtime, "build_group_phrase_disjoint_split", spy)
    specs = _pair_specs(count=50, phrase_groups=12)
    specs[1]["audio"] = specs[0]["audio"]
    specs[1]["phrase"] = specs[0]["phrase"]
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)

    expected_keys = [pair.sha256 for pair in prepared.selected_pairs]
    assert captured["group_keys"] == expected_keys
    assert len(set(expected_keys)) == 49  # the duplicated recording collapses two rows
    assert captured["kwargs"]["group_unit"] == "duplicate_audio_content"
    assert prepared.split.group_unit == "duplicate_audio_content"

    # The two byte-identical recordings must land in one partition, never split apart.
    duplicate_indexes = {
        index
        for index, pair in enumerate(prepared.selected_pairs)
        if pair.sha256 == expected_keys[0]
    }
    assert len(duplicate_indexes) == 2
    partitions = [
        set(getattr(prepared.split, name)) for name in ("train", "validation", "test")
    ]
    assert any(duplicate_indexes <= partition for partition in partitions)


def test_a_shared_group_key_keeps_unrelated_phrases_in_one_partition():
    """Grouping is transitive: a shared key merges phrases that share nothing else.

    Exercised directly on the splitter because the archive path can never present this
    shape (see the test above).  If the union over the group key were dropped, the two rows
    below would become independent components and could be allocated to different splits.
    """
    rows = [
        runtime._SyntheticPair(lang="en", target_text=f"phrase {index}")
        for index in range(8)
    ]
    keys = ["duplicate-audio"] * 2 + [f"unique-{index}" for index in range(2, 8)]
    plan = build_group_phrase_disjoint_split(rows, keys, seed=42)
    partitions = [set(getattr(plan, name)) for name in ("train", "validation", "test")]
    assert any({0, 1} <= partition for partition in partitions)
    # Seven components, not eight: the shared key merged the first two rows.
    assert sum(plan.component_counts.values()) == 7


# --------------------------------------------------------------------------------------
# 11. Artifact privacy.
# --------------------------------------------------------------------------------------


def _training_harness(monkeypatch, prepared, model) -> None:
    """Replace only the heavy stages, leaving staging, sanitisation, and publishing real."""
    monkeypatch.setattr(runtime, "preflight_real_training", lambda *_a, **_k: prepared)
    monkeypatch.setattr(runtime, "_assert_inputs_unchanged", lambda *_a, **_k: None)
    monkeypatch.setattr(
        runtime, "_load_ml_runtime", lambda: (object(), object(), object(), object())
    )
    monkeypatch.setattr(runtime, "_seed_runtime", lambda *_a: None)
    monkeypatch.setattr(runtime, "_resolve_device", lambda *_a: SimpleNamespace(type="cpu"))
    monkeypatch.setattr(
        runtime,
        "_load_local_processor_and_model",
        lambda *_a: (object(), object(), "/private/model/snapshot"),
    )
    monkeypatch.setattr(runtime, "_apply_lora", lambda *_a: (model, 128))
    monkeypatch.setattr(
        runtime,
        "_optimise_lora",
        lambda *_a: {"optimizer_steps": 3, "examples_seen": 30, "epochs_completed": 1},
    )


@pytest.mark.parametrize("leaked", ["patient_id", "audio_sha256", "capture_id"])
def test_an_adapter_that_writes_a_private_identifier_into_its_metadata_is_destroyed(
    tmp_path, monkeypatch, leaked,
):
    """PEFT writes free-text metadata, and free text is where identifiers escape.

    ``adapter_config.json`` routinely records whatever path or run name it was handed.  If
    a patient UUID, a capture id, or an audio hash reaches it, the adapter directory becomes
    a patient identifier that INV-11 forbids anywhere in this repository — and, unlike a log
    line, it is the artifact people copy around.  A leak must abort the whole run rather
    than be scrubbed, because scrubbing a value we did not expect is guesswork.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    secrets = {
        "patient_id": str(prepared.archive.patient_id),
        "audio_sha256": prepared.selected_pairs[0].sha256,
        "capture_id": str(prepared.selected_pairs[0].capture_id),
    }
    secret = secrets[leaked]

    class LeakyModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"weights")
            (destination / "adapter_config.json").write_text(
                json.dumps({"run_name": f"awaaz-{secret}"})
            )

    _training_harness(monkeypatch, prepared, LeakyModel())
    with pytest.raises(TrainingRuntimeError, match="artifact_privacy_violation") as caught:
        run_training(fixture.config, KEY, now=NOW)
    assert secret not in str(caught.value)
    _assert_nothing_was_written(fixture)


def test_a_leak_in_a_plain_text_adapter_readme_is_caught_too(tmp_path, monkeypatch):
    """The scan must cover generated model cards, not only JSON configuration."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, KEY, now=NOW)
    patient = str(prepared.archive.patient_id)

    class ChattyModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"weights")
            (destination / "README.md").write_text(
                f"# Adapter\n\nFitted for subject {patient}.\n"
            )

    _training_harness(monkeypatch, prepared, ChattyModel())
    with pytest.raises(TrainingRuntimeError, match="artifact_privacy_violation"):
        run_training(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 12. Inputs must not change under the run.
# --------------------------------------------------------------------------------------


def test_an_archive_mutated_between_preflight_and_publication_stops_the_run(
    tmp_path, monkeypatch,
):
    """Time-of-check to time-of-use on patient media is a governance failure, not a race.

    Preflight verifies the archive that the receipt approved.  If anything replaces or
    appends to that file afterwards, the bytes that would actually be trained on were never
    approved by anyone.  ``_assert_inputs_unchanged`` is the only thing standing between
    that and a published manifest asserting the archive hash it no longer has.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    real_preflight = runtime.preflight_real_training

    def preflight_then_tamper(*args, **kwargs):
        prepared = real_preflight(*args, **kwargs)
        with fixture.archive.open("ab") as handle:
            handle.write(b"\x00")
        return prepared

    monkeypatch.setattr(runtime, "preflight_real_training", preflight_then_tamper)
    with pytest.raises(PreflightError, match="input_changed"):
        run_preflight(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize("target", ["receipt", "base_model"])
def test_a_receipt_or_checkpoint_mutated_after_preflight_stops_the_run(
    tmp_path, monkeypatch, target,
):
    """The same rule covers the authorisation itself and the approved weights."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    real_preflight = runtime.preflight_real_training

    def preflight_then_tamper(*args, **kwargs):
        prepared = real_preflight(*args, **kwargs)
        if target == "receipt":
            with fixture.receipt_path.open("a") as handle:
                handle.write("\n")
        else:
            (fixture.base / "model.safetensors").write_bytes(b"substituted-weights")
        return prepared

    monkeypatch.setattr(runtime, "preflight_real_training", preflight_then_tamper)
    with pytest.raises(PreflightError, match="input_changed"):
        run_preflight(fixture.config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 13. The pinned governance trust root.
# --------------------------------------------------------------------------------------


def test_a_receipt_signed_under_an_unpinned_key_identifier_is_refused(
    tmp_path, monkeypatch,
):
    """A valid HMAC proves possession of *a* key, not of *the* pinned governance key.

    The existing suite only corrupts the key fingerprint, which fails before the receipt is
    ever parsed.  This case is the dangerous one: the signature verifies perfectly, and only
    the ``key_id`` comparison distinguishes the approved trust root from a second key that
    someone in the organisation also holds.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    config = replace(fixture.config, governance_key_id="awaaz-governance-some-other-key")
    with pytest.raises(PreflightError, match="governance_trust_root_mismatch") as caught:
        preflight_real_training(config, KEY, now=NOW)
    assert KEY_ID not in str(caught.value)
    _assert_nothing_was_written(fixture)


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({}, id="both_defaults_empty"),
        pytest.param({"governance_key_id": KEY_ID}, id="fingerprint_missing"),
        pytest.param({"governance_key_sha256": KEY_SHA256}, id="identifier_missing"),
        pytest.param({"governance_key_id": "   "}, id="identifier_only_whitespace"),
        pytest.param(
            {"governance_key_id": KEY_ID, "governance_key_sha256": "not-a-digest"},
            id="fingerprint_malformed",
        ),
    ],
)
def test_a_config_without_a_pinned_trust_root_never_reaches_the_receipt(
    tmp_path, monkeypatch, overrides,
):
    """``RuntimeConfig`` defaults to no trust root, so forgetting to set one must fail loudly.

    The CLI reads both values from the environment; an unset variable yields the empty
    default.  Without this gate a misconfigured operator would get a run that trusts any
    receipt whose signature it can reproduce.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    defaults = {"governance_key_id": "", "governance_key_sha256": ""}
    config = replace(fixture.config, **{**defaults, **overrides})
    with pytest.raises(PreflightError, match="governance_trust_root_missing"):
        preflight_real_training(config, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 14. The two corpus floors, pinned separately.
# --------------------------------------------------------------------------------------


def test_the_minimum_pair_floor_alone_cannot_be_lowered(tmp_path, monkeypatch):
    """Pinned on its own: the existing test weakens both floors in a single call.

    Because that call passes ``minimum_pairs=1, minimum_components=1``, deleting either
    half of the ``or`` in the readiness check leaves it green.  Splitting the assertion is
    the only way the two floors are independently defended.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    weakened = replace(fixture.config, minimum_pairs=runtime.HARD_MINIMUM_PAIRS - 1)
    assert weakened.minimum_components == runtime.HARD_MINIMUM_COMPONENTS
    with pytest.raises(PreflightError, match="config_invalid"):
        preflight_real_training(weakened, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_the_minimum_component_floor_alone_cannot_be_lowered(tmp_path, monkeypatch):
    """The variety floor is the one that stops phrase memorisation; pin it by itself."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    weakened = replace(
        fixture.config, minimum_components=runtime.HARD_MINIMUM_COMPONENTS - 1
    )
    assert weakened.minimum_pairs == runtime.HARD_MINIMUM_PAIRS
    with pytest.raises(PreflightError, match="config_invalid"):
        preflight_real_training(weakened, KEY, now=NOW)
    _assert_nothing_was_written(fixture)


def test_both_corpus_floors_may_be_made_stricter(tmp_path, monkeypatch):
    """Stricter is always allowed; only weakening is refused, so pin that direction too."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    stricter = replace(
        fixture.config,
        minimum_pairs=runtime.HARD_MINIMUM_PAIRS,
        minimum_components=runtime.HARD_MINIMUM_COMPONENTS + 1,
    )
    with pytest.raises(PreflightError, match="corpus_not_varied_enough"):
        preflight_real_training(stricter, KEY, now=NOW)


# --------------------------------------------------------------------------------------
# 15. The governance verification key file, and the CLI's blocked path.
# --------------------------------------------------------------------------------------


def test_a_missing_governance_key_file_is_reported_without_a_path(tmp_path):
    """The key path is operational secret; its absence must not leak where it was sought."""
    with pytest.raises(PreflightError, match="receipt_key_missing") as caught:
        runtime._read_verification_key(tmp_path / "absent-governance.key")
    assert str(tmp_path) not in str(caught.value)


@pytest.mark.parametrize("mode", [0o644, 0o640, 0o604, 0o666, 0o700 | 0o004])
def test_a_governance_key_readable_by_group_or_others_is_refused(tmp_path, mode):
    """Any bit outside the owner triplet means another local account can forge receipts.

    Possession of this key is the entire trust root: with it, an attacker writes their own
    approval for any patient's archive.  A key file that the ``staff`` group can read is
    therefore not a key at all.
    """
    key_path = tmp_path / "governance.key"
    key_path.write_bytes(KEY)
    os.chmod(key_path, mode)
    with pytest.raises(PreflightError, match="receipt_key_permissions"):
        runtime._read_verification_key(key_path)


@pytest.mark.parametrize("size", [0, 1, 31])
def test_a_governance_key_shorter_than_the_minimum_is_refused(tmp_path, size):
    """A short HMAC key is brute-forceable, and thirty-two bytes is the declared floor."""
    key_path = tmp_path / "governance.key"
    key_path.write_bytes(b"k" * size)
    os.chmod(key_path, 0o600)
    with pytest.raises(PreflightError, match="receipt_key_invalid"):
        runtime._read_verification_key(key_path)


def test_a_symlinked_governance_key_is_refused(tmp_path):
    """A symlink means the bytes actually read are decided somewhere else.

    The permission and size checks apply to the link's own metadata, not the target's, so
    following one would let a mode-0600 link point at a world-readable file.
    """
    real_key = tmp_path / "real-governance.key"
    real_key.write_bytes(KEY)
    os.chmod(real_key, 0o600)
    link = tmp_path / "governance.key"
    link.symlink_to(real_key)
    with pytest.raises(PreflightError, match="receipt_key_invalid"):
        runtime._read_verification_key(link)


def test_a_directory_supplied_as_the_governance_key_is_refused(tmp_path):
    """Only a regular file can be a key; a directory would raise deep inside the reader."""
    directory = tmp_path / "governance.key"
    directory.mkdir(mode=0o700)
    with pytest.raises(PreflightError, match="receipt_key_invalid"):
        runtime._read_verification_key(directory)


def test_a_well_formed_governance_key_is_read_verbatim(tmp_path):
    """Pin the accepted case so the refusals above cannot be satisfied by refusing all keys."""
    key_path = tmp_path / "governance.key"
    key_path.write_bytes(KEY)
    os.chmod(key_path, 0o600)
    assert runtime._read_verification_key(key_path) == KEY


def test_the_cli_exit_for_a_blocked_run_carries_only_an_error_code(tmp_path, capsys):
    """Operators see stderr; stderr must not become the leak channel the manifest is not.

    The CLI is invoked with real, private paths on the command line.  Its refusal message
    must name the machine-readable code and nothing else — no archive path, no receipt
    path, no output path, and certainly no key material.
    """
    key_path = tmp_path / "governance.key"
    key_path.write_bytes(KEY)
    os.chmod(key_path, 0o644)  # deliberately unsafe, so the run is blocked at the key
    fixture = _fixture(tmp_path)
    argv = [
        "preflight",
        "--archive",
        str(fixture.archive),
        "--receipt",
        str(fixture.receipt_path),
        "--receipt-key-file",
        str(key_path),
        "--base-model",
        str(fixture.base),
        "--output-dir",
        str(fixture.output),
    ]
    with pytest.raises(SystemExit) as exited:
        runtime.main(argv)
    assert exited.value.code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == "asr-runtime blocked [receipt_key_permissions]"
    for secret in (
        str(fixture.archive),
        str(fixture.receipt_path),
        str(fixture.base),
        str(fixture.output),
        str(key_path),
        str(tmp_path),
        str(PATIENT_ID),
        KEY.hex(),
        KEY_SHA256,
    ):
        assert secret not in captured.err
    _assert_nothing_was_written(fixture)


def test_the_cli_blocked_path_reports_a_governance_refusal_without_private_values(
    tmp_path, capsys, monkeypatch,
):
    """The same discipline applies once the run gets far enough to read patient media."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    monkeypatch.setenv("AWAAZ_GOVERNANCE_KEY_ID", KEY_ID)
    monkeypatch.setenv("AWAAZ_GOVERNANCE_KEY_SHA256", KEY_SHA256)
    key_path = tmp_path / "governance.key"
    key_path.write_bytes(KEY)
    os.chmod(key_path, 0o600)
    # The CLI has no injectable clock, so this receipt is anchored to the real wall clock.
    fixture = _fixture(
        tmp_path,
        specs=_pair_specs(count=50, phrase_groups=4),
        reference_time=datetime.now(timezone.utc),
    )
    argv = [
        "preflight",
        "--archive",
        str(fixture.archive),
        "--receipt",
        str(fixture.receipt_path),
        "--receipt-key-file",
        str(key_path),
        "--base-model",
        str(fixture.base),
        "--output-dir",
        str(fixture.output),
    ]
    with pytest.raises(SystemExit) as exited:
        runtime.main(argv)
    assert exited.value.code == 2
    captured = capsys.readouterr()
    assert captured.err.strip() == "asr-runtime blocked [corpus_not_varied_enough]"
    assert "Private phrase" not in captured.err
    assert all(digest not in captured.err for digest in fixture.audio_hashes)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# The synthetic smoke really produces no model, and importing the module is cheap.
# --------------------------------------------------------------------------------------


def test_the_synthetic_smoke_leaves_exactly_one_manifest_and_no_weights_on_disk(tmp_path):
    """"No model was produced" has to be checked against the filesystem, not the manifest.

    The existing test asserts ``payload["artifacts"] == []`` — a claim the manifest makes
    about itself — and never lists the directory.  A smoke run that silently wrote weights
    or a metrics file would satisfy that assertion while contradicting the one thing this
    command exists to guarantee: it instantiates nothing and measures nothing.
    """
    output = tmp_path / "smoke"
    manifest_path = run_synthetic_smoke(output)

    entries = sorted(item.relative_to(output).as_posix() for item in output.rglob("*"))
    assert entries == ["manifest.json"]
    assert manifest_path == output / "manifest.json"
    assert not any(output.rglob("*.metrics.json"))
    for suffix in ("*.safetensors", "*.bin", "*.pt", "*.pth", "*.ckpt", "*.onnx"):
        assert not list(output.rglob(suffix))

    payload = json.loads(manifest_path.read_text())
    assert payload["artifacts"] == []
    assert not any(payload["claims"].values())
    assert payload["privacy"]["contains_patient_derived_weights"] is False


def test_the_synthetic_smoke_cli_announces_that_nothing_was_trained(tmp_path, capsys):
    """Replaces a vacuous assertion: the disclaimer belongs on stdout and must be present.

    The original test asserted the disclaimer was *absent from stderr*, which is trivially
    true because the CLI prints it to stdout.  What matters is that a successful smoke run
    tells the operator, in the same breath, that no model and no metric came out of it.
    """
    assert runtime.main(["synthetic-smoke", "--output-dir", str(tmp_path / "smoke")]) == 0
    captured = capsys.readouterr()
    assert captured.err == ""
    assert "model_trained=false" in captured.out
    assert "evaluation_run=false" in captured.out
    assert "metrics_reported=false" in captured.out


def test_importing_the_runtime_pulls_in_no_machine_learning_stack(tmp_path):
    """Checked in a subprocess, because in-process the module is already imported.

    The API process imports nothing from this package, but a stray module-level ``import
    torch`` would still cost every developer and every CI job hundreds of megabytes and
    seconds of start-up — and, more importantly, would mean the heavy stack is present
    before a single governance gate has run.  An in-process test cannot detect this: by the
    time it executes, ``runtime`` sits in ``sys.modules`` with its imports already resolved.
    """
    probe = tmp_path / "probe.py"
    probe.write_text(
        "import json, sys\n"
        "import app.ml.train.asr_runtime.runtime as runtime\n"
        "heavy = ('torch', 'transformers', 'peft', 'safetensors', 'accelerate')\n"
        "assert runtime.SCHEMA_VERSION == 1\n"
        "print(json.dumps(sorted(name for name in heavy if name in sys.modules)))\n"
    )
    completed = subprocess.run(
        [sys.executable, str(probe)],
        capture_output=True,
        text=True,
        cwd=str(Path(runtime.__file__).resolve().parents[5]),
        env={
            **os.environ,
            "PYTHONPATH": os.pathsep.join(path for path in sys.path if path),
        },
        timeout=120,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == []


def test_the_runtime_module_declares_no_module_level_machine_learning_import():
    """A static backstop for the subprocess probe above.

    The optional stack is not installed in CI, so the probe would also pass if the module
    imported it lazily *and* incorrectly.  Reading the source proves the intent: every heavy
    name may only appear behind ``importlib.import_module`` inside ``_load_ml_runtime``.
    """
    source = Path(runtime.__file__).read_text()
    module_level_imports = re.findall(
        r"^(?:from|import)\s+([A-Za-z_][A-Za-z0-9_]*)", source, flags=re.MULTILINE
    )
    assert not {"torch", "transformers", "peft", "safetensors", "accelerate"} & set(
        module_level_imports
    )
