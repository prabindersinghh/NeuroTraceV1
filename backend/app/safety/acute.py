"""Acute-symptom escalation — TRD §8.

The contract: a report of an acute symptom **bypasses every piece of clinical logic in
this system**. No baseline lookup, no deviation, no gates, no band, no explanation, no SLM.
It records the report and returns an escalation.

This is not a shortcut, it is the correct behaviour. Our engine reasons over days. Somebody
reporting sudden one-sided weakness right now needs an ambulance, not a z-score, and every
millisecond our pipeline spends computing one is a millisecond stolen from that.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .fast import fast_card

# Symptoms that mean "call an ambulance", not "log and monitor".
ACUTE_SYMPTOMS: dict[str, dict[str, str]] = {
    "sudden_weakness": {
        "en": "sudden weakness in the face, arm or leg",
        "hi": "चेहरे, बाँह या पैर में अचानक कमज़ोरी",
        "pa": "ਚਿਹਰੇ, ਬਾਂਹ ਜਾਂ ਲੱਤ ਵਿੱਚ ਅਚਾਨਕ ਕਮਜ਼ੋਰੀ",
    },
    "sudden_numbness": {
        "en": "sudden numbness on one side",
        "hi": "एक तरफ़ अचानक सुन्नपन",
        "pa": "ਇੱਕ ਪਾਸੇ ਅਚਾਨਕ ਸੁੰਨਪਨ",
    },
    "face_droop_new": {
        "en": "new drooping of the face",
        "hi": "चेहरे का नया लटकना",
        "pa": "ਚਿਹਰੇ ਦਾ ਨਵਾਂ ਲਟਕਣਾ",
    },
    "speech_loss_sudden": {
        "en": "sudden trouble speaking or understanding",
        "hi": "अचानक बोलने या समझने में दिक्कत",
        "pa": "ਅਚਾਨਕ ਬੋਲਣ ਜਾਂ ਸਮਝਣ ਵਿੱਚ ਦਿੱਕਤ",
    },
    "vision_loss_sudden": {
        "en": "sudden loss of vision",
        "hi": "अचानक दिखना बंद होना",
        "pa": "ਅਚਾਨਕ ਦਿਖਣਾ ਬੰਦ ਹੋਣਾ",
    },
    "worst_headache": {
        "en": "the worst headache of their life",
        "hi": "ज़िंदगी का सबसे तेज़ सिरदर्द",
        "pa": "ਜ਼ਿੰਦਗੀ ਦਾ ਸਭ ਤੋਂ ਤੇਜ਼ ਸਿਰਦਰਦ",
    },
    "loss_of_consciousness": {
        "en": "loss of consciousness",
        "hi": "बेहोशी",
        "pa": "ਬੇਹੋਸ਼ੀ",
    },
    "seizure": {"en": "a seizure", "hi": "दौरा", "pa": "ਦੌਰਾ"},
    "severe_imbalance_sudden": {
        "en": "sudden severe loss of balance",
        "hi": "अचानक संतुलन का गंभीर नुकसान",
        "pa": "ਅਚਾਨਕ ਸੰਤੁਲਨ ਦਾ ਗੰਭੀਰ ਨੁਕਸਾਨ",
    },
}

_ESCALATION_TEXT = {
    "en": ("Call an ambulance now on 108. Note the time these signs started and tell the "
           "operator. Do not drive yourself and do not wait to see if it passes."),
    "hi": ("अभी 108 पर एम्बुलेंस बुलाइए। ये लक्षण किस समय शुरू हुए, वह नोट कीजिए और ऑपरेटर को "
           "बताइए। खुद गाड़ी मत चलाइए और यह देखने के लिए इंतज़ार मत कीजिए कि ठीक हो जाएगा।"),
    "pa": ("ਹੁਣੇ 108 'ਤੇ ਐਂਬੂਲੈਂਸ ਬੁਲਾਓ। ਇਹ ਲੱਛਣ ਕਿਸ ਸਮੇਂ ਸ਼ੁਰੂ ਹੋਏ, ਉਹ ਨੋਟ ਕਰੋ ਅਤੇ ਆਪਰੇਟਰ ਨੂੰ "
           "ਦੱਸੋ। ਆਪ ਗੱਡੀ ਨਾ ਚਲਾਓ ਅਤੇ ਉਡੀਕ ਨਾ ਕਰੋ।"),
}


@dataclass(slots=True)
class EscalationResponse:
    escalate: bool = True
    scoring_bypassed: bool = True
    reported: list[str] = field(default_factory=list)
    reported_labels: list[str] = field(default_factory=list)
    message: str = ""
    fast: dict = field(default_factory=dict)
    emergency_number: str = "108"

    def to_json(self) -> dict:
        return {
            "escalate": self.escalate,
            "scoring_bypassed": self.scoring_bypassed,
            "reported": self.reported,
            "reported_labels": self.reported_labels,
            "message": self.message,
            "fast": self.fast,
            "emergency_number": self.emergency_number,
        }


def build_escalation(symptoms: list[str], lang: str = "en") -> EscalationResponse:
    """Turn a symptom report into an immediate escalation payload.

    Unknown symptom codes still escalate. If the caregiver ticked something we do not
    recognise, the safe reading is that something is wrong, not that nothing is.
    """
    lang = lang if lang in ("en", "hi", "pa") else "en"
    codes = [str(s) for s in (symptoms or [])]
    known = [c for c in codes if c in ACUTE_SYMPTOMS]

    return EscalationResponse(
        escalate=True,
        scoring_bypassed=True,
        reported=codes,
        reported_labels=[ACUTE_SYMPTOMS[c][lang] for c in known],
        message=_ESCALATION_TEXT[lang],
        fast=fast_card(lang),
    )


def is_acute(symptoms: list[str]) -> bool:
    return bool(set(symptoms or []) & set(ACUTE_SYMPTOMS))
