"""The FAST card — rendered at the end of every session and on every dashboard.

FAST is the internationally standardised public stroke-recognition mnemonic. It is here
because the honest limit of this product is that it monitors *slow* change and cannot see
an acute event. The family therefore needs the acute signs in front of them every single
day, independent of anything we computed.

Hindi and Punjabi are first-class, not translations bolted on: the target population is
Tier-2/3 Punjab, and an emergency instruction nobody can read is not an instruction.
"""
from __future__ import annotations

FAST_CARD: dict = {
    "title": {
        "en": "Call for help immediately if you see any of these",
        "hi": "इनमें से कुछ भी दिखे तो तुरंत मदद बुलाएँ",
        "pa": "ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੁਝ ਵੀ ਦਿਖੇ ਤਾਂ ਤੁਰੰਤ ਮਦਦ ਬੁਲਾਓ",
    },
    "items": [
        {
            "letter": "F",
            "en": {"label": "Face", "detail": "One side of the face suddenly droops when they smile."},
            "hi": {"label": "चेहरा", "detail": "मुस्कुराने पर चेहरे का एक हिस्सा अचानक लटक जाए।"},
            "pa": {"label": "ਚਿਹਰਾ", "detail": "ਮੁਸਕਰਾਉਣ 'ਤੇ ਚਿਹਰੇ ਦਾ ਇੱਕ ਪਾਸਾ ਅਚਾਨਕ ਲਟਕ ਜਾਵੇ।"},
        },
        {
            "letter": "A",
            "en": {"label": "Arms", "detail": "One arm drifts down when both are raised."},
            "hi": {"label": "बाँहें", "detail": "दोनों बाँहें उठाने पर एक बाँह नीचे गिरने लगे।"},
            "pa": {"label": "ਬਾਂਹਾਂ", "detail": "ਦੋਵੇਂ ਬਾਂਹਾਂ ਚੁੱਕਣ 'ਤੇ ਇੱਕ ਬਾਂਹ ਹੇਠਾਂ ਡਿੱਗਣ ਲੱਗੇ।"},
        },
        {
            "letter": "S",
            "en": {"label": "Speech", "detail": "Speech is suddenly slurred, or they cannot find words."},
            "hi": {"label": "बोली", "detail": "बोली अचानक लड़खड़ाने लगे, या शब्द न मिलें।"},
            "pa": {"label": "ਬੋਲੀ", "detail": "ਬੋਲੀ ਅਚਾਨਕ ਲੜਖੜਾਏ, ਜਾਂ ਸ਼ਬਦ ਨਾ ਲੱਭਣ।"},
        },
        {
            "letter": "T",
            "en": {"label": "Time", "detail": "Note the time and call emergency services now. Do not wait."},
            "hi": {"label": "समय", "detail": "समय नोट कीजिए और अभी आपातकालीन सेवा को फ़ोन कीजिए। इंतज़ार मत कीजिए।"},
            "pa": {"label": "ਸਮਾਂ", "detail": "ਸਮਾਂ ਨੋਟ ਕਰੋ ਅਤੇ ਹੁਣੇ ਐਮਰਜੈਂਸੀ ਸੇਵਾ ਨੂੰ ਫ਼ੋਨ ਕਰੋ। ਉਡੀਕ ਨਾ ਕਰੋ।"},
        },
    ],
    "emergency_numbers": [
        {"label": "Ambulance (India)", "number": "108"},
        {"label": "National emergency", "number": "112"},
    ],
    "limitation_notice": {
        "en": ("This app watches for slow changes over days. It cannot detect a stroke as "
               "it happens. Always use the signs above."),
        "hi": ("यह ऐप कई दिनों में होने वाले धीमे बदलावों पर नज़र रखता है। यह होते हुए स्ट्रोक "
               "को नहीं पकड़ सकता। हमेशा ऊपर दिए संकेतों का उपयोग करें।"),
        "pa": ("ਇਹ ਐਪ ਕਈ ਦਿਨਾਂ ਵਿੱਚ ਹੋਣ ਵਾਲੀਆਂ ਹੌਲੀ ਤਬਦੀਲੀਆਂ 'ਤੇ ਨਜ਼ਰ ਰੱਖਦਾ ਹੈ। ਇਹ ਹੁੰਦੇ ਹੋਏ "
               "ਸਟ੍ਰੋਕ ਨੂੰ ਨਹੀਂ ਫੜ ਸਕਦਾ। ਹਮੇਸ਼ਾ ਉੱਪਰ ਦਿੱਤੇ ਸੰਕੇਤ ਵਰਤੋ।"),
    },
}


def fast_card(lang: str = "en") -> dict:
    """The FAST payload for one language, with a safe fallback to English."""
    lang = lang if lang in ("en", "hi", "pa") else "en"
    return {
        "title": FAST_CARD["title"][lang],
        "items": [
            {"letter": item["letter"], **item[lang]} for item in FAST_CARD["items"]
        ],
        "emergency_numbers": FAST_CARD["emergency_numbers"],
        "limitation_notice": FAST_CARD["limitation_notice"][lang],
    }
