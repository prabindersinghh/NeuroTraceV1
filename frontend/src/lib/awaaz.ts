import type {
  AwaazBoard,
  AwaazCardCreatePayload,
  AwaazSpeakPayload,
  Lang,
} from "./types";

/** Build a bounded personal-board request; blank whitespace never reaches the API. */
export function personalPhrasePayload(
  text: string,
  lang: Lang,
): AwaazCardCreatePayload | null {
  const phrase = text.trim();
  if (!phrase) return null;
  return { text: phrase, lang, category: "personal" };
}

/** Build the second half of the INV-9 handshake after the person taps a candidate. */
export function confirmedCandidatePayload(
  text: string,
  lang: Lang,
  confidence = 0,
): AwaazSpeakPayload {
  return {
    text: text.trim(),
    lang,
    confidence,
    confirmed_candidate: true,
  };
}

/** Default 12 phrases mapped across EN, HI, and PA. */
export const DEFAULT_PHRASES: Record<number, Record<Lang, string>> = {
  0: { en: "I need help", hi: "मुझे मदद चाहिए", pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ" },
  1: { en: "Water", hi: "पानी", pa: "ਪਾਣੀ" },
  2: { en: "Toilet", hi: "शौचालय", pa: "ਪਖਾਨਾ" },
  3: { en: "I am in pain", hi: "मुझे दर्द है", pa: "ਮੈਨੂੰ ਦਰਦ ਹੈ" },
  4: { en: "Call my son", hi: "मेरे बेटे को बुलाओ", pa: "ਮੇਰੇ ਪੁੱਤਰ ਨੂੰ ਬੁਲਾਓ" },
  5: { en: "Call my daughter", hi: "मेरी बेटी को बुलाओ", pa: "ਮੇਰੀ ਧੀ ਨੂੰ ਬੁਲਾਓ" },
  6: { en: "I am fine", hi: "मैं ठीक हूँ", pa: "ਮੈਂ ਠੀਕ ਹਾਂ" },
  7: { en: "Yes", hi: "हाँ", pa: "ਹਾਂ" },
  8: { en: "No", hi: "नहीं", pa: "ਨਹੀਂ" },
  9: { en: "Sit with me", hi: "मेरे पास बैठो", pa: "ਮੇਰੇ ਕੋਲ ਬੈਠੋ" },
  10: { en: "Too fast - slow down", hi: "बहुत तेज़ - धीरे बोलो", pa: "ਬਹੁਤ ਤੇਜ਼ - ਹੌਲੀ ਬੋਲੋ" },
  11: { en: "Give me a moment", hi: "मुझे एक पल दो", pa: "ਮੈਨੂੰ ਇੱਕ ਪਲ ਦਿਓ" },
};

/**
 * Localize card text to the target language.
 * Default phrases match by slot or known text across languages.
 */
export function getLocalizedCardText(
  card: { slot?: number | null; text: string; icon?: string | null },
  lang: Lang,
): string {
  if (card.slot !== undefined && card.slot !== null && DEFAULT_PHRASES[card.slot]) {
    return DEFAULT_PHRASES[card.slot][lang];
  }
  const normalized = card.text.trim().toLowerCase();
  for (const entry of Object.values(DEFAULT_PHRASES)) {
    if (Object.values(entry).some((val) => val.trim().toLowerCase() === normalized)) {
      return entry[lang];
    }
  }
  return card.text;
}

/** Emergency speech uses the pinned card if matching lang, or localizes to the active language. */
export function emergencyPhrase(board: AwaazBoard | null, lang: Lang): string {
  const card = board?.cards.find((c) => c.is_emergency);
  if (card && card.lang === lang) {
    return card.text;
  }
  return DEFAULT_PHRASES[0][lang];
}

export interface DemoMuffledPreset {
  id: string;
  slot: number;
  icon: string;
  title: Record<Lang, string>;
  muffledPhonetic: Record<Lang, string>;
  reconstructedText: Record<Lang, string>;
  muffledDescription: Record<Lang, string>;
  acousticMetrics: {
    jitter: number;
    shimmer: number;
    hnr: number;
    dysarthriaLikelihood: number;
    clarityScore: number;
  };
}

export const DEMO_MUFFLED_PRESETS: DemoMuffledPreset[] = [
  {
    id: "water",
    slot: 1,
    icon: "water",
    title: { en: "Water", hi: "पानी", pa: "ਪਾਣੀ" },
    muffledPhonetic: {
      en: "w... w-ah... tuh...",
      hi: "पा... पा-नी...",
      pa: "ਪਾ... ਪਾ-ਣੀ...",
    },
    reconstructedText: {
      en: "Water",
      hi: "पानी",
      pa: "ਪਾਣੀ",
    },
    muffledDescription: {
      en: "Slurred labial consonant with vocal cord tremor",
      hi: "स्वरयंत्र कंपन के साथ अस्पष्ट होंठ ध्वनि",
      pa: "ਆਵਾਜ਼ ਕੰਬਣੀ ਨਾਲ ਬੁੱਲ੍ਹਾਂ ਦੀ ਅਸਪਸ਼ਟ ਧੁਨੀ",
    },
    acousticMetrics: {
      jitter: 3.12,
      shimmer: 7.84,
      hnr: 11.2,
      dysarthriaLikelihood: 0.82,
      clarityScore: 28,
    },
  },
  {
    id: "help",
    slot: 0,
    icon: "alert",
    title: { en: "I need help", hi: "मुझे मदद चाहिए", pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ" },
    muffledPhonetic: {
      en: "ah... n-ee... h-elp...",
      hi: "मु... म-द-द...",
      pa: "ਮੈ... ਮ-ਦ-ਦ...",
    },
    reconstructedText: {
      en: "I need help",
      hi: "मुझे मदद चाहिए",
      pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ",
    },
    muffledDescription: {
      en: "Aspiration weakness with restricted tongue articulation",
      hi: "जीभ की गति में रुकावट के साथ धीमी सांस",
      pa: "ਜੀਭ ਦੀ ਹਿਲਜੁਲ ਦੀ ਕਮੀ ਨਾਲ ਮੱਧਮ ਸਾਹ",
    },
    acousticMetrics: {
      jitter: 4.25,
      shimmer: 9.42,
      hnr: 9.4,
      dysarthriaLikelihood: 0.89,
      clarityScore: 22,
    },
  },
  {
    id: "pain",
    slot: 3,
    icon: "pain",
    title: { en: "I am in pain", hi: "मुझे दर्द है", pa: "ਮੈਨੂੰ ਦਰਦ ਹੈ" },
    muffledPhonetic: {
      en: "ah... m... p-ayn...",
      hi: "मु... द-र-द...",
      pa: "ਮੈ... ਦ-ਰ-ਦ...",
    },
    reconstructedText: {
      en: "I am in pain",
      hi: "मुझे दर्द है",
      pa: "ਮੈਨੂੰ ਦਰਦ ਹੈ",
    },
    muffledDescription: {
      en: "Severe plosive distortion with reduced phonation amplitude",
      hi: "कम आवाज़ के साथ स्पष्ट उच्चारण की कमी",
      pa: "ਘੱਟ ਆਵਾਜ਼ ਦੇ ਨਾਲ ਅਟਕਵਾਂ ਉਚਾਰਨ",
    },
    acousticMetrics: {
      jitter: 3.88,
      shimmer: 8.65,
      hnr: 10.1,
      dysarthriaLikelihood: 0.85,
      clarityScore: 25,
    },
  },
  {
    id: "company",
    slot: 9,
    icon: "company",
    title: { en: "Sit with me", hi: "मेरे पास बैठो", pa: "ਮੇਰੇ ਕੋਲ ਬੈਠੋ" },
    muffledPhonetic: {
      en: "s-ih... w-ih... m-ee...",
      hi: "मे-रे... बै-ठो...",
      pa: "ਮੇ-ਰੇ... ਬੈ-ਠੋ...",
    },
    reconstructedText: {
      en: "Sit with me",
      hi: "मेरे पास बैठो",
      pa: "ਮੇਰੇ ਕੋਲ ਬੈਠੋ",
    },
    muffledDescription: {
      en: "Fricative sibilant dropout with breathy voicing",
      hi: "साँस भरी आवाज़ के साथ अक्षरों का छूटना",
      pa: "ਸਾਹ ਭਰੀ ਆਵਾਜ਼ ਨਾਲ ਅੱਖਰਾਂ ਦਾ ਛੁੱਟਣਾ",
    },
    acousticMetrics: {
      jitter: 2.95,
      shimmer: 6.90,
      hnr: 12.4,
      dysarthriaLikelihood: 0.76,
      clarityScore: 32,
    },
  },
];
