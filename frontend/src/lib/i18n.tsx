/**
 * EN / HI / PA strings.
 *
 * Punjabi is first-class, not an afterthought: the target cohort is Tier-2/3 Punjab, and
 * a patient who cannot read the instruction cannot perform the task. Every patient-facing
 * string here exists in all three languages, and the exam instructions are additionally
 * spoken aloud (see `speech-synthesis.ts`) because a meaningful share of this population
 * has limited literacy or a post-stroke reading impairment.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { readLang, writeLang } from "./langStorage";
import type { Lang } from "./types";

/** Exported so behavioural tests can assert on the copy the app actually renders,
 *  rather than against a duplicated copy of it. See lib/taskFlow.test.ts. */
export const STRINGS = {
  // ================================================================ the journey
  // One path, a few chapters, never "test N of 18". Presentation only — positions,
  // timings and stimuli are the protocol's (docs/superpowers/specs/2026-09-02-*.md).
  progressStart: { en: "Just getting started", hi: "अभी शुरुआत है", pa: "ਹੁਣੇ ਸ਼ੁਰੂਆਤ ਹੈ" },
  progressUnderWay: { en: "Under way", hi: "चल रहा है", pa: "ਚੱਲ ਰਿਹਾ ਹੈ" },
  progressHalf: { en: "About halfway", hi: "लगभग आधा हो गया", pa: "ਲਗਭਗ ਅੱਧਾ ਹੋ ਗਿਆ" },
  progressPastHalf: { en: "More than halfway", hi: "आधे से ज़्यादा हो गया", pa: "ਅੱਧੇ ਤੋਂ ਵੱਧ ਹੋ ਗਿਆ" },
  progressNearly: { en: "Nearly there", hi: "बस थोड़ा और", pa: "ਬੱਸ ਥੋੜ੍ਹਾ ਹੋਰ" },
  progressLast: { en: "The last one", hi: "आख़िरी", pa: "ਆਖ਼ਰੀ" },
  // The path's accessible name. `{phrase}` is one of the six above.
  pathLabel: {
    en: "Your path today: {phrase}. {n} of {total}.",
    hi: "आज का आपका रास्ता: {phrase}। {total} में से {n}।",
    pa: "ਅੱਜ ਦਾ ਤੁਹਾਡਾ ਰਾਹ: {phrase}। {total} ਵਿੱਚੋਂ {n}।",
  },
  stepOf: { en: "{n} of {total}", hi: "{total} में से {n}", pa: "{total} ਵਿੱਚੋਂ {n}" },
  // ---- welcome and warm-up. Nothing here is recorded. ----
  welcomeTitle: { en: "Let's get comfortable.", hi: "आइए, आराम से शुरू करें।", pa: "ਆਓ, ਆਰਾਮ ਨਾਲ ਸ਼ੁਰੂ ਕਰੀਏ।" },
  welcomeBody: {
    en: "A few short moments, one at a time. You can rest whenever you like.",
    hi: "कुछ छोटे-छोटे काम, एक-एक करके। जब चाहें आराम कर सकते हैं।",
    pa: "ਕੁਝ ਛੋਟੇ-ਛੋਟੇ ਕੰਮ, ਇੱਕ-ਇੱਕ ਕਰਕੇ। ਜਦੋਂ ਚਾਹੋ ਆਰਾਮ ਕਰ ਸਕਦੇ ਹੋ।",
  },
  welcomeSit: {
    en: "Sit somewhere comfortable, with the phone in front of you.",
    hi: "आराम से बैठिए, फ़ोन अपने सामने रखिए।",
    pa: "ਆਰਾਮ ਨਾਲ ਬੈਠੋ, ਫ਼ੋਨ ਆਪਣੇ ਸਾਹਮਣੇ ਰੱਖੋ।",
  },
  welcomePractice: {
    en: "This is a practice run. Nothing is scored.",
    hi: "यह अभ्यास है। कुछ भी गिना नहीं जाएगा।",
    pa: "ਇਹ ਅਭਿਆਸ ਹੈ। ਕੁਝ ਵੀ ਗਿਣਿਆ ਨਹੀਂ ਜਾਵੇਗਾ।",
  },
  ready: { en: "I'm ready", hi: "मैं तैयार हूँ", pa: "ਮੈਂ ਤਿਆਰ ਹਾਂ" },
  skipWarmup: { en: "Skip the warm-up", hi: "वार्म-अप छोड़ें", pa: "ਵਾਰਮ-ਅੱਪ ਛੱਡੋ" },
  warmupTap: { en: "Tap the light.", hi: "रोशनी को छुएँ।", pa: "ਰੌਸ਼ਨੀ ਨੂੰ ਛੂਹੋ।" },
  warmupHold: {
    en: "Now hold it until it fills.",
    hi: "अब इसे तब तक दबाए रखें जब तक यह भर न जाए।",
    pa: "ਹੁਣ ਇਸਨੂੰ ਉਦੋਂ ਤੱਕ ਦਬਾਈ ਰੱਖੋ ਜਦੋਂ ਤੱਕ ਇਹ ਭਰ ਨਾ ਜਾਵੇ।",
  },
  warmupNote: {
    en: "Just to get comfortable — nothing is recorded yet.",
    hi: "सिर्फ़ अभ्यास के लिए — अभी कुछ दर्ज नहीं हो रहा।",
    pa: "ਸਿਰਫ਼ ਅਭਿਆਸ ਲਈ — ਹਾਲੇ ਕੁਝ ਦਰਜ ਨਹੀਂ ਹੋ ਰਿਹਾ।",
  },
  warmupDone: {
    en: "That's the idea. Let's begin.",
    hi: "बस यही करना है। चलिए शुरू करें।",
    pa: "ਬੱਸ ਇਹੀ ਕਰਨਾ ਹੈ। ਚੱਲੋ ਸ਼ੁਰੂ ਕਰੀਏ।",
  },
  // ---- comfort controls: the patient's own, kept on the device (lib/prefs.ts) ----
  comfortTitle: { en: "Make it comfortable", hi: "अपने हिसाब से", pa: "ਆਪਣੇ ਹਿਸਾਬ ਨਾਲ" },
  comfortVoice: { en: "Read aloud", hi: "बोलकर सुनाएँ", pa: "ਬੋਲ ਕੇ ਸੁਣਾਓ" },
  comfortMotion: { en: "Less movement", hi: "कम हलचल", pa: "ਘੱਟ ਹਿਲਜੁਲ" },
  comfortText: { en: "Bigger text", hi: "बड़े अक्षर", pa: "ਵੱਡੇ ਅੱਖਰ" },
  // ---- chapters. A name and one line each; the line is spoken. ----
  chNext: { en: "Next along the path", hi: "रास्ते में आगे", pa: "ਰਾਹ ਵਿੱਚ ਅੱਗੇ" },
  chHands: { en: "Hands and voice", hi: "हाथ और आवाज़", pa: "ਹੱਥ ਅਤੇ ਆਵਾਜ਼" },
  chHandsIntro: {
    en: "A few quick things with your hands and your voice.",
    hi: "हाथों और आवाज़ से कुछ छोटे काम।",
    pa: "ਹੱਥਾਂ ਅਤੇ ਆਵਾਜ਼ ਨਾਲ ਕੁਝ ਛੋਟੇ ਕੰਮ।",
  },
  chCheckin: { en: "A quick check-in", hi: "एक छोटी बात", pa: "ਇੱਕ ਛੋਟੀ ਗੱਲ" },
  chCheckinIntro: {
    en: "Two short questions, then your medicines.",
    hi: "दो छोटे सवाल, फिर आपकी दवाइयाँ।",
    pa: "ਦੋ ਛੋਟੇ ਸਵਾਲ, ਫਿਰ ਤੁਹਾਡੀਆਂ ਦਵਾਈਆਂ।",
  },
  chEyes: { en: "Your eyes", hi: "आपकी आँखें", pa: "ਤੁਹਾਡੀਆਂ ਅੱਖਾਂ" },
  chEyesIntro: {
    en: "Five words to keep in mind, then follow the light with your eyes.",
    hi: "पाँच शब्द याद रखने के लिए, फिर आँखों से रोशनी का पीछा।",
    pa: "ਪੰਜ ਸ਼ਬਦ ਯਾਦ ਰੱਖਣ ਲਈ, ਫਿਰ ਅੱਖਾਂ ਨਾਲ ਰੌਸ਼ਨੀ ਦਾ ਪਿੱਛਾ।",
  },
  chStanding: { en: "On your feet", hi: "खड़े होकर", pa: "ਖੜ੍ਹੇ ਹੋ ਕੇ" },
  chStandingIntro: {
    en: "Someone should be beside you for this part.",
    hi: "इस हिस्से में कोई आपके पास होना चाहिए।",
    pa: "ਇਸ ਹਿੱਸੇ ਵਿੱਚ ਕੋਈ ਤੁਹਾਡੇ ਕੋਲ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।",
  },
  chClose: { en: "Winding down", hi: "समापन की ओर", pa: "ਸਮਾਪਤੀ ਵੱਲ" },
  chCloseIntro: {
    en: "Nearly there. A few calm moments to finish.",
    hi: "बस थोड़ा और। शांति से कुछ आख़िरी पल।",
    pa: "ਬੱਸ ਥੋੜ੍ਹਾ ਹੋਰ। ਸ਼ਾਂਤੀ ਨਾਲ ਕੁਝ ਆਖ਼ਰੀ ਪਲ।",
  },
  restPrompt: {
    en: "Would you like a short rest first?",
    hi: "क्या पहले थोड़ा आराम करना चाहेंगे?",
    pa: "ਕੀ ਪਹਿਲਾਂ ਥੋੜ੍ਹਾ ਆਰਾਮ ਕਰਨਾ ਚਾਹੋਗੇ?",
  },
  restNow: { en: "Rest a moment", hi: "थोड़ा आराम करें", pa: "ਥੋੜ੍ਹਾ ਆਰਾਮ ਕਰੋ" },
  // ---- coming back after a reload (lib/journeyStore.ts) ----
  resumeTitle: { en: "Welcome back.", hi: "फिर से स्वागत है।", pa: "ਫਿਰ ਸਵਾਗਤ ਹੈ।" },
  resumeBody: {
    en: "You were part-way through. Continue where you left off?",
    hi: "आप बीच में थे। वहीं से आगे बढ़ें?",
    pa: "ਤੁਸੀਂ ਵਿਚਕਾਰ ਸੀ। ਉੱਥੋਂ ਹੀ ਅੱਗੇ ਵਧੋ?",
  },
  resumeContinue: { en: "Continue where I left off", hi: "वहीं से आगे बढ़ें", pa: "ਉੱਥੋਂ ਹੀ ਅੱਗੇ ਵਧੋ" },
  resumeFresh: { en: "Start again from the beginning", hi: "शुरू से फिर करें", pa: "ਸ਼ੁਰੂ ਤੋਂ ਫਿਰ ਕਰੋ" },
  // ---- the instruction card ----
  listenAgain: { en: "Listen again", hi: "फिर से सुनें", pa: "ਫਿਰ ਸੁਣੋ" },
  watchHow: { en: "Watch how", hi: "देखिए कैसे", pa: "ਦੇਖੋ ਕਿਵੇਂ" },
  secondsLeft: { en: "{n} seconds left", hi: "{n} सेकंड बाकी", pa: "{n} ਸਕਿੰਟ ਬਾਕੀ" },
  keepGoing: { en: "Keep going", hi: "जारी रखें", pa: "ਜਾਰੀ ਰੱਖੋ" },
  // Presentation overrides of two server labels (lib/journey.ts, LABEL_OVERRIDE).
  labelTapLight: {
    en: "Tap the light the moment it comes on.",
    hi: "जैसे ही रोशनी जले, तुरंत छुएँ।",
    pa: "ਜਿਵੇਂ ਹੀ ਰੌਸ਼ਨੀ ਜਗੇ, ਤੁਰੰਤ ਛੂਹੋ।",
  },
  labelRecall: {
    en: "Which of these words did you see earlier? Tap them.",
    hi: "इनमें से कौन से शब्द आपने पहले देखे थे? उन्हें छुएँ।",
    pa: "ਇਹਨਾਂ ਵਿੱਚੋਂ ਕਿਹੜੇ ਸ਼ਬਦ ਤੁਸੀਂ ਪਹਿਲਾਂ ਦੇਖੇ ਸਨ? ਉਹਨਾਂ ਨੂੰ ਛੂਹੋ।",
  },
  // ---- the end. Neutral: no praise, no score (lib/taskFlow.ts, FORBIDDEN_AT_CONFIRM). ----
  doneTitle: { en: "That's everything for today.", hi: "आज के लिए बस इतना ही।", pa: "ਅੱਜ ਲਈ ਬੱਸ ਇੰਨਾ ਹੀ।" },
  doneBody: {
    en: "Thank you. Everything is saved.",
    hi: "धन्यवाद। सब कुछ सहेज लिया गया है।",
    pa: "ਧੰਨਵਾਦ। ਸਭ ਕੁਝ ਸੰਭਾਲ ਲਿਆ ਗਿਆ ਹੈ।",
  },
  orDivider: { en: "or", hi: "या", pa: "ਜਾਂ" },
  // Clinician roster summary: the metrics row above the list.
  linkedToYou: {
    en: "Linked to you, with consent in force",
    hi: "आपसे जुड़े, सहमति लागू है",
    pa: "ਤੁਹਾਡੇ ਨਾਲ ਜੁੜੇ, ਸਹਿਮਤੀ ਲਾਗੂ ਹੈ",
  },
  // Mono caps eyebrows above a page title — the landing page's own vocabulary.
  // ---- the patient's check-in calendar and history. No verdicts, by design. ----
  calTitle: { en: "Your check-ins", hi: "आपकी जाँचें", pa: "ਤੁਹਾਡੀਆਂ ਜਾਂਚਾਂ" },
  calPrev: { en: "Previous month", hi: "पिछला महीना", pa: "ਪਿਛਲਾ ਮਹੀਨਾ" },
  calNext: { en: "Next month", hi: "अगला महीना", pa: "ਅਗਲਾ ਮਹੀਨਾ" },
  calDone: { en: "Done", hi: "पूरी हुई", pa: "ਪੂਰੀ ਹੋਈ" },
  calStopped: { en: "Stopped part-way", hi: "बीच में रुकी", pa: "ਵਿਚਕਾਰ ਰੁਕੀ" },
  calStreak: { en: "{n} days in a row", hi: "लगातार {n} दिन", pa: "ਲਗਾਤਾਰ {n} ਦਿਨ" },
  // Session TYPE names for history rows. Distinct from todayShort/todayLong, which
  // embed "Today is" — reused in a history row that produced "31 Aug — Today is the
  // short check-in", a sentence about the wrong day.
  typeShort: { en: "Daily check-in", hi: "रोज़ की जाँच", pa: "ਰੋਜ਼ ਦੀ ਜਾਂਚ" },
  typeLong: { en: "Longer check-in", hi: "लंबी जाँच", pa: "ਲੰਬੀ ਜਾਂਚ" },
  historyTitle: { en: "Recent check-ins", hi: "हाल की जाँचें", pa: "ਹਾਲੀਆ ਜਾਂਚਾਂ" },
  historyStopped: {
    en: "Stopped at {done} of {total}",
    hi: "{total} में से {done} पर रुकी",
    pa: "{total} ਵਿੱਚੋਂ {done} ਤੇ ਰੁਕੀ",
  },
  historyEmpty: {
    en: "Your first check-in will appear here.",
    hi: "आपकी पहली जाँच यहाँ दिखेगी।",
    pa: "ਤੁਹਾਡੀ ਪਹਿਲੀ ਜਾਂਚ ਇੱਥੇ ਦਿਖੇਗੀ।",
  },
  signInEyebrow: { en: "Secure sign-in", hi: "सुरक्षित साइन-इन", pa: "ਸੁਰੱਖਿਅਤ ਸਾਈਨ-ਇਨ" },
  skipToContent: { en: "Skip to content", hi: "सीधे सामग्री पर जाएँ", pa: "ਸਿੱਧਾ ਸਮੱਗਰੀ 'ਤੇ ਜਾਓ" },
  clinicEyebrow: { en: "Clinician", hi: "चिकित्सक", pa: "ਡਾਕਟਰ" },
  // ---- the caregiver roster's own instrumentation. Adherence only: how much has been
  // done, never how it scored. Bands belong on the patient dashboard, behind a click. ----
  careWeekLabel: { en: "Check-ins this week", hi: "इस हफ़्ते की जाँचें", pa: "ਇਸ ਹਫ਼ਤੇ ਦੀਆਂ ਜਾਂਚਾਂ" },
  careWeekContext: {
    en: "Across everyone you look after",
    hi: "जिनकी आप देखभाल करते हैं, सबकी",
    pa: "ਜਿਨ੍ਹਾਂ ਦੀ ਤੁਸੀਂ ਦੇਖਭਾਲ ਕਰਦੇ ਹੋ, ਸਭ ਦੀਆਂ",
  },
  careSetupLabel: { en: "Setup pending", hi: "सेटअप बाकी", pa: "ਸੈੱਟਅੱਪ ਬਾਕੀ" },
  careSetupContext: {
    en: "Finish before the first check-in",
    hi: "पहली जाँच से पहले पूरा करें",
    pa: "ਪਹਿਲੀ ਜਾਂਚ ਤੋਂ ਪਹਿਲਾਂ ਪੂਰਾ ਕਰੋ",
  },
  carePeopleContext: { en: "In your care", hi: "आपकी देखभाल में", pa: "ਤੁਹਾਡੀ ਦੇਖਭਾਲ ਵਿੱਚ" },
  lastCheckin: { en: "Last check-in {when}", hi: "पिछली जाँच {when}", pa: "ਪਿਛਲੀ ਜਾਂਚ {when}" },
  noCheckinsYet: { en: "No check-ins yet", hi: "अभी कोई जाँच नहीं", pa: "ਹਾਲੇ ਕੋਈ ਜਾਂਚ ਨਹੀਂ" },
  last7days: { en: "Last 7 days", hi: "पिछले 7 दिन", pa: "ਪਿਛਲੇ 7 ਦਿਨ" },
  dashEyebrow: { en: "Patient dashboard", hi: "मरीज़ डैशबोर्ड", pa: "ਮਰੀਜ਼ ਡੈਸ਼ਬੋਰਡ" },
  caregiverEyebrow: { en: "Care at home", hi: "घर पर देखभाल", pa: "ਘਰ ਵਿੱਚ ਦੇਖਭਾਲ" },
  patientEyebrow: { en: "Today", hi: "आज", pa: "ਅੱਜ" },
  alerts: { en: "Alerts", hi: "अलर्ट", pa: "ਅਲਰਟ" },
  unacknowledged: {
    en: "Not yet acknowledged",
    hi: "अभी तक स्वीकार नहीं किया",
    pa: "ਹਾਲੇ ਤੱਕ ਸਵੀਕਾਰ ਨਹੀਂ ਕੀਤਾ",
  },
  awaitingReview: {
    en: "Waiting for your baseline review",
    hi: "आपकी बेसलाइन समीक्षा की प्रतीक्षा में",
    pa: "ਤੁਹਾਡੀ ਬੇਸਲਾਈਨ ਸਮੀਖਿਆ ਦੀ ਉਡੀਕ ਵਿੱਚ",
  },
  languageLabel: { en: "Language", hi: "भाषा", pa: "ਭਾਸ਼ਾ" },
  // ---- first-run tour (Part 3) ----
  tourNext: { en: "Next", hi: "आगे", pa: "ਅੱਗੇ" },
  tourDone: { en: "Done", hi: "हो गया", pa: "ਹੋ ਗਿਆ" },
  tourSkip: { en: "Skip", hi: "छोड़ें", pa: "ਛੱਡੋ" },
  tourPatientStart: {
    // No duration here on purpose. The card above this button already shows today's,
    // read from the server — and today may be the long session. A number typed into copy
    // is how the app came to disagree with itself about how long Daily Pulse takes (D-045).
    en: "Tap here each morning to start your check-in.",
    hi: "हर सुबह अपनी जाँच शुरू करने के लिए यहाँ दबाएँ।",
    pa: "ਹਰ ਸਵੇਰ ਆਪਣੀ ਜਾਂਚ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਇੱਥੇ ਦਬਾਓ।",
  },
  tourPatientEmergency: {
    en: "If something feels suddenly wrong, this button is always here.",
    hi: "अगर अचानक कुछ ठीक न लगे, तो यह बटन हमेशा यहाँ है।",
    pa: "ਜੇ ਅਚਾਨਕ ਕੁਝ ਠੀਕ ਨਾ ਲੱਗੇ, ਤਾਂ ਇਹ ਬਟਨ ਹਮੇਸ਼ਾ ਇੱਥੇ ਹੈ।",
  },
  tourCaregiverList: {
    en: "Everyone you look after appears here, with how their week has gone.",
    hi: "आप जिनकी देखभाल करते हैं वे सब यहाँ दिखते हैं, उनके सप्ताह के साथ।",
    pa: "ਤੁਸੀਂ ਜਿਨ੍ਹਾਂ ਦੀ ਦੇਖਭਾਲ ਕਰਦੇ ਹੋ ਉਹ ਸਾਰੇ ਇੱਥੇ ਦਿਖਦੇ ਹਨ, ਉਨ੍ਹਾਂ ਦੇ ਹਫ਼ਤੇ ਦੇ ਨਾਲ।",
  },
  tourCaregiverAdd: {
    en: "Add the person you care for here to begin.",
    hi: "शुरू करने के लिए जिनकी आप देखभाल करते हैं उन्हें यहाँ जोड़ें।",
    pa: "ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਜਿਨ੍ਹਾਂ ਦੀ ਤੁਸੀਂ ਦੇਖਭਾਲ ਕਰਦੇ ਹੋ ਉਨ੍ਹਾਂ ਨੂੰ ਇੱਥੇ ਜੋੜੋ।",
  },
  tourClinicianRoster: {
    en: "Your linked patients, ordered by what changed most recently.",
    hi: "आपके जुड़े मरीज़, हाल में सबसे अधिक बदलाव के क्रम में।",
    pa: "ਤੁਹਾਡੇ ਜੁੜੇ ਮਰੀਜ਼, ਹਾਲ ਵਿੱਚ ਸਭ ਤੋਂ ਵੱਧ ਬਦਲਾਅ ਦੇ ਕ੍ਰਮ ਵਿੱਚ।",
  },
  tourClinicianReview: {
    en: "Baselines waiting for your confirmation appear here.",
    hi: "आपकी पुष्टि की प्रतीक्षा कर रहे बेसलाइन यहाँ दिखते हैं।",
    pa: "ਤੁਹਾਡੀ ਪੁਸ਼ਟੀ ਦੀ ਉਡੀਕ ਕਰ ਰਹੇ ਬੇਸਲਾਈਨ ਇੱਥੇ ਦਿਖਦੇ ਹਨ।",
  },
  // ---- leaving a session part-way, and looking back at it (Part 1) ----
  // Accessible names for two controls that had hardcoded English ones. A screen-reader
  // user on the Punjabi build heard "line angle" in English on the SVV slider — a control
  // that IS the measurement, so the instruction and the label disagreed.
  cameraPreview: { en: "Camera preview", hi: "कैमरा दृश्य", pa: "ਕੈਮਰਾ ਦ੍ਰਿਸ਼" },
  svvLineAngle: { en: "Line angle", hi: "रेखा का कोण", pa: "ਰੇਖਾ ਦਾ ਕੋਣ" },
  // MUST stay distinct from `pause` in every language, and that is not automatic:
  // "Stop" and "Pause" are different words in English but both rendered as रोकें / ਰੋਕੋ,
  // so a Hindi or Punjabi patient saw two adjacent buttons with the SAME label — one
  // pausing recoverably, one ending the session. Pinned by a test.
  exitShort: { en: "Exit", hi: "बाहर निकलें", pa: "ਬਾਹਰ ਨਿਕਲੋ" },
  exitLabel: {
    en: "Stop this check-in",
    hi: "यह जाँच रोकें",
    pa: "ਇਹ ਜਾਂਚ ਰੋਕੋ",
  },
  exitTitle: {
    en: "Stop this check-in?",
    hi: "क्या यह जाँच रोकनी है?",
    pa: "ਕੀ ਇਹ ਜਾਂਚ ਰੋਕਣੀ ਹੈ?",
  },
  // `{done}` and `{total}` are substituted by the caller. Kept as placeholders rather
  // than string concatenation so each language keeps its own word order.
  exitProgress: {
    en: "You have completed {done} of {total} steps.",
    hi: "आपने {total} में से {done} चरण पूरे किए हैं।",
    pa: "ਤੁਸੀਂ {total} ਵਿੱਚੋਂ {done} ਪੜਾਅ ਪੂਰੇ ਕੀਤੇ ਹਨ।",
  },
  // Says what happens to the work, because "are you sure?" with no answer to "what do I
  // lose?" is what makes someone stay in a check-in they wanted to leave.
  exitKept: {
    en: "What you have already done is saved. You can start again whenever you like.",
    hi: "आपने अब तक जो किया है वह सुरक्षित है। आप जब चाहें फिर से शुरू कर सकते हैं।",
    pa: "ਤੁਸੀਂ ਹੁਣ ਤੱਕ ਜੋ ਕੀਤਾ ਹੈ ਉਹ ਸੰਭਾਲਿਆ ਗਿਆ ਹੈ। ਤੁਸੀਂ ਜਦੋਂ ਚਾਹੋ ਦੁਬਾਰਾ ਸ਼ੁਰੂ ਕਰ ਸਕਦੇ ਹੋ।",
  },
  exitCancel: {
    en: "Carry on with the check-in",
    hi: "जाँच जारी रखें",
    pa: "ਜਾਂਚ ਜਾਰੀ ਰੱਖੋ",
  },
  exitConfirm: { en: "Stop for now", hi: "अभी के लिए रोकें", pa: "ਹੁਣ ਲਈ ਰੋਕੋ" },
  stepBack: { en: "Back", hi: "पीछे", pa: "ਪਿੱਛੇ" },
  stepForward: { en: "Forward", hi: "आगे", pa: "ਅੱਗੇ" },
  reviewNavLabel: {
    en: "Look back at earlier steps",
    hi: "पिछले चरण देखें",
    pa: "ਪਿਛਲੇ ਪੜਾਅ ਵੇਖੋ",
  },
  reviewTitle: {
    en: "Looking back",
    hi: "पीछे देख रहे हैं",
    pa: "ਪਿੱਛੇ ਵੇਖ ਰਹੇ ਹੋ",
  },
  // States plainly that this step cannot be redone, so the absence of a retake button
  // reads as a decision rather than something missing.
  reviewBody: {
    en: "This step is already done and cannot be repeated. Go forward to carry on.",
    hi: "यह चरण हो चुका है और दोबारा नहीं किया जा सकता। जारी रखने के लिए आगे जाएँ।",
    pa: "ਇਹ ਪੜਾਅ ਹੋ ਚੁੱਕਾ ਹੈ ਅਤੇ ਦੁਬਾਰਾ ਨਹੀਂ ਕੀਤਾ ਜਾ ਸਕਦਾ। ਜਾਰੀ ਰੱਖਣ ਲਈ ਅੱਗੇ ਜਾਓ।",
  },
  qualityNoPerson: {
    en: "We could not see the whole body. Step back so everything fits, then try again.",
    hi: "पूरा शरीर नहीं दिखा। थोड़ा पीछे हों ताकि सब दिखे, फिर दोबारा करें।",
    pa: "ਪੂਰਾ ਸਰੀਰ ਨਹੀਂ ਦਿਖਿਆ। ਥੋੜ੍ਹਾ ਪਿੱਛੇ ਹੋਵੋ ਤਾਂ ਜੋ ਸਭ ਦਿਖੇ, ਫਿਰ ਦੁਬਾਰਾ ਕਰੋ।",
  },
  qualityFinger: {
    en: "The finger came off the camera. Rest it gently and try again.",
    hi: "उँगली कैमरे से हट गई। हल्के से रखें और दोबारा करें।",
    pa: "ਉਂਗਲੀ ਕੈਮਰੇ ਤੋਂ ਹਟ ਗਈ। ਹਲਕੇ ਨਾਲ ਰੱਖੋ ਅਤੇ ਦੁਬਾਰਾ ਕਰੋ।",
  },
  awaazOpen: { en: "Help me speak", hi: "बोलने में मदद", pa: "ਬੋਲਣ ਵਿੱਚ ਮਦਦ" },
  finishSetup: {
    en: "Finish setup first",
    hi: "पहले सेटअप पूरा करें",
    pa: "ਪਹਿਲਾਂ ਸੈੱਟਅੱਪ ਪੂਰਾ ਕਰੋ",
  },
  awaazEmergency: { en: "I need help", hi: "मुझे मदद चाहिए", pa: "ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ" },
  awaazListenerShare: {
    en: "Share a listening link",
    hi: "सुनने वाला लिंक भेजें",
    pa: "ਸੁਣਨ ਵਾਲਾ ਲਿੰਕ ਭੇਜੋ",
  },
  awaazListenerCopy: {
    en: "Copy the link again",
    hi: "लिंक फिर कॉपी करें",
    pa: "ਲਿੰਕ ਫਿਰ ਕਾਪੀ ਕਰੋ",
  },
  // The default listener name is deliberately not the patient's full name: a link can be
  // forwarded, and a stranger does not need their identity in order to help them.
  awaazListenerDefaultName: {
    en: "someone who is recovering",
    hi: "एक व्यक्ति जो ठीक हो रहे हैं",
    pa: "ਇੱਕ ਵਿਅਕਤੀ ਜੋ ਠੀਕ ਹੋ ਰਹੇ ਹਨ",
  },
  awaazReviewTonight: {
    en: "This evening's review",
    hi: "आज शाम की जाँच",
    pa: "ਅੱਜ ਸ਼ਾਮ ਦੀ ਜਾਂਚ",
  },
  awaazTypeSpeak: {
    en: "Type what you want said aloud",
    hi: "जो बुलवाना है, वह लिखें",
    pa: "ਜੋ ਬੁਲਵਾਉਣਾ ਹੈ, ਉਹ ਲਿਖੋ",
  },
  awaazTypeConfirm: {
    en: "Type it — you will confirm before anything is spoken",
    hi: "लिखें — बोलने से पहले आपसे पुष्टि ली जाएगी",
    pa: "ਲਿਖੋ — ਬੋਲਣ ਤੋਂ ਪਹਿਲਾਂ ਤੁਹਾਡੇ ਤੋਂ ਪੁਸ਼ਟੀ ਲਈ ਜਾਵੇਗੀ",
  },
  awaazSay: { en: "Say it", hi: "बोलो", pa: "ਬੋਲੋ" },
  awaazOffer: { en: "Show options", hi: "विकल्प दिखाएँ", pa: "ਵਿਕਲਪ ਦਿਖਾਓ" },
  awaazPickOne: {
    en: "Tap the one you mean. Nothing is spoken until you choose.",
    hi: "जो कहना है उस पर टैप करें। चुनने से पहले कुछ नहीं बोला जाएगा।",
    pa: "ਜੋ ਕਹਿਣਾ ਹੈ ਉਸ 'ਤੇ ਟੈਪ ਕਰੋ। ਚੁਣਨ ਤੋਂ ਪਹਿਲਾਂ ਕੁਝ ਨਹੀਂ ਬੋਲਿਆ ਜਾਵੇਗਾ।",
  },
  awaazNone: { en: "None of these", hi: "इनमें से कोई नहीं", pa: "ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੋਈ ਨਹੀਂ" },
  awaazAphasiaNote: {
    en: "This board only ever offers choices. It never speaks for you without your tap.",
    hi: "यह बोर्ड सिर्फ़ विकल्प देता है। आपके टैप के बिना कभी आपकी ओर से नहीं बोलता।",
    pa: "ਇਹ ਬੋਰਡ ਸਿਰਫ਼ ਵਿਕਲਪ ਦਿੰਦਾ ਹੈ। ਤੁਹਾਡੇ ਟੈਪ ਤੋਂ ਬਿਨਾਂ ਕਦੇ ਤੁਹਾਡੇ ਵੱਲੋਂ ਨਹੀਂ ਬੋਲਦਾ।",
  },
  awaazDysarthriaNote: {
    en: "Clear enough speech is said aloud automatically; anything uncertain asks first.",
    hi: "साफ़ बोली अपने आप बोल दी जाती है; अनिश्चित होने पर पहले पूछा जाता है।",
    pa: "ਸਾਫ਼ ਬੋਲੀ ਆਪਣੇ ਆਪ ਬੋਲ ਦਿੱਤੀ ਜਾਂਦੀ ਹੈ; ਅਨਿਸ਼ਚਿਤ ਹੋਣ 'ਤੇ ਪਹਿਲਾਂ ਪੁੱਛਿਆ ਜਾਂਦਾ ਹੈ।",
  },
  balanceFraming: {
    en: "Prop the phone about 1.5 metres away, so the whole body is in the frame.",
    hi: "फ़ोन को लगभग 1.5 मीटर दूर रखें, ताकि पूरा शरीर दिखे।",
    pa: "ਫ਼ੋਨ ਨੂੰ ਲਗਭਗ 1.5 ਮੀਟਰ ਦੂਰ ਰੱਖੋ, ਤਾਂ ਜੋ ਪੂਰਾ ਸਰੀਰ ਦਿਖੇ।",
  },
  balanceReady: {
    en: "Good. Press start when the helper is standing beside them.",
    hi: "ठीक है। जब सहायक उनके पास खड़ा हो, तब शुरू दबाएँ।",
    pa: "ਠੀਕ ਹੈ। ਜਦੋਂ ਸਹਾਇਕ ਉਹਨਾਂ ਕੋਲ ਖੜ੍ਹਾ ਹੋਵੇ, ਤਾਂ ਸ਼ੁਰੂ ਦਬਾਓ।",
  },
  holdStill: {
    en: "Hold the position until the timer ends.",
    hi: "समय पूरा होने तक इसी स्थिति में रहें।",
    pa: "ਸਮਾਂ ਪੂਰਾ ਹੋਣ ਤੱਕ ਇਸੇ ਸਥਿਤੀ ਵਿੱਚ ਰਹੋ।",
  },
  pronatorSit: {
    en: "Sit down for this one. Arms straight out, palms up, then close your eyes.",
    hi: "इसके लिए बैठ जाइए। बाहें सीधी आगे, हथेलियाँ ऊपर, फिर आँखें बंद करें।",
    pa: "ਇਸ ਲਈ ਬੈਠ ਜਾਓ। ਬਾਹਾਂ ਸਿੱਧੀਆਂ ਅੱਗੇ, ਹਥੇਲੀਆਂ ਉੱਪਰ, ਫਿਰ ਅੱਖਾਂ ਬੰਦ ਕਰੋ।",
  },
  ppgCover: {
    en: "Cover the back camera completely with your fingertip.",
    hi: "पिछले कैमरे को उँगली से पूरी तरह ढकें।",
    pa: "ਪਿਛਲੇ ਕੈਮਰੇ ਨੂੰ ਉਂਗਲੀ ਨਾਲ ਪੂਰੀ ਤਰ੍ਹਾਂ ਢੱਕੋ।",
  },
  ppgReady: {
    en: "Good. Keep the finger still and press start.",
    hi: "ठीक है। उँगली स्थिर रखें और शुरू दबाएँ।",
    pa: "ਠੀਕ ਹੈ। ਉਂਗਲੀ ਸਥਿਰ ਰੱਖੋ ਅਤੇ ਸ਼ੁਰੂ ਦਬਾਓ।",
  },
  ppgHold: {
    en: "Rest your hand. Do not press hard — a gentle touch reads better.",
    hi: "हाथ को आराम दें। ज़ोर से न दबाएँ — हल्का स्पर्श बेहतर पढ़ता है।",
    pa: "ਹੱਥ ਨੂੰ ਆਰਾਮ ਦਿਓ। ਜ਼ੋਰ ਨਾਲ ਨਾ ਦਬਾਓ — ਹਲਕਾ ਛੋਹ ਬਿਹਤਰ ਪੜ੍ਹਦਾ ਹੈ।",
  },
  pausedTitle: {
    en: "Paused. Take your time.",
    hi: "रुका हुआ है। आराम से।",
    pa: "ਰੁਕਿਆ ਹੋਇਆ ਹੈ। ਆਰਾਮ ਨਾਲ।",
  },
  pausedBody: {
    en: "The check-in will continue exactly where it stopped. Nothing is lost.",
    hi: "जाँच वहीं से आगे बढ़ेगी जहाँ रुकी थी। कुछ भी नहीं खोया।",
    pa: "ਜਾਂਚ ਉੱਥੋਂ ਹੀ ਅੱਗੇ ਵਧੇਗੀ ਜਿੱਥੇ ਰੁਕੀ ਸੀ। ਕੁਝ ਵੀ ਨਹੀਂ ਖੋਇਆ।",
  },
  resume: { en: "Continue", hi: "आगे बढ़ें", pa: "ਅੱਗੇ ਵਧੋ" },
  pause: { en: "Pause", hi: "रोकें", pa: "ਰੋਕੋ" },
  start: { en: "Start", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" },
  done: { en: "Done", hi: "हो गया", pa: "ਹੋ ਗਿਆ" },
  practiceDone: {
    en: "That was practice — nothing was scored. The real check-ins start tomorrow.",
    hi: "यह अभ्यास था — कुछ भी नहीं गिना गया। असली जाँच कल से शुरू होगी।",
    pa: "ਇਹ ਅਭਿਆਸ ਸੀ — ਕੁਝ ਵੀ ਨਹੀਂ ਗਿਣਿਆ ਗਿਆ। ਅਸਲੀ ਜਾਂਚ ਕੱਲ੍ਹ ਤੋਂ ਸ਼ੁਰੂ ਹੋਵੇਗੀ।",
  },
  // --- shell ---
  appName: { en: "NeuroTrace", hi: "न्यूरोट्रेस", pa: "ਨਿਊਰੋਟ੍ਰੇਸ" },
  tagline: {
    en: "A daily check-in that learns what is normal for one person.",
    hi: "रोज़ाना जाँच जो एक व्यक्ति का अपना सामान्य स्तर सीखती है।",
    pa: "ਰੋਜ਼ਾਨਾ ਜਾਂਚ ਜੋ ਇੱਕ ਵਿਅਕਤੀ ਦਾ ਆਪਣਾ ਆਮ ਪੱਧਰ ਸਿੱਖਦੀ ਹੈ।",
  },
  signOut: { en: "Sign out", hi: "साइन आउट", pa: "ਸਾਈਨ ਆਊਟ" },
  loading: { en: "Loading…", hi: "लोड हो रहा है…", pa: "ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…" },
  retry: { en: "Try again", hi: "फिर कोशिश करें", pa: "ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ" },
  back: { en: "Back", hi: "वापस", pa: "ਵਾਪਸ" },
  offline: { en: "Offline — saved on this phone", hi: "ऑफ़लाइन — इसी फ़ोन में सहेजा गया", pa: "ਆਫ਼ਲਾਈਨ — ਇਸੇ ਫ਼ੋਨ ਵਿੱਚ ਸੰਭਾਲਿਆ" },
  sendNow: {
    en: "Send now",
    hi: "अभी भेजें",
    pa: "ਹੁਣੇ ਭੇਜੋ",
  },
  sending: {
    en: "Sending…",
    hi: "भेजा जा रहा है…",
    pa: "ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ…",
  },
  pendingSync: { en: "waiting to sync", hi: "सिंक होना बाकी", pa: "ਸਿੰਕ ਹੋਣਾ ਬਾਕੀ" },
  onDevice: {
    en: "processed on this device · no recording left your phone",
    hi: "इसी फ़ोन पर संसाधित · कोई रिकॉर्डिंग फ़ोन से बाहर नहीं गई",
    pa: "ਇਸੇ ਫ਼ੋਨ 'ਤੇ ਪ੍ਰੋਸੈਸ · ਕੋਈ ਰਿਕਾਰਡਿੰਗ ਫ਼ੋਨ ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਗਈ",
  },

  // --- auth ---
  signIn: { en: "Sign in", hi: "साइन इन करें", pa: "ਸਾਈਨ ਇਨ ਕਰੋ" },
  signUp: { en: "Create account", hi: "खाता बनाएँ", pa: "ਖਾਤਾ ਬਣਾਓ" },
  email: { en: "Email", hi: "ईमेल", pa: "ਈਮੇਲ" },
  password: { en: "Password", hi: "पासवर्ड", pa: "ਪਾਸਵਰਡ" },
  fullName: { en: "Your name", hi: "आपका नाम", pa: "ਤੁਹਾਡਾ ਨਾਂ" },
  iAmA: { en: "I am a", hi: "मैं हूँ", pa: "ਮੈਂ ਹਾਂ" },
  rolePatient: { en: "Patient", hi: "मरीज़", pa: "ਮਰੀਜ਼" },
  roleCaregiver: { en: "Caregiver", hi: "देखभालकर्ता", pa: "ਦੇਖਭਾਲ ਕਰਨ ਵਾਲਾ" },
  roleClinician: { en: "Clinician", hi: "चिकित्सक", pa: "ਡਾਕਟਰ" },
  noAccount: { en: "No account yet?", hi: "अभी खाता नहीं है?", pa: "ਹਾਲੇ ਖਾਤਾ ਨਹੀਂ?" },
  haveAccount: { en: "Already have an account?", hi: "पहले से खाता है?", pa: "ਪਹਿਲਾਂ ਤੋਂ ਖਾਤਾ ਹੈ?" },
  passwordHint: { en: "At least 8 characters", hi: "कम से कम 8 अक्षर", pa: "ਘੱਟੋ-ਘੱਟ 8 ਅੱਖਰ" },
  tryDemo: { en: "Open the demo", hi: "डेमो खोलें", pa: "ਡੈਮੋ ਖੋਲ੍ਹੋ" },
  demoHint: {
    en: "Loads Ramesh, 67 — three weeks of history ending in an alert.",
    hi: "रमेश, 67 — तीन हफ़्ते का इतिहास, अंत में अलर्ट।",
    pa: "ਰਮੇਸ਼, 67 — ਤਿੰਨ ਹਫ਼ਤਿਆਂ ਦਾ ਇਤਿਹਾਸ, ਅੰਤ ਵਿੱਚ ਅਲਰਟ।",
  },
  // ---- the sign-in and sign-up screens ----
  signInTitle: { en: "Welcome back", hi: "फिर से स्वागत है", pa: "ਫਿਰ ਤੋਂ ਜੀ ਆਇਆਂ ਨੂੰ" },
  registerTitle: { en: "Create your account", hi: "अपना खाता बनाएँ", pa: "ਆਪਣਾ ਖਾਤਾ ਬਣਾਓ" },
  registerLead: {
    en: "For the person who does the daily check-in, or the family member who set it up.",
    hi: "उस व्यक्ति के लिए जो रोज़ाना जाँच करता है, या उस परिवारजन के लिए जिसने इसे शुरू किया।",
    pa: "ਉਸ ਵਿਅਕਤੀ ਲਈ ਜੋ ਰੋਜ਼ਾਨਾ ਜਾਂਚ ਕਰਦਾ ਹੈ, ਜਾਂ ਉਸ ਪਰਿਵਾਰਕ ਮੈਂਬਰ ਲਈ ਜਿਸਨੇ ਇਹ ਸ਼ੁਰੂ ਕੀਤਾ।",
  },
  authEyebrow: {
    en: "Post-stroke recovery · measured at home",
    hi: "स्ट्रोक के बाद रिकवरी · घर पर मापी गई",
    pa: "ਸਟ੍ਰੋਕ ਤੋਂ ਬਾਅਦ ਰਿਕਵਰੀ · ਘਰ ਵਿੱਚ ਮਾਪੀ ਗਈ",
  },
  authHeadline: {
    en: "Your own normal, measured every day.",
    hi: "आपका अपना सामान्य स्तर, हर दिन मापा हुआ।",
    pa: "ਤੁਹਾਡਾ ਆਪਣਾ ਆਮ ਪੱਧਰ, ਹਰ ਰੋਜ਼ ਮਾਪਿਆ ਹੋਇਆ।",
  },
  authLead: {
    en: "A three-minute check-in on an ordinary phone. It learns what is usual for one person, and says so when something changes.",
    hi: "एक साधारण फ़ोन पर तीन मिनट की जाँच। यह एक व्यक्ति का सामान्य स्तर सीखती है, और कुछ बदलने पर बताती है।",
    pa: "ਇੱਕ ਸਧਾਰਨ ਫ਼ੋਨ 'ਤੇ ਤਿੰਨ ਮਿੰਟ ਦੀ ਜਾਂਚ। ਇਹ ਇੱਕ ਵਿਅਕਤੀ ਦਾ ਆਮ ਪੱਧਰ ਸਿੱਖਦੀ ਹੈ, ਅਤੇ ਕੁਝ ਬਦਲਣ 'ਤੇ ਦੱਸਦੀ ਹੈ।",
  },
  trustOnDevice: {
    en: "Analysis runs on the phone. The server receives numbers, never video or audio.",
    hi: "विश्लेषण फ़ोन पर ही होता है। सर्वर को सिर्फ़ संख्याएँ मिलती हैं, वीडियो या ऑडियो कभी नहीं।",
    pa: "ਵਿਸ਼ਲੇਸ਼ਣ ਫ਼ੋਨ 'ਤੇ ਹੀ ਹੁੰਦਾ ਹੈ। ਸਰਵਰ ਨੂੰ ਸਿਰਫ਼ ਅੰਕ ਮਿਲਦੇ ਹਨ, ਵੀਡੀਓ ਜਾਂ ਆਡੀਓ ਕਦੇ ਨਹੀਂ।",
  },
  trustAlert: {
    en: "No alert unless a change persists, appears in more than one domain, and has a side.",
    hi: "अलर्ट तभी, जब बदलाव बना रहे, एक से ज़्यादा क्षेत्रों में दिखे, और उसकी एक तरफ़ हो।",
    pa: "ਅਲਰਟ ਤਾਂ ਹੀ, ਜਦੋਂ ਬਦਲਾਅ ਬਣਿਆ ਰਹੇ, ਇੱਕ ਤੋਂ ਵੱਧ ਖੇਤਰਾਂ ਵਿੱਚ ਦਿਖੇ, ਅਤੇ ਉਸਦਾ ਇੱਕ ਪਾਸਾ ਹੋਵੇ।",
  },
  trustLangs: {
    en: "English, Hindi and Punjabi, read aloud.",
    hi: "अंग्रेज़ी, हिंदी और पंजाबी, बोलकर सुनाई जाती हैं।",
    pa: "ਅੰਗਰੇਜ਼ੀ, ਹਿੰਦੀ ਅਤੇ ਪੰਜਾਬੀ, ਬੋਲ ਕੇ ਸੁਣਾਈਆਂ ਜਾਂਦੀਆਂ ਹਨ।",
  },
  fieldCaption: {
    en: "A network of signals, responding to the person in front of it. An illustration — it measures nothing.",
    hi: "संकेतों का एक जाल, जो सामने बैठे व्यक्ति पर प्रतिक्रिया देता है। सिर्फ़ एक चित्र — यह कुछ नहीं मापता।",
    pa: "ਸੰਕੇਤਾਂ ਦਾ ਇੱਕ ਜਾਲ, ਜੋ ਸਾਹਮਣੇ ਬੈਠੇ ਵਿਅਕਤੀ 'ਤੇ ਪ੍ਰਤੀਕਿਰਿਆ ਦਿੰਦਾ ਹੈ। ਸਿਰਫ਼ ਇੱਕ ਤਸਵੀਰ — ਇਹ ਕੁਝ ਨਹੀਂ ਮਾਪਦਾ।",
  },
  backToSite: { en: "Back to the site", hi: "साइट पर वापस", pa: "ਸਾਈਟ 'ਤੇ ਵਾਪਸ" },
  optionalHint: { en: "Optional", hi: "वैकल्पिक", pa: "ਵਿਕਲਪਿਕ" },
  showPassword: { en: "Show password", hi: "पासवर्ड दिखाएँ", pa: "ਪਾਸਵਰਡ ਦਿਖਾਓ" },
  hidePassword: { en: "Hide password", hi: "पासवर्ड छिपाएँ", pa: "ਪਾਸਵਰਡ ਲੁਕਾਓ" },
  roleHelpPatient: {
    en: "I do the daily check-in myself",
    hi: "मैं रोज़ाना जाँच ख़ुद करता/करती हूँ",
    pa: "ਮੈਂ ਰੋਜ਼ਾਨਾ ਜਾਂਚ ਖ਼ੁਦ ਕਰਦਾ/ਕਰਦੀ ਹਾਂ",
  },
  roleHelpCaregiver: {
    en: "I look after someone and follow their trend",
    hi: "मैं किसी की देखभाल करता/करती हूँ और उनका रुझान देखता/देखती हूँ",
    pa: "ਮੈਂ ਕਿਸੇ ਦੀ ਦੇਖਭਾਲ ਕਰਦਾ/ਕਰਦੀ ਹਾਂ ਅਤੇ ਉਹਨਾਂ ਦਾ ਰੁਝਾਨ ਵੇਖਦਾ/ਵੇਖਦੀ ਹਾਂ",
  },
  roleClinicianNote: {
    en: "Clinicians and health workers are set up by their hospital or programme. Ask your administrator for an account.",
    hi: "चिकित्सकों और स्वास्थ्य कर्मियों के खाते उनका अस्पताल या कार्यक्रम बनाता है। खाते के लिए अपने प्रशासक से कहें।",
    pa: "ਡਾਕਟਰਾਂ ਅਤੇ ਸਿਹਤ ਕਰਮਚਾਰੀਆਂ ਦੇ ਖਾਤੇ ਉਹਨਾਂ ਦਾ ਹਸਪਤਾਲ ਜਾਂ ਪ੍ਰੋਗਰਾਮ ਬਣਾਉਂਦਾ ਹੈ। ਖਾਤੇ ਲਈ ਆਪਣੇ ਪ੍ਰਸ਼ਾਸਕ ਨੂੰ ਕਹੋ।",
  },
  strengthLabel: { en: "Password strength", hi: "पासवर्ड की मज़बूती", pa: "ਪਾਸਵਰਡ ਦੀ ਮਜ਼ਬੂਤੀ" },
  strengthTooShort: { en: "Too short", hi: "बहुत छोटा", pa: "ਬਹੁਤ ਛੋਟਾ" },
  strengthOk: { en: "Okay", hi: "ठीक है", pa: "ਠੀਕ ਹੈ" },
  strengthGood: { en: "Good", hi: "अच्छा", pa: "ਚੰਗਾ" },
  strengthStrong: { en: "Strong", hi: "मज़बूत", pa: "ਮਜ਼ਬੂਤ" },
  signingIn: { en: "Signing in…", hi: "साइन इन हो रहा है…", pa: "ਸਾਈਨ ਇਨ ਹੋ ਰਿਹਾ ਹੈ…" },
  creatingAccount: { en: "Creating your account…", hi: "आपका खाता बन रहा है…", pa: "ਤੁਹਾਡਾ ਖਾਤਾ ਬਣ ਰਿਹਾ ਹੈ…" },
  loadingDemo: { en: "Preparing the demo…", hi: "डेमो तैयार हो रहा है…", pa: "ਡੈਮੋ ਤਿਆਰ ਹੋ ਰਿਹਾ ਹੈ…" },
  signedIn: { en: "Signed in", hi: "साइन इन हो गया", pa: "ਸਾਈਨ ਇਨ ਹੋ ਗਿਆ" },
  sessionExpiredTitle: { en: "Your session ended", hi: "आपका सत्र समाप्त हो गया", pa: "ਤੁਹਾਡਾ ਸੈਸ਼ਨ ਖ਼ਤਮ ਹੋ ਗਿਆ" },
  sessionExpiredBody: {
    en: "Sign in again to carry on where you were.",
    hi: "जहाँ थे वहीं से जारी रखने के लिए फिर से साइन इन करें।",
    pa: "ਜਿੱਥੇ ਸੀ ਉੱਥੋਂ ਜਾਰੀ ਰੱਖਣ ਲਈ ਦੁਬਾਰਾ ਸਾਈਨ ਇਨ ਕਰੋ।",
  },
  offlineNotice: {
    en: "You are offline. Signing in needs a connection.",
    hi: "आप ऑफ़लाइन हैं। साइन इन के लिए इंटरनेट चाहिए।",
    pa: "ਤੁਸੀਂ ਆਫ਼ਲਾਈਨ ਹੋ। ਸਾਈਨ ਇਨ ਲਈ ਇੰਟਰਨੈੱਟ ਚਾਹੀਦਾ ਹੈ।",
  },
  // Field problems. Shown under the field, after the person has left it.
  errEmailRequired: { en: "Enter your email", hi: "अपना ईमेल लिखें", pa: "ਆਪਣਾ ਈਮੇਲ ਲਿਖੋ" },
  errEmailInvalid: {
    en: "That does not look like an email address",
    hi: "यह ईमेल पता जैसा नहीं लगता",
    pa: "ਇਹ ਈਮੇਲ ਪਤੇ ਵਰਗਾ ਨਹੀਂ ਲੱਗਦਾ",
  },
  errPasswordRequired: { en: "Enter your password", hi: "अपना पासवर्ड लिखें", pa: "ਆਪਣਾ ਪਾਸਵਰਡ ਲਿਖੋ" },
  errPasswordShort: {
    en: "Use at least 8 characters",
    hi: "कम से कम 8 अक्षर इस्तेमाल करें",
    pa: "ਘੱਟੋ-ਘੱਟ 8 ਅੱਖਰ ਵਰਤੋ",
  },
  errPasswordLong: {
    en: "Use at most 128 characters",
    hi: "अधिकतम 128 अक्षर इस्तेमाल करें",
    pa: "ਵੱਧ ਤੋਂ ਵੱਧ 128 ਅੱਖਰ ਵਰਤੋ",
  },
  errPasswordIsEmail: {
    en: "Your password cannot be your email address",
    hi: "पासवर्ड आपका ईमेल पता नहीं हो सकता",
    pa: "ਪਾਸਵਰਡ ਤੁਹਾਡਾ ਈਮੇਲ ਪਤਾ ਨਹੀਂ ਹੋ ਸਕਦਾ",
  },
  // What went wrong with the server, in plain words. Never the server's own text.
  errWrongCredentials: {
    en: "That email and password do not match. Check both and try again.",
    hi: "यह ईमेल और पासवर्ड मेल नहीं खाते। दोनों जाँचकर फिर कोशिश करें।",
    pa: "ਇਹ ਈਮੇਲ ਅਤੇ ਪਾਸਵਰਡ ਮੇਲ ਨਹੀਂ ਖਾਂਦੇ। ਦੋਵੇਂ ਜਾਂਚ ਕੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  errEmailTaken: {
    en: "An account with this email already exists. Sign in instead.",
    hi: "इस ईमेल से खाता पहले से है। इसके बजाय साइन इन करें।",
    pa: "ਇਸ ਈਮੇਲ ਨਾਲ ਖਾਤਾ ਪਹਿਲਾਂ ਤੋਂ ਹੈ। ਇਸਦੀ ਬਜਾਏ ਸਾਈਨ ਇਨ ਕਰੋ।",
  },
  errRoleProvisioned: {
    en: "That kind of account is set up by an administrator, not here.",
    hi: "इस तरह का खाता प्रशासक बनाता है, यहाँ नहीं बनता।",
    pa: "ਇਸ ਤਰ੍ਹਾਂ ਦਾ ਖਾਤਾ ਪ੍ਰਸ਼ਾਸਕ ਬਣਾਉਂਦਾ ਹੈ, ਇੱਥੇ ਨਹੀਂ ਬਣਦਾ।",
  },
  errPasswordWeak: {
    en: "Choose a different password. That one is too easy to guess.",
    hi: "कोई और पासवर्ड चुनें। यह अनुमान लगाने में बहुत आसान है।",
    pa: "ਕੋਈ ਹੋਰ ਪਾਸਵਰਡ ਚੁਣੋ। ਇਹ ਅੰਦਾਜ਼ਾ ਲਗਾਉਣ ਵਿੱਚ ਬਹੁਤ ਸੌਖਾ ਹੈ।",
  },
  errWrongCurrentPassword: {
    en: "Your current password is not right.",
    hi: "आपका मौजूदा पासवर्ड सही नहीं है।",
    pa: "ਤੁਹਾਡਾ ਮੌਜੂਦਾ ਪਾਸਵਰਡ ਸਹੀ ਨਹੀਂ ਹੈ।",
  },
  errDemoOff: {
    en: "The demo is switched off on this server.",
    hi: "इस सर्वर पर डेमो बंद है।",
    pa: "ਇਸ ਸਰਵਰ 'ਤੇ ਡੈਮੋ ਬੰਦ ਹੈ।",
  },
  errOffline: {
    en: "Cannot reach NeuroTrace. Check your connection and try again.",
    hi: "न्यूरोट्रेस से संपर्क नहीं हो पा रहा। अपना इंटरनेट जाँचकर फिर कोशिश करें।",
    pa: "ਨਿਊਰੋਟ੍ਰੇਸ ਨਾਲ ਸੰਪਰਕ ਨਹੀਂ ਹੋ ਰਿਹਾ। ਆਪਣਾ ਇੰਟਰਨੈੱਟ ਜਾਂਚ ਕੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  errTimeout: {
    en: "The server is taking too long to answer. Try again in a moment.",
    hi: "सर्वर जवाब देने में बहुत समय ले रहा है। थोड़ी देर बाद फिर कोशिश करें।",
    pa: "ਸਰਵਰ ਜਵਾਬ ਦੇਣ ਵਿੱਚ ਬਹੁਤ ਸਮਾਂ ਲੈ ਰਿਹਾ ਹੈ। ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  errTooManyAttempts: {
    en: "Too many attempts. Wait a few minutes, then try again.",
    hi: "बहुत बार कोशिश हो चुकी। कुछ मिनट रुककर फिर कोशिश करें।",
    pa: "ਬਹੁਤ ਵਾਰ ਕੋਸ਼ਿਸ਼ ਹੋ ਚੁੱਕੀ। ਕੁਝ ਮਿੰਟ ਰੁਕ ਕੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  errServer: {
    en: "Something went wrong on our side. Please try again shortly.",
    hi: "हमारी तरफ़ कुछ गड़बड़ हुई। कृपया थोड़ी देर बाद फिर कोशिश करें।",
    pa: "ਸਾਡੇ ਵੱਲੋਂ ਕੁਝ ਗੜਬੜ ਹੋਈ। ਕਿਰਪਾ ਕਰਕੇ ਥੋੜ੍ਹੀ ਦੇਰ ਬਾਅਦ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  errAuthGeneric: {
    en: "That did not work. Please try again.",
    hi: "यह काम नहीं किया। कृपया फिर कोशिश करें।",
    pa: "ਇਹ ਕੰਮ ਨਹੀਂ ਕੀਤਾ। ਕਿਰਪਾ ਕਰਕੇ ਫਿਰ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },

  // --- caregiver ---
  yourPatients: { en: "Your patients", hi: "आपके मरीज़", pa: "ਤੁਹਾਡੇ ਮਰੀਜ਼" },
  addPatient: { en: "Add patient", hi: "मरीज़ जोड़ें", pa: "ਮਰੀਜ਼ ਸ਼ਾਮਲ ਕਰੋ" },
  patientName: { en: "Name", hi: "नाम", pa: "ਨਾਂ" },
  movementDisorderQ: {
    en: "Has a doctor diagnosed Parkinson's disease or another movement disorder?",
    hi: "क्या डॉक्टर ने पार्किंसंस या कोई अन्य मूवमेंट डिसऑर्डर बताया है?",
    pa: "ਕੀ ਡਾਕਟਰ ਨੇ ਪਾਰਕਿੰਸਨ ਜਾਂ ਕੋਈ ਹੋਰ ਮੂਵਮੈਂਟ ਡਿਸਆਰਡਰ ਦੱਸਿਆ ਹੈ?",
  },
  scopeNote: {
    en:
      "This app is for people recovering from a stroke, at least three months ago. " +
      "That includes strokes affecting balance and eye movement, not only ones " +
      "affecting the face and arm. It cannot detect a stroke as it happens.",
    hi:
      "यह ऐप उन लोगों के लिए है जिन्हें कम से कम तीन महीने पहले स्ट्रोक हुआ हो। इसमें संतुलन " +
      "और आँखों की हरकत पर असर करने वाले स्ट्रोक भी शामिल हैं, सिर्फ़ चेहरे और बाँह वाले नहीं। " +
      "यह होते हुए स्ट्रोक को नहीं पकड़ सकता।",
    pa:
      "ਇਹ ਐਪ ਉਹਨਾਂ ਲੋਕਾਂ ਲਈ ਹੈ ਜਿਨ੍ਹਾਂ ਨੂੰ ਘੱਟੋ-ਘੱਟ ਤਿੰਨ ਮਹੀਨੇ ਪਹਿਲਾਂ ਸਟ੍ਰੋਕ ਹੋਇਆ ਹੋਵੇ। ਇਸ ਵਿੱਚ " +
      "ਸੰਤੁਲਨ ਅਤੇ ਅੱਖਾਂ ਦੀ ਹਰਕਤ 'ਤੇ ਅਸਰ ਕਰਨ ਵਾਲੇ ਸਟ੍ਰੋਕ ਵੀ ਸ਼ਾਮਲ ਹਨ। ਇਹ ਹੁੰਦੇ ਹੋਏ " +
      "ਸਟ੍ਰੋਕ ਨੂੰ ਨਹੀਂ ਫੜ ਸਕਦਾ।",
  },
  movementDisorderWhy: {
    en:
      "These conditions change the face, movement and voice together, which this app " +
      "cannot tell apart from the changes it looks for. If yes, it is not suitable and " +
      "enrolment will not go ahead.",
    hi:
      "ये स्थितियाँ चेहरा, चाल और आवाज़ एक साथ बदलती हैं, जिन्हें यह ऐप अपनी देखी जाने वाली " +
      "तबदीलियों से अलग नहीं कर सकता। अगर हाँ, तो यह ऐप उपयुक्त नहीं है और नामांकन नहीं होगा।",
    pa:
      "ਇਹ ਹਾਲਤਾਂ ਚਿਹਰਾ, ਚਾਲ ਅਤੇ ਆਵਾਜ਼ ਇਕੱਠੇ ਬਦਲਦੀਆਂ ਹਨ, ਜਿਨ੍ਹਾਂ ਨੂੰ ਇਹ ਐਪ ਆਪਣੀਆਂ ਦੇਖੀਆਂ ਜਾਣ " +
      "ਵਾਲੀਆਂ ਤਬਦੀਲੀਆਂ ਤੋਂ ਵੱਖ ਨਹੀਂ ਕਰ ਸਕਦਾ। ਜੇ ਹਾਂ, ਤਾਂ ਇਹ ਐਪ ਢੁਕਵਾਂ ਨਹੀਂ ਹੈ ਅਤੇ ਨਾਮਾਂਕਣ ਨਹੀਂ ਹੋਵੇਗਾ।",
  },
  age: { en: "Age", hi: "उम्र", pa: "ਉਮਰ" },
  sex: { en: "Sex", hi: "लिंग", pa: "ਲਿੰਗ" },
  strokeDate: { en: "Date of the stroke", hi: "स्ट्रोक की तारीख़", pa: "ਸਟ੍ਰੋਕ ਦੀ ਤਾਰੀਖ਼" },
  strokeDateHint: {
    en: "Enrolment requires at least three months since discharge.",
    hi: "दाख़िले के लिए छुट्टी के कम से कम तीन महीने बाद होना ज़रूरी है।",
    pa: "ਦਾਖ਼ਲੇ ਲਈ ਛੁੱਟੀ ਤੋਂ ਘੱਟੋ-ਘੱਟ ਤਿੰਨ ਮਹੀਨੇ ਬਾਅਦ ਹੋਣਾ ਜ਼ਰੂਰੀ ਹੈ।",
  },
  affectedSide: { en: "Affected side", hi: "प्रभावित हिस्सा", pa: "ਪ੍ਰਭਾਵਿਤ ਪਾਸਾ" },
  sideLeft: { en: "Left", hi: "बायाँ", pa: "ਖੱਬਾ" },
  sideRight: { en: "Right", hi: "दायाँ", pa: "ਸੱਜਾ" },
  sideUnknown: { en: "Not sure", hi: "पता नहीं", pa: "ਪਤਾ ਨਹੀਂ" },
  language: { en: "Preferred language", hi: "पसंदीदा भाषा", pa: "ਪਸੰਦੀਦਾ ਭਾਸ਼ਾ" },
  usualTime: { en: "Usual check-in time", hi: "जाँच का रोज़ का समय", pa: "ਜਾਂਚ ਦਾ ਰੋਜ਼ ਦਾ ਸਮਾਂ" },
  usualTimeHint: {
    en: "Sessions far from this time are flagged, because alertness swings across the day.",
    hi: "इस समय से बहुत अलग जाँच को चिह्नित किया जाता है, क्योंकि दिनभर सतर्कता बदलती है।",
    pa: "ਇਸ ਸਮੇਂ ਤੋਂ ਬਹੁਤ ਵੱਖਰੀ ਜਾਂਚ ਨਿਸ਼ਾਨਬੱਧ ਹੁੰਦੀ ਹੈ, ਕਿਉਂਕਿ ਦਿਨ ਭਰ ਸੁਚੇਤਤਾ ਬਦਲਦੀ ਹੈ।",
  },
  save: { en: "Save", hi: "सहेजें", pa: "ਸੰਭਾਲੋ" },
  cancel: { en: "Cancel", hi: "रद्द करें", pa: "ਰੱਦ ਕਰੋ" },
  noPatients: {
    en: "No patients yet. Add one to begin.",
    hi: "अभी कोई मरीज़ नहीं। शुरू करने के लिए एक जोड़ें।",
    pa: "ਹਾਲੇ ਕੋਈ ਮਰੀਜ਼ ਨਹੀਂ। ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਇੱਕ ਸ਼ਾਮਲ ਕਰੋ।",
  },
  openDashboard: { en: "Dashboard", hi: "डैशबोर्ड", pa: "ਡੈਸ਼ਬੋਰਡ" },
  startCheckin: { en: "Start check-in", hi: "जाँच शुरू करें", pa: "ਜਾਂਚ ਸ਼ੁਰੂ ਕਰੋ" },
  buildingBaseline: { en: "Learning their normal", hi: "उनका सामान्य स्तर सीख रहे हैं", pa: "ਉਹਨਾਂ ਦਾ ਆਮ ਪੱਧਰ ਸਿੱਖ ਰਹੇ ਹਾਂ" },

  // --- family caretaker access (D-054) ---
  // "Family" in the UI, `caretaker` in the code. Nobody calls their son a caretaker, and a
  // screen that used the schema's word would read as institutional rather than domestic.
  familyTitle: { en: "Your family member", hi: "आपके परिवार का सदस्य", pa: "ਤੁਹਾਡੇ ਪਰਿਵਾਰ ਦਾ ਮੈਂਬਰ" },
  familySubtitle: {
    en: "Everything their daily check-ins show.",
    hi: "उनकी रोज़ाना जाँच जो कुछ दिखाती है, सब कुछ।",
    pa: "ਉਹਨਾਂ ਦੀਆਂ ਰੋਜ਼ਾਨਾ ਜਾਂਚਾਂ ਜੋ ਵੀ ਦਿਖਾਉਂਦੀਆਂ ਹਨ, ਸਭ ਕੁਝ।",
  },
  familyNoPatients: {
    en: "Nobody has shared a family member with you yet.",
    hi: "अभी तक किसी ने आपके साथ कोई सदस्य साझा नहीं किया है।",
    pa: "ਹਾਲੇ ਤੱਕ ਕਿਸੇ ਨੇ ਤੁਹਾਡੇ ਨਾਲ ਕੋਈ ਮੈਂਬਰ ਸਾਂਝਾ ਨਹੀਂ ਕੀਤਾ।",
  },
  familyOpenStatus: { en: "See how they are", hi: "देखें वे कैसे हैं", pa: "ਦੇਖੋ ਉਹ ਕਿਵੇਂ ਹਨ" },
  familyOpenReport: { en: "Full report", hi: "पूरी रिपोर्ट", pa: "ਪੂਰੀ ਰਿਪੋਰਟ" },
  familyScopeNote: {
    en: "You can see everything about them. Changing their settings, adding other family members, and removing their data stay with whoever set up their account.",
    hi: "आप उनके बारे में सब कुछ देख सकते हैं। उनकी सेटिंग बदलना, परिवार के और सदस्य जोड़ना और उनका डेटा हटाना — ये उनके पास रहते हैं जिन्होंने खाता बनाया।",
    pa: "ਤੁਸੀਂ ਉਹਨਾਂ ਬਾਰੇ ਸਭ ਕੁਝ ਦੇਖ ਸਕਦੇ ਹੋ। ਉਹਨਾਂ ਦੀਆਂ ਸੈਟਿੰਗਾਂ ਬਦਲਣਾ, ਹੋਰ ਪਰਿਵਾਰਕ ਮੈਂਬਰ ਜੋੜਨਾ ਅਤੇ ਉਹਨਾਂ ਦਾ ਡਾਟਾ ਹਟਾਉਣਾ — ਇਹ ਉਸ ਕੋਲ ਰਹਿੰਦੇ ਹਨ ਜਿਸ ਨੇ ਖਾਤਾ ਬਣਾਇਆ।",
  },

  familyAccessTitle: { en: "Family access", hi: "पारिवारिक पहुँच", pa: "ਪਰਿਵਾਰਕ ਪਹੁੰਚ" },
  familyAccessSubtitle: {
    en: "Who else in the family can see how they are doing.",
    hi: "परिवार में और कौन देख सकता है कि वे कैसे हैं।",
    pa: "ਪਰਿਵਾਰ ਵਿੱਚ ਹੋਰ ਕੌਣ ਦੇਖ ਸਕਦਾ ਹੈ ਕਿ ਉਹ ਕਿਵੇਂ ਹਨ।",
  },
  familyAccessWarning: {
    en: "A family member you add sees the same full picture you do — every check-in, every change, every report. Add only people you would show it to in person.",
    hi: "जिस सदस्य को आप जोड़ेंगे उसे वही पूरी जानकारी दिखेगी जो आपको दिखती है — हर जाँच, हर बदलाव, हर रिपोर्ट। सिर्फ़ उन्हें जोड़ें जिन्हें आप ख़ुद यह दिखाते।",
    pa: "ਜਿਸ ਮੈਂਬਰ ਨੂੰ ਤੁਸੀਂ ਜੋੜੋਗੇ ਉਸ ਨੂੰ ਉਹੀ ਪੂਰੀ ਜਾਣਕਾਰੀ ਦਿਖੇਗੀ ਜੋ ਤੁਹਾਨੂੰ ਦਿਖਦੀ ਹੈ — ਹਰ ਜਾਂਚ, ਹਰ ਬਦਲਾਅ, ਹਰ ਰਿਪੋਰਟ। ਸਿਰਫ਼ ਉਹਨਾਂ ਨੂੰ ਜੋੜੋ ਜਿਨ੍ਹਾਂ ਨੂੰ ਤੁਸੀਂ ਖ਼ੁਦ ਇਹ ਦਿਖਾਉਂਦੇ।",
  },
  familyAdd: { en: "Add a family member", hi: "सदस्य जोड़ें", pa: "ਮੈਂਬਰ ਜੋੜੋ" },
  familyAddHint: {
    en: "They will be able to sign in once invitations are switched on.",
    hi: "जब निमंत्रण चालू होंगे तब वे साइन इन कर सकेंगे।",
    pa: "ਜਦੋਂ ਸੱਦੇ ਚਾਲੂ ਹੋਣਗੇ ਤਾਂ ਉਹ ਸਾਈਨ ਇਨ ਕਰ ਸਕਣਗੇ।",
  },
  familyInvitePending: {
    en: "Added. They cannot sign in yet — invitations are not switched on, so nothing has been sent to them.",
    hi: "जोड़ दिया गया। वे अभी साइन इन नहीं कर सकते — निमंत्रण चालू नहीं हैं, इसलिए उन्हें कुछ नहीं भेजा गया।",
    pa: "ਜੋੜ ਦਿੱਤਾ ਗਿਆ। ਉਹ ਹਾਲੇ ਸਾਈਨ ਇਨ ਨਹੀਂ ਕਰ ਸਕਦੇ — ਸੱਦੇ ਚਾਲੂ ਨਹੀਂ ਹਨ, ਇਸ ਲਈ ਉਹਨਾਂ ਨੂੰ ਕੁਝ ਨਹੀਂ ਭੇਜਿਆ ਗਿਆ।",
  },
  familyName: { en: "Their name", hi: "उनका नाम", pa: "ਉਹਨਾਂ ਦਾ ਨਾਮ" },
  familyEmail: { en: "Their email", hi: "उनका ईमेल", pa: "ਉਹਨਾਂ ਦਾ ਈਮੇਲ" },
  familyRelationship: { en: "Relation to the patient", hi: "मरीज़ से रिश्ता", pa: "ਮਰੀਜ਼ ਨਾਲ ਰਿਸ਼ਤਾ" },
  familyActive: { en: "Can see them now", hi: "अभी देख सकते हैं", pa: "ਹੁਣ ਦੇਖ ਸਕਦੇ ਹਨ" },
  familyNone: { en: "No other family member has access yet.", hi: "अभी किसी और सदस्य के पास पहुँच नहीं है।", pa: "ਹਾਲੇ ਕਿਸੇ ਹੋਰ ਮੈਂਬਰ ਕੋਲ ਪਹੁੰਚ ਨਹੀਂ ਹੈ।" },
  familyPast: { en: "No longer has access", hi: "अब पहुँच नहीं है", pa: "ਹੁਣ ਪਹੁੰਚ ਨਹੀਂ ਹੈ" },
  familyPastNote: {
    en: "Kept on purpose, so it stays clear who could see this and until when.",
    hi: "जानबूझकर रखा गया है, ताकि साफ़ रहे कि कौन कब तक देख सकता था।",
    pa: "ਜਾਣਬੁੱਝ ਕੇ ਰੱਖਿਆ ਗਿਆ ਹੈ, ਤਾਂ ਜੋ ਸਾਫ਼ ਰਹੇ ਕਿ ਕੌਣ ਕਦੋਂ ਤੱਕ ਦੇਖ ਸਕਦਾ ਸੀ।",
  },
  familyMember: { en: "Family member", hi: "परिवार का सदस्य", pa: "ਪਰਿਵਾਰ ਦਾ ਮੈਂਬਰ" },
  familyRemove: { en: "Remove access", hi: "पहुँच हटाएँ", pa: "ਪਹੁੰਚ ਹਟਾਓ" },
  familyRemoveReason: {
    en: "Why are you removing their access?",
    hi: "आप उनकी पहुँच क्यों हटा रहे हैं?",
    pa: "ਤੁਸੀਂ ਉਹਨਾਂ ਦੀ ਪਹੁੰਚ ਕਿਉਂ ਹਟਾ ਰਹੇ ਹੋ?",
  },
  familyAddedOn: { en: "added", hi: "जोड़ा गया", pa: "ਜੋੜਿਆ ਗਿਆ" },
  familyRemovedOn: { en: "removed", hi: "हटाया गया", pa: "ਹਟਾਇਆ ਗਿਆ" },

  relSON: { en: "Son", hi: "बेटा", pa: "ਪੁੱਤਰ" },
  relDAUGHTER: { en: "Daughter", hi: "बेटी", pa: "ਧੀ" },
  relSPOUSE: { en: "Spouse", hi: "जीवनसाथी", pa: "ਜੀਵਨ ਸਾਥੀ" },
  relSIBLING: { en: "Brother or sister", hi: "भाई या बहन", pa: "ਭਰਾ ਜਾਂ ਭੈਣ" },
  relOTHER: { en: "Other family", hi: "अन्य परिजन", pa: "ਹੋਰ ਪਰਿਵਾਰ" },

  // --- what reaches the caregiver (Part 6.2) ---
  // NONE of these reassure. "Everything looks fine" is a claim this product cannot make -
  // it watches a handful of features for a few minutes a day. Silence means "nothing
  // crossed a threshold", and that is all it means. WATCH deliberately has no string here,
  // because WATCH does not notify (lib/notify.ts).
  needsAttention: { en: "Needs your attention", hi: "आपके ध्यान की ज़रूरत", pa: "ਤੁਹਾਡੇ ਧਿਆਨ ਦੀ ਲੋੜ" },
  notifyAlert: {
    en: "A change was seen across more than one area, on more than one day. Please speak to their doctor.",
    hi: "एक से अधिक क्षेत्रों में, एक से अधिक दिन बदलाव दिखा है। कृपया उनके डॉक्टर से बात करें।",
    pa: "ਇੱਕ ਤੋਂ ਵੱਧ ਖੇਤਰਾਂ ਵਿੱਚ, ਇੱਕ ਤੋਂ ਵੱਧ ਦਿਨ ਬਦਲਾਅ ਦਿਖਿਆ ਹੈ। ਕਿਰਪਾ ਕਰਕੇ ਉਹਨਾਂ ਦੇ ਡਾਕਟਰ ਨਾਲ ਗੱਲ ਕਰੋ।",
  },
  notifyAtypical: {
    en: "The pattern of change is not one-sided. That points somewhere different - worth asking their doctor about.",
    hi: "बदलाव का तरीका एक तरफ़ा नहीं है। यह किसी और ओर इशारा करता है - डॉक्टर से पूछना ठीक रहेगा।",
    pa: "ਬਦਲਾਅ ਦਾ ਤਰੀਕਾ ਇੱਕ ਪਾਸੇ ਦਾ ਨਹੀਂ ਹੈ। ਇਹ ਕਿਸੇ ਹੋਰ ਪਾਸੇ ਇਸ਼ਾਰਾ ਕਰਦਾ ਹੈ - ਡਾਕਟਰ ਤੋਂ ਪੁੱਛਣਾ ਠੀਕ ਰਹੇਗਾ।",
  },
  notifyMissed: {
    en: "No check-in for a few days. Without them there is nothing to compare against.",
    hi: "कुछ दिनों से कोई जाँच नहीं हुई। इनके बिना तुलना करने को कुछ नहीं होता।",
    pa: "ਕੁਝ ਦਿਨਾਂ ਤੋਂ ਕੋਈ ਜਾਂਚ ਨਹੀਂ ਹੋਈ। ਇਹਨਾਂ ਤੋਂ ਬਿਨਾਂ ਤੁਲਨਾ ਕਰਨ ਲਈ ਕੁਝ ਨਹੀਂ ਹੁੰਦਾ।",
  },
  notifyLowQuality: {
    en: "The last few check-ins were hard to read. More light, and the phone steady at arm's length, usually fixes it.",
    hi: "पिछली कुछ जाँचें साफ़ नहीं थीं। ज़्यादा रोशनी और फ़ोन को हाथ भर दूर स्थिर रखने से आमतौर पर ठीक हो जाता है।",
    pa: "ਪਿਛਲੀਆਂ ਕੁਝ ਜਾਂਚਾਂ ਸਾਫ਼ ਨਹੀਂ ਸਨ। ਵੱਧ ਰੌਸ਼ਨੀ ਅਤੇ ਫ਼ੋਨ ਨੂੰ ਬਾਂਹ ਦੀ ਦੂਰੀ 'ਤੇ ਸਥਿਰ ਰੱਖਣ ਨਾਲ ਆਮ ਤੌਰ 'ਤੇ ਠੀਕ ਹੋ ਜਾਂਦਾ ਹੈ।",
  },
  notifyAdherence: {
    en: "Check-ins have dropped off. The record is getting too thin to say much from.",
    hi: "जाँचें कम हो गई हैं। रिकॉर्ड इतना कम है कि उससे ज़्यादा कुछ नहीं कहा जा सकता।",
    pa: "ਜਾਂਚਾਂ ਘੱਟ ਹੋ ਗਈਆਂ ਹਨ। ਰਿਕਾਰਡ ਇੰਨਾ ਘੱਟ ਹੈ ਕਿ ਉਸ ਤੋਂ ਬਹੁਤਾ ਕੁਝ ਨਹੀਂ ਕਿਹਾ ਜਾ ਸਕਦਾ।",
  },

  // --- which session is due today (Part 6.6) ---
  // The patient must always know whether today is the short check-in or the longer one,
  // and roughly how long it will take, BEFORE they press begin. Durations come from the
  // server's own `estimated_seconds`, never a hardcoded number — D-045 is the whole reason
  // this is not written as a literal here.
  todayShort: { en: "Today is the short check-in", hi: "आज छोटी जाँच है", pa: "ਅੱਜ ਛੋਟੀ ਜਾਂਚ ਹੈ" },
  todayLong: { en: "Today is the longer check-in", hi: "आज लंबी जाँच है", pa: "ਅੱਜ ਲੰਬੀ ਜਾਂਚ ਹੈ" },
  aboutMinutes: { en: "About {n} minutes", hi: "लगभग {n} मिनट", pa: "ਲਗਭਗ {n} ਮਿੰਟ" },
  stepsCount: { en: "{n} short tasks", hi: "{n} छोटे काम", pa: "{n} ਛੋਟੇ ਕੰਮ" },
  restAnyTime: {
    en: "You can pause and rest at any point.",
    hi: "आप कभी भी रुककर आराम कर सकते हैं।",
    pa: "ਤੁਸੀਂ ਕਿਸੇ ਵੀ ਵੇਲੇ ਰੁਕ ਕੇ ਆਰਾਮ ਕਰ ਸਕਦੇ ਹੋ।",
  },

  // --- exam ---
  checkinTitle: { en: "Daily check-in", hi: "रोज़ाना जाँच", pa: "ਰੋਜ਼ਾਨਾ ਜਾਂਚ" },
  begin: { en: "Begin", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" },
  next: { en: "Next", hi: "आगे", pa: "ਅੱਗੇ" },
  listen: { en: "Play instruction again", hi: "निर्देश फिर सुनें", pa: "ਹਦਾਇਤ ਦੁਬਾਰਾ ਸੁਣੋ" },

  faceTitle: { en: "Look at the camera", hi: "कैमरे की ओर देखें", pa: "ਕੈਮਰੇ ਵੱਲ ਦੇਖੋ" },
  faceSmile: { en: "Smile widely", hi: "खुलकर मुस्कुराइए", pa: "ਖੁੱਲ੍ਹ ਕੇ ਮੁਸਕਰਾਓ" },
  faceBrows: { en: "Raise your eyebrows", hi: "भौंहें ऊपर उठाइए", pa: "ਭਰਵੱਟੇ ਉੱਪਰ ਚੁੱਕੋ" },
  faceEyes: { en: "Close your eyes tightly", hi: "आँखें कसकर बंद कीजिए", pa: "ਅੱਖਾਂ ਕੱਸ ਕੇ ਬੰਦ ਕਰੋ" },
  faceCheeks: { en: "Puff out your cheeks", hi: "गाल फुलाइए", pa: "ਗੱਲ੍ਹਾਂ ਫੁਲਾਓ" },

  speechSustain: { en: "Say 'aaah' and hold it", hi: "'आ' बोलिए और बनाए रखिए", pa: "'ਆ' ਬੋਲੋ ਅਤੇ ਕਾਇਮ ਰੱਖੋ" },
  speechDdk: { en: "Say 'pa-ta-ka' as fast as you can", hi: "जितनी तेज़ी से हो सके 'प-त-क' बोलिए", pa: "ਜਿੰਨੀ ਤੇਜ਼ੀ ਨਾਲ ਹੋ ਸਕੇ 'ਪ-ਤ-ਕ' ਬੋਲੋ" },
  speechSentence: { en: "Read this out loud", hi: "इसे ज़ोर से पढ़ें", pa: "ਇਸਨੂੰ ਉੱਚੀ ਪੜ੍ਹੋ" },
  sentenceText: {
    en: "The sun rose slowly over the quiet fields near our village.",
    hi: "हमारे गाँव के पास शांत खेतों पर सूरज धीरे-धीरे निकला।",
    pa: "ਸਾਡੇ ਪਿੰਡ ਕੋਲ ਸ਼ਾਂਤ ਖੇਤਾਂ ਉੱਤੇ ਸੂਰਜ ਹੌਲੀ-ਹੌਲੀ ਚੜ੍ਹਿਆ।",
  },

  tapWait: { en: "Wait for it…", hi: "इंतज़ार करें…", pa: "ਉਡੀਕ ਕਰੋ…" },
  tapNow: { en: "Tap", hi: "छुएँ", pa: "ਛੂਹੋ" },
  tapTooSoon: { en: "A little early — wait for the light", hi: "थोड़ा जल्दी — रोशनी का इंतज़ार करें", pa: "ਥੋੜ੍ਹਾ ਜਲਦੀ — ਰੌਸ਼ਨੀ ਦੀ ਉਡੀਕ ਕਰੋ" },

  handLeft: { en: "Use your LEFT hand", hi: "बाएँ हाथ का उपयोग करें", pa: "ਖੱਬਾ ਹੱਥ ਵਰਤੋ" },
  handRight: { en: "Now your RIGHT hand", hi: "अब दायाँ हाथ", pa: "ਹੁਣ ਸੱਜਾ ਹੱਥ" },

  moodTitle: { en: "Two quick questions", hi: "दो छोटे सवाल", pa: "ਦੋ ਛੋਟੇ ਸਵਾਲ" },
  phq1: {
    en: "Over the last two weeks, how often have you had little interest or pleasure in doing things?",
    hi: "पिछले दो हफ़्तों में, कितनी बार किसी काम में मन नहीं लगा?",
    pa: "ਪਿਛਲੇ ਦੋ ਹਫ਼ਤਿਆਂ ਵਿੱਚ, ਕਿੰਨੀ ਵਾਰ ਕਿਸੇ ਕੰਮ ਵਿੱਚ ਮਨ ਨਹੀਂ ਲੱਗਾ?",
  },
  phq2: {
    en: "And how often have you felt down, low or hopeless?",
    hi: "और कितनी बार उदास या निराश महसूस किया?",
    pa: "ਅਤੇ ਕਿੰਨੀ ਵਾਰ ਉਦਾਸ ਜਾਂ ਨਿਰਾਸ਼ ਮਹਿਸੂਸ ਕੀਤਾ?",
  },
  phqNever: { en: "Not at all", hi: "बिल्कुल नहीं", pa: "ਬਿਲਕੁਲ ਨਹੀਂ" },
  phqSome: { en: "Some days", hi: "कुछ दिन", pa: "ਕੁਝ ਦਿਨ" },
  phqMost: { en: "Most days", hi: "ज़्यादातर दिन", pa: "ਜ਼ਿਆਦਾਤਰ ਦਿਨ" },
  phqEvery: { en: "Nearly every day", hi: "लगभग हर दिन", pa: "ਲਗਭਗ ਹਰ ਦਿਨ" },

  medsTitle: { en: "Did you take today's medicines?", hi: "क्या आपने आज की दवाइयाँ लीं?", pa: "ਕੀ ਤੁਸੀਂ ਅੱਜ ਦੀਆਂ ਦਵਾਈਆਂ ਲਈਆਂ?" },
  yes: { en: "Yes", hi: "हाँ", pa: "ਹਾਂ" },
  no: { en: "No", hi: "नहीं", pa: "ਨਹੀਂ" },
  notYet: { en: "Not yet", hi: "अभी नहीं", pa: "ਹਾਲੇ ਨਹੀਂ" },

  uploading: { en: "Saving…", hi: "सहेजा जा रहा है…", pa: "ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ…" },
  allDone: { en: "All done ✓", hi: "हो गया ✓", pa: "ਹੋ ਗਿਆ ✓" },
  allDoneBody: {
    en: "Thank you. Today's check-in has been recorded.",
    hi: "धन्यवाद। आज की जाँच दर्ज हो गई है।",
    pa: "ਧੰਨਵਾਦ। ਅੱਜ ਦੀ ਜਾਂਚ ਦਰਜ ਹੋ ਗਈ ਹੈ।",
  },
  finish: { en: "Finish", hi: "समाप्त", pa: "ਸਮਾਪਤ" },

  retake: { en: "Let's try that again", hi: "इसे फिर से करते हैं", pa: "ਇਸਨੂੰ ਦੁਬਾਰਾ ਕਰਦੇ ਹਾਂ" },
  qualityTooNoisy: { en: "It was a bit noisy. Somewhere quieter?", hi: "थोड़ा शोर था। कहीं शांत जगह?", pa: "ਥੋੜ੍ਹਾ ਰੌਲਾ ਸੀ। ਕਿਤੇ ਸ਼ਾਂਤ ਥਾਂ?" },
  qualityNoSpeech: { en: "We could not hear you. A little louder?", hi: "हम आपको सुन नहीं पाए। थोड़ा तेज़?", pa: "ਅਸੀਂ ਤੁਹਾਨੂੰ ਸੁਣ ਨਹੀਂ ਸਕੇ। ਥੋੜ੍ਹਾ ਉੱਚਾ?" },
  qualityNoFace: { en: "We could not see your face clearly.", hi: "हम आपका चेहरा साफ़ नहीं देख पाए।", pa: "ਅਸੀਂ ਤੁਹਾਡਾ ਚਿਹਰਾ ਸਾਫ਼ ਨਹੀਂ ਦੇਖ ਸਕੇ।" },
  qualityTooLoud: { en: "That was very loud. A little softer?", hi: "बहुत तेज़ था। थोड़ा धीरे?", pa: "ਬਹੁਤ ਉੱਚਾ ਸੀ। ਥੋੜ੍ਹਾ ਹੌਲੀ?" },

  permissionDenied: {
    en: "We could not use the microphone or camera. Please allow it and try again.",
    hi: "हम माइक्रोफ़ोन या कैमरा नहीं खोल पाए। कृपया अनुमति दें और फिर कोशिश करें।",
    pa: "ਅਸੀਂ ਮਾਈਕ੍ਰੋਫ਼ੋਨ ਜਾਂ ਕੈਮਰਾ ਨਹੀਂ ਖੋਲ੍ਹ ਸਕੇ। ਕਿਰਪਾ ਕਰਕੇ ਇਜਾਜ਼ਤ ਦਿਓ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  unsupportedBrowser: {
    en: "This browser cannot record. Please use Chrome or Safari.",
    hi: "यह ब्राउज़र रिकॉर्ड नहीं कर सकता। कृपया Chrome या Safari का उपयोग करें।",
    pa: "ਇਹ ਬ੍ਰਾਊਜ਼ਰ ਰਿਕਾਰਡ ਨਹੀਂ ਕਰ ਸਕਦਾ। ਕਿਰਪਾ ਕਰਕੇ Chrome ਜਾਂ Safari ਵਰਤੋ।",
  },
  skipStep: { en: "Skip this one", hi: "इसे छोड़ें", pa: "ਇਹ ਛੱਡੋ" },

  // --- safety ---
  emergency: { en: "Emergency", hi: "आपातकाल", pa: "ਐਮਰਜੈਂਸੀ" },
  emergencyCall: { en: "Call 108 now", hi: "अभी 108 पर कॉल करें", pa: "ਹੁਣੇ 108 'ਤੇ ਕਾਲ ਕਰੋ" },
  reportSymptom: { en: "Something is wrong right now", hi: "अभी कुछ गड़बड़ है", pa: "ਹੁਣੇ ਕੁਝ ਗੜਬੜ ਹੈ" },
  acuteTitle: { en: "What are you seeing?", hi: "आप क्या देख रहे हैं?", pa: "ਤੁਸੀਂ ਕੀ ਦੇਖ ਰਹੇ ਹੋ?" },
  acuteHint: {
    en: "Select anything that started suddenly. This goes straight to emergency guidance — it is not scored or delayed.",
    hi: "जो कुछ अचानक शुरू हुआ हो उसे चुनें। यह सीधे आपातकालीन सलाह पर जाता है — इसकी गणना नहीं होती।",
    pa: "ਜੋ ਕੁਝ ਅਚਾਨਕ ਸ਼ੁਰੂ ਹੋਇਆ ਹੋਵੇ ਉਹ ਚੁਣੋ। ਇਹ ਸਿੱਧਾ ਐਮਰਜੈਂਸੀ ਸਲਾਹ 'ਤੇ ਜਾਂਦਾ ਹੈ।",
  },
  acuteSubmit: { en: "Get help now", hi: "अभी मदद लें", pa: "ਹੁਣੇ ਮਦਦ ਲਵੋ" },

  // --- dashboard ---
  // ---- the caregiver dashboard's instrumentation row. ----
  metricCheckins: { en: "Check-ins recorded", hi: "दर्ज जाँचें", pa: "ਦਰਜ ਜਾਂਚਾਂ" },
  metricCheckinsContext: { en: "Sessions on record", hi: "रिकॉर्ड में जाँचें", pa: "ਰਿਕਾਰਡ ਵਿੱਚ ਜਾਂਚਾਂ" },
  metricLastCheckin: { en: "Last check-in", hi: "पिछली जाँच", pa: "ਪਿਛਲੀ ਜਾਂਚ" },
  metricMedContext: {
    en: "{pct}% of the last 30 days",
    hi: "पिछले 30 दिनों का {pct}%",
    pa: "ਪਿਛਲੇ 30 ਦਿਨਾਂ ਦਾ {pct}%",
  },
  metricBaselineLabel: { en: "Personal baseline", hi: "निजी सामान्य स्तर", pa: "ਨਿੱਜੀ ਆਮ ਪੱਧਰ" },
  metricBaselineReady: { en: "Ready", hi: "तैयार", pa: "ਤਿਆਰ" },
  metricNone: { en: "—", hi: "—", pa: "—" },
  status: { en: "Status", hi: "स्थिति", pa: "ਸਥਿਤੀ" },
  bandStable: { en: "As usual", hi: "रोज़ जैसा", pa: "ਰੋਜ਼ ਵਾਂਗ" },
  bandWatch: { en: "Worth watching", hi: "ध्यान देने योग्य", pa: "ਧਿਆਨ ਦੇਣ ਯੋਗ" },
  bandAlert: { en: "Please check on them", hi: "उनका हाल देखें", pa: "ਉਹਨਾਂ ਦਾ ਹਾਲ ਦੇਖੋ" },
  // Not a louder ALERT. The change here is on both sides of the body, which is not the
  // pattern a stroke makes — so the wording sends them to an appointment, not to a check
  // on someone right now. Saying "please check on them" would be the wrong urgency AND
  // point at the wrong condition.
  bandAtypical: {
    en: "Worth a doctor's appointment",
    hi: "डॉक्टर से मिलने का समय लें",
    pa: "ਡਾਕਟਰ ਨਾਲ ਮਿਲਣ ਦਾ ਸਮਾਂ ਲਵੋ",
  },
  confidence: { en: "Confidence", hi: "विश्वास", pa: "ਭਰੋਸਾ" },
  becauseOf: { en: "Bear in mind", hi: "ध्यान रखें", pa: "ਧਿਆਨ ਰੱਖੋ" },
  domainTrends: { en: "What we measure", hi: "हम क्या मापते हैं", pa: "ਅਸੀਂ ਕੀ ਮਾਪਦੇ ਹਾਂ" },
  deviationAxis: { en: "Difference from their usual", hi: "उनके सामान्य से अंतर", pa: "ਉਹਨਾਂ ਦੇ ਆਮ ਤੋਂ ਫ਼ਰਕ" },
  alertLine: { en: "Alert threshold", hi: "अलर्ट सीमा", pa: "ਅਲਰਟ ਸੀਮਾ" },
  normalBand: { en: "Their usual range", hi: "उनका सामान्य दायरा", pa: "ਉਹਨਾਂ ਦਾ ਆਮ ਦਾਇਰਾ" },
  history: { en: "History", hi: "इतिहास", pa: "ਇਤਿਹਾਸ" },
  alertLog: { en: "Alerts", hi: "अलर्ट", pa: "ਅਲਰਟ" },
  noAlerts: { en: "No alerts so far.", hi: "अब तक कोई अलर्ट नहीं।", pa: "ਹੁਣ ਤੱਕ ਕੋਈ ਅਲਰਟ ਨਹੀਂ।" },
  noData: { en: "No check-ins yet.", hi: "अभी कोई जाँच नहीं।", pa: "ਹਾਲੇ ਕੋਈ ਜਾਂਚ ਨਹੀਂ।" },
  date: { en: "Date", hi: "तारीख़", pa: "ਤਾਰੀਖ਼" },
  explanation: { en: "What we saw", hi: "हमने क्या देखा", pa: "ਅਸੀਂ ਕੀ ਦੇਖਿਆ" },
  baselineProgress: { en: "Learning their normal", hi: "उनका सामान्य स्तर सीख रहे हैं", pa: "ਉਹਨਾਂ ਦਾ ਆਮ ਪੱਧਰ ਸਿੱਖ ਰਹੇ ਹਾਂ" },
  sessionsRecorded: { en: "sessions recorded", hi: "जाँच दर्ज", pa: "ਜਾਂਚਾਂ ਦਰਜ" },
  baselineNote: {
    en: "Comparison starts once we have enough sessions to know what is usual for them.",
    hi: "जब उनके सामान्य स्तर के लिए पर्याप्त जाँच हो जाएँगी, तब तुलना शुरू होगी।",
    pa: "ਜਦੋਂ ਉਹਨਾਂ ਦੇ ਆਮ ਪੱਧਰ ਲਈ ਕਾਫ਼ੀ ਜਾਂਚਾਂ ਹੋ ਜਾਣਗੀਆਂ, ਤਾਂ ਤੁਲਨਾ ਸ਼ੁਰੂ ਹੋਵੇਗੀ।",
  },
  adherence: { en: "Medicines taken", hi: "दवाइयाँ ली गईं", pa: "ਦਵਾਈਆਂ ਲਈਆਂ" },
  dayStreak: { en: "day streak", hi: "दिन लगातार", pa: "ਦਿਨ ਲਗਾਤਾਰ" },
  readOnly: { en: "Read-only view", hi: "केवल पढ़ने के लिए", pa: "ਸਿਰਫ਼ ਪੜ੍ਹਨ ਲਈ" },

  // --- clinician ---
  clinicTitle: { en: "Patients", hi: "मरीज़", pa: "ਮਰੀਜ਼" },
  clinicSubtitle: {
    en: "Ranked by sustained deviation from each patient's own baseline.",
    hi: "हर मरीज़ के अपने आधार से लगातार विचलन के अनुसार क्रमित।",
    pa: "ਹਰ ਮਰੀਜ਼ ਦੇ ਆਪਣੇ ਆਧਾਰ ਤੋਂ ਲਗਾਤਾਰ ਵਿਚਲਨ ਅਨੁਸਾਰ ਕ੍ਰਮਬੱਧ।",
  },
  acknowledge: { en: "Acknowledge", hi: "स्वीकार करें", pa: "ਸਵੀਕਾਰ ਕਰੋ" },
  lastSession: { en: "Last session", hi: "पिछली जाँच", pa: "ਪਿਛਲੀ ਜਾਂਚ" },
  domains: { en: "Domains", hi: "क्षेत्र", pa: "ਖੇਤਰ" },

  // ======================================================= the rest of the product
  // Added when the language toggle was made to hold across the WHOLE app. Every screen
  // below used to be English-only regardless of the choice, which meant a Punjabi
  // household read a Punjabi exam and then an English page of findings about it.

  // ---- errors that reach a screen ----
  errDashboard: {
    en: "Could not load the dashboard.",
    hi: "डैशबोर्ड लोड नहीं हो सका।",
    pa: "ਡੈਸ਼ਬੋਰਡ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕਿਆ।",
  },
  errGeneric: {
    en: "Something went wrong.",
    hi: "कुछ गड़बड़ हो गई।",
    pa: "ਕੁਝ ਗੜਬੜ ਹੋ ਗਈ।",
  },
  nothingYet: { en: "Nothing yet.", hi: "अभी कुछ नहीं।", pa: "ਹਾਲੇ ਕੁਝ ਨਹੀਂ।" },

  // ---- the wearable lanes. INV-5: we own the trend, the vendor owns the measurement. ----
  fallReported: {
    en: "A fall was reported {when}",
    hi: "गिरने की सूचना मिली {when}",
    pa: "ਡਿੱਗਣ ਦੀ ਸੂਚਨਾ ਮਿਲੀ {when}",
  },
  fallDismissed: {
    en: "They dismissed it on the watch. Check anyway — people dismiss falls they are embarrassed by, or confused after.",
    hi: "उन्होंने इसे घड़ी पर हटा दिया। फिर भी देख लीजिए — लोग शर्मिंदगी में, या गिरने के बाद उलझन में, सूचना हटा देते हैं।",
    pa: "ਉਹਨਾਂ ਨੇ ਇਸਨੂੰ ਘੜੀ 'ਤੇ ਹਟਾ ਦਿੱਤਾ। ਫਿਰ ਵੀ ਵੇਖ ਲਵੋ — ਲੋਕ ਸ਼ਰਮਿੰਦਗੀ ਵਿੱਚ, ਜਾਂ ਡਿੱਗਣ ਤੋਂ ਬਾਅਦ ਉਲਝਣ ਵਿੱਚ, ਸੂਚਨਾ ਹਟਾ ਦਿੰਦੇ ਹਨ।",
  },
  fallChecked: {
    en: "I have checked on them",
    hi: "मैंने उन्हें देख लिया है",
    pa: "ਮੈਂ ਉਹਨਾਂ ਨੂੰ ਵੇਖ ਲਿਆ ਹੈ",
  },
  wearableTitle: { en: "From their watch", hi: "उनकी घड़ी से", pa: "ਉਹਨਾਂ ਦੀ ਘੜੀ ਤੋਂ" },
  wearableSource: {
    en: "Recorded by {source} — shown here as a trend. NeuroTrace does not measure these; the device maker does.",
    hi: "{source} ने दर्ज किया — यहाँ केवल रुझान दिखाया गया है। NeuroTrace इन्हें नहीं मापता; उपकरण बनाने वाला मापता है।",
    pa: "{source} ਨੇ ਦਰਜ ਕੀਤਾ — ਇੱਥੇ ਸਿਰਫ਼ ਰੁਝਾਨ ਦਿਖਾਇਆ ਗਿਆ ਹੈ। NeuroTrace ਇਹਨਾਂ ਨੂੰ ਨਹੀਂ ਮਾਪਦਾ; ਯੰਤਰ ਬਣਾਉਣ ਵਾਲਾ ਮਾਪਦਾ ਹੈ।",
  },
  wearableDevice: { en: "the device", hi: "उपकरण", pa: "ਯੰਤਰ" },
  wearableReadings: {
    en: "{n} readings · {from} – {to}",
    hi: "{n} रीडिंग · {from} – {to}",
    pa: "{n} ਰੀਡਿੰਗ · {from} – {to}",
  },
  wearableTrend: { en: "trend", hi: "रुझान", pa: "ਰੁਝਾਨ" },
  metricHeartRate: { en: "Heart rate", hi: "धड़कन", pa: "ਧੜਕਣ" },
  metricIrregular: {
    en: "Irregular rhythm notifications",
    hi: "अनियमित धड़कन की सूचनाएँ",
    pa: "ਅਨਿਯਮਿਤ ਧੜਕਣ ਦੀਆਂ ਸੂਚਨਾਵਾਂ",
  },
  metricSleep: { en: "Sleep quality", hi: "नींद की गुणवत्ता", pa: "ਨੀਂਦ ਦੀ ਗੁਣਵੱਤਾ" },
  metricSteps: { en: "Steps", hi: "क़दम", pa: "ਕਦਮ" },
  metricSpo2: { en: "Blood oxygen", hi: "रक्त ऑक्सीजन", pa: "ਖ਼ੂਨ ਆਕਸੀਜਨ" },
  metricBpUpper: {
    en: "Blood pressure (upper)",
    hi: "रक्तचाप (ऊपरी)",
    pa: "ਬਲੱਡ ਪ੍ਰੈਸ਼ਰ (ਉੱਪਰਲਾ)",
  },
  metricBpLower: {
    en: "Blood pressure (lower)",
    hi: "रक्तचाप (निचला)",
    pa: "ਬਲੱਡ ਪ੍ਰੈਸ਼ਰ (ਹੇਠਲਾ)",
  },

  // ---- balance / craniocorpography ----
  balanceTrace: { en: "Balance trace", hi: "संतुलन का नक़्शा", pa: "ਸੰਤੁਲਨ ਦਾ ਨਕਸ਼ਾ" },
  balanceTraceTitle: {
    en: "Balance — movement trace",
    hi: "संतुलन — गति का नक़्शा",
    pa: "ਸੰਤੁਲਨ — ਗਤੀ ਦਾ ਨਕਸ਼ਾ",
  },
  ccgTests: { en: "{done}/{total} tests", hi: "{total} में से {done} जाँचें", pa: "{total} ਵਿੱਚੋਂ {done} ਜਾਂਚਾਂ" },
  ccgStart: { en: "Start of path", hi: "रास्ते की शुरुआत", pa: "ਰਾਹ ਦੀ ਸ਼ੁਰੂਆਤ" },
  ccgEnd: { en: "End of path", hi: "रास्ते का अंत", pa: "ਰਾਹ ਦਾ ਅੰਤ" },
  ccgStartShort: { en: "start", hi: "शुरू", pa: "ਸ਼ੁਰੂ" },
  ccgEndShort: { en: "end", hi: "अंत", pa: "ਅੰਤ" },
  ccgToTheRight: { en: "{deg}° to the right", hi: "{deg}° दाईं ओर", pa: "{deg}° ਸੱਜੇ ਪਾਸੇ" },
  ccgToTheLeft: { en: "{deg}° to the left", hi: "{deg}° बाईं ओर", pa: "{deg}° ਖੱਬੇ ਪਾਸੇ" },
  ccgPartial: {
    en: "Partial capture — some tests need someone present and were not recorded.",
    hi: "अधूरी रिकॉर्डिंग — कुछ जाँचों के लिए किसी का साथ होना ज़रूरी है और वे दर्ज नहीं हुईं।",
    pa: "ਅਧੂਰੀ ਰਿਕਾਰਡਿੰਗ — ਕੁਝ ਜਾਂਚਾਂ ਲਈ ਕਿਸੇ ਦਾ ਨਾਲ ਹੋਣਾ ਜ਼ਰੂਰੀ ਹੈ ਅਤੇ ਉਹ ਦਰਜ ਨਹੀਂ ਹੋਈਆਂ।",
  },
  ccgNoLaterality: {
    en: "Sway is measured; the direction of deviation is not.",
    hi: "डोलना मापा गया है; विचलन की दिशा नहीं।",
    pa: "ਡੋਲਣਾ ਮਾਪਿਆ ਗਿਆ ਹੈ; ਵਿਚਲਨ ਦੀ ਦਿਸ਼ਾ ਨਹੀਂ।",
  },
  ccgNoPath: {
    en: "No movement path recorded for this session.",
    hi: "इस जाँच के लिए कोई गति-पथ दर्ज नहीं हुआ।",
    pa: "ਇਸ ਜਾਂਚ ਲਈ ਕੋਈ ਗਤੀ-ਪਥ ਦਰਜ ਨਹੀਂ ਹੋਇਆ।",
  },
  ccgUnits: {
    en: "Distances are in centimetres, scaled using head width as the reference. The lighter dot marks the start, the darker one the finish. This reproduces the layout of a clinical craniocorpography report so it can be read the same way.",
    hi: "दूरियाँ सेंटीमीटर में हैं, सिर की चौड़ाई को पैमाना मानकर। हल्का बिंदु शुरुआत है, गहरा बिंदु अंत। यह क्लीनिकल क्रेनियोकॉर्पोग्राफ़ी रिपोर्ट के ढाँचे जैसा ही है, ताकि उसी तरह पढ़ा जा सके।",
    pa: "ਦੂਰੀਆਂ ਸੈਂਟੀਮੀਟਰ ਵਿੱਚ ਹਨ, ਸਿਰ ਦੀ ਚੌੜਾਈ ਨੂੰ ਪੈਮਾਨਾ ਮੰਨ ਕੇ। ਹਲਕਾ ਬਿੰਦੂ ਸ਼ੁਰੂਆਤ ਹੈ, ਗੂੜ੍ਹਾ ਬਿੰਦੂ ਅੰਤ। ਇਹ ਕਲੀਨਿਕਲ ਕ੍ਰੇਨੀਓਕਾਰਪੋਗ੍ਰਾਫ਼ੀ ਰਿਪੋਰਟ ਦੇ ਢਾਂਚੇ ਵਰਗਾ ਹੀ ਹੈ, ਤਾਂ ਜੋ ਉਸੇ ਤਰ੍ਹਾਂ ਪੜ੍ਹਿਆ ਜਾ ਸਕੇ।",
  },
  ccgMetricUnterbergerPath: {
    en: "Unterberger sway path", hi: "उन्टरबर्गर डोलन-पथ", pa: "ਉਨਟਰਬਰਗਰ ਡੋਲਣ-ਪਥ",
  },
  ccgMetricAngular: { en: "Angular deviation", hi: "कोणीय विचलन", pa: "ਕੋਣੀ ਵਿਚਲਨ" },
  ccgMetricTandemWalk: {
    en: "Tandem walking sway", hi: "एक-रेखा चाल में डोलना", pa: "ਇੱਕ-ਰੇਖਾ ਚਾਲ ਵਿੱਚ ਡੋਲਣਾ",
  },
  ccgMetricTandemStance: {
    en: "Tandem stance sway", hi: "एक-रेखा खड़े होकर डोलना", pa: "ਇੱਕ-ਰੇਖਾ ਖੜ੍ਹੇ ਹੋ ਕੇ ਡੋਲਣਾ",
  },
  ccgMetricRombergOpen: {
    en: "Romberg sway (eyes open)", hi: "रॉमबर्ग डोलन (आँखें खुली)", pa: "ਰੌਮਬਰਗ ਡੋਲਣ (ਅੱਖਾਂ ਖੁੱਲ੍ਹੀਆਂ)",
  },
  ccgMetricRombergClosed: {
    en: "Romberg sway (eyes closed)", hi: "रॉमबर्ग डोलन (आँखें बंद)", pa: "ਰੌਮਬਰਗ ਡੋਲਣ (ਅੱਖਾਂ ਬੰਦ)",
  },
  ccgMetricRombergQuotient: { en: "Romberg quotient", hi: "रॉमबर्ग अनुपात", pa: "ਰੌਮਬਰਗ ਅਨੁਪਾਤ" },

  // ---- the reference-vs-today comparison ----
  ccgReferenceOn: { en: "Reference · {date}", hi: "आधार · {date}", pa: "ਆਧਾਰ · {date}" },
  ccgReferenceNone: {
    en: "Reference · not available", hi: "आधार · उपलब्ध नहीं", pa: "ਆਧਾਰ · ਉਪਲਬਧ ਨਹੀਂ",
  },
  ccgNoBaseline: {
    en: "No locked baseline yet, so there is nothing to compare against.",
    hi: "अभी कोई आधार तय नहीं हुआ है, इसलिए तुलना के लिए कुछ नहीं है।",
    pa: "ਹਾਲੇ ਕੋਈ ਆਧਾਰ ਤੈਅ ਨਹੀਂ ਹੋਇਆ, ਇਸ ਲਈ ਤੁਲਨਾ ਲਈ ਕੁਝ ਨਹੀਂ ਹੈ।",
  },
  ccgLatestOn: { en: "Latest · {date}", hi: "ताज़ा · {date}", pa: "ਤਾਜ਼ਾ · {date}" },
  ccgDaysLater: { en: "{n} days later", hi: "{n} दिन बाद", pa: "{n} ਦਿਨ ਬਾਅਦ" },
  ccgPartialLead: { en: "Partial capture.", hi: "अधूरी रिकॉर्डिंग।", pa: "ਅਧੂਰੀ ਰਿਕਾਰਡਿੰਗ।" },
  ccgPartialBoth: { en: "either capture", hi: "दोनों रिकॉर्डिंग", pa: "ਦੋਵੇਂ ਰਿਕਾਰਡਿੰਗਾਂ" },
  ccgPartialLatest: { en: "the latest capture", hi: "ताज़ा रिकॉर्डिंग", pa: "ਤਾਜ਼ਾ ਰਿਕਾਰਡਿੰਗ" },
  ccgPartialReference: { en: "the reference capture", hi: "आधार रिकॉर्डिंग", pa: "ਆਧਾਰ ਰਿਕਾਰਡਿੰਗ" },
  ccgPartialBody: {
    en: "The walking and stepping tests need someone present and were not recorded in {which}. Sway is measured; the direction of deviation is not, so any laterality reading from balance is unavailable for this comparison.",
    hi: "चलने और क़दम गिनने की जाँचों के लिए किसी का साथ होना ज़रूरी है और वे {which} में दर्ज नहीं हुईं। डोलना मापा गया है; विचलन की दिशा नहीं, इसलिए इस तुलना में संतुलन से पक्ष का पता नहीं चल सकता।",
    pa: "ਤੁਰਨ ਅਤੇ ਕਦਮ ਗਿਣਨ ਦੀਆਂ ਜਾਂਚਾਂ ਲਈ ਕਿਸੇ ਦਾ ਨਾਲ ਹੋਣਾ ਜ਼ਰੂਰੀ ਹੈ ਅਤੇ ਉਹ {which} ਵਿੱਚ ਦਰਜ ਨਹੀਂ ਹੋਈਆਂ। ਡੋਲਣਾ ਮਾਪਿਆ ਗਿਆ ਹੈ; ਵਿਚਲਨ ਦੀ ਦਿਸ਼ਾ ਨਹੀਂ, ਇਸ ਲਈ ਇਸ ਤੁਲਨਾ ਵਿੱਚ ਸੰਤੁਲਨ ਤੋਂ ਪਾਸੇ ਦਾ ਪਤਾ ਨਹੀਂ ਲੱਗ ਸਕਦਾ।",
  },
  ccgColMeasure: { en: "Measure ({units})", hi: "माप ({units})", pa: "ਮਾਪ ({units})" },
  ccgColReference: { en: "Reference", hi: "आधार", pa: "ਆਧਾਰ" },
  ccgColLatest: { en: "Latest", hi: "ताज़ा", pa: "ਤਾਜ਼ਾ" },
  ccgColChange: { en: "Change", hi: "बदलाव", pa: "ਬਦਲਾਅ" },
  ccgNoColourNote: {
    en: "Change is shown as direction and magnitude only. A smaller sway area is not necessarily an improvement — bracing, or being steadied by someone, produces the same reduction with no change in vestibular function.",
    hi: "बदलाव केवल दिशा और मात्रा के रूप में दिखाया गया है। कम डोलना ज़रूरी नहीं कि सुधार हो — सहारा लेने से, या किसी के थामने से, वही कमी आती है जबकि संतुलन-तंत्र में कोई बदलाव नहीं होता।",
    pa: "ਬਦਲਾਅ ਸਿਰਫ਼ ਦਿਸ਼ਾ ਅਤੇ ਮਾਤਰਾ ਵਜੋਂ ਦਿਖਾਇਆ ਗਿਆ ਹੈ। ਘੱਟ ਡੋਲਣਾ ਜ਼ਰੂਰੀ ਨਹੀਂ ਕਿ ਸੁਧਾਰ ਹੋਵੇ — ਸਹਾਰਾ ਲੈਣ ਨਾਲ, ਜਾਂ ਕਿਸੇ ਦੇ ਫੜਨ ਨਾਲ, ਓਹੀ ਕਮੀ ਆਉਂਦੀ ਹੈ ਜਦਕਿ ਸੰਤੁਲਨ-ਤੰਤਰ ਵਿੱਚ ਕੋਈ ਬਦਲਾਅ ਨਹੀਂ ਹੁੰਦਾ।",
  },
  ccgTestUnterberger: {
    en: "Unterberger stepping (eyes closed)",
    hi: "उन्टरबर्गर क़दमताल (आँखें बंद)",
    pa: "ਉਨਟਰਬਰਗਰ ਕਦਮਤਾਲ (ਅੱਖਾਂ ਬੰਦ)",
  },
  ccgTestTandemWalk: { en: "Tandem walking", hi: "एक-रेखा चाल", pa: "ਇੱਕ-ਰੇਖਾ ਚਾਲ" },
  ccgTestTandemStance: {
    en: "Tandem stance", hi: "एक-रेखा पर खड़े होना", pa: "ਇੱਕ-ਰੇਖਾ 'ਤੇ ਖੜ੍ਹੇ ਹੋਣਾ",
  },
  ccgTestRombergClosed: {
    en: "Romberg — eyes closed", hi: "रॉमबर्ग — आँखें बंद", pa: "ਰੌਮਬਰਗ — ਅੱਖਾਂ ਬੰਦ",
  },
  ccgTestRombergOpen: {
    en: "Romberg — eyes open", hi: "रॉमबर्ग — आँखें खुली", pa: "ਰੌਮਬਰਗ — ਅੱਖਾਂ ਖੁੱਲ੍ਹੀਆਂ",
  },
  ccgPlotLabel: {
    en: "{test}: movement path, {units}",
    hi: "{test}: गति-पथ, {units}",
    pa: "{test}: ਗਤੀ-ਪਥ, {units}",
  },
  openReport: {
    en: "Open printable report", hi: "छपने योग्य रिपोर्ट खोलें", pa: "ਛਪਣਯੋਗ ਰਿਪੋਰਟ ਖੋਲ੍ਹੋ",
  },

  // ---- the clinician roster ----
  sustainedVsBaseline: {
    en: "{n} {domains} ({list}) sustained vs this patient's own baseline · {conf} {pct}%",
    hi: "{n} {domains} ({list}) इस मरीज़ के अपने आधार की तुलना में लगातार · {conf} {pct}%",
    pa: "{n} {domains} ({list}) ਇਸ ਮਰੀਜ਼ ਦੇ ਆਪਣੇ ਆਧਾਰ ਦੇ ਮੁਕਾਬਲੇ ਲਗਾਤਾਰ · {conf} {pct}%",
  },
  clinicMethod: {
    en: "All deviations are measured against each patient's own median/MAD baseline using a robust z-score and a Reliable Change Index. An alert requires two independent domains to exceed threshold across two consecutive valid sessions. This is a monitoring aid; clinical interpretation remains with you.",
    hi: "हर विचलन उसी मरीज़ के अपने median/MAD आधार के मुक़ाबले, robust z-score और विश्वसनीय-परिवर्तन सूचकांक (RCI) से मापा जाता है। अलर्ट के लिए दो स्वतंत्र क्षेत्रों का लगातार दो वैध जाँचों में सीमा पार करना ज़रूरी है। यह निगरानी में सहायक है; नैदानिक व्याख्या आपकी ही रहती है।",
    pa: "ਹਰ ਵਿਚਲਨ ਉਸੇ ਮਰੀਜ਼ ਦੇ ਆਪਣੇ median/MAD ਆਧਾਰ ਦੇ ਮੁਕਾਬਲੇ, robust z-score ਅਤੇ ਭਰੋਸੇਯੋਗ-ਤਬਦੀਲੀ ਸੂਚਕਾਂਕ (RCI) ਨਾਲ ਮਾਪਿਆ ਜਾਂਦਾ ਹੈ। ਅਲਰਟ ਲਈ ਦੋ ਸੁਤੰਤਰ ਖੇਤਰਾਂ ਦਾ ਲਗਾਤਾਰ ਦੋ ਜਾਇਜ਼ ਜਾਂਚਾਂ ਵਿੱਚ ਹੱਦ ਪਾਰ ਕਰਨਾ ਜ਼ਰੂਰੀ ਹੈ। ਇਹ ਨਿਗਰਾਨੀ ਵਿੱਚ ਸਹਾਇਕ ਹੈ; ਕਲੀਨਿਕਲ ਵਿਆਖਿਆ ਤੁਹਾਡੀ ਹੀ ਰਹਿੰਦੀ ਹੈ।",
  },

  // ---- the listener view (Awaaz). Opened by a stranger, after the language gate. ----
  listenExpired: {
    en: "This link has expired", hi: "यह लिंक समाप्त हो चुका है", pa: "ਇਹ ਲਿੰਕ ਖ਼ਤਮ ਹੋ ਚੁੱਕਾ ਹੈ",
  },
  listenExpiredBody: {
    en: "Listener links last a short time on purpose. Ask for a new one.",
    hi: "सुनने के लिंक जान-बूझकर थोड़े समय के लिए होते हैं। नया लिंक माँग लीजिए।",
    pa: "ਸੁਣਨ ਵਾਲੇ ਲਿੰਕ ਜਾਣ-ਬੁੱਝ ਕੇ ਥੋੜ੍ਹੇ ਸਮੇਂ ਲਈ ਹੁੰਦੇ ਹਨ। ਨਵਾਂ ਲਿੰਕ ਮੰਗ ਲਵੋ।",
  },
  connecting: { en: "Connecting…", hi: "जुड़ रहे हैं…", pa: "ਜੁੜ ਰਹੇ ਹਾਂ…" },
  listenWith: { en: "You are listening with", hi: "आप सुन रहे हैं", pa: "ਤੁਸੀਂ ਸੁਣ ਰਹੇ ਹੋ" },
  listenHowToHelp: { en: "HOW TO HELP", hi: "कैसे मदद करें", pa: "ਕਿਵੇਂ ਮਦਦ ਕਰੀਏ" },
  listenSaid: {
    en: "What they have said", hi: "उन्होंने क्या कहा है", pa: "ਉਹਨਾਂ ਨੇ ਕੀ ਕਿਹਾ ਹੈ",
  },
  listenNothing: {
    en: "Nothing yet. Give them time — waiting is the help.",
    hi: "अभी कुछ नहीं। उन्हें समय दीजिए — इंतज़ार करना ही मदद है।",
    pa: "ਹਾਲੇ ਕੁਝ ਨਹੀਂ। ਉਹਨਾਂ ਨੂੰ ਸਮਾਂ ਦਿਓ — ਉਡੀਕਣਾ ਹੀ ਮਦਦ ਹੈ।",
  },
  listenExpiresIn: {
    en: "This link expires in about {n} minutes.",
    hi: "यह लिंक लगभग {n} मिनट में समाप्त हो जाएगा।",
    pa: "ਇਹ ਲਿੰਕ ਲਗਭਗ {n} ਮਿੰਟ ਵਿੱਚ ਖ਼ਤਮ ਹੋ ਜਾਵੇਗਾ।",
  },
  listenPrivacy: {
    en: "You are seeing only what they chose to say. No health information, no history, and no recording — theirs or yours.",
    hi: "आप केवल वही देख रहे हैं जो उन्होंने कहना चुना। कोई स्वास्थ्य जानकारी नहीं, कोई इतिहास नहीं, और कोई रिकॉर्डिंग नहीं — न उनकी, न आपकी।",
    pa: "ਤੁਸੀਂ ਸਿਰਫ਼ ਉਹੀ ਵੇਖ ਰਹੇ ਹੋ ਜੋ ਉਹਨਾਂ ਨੇ ਕਹਿਣਾ ਚੁਣਿਆ। ਕੋਈ ਸਿਹਤ ਜਾਣਕਾਰੀ ਨਹੀਂ, ਕੋਈ ਇਤਿਹਾਸ ਨਹੀਂ, ਅਤੇ ਕੋਈ ਰਿਕਾਰਡਿੰਗ ਨਹੀਂ — ਨਾ ਉਹਨਾਂ ਦੀ, ਨਾ ਤੁਹਾਡੀ।",
  },

  // ---- the dizziness handicap inventory ----
  dhiTitle: {
    en: "Dizziness questionnaire", hi: "चक्कर की प्रश्नावली", pa: "ਚੱਕਰ ਦੀ ਪ੍ਰਸ਼ਨਾਵਲੀ",
  },
  dhiIntro: {
    en: "{n} questions about the last month. There are no wrong answers.",
    hi: "पिछले महीने के बारे में {n} सवाल। कोई जवाब ग़लत नहीं होता।",
    pa: "ਪਿਛਲੇ ਮਹੀਨੇ ਬਾਰੇ {n} ਸਵਾਲ। ਕੋਈ ਜਵਾਬ ਗ਼ਲਤ ਨਹੀਂ ਹੁੰਦਾ।",
  },
  dhiAnswered: {
    en: "{done} of {total} answered",
    hi: "{total} में से {done} के जवाब दिए",
    pa: "{total} ਵਿੱਚੋਂ {done} ਦੇ ਜਵਾਬ ਦਿੱਤੇ",
  },
  dhiSaving: { en: "Saving…", hi: "सहेजा जा रहा है…", pa: "ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ…" },
  dhiSave: { en: "Save answers", hi: "जवाब सहेजें", pa: "ਜਵਾਬ ਸੰਭਾਲੋ" },
  dhiLeft: { en: "{n} left", hi: "{n} बाक़ी", pa: "{n} ਬਾਕੀ" },
  dhiSaveError: {
    en: "Could not save the answers",
    hi: "जवाब सहेजे नहीं जा सके",
    pa: "ਜਵਾਬ ਸੰਭਾਲੇ ਨਹੀਂ ਜਾ ਸਕੇ",
  },
  dhiSinceLast: {
    en: "{delta} since last time.",
    hi: "पिछली बार से {delta}।",
    pa: "ਪਿਛਲੀ ਵਾਰ ਤੋਂ {delta}।",
  },
  dhiMeaningful: {
    en: "That is a real change and is worth mentioning to their doctor.",
    hi: "यह असली बदलाव है और डॉक्टर को बताने लायक़ है।",
    pa: "ਇਹ ਅਸਲੀ ਬਦਲਾਅ ਹੈ ਅਤੇ ਡਾਕਟਰ ਨੂੰ ਦੱਸਣ ਯੋਗ ਹੈ।",
  },
  dhiWithinNoise: {
    en: "Changes smaller than {mdc} points are within this questionnaire's own margin of error, so this is not a sign that anything has changed.",
    hi: "{mdc} अंक से कम का बदलाव इस प्रश्नावली की अपनी त्रुटि-सीमा के भीतर है, इसलिए यह किसी बदलाव का संकेत नहीं है।",
    pa: "{mdc} ਅੰਕ ਤੋਂ ਘੱਟ ਦਾ ਬਦਲਾਅ ਇਸ ਪ੍ਰਸ਼ਨਾਵਲੀ ਦੀ ਆਪਣੀ ਗ਼ਲਤੀ-ਹੱਦ ਦੇ ਅੰਦਰ ਹੈ, ਇਸ ਲਈ ਇਹ ਕਿਸੇ ਬਦਲਾਅ ਦਾ ਸੰਕੇਤ ਨਹੀਂ ਹੈ।",
  },
  dhiFooter: {
    en: "This records how much dizziness is getting in the way of daily life. It is what the person tells us, not a measurement of their balance.",
    hi: "यह दर्ज करता है कि चक्कर रोज़मर्रा के जीवन में कितनी बाधा डाल रहे हैं। यह वही है जो व्यक्ति हमें बताता है, उनके संतुलन का माप नहीं।",
    pa: "ਇਹ ਦਰਜ ਕਰਦਾ ਹੈ ਕਿ ਚੱਕਰ ਰੋਜ਼ਾਨਾ ਜੀਵਨ ਵਿੱਚ ਕਿੰਨੀ ਰੁਕਾਵਟ ਪਾ ਰਹੇ ਹਨ। ਇਹ ਉਹੀ ਹੈ ਜੋ ਵਿਅਕਤੀ ਸਾਨੂੰ ਦੱਸਦਾ ਹੈ, ਉਹਨਾਂ ਦੇ ਸੰਤੁਲਨ ਦਾ ਮਾਪ ਨਹੀਂ।",
  },

  // ---- the ASHA worker's field view ----
  ashaEyebrow: { en: "Field visits", hi: "क्षेत्र दौरे", pa: "ਖੇਤਰੀ ਦੌਰੇ" },
  ashaTitle: { en: "My households", hi: "मेरे घर", pa: "ਮੇਰੇ ਘਰ" },
  ashaOnline: { en: "Online", hi: "ऑनलाइन", pa: "ਆਨਲਾਈਨ" },
  ashaOffline: {
    en: "No connection — visits are saved",
    hi: "कनेक्शन नहीं — दौरे सहेजे जा रहे हैं",
    pa: "ਕੁਨੈਕਸ਼ਨ ਨਹੀਂ — ਦੌਰੇ ਸੰਭਾਲੇ ਜਾ ਰਹੇ ਹਨ",
  },
  ashaPending: {
    en: "{n} visits saved on this device, waiting to send.",
    hi: "{n} दौरे इस उपकरण पर सहेजे हैं, भेजे जाने बाक़ी हैं।",
    pa: "{n} ਦੌਰੇ ਇਸ ਯੰਤਰ 'ਤੇ ਸੰਭਾਲੇ ਹਨ, ਭੇਜੇ ਜਾਣੇ ਬਾਕੀ ਹਨ।",
  },
  ashaSending: { en: "Sending…", hi: "भेजा जा रहा है…", pa: "ਭੇਜਿਆ ਜਾ ਰਿਹਾ ਹੈ…" },
  ashaSendNow: { en: "Send now", hi: "अभी भेजें", pa: "ਹੁਣੇ ਭੇਜੋ" },
  ashaSavedList: {
    en: "Showing your saved list — no connection right now.",
    hi: "आपकी सहेजी हुई सूची दिख रही है — अभी कनेक्शन नहीं है।",
    pa: "ਤੁਹਾਡੀ ਸੰਭਾਲੀ ਸੂਚੀ ਦਿਖ ਰਹੀ ਹੈ — ਹੁਣ ਕੁਨੈਕਸ਼ਨ ਨਹੀਂ ਹੈ।",
  },
  ashaLoadError: {
    en: "Could not load your households",
    hi: "आपके घर लोड नहीं हो सके",
    pa: "ਤੁਹਾਡੇ ਘਰ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ",
  },
  ashaSendError: { en: "Could not send", hi: "भेजा नहीं जा सका", pa: "ਭੇਜਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ" },
  ashaNoHouseholds: {
    en: "No households are assigned to you yet.",
    hi: "अभी आपको कोई घर नहीं सौंपा गया है।",
    pa: "ਹਾਲੇ ਤੁਹਾਨੂੰ ਕੋਈ ਘਰ ਨਹੀਂ ਸੌਂਪਿਆ ਗਿਆ।",
  },
  ashaYears: { en: "{n} years", hi: "{n} साल", pa: "{n} ਸਾਲ" },
  ashaLastCheckin: { en: "Last check-in", hi: "पिछली जाँच", pa: "ਪਿਛਲੀ ਜਾਂਚ" },
  ashaLastVisit: { en: "Last visit", hi: "पिछला दौरा", pa: "ਪਿਛਲਾ ਦੌਰਾ" },
  ashaNone: { en: "none", hi: "कोई नहीं", pa: "ਕੋਈ ਨਹੀਂ" },
  // INV-12: these are the fall-risk tasks, which exist only in a supervised visit.
  ashaDoThese: {
    en: "Do these on this visit", hi: "इस दौरे में ये कीजिए", pa: "ਇਸ ਦੌਰੇ ਵਿੱਚ ਇਹ ਕਰੋ",
  },
  ashaFamilyRest: {
    en: "The family does the rest at home. Do not repeat those.",
    hi: "बाक़ी काम परिवार घर पर करता है। उन्हें दोबारा न कराएँ।",
    pa: "ਬਾਕੀ ਕੰਮ ਪਰਿਵਾਰ ਘਰ 'ਤੇ ਕਰਦਾ ਹੈ। ਉਹਨਾਂ ਨੂੰ ਦੁਬਾਰਾ ਨਾ ਕਰਾਓ।",
  },
  ashaNothingDue: {
    en: "Nothing needs a visit this month.",
    hi: "इस महीने किसी दौरे की ज़रूरत नहीं।",
    pa: "ਇਸ ਮਹੀਨੇ ਕਿਸੇ ਦੌਰੇ ਦੀ ਲੋੜ ਨਹੀਂ।",
  },
  ashaVisitSent: { en: "Visit sent ✓", hi: "दौरा भेजा गया ✓", pa: "ਦੌਰਾ ਭੇਜਿਆ ਗਿਆ ✓" },
  ashaVisitSaved: {
    en: "Saved — will send", hi: "सहेजा — भेज दिया जाएगा", pa: "ਸੰਭਾਲਿਆ — ਭੇਜ ਦਿੱਤਾ ਜਾਵੇਗਾ",
  },
  ashaRecordVisit: { en: "Record visit", hi: "दौरा दर्ज करें", pa: "ਦੌਰਾ ਦਰਜ ਕਰੋ" },
  ashaNotSent: {
    en: "Not sent yet: {error}. It is saved and will retry.",
    hi: "अभी भेजा नहीं गया: {error}। यह सहेजा है और दोबारा कोशिश होगी।",
    pa: "ਹਾਲੇ ਭੇਜਿਆ ਨਹੀਂ ਗਿਆ: {error}। ਇਹ ਸੰਭਾਲਿਆ ਹੈ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਹੋਵੇਗੀ।",
  },
  taskTandemWalk: { en: "Tandem walking", hi: "एक-रेखा चाल", pa: "ਇੱਕ-ਰੇਖਾ ਚਾਲ" },
  taskUnterberger: {
    en: "Stepping on the spot, eyes closed",
    hi: "एक ही जगह क़दमताल, आँखें बंद",
    pa: "ਇੱਕੋ ਥਾਂ ਕਦਮਤਾਲ, ਅੱਖਾਂ ਬੰਦ",
  },
  taskLineBisection: { en: "Line bisection", hi: "रेखा को बीच से बाँटना", pa: "ਰੇਖਾ ਨੂੰ ਵਿਚਕਾਰੋਂ ਵੰਡਣਾ" },
  taskStarCancellation: { en: "Star cancellation", hi: "तारे काटना", pa: "ਤਾਰੇ ਕੱਟਣਾ" },
  taskSmoothPursuit: {
    en: "Follow the moving dot", hi: "चलते बिंदु का पीछा कीजिए", pa: "ਚੱਲਦੇ ਬਿੰਦੂ ਦਾ ਪਿੱਛਾ ਕਰੋ",
  },
  taskRandomSaccades: { en: "Look at each dot", hi: "हर बिंदु को देखिए", pa: "ਹਰ ਬਿੰਦੂ ਨੂੰ ਵੇਖੋ" },
  taskTimedUpAndGo: { en: "Stand, walk, sit", hi: "खड़े हों, चलें, बैठें", pa: "ਖੜ੍ਹੇ ਹੋਵੋ, ਤੁਰੋ, ਬੈਠੋ" },

  // ---- the printable clinician report ----
  reportPrintHint: {
    en: "Use your browser's print dialog and choose Save as PDF.",
    hi: "अपने ब्राउज़र के प्रिंट विकल्प में जाकर \"PDF के रूप में सहेजें\" चुनिए।",
    pa: "ਆਪਣੇ ਬ੍ਰਾਊਜ਼ਰ ਦੇ ਪ੍ਰਿੰਟ ਵਿਕਲਪ ਵਿੱਚ ਜਾ ਕੇ \"PDF ਵਜੋਂ ਸੰਭਾਲੋ\" ਚੁਣੋ।",
  },
  reportPrint: {
    en: "Print / Save as PDF", hi: "प्रिंट / PDF सहेजें", pa: "ਪ੍ਰਿੰਟ / PDF ਸੰਭਾਲੋ",
  },
  reportTitle: {
    en: "NeuroTrace — monitoring report",
    hi: "NeuroTrace — निगरानी रिपोर्ट",
    pa: "NeuroTrace — ਨਿਗਰਾਨੀ ਰਿਪੋਰਟ",
  },
  reportGenerated: {
    en: "Generated {when} · covers the most recent {n} scored sessions",
    hi: "{when} को बनाई गई · सबसे हाल की {n} अंकित जाँचों को शामिल करती है",
    pa: "{when} ਨੂੰ ਬਣਾਈ ਗਈ · ਸਭ ਤੋਂ ਤਾਜ਼ਾ {n} ਅੰਕਿਤ ਜਾਂਚਾਂ ਸ਼ਾਮਲ ਕਰਦੀ ਹੈ",
  },
  reportPatient: { en: "Patient", hi: "मरीज़", pa: "ਮਰੀਜ਼" },
  reportAgeSex: { en: "Age / sex", hi: "उम्र / लिंग", pa: "ਉਮਰ / ਲਿੰਗ" },
  reportSide: { en: "Affected side", hi: "प्रभावित पक्ष", pa: "ਪ੍ਰਭਾਵਿਤ ਪਾਸਾ" },
  reportStrokeDate: { en: "Stroke date", hi: "स्ट्रोक की तारीख़", pa: "ਸਟ੍ਰੋਕ ਦੀ ਤਾਰੀਖ਼" },
  reportEnrolled: { en: "Enrolled", hi: "पंजीकरण", pa: "ਦਾਖ਼ਲਾ" },
  reportBaseline: { en: "Baseline", hi: "आधार", pa: "ਆਧਾਰ" },
  reportModulesLocked: {
    en: "({locked}/{total} modules locked)",
    hi: "({total} में से {locked} मॉड्यूल तय)",
    pa: "({total} ਵਿੱਚੋਂ {locked} ਮਾਡਿਊਲ ਤੈਅ)",
  },
  reportUnlockedLead: {
    en: "Baseline is not locked.", hi: "आधार अभी तय नहीं है।", pa: "ਆਧਾਰ ਹਾਲੇ ਤੈਅ ਨਹੀਂ ਹੈ।",
  },
  reportUnlockedBody: {
    en: "Deviations below are provisional: they are measured against a window that is still being collected, so both the median and the spread will move. Bands should not be acted on clinically until the baseline locks.",
    hi: "नीचे दिए विचलन अस्थायी हैं: वे एक ऐसी अवधि के मुक़ाबले मापे गए हैं जो अभी इकट्ठी हो रही है, इसलिए median और फैलाव दोनों बदलेंगे। आधार तय होने तक बैंड पर नैदानिक कार्रवाई नहीं करनी चाहिए।",
    pa: "ਹੇਠਾਂ ਦਿੱਤੇ ਵਿਚਲਨ ਆਰਜ਼ੀ ਹਨ: ਉਹ ਇੱਕ ਅਜਿਹੇ ਸਮੇਂ ਦੇ ਮੁਕਾਬਲੇ ਮਾਪੇ ਗਏ ਹਨ ਜੋ ਹਾਲੇ ਇਕੱਠਾ ਹੋ ਰਿਹਾ ਹੈ, ਇਸ ਲਈ median ਅਤੇ ਫੈਲਾਅ ਦੋਵੇਂ ਬਦਲਣਗੇ। ਆਧਾਰ ਤੈਅ ਹੋਣ ਤੱਕ ਬੈਂਡ 'ਤੇ ਕਲੀਨਿਕਲ ਕਾਰਵਾਈ ਨਹੀਂ ਕਰਨੀ ਚਾਹੀਦੀ।",
  },
  reportSessionHistory: { en: "Session history", hi: "जाँचों का इतिहास", pa: "ਜਾਂਚਾਂ ਦਾ ਇਤਿਹਾਸ" },
  reportColDate: { en: "Date", hi: "तारीख़", pa: "ਤਾਰੀਖ਼" },
  reportColBand: { en: "Band", hi: "बैंड", pa: "ਬੈਂਡ" },
  reportColGates: { en: "Gates", hi: "गेट", pa: "ਗੇਟ" },
  reportColLateralised: { en: "Lateralised", hi: "पक्ष-विशेष", pa: "ਪਾਸਾ-ਵਿਸ਼ੇਸ਼" },
  reportColReason: { en: "Reason", hi: "कारण", pa: "ਕਾਰਨ" },
  reportConfounders: {
    en: "Confounders active: {list}",
    hi: "सक्रिय भ्रामक कारक: {list}",
    pa: "ਸਰਗਰਮ ਭਰਮਾਊ ਕਾਰਕ: {list}",
  },
  reportBaselines: { en: "Baselines", hi: "आधार", pa: "ਆਧਾਰ" },
  reportColModule: { en: "Module", hi: "मॉड्यूल", pa: "ਮਾਡਿਊਲ" },
  reportColLocked: { en: "Locked", hi: "तय", pa: "ਤੈਅ" },
  reportColSessionsUsed: {
    en: "Sessions used", hi: "इस्तेमाल हुई जाँचें", pa: "ਵਰਤੀਆਂ ਜਾਂਚਾਂ",
  },
  reportColRejected: { en: "Rejected", hi: "अस्वीकृत", pa: "ਰੱਦ" },
  reportColWindow: { en: "Window", hi: "अवधि", pa: "ਸਮਾਂ-ਸੀਮਾ" },
  reportYes: { en: "yes", hi: "हाँ", pa: "ਹਾਂ" },
  reportNo: { en: "no", hi: "नहीं", pa: "ਨਹੀਂ" },
  reportMethod: { en: "Method", hi: "विधि", pa: "ਵਿਧੀ" },
  // The disclaimer at the foot of the printed report. INV-13 territory: it is frozen
  // copy, so all three renderings say exactly the same thing.
  reportLimitation: {
    en: "NeuroTrace monitors change over days against a person's own baseline. It cannot detect an acute stroke and must not be used to rule one out. Sudden weakness, drooping, speech loss or severe headache is an emergency regardless of what any band on this page says.",
    hi: "NeuroTrace किसी व्यक्ति के अपने आधार के मुक़ाबले कई दिनों में होने वाले बदलाव पर नज़र रखता है। यह होते हुए स्ट्रोक को नहीं पकड़ सकता और इससे स्ट्रोक को ख़ारिज नहीं किया जा सकता। अचानक कमज़ोरी, चेहरे का लटकना, बोली का जाना या तेज़ सिरदर्द आपातकाल है, चाहे इस पन्ने पर कोई भी बैंड लिखा हो।",
    pa: "NeuroTrace ਕਿਸੇ ਵਿਅਕਤੀ ਦੇ ਆਪਣੇ ਆਧਾਰ ਦੇ ਮੁਕਾਬਲੇ ਕਈ ਦਿਨਾਂ ਵਿੱਚ ਹੋਣ ਵਾਲੇ ਬਦਲਾਅ 'ਤੇ ਨਜ਼ਰ ਰੱਖਦਾ ਹੈ। ਇਹ ਹੁੰਦੇ ਹੋਏ ਸਟ੍ਰੋਕ ਨੂੰ ਨਹੀਂ ਫੜ ਸਕਦਾ ਅਤੇ ਇਸ ਨਾਲ ਸਟ੍ਰੋਕ ਨੂੰ ਰੱਦ ਨਹੀਂ ਕੀਤਾ ਜਾ ਸਕਦਾ। ਅਚਾਨਕ ਕਮਜ਼ੋਰੀ, ਚਿਹਰੇ ਦਾ ਲਟਕਣਾ, ਬੋਲੀ ਦਾ ਜਾਣਾ ਜਾਂ ਤੇਜ਼ ਸਿਰਦਰਦ ਐਮਰਜੈਂਸੀ ਹੈ, ਭਾਵੇਂ ਇਸ ਪੰਨੇ 'ਤੇ ਕੋਈ ਵੀ ਬੈਂਡ ਲਿਖਿਆ ਹੋਵੇ।",
  },

  // ---- the operator console ----
  // The clinical band names, as a clinician reads them on a printed report. Distinct from
  // bandStable/bandWatch/bandAlert, which are the caregiver's plain-language wording
  // ("Please check on them") and would be wrong in a table column headed "Band".
  bandStableShort: { en: "Stable", hi: "स्थिर", pa: "ਸਥਿਰ" },
  bandWatchShort: { en: "Watch", hi: "निगरानी", pa: "ਨਿਗਰਾਨੀ" },
  bandAlertShort: { en: "Alert", hi: "अलर्ट", pa: "ਅਲਰਟ" },
  bandAtypicalShort: { en: "Atypical pattern", hi: "असामान्य पैटर्न", pa: "ਅਸਾਧਾਰਨ ਪੈਟਰਨ" },
  gatePersist: { en: "persist", hi: "निरंतर", pa: "ਨਿਰੰਤਰ" },
  gateCross: { en: "cross", hi: "अंतर-विधा", pa: "ਅੰਤਰ-ਵਿਧਾ" },
  gateLateral: { en: "lateral", hi: "पक्ष", pa: "ਪਾਸਾ" },

  adminPatients: { en: "Patients", hi: "मरीज़", pa: "ਮਰੀਜ਼" },
  adminFinishedSetup: {
    en: "{n} finished setup", hi: "{n} ने सेटअप पूरा किया", pa: "{n} ਨੇ ਸੈੱਟਅੱਪ ਪੂਰਾ ਕੀਤਾ",
  },
  adminUsers: { en: "Users", hi: "उपयोक्ता", pa: "ਵਰਤੋਂਕਾਰ" },
  adminSessions: { en: "Sessions", hi: "जाँचें", pa: "ਜਾਂਚਾਂ" },
  adminLast7: {
    en: "{n} in the last 7 days", hi: "पिछले 7 दिनों में {n}", pa: "ਪਿਛਲੇ 7 ਦਿਨਾਂ ਵਿੱਚ {n}",
  },
  adminModules: { en: "Modules captured", hi: "दर्ज मॉड्यूल", pa: "ਦਰਜ ਮਾਡਿਊਲ" },
  adminQualityFlagged: {
    en: "{n} quality-flagged",
    hi: "{n} गुणवत्ता के लिए चिह्नित",
    pa: "{n} ਗੁਣਵੱਤਾ ਲਈ ਨਿਸ਼ਾਨਬੱਧ",
  },

  // Fallbacks for when a request fails without a message the server can phrase itself.
  errLoadPatients: {
    en: "Could not load patients", hi: "मरीज़ लोड नहीं हो सके", pa: "ਮਰੀਜ਼ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੇ",
  },
  errEnrolPatient: {
    en: "Could not enrol the patient",
    hi: "मरीज़ का पंजीकरण नहीं हो सका",
    pa: "ਮਰੀਜ਼ ਦਾ ਦਾਖ਼ਲਾ ਨਹੀਂ ਹੋ ਸਕਿਆ",
  },
  errLoadFamilyMember: {
    en: "Could not load your family member",
    hi: "आपके परिजन की जानकारी लोड नहीं हो सकी",
    pa: "ਤੁਹਾਡੇ ਪਰਿਵਾਰਕ ਮੈਂਬਰ ਦੀ ਜਾਣਕਾਰੀ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ",
  },
  errLoadPatientList: {
    en: "Could not load the patient list",
    hi: "मरीज़ों की सूची लोड नहीं हो सकी",
    pa: "ਮਰੀਜ਼ਾਂ ਦੀ ਸੂਚੀ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ",
  },
  errLoadProfile: {
    en: "Could not load your profile",
    hi: "आपकी प्रोफ़ाइल लोड नहीं हो सकी",
    pa: "ਤੁਹਾਡੀ ਪ੍ਰੋਫ਼ਾਈਲ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ",
  },
  errLoadFamilyAccess: {
    en: "Could not load family access",
    hi: "पारिवारिक पहुँच लोड नहीं हो सकी",
    pa: "ਪਰਿਵਾਰਕ ਪਹੁੰਚ ਲੋਡ ਨਹੀਂ ਹੋ ਸਕੀ",
  },
  errRemoveAccess: {
    en: "Could not remove access", hi: "पहुँच हटाई नहीं जा सकी", pa: "ਪਹੁੰਚ ਹਟਾਈ ਨਹੀਂ ਜਾ ਸਕੀ",
  },
  errAddFamilyMember: {
    en: "Could not add this family member",
    hi: "यह परिजन जोड़े नहीं जा सके",
    pa: "ਇਹ ਪਰਿਵਾਰਕ ਮੈਂਬਰ ਜੋੜਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ",
  },

  adminScored: { en: "Scored", hi: "अंकित", pa: "ਅੰਕਿਤ" },
  adminGate1: { en: "1 · Persistence", hi: "1 · निरंतरता", pa: "1 · ਨਿਰੰਤਰਤਾ" },
  adminGate2: { en: "2 · Cross-modality", hi: "2 · अंतर-विधा", pa: "2 · ਅੰਤਰ-ਵਿਧਾ" },
  adminGate3: { en: "3 · Laterality", hi: "3 · पक्षधरता", pa: "3 · ਪਾਸਾ-ਨਿਰਧਾਰਨ" },
  adminOfScored: { en: "of scored", hi: "अंकित में से", pa: "ਅੰਕਿਤ ਵਿੱਚੋਂ" },
  adminBands: { en: "Bands", hi: "बैंड", pa: "ਬੈਂਡ" },
  adminBaselines: { en: "Baselines", hi: "आधार", pa: "ਆਧਾਰ" },
  adminUsersByRole: { en: "Users by role", hi: "भूमिका के अनुसार उपयोक्ता", pa: "ਭੂਮਿਕਾ ਅਨੁਸਾਰ ਵਰਤੋਂਕਾਰ" },
  adminSamePerson: { en: "Same-person check", hi: "एक ही व्यक्ति की जाँच", pa: "ਇੱਕੋ ਵਿਅਕਤੀ ਦੀ ਜਾਂਚ" },
  adminPatientsEnrolled: { en: "patients enrolled", hi: "मरीज़ पंजीकृत", pa: "ਮਰੀਜ਼ ਦਾਖ਼ਲ" },
  adminSessionsChecked: { en: "sessions checked", hi: "जाँचें परखी गईं", pa: "ਜਾਂਚਾਂ ਪਰਖੀਆਂ ਗਈਆਂ" },
  adminFlagged: { en: "flagged as uncertain", hi: "अनिश्चित के रूप में चिह्नित", pa: "ਅਨਿਸ਼ਚਿਤ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ" },
  adminAudit: { en: "Audit trail · append-only", hi: "ऑडिट रिकॉर्ड · केवल जोड़ा जा सकता है", pa: "ਆਡਿਟ ਰਿਕਾਰਡ · ਸਿਰਫ਼ ਜੋੜਿਆ ਜਾ ਸਕਦਾ ਹੈ" },
  adminNothingRecorded: { en: "Nothing recorded yet.", hi: "अभी कुछ दर्ज नहीं है।", pa: "ਹਾਲੇ ਕੁਝ ਦਰਜ ਨਹੀਂ ਹੈ।" },

  faceMeshAlt: {
    en: "Diagram of the facial regions the examination measures",
    hi: "जाँच जिन चेहरे के हिस्सों को मापती है, उनका आरेख",
    pa: "ਜਾਂਚ ਜਿਨ੍ਹਾਂ ਚਿਹਰੇ ਦੇ ਹਿੱਸਿਆਂ ਨੂੰ ਮਾਪਦੀ ਹੈ, ਉਹਨਾਂ ਦਾ ਚਿੱਤਰ",
  },
} as const;

export type StringKey = keyof typeof STRINGS;

/** Domain codes as the caregiver should read them. */
export const DOMAIN_LABELS: Record<string, Record<Lang, string>> = {
  cranial_nerves: { en: "Face", hi: "चेहरा", pa: "ਚਿਹਰਾ" },
  speech_language: { en: "Speech", hi: "बोली", pa: "ਬੋਲੀ" },
  // Present in the engine's registry (exam/registry.py) but missing here, so every chart
  // and roster row carrying one printed the bare code — "motor speech", "posterior
  // vestibular" — in English under a Hindi or Punjabi heading.
  motor_speech: { en: "Speech clarity", hi: "बोली की स्पष्टता", pa: "ਬੋਲੀ ਦੀ ਸਪਸ਼ਟਤਾ" },
  language: { en: "Words and meaning", hi: "शब्द और अर्थ", pa: "ਸ਼ਬਦ ਅਤੇ ਅਰਥ" },
  posterior_vestibular: { en: "Eyes and balance", hi: "आँखें और संतुलन", pa: "ਅੱਖਾਂ ਅਤੇ ਸੰਤੁਲਨ" },
  motor: { en: "Hands and arms", hi: "हाथ और बाँहें", pa: "ਹੱਥ ਅਤੇ ਬਾਂਹਾਂ" },
  coordination_gait: { en: "Balance", hi: "संतुलन", pa: "ਸੰਤੁਲਨ" },
  cognition: { en: "Attention", hi: "ध्यान", pa: "ਧਿਆਨ" },
  mood_fatigue_function: { en: "Mood and energy", hi: "मनोदशा और ऊर्जा", pa: "ਮਨੋਦਸ਼ਾ ਅਤੇ ਊਰਜਾ" },
  vitals_prevention: { en: "Heart and medicines", hi: "दिल और दवाइयाँ", pa: "ਦਿਲ ਅਤੇ ਦਵਾਈਆਂ" },
};

/** The Intl locale for a language. Was an identical ternary in eight components; one of
 *  them is enough, and a new language then only has to be added here. */
export const LOCALES: Record<Lang, string> = {
  en: "en-IN", hi: "hi-IN", pa: "pa-IN",
};

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Intl locale for `lang` — dates and numbers follow the choice too, not just words. */
  locale: string;
  t: (key: StringKey) => string;
  domain: (code: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = readLang() ?? "en";
    // Set on first paint, not only on change. Without this the document carries no `lang`
    // until someone switches language, so a screen reader announces Hindi and Punjabi
    // content with an English voice on the very screens that most need to be spoken.
    document.documentElement.lang = initial;
    return initial;
  });

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeLang(next);
    document.documentElement.lang = next;
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      locale: LOCALES[lang],
      t: (key: StringKey) => STRINGS[key][lang],
      domain: (code: string) => DOMAIN_LABELS[code]?.[lang] ?? code.replace(/_/g, " "),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

export const LANGS: Lang[] = ["en", "hi", "pa"];
export const LANG_NAMES: Record<Lang, string> = { en: "EN", hi: "हिं", pa: "ਪੰ" };
