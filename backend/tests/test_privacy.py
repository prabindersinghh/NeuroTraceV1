"""INV-11 — no patient identifier may exist anywhere in this repository.

The calibration data in `docs/CLINICAL_REFERENCE.md` comes from photographs of a real
person's hospital records. Clinical VALUES are what we need; everything that identifies the
person is what we must never hold.

Getting this wrong is not a bug that degrades a feature. It publishes someone's medical
records, it is irreversible once pushed, and the person it happens to is a family member of
the project owner who consented to help.

WHAT THIS CHECKS
----------------
1. No source image is tracked, anywhere, ever — including in history.
2. No identifier LABEL appears in tracked text ("UHID", "Accession", "Patient ID", ...).
   Labels are checked rather than values because a label is what a transcription looks like
   when someone pastes a report line in without thinking.
3. No day-level date appears in the clinical documents. Month-and-year is the agreed
   granularity; a full date in a clinical file is either an appointment date or a date of
   birth, and both identify. Our own files (migrations, changelog) legitimately carry full
   dates and are deliberately out of scope for this rule.
4. Optional literal denylist — see below.

WHY THERE ARE NO LITERAL IDENTIFIERS IN THIS FILE
-------------------------------------------------
Writing the patient's name into the test that forbids the patient's name would put it in the
repository permanently, which is the exact outcome the test exists to prevent. So the
literals live in `.privacy-denylist` at the repo root, which is gitignored. If it is present
the test also greps for those exact strings; if it is absent the pattern checks still run.
A developer who wants literal checking creates the file locally and it never leaves their
machine.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]

#: Files whose content is transcribed clinical data, where day-level dates are forbidden.
CLINICAL_DOCS = ("docs/CLINICAL_REFERENCE.md", "docs/GAP_ANALYSIS.md")

#: Label patterns. A transcription accident looks like a label followed by a value.
IDENTIFIER_LABELS = re.compile(
    r"\b("
    r"UHID"
    r"|MRN\s*[:#]"
    r"|IPID"
    r"|OPID"
    r"|accession"
    # \b after each alternative: without it "no\.?" matched the "no" in
    # "Patient not found", an ordinary 404 message.
    r"|patient\s+(?:id\b|name\b|no\.|number\b)"
    r"|referring\s+(?:physician|doctor|consultant)"
    r"|hospital\s+(?:id\b|no\.|number\b)"
    r"|date\s+of\s+birth"
    r"|\bDOB\b"
    r")",
    re.IGNORECASE,
)

#: What a VALUE looks like after a label. A label on its own is not a leak — the rule that
#: forbids these labels has to name them, and so does every document that restates the rule.
#: The leak is `Label: <something>`. Three shapes count, and nothing else:
#:   1. a separator and then anything      — "Patient ID: 12345", "UHID = X"
#:   2. a token containing a digit         — "UHID 1234567", "MRN 88A21"
#:   3. a capitalised token (proper noun)  — "Referring Physician Dr Foo"
#: Ordinary prose continues in lowercase ("...the patient name on a page") or in a comma
#: ("no patient name, patient ID, ..."), and neither is a value.
#:
#: This narrowing was forced by a real failure: staging the spec documents made seven lines
#: fail and all seven were PROHIBITIONS. A guard that fires on the sentence forbidding the
#: thing gets muted by whoever is trying to commit, and then it is not a guard any more.
VALUE_AFTER_LABEL = re.compile(r"^\s*(?:[:#=]\s*\S|\S*\d|[A-Z][\w.'-]*)")


def _carries_a_value(remainder: str) -> bool:
    """True when what follows a label looks like an identifier rather than more prose."""
    return bool(VALUE_AFTER_LABEL.match(remainder))


#: Day-level dates: 12/03/2026, 2026-03-12, 12-03-26.
FULL_DATE = re.compile(
    r"\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b"
)

IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff", ".pdf")


def _tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=False
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def _tracked_text_files() -> list[Path]:
    paths = []
    for rel in _tracked_files():
        path = REPO / rel
        if path.suffix.lower() in IMAGE_SUFFIXES or not path.is_file():
            continue
        paths.append(path)
    return paths


# --------------------------------------------------------------------------- images
def test_no_source_image_is_tracked():
    """The photographs must never be committed. They live in the working tree, so this is
    one `git add -A` away at all times."""
    offenders = [
        rel for rel in _tracked_files()
        if Path(rel).suffix.lower() in IMAGE_SUFFIXES or "stroke report" in rel.lower()
    ]
    assert offenders == [], (
        "Source images or report files are TRACKED. These are photographs of a real "
        f"patient's records and must never be committed: {offenders}"
    )


def test_the_image_folder_is_ignored():
    """It sits inside the working tree — the task brief assumed it was outside the repo,
    and it is not. Being ignored is the only thing standing between it and a commit."""
    folder = REPO / "real stroke report"
    if not folder.exists():
        pytest.skip("source folder not present on this machine")

    sample = next((p for p in folder.iterdir() if p.is_file()), None)
    assert sample is not None, "source folder is empty"

    result = subprocess.run(
        ["git", "check-ignore", str(sample.relative_to(REPO))],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        "The source-image folder is NOT gitignored. It is inside the repository working "
        "tree, so a single `git add -A` would publish a real patient's medical records."
    )


@pytest.mark.parametrize("relative_path", [
    "data/raw/patient.wav",
    "data/exports/awaaz-training.tar",
    "backend/data/raw/patient.wav",
    "backend/app/ml/train/artifacts/patient-123/adapter_model.safetensors",
    "backend/app/ml/train/artifacts/patient-123/model.onnx",
])
def test_training_data_and_model_weights_are_gitignored(relative_path: str):
    result = subprocess.run(
        ["git", "check-ignore", "--", relative_path],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        f"Private training input/output is stageable: {relative_path}"
    )


def test_no_image_was_ever_committed():
    """History too — removing a file from HEAD does not remove it from the repository."""
    out = subprocess.run(
        ["git", "log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:"],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    offenders = {
        line.strip() for line in out.stdout.splitlines()
        if line.strip() and (
            Path(line.strip()).suffix.lower() in IMAGE_SUFFIXES
            or "stroke report" in line.lower()
        )
    }
    assert offenders == set(), (
        f"Images appear in git history and must be purged, not just deleted: {offenders}"
    )


# --------------------------------------------------------------------------- labels
def test_no_identifier_label_appears_in_tracked_text():
    """A pasted report line looks like `Patient ID: ...`. Catch the shape, not the value."""
    offenders: list[str] = []
    for path in _tracked_text_files():
        if path.name == "test_privacy.py":
            continue          # this file names the labels in order to forbid them
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for m in IDENTIFIER_LABELS.finditer(line):
                if not _carries_a_value(line[m.end():]):
                    continue      # naming the label, not carrying an identifier
                rel = path.relative_to(REPO)
                offenders.append(f"{rel}:{i}: {line.strip()[:90]}")
                break
    assert offenders == [], (
        "Patient-identifier labels found in tracked files:\n  " + "\n  ".join(offenders)
    )


# --------------------------------------------------------------------------- dates
def test_clinical_documents_use_month_and_year_only():
    """Day-level precision in a clinical file is an appointment date or a birth date.

    Scoped to the clinical documents: our migrations and changelog legitimately carry full
    dates and banning those repo-wide would make the rule unenforceable, which is how a
    privacy rule ends up switched off.
    """
    offenders: list[str] = []
    for rel in CLINICAL_DOCS:
        path = REPO / rel
        if not path.exists():
            continue
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in FULL_DATE.finditer(line):
                offenders.append(f"{rel}:{i}: {match.group(0)}  in: {line.strip()[:70]}")
    assert offenders == [], (
        "Day-level dates in clinical documents — month and year is the agreed maximum "
        "granularity:\n  " + "\n  ".join(offenders)
    )


# --------------------------------------------------------------------------- literals
def test_local_denylist_literals_are_absent():
    """Optional exact-string check.

    `.privacy-denylist` is gitignored and holds the actual identifiers (one per line,
    `#` comments allowed). Writing them into a tracked test would put them in the repo
    permanently — the very thing being prevented. Absent file = pattern checks only.
    """
    denylist = REPO / ".privacy-denylist"
    if not denylist.exists():
        pytest.skip(
            ".privacy-denylist not present (optional). Create it locally with the real "
            "identifiers, one per line, to enable exact-string checking. It is gitignored."
        )

    terms = [
        line.strip() for line in denylist.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    assert terms, ".privacy-denylist exists but is empty"

    offenders: list[str] = []
    for path in _tracked_text_files():
        try:
            text = path.read_text(encoding="utf-8").lower()
        except (UnicodeDecodeError, OSError):
            continue
        for term in terms:
            if term.lower() in text:
                # Deliberately does NOT echo the term — the failure message would then
                # contain the identifier and end up in a log.
                offenders.append(f"{path.relative_to(REPO)} contains a denylisted term")
    assert offenders == [], "Denylisted identifiers found:\n  " + "\n  ".join(sorted(set(offenders)))


def test_no_image_blob_exists_in_the_object_store():
    """Not just unreferenced — ABSENT.

    `git add` writes a blob immediately, before any commit. All 22 source photographs were
    staged at some point and left 22 JPEG blobs in `.git/objects`, unreachable from any ref
    but fully recoverable by anyone with filesystem access, and revivable by a stray
    `git add -A`.

    Unreachable is not the same as gone. Push only transfers reachable objects, so they were
    never sent to the remote — but "it was never pushed" is a weaker guarantee than "it does
    not exist", and this is a real person's medical records.

    If this fails:  git reflog expire --expire-unreachable=now --all && git gc --prune=now
    """
    out = subprocess.run(
        ["git", "cat-file", "--batch-all-objects",
         "--batch-check=%(objecttype) %(objectname) %(objectsize)"],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    candidates = [
        parts[1]
        for line in out.stdout.splitlines()
        if (parts := line.split()) and len(parts) == 3
        and parts[0] == "blob" and parts[2].isdigit() and int(parts[2]) > 20_000
    ]

    offenders = []
    for sha in candidates:
        blob = subprocess.run(
            ["git", "cat-file", "blob", sha],
            cwd=REPO, capture_output=True, check=False,
        )
        head = blob.stdout[:4]
        if head[:3] == b"\xff\xd8\xff" or head == b"\x89PNG":
            offenders.append(sha)

    assert offenders == [], (
        f"{len(offenders)} image blob(s) are still recoverable from the object store. "
        "Purge with: git reflog expire --expire-unreachable=now --all && "
        "git gc --prune=now"
    )


def test_the_remote_carries_no_image():
    """The repository HAS a remote and has been pushed. Verify what is on it.

    This exists because "we never pushed the images" turned out to need actual checking:
    22 image blobs were sitting in the local object store, and only a reachability analysis
    established that none had ever been committed and therefore none had ever been sent.
    """
    out = subprocess.run(
        ["git", "ls-tree", "-r", "--name-only", "origin/main"],
        cwd=REPO, capture_output=True, text=True, check=False,
    )
    if out.returncode != 0:
        pytest.skip("no origin/main ref present on this machine")

    offenders = [
        line for line in out.stdout.splitlines()
        if Path(line).suffix.lower() in IMAGE_SUFFIXES or "stroke report" in line.lower()
    ]
    assert offenders == [], (
        f"Images are present on the REMOTE. History must be rewritten and force-pushed, "
        f"and the exposure treated as a disclosure: {offenders}"
    )


# --------------------------------------------------------------- the detector itself
# Narrowing a safety check is the moment to test the check. These cases are the exact
# distinction the guard now rests on: a label followed by a value is a leak; a label
# followed by prose is a sentence about the rule.

_LEAKS = [
    "Patient ID: 12345",
    "UHID 1234567",
    "Patient Name: Foo Bar",
    "Referring Physician: Dr Foo",
    "MRN # 44821",
    "Date of birth: 1/1/1970",
]

_NOT_LEAKS = [
    "no patient name, patient ID, hospital ID, accession number,",
    "We do not put the enrolled patient name on a page that the caregiver shares.",
    "identifier, date of birth or address. Only measured values and clinical findings.",
    "accession number, referring physician, hospital name, or full date appears in this",
    "Patient not found",
]


@pytest.mark.parametrize("line", _LEAKS)
def test_detector_catches_a_label_followed_by_a_value(line):
    m = IDENTIFIER_LABELS.search(line)
    assert m is not None, f"label not recognised at all in {line!r}"
    assert _carries_a_value(line[m.end():]), f"leak not flagged: {line!r}"


@pytest.mark.parametrize("line", _NOT_LEAKS)
def test_detector_ignores_a_label_used_in_prose(line):
    for m in IDENTIFIER_LABELS.finditer(line):
        assert not _carries_a_value(line[m.end():]), f"false positive on {line!r}"


# ------------------------------------------------- the ignore rule must be the PRIVACY rule
def test_source_material_is_ignored_by_a_privacy_rule_not_a_build_rule():
    """Being ignored is not enough — it has to be ignored ON PURPOSE.

    `real stroke report.zip` is an archive of all 22 photographs. For a while it was
    ignored only by `*.zip`, a build-artifact rule, because the privacy rule was written
    `*stroke report*/` — with a trailing slash, which matches directories only. Narrowing
    `*.zip` (to keep a release archive, say) would have silently made somebody's hospital
    records stageable, and nothing would have said so.

    So this asserts the ATTRIBUTION, not just the outcome: whatever rule catches source
    material must itself be about source material.
    """
    candidates = [p for p in REPO.iterdir() if "stroke report" in p.name.lower()]
    if not candidates:
        pytest.skip("no source material on this machine — nothing to attribute")

    for path in candidates:
        out = subprocess.run(
            ["git", "check-ignore", "-v", "--", str(path)],
            cwd=REPO, capture_output=True, text=True, check=False,
        )
        assert out.returncode == 0, f"{path.name} is NOT ignored at all"
        rule = out.stdout.split("	")[0]          # "<file>:<line>:<pattern>"
        assert "stroke report" in rule.lower(), (
            f"{path.name} is ignored by {rule!r} — an incidental rule, not the privacy "
            "rule. If that rule is ever narrowed, the photographs become stageable."
        )


# --------------------------------------- a caller-supplied label must not reach a tracked file
def test_a_patient_label_passed_on_the_command_line_never_reaches_a_written_artifact(tmp_path):
    """`--patient` is an argument; `artifacts/*.metrics.json` is TRACKED. That is a leak path.

    The label pattern above cannot catch this one. It matches `patient\\s+id`, and `\\s` does
    not match the underscore in `patient_id` — the exact key these trainers write the value
    under — so a real name committed this way would pass every check in this file. The guard
    therefore lives at the writer: `redact_patient_label` lets the known-synthetic default
    through unchanged and collapses everything else to a constant.

    Both trainers are covered because both accept `--patient` and both write a tracked
    artifact under the same key.
    """
    from app.ml.train.common import REDACTED_PATIENT_LABEL, SYNTHETIC_PATIENT_LABEL
    from app.ml.train.common import redact_patient_label

    assert redact_patient_label(SYNTHETIC_PATIENT_LABEL) == SYNTHETIC_PATIENT_LABEL
    for identifying in ("Firstname Lastname", "UHID-99213", "ward-3-bed-7", ""):
        assert redact_patient_label(identifying) == REDACTED_PATIENT_LABEL

    marker = "Zzidentifyinglabelzz"
    for module, artifact in (
        ("app.ml.train.voice_clone", "voice_clone.metrics.json"),
        ("app.ml.train.personalised_asr_adapter", "personalised_asr_adapter.metrics.json"),
    ):
        out = tmp_path / module.rsplit(".", 1)[-1]
        run = subprocess.run(
            [sys.executable, "-m", module, "--patient", marker, "--out", str(out)],
            cwd=REPO / "backend", capture_output=True, text=True, check=False,
        )
        assert run.returncode == 0, run.stderr
        written = (out / artifact).read_text(encoding="utf-8")
        assert marker not in written, f"{artifact} recorded the command-line label"
        assert REDACTED_PATIENT_LABEL in written
        # The terminal is one copy-paste from an issue comment, so it is redacted too.
        assert marker not in run.stdout
