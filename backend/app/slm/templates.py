"""Deterministic explanation templates — the guaranteed path.

Every band, in every supported language, renders here without a model. The SLM is an
enhancement layered on top; if it fails to load, times out, or breaches a guardrail, this
is what the family sees, and it is always correct because it is derived directly from the
engine's own output.

Feature phrasing is observational by construction: "pauses while speaking were longer than
usual" describes what was measured. It does not say why, and it does not name a disease.
"""
from __future__ import annotations

# feature key -> (direction that is clinically worse, en, hi, pa)
DRIVER_PHRASES: dict[str, tuple[str, str, str, str]] = {
    # --- speech (M4) ---
    "pause_ratio": ("up", "pauses while speaking were longer than usual",
                    "बोलते समय रुकावट सामान्य से ज़्यादा रही",
                    "ਬੋਲਦੇ ਸਮੇਂ ਰੁਕਾਵਟ ਆਮ ਨਾਲੋਂ ਵੱਧ ਰਹੀ"),
    "n_pauses_per_sec": ("up", "speech broke up more often than usual",
                         "बोलने में सामान्य से ज़्यादा बार रुकावट आई",
                         "ਬੋਲਣ ਵਿੱਚ ਆਮ ਨਾਲੋਂ ਵੱਧ ਵਾਰ ਰੁਕਾਵਟ ਆਈ"),
    "articulation_rate": ("down", "speech was slower than usual",
                          "बोलने की गति सामान्य से धीमी रही",
                          "ਬੋਲਣ ਦੀ ਗਤੀ ਆਮ ਨਾਲੋਂ ਹੌਲੀ ਰਹੀ"),
    "jitter_local": ("up", "the voice was less steady than usual",
                     "आवाज़ पहले से कम स्थिर रही",
                     "ਆਵਾਜ਼ ਪਹਿਲਾਂ ਨਾਲੋਂ ਘੱਟ ਸਥਿਰ ਰਹੀ"),
    "shimmer_local": ("up", "the voice sounded more strained",
                      "आवाज़ में ज़्यादा खिंचाव महसूस हुआ",
                      "ਆਵਾਜ਼ ਵਿੱਚ ਵੱਧ ਖਿਚਾਅ ਮਹਿਸੂਸ ਹੋਇਆ"),
    "hnr": ("down", "the voice sounded more breathy",
            "आवाज़ में साँस की आवाज़ बढ़ी",
            "ਆਵਾਜ਼ ਵਿੱਚ ਸਾਹ ਦੀ ਆਵਾਜ਼ ਵਧੀ"),
    "max_phonation_time": ("down", "they could hold a sound for less time than usual",
                           "वे सामान्य से कम समय तक आवाज़ बनाए रख सके",
                           "ਉਹ ਆਮ ਨਾਲੋਂ ਘੱਟ ਸਮੇਂ ਤੱਕ ਆਵਾਜ਼ ਕਾਇਮ ਰੱਖ ਸਕੇ"),
    "ddk_rate": ("down", "repeating syllables quickly was harder than usual",
                 "जल्दी-जल्दी अक्षर दोहराना सामान्य से कठिन रहा",
                 "ਜਲਦੀ-ਜਲਦੀ ਅੱਖਰ ਦੁਹਰਾਉਣਾ ਆਮ ਨਾਲੋਂ ਔਖਾ ਰਿਹਾ"),
    "ddk_regularity": ("up", "the rhythm of repeated syllables was less even",
                       "दोहराए गए अक्षरों की लय कम एकसमान रही",
                       "ਦੁਹਰਾਏ ਅੱਖਰਾਂ ਦੀ ਲੈਅ ਘੱਟ ਇਕਸਾਰ ਰਹੀ"),
    "f0_cv": ("up", "the pitch of the voice varied more than usual",
              "आवाज़ का सुर सामान्य से ज़्यादा बदला",
              "ਆਵਾਜ਼ ਦਾ ਸੁਰ ਆਮ ਨਾਲੋਂ ਵੱਧ ਬਦਲਿਆ"),

    # --- face (M1) ---
    "mouth_corner_symmetry": ("up", "the smile was less even on the two sides",
                              "मुस्कान दोनों तरफ़ बराबर नहीं रही",
                              "ਮੁਸਕਾਨ ਦੋਵੇਂ ਪਾਸੇ ਬਰਾਬਰ ਨਹੀਂ ਰਹੀ"),
    "corner_drop": ("up", "one corner of the mouth sat lower than the other",
                    "मुँह का एक कोना दूसरे से नीचे रहा",
                    "ਮੂੰਹ ਦਾ ਇੱਕ ਕੋਨਾ ਦੂਜੇ ਤੋਂ ਹੇਠਾਂ ਰਿਹਾ"),
    "nasolabial_ratio": ("up", "the fold beside the nose was less even on the two sides",
                         "नाक के पास की रेखा दोनों तरफ़ बराबर नहीं रही",
                         "ਨੱਕ ਕੋਲ ਦੀ ਰੇਖਾ ਦੋਵੇਂ ਪਾਸੇ ਬਰਾਬਰ ਨਹੀਂ ਰਹੀ"),
    "forehead_movement_symmetry": ("up", "the eyebrows lifted unevenly",
                                   "भौंहें बराबर नहीं उठीं",
                                   "ਭਰਵੱਟੇ ਬਰਾਬਰ ਨਹੀਂ ਉੱਠੇ"),
    "ear_asymmetry": ("up", "the eyes opened unevenly",
                      "आँखें बराबर नहीं खुलीं",
                      "ਅੱਖਾਂ ਬਰਾਬਰ ਨਹੀਂ ਖੁੱਲ੍ਹੀਆਂ"),
    "eye_closure_asymmetry": ("up", "one eye closed less fully than the other",
                              "एक आँख दूसरी से कम बंद हुई",
                              "ਇੱਕ ਅੱਖ ਦੂਜੀ ਨਾਲੋਂ ਘੱਟ ਬੰਦ ਹੋਈ"),
    "landmark_tremor": ("up", "there was more fine movement in the face than usual",
                        "चेहरे में सामान्य से ज़्यादा हल्की कंपन रही",
                        "ਚਿਹਰੇ ਵਿੱਚ ਆਮ ਨਾਲੋਂ ਵੱਧ ਹਲਕੀ ਕੰਬਣੀ ਰਹੀ"),

    # --- motor (M6, M7) ---
    "tap_asymmetry_ratio": ("up", "one hand tapped noticeably slower than the other",
                            "एक हाथ दूसरे से साफ़ तौर पर धीमा रहा",
                            "ਇੱਕ ਹੱਥ ਦੂਜੇ ਨਾਲੋਂ ਸਾਫ਼ ਤੌਰ 'ਤੇ ਹੌਲੀ ਰਿਹਾ"),
    "tap_rate_L": ("down", "the left hand was slower than usual",
                   "बायाँ हाथ सामान्य से धीमा रहा",
                   "ਖੱਬਾ ਹੱਥ ਆਮ ਨਾਲੋਂ ਹੌਲੀ ਰਿਹਾ"),
    "tap_rate_R": ("down", "the right hand was slower than usual",
                   "दायाँ हाथ सामान्य से धीमा रहा",
                   "ਸੱਜਾ ਹੱਥ ਆਮ ਨਾਲੋਂ ਹੌਲੀ ਰਿਹਾ"),
    "inter_tap_cv_L": ("up", "the left hand tapped less evenly",
                       "बाएँ हाथ की गति कम एकसमान रही",
                       "ਖੱਬੇ ਹੱਥ ਦੀ ਗਤੀ ਘੱਟ ਇਕਸਾਰ ਰਹੀ"),
    "inter_tap_cv_R": ("up", "the right hand tapped less evenly",
                       "दाएँ हाथ की गति कम एकसमान रही",
                       "ਸੱਜੇ ਹੱਥ ਦੀ ਗਤੀ ਘੱਟ ਇਕਸਾਰ ਰਹੀ"),
    "drift_asymmetry": ("up", "one arm drifted downward more than the other",
                        "एक बाँह दूसरी से ज़्यादा नीचे आई",
                        "ਇੱਕ ਬਾਂਹ ਦੂਜੀ ਨਾਲੋਂ ਵੱਧ ਹੇਠਾਂ ਆਈ"),

    # --- cognition (M10, M11) ---
    "rt_cov": ("up", "reaction speed was less consistent than usual",
               "प्रतिक्रिया की गति सामान्य से कम स्थिर रही",
               "ਪ੍ਰਤੀਕਿਰਿਆ ਦੀ ਗਤੀ ਆਮ ਨਾਲੋਂ ਘੱਟ ਸਥਿਰ ਰਹੀ"),
    "rt_median": ("up", "reactions were slower than usual",
                  "प्रतिक्रिया सामान्य से धीमी रही",
                  "ਪ੍ਰਤੀਕਿਰਿਆ ਆਮ ਨਾਲੋਂ ਹੌਲੀ ਰਹੀ"),
    "lapse_rate": ("up", "attention wandered more during the test",
                   "जाँच के दौरान ध्यान ज़्यादा भटका",
                   "ਜਾਂਚ ਦੌਰਾਨ ਧਿਆਨ ਵੱਧ ਭਟਕਿਆ"),
    "attention_decay_slope": ("up", "they tired more quickly during the test",
                              "जाँच के दौरान जल्दी थकान दिखी",
                              "ਜਾਂਚ ਦੌਰਾਨ ਜਲਦੀ ਥਕਾਵਟ ਦਿਖੀ"),
    "recall_delayed": ("down", "recalling the words later was harder than usual",
                       "बाद में शब्द याद करना सामान्य से कठिन रहा",
                       "ਬਾਅਦ ਵਿੱਚ ਸ਼ਬਦ ਯਾਦ ਕਰਨਾ ਆਮ ਨਾਲੋਂ ਔਖਾ ਰਿਹਾ"),
    "naming_accuracy": ("down", "naming everyday objects was harder than usual",
                        "रोज़ की चीज़ों के नाम बताना सामान्य से कठिन रहा",
                        "ਰੋਜ਼ ਦੀਆਂ ਚੀਜ਼ਾਂ ਦੇ ਨਾਂ ਦੱਸਣਾ ਆਮ ਨਾਲੋਂ ਔਖਾ ਰਿਹਾ"),
    "word_finding_latency": ("up", "finding words took longer than usual",
                             "शब्द खोजने में सामान्य से ज़्यादा समय लगा",
                             "ਸ਼ਬਦ ਲੱਭਣ ਵਿੱਚ ਆਮ ਨਾਲੋਂ ਵੱਧ ਸਮਾਂ ਲੱਗਾ"),

    # --- mood (M13) ---
    "phq2_score": ("up", "their mood score was lower than usual",
                   "उनका मनोदशा स्कोर सामान्य से कम रहा",
                   "ਉਹਨਾਂ ਦਾ ਮਨੋਦਸ਼ਾ ਸਕੋਰ ਆਮ ਨਾਲੋਂ ਘੱਟ ਰਿਹਾ"),

    # --- vitals (M17) ---
    "rr_irregularity_index": ("up", "the heartbeat was less regular during the reading",
                              "रीडिंग के दौरान दिल की धड़कन कम नियमित रही",
                              "ਰੀਡਿੰਗ ਦੌਰਾਨ ਦਿਲ ਦੀ ਧੜਕਣ ਘੱਟ ਨਿਯਮਤ ਰਹੀ"),
}

_LANG_INDEX = {"en": 1, "hi": 2, "pa": 3}

_OPENING = {
    "STABLE": {
        "en": "Today's check-in looked much like their usual pattern.",
        "hi": "आज की जाँच उनके रोज़ के पैटर्न जैसी ही रही।",
        "pa": "ਅੱਜ ਦੀ ਜਾਂਚ ਉਹਨਾਂ ਦੇ ਰੋਜ਼ ਦੇ ਪੈਟਰਨ ਵਰਗੀ ਹੀ ਰਹੀ।",
    },
    "WATCH": {
        "en": "Something looked a little different today, and it is worth keeping an eye on.",
        "hi": "आज कुछ थोड़ा अलग दिखा, इस पर नज़र रखना ठीक रहेगा।",
        "pa": "ਅੱਜ ਕੁਝ ਥੋੜ੍ਹਾ ਵੱਖਰਾ ਦਿਖਿਆ, ਇਸ 'ਤੇ ਨਜ਼ਰ ਰੱਖਣੀ ਠੀਕ ਰਹੇਗੀ।",
    },
    "ALERT": {
        "en": "Please check on them today and consider contacting their doctor.",
        "hi": "आज उनका हाल ज़रूर देखें और उनके डॉक्टर से संपर्क करने पर विचार करें।",
        "pa": "ਅੱਜ ਉਹਨਾਂ ਦਾ ਹਾਲ ਜ਼ਰੂਰ ਦੇਖੋ ਅਤੇ ਉਹਨਾਂ ਦੇ ਡਾਕਟਰ ਨਾਲ ਸੰਪਰਕ ਕਰਨ ਬਾਰੇ ਸੋਚੋ।",
    },
}

_SUSTAINED = {
    "en": "These changes have shown up across more than one kind of check, on more than one day.",
    "hi": "ये बदलाव एक से ज़्यादा तरह की जाँच में, एक से ज़्यादा दिन दिखे हैं।",
    "pa": "ਇਹ ਤਬਦੀਲੀਆਂ ਇੱਕ ਤੋਂ ਵੱਧ ਕਿਸਮ ਦੀ ਜਾਂਚ ਵਿੱਚ, ਇੱਕ ਤੋਂ ਵੱਧ ਦਿਨ ਦਿਖੀਆਂ ਹਨ।",
}

_UNSUSTAINED = {
    "en": "This is a small change so far. We will keep watching and will only raise it again if it continues.",
    "hi": "अभी यह छोटा बदलाव है। हम नज़र रखते रहेंगे और जारी रहने पर ही दोबारा बताएँगे।",
    "pa": "ਹਾਲੇ ਇਹ ਛੋਟੀ ਤਬਦੀਲੀ ਹੈ। ਅਸੀਂ ਨਜ਼ਰ ਰੱਖਾਂਗੇ ਅਤੇ ਜਾਰੀ ਰਹਿਣ 'ਤੇ ਹੀ ਦੁਬਾਰਾ ਦੱਸਾਂਗੇ।",
}

_BASELINE_PHASE = {
    "en": "We are still learning what is usual for them, so today's check-in was recorded but not compared yet.",
    "hi": "हम अभी सीख रहे हैं कि उनके लिए सामान्य क्या है, इसलिए आज की जाँच दर्ज हुई पर तुलना नहीं की गई।",
    "pa": "ਅਸੀਂ ਹਾਲੇ ਸਿੱਖ ਰਹੇ ਹਾਂ ਕਿ ਉਹਨਾਂ ਲਈ ਆਮ ਕੀ ਹੈ, ਇਸ ਲਈ ਅੱਜ ਦੀ ਜਾਂਚ ਦਰਜ ਹੋਈ ਪਰ ਤੁਲਨਾ ਨਹੀਂ ਕੀਤੀ ਗਈ।",
}

_IMPROVING = {
    "en": "The changes we can see are in the direction of improvement.",
    "hi": "जो बदलाव दिख रहे हैं वे सुधार की दिशा में हैं।",
    "pa": "ਜੋ ਤਬਦੀਲੀਆਂ ਦਿਖ ਰਹੀਆਂ ਹਨ ਉਹ ਸੁਧਾਰ ਦੀ ਦਿਸ਼ਾ ਵਿੱਚ ਹਨ।",
}

_CONFOUNDER_LEAD = {
    "en": "Bear in mind: ",
    "hi": "ध्यान रखें: ",
    "pa": "ਧਿਆਨ ਰੱਖੋ: ",
}

_JOIN = {"en": " and ", "hi": " और ", "pa": " ਅਤੇ "}
# Devanagari and Gurmukhi end a sentence with a danda, not a full stop.
_STOP = {"en": ".", "hi": "।", "pa": "।"}


def phrase_for(feature: str, lang: str = "en") -> str | None:
    entry = DRIVER_PHRASES.get(feature)
    if entry is None:
        return None
    return entry[_LANG_INDEX.get(lang, 1)]


def render_template(
    band: str,
    drivers: list[tuple[str, float]] | None = None,
    confounders: list[str] | None = None,
    lang: str = "en",
    *,
    baseline_phase: bool = False,
    improving: bool = False,
    sustained: bool = False,
) -> str:
    """The deterministic caregiver explanation. Always renders, never fails."""
    lang = lang if lang in _LANG_INDEX else "en"
    band = band if band in _OPENING else "STABLE"

    if baseline_phase:
        return _BASELINE_PHASE[lang]

    parts = [_OPENING[band][lang]]

    phrases = [p for p in (phrase_for(f, lang) for f, _ in (drivers or [])) if p]
    if phrases and band != "STABLE":
        joined = phrases[0] if len(phrases) == 1 else \
            ", ".join(phrases[:-1]) + _JOIN[lang] + phrases[-1]
        lead = {"en": "What changed: ", "hi": "क्या बदला: ", "pa": "ਕੀ ਬਦਲਿਆ: "}[lang]
        parts.append(f"{lead}{joined}{_STOP[lang]}")

    if improving:
        parts.append(_IMPROVING[lang])
    elif band == "ALERT":
        parts.append(_SUSTAINED[lang] if sustained else _UNSUSTAINED[lang])
    elif band == "WATCH":
        parts.append(_UNSUSTAINED[lang])

    if confounders:
        from ..engine.confounders import describe
        labels = describe(confounders, "en" if lang == "en" else "hi")
        if labels:
            joined = labels[0] if len(labels) == 1 else \
                ", ".join(labels[:-1]) + _JOIN[lang] + labels[-1]
            parts.append(f"{_CONFOUNDER_LEAD[lang]}{joined}{_STOP[lang]}")

    return " ".join(parts)


def render_clinician_line(band: str, domains: list[str], sessions: int,
                          confounders: list[str] | None = None) -> str:
    """One line for the clinician view. Never a bare number — always the comparison."""
    if band == "STABLE":
        return f"Within this patient's own baseline across {sessions} recent session(s)."
    domain_text = ", ".join(domains) if domains else "one domain"
    line = (f"{len(domains) or 1} domain(s) ({domain_text}) deviating beyond RCI across "
            f"{sessions} consecutive sessions, measured against this patient's own "
            f"median/MAD baseline.")
    if confounders:
        line += f" Confounders active: {', '.join(confounders)}."
    return line
