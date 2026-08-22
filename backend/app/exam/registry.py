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

from .vestibular import (
    CCG_BAD_DIRECTION,
    CCG_LATERAL_KEYS,
    CCG_SCORING_KEYS,
    OCULOMOTOR_BAD_DIRECTION,
    OCULOMOTOR_LATERAL_KEYS,
    OCULOMOTOR_SCORING_KEYS,
    SVV_BAD_DIRECTION,
    SVV_LATERAL_KEYS,
    SVV_SCORING_KEYS,
    extract_craniocorpography,
    extract_oculomotor,
    extract_svv,
)
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
# Dysarthria and aphasia were one domain. They are not one problem.
#
# Dysarthria is a MOTOR failure: the muscles that shape sound are weak or uncoordinated,
# and the message behind them is intact. Aphasia is a LANGUAGE failure: the message itself
# is damaged. They localise differently — dysarthria to the corticobulbar tracts, brainstem
# and cerebellum; aphasia to the dominant-hemisphere perisylvian cortex — and they carry
# different implications for what has changed and what to do about it.
#
# Keeping them together also quietly weakened Gate 2. Two modules in one domain can never
# corroborate each other, so a patient whose speech got slurrier AND whose word-finding got
# worse registered as a single domain moving. Split, that is two independent domains
# agreeing, which is exactly the evidence Gate 2 was built to look for.
DOMAIN_MOTOR_SPEECH = "motor_speech"
DOMAIN_LANGUAGE = "language"

# Posterior circulation — added when scope widened beyond anterior-circulation stroke.
#
# The case that forced it: an MRI-confirmed left cerebellar and bilateral occipital infarct
# whose finger-nose, heel-knee-shin, dysdiadochokinesia and joint-position were ALL NORMAL.
# M8 tests exactly those four things and would have found nothing. Every deficit the patient
# had was in balance and oculomotor function.
#
# Kept separate from coordination_gait deliberately. Limb ataxia and vestibular/oculomotor
# failure are different systems that fail independently, and folding them together would
# have meant this domain could never corroborate the other under Gate 2 — the same mistake
# that merged dysarthria and aphasia.
DOMAIN_POSTERIOR = "posterior_vestibular"
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
    # Features that express LEFT-RIGHT asymmetry rather than overall level.
    #
    # This is the discriminator between a focal lesion and a diffuse process. A stroke
    # damages one hemisphere and produces a one-sided deficit. Parkinson's disease produces
    # bradykinesia, hypophonia and masked facies *symmetrically* and *simultaneously* -
    # which, without this distinction, would trip three domains at once and generate our
    # highest-confidence ALERT for a condition we do not monitor and cannot help.
    #
    # A domain only counts toward Gate 2 when its deviation appears in these keys.
    # Empty tuple = the module has no laterality (speech, attention), and such a module can
    # never satisfy Gate 2 on its own. See `engine/gates.py`.
    lateral_keys: tuple[str, ...] = ()

    # Minimum screen this module needs to produce a valid measurement.
    #
    # "phone" runs anywhere. "tablet" means the task genuinely cannot be done on a 6-inch
    # screen held at arm's length: a nine-point gaze task needs the targets to subtend
    # enough visual angle to separate a real gaze limitation from a small saccade, and
    # line-bisection needs a line long enough that a few millimetres of neglect is
    # distinguishable from an unsteady hand. Offering them on a phone would produce numbers
    # that look like measurements and are not.
    #
    # "floor_space" means the patient has to walk, which needs a supervised setting and
    # someone to catch them.
    requires_device: str = "phone"

    # Per-TASK requirements, where a module can run partially.
    #
    # M9 is the case this exists for. Romberg and tandem stance are low-motion: the patient
    # stands still and a caregiver holds the phone, which a front camera handles. Tandem
    # WALKING and Unterberger stepping move the patient through space over 50 steps with
    # their eyes shut — that needs floor room, a steady frame, and someone positioned to
    # catch them.
    #
    # Gating the whole module on the hardest task meant TIER_1 patients got NO balance
    # measurement at all, which silently made the posterior-circulation widening inert for
    # everyone without an ASHA visit. Running the subset that works and saying plainly what
    # was skipped is the honest alternative.
    task_devices: dict[str, str] = field(default_factory=dict)

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
        # Masked facies reduces movement on BOTH sides, leaving these flat.
        lateral_keys=("mouth_corner_symmetry", "corner_drop", "nasolabial_ratio",
                      "forehead_movement_symmetry", "ear_asymmetry",
                      "eye_closure_asymmetry", "blink_asymmetry"),
        nihss_item=4, seconds=16,
        instructions_en="Smile widely. Now raise your eyebrows. Close your eyes tightly. Puff out your cheeks.",
        instructions_hi="खुलकर मुस्कुराइए। अब भौंहें ऊपर उठाइए। आँखें कसकर बंद कीजिए। गाल फुलाइए।",
    ),
    "M2": ExamModule(
        code="M2", name="Tongue and palate", domain=DOMAIN_CRANIAL, schedule=WEEKLY,
        tasks=("tongue_protrusion", "sustained_ahh"),
        extract=extract_tongue_palate,
        scoring_keys=tuple(TONGUE_SCORING_KEYS), bad_direction=TONGUE_BAD_DIRECTION,
        lateral_keys=("tongue_deviation_abs",),
        seconds=15,
        instructions_en="Stick your tongue straight out. Now say 'aaah' for as long as you can.",
        instructions_hi="जीभ सीधी बाहर निकालिए। अब जब तक हो सके 'आ' बोलिए।",
    ),
    "M3": ExamModule(
        code="M3", name="Eye movement", domain=DOMAIN_POSTERIOR, schedule=WEEKLY,
        # Promoted from monthly to weekly, and from tablet-only to phone. Saccade latency
        # and pursuit gain are among the few posterior-circulation signs that a front
        # camera can actually track, so gating them behind an ASHA visit meant the patients
        # who most need them were checked least often.
        requires_device="phone",
        tasks=("smooth_pursuit", "random_saccades"),
        extract=extract_oculomotor,
        scoring_keys=tuple(OCULOMOTOR_SCORING_KEYS),
        bad_direction=OCULOMOTOR_BAD_DIRECTION,
        lateral_keys=OCULOMOTOR_LATERAL_KEYS,
        seconds=45,
        instructions_en=("Follow the moving dot with your eyes, keeping your head still. "
                         "Then look at each dot as soon as it appears."),
        instructions_hi=("सिर स्थिर रखते हुए चलती हुई बिंदु को आँखों से देखिए। फिर जैसे ही "
                         "बिंदु दिखे, तुरंत उसे देखिए।"),
    ),

    # ---------------- DOMAIN B · speech and language ----------------
    "M4": ExamModule(
        code="M4", name="Speech clarity", domain=DOMAIN_MOTOR_SPEECH, schedule=DAILY,
        tasks=("sustained_a", "ddk", "sentence"),
        extract=extract_dysarthria,
        scoring_keys=tuple(DYSARTHRIA_SCORING_KEYS), bad_direction=DYSARTHRIA_BAD_DIRECTION,
        nihss_item=10, seconds=20,
        instructions_en="Say 'aaah' steadily for five seconds. Now repeat 'pa-ta-ka' as fast as you can. Now read this sentence aloud.",
        instructions_hi="पाँच सेकंड तक लगातार 'आ' बोलिए। अब जितनी तेज़ी से हो सके 'प-त-क' दोहराइए। अब यह वाक्य ज़ोर से पढ़िए।",
    ),
    "M5": ExamModule(
        code="M5", name="Language", domain=DOMAIN_LANGUAGE, schedule=WEEKLY,
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
        lateral_keys=("drift_asymmetry", "pronation_asymmetry"),
        nihss_item=5, seconds=15,
        instructions_en="Hold both arms out in front of you, palms facing up. Close your eyes and hold.",
        instructions_hi="दोनों हाथ सामने फैलाइए, हथेलियाँ ऊपर की ओर। आँखें बंद कीजिए और ऐसे ही रखिए।",
    ),
    "M7": ExamModule(
        code="M7", name="Hand speed", domain=DOMAIN_MOTOR, schedule=DAILY,
        tasks=("tap_left", "tap_right", "drag_target"),
        extract=extract_fine_motor,
        scoring_keys=tuple(FINE_MOTOR_SCORING_KEYS), bad_direction=FINE_MOTOR_BAD_DIRECTION,
        # Bradykinesia slows both hands, so the ratio between them barely moves.
        lateral_keys=("tap_asymmetry_ratio", "tap_cv_asymmetry"),
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
        code="M9", name="Balance and stepping", domain=DOMAIN_POSTERIOR, schedule=WEEKLY,
        tasks=("romberg_eyes_open", "romberg_eyes_closed", "tandem_stance",
               "tandem_walk", "unterberger"),
        extract=extract_craniocorpography,
        scoring_keys=tuple(CCG_SCORING_KEYS), bad_direction=CCG_BAD_DIRECTION,
        lateral_keys=CCG_LATERAL_KEYS,
        # Runs on a phone, partially. A caregiver films the standing tasks; the walking and
        # stepping tasks need floor room and someone to catch a fall, so they are deferred
        # to an ASHA visit and reported as deferred rather than dropped.
        requires_device="phone",
        task_devices={
            # Eyes open, normal stance: safe to do with the phone propped.
            "romberg_eyes_open": "phone",
            # Eyes CLOSED, and a narrowed base. Low-motion for the camera, but the patient
            # is being deliberately destabilised, so someone has to be holding the phone
            # and within reach. "Caregiver-filmed" and "phone-propped" are not the same
            # capability and collapsing them put a fall risk on the base tier.
            "romberg_eyes_closed": "caregiver",
            "tandem_stance": "caregiver",

            # ---------------------------------------------------------------------
            # THESE TWO CARRY THE DIRECTION OF DEVIATION. DO NOT DROP THEM.
            #
            # Every one of M9's `lateral_keys` comes from these two tasks — the
            # Unterberger and tandem-walk angular deviation and lateral displacement.
            # They are what make `posterior_vestibular` a LATERALISED domain, and
            # laterality is what lets it satisfy Gate 3.
            #
            # So losing them does not merely reduce coverage. It silently converts the
            # posterior domain into one that can never establish a focal finding, which
            # un-does the core mechanism of the posterior-circulation amendment for the
            # patients it exists to serve. It has nearly happened once already: making
            # this module phone-runnable removed it from module-level deferral and took
            # these two tasks off the ASHA worker's visit list with it.
            #
            # If a tier cannot run them, they must be DEFERRED and surfaced — never
            # dropped, and never quietly absent. See `visit_workload_for_tier` and
            # INV-10.
            # ---------------------------------------------------------------------
            "tandem_walk": "floor_space",
            "unterberger": "floor_space",
        },
        seconds=180,
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
        lateral_keys=("omission_asymmetry", "bisection_deviation_abs"),
        requires_device="tablet",
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
    "M21": ExamModule(
        code="M21", name="Sense of upright", domain=DOMAIN_POSTERIOR, schedule=MONTHLY,
        tasks=("svv_static", "svv_dynamic_cw", "svv_dynamic_acw"),
        extract=extract_svv,
        scoring_keys=tuple(SVV_SCORING_KEYS), bad_direction=SVV_BAD_DIRECTION,
        lateral_keys=SVV_LATERAL_KEYS,
        # A line on a screen and a rotating background — no extra hardware. But the
        # rotating field can make someone who already has vertigo feel sick, so a carer
        # should be present and the task must be abortable at any moment.
        requires_device="caregiver",
        task_devices={
            "svv_static": "phone",
            "svv_dynamic_cw": "caregiver",
            "svv_dynamic_acw": "caregiver",
        },
        seconds=180,
        instructions_en=("A line will appear. Turn the dial until it looks perfectly "
                         "upright to you, then tap to confirm. Stop any time you feel "
                         "unwell."),
        instructions_hi=("एक रेखा दिखाई देगी। जब तक वह आपको बिल्कुल सीधी न लगे, डायल घुमाइए, "
                         "फिर पुष्टि कीजिए। तबीयत ठीक न लगे तो कभी भी रोक दीजिए।"),
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


def lateral_keys(code: str) -> list[str]:
    return list(get_module(code).lateral_keys)


# --- deployment tiers (PRD §3) ---
#
# What a tier grants is *capability*, not permission. A module appears when the hardware to
# run it validly is present, and not before.
TIER_CAPABILITIES: dict[str, frozenset[str]] = {
    # "caregiver" is present at every tier: this product is caregiver-mediated by design —
    # enrolment requires one, and they are who reads the result. It is a distinct capability
    # from "phone" because a propped phone and a held phone are not the same thing when the
    # patient is about to close their eyes and narrow their base.
    "TIER_1_PHONE": frozenset({"phone", "caregiver"}),
    "TIER_2_WATCH": frozenset({"phone", "caregiver"}),  # a watch is passive data, not a screen
    "TIER_3_ASHA": frozenset({"phone", "caregiver", "tablet", "floor_space"}),
}


def modules_for_tier(schedule: str, tier: str) -> list[str]:
    """Module codes for a schedule that this tier can actually run.

    A TIER_1 patient's monthly battery is genuinely shorter than a TIER_3 patient's. That
    is the honest outcome: the deep-assessment modules need a tablet and a supervised
    setting, so they are routed to an ASHA visit or a clinic device rather than silently
    degraded onto a phone.
    """
    have = TIER_CAPABILITIES.get(tier, TIER_CAPABILITIES["TIER_1_PHONE"])
    return [
        code for code, module in MODULES.items()
        if module.schedule == schedule and module.requires_device in have
    ]


#: Tasks that must never run unsupervised, whatever hardware is present.
#:
#: These deliberately make the patient unsteady — eyes shut, narrow base, fifty steps on the
#: spot — so someone has to be within arm's reach. "Runs on a phone" is a statement about
#: the camera, not about whether it is safe to do alone, and nothing else in the tier model
#: distinguishes the two. Without this, marking `unterberger: "phone"` would be a one-word
#: change that reads as a convenience improvement and asks an 82-year-old with a cerebellar
#: infarct to close their eyes and march on the spot with nobody there.
SUPERVISED_TASKS: frozenset[str] = frozenset({
    "unterberger",
    "tandem_walk",
    "tandem_stance",
    "romberg_eyes_closed",
    "timed_up_and_go",
    "standing_sway",
})

#: Devices that imply a person is present. "phone" does not — a caregiver may be holding it
#: or it may be propped on a shelf, and we cannot tell which.
#: Devices that imply a person is present and within reach.
#:
#: "phone" is NOT one of them — it may be propped on a shelf and we cannot tell. "caregiver"
#: means someone is holding it, which is the supervision these tasks actually need; a clinic
#: is not required, only a person.
SUPERVISED_DEVICES: frozenset[str] = frozenset({"caregiver", "floor_space"})


def tasks_for_tier(code: str, tier: str) -> list[str]:
    """The tasks within one module that this tier can actually run.

    A module with no `task_devices` is all-or-nothing and returns all its tasks.
    """
    module = get_module(code)
    have = TIER_CAPABILITIES.get(tier, TIER_CAPABILITIES["TIER_1_PHONE"])
    if not module.task_devices:
        return list(module.tasks)
    return [t for t in module.tasks
            if module.task_devices.get(t, module.requires_device) in have]


def tasks_deferred_for_tier(code: str, tier: str) -> list[str]:
    """Tasks this tier cannot run — surfaced so a partial capture is never mistaken for a
    complete one."""
    module = get_module(code)
    runnable = set(tasks_for_tier(code, tier))
    return [t for t in module.tasks if t not in runnable]


def visit_workload_for_tier(tier: str) -> dict[str, list[str]]:
    """Everything an ASHA visit needs to cover, as {module_code: [tasks]}.

    Module-level deferral is no longer sufficient, and getting this wrong has already
    happened twice. First, `modules_deferred_for_tier` was asked only about the MONTHLY
    battery, so weekly M9 never reached the worker's list. Then M9 was made phone-runnable
    for its low-motion subset, which removed it from module-level deferral entirely — and
    the walking and stepping tests that STILL need someone present became invisible again.

    A module belongs on the visit list when the tier cannot run it at all, OR when it can
    run only part of it. Returning the task list makes the second case actionable: the
    worker is told to do the two tests the family cannot do alone, not to repeat the three
    they already did this week.
    """
    have = TIER_CAPABILITIES.get(tier, TIER_CAPABILITIES["TIER_1_PHONE"])
    out: dict[str, list[str]] = {}
    for code, module in MODULES.items():
        if module.task_devices:
            deferred = tasks_deferred_for_tier(code, tier)
            if deferred:
                out[code] = deferred
        elif module.requires_device not in have:
            out[code] = list(module.tasks)
    return out


def modules_deferred_for_tier(schedule: str | None, tier: str) -> list[str]:
    """Modules the tier cannot run — shown as deferred, not hidden, so a clinician can see
    what is missing and why.

    `schedule=None` spans every schedule. That is the form an ASHA visit needs: the modules
    a patient cannot do at home are not confined to the monthly battery. M9 balance is
    WEEKLY and needs floor space and a carer, so asking only about monthly modules left the
    single most important module for a posterior-circulation patient off the visit list
    entirely.
    """
    have = TIER_CAPABILITIES.get(tier, TIER_CAPABILITIES["TIER_1_PHONE"])
    return [
        code for code, module in MODULES.items()
        if (schedule is None or module.schedule == schedule)
        and module.requires_device not in have
    ]


#: Modules whose deviation can establish that a change is one-sided.
LATERALISABLE_MODULES = tuple(c for c, m in MODULES.items() if m.lateral_keys)


DAILY_MODULES = tuple(m.code for m in modules_for(DAILY))
WEEKLY_MODULES = tuple(m.code for m in modules_for(WEEKLY))
MONTHLY_MODULES = tuple(m.code for m in modules_for(MONTHLY))
