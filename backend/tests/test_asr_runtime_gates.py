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

import ast
import copy
import functools
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
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
KEY_ID = "awaaz-governance-test"

# Governance receipts are Ed25519-signed by a key whose public half is pinned in a tracked
# file inside the package.  Producing one therefore needs a real asymmetric implementation,
# so the tests below that require an authentic receipt cannot run where `cryptography` is
# absent.  The refusal paths that matter most -- no key pinned, unknown key, wrong
# algorithm, no verification library at all -- are written so that they do run there.
# Captured at import time: the autouse fixture below repoints the module constant, and the
# two tests that judge the *shipped* trust root must still see the file the package ships.
SHIPPED_TRUST_ROOT = runtime.GOVERNANCE_PUBLIC_KEYS_PATH

CRYPTOGRAPHY_INSTALLED = importlib.util.find_spec("cryptography") is not None
requires_cryptography = pytest.mark.skipif(
    not CRYPTOGRAPHY_INSTALLED,
    reason="cryptography is not installed here; Ed25519 receipts cannot be signed or checked",
)
# A syntactically valid public key that no private key corresponds to.  It exists so key
# *resolution* stays testable without an Ed25519 implementation; nothing verifies under it.
UNVERIFIABLE_PUBLIC_KEY = "11" * 32


@functools.lru_cache(maxsize=1)
def _test_signing_key():
    """TEST-ONLY governance signing key, generated in memory for this process alone.

    Nothing under ``app/`` can do this.  The HMAC scheme this replaced exported a signing
    helper from the shipped package, so the training operator who held the verification key
    could also mint their own approval.  The private half of the real key now belongs to the
    clinical approver, is generated offline, and never reaches a training host.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ed25519

    private_key = ed25519.Ed25519PrivateKey.generate()
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return private_key, public_bytes.hex()


def _pinned_key_entry(**overrides) -> dict:
    """The shape the tracked trust-root file declares; any field may be overridden."""
    entry = {
        "key_id": KEY_ID,
        "algorithm": "Ed25519",
        "public_key": _test_public_key(),
        "not_before": "2020-01-01T00:00:00+00:00",
        "not_after": "2099-01-01T00:00:00+00:00",
        "holder": "Test clinical approver",
    }
    entry.update(overrides)
    return entry


def _write_pinned_keys(path: Path, entries, *, schema_version: int = 1, mode: int = 0o644):
    path.write_text(
        json.dumps({"schema_version": schema_version, "keys": entries}, indent=2) + "\n"
    )
    os.chmod(path, mode)
    return path


def _test_public_key() -> str:
    return _test_signing_key()[1] if CRYPTOGRAPHY_INSTALLED else UNVERIFIABLE_PUBLIC_KEY


@pytest.fixture(autouse=True)
def pinned_governance_trust_root(tmp_path_factory, monkeypatch) -> Path:
    """Redirect the module-constant trust root at a temporary file holding the test key.

    ``GOVERNANCE_PUBLIC_KEYS_PATH`` is a module constant precisely so that no operator input
    can reach it; a test may only move it by patching the module, which is a code change by
    construction.  The file the package actually ships is empty, so without this fixture
    every run would stop at ``governance_trust_root_missing``.  Tests that want that refusal
    rewrite this file themselves.
    """
    path = tmp_path_factory.mktemp("trust-root") / "governance_public_keys.json"
    _write_pinned_keys(path, [_pinned_key_entry()])
    monkeypatch.setattr(runtime, "GOVERNANCE_PUBLIC_KEYS_PATH", path)
    return path

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


def _sign_receipt(body: dict, path: Path, *, key_id: str = KEY_ID, private_key=None) -> dict:
    """TEST-ONLY receipt minting; see `_test_signing_key` for why it lives here."""
    signer = private_key if private_key is not None else _test_signing_key()[0]
    receipt = copy.deepcopy(body)
    receipt.pop("signature", None)
    receipt["signature"] = {"algorithm": "Ed25519", "key_id": key_id}
    receipt["signature"]["signature"] = signer.sign(
        runtime._canonical_receipt_bytes(receipt)
    ).hex()
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

    Mutating a signed receipt without re-signing would only prove the signature works.
    Every semantic gate below must refuse a receipt that is perfectly authentic.
    """
    body = copy.deepcopy(fixture.body)
    mutate(body)
    fixture.receipt = _sign_receipt(body, fixture.receipt_path)


# --------------------------------------------------------------------------------------
# 1. Corpus variety floor.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    assert imported is False
    _assert_nothing_was_written(fixture)


@requires_cryptography
@pytest.mark.parametrize("phrase_groups", [3, 6, 9])
def test_every_phrase_count_below_the_variety_floor_is_refused(
    tmp_path, monkeypatch, phrase_groups,
):
    """Nine components is the last refused value; the floor is a cliff, not a suggestion."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path, specs=_pair_specs(count=50, phrase_groups=phrase_groups))
    with pytest.raises(PreflightError, match="corpus_not_varied_enough"):
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_ten_independent_components_is_the_first_accepted_corpus_variety(
    tmp_path, monkeypatch,
):
    """Pin the accepted side of the boundary so the floor cannot drift downward unnoticed."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path, specs=_pair_specs(count=50, phrase_groups=10))
    prepared = preflight_real_training(fixture.config, now=NOW)
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


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 5. Receipt-to-config language binding.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 6. Receipt time-window integrity.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_a_naive_consent_timestamp_is_refused(tmp_path, monkeypatch):
    """The nested consent timestamp needs the same offset discipline as the top-level ones."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    naive = "2026-08-31T05:00:00"
    _resign(fixture, lambda body: body["consent"].__setitem__("recorded_at", naive))
    with pytest.raises(PreflightError, match="receipt_invalid"):
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 7. Archive-to-receipt subject binding.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    message = str(caught.value)
    assert str(PATIENT_ID) not in message
    assert str(OTHER_PATIENT_ID) not in message
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 8. The audio contract.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_the_shortest_accepted_wav_sits_exactly_on_the_minimum_frame_count(
    tmp_path, monkeypatch,
):
    """Pin the accepted side of the duration floor so the refusal above stays meaningful."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs()
    specs[0]["audio"] = _wav(0, frames=MINIMUM_FRAMES)
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, now=NOW)
    assert prepared.pair_count == 50


# --------------------------------------------------------------------------------------
# 9-10. Duplicate audio: conflicting labels and split grouping.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_case_and_whitespace_variants_of_one_transcript_do_not_count_as_a_conflict(
    tmp_path, monkeypatch,
):
    """Labels are compared after NFKC/casefold normalisation, so cosmetic drift is fine."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=12)
    specs[1]["audio"] = specs[0]["audio"]
    specs[1]["phrase"] = f"  {specs[0]['phrase'].upper()}  "
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, now=NOW)
    assert prepared.pair_count == 50


@requires_cryptography
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
    prepared = preflight_real_training(fixture.config, now=NOW)

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


@requires_cryptography
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
    prepared = preflight_real_training(fixture.config, now=NOW)
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
        run_training(fixture.config, now=NOW)
    assert secret not in str(caught.value)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_a_leak_in_a_plain_text_adapter_readme_is_caught_too(tmp_path, monkeypatch):
    """The scan must cover generated model cards, not only JSON configuration."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, now=NOW)
    patient = str(prepared.archive.patient_id)

    class ChattyModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"weights")
            (destination / "README.md").write_text(
                f"# Adapter\n\nFitted for subject {patient}.\n"
            )

    _training_harness(monkeypatch, prepared, ChattyModel())
    with pytest.raises(TrainingRuntimeError, match="artifact_privacy_violation"):
        run_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 12. Inputs must not change under the run.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        run_preflight(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        run_preflight(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


# --------------------------------------------------------------------------------------
# 13. The pinned governance trust root.
# --------------------------------------------------------------------------------------


def _verify(path, *, now=NOW, language="en"):
    """Call the verifier with every input binding disabled, isolating authenticity."""
    return verify_governance_receipt(
        path,
        expected_archive_sha256=None,
        expected_base_model_sha256=None,
        expected_patient_id=None,
        expected_language=language,
        now=now,
    )


def _receipt_with_signature_block(
    path: Path, *, algorithm: str = "Ed25519", key_id: str = KEY_ID, value: str = "0" * 128,
) -> Path:
    """Write a receipt whose signature block is controllable and whose body is irrelevant.

    Authenticity is decided before any semantic field is read, so these cases need no
    archive, no base model, and -- crucially -- no ability to sign.
    """
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "signature": {"algorithm": algorithm, "key_id": key_id, "signature": value},
            }
        )
    )
    os.chmod(path, 0o600)
    return path


def test_the_shipped_trust_root_pins_no_key_and_holds_no_private_material():
    """The file committed to this repository must be empty and must stay public-only.

    A pinned key is a governance act performed by a clinical owner who does not run
    training.  Shipping a placeholder key -- or, far worse, a private key -- would hand the
    approval boundary to whoever cloned the repository.
    """
    raw = SHIPPED_TRUST_ROOT.read_text(encoding="utf-8")
    shipped = json.loads(raw)
    assert shipped["schema_version"] == 1
    assert shipped["keys"] == []
    assert "PRIVATE KEY" not in raw
    assert "private_key" not in raw


def test_the_trust_root_path_is_a_module_constant_with_no_operator_supplied_channel():
    """The finding was not "HMAC"; it was that the operator declared their own trust root.

    Ed25519 alone fixes nothing if the public key still arrives by environment variable or
    ``--key-file``: the operator generates a keypair, points the runtime at their own public
    half, and mints approvals exactly as before.  The constant must resolve inside the
    package, and neither channel may reappear anywhere in the module.
    """
    module = ast.parse(Path(runtime.__file__).read_text(encoding="utf-8"))
    # Unparsing drops comments, so the prose explaining what was removed does not count as
    # the thing still being there. Executable references are what this test forbids.
    executable = ast.unparse(module)
    assert "AWAAZ_GOVERNANCE_KEY" not in executable
    assert "receipt-key-file" not in executable
    assert "receipt_key_file" not in executable
    assert not hasattr(runtime, "_read_verification_key")
    # No command-line option may name key material, and the config builder may not read the
    # environment: those were the two channels that made the trust root operator-supplied.
    for node in ast.walk(module):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_argument":
            for argument in node.args:
                assert "key" not in str(getattr(argument, "value", "")).lower()
    builder = next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "_config_from_args"
    )
    assert "environ" not in ast.unparse(builder)
    package_directory = Path(runtime.__file__).resolve().parent
    assert SHIPPED_TRUST_ROOT.parent == package_directory
    assert SHIPPED_TRUST_ROOT.name == "governance_public_keys.json"
    # No field of the operator-supplied configuration can name or fingerprint a key.
    assert not [
        name for name in RuntimeConfig.__dataclass_fields__ if "governance" in name or "key" in name
    ]


def test_the_shipped_package_offers_no_way_to_mint_a_governance_receipt():
    """The thing that verifies must not also ship the thing that signs.

    While one HMAC key did both jobs, "the verifier cannot forge" was unachievable in
    principle.  The signing helper is gone from the package surface and from the module.
    """
    import app.ml.train.asr_runtime as package

    assert "governance_receipt_signature" not in package.__all__
    assert not hasattr(package, "governance_receipt_signature")
    assert not hasattr(runtime, "governance_receipt_signature")
    source = Path(runtime.__file__).read_text(encoding="utf-8")
    assert "Ed25519PrivateKey" not in source
    assert "def sign" not in source


def test_a_build_with_no_pinned_key_refuses_before_the_receipt_is_opened(tmp_path):
    """The shipped fail-closed state, reached through the public preflight entry point.

    The receipt path here does not exist, so a run that reached the receipt at all would
    refuse with ``receipt_invalid``.  Getting ``governance_trust_root_missing`` instead is
    the evidence that the trust root is consulted first.
    """
    _write_pinned_keys(runtime.GOVERNANCE_PUBLIC_KEYS_PATH, [])
    config = RuntimeConfig(
        archive_path=tmp_path / "absent-archive.tar",
        receipt_path=tmp_path / "absent-receipt.json",
        base_model_path=tmp_path / "absent-base-model",
        output_dir=tmp_path / "private-output",
    )
    with pytest.raises(PreflightError, match="governance_trust_root_missing"):
        preflight_real_training(config, now=NOW)
    assert not (tmp_path / "private-output").exists()


def test_a_missing_trust_root_file_is_a_refusal_not_an_empty_allow_list(tmp_path):
    """Deleting the pinned file must not read as "no restrictions"."""
    runtime.GOVERNANCE_PUBLIC_KEYS_PATH.unlink()
    with pytest.raises(PreflightError, match="governance_trust_root_missing") as caught:
        runtime._load_pinned_governance_keys()
    assert str(runtime.GOVERNANCE_PUBLIC_KEYS_PATH) not in str(caught.value)


def test_a_receipt_naming_a_key_the_build_does_not_pin_is_refused(tmp_path):
    """Whoever holds *a* private key must not be able to authorise this training host.

    This is the case the old design could never refuse: the operator's own key was the
    pinned key by definition.  Resolution against the tracked file is now the only route in.
    """
    path = _receipt_with_signature_block(
        tmp_path / "governance.json", key_id="awaaz-governance-some-other-key"
    )
    with pytest.raises(PreflightError, match="governance_key_not_pinned") as caught:
        _verify(path)
    assert "awaaz-governance-some-other-key" not in str(caught.value)
    assert KEY_ID not in str(caught.value)


@pytest.mark.parametrize(
    "algorithm",
    ["HMAC-SHA256", "Ed448", "none", "RS256", "ed25519", ""],
)
def test_a_receipt_that_does_not_declare_ed25519_is_refused(tmp_path, algorithm):
    """A downgrade to the symmetric scheme, or to no scheme, must not be negotiable.

    ``HMAC-SHA256`` is listed first deliberately: an attacker with an old receipt, or with
    the retired shared key, must not be able to have it honoured.  The lowercase spelling
    guards against a case-insensitive comparison creeping in.
    """
    path = _receipt_with_signature_block(tmp_path / "governance.json", algorithm=algorithm)
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        _verify(path)


@pytest.mark.parametrize(
    "value",
    ["", "0" * 127, "0" * 129, "0" * 64, "z" * 128, "0" * 128 + " ", "0X" * 64],
)
def test_a_signature_that_is_not_a_64_byte_hex_value_is_refused(tmp_path, value):
    """``0`` * 64 is the retired HMAC digest length; it must not be mistaken for a signature."""
    path = _receipt_with_signature_block(tmp_path / "governance.json", value=value)
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        _verify(path)


def test_verification_refuses_cleanly_when_the_ed25519_library_is_unavailable(
    tmp_path, monkeypatch,
):
    """An absent optional dependency must be a refusal code, never a traceback.

    Forced here rather than inferred from the environment, so the behaviour is pinned on a
    host that *does* have ``cryptography`` installed as well as on one that does not.
    """
    def blocked_import(name, *args, **kwargs):
        raise ImportError(name)

    monkeypatch.setattr(runtime.importlib, "import_module", blocked_import)
    path = _receipt_with_signature_block(tmp_path / "governance.json")
    with pytest.raises(PreflightError, match="signature_runtime_missing") as caught:
        _verify(path)
    assert str(tmp_path) not in str(caught.value)


def test_the_signed_bytes_cover_the_algorithm_and_the_key_identifier(tmp_path):
    """Canonicalisation must strip the signature value and nothing else.

    If ``algorithm`` or ``key_id`` fell outside the signed bytes, a captured receipt could
    be re-pointed at another pinned key, or downgraded, without breaking its signature.
    """
    receipt = {
        "schema_version": 1,
        "purpose": APPROVED_PURPOSE,
        "signature": {"algorithm": "Ed25519", "key_id": KEY_ID, "signature": "ab" * 64},
    }
    signed = runtime._canonical_receipt_bytes(receipt)
    assert b'"algorithm":"Ed25519"' in signed
    assert f'"key_id":"{KEY_ID}"'.encode() in signed
    assert b"ab" * 64 not in signed
    # Only the signature value is excluded: every other change moves the signed bytes.
    for mutate in (
        lambda body: body["signature"].__setitem__("algorithm", "HMAC-SHA256"),
        lambda body: body["signature"].__setitem__("key_id", "another-key"),
        lambda body: body.__setitem__("purpose", "something_else"),
    ):
        mutated = copy.deepcopy(receipt)
        mutate(mutated)
        assert runtime._canonical_receipt_bytes(mutated) != signed
    resigned = copy.deepcopy(receipt)
    resigned["signature"]["signature"] = "cd" * 64
    assert runtime._canonical_receipt_bytes(resigned) == signed


@requires_cryptography
def test_an_authentic_ed25519_receipt_verifies_under_the_pinned_public_key(tmp_path):
    """The refusals above must not be satisfiable by refusing everything."""
    fixture = _fixture(tmp_path)
    verified = _verify(fixture.receipt_path)
    assert verified.key_id == KEY_ID
    assert verified.archive_sha256 == sha256_file(fixture.archive)


@requires_cryptography
def test_a_receipt_signed_by_a_different_private_key_is_refused(tmp_path, monkeypatch):
    """The central property: holding *a* private key does not authorise this build.

    The forged receipt is perfectly formed and correctly signed; it names the pinned
    ``key_id`` and every semantic field is authentic.  Only the private key differs, which
    is exactly the position a training operator who generates their own keypair is in.
    """
    from cryptography.hazmat.primitives.asymmetric import ed25519

    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    _sign_receipt(fixture.body, fixture.receipt_path, private_key=ed25519.Ed25519PrivateKey.generate())
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        preflight_real_training(fixture.config, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_an_authentic_receipt_mutated_after_signing_no_longer_verifies(tmp_path):
    """The signature must cover the body, not merely accompany it."""
    fixture = _fixture(tmp_path)
    tampered = copy.deepcopy(fixture.receipt)
    tampered["data_subject_id"] = str(OTHER_PATIENT_ID)
    fixture.receipt_path.write_text(json.dumps(tampered))
    with pytest.raises(PreflightError, match="receipt_signature_invalid"):
        _verify(fixture.receipt_path)


@requires_cryptography
@pytest.mark.parametrize(
    "window",
    [
        pytest.param(
            {"not_before": "2020-01-01T00:00:00+00:00", "not_after": "2020-02-01T00:00:00+00:00"},
            id="key_retired",
        ),
        pytest.param(
            {"not_before": "2098-01-01T00:00:00+00:00", "not_after": "2099-01-01T00:00:00+00:00"},
            id="key_not_yet_live",
        ),
    ],
)
def test_a_pinned_key_outside_its_declared_validity_window_cannot_approve(
    tmp_path, pinned_governance_trust_root, window,
):
    """Key rotation has to actually retire the old key, not merely add a new one."""
    fixture = _fixture(tmp_path)
    _write_pinned_keys(
        pinned_governance_trust_root,
        [_pinned_key_entry(**window)],
    )
    with pytest.raises(PreflightError, match="governance_key_not_valid_now"):
        _verify(fixture.receipt_path)


# --------------------------------------------------------------------------------------
# 14. The two corpus floors, pinned separately.
# --------------------------------------------------------------------------------------


@requires_cryptography
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
        preflight_real_training(weakened, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_the_minimum_component_floor_alone_cannot_be_lowered(tmp_path, monkeypatch):
    """The variety floor is the one that stops phrase memorisation; pin it by itself."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    weakened = replace(
        fixture.config, minimum_components=runtime.HARD_MINIMUM_COMPONENTS - 1
    )
    assert weakened.minimum_pairs == runtime.HARD_MINIMUM_PAIRS
    with pytest.raises(PreflightError, match="config_invalid"):
        preflight_real_training(weakened, now=NOW)
    _assert_nothing_was_written(fixture)


@requires_cryptography
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
        preflight_real_training(stricter, now=NOW)


# --------------------------------------------------------------------------------------
# 15. The tracked trust-root file itself, and the CLI's blocked path.
#
# This section used to defend a `--receipt-key-file` on disk: its mode, its size, whether it
# was a symlink.  All of that protected a key the operator supplied, which was the defect.
# What has to be defended now is the integrity of the tracked file the runtime reads instead.
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "entry, note",
    [
        pytest.param({"algorithm": "HMAC-SHA256"}, "downgraded algorithm", id="algorithm"),
        pytest.param({"algorithm": "Ed448"}, "unsupported algorithm", id="other_algorithm"),
        pytest.param({"public_key": "11" * 31}, "short key", id="public_key_short"),
        pytest.param({"public_key": "zz" * 32}, "non-hex key", id="public_key_not_hex"),
        pytest.param({"public_key": "11" * 33}, "long key", id="public_key_long"),
        pytest.param({"key_id": ""}, "empty identifier", id="key_id_empty"),
        pytest.param({"key_id": "has spaces"}, "malformed identifier", id="key_id_spaces"),
        pytest.param({"key_id": "../escape"}, "path-like identifier", id="key_id_pathlike"),
        pytest.param({"not_before": "2026-01-01T00:00:00"}, "naive timestamp", id="naive_time"),
        pytest.param({"not_before": "not-a-time"}, "unparseable timestamp", id="bad_time"),
        pytest.param(
            {"not_before": "2030-01-01T00:00:00+00:00", "not_after": "2029-01-01T00:00:00+00:00"},
            "inverted window",
            id="inverted_window",
        ),
        pytest.param({"holder": "   "}, "unnamed holder", id="holder_blank"),
    ],
)
def test_a_malformed_pinned_key_entry_fails_the_whole_file_closed(
    tmp_path, pinned_governance_trust_root, entry, note,
):
    """A key entry nobody can parse must stop the run, not be quietly skipped.

    Skipping a bad row is the dangerous behaviour: an approver who believes their key is
    pinned, but typed it wrong, gets a build that trusts whatever else is in the file --
    including, after a rotation, only the key that was supposed to have been retired.
    """
    _write_pinned_keys(
        pinned_governance_trust_root,
        [_pinned_key_entry(**entry)],
    )
    with pytest.raises(PreflightError, match="governance_trust_root_invalid") as caught:
        runtime._load_pinned_governance_keys()
    assert str(pinned_governance_trust_root) not in str(caught.value)


def test_a_duplicated_pinned_key_identifier_is_refused(
    tmp_path, pinned_governance_trust_root,
):
    """Two entries under one identifier make "which key approved this" unanswerable."""
    entry = _pinned_key_entry()
    _write_pinned_keys(pinned_governance_trust_root, [entry, dict(entry)])
    with pytest.raises(PreflightError, match="governance_trust_root_invalid"):
        runtime._load_pinned_governance_keys()


@pytest.mark.parametrize("mode", [0o666, 0o664, 0o622, 0o646])
def test_a_trust_root_writable_outside_its_owner_is_refused(
    pinned_governance_trust_root, mode,
):
    """Public keys are not secret, but they are the integrity root of the whole gate.

    Any local account that can rewrite this file can pin its own approver, which is the
    same authority as holding the private key.
    """
    os.chmod(pinned_governance_trust_root, mode)
    with pytest.raises(PreflightError, match="governance_trust_root_invalid"):
        runtime._load_pinned_governance_keys()


def test_a_symlinked_trust_root_is_refused(tmp_path, pinned_governance_trust_root, monkeypatch):
    """A symlink moves the decision about which bytes are read somewhere else entirely."""
    link = tmp_path / "governance_public_keys.json"
    link.symlink_to(pinned_governance_trust_root)
    monkeypatch.setattr(runtime, "GOVERNANCE_PUBLIC_KEYS_PATH", link)
    with pytest.raises(PreflightError, match="governance_trust_root_invalid"):
        runtime._load_pinned_governance_keys()


@pytest.mark.parametrize(
    "document",
    [
        pytest.param({"schema_version": 2, "keys": []}, id="unsupported_schema"),
        pytest.param({"keys": []}, id="schema_absent"),
        pytest.param({"schema_version": 1}, id="key_list_absent"),
        pytest.param({"schema_version": 1, "keys": {}}, id="key_list_not_a_list"),
        pytest.param({"schema_version": 1, "keys": ["awaaz-governance-test"]}, id="entry_not_object"),
    ],
)
def test_a_trust_root_document_that_is_not_the_declared_shape_is_refused(
    pinned_governance_trust_root, document,
):
    """An unreadable trust root is never a permissive one."""
    pinned_governance_trust_root.write_text(json.dumps(document))
    os.chmod(pinned_governance_trust_root, 0o644)
    with pytest.raises(PreflightError, match="governance_trust_root_"):
        runtime._load_pinned_governance_keys()


def test_the_cli_refuses_without_a_pinned_key_and_names_no_path(tmp_path, capsys):
    """The shipped state, exercised through ``main`` and needing no signing capability."""
    _write_pinned_keys(runtime.GOVERNANCE_PUBLIC_KEYS_PATH, [])
    argv = [
        "preflight",
        "--archive",
        str(tmp_path / "patient-secret-archive.tar"),
        "--receipt",
        str(tmp_path / "patient-secret-governance.json"),
        "--base-model",
        str(tmp_path / "patient-secret-base-model"),
        "--output-dir",
        str(tmp_path / "private-output"),
    ]
    with pytest.raises(SystemExit) as exited:
        runtime.main(argv)
    assert exited.value.code == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err.strip() == "asr-runtime blocked [governance_trust_root_missing]"
    assert str(tmp_path) not in captured.err


def test_the_cli_rejects_any_attempt_to_supply_a_verification_key(tmp_path, capsys):
    """The retired argument must not linger as an accepted no-op."""
    argv = [
        "preflight",
        "--archive",
        str(tmp_path / "a.tar"),
        "--receipt",
        str(tmp_path / "r.json"),
        "--receipt-key-file",
        str(tmp_path / "governance.key"),
        "--base-model",
        str(tmp_path / "m"),
        "--output-dir",
        str(tmp_path / "o"),
    ]
    with pytest.raises(SystemExit) as exited:
        runtime.main(argv)
    assert exited.value.code == 2
    assert "unrecognized arguments" in capsys.readouterr().err


@requires_cryptography
def test_the_cli_exit_for_a_blocked_run_carries_only_an_error_code(
    tmp_path, capsys, pinned_governance_trust_root,
):
    """Operators see stderr; stderr must not become the leak channel the manifest is not.

    The CLI is invoked with real, private paths on the command line.  Its refusal message
    must name the machine-readable code and nothing else — no archive path, no receipt
    path, no output path, and no key identifier.
    """
    fixture = _fixture(tmp_path)
    # Empty the trust root so an otherwise fully authorised run is blocked at the gate.
    _write_pinned_keys(pinned_governance_trust_root, [])
    argv = [
        "preflight",
        "--archive",
        str(fixture.archive),
        "--receipt",
        str(fixture.receipt_path),
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
    assert captured.err.strip() == "asr-runtime blocked [governance_trust_root_missing]"
    for secret in (
        str(fixture.archive),
        str(fixture.receipt_path),
        str(fixture.base),
        str(fixture.output),
        str(tmp_path),
        str(PATIENT_ID),
        str(pinned_governance_trust_root),
        KEY_ID,
    ):
        assert secret not in captured.err
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_the_cli_blocked_path_reports_a_governance_refusal_without_private_values(
    tmp_path, capsys, monkeypatch,
):
    """The same discipline applies once the run gets far enough to read patient media."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
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


def test_the_optional_requirements_file_matches_the_pinned_dependency_contract():
    """`requirements-train.txt` and PINNED_DEPENDENCY_VERSIONS must not drift apart.

    The gate checks for an EXACT version match, so a package the runtime pins but the
    requirements file omits does not degrade gracefully -- it fails `dependencies_missing`
    on the training host, after someone has provisioned a GPU box and copied a consented
    archive onto it. That is the worst possible place to discover a packaging mistake.

    This test exists because it already happened: accelerate was dropped from the
    requirements file after reading which modules `runtime.py` imports. Imports are the
    wrong contract. The dict below is the contract, and nothing but a test keeps a human
    from reasoning their way to the same wrong answer again.
    """
    repo = Path(__file__).resolve().parents[2]
    runtime_source = Path(runtime.__file__).read_text(encoding="utf-8")
    block = re.search(r"PINNED_DEPENDENCY_VERSIONS = \{(.*?)\}", runtime_source, re.S)
    assert block, "PINNED_DEPENDENCY_VERSIONS is gone or was renamed"
    pinned = dict(re.findall(r'"([A-Za-z0-9_.-]+)":\s*"([^"]+)"', block.group(1)))
    assert pinned, "the pinned-version dict parsed as empty"

    requirements_path = repo / "backend" / "requirements-train.txt"
    declared = dict(
        re.findall(r"^([A-Za-z0-9_.-]+)==([^\s#]+)$",
                   requirements_path.read_text(encoding="utf-8"), re.M)
    )

    assert declared == pinned, (
        "backend/requirements-train.txt disagrees with PINNED_DEPENDENCY_VERSIONS.\n"
        f"  only in runtime.py:            {sorted(set(pinned) - set(declared))}\n"
        f"  only in requirements-train:    {sorted(set(declared) - set(pinned))}\n"
        f"  version disagreements:         "
        f"{ {k: (pinned[k], declared[k]) for k in set(pinned) & set(declared) if pinned[k] != declared[k]} }"
    )


# --------------------------------------------------------------------------------------
# 16. Output containment on every writing path, not just the real one.
#
# The repo-root/data/ rule and the base-model-tree rule lived in `_validate_config`, which
# only the real training path reaches.  `run_synthetic_smoke` went straight to
# `_create_staging_directory`, whose only check was "does this path already exist".
# --------------------------------------------------------------------------------------


def test_the_synthetic_smoke_cannot_write_a_manifest_into_the_tracked_source_tree():
    """The smoke obeys the same containment rule as a real run, or it does not obey one.

    ``--output-dir backend/app/awaaz/adapter`` used to create that directory and a
    manifest inside tracked source, contradicting the module's own rule that patient-derived
    artifacts live only under ``data/``.  Nothing about the smoke path made that safe: the
    same function publishes real adapters.
    """
    unsafe = Path(__file__).resolve().parents[1] / "app" / "unsafe-smoke-output"
    assert not unsafe.exists(), "a previous run leaked an artifact into the source tree"
    try:
        with pytest.raises(PreflightError, match="unsafe_output_location") as caught:
            run_synthetic_smoke(unsafe)
        assert str(unsafe) not in str(caught.value)
        assert not os.path.lexists(unsafe)
    finally:
        # If this gate is ever broken again, the failing run must not leave the artifact it
        # created behind to poison every later run of this test.
        shutil.rmtree(unsafe, ignore_errors=True)


@requires_cryptography
def test_no_writing_path_creates_missing_parent_directories(tmp_path, monkeypatch):
    """A mistyped path must not silently mkdir a tree of private artifact directories.

    ``mkdir(parents=True)`` made ``--output-dir /a/b/c/d/e`` create four levels no operator
    asked for; there is no way to tell that apart from an intended run root.  The runtime
    now adds only the final component, so a failed publish can also leave behind no
    directory that the runtime itself created.
    """
    nested = tmp_path / "unprovisioned" / "run" / "adapter"
    with pytest.raises(PreflightError, match="output_parent_missing"):
        run_synthetic_smoke(nested)
    assert not (tmp_path / "unprovisioned").exists()

    # The real path shares the guard rather than carrying a second copy of it.
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    nested_config = replace(fixture.config, output_dir=tmp_path / "also-missing" / "adapter")
    with pytest.raises(PreflightError, match="output_parent_missing"):
        run_preflight(nested_config, now=NOW)
    assert not (tmp_path / "also-missing").exists()


# --------------------------------------------------------------------------------------
# 17. Split size and adequacy.
#
# Disjointness was checked; size was not.  A legal split could hand the test partition a
# single sample while the manifest advertised a 15% target beside it.
# --------------------------------------------------------------------------------------


@requires_cryptography
def test_a_corpus_whose_held_out_partitions_would_be_tiny_is_refused(tmp_path, monkeypatch):
    """Fifty pairs, ten components, and a test partition of four is not an evaluable corpus.

    One dominant phrase group plus nine singletons clears every existing gate: fifty pairs,
    ten independent components, perfect group and phrase disjointness.  The allocation then
    leaves the held-out partitions with a handful of rows each, and the manifest would still
    print ``test: 0.15``.  Nothing computed on that is meaningful, so the run is refused
    rather than published with a footnote.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=10)
    for index in range(41):
        specs[index]["phrase"] = "One dominant practised phrase"
    fixture = _fixture(tmp_path, specs=specs)
    with pytest.raises(PreflightError, match="split_too_small") as caught:
        preflight_real_training(fixture.config, now=NOW)
    assert "dominant" not in str(caught.value)
    _assert_nothing_was_written(fixture)


def test_the_split_floor_is_relative_to_the_corpus_and_bounded_both_ways():
    """The floor scales with the corpus and the ceiling stops one partition swallowing it.

    A flat floor would be wrong in both directions: five rows is a plausible test partition
    at fifty pairs and an absurd one at five thousand.  The ceiling is what keeps validation
    from taking a third of a corpus whose target share is a seventh.
    """
    bounds = runtime._split_size_bounds(50)
    assert bounds["validation"][0] >= runtime.MINIMUM_SPLIT_SAMPLES
    assert bounds["validation"][1] < 0.34 * 50
    assert runtime._split_size_bounds(5_000)["test"][0] > runtime._split_size_bounds(50)["test"][0]

    starved = SimpleNamespace(sample_counts={"train": 33, "validation": 15, "test": 2})
    with pytest.raises(PreflightError, match="split_too_small"):
        runtime._assert_split_adequate(starved)
    swollen = SimpleNamespace(sample_counts={"train": 29, "validation": 16, "test": 5})
    with pytest.raises(PreflightError, match="split_unbalanced"):
        runtime._assert_split_adequate(swollen)


@requires_cryptography
def test_the_manifest_states_the_achieved_split_fractions_beside_the_target(
    tmp_path, monkeypatch,
):
    """A target the run did not achieve, printed alone, misleads whoever reads the artifact.

    Connected components are indivisible, so the achieved split is coarser than 70/15/15 on
    any real corpus.  The manifest must therefore say what the split actually was; the
    fractions below are the real ones for the fifty-pair fixture, not the advertised ones.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    payload = json.loads(run_preflight(fixture.config, now=NOW).read_text())
    split = payload["split"]

    assert split["target_sample_fractions"] == {"train": 0.7, "validation": 0.15, "test": 0.15}
    assert split["actual_sample_fractions"] == {"train": 0.6, "validation": 0.2, "test": 0.2}
    assert split["actual_sample_fractions"] != split["target_sample_fractions"]
    assert sum(split["sample_counts"].values()) == 50
    for name, count in split["sample_counts"].items():
        bound = split["required_sample_count_bounds"][name]
        assert bound["minimum"] <= count <= bound["maximum"]
    # The size floor may not be bought with a disjointness regression.
    assert split["invariants"]["group_disjoint"] is True
    assert split["invariants"]["exact_normalised_phrase_within_language_disjoint"] is True


@requires_cryptography
def test_the_disjointness_guarantees_survive_the_floor_first_allocation(tmp_path, monkeypatch):
    """Filling the floor first changes which partition a component lands in, nothing else."""
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=10)
    specs[1]["audio"] = specs[0]["audio"]
    specs[1]["phrase"] = specs[0]["phrase"]
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, now=NOW)

    partitions = {
        name: set(getattr(prepared.split, name)) for name in ("train", "validation", "test")
    }
    assert sum(len(values) for values in partitions.values()) == 50
    assert not partitions["train"] & partitions["validation"]
    assert not partitions["train"] & partitions["test"]
    assert not partitions["validation"] & partitions["test"]
    phrase_home: dict[str, str] = {}
    for name, indexes in partitions.items():
        for index in indexes:
            phrase = runtime.normalise_phrase(prepared.selected_pairs[index].target_text)
            assert phrase_home.setdefault(phrase, name) == name


# --------------------------------------------------------------------------------------
# 18. `epochs_completed` may not describe an epoch that did not happen.
# --------------------------------------------------------------------------------------


class _FakeLoss:
    """Supports exactly the two operations the optimisation loop performs on a loss."""

    def __truediv__(self, _divisor):
        return self

    def backward(self):
        return None


class _CountingModel:
    def __init__(self):
        self.forward_calls = 0

    def parameters(self):
        return iter(())

    def to(self, _device):
        return self

    def train(self):
        return self

    def __call__(self, **_batch):
        self.forward_calls += 1
        return SimpleNamespace(loss=_FakeLoss())


def _fake_torch() -> SimpleNamespace:
    optimizer = SimpleNamespace(zero_grad=lambda **_k: None, step=lambda: None)
    return SimpleNamespace(
        optim=SimpleNamespace(AdamW=lambda _parameters, lr: optimizer),
        isfinite=lambda _loss: SimpleNamespace(item=lambda: True),
        nn=SimpleNamespace(utils=SimpleNamespace(clip_grad_norm_=lambda *_a, **_k: None)),
    )


def _prepared_for_loop(tmp_path, monkeypatch, **overrides):
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, now=NOW)
    monkeypatch.setattr(runtime, "_collate_batch", lambda *_a, **_k: {})
    return replace(prepared, config=replace(prepared.config, **overrides))


@requires_cryptography
def test_an_epoch_the_step_limit_cut_short_is_not_reported_as_an_epoch(tmp_path, monkeypatch):
    """One batch of twenty is not an epoch, and the manifest may not call the run completed.

    ``--epochs 1 --max-optimizer-steps 1`` breaks out of the batch loop after a single
    optimiser step; the counter was then incremented anyway and the manifest hard-coded
    ``"status": "completed"``.  The resulting document claimed a full pass over the training
    split on the strength of one batch — in the artifact whose entire purpose is to not
    overstate what was done.
    """
    prepared = _prepared_for_loop(
        tmp_path, monkeypatch, epochs=2, batch_size=2, max_optimizer_steps=1
    )
    model = _CountingModel()
    facts = runtime._optimise_lora(
        prepared, object(), model, object(), _fake_torch(), "cpu"
    )
    assert model.forward_calls == 1
    assert facts["optimizer_steps"] == 1
    assert facts["examples_seen"] == 2
    assert facts["epochs_completed"] == 0
    assert facts["epochs_requested"] == 2
    assert facts["stopped_at_step_limit"] is True

    manifest = runtime._training_manifest(
        prepared,
        device_type="cpu",
        trainable_parameters=128,
        run_facts=facts,
        artifacts=[{"path": "adapter/adapter_model.safetensors", "size_bytes": 1, "sha256": "0" * 64}],
    )
    assert manifest["training"]["status"] == "truncated_before_completion"
    assert manifest["training"]["epochs_completed"] == 0
    assert manifest["training"]["epochs_requested"] == 2
    assert any("stopped before every requested epoch" in line for line in manifest["limitations"])
    assert manifest["claims"]["deployment_ready"] is False


@requires_cryptography
def test_a_run_that_finishes_every_requested_epoch_is_reported_as_completed(
    tmp_path, monkeypatch,
):
    """The honest counter must still count: understating a finished run is also a lie."""
    prepared = _prepared_for_loop(
        tmp_path, monkeypatch, epochs=2, batch_size=5, max_optimizer_steps=1_000
    )
    train_size = len(prepared.split.train)
    facts = runtime._optimise_lora(
        prepared, object(), _CountingModel(), object(), _fake_torch(), "cpu"
    )
    assert facts["epochs_completed"] == 2
    assert facts["stopped_at_step_limit"] is False
    assert facts["examples_seen"] == 2 * train_size

    manifest = runtime._training_manifest(
        prepared,
        device_type="cpu",
        trainable_parameters=128,
        run_facts=facts,
        artifacts=[{"path": "adapter/adapter_model.safetensors", "size_bytes": 1, "sha256": "0" * 64}],
    )
    assert manifest["training"]["status"] == "completed"
    assert not any("stopped before every requested epoch" in line for line in manifest["limitations"])


@requires_cryptography
def test_a_manifest_built_without_an_epoch_count_reads_as_truncated(tmp_path, monkeypatch):
    """A missing fact resolves to the conservative reading, never to "completed"."""
    prepared = _prepared_for_loop(tmp_path, monkeypatch, epochs=1)
    manifest = runtime._training_manifest(
        prepared,
        device_type="cpu",
        trainable_parameters=128,
        run_facts={"optimizer_steps": 1, "examples_seen": 2},
        artifacts=[{"path": "adapter/adapter_model.safetensors", "size_bytes": 1, "sha256": "0" * 64}],
    )
    assert manifest["training"]["status"] == "truncated_before_completion"


# --------------------------------------------------------------------------------------
# 19. Publication is atomic, or it is detectably incomplete.
# --------------------------------------------------------------------------------------


class _PowerCut(BaseException):
    """Not an ``OSError``: nothing in the runtime may catch it, as with SIGKILL."""


def test_a_crash_between_the_weights_and_the_manifest_leaves_a_directory_marked_incomplete(
    tmp_path, monkeypatch,
):
    """The window this closes is the artifact this module exists to prevent.

    ``_publish_staging`` renames children one at a time and keeps ``manifest.json`` for
    last.  A crash in between left patient-derived LoRA weights on disk with no manifest, no
    limitations, no ``deployment_ready: false``, and no provenance — a directory that looks
    exactly like a finished adapter to anyone who finds it.  The sentinel is written before
    the first child moves and removed only after the last one lands, so that window is
    always marked, and no reader may treat a marked directory as an artifact.
    """
    output = tmp_path / "published"
    staging = tmp_path / ".asr-runtime-crash"
    (staging / "adapter").mkdir(mode=0o700, parents=True)
    (staging / "adapter" / "adapter_model.safetensors").write_bytes(b"patient-derived-weights")
    (staging / "manifest.json").write_text("{}\n")

    real_rename = os.rename

    def crash_before_the_manifest(source, destination):
        if os.path.basename(source) == "manifest.json":
            raise _PowerCut()
        return real_rename(source, destination)

    monkeypatch.setattr(runtime.os, "rename", crash_before_the_manifest)
    with pytest.raises(_PowerCut):
        runtime._publish_staging(staging, output)

    assert (output / "adapter" / "adapter_model.safetensors").exists()
    assert not (output / "manifest.json").exists()
    assert os.path.lexists(output / runtime.INCOMPLETE_PUBLICATION_SENTINEL)
    with pytest.raises(TrainingRuntimeError, match="artifact_incomplete") as caught:
        runtime.verify_published_artifact(output)
    assert str(output) not in str(caught.value)


def test_a_finished_publication_clears_the_sentinel_and_verifies(tmp_path):
    """The sentinel must not survive a successful run, or every artifact reads as broken."""
    output = tmp_path / "smoke"
    manifest_path = run_synthetic_smoke(output)
    assert not os.path.lexists(output / runtime.INCOMPLETE_PUBLICATION_SENTINEL)
    assert runtime.verify_published_artifact(output) == manifest_path

    # A directory whose manifest is missing is not a finished artifact either, sentinel or no.
    manifest_path.unlink()
    with pytest.raises(TrainingRuntimeError, match="artifact_incomplete"):
        runtime.verify_published_artifact(output)


# --------------------------------------------------------------------------------------
# 20. The sanitizer screens what the patient actually said.
#
# `forbidden_identifiers` covered the patient UUID, the capture ids, and the audio hashes.
# It did not cover `target_text` — the utterances themselves, which are the highest-value
# INV-1 content in the archive and the one thing a generated model card is most likely to
# quote back as an "example".
# --------------------------------------------------------------------------------------


@requires_cryptography
def test_an_adapter_that_quotes_a_patient_utterance_is_destroyed(tmp_path, monkeypatch):
    """A transcript in a model card is a patient identifier that travels with the weights.

    The quote below is re-cased and re-spaced, because a leak will not be byte-identical to
    the archive row: matching is done on the normalised form for exactly that reason.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, now=NOW)
    utterance = prepared.selected_pairs[0].target_text
    quoted = f"  {utterance.upper()}  "

    class QuotingModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"weights")
            (destination / "README.md").write_text(
                f"# Adapter\n\nExample recognised phrase: {quoted}\n"
            )

    _training_harness(monkeypatch, prepared, QuotingModel())
    with pytest.raises(TrainingRuntimeError, match="artifact_privacy_violation") as caught:
        run_training(fixture.config, now=NOW)
    assert utterance.lower() not in str(caught.value).lower()
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_a_patient_utterance_hidden_in_a_safetensors_header_is_caught(tmp_path, monkeypatch):
    """Weights carry a JSON header, and a header is metadata like any other.

    The scan used to stop at ``.json``/``.md``/``.txt``, so anything a library chose to
    record in ``__metadata__`` was invisible.  Only the length-prefixed header is read; the
    tensor payload, which may be gigabytes, is never touched.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, now=NOW)
    utterance = prepared.selected_pairs[0].target_text

    class MetadataModel:
        def save_pretrained(self, destination, **_kwargs):
            header = json.dumps(
                {"__metadata__": {"training_example": utterance}, "format": "pt"}
            ).encode("utf-8")
            (destination / "adapter_model.safetensors").write_bytes(
                struct.pack("<Q", len(header)) + header + b"\x00" * 64
            )
            (destination / "adapter_config.json").write_text(json.dumps({"peft_type": "LORA"}))

    _training_harness(monkeypatch, prepared, MetadataModel())
    with pytest.raises(TrainingRuntimeError, match="artifact_privacy_violation") as caught:
        run_training(fixture.config, now=NOW)
    assert utterance.lower() not in str(caught.value).lower()
    _assert_nothing_was_written(fixture)


@requires_cryptography
def test_a_short_utterance_is_deliberately_not_screened(tmp_path, monkeypatch):
    """Pins the documented tradeoff, so it stays a decision rather than an accident.

    A one- or two-character-word target occurs verbatim inside tokenizer vocabularies and
    configuration keys.  Screening it would abort every real run on a false positive, and a
    check that always fires is a check that gets deleted.  The runtime never writes
    ``target_text`` into an artifact itself; this screen exists for third-party metadata,
    and it covers phrase-length utterances only.  If that boundary is ever moved, this test
    is where the move has to be argued.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    specs = _pair_specs(count=50, phrase_groups=10)
    for index, spec in enumerate(specs):
        spec["phrase"] = f"go {index % 10}"
    fixture = _fixture(tmp_path, specs=specs)
    prepared = preflight_real_training(fixture.config, now=NOW)
    assert runtime._screened_phrases(prepared) == frozenset()

    class ShortQuoteModel:
        def save_pretrained(self, destination, **_kwargs):
            (destination / "adapter_model.safetensors").write_bytes(b"weights")
            (destination / "README.md").write_text("# Adapter\n\nvocabulary token: go 3\n")

    _training_harness(monkeypatch, prepared, ShortQuoteModel())
    manifest_path = run_training(fixture.config, now=NOW)
    assert manifest_path.is_file()
    assert "go 3" in (fixture.output / "adapter" / "README.md").read_text()


# --------------------------------------------------------------------------------------
# 21. The base-model snapshot stays out of shared system temp.
# --------------------------------------------------------------------------------------


@requires_cryptography
def test_the_base_model_snapshot_is_not_copied_into_shared_system_temp(tmp_path, monkeypatch):
    """A multi-gigabyte checkpoint copy in /tmp outlives the process that made it.

    ``mkdtemp`` without ``dir=`` puts the snapshot in shared system temp, where the cleanup
    covers a normal exit and an exception but not SIGKILL or a power loss, and where it can
    exhaust a shared tmpfs mid-run.  The archive verifier in the same module already passes
    ``dir=`` for the same reason; this is the other half of that fix.
    """
    monkeypatch.setattr(runtime, "_check_dependencies", _fake_dependencies)
    fixture = _fixture(tmp_path)
    prepared = preflight_real_training(fixture.config, now=NOW)

    recorded: dict[str, object] = {}
    real_mkdtemp = runtime.tempfile.mkdtemp

    def spy(**kwargs):
        recorded.update(kwargs)
        return real_mkdtemp(**kwargs)

    monkeypatch.setattr(runtime.tempfile, "mkdtemp", spy)
    snapshot_root, snapshot = runtime._snapshot_approved_base_model(prepared)
    try:
        assert Path(recorded["dir"]) == fixture.base.resolve().parent
        assert snapshot_root.parent == fixture.base.resolve().parent
        assert snapshot.is_dir()
        assert sha256_directory(snapshot) == sha256_directory(fixture.base)
    finally:
        shutil.rmtree(snapshot_root, ignore_errors=True)
