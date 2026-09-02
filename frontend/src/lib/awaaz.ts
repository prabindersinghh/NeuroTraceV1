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

/** Emergency speech uses the same pinned card the server seeded for this patient. */
export function emergencyPhrase(board: AwaazBoard | null, lang: Lang): string {
  return board?.cards.find((card) => card.is_emergency)?.text || {
    en: "I need help",
    hi: "मुझे मदद चाहिए",
    pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ",
  }[lang];
}
