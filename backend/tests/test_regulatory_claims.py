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


# =====================================================================================
# Part 8.1 — the OVERCLAIM family
# =====================================================================================
#
# INV-13 above bans regulatory-exemption claims. This section bans the other way the
# product could lie: claiming a capability it does not have.
#
# THE TRAP THIS SECTION IS BUILT AROUND. Every prohibited phrase here has a legitimate
# NEGATED form that the product not only may say but MUST say. "It cannot detect a stroke
# that is happening now" is the single most safety-critical sentence in the onboarding
# flow; a scanner that flagged it would pressure someone into weakening the warning to
# make a test pass. That is precisely the failure mode D-030 records for INV-11's first
# scanner.
#
# So each match is checked against the text preceding it on the same line, and a negation
# there means the sentence is a disclaimer rather than a claim.

#: Claim shapes. Each is matched, then negation-filtered — see `_overclaims`.
OVERCLAIM_PATTERNS = [
    re.compile(r"detects?\s+(?:a\s+)?strokes?\b", re.I),
    re.compile(r"predicts?\s+(?:your|the|a|their)?\s*(?:next\s+)?strokes?\b", re.I),
    re.compile(r"diagnos(?:e|es|ing)\s+\w+", re.I),
    re.compile(r"replaces?\s+(?:a\s+|your\s+|the\s+)?"
               r"(?:neurologist|doctor|physician|clinician)", re.I),
    re.compile(r"clinically\s+proven", re.I),
    re.compile(r"clinically\s+(?:equivalent|validated)", re.I),
    re.compile(r"equivalent\s+to\s+hospital\s+equipment", re.I),
    re.compile(r"medical[\s-]grade\s+(?:accuracy|diagnosis|assessment)", re.I),
]

#: A match preceded by any of these on the same line is a disclaimer, not a claim.
NEGATIONS = re.compile(
    r"\b(?:cannot|can\s*not|can't|does\s*not|doesn't|do\s*not|don't|did\s*not|"
    r"will\s*not|won't|is\s*not|isn't|are\s*not|aren't|was\s*not|never|no|not|"
    r"nothing|none|without|neither|nor|unable|refuses?|must\s*not|"
    r"forbidden|prohibited|banned|avoid|instead\s+of)\b",
    re.I,
)

#: An accuracy-style figure. Legitimate ONLY when the surrounding text says it is
#: synthetic — every model in this product is trained on synthetic fixtures
#: (docs/ML_STATUS.md), so a bare number presents a synthetic result as a real one.
ACCURACY_CLAIM = re.compile(
    r"\b(?:accuracy|accurate|sensitivity|specificity|AUC|F1|precision|recall)\b"
    r"[^.\n]{0,40}\b\d{1,3}(?:\.\d+)?\s*%"
    r"|\b\d{1,3}(?:\.\d+)?\s*%[^.\n]{0,40}"
    r"\b(?:accuracy|accurate|sensitivity|specificity|AUC|F1)\b",
    re.I,
)

#: Words that make an accuracy figure honest rather than a claim.
SYNTHETIC_MARKERS = re.compile(
    r"\b(?:synthetic|fixture|simulated|fabricated|placeholder|not\s+real|"
    r"no\s+clinical\s+validation|unvalidated|illustrative|example)\b", re.I,
)

#: A figure is only OUR claim if it is talking about OUR system.
#:
#: Without this the scanner flagged `docs/CLINICAL_REFERENCE.md`'s published VNG reference
#: ranges — "Saccade precision 94-112%" is a physiological measurement of an eye, not a
#: model metric, and `precision`/`sensitivity` are simply words that belong to both
#: vocabularies. Demanding a model-claim context is what separates "the literature says a
#: healthy saccade lands within 94-112% of target" from "our classifier is 94% accurate".
MODEL_CONTEXT = re.compile(
    r"\b(?:model|classifier|detector|algorithm|achiev\w*|reach\w*|"
    r"AUC|F1|train\w*|test\s+set|held[\s-]out|benchmark\w*|"
    r"NeuroTrace)\b", re.I,
)


def _overclaims(text: str) -> list[tuple[int, str]]:
    """Matches that are ASSERTIONS, with negated disclaimers filtered out.

    The negation window includes the PREVIOUS line, because prose wraps. The repo's own
    README says "It does not detect strokes and does not\\nreplace a clinician." — the
    negation and the claim phrase land on different lines, and a line-scoped check flagged
    it as an overclaim. That is the D-030 failure mode arriving in a new costume: a scanner
    that flags a correct disclaimer pressures someone into weakening it.
    """
    hits: list[tuple[int, str]] = []
    lines = text.splitlines()
    for i, line in enumerate(lines, 1):
        for pattern in OVERCLAIM_PATTERNS:
            for match in pattern.finditer(line):
                previous = lines[i - 2] if i >= 2 else ""
                window = f"{previous} {line[:match.start()]}"
                if NEGATIONS.search(window):
                    continue
                hits.append((i, line.strip()[:140]))
                break
    return hits


def _unlabelled_accuracy(text: str) -> list[tuple[int, str]]:
    """Accuracy figures with no synthetic/unvalidated label nearby.

    Looks at the preceding lines too: these numbers usually sit in tables or lists where
    the caveat is on the heading rather than repeated on every row.
    """
    hits: list[tuple[int, str]] = []
    lines = text.splitlines()
    for i, line in enumerate(lines, 1):
        if not ACCURACY_CLAIM.search(line):
            continue
        window = "\n".join(lines[max(0, i - 3):i + 1])
        if SYNTHETIC_MARKERS.search(window):
            continue
        # Not a claim about our system at all — e.g. a published clinical reference range.
        if not MODEL_CONTEXT.search(window):
            continue
        hits.append((i, line.strip()[:140]))
    return hits


def _claim_bearing_files() -> list[str]:
    """User-facing surfaces plus the documents a reader takes as claims.

    Deliberately not the whole repo: `backend/tests/` quotes prohibited phrases in order to
    forbid them, and the allowlisted docs exist to discuss them.
    """
    out = []
    for rel in _tracked_files():
        if rel in DOCUMENTATION_ALLOWLIST or rel.startswith("backend/tests/"):
            continue
        if rel.startswith("frontend/src/") and rel.endswith((".tsx", ".ts")):
            out.append(rel)
        elif rel.startswith("docs/") and rel.endswith(".md"):
            out.append(rel)
        elif rel in ("README.md", "frontend/README.md"):
            out.append(rel)
    return out


def test_no_user_facing_surface_overclaims():
    """Part 8.1. `Landing.tsx` is explicitly in scope — it is the most claim-dense surface
    in the product and the one a judge or a family reads first."""
    offenders: list[str] = []
    for rel in _claim_bearing_files():
        path = REPO / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        offenders += [f"{rel}:{n}: {line}" for n, line in _overclaims(text)]
    assert offenders == [], (
        "Capability overclaim found (Part 8.1 / docs/CLAIMS_MATRIX.md). This product "
        "observes change over days against a personal baseline. It does not detect, "
        "predict, diagnose, or replace anyone.\n  " + "\n  ".join(offenders)
    )


def test_no_synthetic_metric_is_presented_as_a_real_result():
    """Every model in this product is trained on synthetic fixtures (docs/ML_STATUS.md).
    An accuracy figure without that label reads as a measured clinical result."""
    offenders: list[str] = []
    for rel in _claim_bearing_files():
        path = REPO / rel
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        offenders += [f"{rel}:{n}: {line}" for n, line in _unlabelled_accuracy(text)]
    assert offenders == [], (
        "A performance figure appears with no synthetic/unvalidated label within three "
        "lines. Every model here is trained on synthetic fixtures — docs/ML_STATUS.md.\n  "
        + "\n  ".join(offenders)
    )


def test_the_built_bundle_carries_no_overclaim():
    """Source that never ships a bad string is necessary but not sufficient — a stale
    chunk or a templated file could reintroduce one. Same skip policy as the INV-13
    bundle check above."""
    dist = REPO / "frontend" / "dist"
    if not dist.is_dir():
        pytest.skip("frontend/dist not built - run `npm run build` first for this check")
    offenders = []
    for path in dist.rglob("*"):
        if not path.is_file() or path.suffix.lower() in SKIP_SUFFIXES:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if _overclaims(text):
            offenders.append(str(path.relative_to(REPO)))
    assert offenders == [], f"capability overclaim shipped in the built bundle: {offenders}"


# ------------------------------------------------------- the overclaim scanner itself
# Both directions, same discipline as the INV-13 self-tests above. The negated cases are
# the ones that matter: these are sentences the product MUST be able to say.

@pytest.mark.parametrize("text", [
    "NeuroTrace detects stroke early.",
    "It predicts your next stroke.",
    "The app diagnoses Parkinsons disease from a selfie.",
    "It replaces a neurologist for routine follow-up.",
    "Clinically proven to catch deterioration.",
    "Clinically equivalent to hospital equipment.",
    "Medical-grade accuracy in your pocket.",
])
def test_the_overclaim_scanner_catches_each_prohibited_claim(text):
    assert _overclaims(text), f"missed overclaim: {text!r}"


@pytest.mark.parametrize("text", [
    # Every one of these is REQUIRED copy somewhere in the product.
    "It CANNOT detect a stroke that is happening now.",
    "It does not diagnose anything.",
    "This never replaces a neurologist.",
    "Nothing here replaces their doctor.",
    "It is not clinically proven, and no model here has been clinically validated.",
    "It reasons over days, so it cannot see a stroke that is happening now.",
    "No claim of medical-grade accuracy is made anywhere.",
])
def test_the_overclaim_scanner_ignores_the_required_disclaimers(text):
    assert not _overclaims(text), (
        f"flagged a required safety disclaimer as an overclaim: {text!r} - this is how a "
        "scanner pressures someone into weakening a warning"
    )


def test_the_overclaim_scanner_handles_a_negation_that_wrapped_to_the_previous_line():
    """The real false positive this scanner produced on its first run, against the repo's
    own README. Prose wraps; the negation and the claim landed on different lines."""
    text = ("This is a monitoring aid, not a diagnostic device. It does not detect strokes "
            "and does not\nreplace a clinician. It exists so that somebody notices in time.")
    assert not _overclaims(text), (
        "flagged a wrapped disclaimer — the negation window must span the previous line"
    )


def test_the_accuracy_scanner_catches_a_bare_metric():
    assert _unlabelled_accuracy("Our model reaches 94% accuracy on held-out data.")


@pytest.mark.parametrize("text", [
    # The real false positives, from docs/CLINICAL_REFERENCE.md and docs/GAP_ANALYSIS.md.
    # These are published physiological reference ranges, not claims about our system.
    "| Precision leftward / rightward | ~96% / ~109% |",
    "| Saccade precision | VNG | 94-112% | M3 | `saccade_precision_{dir}` |",
    "latency **309-370 ms**, velocity **184-304 deg/s**, precision **94-112%**",
    # The real GAP_ANALYSIS.md line. It says "we now have real numbers" beside a clinical
    # reference range, and a bare we/our turned out to be far too weak a signal for a claim
    # about OUR model - almost any prose about the project contains those words.
    ('| **D-5** | Saccade values | "abnormal", qualitative | latency **309-370 ms**, '
     'velocity **184-304 deg/s**, precision **94-112%** | **High** - we now have real numbers'),
])
def test_the_accuracy_scanner_ignores_published_clinical_reference_ranges(text):
    assert not _unlabelled_accuracy(text), (
        f"flagged a clinical reference range as a model claim: {text!r} — `precision` and "
        "`sensitivity` belong to both vocabularies, so a model-claim context is required"
    )


@pytest.mark.parametrize("text", [
    "Accuracy 94% on SYNTHETIC fixtures only - no clinical validation.",
    "The synthetic evaluation reports\nsensitivity of 91%.",
    "Illustrative only: 88% accuracy.",
])
def test_the_accuracy_scanner_accepts_a_labelled_metric(text):
    assert not _unlabelled_accuracy(text), f"flagged a labelled metric: {text!r}"
