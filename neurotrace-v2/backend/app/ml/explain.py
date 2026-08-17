"""
NeuroTrace — explainability. Turns z-scores into sentences a family understands,
in English and Hindi. No black box: every alert names its top drivers.
"""
from __future__ import annotations

# feature -> (direction_that_is_bad, english, hindi)
TEMPLATES = {
    # voice
    "pause_ratio":            ("up",   "pauses while speaking are longer than usual",
                                       "बोलते समय रुकावट सामान्य से ज़्यादा है"),
    "n_pauses_per_sec":       ("up",   "speech is breaking up more often",
                                       "बोलने में ज़्यादा बार रुकावट आ रही है"),
    "articulation_rate":      ("down", "speech is slower than usual",
                                       "बोलने की गति सामान्य से धीमी है"),
    "jitter_local":           ("up",   "the voice is less steady than usual",
                                       "आवाज़ पहले से कम स्थिर है"),
    "shimmer_local":          ("up",   "the voice sounds more strained",
                                       "आवाज़ में ज़्यादा खिंचाव महसूस हो रहा है"),
    "hnr":                    ("down", "the voice sounds more breathy",
                                       "आवाज़ में साँस की आवाज़ बढ़ी है"),
    "f0_cv":                  ("up",   "pitch is more variable than usual",
                                       "आवाज़ का सुर सामान्य से ज़्यादा बदल रहा है"),
    # face
    "mouth_symmetry_mean":    ("up",   "the smile is less even on both sides",
                                       "मुस्कान दोनों तरफ़ बराबर नहीं है"),
    "corner_drop_mean":       ("up",   "one corner of the mouth sits lower",
                                       "मुँह का एक कोना नीचे की ओर है"),
    "eye_asymmetry_mean":     ("up",   "the eyes are opening unevenly",
                                       "आँखें बराबर नहीं खुल रही हैं"),
    "brow_asymmetry_mean":    ("up",   "the eyebrows are moving unevenly",
                                       "भौंहें बराबर नहीं हिल रही हैं"),
    "landmark_tremor":        ("up",   "small facial tremor has increased",
                                       "चेहरे में हल्की कंपन बढ़ी है"),
    "blink_rate_per_frame":   ("down", "blinking has reduced",
                                       "पलक झपकना कम हो गया है"),
    # reaction
    "rt_median":              ("up",   "reactions are slower than usual",
                                       "प्रतिक्रिया सामान्य से धीमी है"),
    "rt_cov":                 ("up",   "reaction speed is less consistent",
                                       "प्रतिक्रिया की गति में अस्थिरता है"),
    "lapse_rate":             ("up",   "more attention lapses during the test",
                                       "जाँच के दौरान ध्यान ज़्यादा भटका"),
    "attention_decay_slope":  ("up",   "tiring faster during the test",
                                       "जाँच के दौरान जल्दी थकान दिख रही है"),
    "miss_rate":              ("up",   "more missed taps than usual",
                                       "सामान्य से ज़्यादा टैप छूटे"),
}

def top_drivers(all_z: dict, k: int = 3) -> list[tuple[str, float]]:
    """all_z: merged {feature: z} across modalities. Keep only meaningful direction."""
    scored = []
    for feat, z in all_z.items():
        tpl = TEMPLATES.get(feat)
        if not tpl:
            continue
        direction = tpl[0]
        if (direction == "up" and z > 0) or (direction == "down" and z < 0):
            scored.append((feat, abs(float(z))))
    scored.sort(key=lambda x: -x[1])
    return scored[:k]

def explain(all_z: dict, band: str, lang: str = "en", k: int = 3) -> str:
    drivers = top_drivers(all_z, k)
    idx = 1 if lang == "en" else 2

    if band == "STABLE" or not drivers:
        return ("Everything looks normal today — no meaningful change from the usual pattern."
                if lang == "en" else
                "आज सब कुछ सामान्य है — रोज़ के पैटर्न से कोई ख़ास बदलाव नहीं है।")

    phrases = [TEMPLATES[f][idx] for f, _ in drivers]
    if lang == "en":
        joined = phrases[0] if len(phrases) == 1 else \
                 ", ".join(phrases[:-1]) + " and " + phrases[-1]
        if band == "WATCH":
            return (f"Worth keeping an eye on: {joined}. This is a small change — "
                    f"we'll keep monitoring and only alert if it continues.")
        return (f"Please check on them today: {joined}. These changes have continued "
                f"for several days across more than one signal.")
    else:
        joined = phrases[0] if len(phrases) == 1 else \
                 ", ".join(phrases[:-1]) + " और " + phrases[-1]
        if band == "WATCH":
            return (f"ध्यान देने योग्य: {joined}। यह छोटा बदलाव है — हम निगरानी जारी रखेंगे।")
        return (f"आज उनका हाल ज़रूर देखें: {joined}। ये बदलाव कई दिनों से "
                f"एक से ज़्यादा संकेतों में लगातार दिख रहे हैं।")
