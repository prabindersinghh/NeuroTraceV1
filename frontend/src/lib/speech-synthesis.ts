/**
 * Spoken exam instructions — PRD FR2 and §7 accessibility.
 *
 * Every instruction is read aloud, not merely displayed. Three reasons, all of which apply
 * to this specific cohort:
 *
 *   - a meaningful share of Tier-2/3 patients aged 55-75 have limited literacy;
 *   - post-stroke alexia and visual field loss make reading unreliable in exactly the
 *     population we monitor;
 *   - the patient is holding the phone at arm's length to be filmed, where text is small.
 *
 * Uses the Web Speech API, which is on-device on Android and needs no network. When a
 * voice for the requested language is missing the text still renders on screen — the
 * session degrades to visual-only rather than failing.
 */
import { readPrefs } from "./prefs";
import type { Lang } from "./types";

const BCP47: Record<Lang, string[]> = {
  // Ordered by preference. Indian English first for en, since the accent and pacing suit
  // the audience better than en-US.
  en: ["en-IN", "en-GB", "en-US", "en"],
  hi: ["hi-IN", "hi"],
  pa: ["pa-IN", "pa-Guru-IN", "pa"],
};

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(lang: Lang): SpeechSynthesisVoice | null {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  for (const tag of BCP47[lang]) {
    const match = voices.find((v) => v.lang.toLowerCase().startsWith(tag.toLowerCase()));
    if (match) return match;
  }
  return null;
}

/** True when the device can actually speak this language. Drives the "listen" button. */
export function hasVoiceFor(lang: Lang): boolean {
  return pickVoice(lang) !== null;
}

export interface SpeakOptions {
  /** Slower than default: these are instructions for someone who may process slowly. */
  rate?: number;
  onEnd?: () => void;
  /**
   * Speak even when the patient's "spoken instructions" switch is off.
   *
   * That switch means "do not read the screen to me". On Awaaz the speech IS the output —
   * it is the patient talking, not the app narrating — so muting it there would silence a
   * person rather than quieten an interface. The communication board sets this; nothing
   * that merely narrates should.
   */
  essential?: boolean;
  /**
   * Say this AFTER whatever is already being said, instead of cutting it off.
   *
   * The default cancels, which is right for a new instruction replacing an old one. It
   * was wrong for the five recall words: the step spoke them, then the runner spoke the
   * step's label a moment later and cancelled them, so the words were never heard.
   */
  queue?: boolean;
}

/** The patient's own switch (`lib/prefs.ts`). Off means the text still renders. */
export function isVoiceEnabled(): boolean {
  return readPrefs().voice;
}

export function speak(text: string, lang: Lang, options: SpeakOptions = {}): void {
  if (!isSpeechSupported() || !text.trim() || (!isVoiceEnabled() && !options.essential)) {
    // The caller's completion still runs: a screen that shows a "speaking" state must
    // leave it when there is no voice, or it hangs there forever.
    options.onEnd?.();
    return;
  }
  if (!options.queue) window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice(lang);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = BCP47[lang][0];
  }
  utterance.rate = options.rate ?? 0.9;
  utterance.pitch = 1.0;
  if (options.onEnd) {
    // An error is an ending too: a voice that fails mid-phrase, or an engine that reports
    // a `cancel()` as an error rather than an end, would otherwise leave a caller showing
    // a phrase as still being spoken forever. Latched so the callback runs exactly once.
    let ended = false;
    const finish = () => { if (!ended) { ended = true; options.onEnd?.(); } };
    utterance.onend = finish;
    utterance.onerror = finish;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

/**
 * Voice lists load asynchronously in most browsers, and are empty on first call.
 * Resolves once they are available, or after a short timeout so nothing blocks on it.
 */
export function warmUpVoices(timeoutMs = 1500): Promise<void> {
  if (!isSpeechSupported()) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}
