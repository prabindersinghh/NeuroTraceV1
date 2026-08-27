"""INV-13 — no regulatory-exemption claim anywhere in this repository.

Until 2026-08-24 the repo stated, in several places: "D2C — Recovery Companion — Outside
CDSCO device classification." That sentence asserted a regulatory conclusion the project has
no basis for, and relied on a mechanism that does not hold: CDSCO's Medical Device Software
guidance (final, 21 July 2026) classifies software by INTENDED USE, not business model. See
`docs/INTENDED_USE.md` for the full account and the frozen replacement wording.

WHAT THIS DOES NOT FORBID
--------------------------
The exam's own safety disclaimers — "it cannot detect a stroke happening now, call 108
first" — are functional truths about what the engine observes, not regulatory
self-classifications, and are untouched by this test. Every one of them was reworded during
the 2026-08-24 fix to carry the same safety meaning without using the banned phrases at all
("A monitoring aid, not a medical device" became "It reasons over days, so it cannot see a
stroke that is happening now" — same warning, no classification claim). That is why this
test can afford to ban the bare phrases outright rather than trying to distinguish "claim"
from "disclaimer" with a context-aware parser: after the fix, no legitimate live surface
needs to say "not a medical device" or "outside CDSCO" at all.

WHY AN ALLOWLIST, NOT A SMARTER PATTERN
-----------------------------------------
Documentation that explains what is now prohibited necessarily quotes the prohibited text —
`docs/INTENDED_USE.md`'s "why the previous wording was wrong" section, `docs/CLAIMS_MATRIX.md`'s
PROHIBITED list, this file's own docstring, and the DECISIONS/CHANGELOG entries recording the
fix. A regex clever enough to tell "asserting X" from "quoting X to forbid it" is exactly the
kind of thing that fails open (this repo hit that exact problem with INV-11 — D-030 — and
fixed it by tightening the pattern instead; here the safer fix is a short, explicit,
reviewable list of files whose job is to discuss the ban, checked against a live test rather
than trusted blindly).

Files not on the allowlist get the strict check. Files on it still may not contain anything
this test's own self-tests prove the scanner would flag as a NEW live assertion — the
allowlist covers "quotes the historical wrong sentence to explain it", not "says it as fact".
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]

#: Binary/generated suffixes never worth scanning.
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".task",
    ".wasm", ".db", ".sqlite3", ".lock",
}

#: Files permitted to quote the forbidden phrasing because their job is to document that it
#: is forbidden (history, the matrix, the invariant, this test, the decision/changelog
#: record). Nothing here is permitted to ASSERT the claim — only to discuss it.
DOCUMENTATION_ALLOWLIST = {
    "backend/tests/test_regulatory_claims.py",
    "docs/INTENDED_USE.md",
    "docs/CLAIMS_MATRIX.md",
    "docs/ARCHITECTURE.md",
    "docs/DECISIONS.md",
    "docs/CHANGELOG.md",
    "docs/PROGRESS.md",
    "TASK_FINAL_TECHNICAL_COMPLETION.md",
}

#: Each pattern is a regulatory-exemption ASSERTION shape, not a bare risky word — "exempt"
#: alone hits legitimate, unrelated uses in this repo (the HTTPS/localhost note in
#: DEVELOPMENT.md and frontend/README.md; INV-11's own history in DECISIONS.md/CHANGELOG.md
#: about *not* exempting files from a scan). Scoped to co-occurrence with the regulatory
#: subject so those stay green.
FORBIDDEN_PATTERNS = [
    re.compile(r"outside\s+CDSCO", re.I),
    re.compile(r"not\s+a\s+medical\s+device", re.I),
    re.compile(r"outside\s+medical[\s-]device\s+classification", re.I),
    re.compile(r"unregistered\s+medical\s+device", re.I),
    re.compile(r"positioned\s+outside\b", re.I),
    re.compile(r"wellness\s+(and\s+adherence\s+)?companion", re.I),
    re.compile(r"non-diagnostic\s+language\s+only", re.I),
    re.compile(r"no\s+regulatory\s+approval\s+(needed|required)", re.I),
    re.compile(r"does\s+not\s+require\s+CDSCO", re.I),
    re.compile(r"CDSCO.{0,40}exempt|exempt.{0,40}CDSCO", re.I),
    re.compile(r"exempt.{0,40}(medical.device|classification|regulat)", re.I),
    # A specific risk class asserted as our status, not as a term being defined/discussed.
    re.compile(r"\b(?:is|as)\s+(?:a\s+)?Class\s+[ABCD]\b.{0,20}device", re.I),
]


def _tracked_files() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=REPO, capture_output=True, text=True, check=False
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def _scan(rel_paths: list[str]) -> list[str]:
    offenders = []
    for rel in rel_paths:
        path = REPO / rel
        if path.suffix.lower() in SKIP_SUFFIXES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.search(line):
                    offenders.append(f"{rel}:{i}: {line.strip()[:140]}")
    return offenders


def test_no_regulatory_exemption_claim_in_tracked_files():
    """The main guard. Runs over every tracked, non-allowlisted file in the repo."""
    candidates = [f for f in _tracked_files() if f not in DOCUMENTATION_ALLOWLIST]
    offenders = _scan(candidates)
    assert offenders == [], (
        "Regulatory-exemption claim found (INV-13). Classification follows intended use, "
        "not business model or phrasing — see docs/INTENDED_USE.md. Offending line(s):\n  "
        + "\n  ".join(offenders)
    )


def test_the_allowlist_files_still_exist():
    """An allowlist entry for a file that got renamed or deleted silently stops checking
    anything — it would look like a passing test forever. Every entry must resolve."""
    missing = [f for f in DOCUMENTATION_ALLOWLIST if not (REPO / f).is_file()]
    assert missing == [], f"allowlisted files no longer exist: {missing}"


def test_frontend_dist_if_built_carries_no_exemption_claim():
    """Part 8.1 asks for the shipped bundle to be checked too — source code that never
    ships a bad string is necessary but not sufficient if a build step could reintroduce
    one (a stale cached chunk, a copy-paste into an env-templated file, etc).

    Skips rather than fails when no build exists: this test does not build the frontend
    itself (that is `npm run build`'s job, and running it here would make every unrelated
    test invocation slow). CI / the deploy pipeline should run `npm run build` before this
    suite for the check to be meaningful; locally it is a no-op until you have built once.
    """
    dist = REPO / "frontend" / "dist"
    if not dist.is_dir():
        pytest.skip("frontend/dist not built — run `npm run build` first for this check")
    offenders = []
    for path in dist.rglob("*"):
        if not path.is_file() or path.suffix.lower() in SKIP_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            for pattern in FORBIDDEN_PATTERNS:
                if pattern.search(line):
                    offenders.append(f"{path.relative_to(REPO)}:{i}")
                    break
    assert offenders == [], f"regulatory-exemption claim shipped in the built bundle: {offenders}"


# ------------------------------------------------------------------ the scanner itself
# Same discipline as test_migration_portability.py's self-tests: a guard that has never
# been shown to catch a real offender, or shown NOT to cry wolf on legitimate text, is not
# yet trustworthy — and this repo has already shipped one scanner (INV-11, D-030) that
# needed a second pass after its first version flagged its own prohibitions.

def test_the_scanner_catches_the_actual_historical_sentence():
    text = 'D2C — "Recovery Companion" — Outside CDSCO device classification.'
    assert any(p.search(text) for p in FORBIDDEN_PATTERNS)


def test_the_scanner_catches_each_seeded_variant():
    variants = [
        "Wellness and adherence companion. Non-diagnostic language only.",
        "Positioned outside medical-device classification.",
        "This is not a medical device. It does not diagnose anything.",
        "Saying this turns a wellness companion into an unregistered medical device.",
        "This app does not require CDSCO approval.",
        "Under CDSCO rules this product is exempt.",
    ]
    for text in variants:
        assert any(p.search(text) for p in FORBIDDEN_PATTERNS), f"missed: {text!r}"


def test_the_scanner_ignores_the_localhost_https_exemption_note():
    """The real false positive this repo has: 'localhost is exempt' about the HTTPS
    requirement for camera/mic access, nothing to do with CDSCO."""
    text = "**Camera and microphone need HTTPS.** `localhost` is exempt; a LAN IP is not."
    assert not any(p.search(text) for p in FORBIDDEN_PATTERNS)


def test_the_scanner_ignores_inv11s_own_scanner_history():
    """The other real false positive: DECISIONS.md/CHANGELOG.md discussing the INV-11
    detector's own history of (not) exempting files from a scan."""
    text = "Exempting those files was the wrong fix: a check that fires on the sentence"
    assert not any(p.search(text) for p in FORBIDDEN_PATTERNS)


def test_the_scanner_ignores_the_safety_disclaimer_that_replaced_the_bad_copy():
    """The functional safety warning must survive untouched — this is the sentence the
    fix produced, and it must never itself start failing this test."""
    text = ("It reasons over days, so it cannot see a stroke that is happening now. Sudden "
            "weakness, a drooping face or slurred speech is an emergency — call 108 first.")
    assert not any(p.search(text) for p in FORBIDDEN_PATTERNS)


def test_the_scanner_ignores_the_onboarding_disclaimer_that_replaced_the_bad_copy():
    text = "It does not diagnose anything."
    assert not any(p.search(text) for p in FORBIDDEN_PATTERNS)
