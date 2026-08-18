"""Safety layer and SLM guardrails — TRD §7, §8, §10.

These are the tests the build brief calls non-negotiable. Two of them encode rules that,
if broken, would make the product dangerous rather than merely wrong:

* nothing may assert wellness, and
* the SLM may never disagree with the deterministic engine.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.safety.acute import ACUTE_SYMPTOMS, build_escalation, is_acute
from app.safety.fast import FAST_CARD, fast_card
from app.safety.guards import (
    DIAGNOSTIC_TERMS,
    WELLNESS_ASSERTIONS,
    SafetyViolation,
    assert_no_wellness_assertion,
    contains_forbidden,
    scrub,
)
from app.slm.guardrail import ON_DEVICE_NOTICE, explain, validate_generation
from app.slm.prompt import SLMInput, build_prompt, build_slm_input
from app.slm.templates import render_clinician_line, render_template

APP_DIR = Path(__file__).resolve().parents[1] / "app"
LANGS = ("en", "hi", "pa")


# --------------------------------------------------------------------------- FAST card
@pytest.mark.parametrize("lang", LANGS)
def test_fast_card_renders_in_every_language(lang):
    card = fast_card(lang)
    assert card["title"]
    assert [i["letter"] for i in card["items"]] == ["F", "A", "S", "T"]
    assert all(i["label"] and i["detail"] for i in card["items"])
    assert card["limitation_notice"]
    assert any(n["number"] == "108" for n in card["emergency_numbers"])


def test_fast_card_falls_back_to_english_for_an_unknown_language():
    assert fast_card("zz") == fast_card("en")


def test_fast_card_states_what_the_system_cannot_do():
    """The honest limit has to be on the card, not buried in onboarding."""
    notice = fast_card("en")["limitation_notice"].lower()
    assert "cannot" in notice
    assert "days" in notice


# --------------------------------------------------------------------------- acute bypass
def test_acute_report_bypasses_scoring_entirely():
    escalation = build_escalation(["sudden_weakness"], "en")
    assert escalation.escalate is True
    assert escalation.scoring_bypassed is True
    assert "108" in escalation.message
    assert escalation.fast["items"]


def test_unknown_symptoms_still_escalate():
    """If the caregiver ticked something we do not recognise, we escalate anyway."""
    escalation = build_escalation(["something_we_never_coded"], "en")
    assert escalation.escalate is True
    assert escalation.scoring_bypassed is True


@pytest.mark.parametrize("lang", LANGS)
def test_escalation_message_exists_in_every_language(lang):
    escalation = build_escalation(["face_droop_new"], lang)
    assert escalation.message
    assert escalation.reported_labels


def test_is_acute_only_fires_on_acute_codes():
    assert is_acute(["seizure"]) is True
    assert is_acute(["mild_tiredness"]) is False
    assert is_acute([]) is False


def test_every_acute_symptom_is_translated():
    for code, labels in ACUTE_SYMPTOMS.items():
        for lang in LANGS:
            assert labels.get(lang), f"{code} missing {lang}"


# --------------------------------------------------------------------------- forbidden language
@pytest.mark.parametrize("phrase", WELLNESS_ASSERTIONS)
def test_every_wellness_assertion_is_caught(phrase):
    assert contains_forbidden(f"Good news. {phrase}. See you tomorrow.")


@pytest.mark.parametrize("term", DIAGNOSTIC_TERMS)
def test_every_diagnostic_term_is_caught(term):
    assert contains_forbidden(f"This looks like a {term} to me")


def test_technical_stroke_tokens_are_exempt():
    """`stroke_date` is a column name, not user-facing copy."""
    assert contains_forbidden("stroke_date is required") == []
    assert contains_forbidden("post-stroke follow-up") == []


def test_assert_raises_with_a_useful_message():
    with pytest.raises(SafetyViolation, match="forbidden language"):
        assert_no_wellness_assertion("You are fine, nothing to worry about.")
    assert_no_wellness_assertion("Pauses while speaking were longer than usual.")


def test_localised_wellness_assertions_are_caught():
    assert contains_forbidden("आप ठीक हैं")
    assert contains_forbidden("ਸਭ ਠੀਕ ਹੈ")


def test_scrub_removes_forbidden_phrases():
    assert "you are fine" not in scrub("Relax, you are fine today.").lower()


# --------------------------------------------------------------------------- the bundle sweep
def test_no_user_facing_string_in_the_app_asserts_wellness():
    """Greps the shipped Python for wellness assertions (TRD §8, session rule 2).

    Exactly one file is excluded, and only because its job is to *define* the banned list:
    `safety/guards.py`. Everything else — every template, every FAST string, every router
    response — is swept. `slm/prompt.py` is deliberately NOT excluded: it is checked and
    passes, because its instructions are phrased as prohibitions without quoting the
    forbidden wording, which is what keeps this sweep meaningful.
    """
    excluded = {"guards.py"}
    offenders: list[str] = []

    for path in APP_DIR.rglob("*.py"):
        if path.name in excluded:
            continue
        text = path.read_text(encoding="utf-8")
        for phrase in WELLNESS_ASSERTIONS:
            # Only flag phrases inside string literals — comments are fine.
            for match in re.finditer(r'"([^"\\]*(?:\\.[^"\\]*)*)"', text):
                if phrase in match.group(1).lower():
                    offenders.append(f"{path.name}: {phrase!r}")
    assert offenders == [], f"wellness assertions found: {offenders}"


# --------------------------------------------------------------------------- templates
@pytest.mark.parametrize("band", ["STABLE", "WATCH", "ALERT"])
@pytest.mark.parametrize("lang", LANGS)
def test_template_always_renders_and_never_breaches_the_contract(band, lang):
    text = render_template(band, drivers=[("pause_ratio", 3.0)],
                           confounders=["poor_sleep"], lang=lang)
    assert text
    assert contains_forbidden(text) == []


def test_stable_template_does_not_claim_the_patient_is_well():
    text = render_template("STABLE", lang="en").lower()
    assert "usual pattern" in text
    assert "fine" not in text and "healthy" not in text and "normal" not in text


def test_baseline_phase_template_explains_why_there_is_no_verdict():
    text = render_template("STABLE", lang="en", baseline_phase=True).lower()
    assert "still learning" in text


def test_alert_template_names_what_changed():
    text = render_template("ALERT", drivers=[("pause_ratio", 4.0),
                                             ("tap_asymmetry_ratio", 3.0)],
                           lang="en", sustained=True)
    assert "pauses while speaking" in text
    assert "one hand tapped" in text
    assert "doctor" in text


def test_clinician_line_never_gives_a_bare_number():
    line = render_clinician_line("ALERT", ["speech_language", "motor"], 3, ["poor_sleep"])
    assert "this patient's own median/MAD baseline" in line
    assert "3 consecutive sessions" in line
    assert "poor_sleep" in line


# --------------------------------------------------------------------------- SLM guardrail
def _payload(band="ALERT", lang="en") -> SLMInput:
    return build_slm_input(band, [("pause_ratio", 4.0), ("tap_asymmetry_ratio", 3.0)],
                           ["poor_sleep"], lang, sustained=True)


def test_the_model_never_receives_a_number():
    """TRD §7: the SLM is given a verdict to phrase, never a measurement to reason about.

    Asserted as "no digit anywhere in either prompt" rather than "none of today's specific
    values appear". The stricter form is the one that keeps holding when someone later adds
    a field to SLMInput without reading this file.
    """
    payload = _payload()
    system, user = build_prompt(payload)
    for name, text in (("system", system), ("user", user)):
        assert not re.search(r"\d", text), f"{name} prompt leaked a number: {text}"


def test_the_model_input_contains_only_the_permitted_fields():
    payload = _payload()
    assert set(payload.to_json()) == {
        "band", "drivers", "driver_keys", "confounders", "language",
        "baseline_phase", "improving", "sustained",
    }


def test_generation_that_contradicts_the_band_is_rejected():
    result = validate_generation(
        "Everything was the same as always today.", _payload("ALERT")
    )
    assert result.passed is False
    assert result.source == "template"
    assert any("band contradiction" in v for v in result.violations)


def test_generation_that_urges_action_on_a_stable_band_is_rejected():
    result = validate_generation("Please contact their doctor immediately.",
                                 _payload("STABLE"))
    assert result.passed is False
    assert result.source == "template"


def test_generation_asserting_wellness_is_rejected():
    result = validate_generation("Good news, you are fine today.", _payload("STABLE"))
    assert result.passed is False
    assert any("forbidden" in v for v in result.violations)


def test_generation_naming_a_disease_is_rejected():
    result = validate_generation("This may indicate a stroke.", _payload("ALERT"))
    assert result.passed is False


def test_generation_inventing_a_number_is_rejected():
    result = validate_generation("Their speech was 23% slower than usual.",
                                 _payload("ALERT"))
    assert result.passed is False
    assert any("fabricated number" in v for v in result.violations)


def test_emergency_numbers_are_not_treated_as_fabricated():
    result = validate_generation("Please call 108 if anything changes suddenly.",
                                 _payload("ALERT"))
    assert "fabricated number in output" not in result.violations


def test_overlong_generation_is_rejected():
    result = validate_generation("One. Two. Three. Four. Five. Six.", _payload("ALERT"))
    assert result.passed is False
    assert any("too many sentences" in v for v in result.violations)


def test_empty_generation_falls_back():
    result = validate_generation("", _payload("ALERT"))
    assert result.passed is False
    assert result.text          # ...but there is always usable text


def test_a_clean_generation_is_accepted():
    result = validate_generation(
        "Please check on them today. Their speech and hand movement have both changed "
        "over more than one day.", _payload("ALERT"))
    assert result.passed is True
    assert result.source == "slm"


def test_a_crashing_model_degrades_to_the_template():
    def boom(_system, _user):
        raise RuntimeError("model failed to load")

    result = explain(_payload("ALERT"), generate=boom)
    assert result.source == "template"
    assert result.text
    assert any("generation failed" in v for v in result.violations)


def test_no_model_available_still_produces_an_explanation():
    result = explain(_payload("WATCH"), generate=None)
    assert result.source == "template"
    assert result.text
    assert contains_forbidden(result.text) == []


def test_the_fallback_renders_in_the_requested_language():
    hindi = explain(_payload("ALERT", "hi"), generate=None)
    english = explain(_payload("ALERT", "en"), generate=None)
    assert hindi.text != english.text
    assert "आज उनका हाल" in hindi.text


@pytest.mark.parametrize("lang", LANGS)
def test_on_device_notice_exists_in_every_language(lang):
    assert ON_DEVICE_NOTICE[lang]
    assert "device" in ON_DEVICE_NOTICE["en"]
