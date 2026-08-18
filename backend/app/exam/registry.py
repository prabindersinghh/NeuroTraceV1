"""The exam module registry — TRD §4.

One table describing all twenty modules: which domain they belong to (which is what Gate 2
counts), what they extract, which features are scored, which direction is clinically worse,
and how often they run.

Scheduling is not arbitrary. The daily battery is the six modules that (a) change fastest
when something is going wrong and (b) can be completed in ninety seconds by a 68-year-old
with a residual hemiparesis. Everything else is weekly or monthly, because a battery that
takes twenty minutes is a battery nobody completes, and an incomplete battery detects
nothing.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .cognition import (
    ATTENTION_BAD_DIRECTION, ATTENTION_SCORING_KEYS,
    MEMORY_BAD_DIRECTION, MEMORY_SCORING_KEYS,
    NEGLECT_BAD_DIRECTION, NEGLECT_SCORING_KEYS,
    OCULAR_BAD_DIRECTION, OCULAR_SCORING_KEYS,
    extract_attention_speed, extract_memory_executive, extract_neglect, extract_ocular,
)
from .coordination import (
    COORDINATION_BAD_DIRECTION, COORDINATION_SCORING_KEYS,
    GAIT_BAD_DIRECTION, GAIT_SCORING_KEYS,
    extract_coordination, extract_gait_balance,
)
from .facial import FACIAL_BAD_DIRECTION, FACIAL_SCORING_KEYS, extract_facial_motor
from .language import APHASIA_BAD_DIRECTION, APHASIA_SCORING_KEYS, extract_aphasia
from .motor import (
    FINE_MOTOR_BAD_DIRECTION, FINE_MOTOR_SCORING_KEYS,
    PRONATOR_BAD_DIRECTION, PRONATOR_SCORING_KEYS,
    extract_fine_motor, extract_pronator_drift,
)
from .questionnaires import (
    DYSPHAGIA_BAD_DIRECTION, DYSPHAGIA_SCORING_KEYS,
    FATIGUE_BAD_DIRECTION, FATIGUE_SCORING_KEYS,
    FUNCTION_BAD_DIRECTION, FUNCTION_SCORING_KEYS,
    MOOD_BAD_DIRECTION, MOOD_SCORING_KEYS,
    score_instrument,
)
from .speech_tasks import (
    DYSARTHRIA_BAD_DIRECTION, DYSARTHRIA_SCORING_KEYS,
    TONGUE_BAD_DIRECTION, TONGUE_SCORING_KEYS,
    extract_dysarthria, extract_tongue_palate,
)
from .vitals import (
    ADHERENCE_BAD_DIRECTION, ADHERENCE_SCORING_KEYS,
    BP_BAD_DIRECTION, BP_SCORING_KEYS,
    RHYTHM_BAD_DIRECTION, RHYTHM_SCORING_KEYS,
    SYMPTOM_BAD_DIRECTION, SYMPTOM_SCORING_KEYS,
    extract_adherence, extract_blood_pressure, extract_rhythm, extract_symptom_log,
)

DAILY, WEEKLY, MONTHLY, ANY = "daily", "weekly", "monthly", "any"

# Domains from TRD §4 — Gate 2 requires two of THESE to agree.
DOMAIN_CRANIAL = "cranial_nerves"
DOMAIN_SPEECH = "speech_language"
DOMAIN_MOTOR = "motor"
DOMAIN_COORDINATION = "coordination_gait"
DOMAIN_COGNITION = "cognition"
DOMAIN_MOOD = "mood_fatigue_function"
DOMAIN_VITALS = "vitals_prevention"


def _questionnaire(instrument: str) -> Callable[[dict], dict]:
    def extract(raw: dict) -> dict:
        return score_instrument(instrument, raw.get("responses"))
    return extract


@dataclass(frozen=True, slots=True)
class ExamModule:
    code: str
    name: str
    domain: str
    schedule: str
    tasks: tuple[str, ...]
    extract: Callable[[dict], dict]
    scoring_keys: tuple[str, ...] = ()
    bad_direction: dict[str, str] = field(default_factory=dict)
    nihss_item: int | None = None
    instructions_en: str = ""
    instructions_hi: str = ""
    seconds: int = 10
    # Whether this module's deviation may drive Gate 1/Gate 2.
    #
    # False for the validated questionnaires and for adherence. Two reasons:
    #
    # 1. You do not z-score a PHQ-2. These instruments ship with published cut-offs
    #    derived from large validation cohorts; comparing a 0-6 integer to a personal
    #    median throws that away and replaces it with something weaker.
    # 2. A module with one or two features has no internal averaging, so its
    #    mean|z| IS a single z-score and will cross threshold by chance in roughly one
    #    session in twenty. Gate 2 treats domains as independent corroboration — a domain
    #    that flags at random is not corroboration, it is noise wearing a second hat.
    #
    # These modules are still captured, stored, trended and shown. Mood additionally
    # feeds the confounder layer, which is where a PHQ shift belongs: it explains other
    # domains rather than competing with them.
    gates_alerts: bool = True

    @property
    def scored(self) -> bool:
        """Some modules are recorded for context but never drive a band on their own."""
        return bool(self.scoring_keys)


MODULES: dict[str, ExamModule] = {
    # ---------------- DOMAIN A · cranial nerves ----------------
    "M1": ExamModule(
        code="M1", name="Facial movement", domain=DOMAIN_CRANIAL, schedule=DAILY,
        tasks=("smile", "forehead_raise", "eye_closure", "cheek_puff"),
        extract=extract_facial_motor,
        scoring_keys=tuple(FACIAL_SCORING_KEYS), bad_direction=FACIAL_BAD_DIRECTION,
        nihss_item=4, seconds=16,
        instructions_en="Smile widely. Now raise your eyebrows. Close your eyes tightly. Puff out your cheeks.",
        instructions_hi="खुलकर मुस्कुराइए। अब भौंहें ऊपर उठाइए। आँखें कसकर बंद कीजिए। गाल फुलाइए।",
    ),
    "M2": ExamModule(
        code="M2", name="Tongue and palate", domain=DOMAIN_CRANIAL, schedule=WEEKLY,
        tasks=("tongue_protrusion", "sustained_ahh"),
        extract=extract_tongue_palate,
        scoring_keys=tuple(TONGUE_SCORING_KEYS), bad_direction=TONGUE_BAD_DIRECTION,
        seconds=15,
        instructions_en="Stick your tongue straight out. Now say 'aaah' for as long as you can.",
        instructions_hi="जीभ सीधी बाहर निकालिए। अब जब तक हो सके 'आ' बोलिए।",
    ),
    "M3": ExamModule(
        code="M3", name="Eye movement", domain=DOMAIN_CRANIAL, schedule=MONTHLY,
        tasks=("smooth_pursuit", "visual_fields"),
        extract=extract_ocular,
        scoring_keys=tuple(OCULAR_SCORING_KEYS), bad_direction=OCULAR_BAD_DIRECTION,
        seconds=30,
        instructions_en="Follow the moving dot with your eyes, keeping your head still.",
        instructions_hi="सिर स्थिर रखते हुए चलती हुई बिंदु को आँखों से देखिए।",
    ),

    # ---------------- DOMAIN B · speech and language ----------------
    "M4": ExamModule(
        code="M4", name="Speech clarity", domain=DOMAIN_SPEECH, schedule=DAILY,
        tasks=("sustained_a", "ddk", "sentence"),
        extract=extract_dysarthria,
        scoring_keys=tuple(DYSARTHRIA_SCORING_KEYS), bad_direction=DYSARTHRIA_BAD_DIRECTION,
        nihss_item=10, seconds=20,
        instructions_en="Say 'aaah' steadily for five seconds. Now repeat 'pa-ta-ka' as fast as you can. Now read this sentence aloud.",
        instructions_hi="पाँच सेकंड तक लगातार 'आ' बोलिए। अब जितनी तेज़ी से हो सके 'प-त-क' दोहराइए। अब यह वाक्य ज़ोर से पढ़िए।",
    ),
    "M5": ExamModule(
        code="M5", name="Language", domain=DOMAIN_SPEECH, schedule=WEEKLY,
        tasks=("picture_description", "naming", "repetition", "comprehension", "fluency"),
        extract=extract_aphasia,
        scoring_keys=tuple(APHASIA_SCORING_KEYS), bad_direction=APHASIA_BAD_DIRECTION,
        nihss_item=9, seconds=180,
        instructions_en="Tell me everything you see in this picture.",
        instructions_hi="इस तस्वीर में आप जो कुछ देख रहे हैं, सब बताइए।",
    ),

    # ---------------- DOMAIN C · motor ----------------
    "M6": ExamModule(
        code="M6", name="Arm strength", domain=DOMAIN_MOTOR, schedule=WEEKLY,
        tasks=("pronator_drift",),
        extract=extract_pronator_drift,
        scoring_keys=tuple(PRONATOR_SCORING_KEYS), bad_direction=PRONATOR_BAD_DIRECTION,
        nihss_item=5, seconds=15,
        instructions_en="Hold both arms out in front of you, palms facing up. Close your eyes and hold.",
        instructions_hi="दोनों हाथ सामने फैलाइए, हथेलियाँ ऊपर की ओर। आँखें बंद कीजिए और ऐसे ही रखिए।",
    ),
    "M7": ExamModule(
        code="M7", name="Hand speed", domain=DOMAIN_MOTOR, schedule=DAILY,
        tasks=("tap_left", "tap_right", "drag_target"),
        extract=extract_fine_motor,
        scoring_keys=tuple(FINE_MOTOR_SCORING_KEYS), bad_direction=FINE_MOTOR_BAD_DIRECTION,
        seconds=22,
        instructions_en="Tap the circle as fast as you can with your left hand. Now your right hand.",
        instructions_hi="बाएँ हाथ से जितनी तेज़ी से हो सके गोले को दबाइए। अब दाएँ हाथ से।",
    ),

    # ---------------- DOMAIN D · coordination and gait ----------------
    "M8": ExamModule(
        code="M8", name="Coordination", domain=DOMAIN_COORDINATION, schedule=WEEKLY,
        tasks=("finger_to_nose", "rapid_alternating"),
        extract=extract_coordination,
        scoring_keys=tuple(COORDINATION_SCORING_KEYS), bad_direction=COORDINATION_BAD_DIRECTION,
        nihss_item=7, seconds=30,
        instructions_en="Touch your nose, then touch the dot on the screen. Repeat five times.",
        instructions_hi="अपनी नाक छुइए, फिर स्क्रीन पर बनी बिंदु को छुइए। पाँच बार दोहराइए।",
    ),
    "M9": ExamModule(
        code="M9", name="Walking and balance", domain=DOMAIN_COORDINATION, schedule=MONTHLY,
        tasks=("timed_up_and_go", "standing_sway"),
        extract=extract_gait_balance,
        scoring_keys=tuple(GAIT_SCORING_KEYS), bad_direction=GAIT_BAD_DIRECTION,
        seconds=60,
        instructions_en="Put the phone in your pocket. Stand up, walk three metres, turn, come back and sit down.",
        instructions_hi="फ़ोन जेब में रखिए। खड़े होइए, तीन मीटर चलिए, मुड़िए, वापस आइए और बैठ जाइए।",
    ),

    # ---------------- DOMAIN E · cognition ----------------
    "M10": ExamModule(
        code="M10", name="Attention and speed", domain=DOMAIN_COGNITION, schedule=DAILY,
        tasks=("simple_rt", "choice_rt", "trail_making_a"),
        extract=extract_attention_speed,
        scoring_keys=tuple(ATTENTION_SCORING_KEYS), bad_direction=ATTENTION_BAD_DIRECTION,
        seconds=20,
        instructions_en="Tap the circle the moment it turns blue. As fast as you can.",
        instructions_hi="जैसे ही गोला नीला हो, तुरंत दबाइए। जितनी तेज़ी से हो सके।",
    ),
    "M11": ExamModule(
        code="M11", name="Memory and planning", domain=DOMAIN_COGNITION, schedule=WEEKLY,
        tasks=("word_recall", "digit_span", "trail_making_b", "clock_drawing"),
        extract=extract_memory_executive,
        scoring_keys=tuple(MEMORY_SCORING_KEYS), bad_direction=MEMORY_BAD_DIRECTION,
        seconds=180,
        instructions_en="Remember these five words. I will ask for them again later.",
        instructions_hi="ये पाँच शब्द याद रखिए। मैं बाद में फिर पूछूँगा।",
    ),
    "M12": ExamModule(
        code="M12", name="Visual attention", domain=DOMAIN_COGNITION, schedule=MONTHLY,
        tasks=("line_bisection", "star_cancellation"),
        extract=extract_neglect,
        scoring_keys=tuple(NEGLECT_SCORING_KEYS), bad_direction=NEGLECT_BAD_DIRECTION,
        nihss_item=11, seconds=60,
        instructions_en="Mark the middle of each line. Then tap every star you can find.",
        instructions_hi="हर रेखा के बीच में निशान लगाइए। फिर जितने तारे दिखें, सब दबाइए।",
    ),

    # ---------------- DOMAIN F · mood, fatigue, function ----------------
    "M13": ExamModule(
        code="M13", gates_alerts=False, name="Mood", domain=DOMAIN_MOOD, schedule=DAILY,
        tasks=("phq2",), extract=_questionnaire("PHQ2"),
        scoring_keys=tuple(MOOD_SCORING_KEYS), bad_direction=MOOD_BAD_DIRECTION,
        seconds=8,
        instructions_en="Over the last two weeks, how often have you felt little interest or pleasure in doing things?",
        instructions_hi="पिछले दो हफ़्तों में, कितनी बार आपको किसी काम में मन नहीं लगा?",
    ),
    "M14": ExamModule(
        code="M14", gates_alerts=False, name="Fatigue", domain=DOMAIN_MOOD, schedule=WEEKLY,
        tasks=("fss",), extract=_questionnaire("FSS"),
        scoring_keys=tuple(FATIGUE_SCORING_KEYS), bad_direction=FATIGUE_BAD_DIRECTION,
        seconds=60,
        instructions_en="How much has tiredness affected you this week?",
        instructions_hi="इस हफ़्ते थकान ने आपको कितना प्रभावित किया?",
    ),
    "M15": ExamModule(
        code="M15", gates_alerts=False, name="Daily function", domain=DOMAIN_MOOD, schedule=MONTHLY,
        tasks=("barthel",), extract=_questionnaire("BARTHEL"),
        scoring_keys=tuple(FUNCTION_SCORING_KEYS), bad_direction=FUNCTION_BAD_DIRECTION,
        seconds=120,
        instructions_en="How much help does he or she need with everyday activities?",
        instructions_hi="रोज़मर्रा के कामों में उन्हें कितनी मदद चाहिए?",
    ),
    "M16": ExamModule(
        code="M16", gates_alerts=False, name="Swallowing", domain=DOMAIN_MOOD, schedule=MONTHLY,
        tasks=("eat10",), extract=_questionnaire("EAT10"),
        scoring_keys=tuple(DYSPHAGIA_SCORING_KEYS), bad_direction=DYSPHAGIA_BAD_DIRECTION,
        seconds=90,
        instructions_en="Does swallowing cause you any difficulty?",
        instructions_hi="क्या निगलने में आपको कोई कठिनाई होती है?",
    ),

    # ---------------- DOMAIN G · vitals and secondary prevention ----------------
    "M17": ExamModule(
        code="M17", name="Heart rhythm", domain=DOMAIN_VITALS, schedule=WEEKLY,
        tasks=("ppg_60s",), extract=extract_rhythm,
        scoring_keys=tuple(RHYTHM_SCORING_KEYS), bad_direction=RHYTHM_BAD_DIRECTION,
        seconds=60,
        instructions_en="Cover the camera and the light with your fingertip. Hold still.",
        instructions_hi="उँगली से कैमरा और लाइट को ढकिए। हिलिए मत।",
    ),
    "M18": ExamModule(
        code="M18", name="Blood pressure", domain=DOMAIN_VITALS, schedule=WEEKLY,
        tasks=("bp_entry",), extract=extract_blood_pressure,
        scoring_keys=tuple(BP_SCORING_KEYS), bad_direction=BP_BAD_DIRECTION,
        seconds=30,
        instructions_en="Enter today's blood pressure reading.",
        instructions_hi="आज का रक्तचाप दर्ज कीजिए।",
    ),
    "M19": ExamModule(
        code="M19", gates_alerts=False, name="Medication", domain=DOMAIN_VITALS, schedule=DAILY,
        tasks=("adherence",), extract=extract_adherence,
        scoring_keys=tuple(ADHERENCE_SCORING_KEYS), bad_direction=ADHERENCE_BAD_DIRECTION,
        seconds=4,
        instructions_en="Did you take today's medicines?",
        instructions_hi="क्या आपने आज की दवाइयाँ ली?",
    ),
    "M20": ExamModule(
        code="M20", gates_alerts=False, name="Symptoms", domain=DOMAIN_VITALS, schedule=ANY,
        tasks=("symptom_log",), extract=extract_symptom_log,
        scoring_keys=tuple(SYMPTOM_SCORING_KEYS), bad_direction=SYMPTOM_BAD_DIRECTION,
        seconds=30,
        instructions_en="Has anything new or different happened?",
        instructions_hi="क्या कुछ नया या अलग हुआ है?",
    ),
}


def modules_for(schedule: str) -> list[ExamModule]:
    """The battery for a given session type, in the order it should be presented."""
    return [m for m in MODULES.values() if m.schedule == schedule]


def get_module(code: str) -> ExamModule:
    module = MODULES.get(code.upper())
    if module is None:
        raise KeyError(f"unknown exam module {code!r}")
    return module


DAILY_BUDGET_SECONDS = 90  # PRD §7: the whole daily session on a low-end Android phone


def daily_battery_seconds() -> int:
    """Total capture time for the daily battery.

    Instructions are spoken *while* each capture runs, so these are capture seconds,
    not capture-plus-instruction. `test_exam_modules.py` asserts the total stays
    within DAILY_BUDGET_SECONDS — a battery that overruns is a battery patients
    abandon, and an abandoned battery detects nothing.
    """
    return sum(m.seconds for m in modules_for(DAILY))


def scoring_keys(code: str) -> list[str]:
    return list(get_module(code).scoring_keys)


def bad_direction(code: str) -> dict[str, str]:
    return dict(get_module(code).bad_direction)


DAILY_MODULES = tuple(m.code for m in modules_for(DAILY))
WEEKLY_MODULES = tuple(m.code for m in modules_for(WEEKLY))
MONTHLY_MODULES = tuple(m.code for m in modules_for(MONTHLY))
