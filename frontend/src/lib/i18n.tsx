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
  orDivider: { en: "or", hi: "या", pa: "ਜਾਂ" },
  // Clinician roster summary: the metrics row above the list.
  linkedToYou: {
    en: "Linked to you, with consent in force",
    hi: "आपसे जुड़े, सहमति लागू है",
    pa: "ਤੁਹਾਡੇ ਨਾਲ ਜੁੜੇ, ਸਹਿਮਤੀ ਲਾਗੂ ਹੈ",
  },
  // Mono caps eyebrows above a page title — the landing page's own vocabulary.
  signInEyebrow: { en: "Secure sign-in", hi: "सुरक्षित साइन-इन", pa: "ਸੁਰੱਖਿਅਤ ਸਾਈਨ-ਇਨ" },
  clinicEyebrow: { en: "Clinician", hi: "चिकित्सक", pa: "ਡਾਕਟਰ" },
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
  stepOf: { en: "Step", hi: "चरण", pa: "ਪੜਾਅ" },
  of: { en: "of", hi: "में से", pa: "ਵਿੱਚੋਂ" },
  begin: { en: "Begin", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" },
  next: { en: "Next", hi: "आगे", pa: "ਅੱਗੇ" },
  listen: { en: "Play instruction again", hi: "निर्देश फिर सुनें", pa: "ਹਦਾਇਤ ਦੁਬਾਰਾ ਸੁਣੋ" },

  faceTitle: { en: "Look at the camera", hi: "कैमरे की ओर देखें", pa: "ਕੈਮਰੇ ਵੱਲ ਦੇਖੋ" },
  faceSmile: { en: "Smile widely", hi: "खुलकर मुस्कुराइए", pa: "ਖੁੱਲ੍ਹ ਕੇ ਮੁਸਕਰਾਓ" },
  faceBrows: { en: "Raise your eyebrows", hi: "भौंहें ऊपर उठाइए", pa: "ਭਰਵੱਟੇ ਉੱਪਰ ਚੁੱਕੋ" },
  faceEyes: { en: "Close your eyes tightly", hi: "आँखें कसकर बंद कीजिए", pa: "ਅੱਖਾਂ ਕੱਸ ਕੇ ਬੰਦ ਕਰੋ" },
  faceCheeks: { en: "Puff out your cheeks", hi: "गाल फुलाइए", pa: "ਗੱਲ੍ਹਾਂ ਫੁਲਾਓ" },

  speechTitle: { en: "Now your voice", hi: "अब आपकी आवाज़", pa: "ਹੁਣ ਤੁਹਾਡੀ ਆਵਾਜ਼" },
  speechSustain: { en: "Say 'aaah' and hold it", hi: "'आ' बोलिए और बनाए रखिए", pa: "'ਆ' ਬੋਲੋ ਅਤੇ ਕਾਇਮ ਰੱਖੋ" },
  speechDdk: { en: "Say 'pa-ta-ka' as fast as you can", hi: "जितनी तेज़ी से हो सके 'प-त-क' बोलिए", pa: "ਜਿੰਨੀ ਤੇਜ਼ੀ ਨਾਲ ਹੋ ਸਕੇ 'ਪ-ਤ-ਕ' ਬੋਲੋ" },
  speechSentence: { en: "Read this out loud", hi: "इसे ज़ोर से पढ़ें", pa: "ਇਸਨੂੰ ਉੱਚੀ ਪੜ੍ਹੋ" },
  sentenceText: {
    en: "The sun rose slowly over the quiet fields near our village.",
    hi: "हमारे गाँव के पास शांत खेतों पर सूरज धीरे-धीरे निकला।",
    pa: "ਸਾਡੇ ਪਿੰਡ ਕੋਲ ਸ਼ਾਂਤ ਖੇਤਾਂ ਉੱਤੇ ਸੂਰਜ ਹੌਲੀ-ਹੌਲੀ ਚੜ੍ਹਿਆ।",
  },

  tapTitle: { en: "Tap when the circle turns blue", hi: "जब घेरा नीला हो, तब दबाएँ", pa: "ਜਦੋਂ ਗੋਲਾ ਨੀਲਾ ਹੋਵੇ, ਦਬਾਓ" },
  tapWait: { en: "Wait…", hi: "रुकिए…", pa: "ਰੁਕੋ…" },
  tapNow: { en: "TAP", hi: "दबाएँ", pa: "ਦਬਾਓ" },
  tapTooSoon: { en: "Too soon — wait for blue", hi: "बहुत जल्दी — नीले का इंतज़ार करें", pa: "ਬਹੁਤ ਜਲਦੀ — ਨੀਲੇ ਦੀ ਉਡੀਕ ਕਰੋ" },
  trial: { en: "Tap", hi: "टैप", pa: "ਟੈਪ" },

  handTitle: { en: "Tap as fast as you can", hi: "जितनी तेज़ी से हो सके दबाएँ", pa: "ਜਿੰਨੀ ਤੇਜ਼ੀ ਨਾਲ ਹੋ ਸਕੇ ਦਬਾਓ" },
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
  skipStep: { en: "Skip this step", hi: "यह चरण छोड़ें", pa: "ਇਹ ਪੜਾਅ ਛੱਡੋ" },

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
} as const;

export type StringKey = keyof typeof STRINGS;

/** Domain codes as the caregiver should read them. */
export const DOMAIN_LABELS: Record<string, Record<Lang, string>> = {
  cranial_nerves: { en: "Face", hi: "चेहरा", pa: "ਚਿਹਰਾ" },
  speech_language: { en: "Speech", hi: "बोली", pa: "ਬੋਲੀ" },
  motor: { en: "Hands and arms", hi: "हाथ और बाँहें", pa: "ਹੱਥ ਅਤੇ ਬਾਂਹਾਂ" },
  coordination_gait: { en: "Balance", hi: "संतुलन", pa: "ਸੰਤੁਲਨ" },
  cognition: { en: "Attention", hi: "ध्यान", pa: "ਧਿਆਨ" },
  mood_fatigue_function: { en: "Mood and energy", hi: "मनोदशा और ऊर्जा", pa: "ਮਨੋਦਸ਼ਾ ਅਤੇ ਊਰਜਾ" },
  vitals_prevention: { en: "Heart and medicines", hi: "दिल और दवाइयाँ", pa: "ਦਿਲ ਅਤੇ ਦਵਾਈਆਂ" },
};

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
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
