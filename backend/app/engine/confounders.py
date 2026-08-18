"""Confounder annotation — TRD §6.

Every alert carries the reasons it might be wrong. This is not hedging; it is what makes
the output usable by a clinician and honest to a family.

A neurologist reading "speech deviated for three sessions" will immediately ask: was he
ill? did he sleep? did the dose change? is he depressed? was the recording any good? was
it even him? If the system cannot answer those, the finding is noise wearing a lab coat.

So each confounder is attached to the score, printed on the alert, and lowers a stated
confidence value. None of them suppress the alert — suppression would hide real
deterioration behind a bad night's sleep. They qualify it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

# code -> (human label EN, label HI, confidence penalty)
CONFOUNDERS: dict[str, tuple[str, str, float]] = {
    "recent_illness": (
        "reported feeling unwell recently",
        "हाल ही में तबीयत ठीक न होने की जानकारी दी गई",
        0.25,
    ),
    "poor_sleep": (
        "reported sleeping poorly",
        "नींद ठीक से न आने की जानकारी दी गई",
        0.15,
    ),
    "medication_change": (
        "a medication change was recorded in this period",
        "इस अवधि में दवा में बदलाव दर्ज हुआ",
        0.25,
    ),
    "phq_change": (
        "mood score has shifted, which can slow speech and reactions on its own",
        "मनोदशा स्कोर बदला है, जिससे बोलने और प्रतिक्रिया की गति धीमी हो सकती है",
        0.20,
    ),
    "off_window_time": (
        "this session was taken well outside the usual time of day",
        "यह जाँच रोज़ के समय से काफ़ी अलग समय पर हुई",
        0.15,
    ),
    "low_quality_capture": (
        "capture quality was below the usual standard",
        "रिकॉर्डिंग की गुणवत्ता सामान्य से कम थी",
        0.30,
    ),
    "identity_uncertain": (
        "the face or voice did not clearly match the enrolled patient",
        "चेहरा या आवाज़ दर्ज मरीज़ से स्पष्ट रूप से मेल नहीं खाई",
        0.40,
    ),
    "baseline_short": (
        "the personal baseline is still close to its minimum length",
        "व्यक्तिगत आधार अभी न्यूनतम लंबाई के करीब है",
        0.20,
    ),
}

ILLNESS_LOOKBACK_DAYS = 7
MEDICATION_LOOKBACK_DAYS = 14
PHQ_DELTA_THRESHOLD = 2  # PHQ-2 shift that is worth annotating


@dataclass(slots=True)
class ConfounderContext:
    """Everything outside the exam itself that could explain a deviation."""

    session_ts: datetime
    quality_score: float = 1.0
    identity_verified: bool = True
    off_window: bool = False
    baseline_n_sessions: int = 99
    baseline_lock_at: int = 12
    recent_illness_ts: datetime | None = None
    medication_change_ts: datetime | None = None
    phq_current: int | None = None
    phq_baseline: int | None = None
    quality_floor: float = 0.6


@dataclass(slots=True)
class ConfounderReport:
    active: list[str] = field(default_factory=list)
    confidence: float = 1.0

    def to_json(self) -> dict:
        return {
            "active": self.active,
            "confidence": round(self.confidence, 3),
            "labels_en": [CONFOUNDERS[c][0] for c in self.active if c in CONFOUNDERS],
            "labels_hi": [CONFOUNDERS[c][1] for c in self.active if c in CONFOUNDERS],
        }


def detect_confounders(ctx: ConfounderContext) -> ConfounderReport:
    """Collect every active confounder and derive a confidence multiplier."""
    active: list[str] = []

    if ctx.quality_score < ctx.quality_floor:
        active.append("low_quality_capture")
    if not ctx.identity_verified:
        active.append("identity_uncertain")
    if ctx.off_window:
        active.append("off_window_time")

    if ctx.recent_illness_ts is not None:
        if ctx.session_ts - ctx.recent_illness_ts <= timedelta(days=ILLNESS_LOOKBACK_DAYS):
            active.append("recent_illness")

    if ctx.medication_change_ts is not None:
        if ctx.session_ts - ctx.medication_change_ts <= timedelta(days=MEDICATION_LOOKBACK_DAYS):
            active.append("medication_change")

    if ctx.phq_current is not None and ctx.phq_baseline is not None:
        if abs(ctx.phq_current - ctx.phq_baseline) >= PHQ_DELTA_THRESHOLD:
            active.append("phq_change")

    if ctx.baseline_n_sessions < ctx.baseline_lock_at + 3:
        active.append("baseline_short")

    confidence = 1.0
    for code in active:
        confidence *= (1.0 - CONFOUNDERS[code][2])

    return ConfounderReport(active=active, confidence=max(0.05, confidence))


def describe(codes: list[str], lang: str = "en") -> list[str]:
    idx = 0 if lang == "en" else 1
    return [CONFOUNDERS[c][idx] for c in codes if c in CONFOUNDERS]
