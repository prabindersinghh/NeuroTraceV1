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
  awaazListenerActive: {
    en: "This link can show new confirmed messages until it expires. Stop sharing when the conversation ends.",
    hi: "यह लिंक समाप्त होने तक नए पुष्ट संदेश दिखा सकता है। बातचीत खत्म होने पर साझा करना बंद करें।",
    pa: "ਇਹ ਲਿੰਕ ਮਿਆਦ ਖ਼ਤਮ ਹੋਣ ਤੱਕ ਨਵੇਂ ਪੁਸ਼ਟੀ ਕੀਤੇ ਸੁਨੇਹੇ ਦਿਖਾ ਸਕਦਾ ਹੈ। ਗੱਲਬਾਤ ਮੁੱਕਣ 'ਤੇ ਸਾਂਝਾ ਕਰਨਾ ਬੰਦ ਕਰੋ।",
  },
  awaazListenerCreated: {
    en: "Listening link created. It is shown below.",
    hi: "सुनने वाला लिंक बन गया है। यह नीचे दिख रहा है।",
    pa: "ਸੁਣਨ ਵਾਲਾ ਲਿੰਕ ਬਣ ਗਿਆ ਹੈ। ਇਹ ਹੇਠਾਂ ਦਿਖ ਰਿਹਾ ਹੈ।",
  },
  awaazListenerCopied: {
    en: "Listening link copied.",
    hi: "सुनने वाला लिंक कॉपी हो गया।",
    pa: "ਸੁਣਨ ਵਾਲਾ ਲਿੰਕ ਕਾਪੀ ਹੋ ਗਿਆ।",
  },
  awaazListenerCopyFailed: {
    en: "The link is active but could not be copied automatically. Copy the address shown below.",
    hi: "लिंक चालू है लेकिन अपने-आप कॉपी नहीं हुआ। नीचे दिखा पता कॉपी करें।",
    pa: "ਲਿੰਕ ਚਾਲੂ ਹੈ ਪਰ ਆਪਣੇ ਆਪ ਕਾਪੀ ਨਹੀਂ ਹੋਇਆ। ਹੇਠਾਂ ਦਿਖਾਇਆ ਪਤਾ ਕਾਪੀ ਕਰੋ।",
  },
  awaazListenerRevoke: {
    en: "Stop sharing this link",
    hi: "यह लिंक साझा करना बंद करें",
    pa: "ਇਹ ਲਿੰਕ ਸਾਂਝਾ ਕਰਨਾ ਬੰਦ ਕਰੋ",
  },
  awaazListenerRevoking: {
    en: "Stopping sharing…",
    hi: "साझा करना बंद हो रहा है…",
    pa: "ਸਾਂਝਾ ਕਰਨਾ ਬੰਦ ਹੋ ਰਿਹਾ ਹੈ…",
  },
  awaazListenerRevoked: {
    en: "Listening link revoked. It can no longer be opened.",
    hi: "सुनने वाला लिंक रद्द हो गया। अब इसे खोला नहीं जा सकता।",
    pa: "ਸੁਣਨ ਵਾਲਾ ਲਿੰਕ ਰੱਦ ਹੋ ਗਿਆ। ਹੁਣ ਇਸਨੂੰ ਖੋਲ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।",
  },
  awaazListenerRevokeFailed: {
    en: "The link could not be revoked. Check the connection and try again.",
    hi: "लिंक रद्द नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।",
    pa: "ਲਿੰਕ ਰੱਦ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
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
  awaazManagePhrasesTitle: {
    en: "Manage the phrase board",
    hi: "वाक्य बोर्ड बदलें",
    pa: "ਵਾਕ ਬੋਰਡ ਬਦਲੋ",
  },
  awaazManagePhrasesHelp: {
    en: "Add the words this person uses every day. This changes the tiles only; it does not train speech recognition.",
    hi: "वे शब्द जोड़ें जो यह व्यक्ति रोज़ इस्तेमाल करता है। इससे केवल टाइल बदलती हैं; आवाज़ पहचान का प्रशिक्षण नहीं होता।",
    pa: "ਉਹ ਸ਼ਬਦ ਜੋੜੋ ਜੋ ਇਹ ਵਿਅਕਤੀ ਹਰ ਰੋਜ਼ ਵਰਤਦਾ ਹੈ। ਇਸ ਨਾਲ ਸਿਰਫ਼ ਟਾਈਲਾਂ ਬਦਲਦੀਆਂ ਹਨ; ਆਵਾਜ਼ ਪਛਾਣ ਦੀ ਟ੍ਰੇਨਿੰਗ ਨਹੀਂ ਹੁੰਦੀ।",
  },
  awaazPhrasePlaceholder: {
    en: "e.g. Call Dr Singh",
    hi: "जैसे: डॉ. सिंह को बुलाओ",
    pa: "ਜਿਵੇਂ: ਡਾ. ਸਿੰਘ ਨੂੰ ਬੁਲਾਓ",
  },
  awaazPhraseAdd: {
    en: "Add phrase",
    hi: "वाक्य जोड़ें",
    pa: "ਵਾਕ ਜੋੜੋ",
  },
  awaazPhraseAdded: {
    en: "Phrase added to the board.",
    hi: "वाक्य बोर्ड में जोड़ दिया गया।",
    pa: "ਵਾਕ ਬੋਰਡ ਵਿੱਚ ਜੋੜ ਦਿੱਤਾ ਗਿਆ।",
  },
  awaazPhraseAddFailed: {
    en: "The phrase could not be added. It may already be on the board or the board may be full.",
    hi: "वाक्य नहीं जोड़ा जा सका। यह पहले से बोर्ड पर हो सकता है या बोर्ड भरा हो सकता है।",
    pa: "ਵਾਕ ਜੋੜਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਇਹ ਪਹਿਲਾਂ ਹੀ ਬੋਰਡ ਉੱਤੇ ਹੋ ਸਕਦਾ ਹੈ ਜਾਂ ਬੋਰਡ ਭਰਿਆ ਹੋ ਸਕਦਾ ਹੈ।",
  },
  awaazPhraseRemove: {
    en: "Remove",
    hi: "हटाएँ",
    pa: "ਹਟਾਓ",
  },
  awaazPhraseRemoveConfirm: {
    en: "Remove this phrase from the board? Existing learning recordings are not deleted.",
    hi: "यह वाक्य बोर्ड से हटाएँ? पहले से सहेजी सीखने की रिकॉर्डिंग नहीं मिटेंगी।",
    pa: "ਇਹ ਵਾਕ ਬੋਰਡ ਤੋਂ ਹਟਾਉਣਾ ਹੈ? ਪਹਿਲਾਂ ਤੋਂ ਸੰਭਾਲੀਆਂ ਸਿੱਖਣ ਵਾਲੀਆਂ ਰਿਕਾਰਡਿੰਗਾਂ ਨਹੀਂ ਮਿਟਣਗੀਆਂ।",
  },
  awaazPhraseRemoved: {
    en: "Phrase removed from the board.",
    hi: "वाक्य बोर्ड से हटा दिया गया।",
    pa: "ਵਾਕ ਬੋਰਡ ਤੋਂ ਹਟਾ ਦਿੱਤਾ ਗਿਆ।",
  },
  awaazPhraseRemoveFailed: {
    en: "The phrase could not be removed. Check the connection and try again.",
    hi: "वाक्य हटाया नहीं जा सका। कनेक्शन जाँचें और फिर कोशिश करें।",
    pa: "ਵਾਕ ਹਟਾਇਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
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
  awaazNotSaved: {
    en: "It was spoken on this phone, but could not be saved. Check the connection.",
    hi: "यह फ़ोन पर बोल दिया गया, लेकिन सहेजा नहीं जा सका। कनेक्शन जाँचें।",
    pa: "ਇਹ ਫ਼ੋਨ 'ਤੇ ਬੋਲ ਦਿੱਤਾ ਗਿਆ, ਪਰ ਸੰਭਾਲਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ।",
  },
  awaazConfirmFailed: {
    en: "Nothing was spoken because confirmation could not be saved. Please try again.",
    hi: "पुष्टि सहेजी नहीं जा सकी, इसलिए कुछ नहीं बोला गया। फिर कोशिश करें।",
    pa: "ਪੁਸ਼ਟੀ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ, ਇਸ ਲਈ ਕੁਝ ਨਹੀਂ ਬੋਲਿਆ ਗਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  awaazEmergencyDeliveryMissing: {
    en: "A caregiver alert was not accepted for delivery. Call family or 108 directly.",
    hi: "देखभालकर्ता अलर्ट भेजने के लिए स्वीकार नहीं हुआ। परिवार या 108 को सीधे कॉल करें।",
    pa: "ਦੇਖਭਾਲ ਕਰਨ ਵਾਲੇ ਦਾ ਅਲਰਟ ਭੇਜਣ ਲਈ ਸਵੀਕਾਰ ਨਹੀਂ ਹੋਇਆ। ਪਰਿਵਾਰ ਜਾਂ 108 ਨੂੰ ਸਿੱਧਾ ਕਾਲ ਕਰੋ।",
  },
  awaazEmergencyDelivered: {
    en: "Caregiver alert accepted for delivery.",
    hi: "देखभालकर्ता अलर्ट भेजने के लिए स्वीकार हुआ।",
    pa: "ਦੇਖਭਾਲ ਕਰਨ ਵਾਲੇ ਦਾ ਅਲਰਟ ਭੇਜਣ ਲਈ ਸਵੀਕਾਰ ਹੋਇਆ।",
  },
  awaazEmergencyOfflineMissing: {
    en: "The saved offline phrase did not play. A browser voice was attempted; set up and test the offline phrase below.",
    hi: "सहेजा हुआ ऑफ़लाइन संदेश नहीं चला। ब्राउज़र की आवाज़ की कोशिश की गई; नीचे ऑफ़लाइन संदेश सेट करके जाँचें।",
    pa: "ਸੰਭਾਲਿਆ ਆਫ਼ਲਾਈਨ ਸੁਨੇਹਾ ਨਹੀਂ ਚੱਲਿਆ। ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਆਵਾਜ਼ ਦੀ ਕੋਸ਼ਿਸ਼ ਕੀਤੀ ਗਈ; ਹੇਠਾਂ ਆਫ਼ਲਾਈਨ ਸੁਨੇਹਾ ਸੈੱਟ ਕਰਕੇ ਜਾਂਚੋ।",
  },
  awaazEmergencyOfflineReady: {
    en: "The saved emergency phrase is ready on this device without internet.",
    hi: "सहेजा हुआ आपातकालीन संदेश इस डिवाइस पर बिना इंटरनेट तैयार है।",
    pa: "ਸੰਭਾਲਿਆ ਐਮਰਜੈਂਸੀ ਸੁਨੇਹਾ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਇੰਟਰਨੈੱਟ ਤੋਂ ਬਿਨਾਂ ਤਿਆਰ ਹੈ।",
  },
  awaazEmergencyHoldHint: {
    en: "Or press and hold empty space for 1.2 seconds",
    hi: "या खाली जगह को 1.2 सेकंड दबाकर रखें",
    pa: "ਜਾਂ ਖਾਲੀ ਥਾਂ ਨੂੰ 1.2 ਸਕਿੰਟ ਦਬਾ ਕੇ ਰੱਖੋ",
  },
  awaazEmergencyHolding: {
    en: "Keep holding for emergency…",
    hi: "आपातकाल के लिए दबाए रखें…",
    pa: "ਐਮਰਜੈਂਸੀ ਲਈ ਦਬਾਈ ਰੱਖੋ…",
  },
  awaazEmergencyCall108: {
    en: "Open phone to call 108",
    hi: "108 पर कॉल करने के लिए फ़ोन खोलें",
    pa: "108 'ਤੇ ਕਾਲ ਕਰਨ ਲਈ ਫ਼ੋਨ ਖੋਲ੍ਹੋ",
  },
  awaazBoardOfflineUnavailable: {
    en: "The rest of the communication board needs a connection right now. Emergency voice remains available above.",
    hi: "बाकी संवाद बोर्ड को अभी कनेक्शन चाहिए। ऊपर आपातकालीन आवाज़ उपलब्ध है।",
    pa: "ਬਾਕੀ ਸੰਚਾਰ ਬੋਰਡ ਨੂੰ ਹੁਣ ਕਨੈਕਸ਼ਨ ਚਾਹੀਦਾ ਹੈ। ਉੱਪਰ ਐਮਰਜੈਂਸੀ ਆਵਾਜ਼ ਉਪਲਬਧ ਹੈ।",
  },
  awaazBoardOfflineReady: {
    en: "Offline: saved phrase tiles are available. Taps use this phone's installed browser voice; activity and changes are not saved until the connection returns.",
    hi: "ऑफ़लाइन: सहेजे हुए वाक्य उपलब्ध हैं। टैप इस फ़ोन की ब्राउज़र आवाज़ का उपयोग करते हैं; कनेक्शन लौटने तक गतिविधि और बदलाव सहेजे नहीं जाएँगे।",
    pa: "ਆਫ਼ਲਾਈਨ: ਸੰਭਾਲੇ ਹੋਏ ਵਾਕ ਉਪਲਬਧ ਹਨ। ਟੈਪ ਇਸ ਫ਼ੋਨ ਦੀ ਬਰਾਊਜ਼ਰ ਆਵਾਜ਼ ਵਰਤਦੇ ਹਨ; ਕਨੈਕਸ਼ਨ ਵਾਪਸ ਆਉਣ ਤੱਕ ਸਰਗਰਮੀ ਅਤੇ ਬਦਲਾਅ ਸੰਭਾਲੇ ਨਹੀਂ ਜਾਣਗੇ।",
  },
  awaazOfflineActivityNotSaved: {
    en: "The phrase was shown and browser speech was attempted, but this offline tap was not saved.",
    hi: "वाक्य दिखाया गया और ब्राउज़र से बोलने की कोशिश हुई, लेकिन यह ऑफ़लाइन टैप सहेजा नहीं गया।",
    pa: "ਵਾਕ ਦਿਖਾਇਆ ਗਿਆ ਅਤੇ ਬਰਾਊਜ਼ਰ ਰਾਹੀਂ ਬੋਲਣ ਦੀ ਕੋਸ਼ਿਸ਼ ਹੋਈ, ਪਰ ਇਹ ਆਫ਼ਲਾਈਨ ਟੈਪ ਸੰਭਾਲਿਆ ਨਹੀਂ ਗਿਆ।",
  },
  awaazEmergencySetupTitle: {
    en: "Offline emergency voice",
    hi: "ऑफ़लाइन आपातकालीन आवाज़",
    pa: "ਆਫ਼ਲਾਈਨ ਐਮਰਜੈਂਸੀ ਆਵਾਜ਼",
  },
  awaazEmergencyReady: {
    en: "Saved on this device and ready without internet",
    hi: "इस डिवाइस पर सहेजा गया और बिना इंटरनेट तैयार",
    pa: "ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੰਭਾਲਿਆ ਅਤੇ ਇੰਟਰਨੈੱਟ ਤੋਂ ਬਿਨਾਂ ਤਿਆਰ",
  },
  awaazEmergencyNeedsSetup: {
    en: "Not set up on this device",
    hi: "इस डिवाइस पर सेट नहीं किया गया",
    pa: "ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੈੱਟ ਨਹੀਂ ਕੀਤਾ ਗਿਆ",
  },
  awaazEmergencySetupIntro: {
    en: "A caregiver should record this exact phrase once. It stays only on this device and plays before any network request.",
    hi: "देखभालकर्ता इस संदेश को एक बार ठीक इसी तरह रिकॉर्ड करें। यह केवल इस डिवाइस पर रहता है और किसी नेटवर्क अनुरोध से पहले चलता है।",
    pa: "ਦੇਖਭਾਲ ਕਰਨ ਵਾਲਾ ਇਹੀ ਸੁਨੇਹਾ ਇੱਕ ਵਾਰ ਰਿਕਾਰਡ ਕਰੇ। ਇਹ ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਰਹਿੰਦਾ ਹੈ ਅਤੇ ਕਿਸੇ ਨੈੱਟਵਰਕ ਬੇਨਤੀ ਤੋਂ ਪਹਿਲਾਂ ਚੱਲਦਾ ਹੈ।",
  },
  awaazEmergencyLocationLabel: {
    en: "Share location on an emergency tap",
    hi: "आपातकालीन टैप पर स्थान साझा करें",
    pa: "ਐਮਰਜੈਂਸੀ ਟੈਪ 'ਤੇ ਟਿਕਾਣਾ ਸਾਂਝਾ ਕਰੋ",
  },
  awaazEmergencyLocationHelp: {
    en: "Optional. Exact coordinates are requested only for an emergency and sent to the caregiver provider when connected.",
    hi: "वैकल्पिक। सटीक स्थान केवल आपातकाल में माँगा जाता है और सेवा जुड़ी होने पर देखभालकर्ता को भेजा जाता है।",
    pa: "ਵਿਕਲਪਿਕ। ਸਹੀ ਟਿਕਾਣਾ ਸਿਰਫ਼ ਐਮਰਜੈਂਸੀ ਵੇਲੇ ਮੰਗਿਆ ਜਾਂਦਾ ਹੈ ਅਤੇ ਸੇਵਾ ਜੁੜੀ ਹੋਣ 'ਤੇ ਦੇਖਭਾਲ ਕਰਨ ਵਾਲੇ ਨੂੰ ਭੇਜਿਆ ਜਾਂਦਾ ਹੈ।",
  },
  awaazEmergencyLocationRequesting: {
    en: "Requesting this device's location…",
    hi: "इस डिवाइस का स्थान माँगा जा रहा है…",
    pa: "ਇਸ ਡਿਵਾਈਸ ਦਾ ਟਿਕਾਣਾ ਮੰਗਿਆ ਜਾ ਰਿਹਾ ਹੈ…",
  },
  awaazEmergencyLocationReady: {
    en: "Location is ready for the next emergency tap.",
    hi: "अगले आपातकालीन टैप के लिए स्थान तैयार है।",
    pa: "ਅਗਲੇ ਐਮਰਜੈਂਸੀ ਟੈਪ ਲਈ ਟਿਕਾਣਾ ਤਿਆਰ ਹੈ।",
  },
  awaazEmergencyLocationUnavailable: {
    en: "Location is unavailable. Emergency speech still works; check browser permission if you want to share it.",
    hi: "स्थान उपलब्ध नहीं है। आपातकालीन आवाज़ फिर भी काम करती है; साझा करने के लिए ब्राउज़र अनुमति जाँचें।",
    pa: "ਟਿਕਾਣਾ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਐਮਰਜੈਂਸੀ ਆਵਾਜ਼ ਫਿਰ ਵੀ ਕੰਮ ਕਰਦੀ ਹੈ; ਸਾਂਝਾ ਕਰਨ ਲਈ ਬ੍ਰਾਊਜ਼ਰ ਇਜਾਜ਼ਤ ਜਾਂਚੋ।",
  },
  awaazEmergencyLocationOff: {
    en: "Emergency location sharing is off.",
    hi: "आपातकालीन स्थान साझा करना बंद है।",
    pa: "ਐਮਰਜੈਂਸੀ ਟਿਕਾਣਾ ਸਾਂਝਾ ਕਰਨਾ ਬੰਦ ਹੈ।",
  },
  awaazEmergencyTestRecorded: {
    en: "The last self-test started successfully.",
    hi: "पिछली स्व-जाँच सफलतापूर्वक शुरू हुई।",
    pa: "ਪਿਛਲੀ ਸਵੈ-ਜਾਂਚ ਸਫਲਤਾਪੂਰਵਕ ਸ਼ੁਰੂ ਹੋਈ।",
  },
  awaazEmergencyNotTested: {
    en: "Recorded, but not self-tested yet.",
    hi: "रिकॉर्ड हो गया, लेकिन अभी स्व-जाँच नहीं हुई।",
    pa: "ਰਿਕਾਰਡ ਹੋ ਗਿਆ, ਪਰ ਹਾਲੇ ਸਵੈ-ਜਾਂਚ ਨਹੀਂ ਹੋਈ।",
  },
  awaazEmergencyRecord: {
    en: "Record phrase",
    hi: "संदेश रिकॉर्ड करें",
    pa: "ਸੁਨੇਹਾ ਰਿਕਾਰਡ ਕਰੋ",
  },
  awaazEmergencyRerecord: {
    en: "Record again",
    hi: "फिर रिकॉर्ड करें",
    pa: "ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ",
  },
  awaazEmergencyTest: {
    en: "Test offline voice",
    hi: "ऑफ़लाइन आवाज़ जाँचें",
    pa: "ਆਫ਼ਲਾਈਨ ਆਵਾਜ਼ ਜਾਂਚੋ",
  },
  awaazEmergencyDelete: {
    en: "Delete offline phrase",
    hi: "ऑफ़लाइन संदेश मिटाएँ",
    pa: "ਆਫ਼ਲਾਈਨ ਸੁਨੇਹਾ ਮਿਟਾਓ",
  },
  awaazEmergencySavedTestNext: {
    en: "Saved only on this device. Test it now before relying on it.",
    hi: "केवल इस डिवाइस पर सहेजा गया। भरोसा करने से पहले अभी जाँचें।",
    pa: "ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੰਭਾਲਿਆ। ਭਰੋਸਾ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਹੁਣੇ ਜਾਂਚੋ।",
  },
  awaazEmergencySetupFailed: {
    en: "The offline phrase could not be saved. Try again and complete the self-test.",
    hi: "ऑफ़लाइन संदेश सहेजा नहीं जा सका। फिर कोशिश करें और स्व-जाँच पूरी करें।",
    pa: "ਆਫ਼ਲਾਈਨ ਸੁਨੇਹਾ ਸੰਭਾਲਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ ਅਤੇ ਸਵੈ-ਜਾਂਚ ਪੂਰੀ ਕਰੋ।",
  },
  awaazEmergencyTestFailed: {
    en: "The offline phrase did not start. Record it again before relying on it.",
    hi: "ऑफ़लाइन संदेश शुरू नहीं हुआ। भरोसा करने से पहले फिर रिकॉर्ड करें।",
    pa: "ਆਫ਼ਲਾਈਨ ਸੁਨੇਹਾ ਸ਼ੁਰੂ ਨਹੀਂ ਹੋਇਆ। ਭਰੋਸਾ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਕਰੋ।",
  },
  awaazEmergencyTestPassed: {
    en: "Self-test passed: the on-device phrase started playing.",
    hi: "स्व-जाँच सफल: डिवाइस पर सहेजा संदेश चलना शुरू हुआ।",
    pa: "ਸਵੈ-ਜਾਂਚ ਸਫਲ: ਡਿਵਾਈਸ 'ਤੇ ਸੰਭਾਲਿਆ ਸੁਨੇਹਾ ਚੱਲਣਾ ਸ਼ੁਰੂ ਹੋਇਆ।",
  },
  awaazEmergencyDeleteConfirm: {
    en: "Delete the offline emergency phrase from this device? Emergency taps will fall back to the browser voice.",
    hi: "इस डिवाइस से ऑफ़लाइन आपातकालीन संदेश मिटाएँ? आपातकालीन टैप ब्राउज़र की आवाज़ पर निर्भर होगा।",
    pa: "ਇਸ ਡਿਵਾਈਸ ਤੋਂ ਆਫ਼ਲਾਈਨ ਐਮਰਜੈਂਸੀ ਸੁਨੇਹਾ ਮਿਟਾਉਣਾ ਹੈ? ਐਮਰਜੈਂਸੀ ਟੈਪ ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਆਵਾਜ਼ 'ਤੇ ਨਿਰਭਰ ਹੋਵੇਗਾ।",
  },
  awaazEmergencyDeleted: {
    en: "Offline emergency phrase deleted from this device.",
    hi: "ऑफ़लाइन आपातकालीन संदेश इस डिवाइस से मिटा दिया गया।",
    pa: "ਆਫ਼ਲਾਈਨ ਐਮਰਜੈਂਸੀ ਸੁਨੇਹਾ ਇਸ ਡਿਵਾਈਸ ਤੋਂ ਮਿਟਾ ਦਿੱਤਾ ਗਿਆ।",
  },
  awaazListenerFailed: {
    en: "The listening link could not be created. Check the connection and try again.",
    hi: "सुनने वाला लिंक नहीं बन सका। कनेक्शन जाँचकर फिर कोशिश करें।",
    pa: "ਸੁਣਨ ਵਾਲਾ ਲਿੰਕ ਨਹੀਂ ਬਣ ਸਕਿਆ। ਕਨੈਕਸ਼ਨ ਜਾਂਚ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
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
  awaazPracticeTitle: {
    en: "Help Awaaz learn naturally",
    hi: "आवाज़ को स्वाभाविक रूप से सीखने में मदद करें",
    pa: "ਆਵਾਜ਼ ਨੂੰ ਕੁਦਰਤੀ ਤਰੀਕੇ ਨਾਲ ਸਿੱਖਣ ਵਿੱਚ ਮਦਦ ਕਰੋ",
  },
  awaazPracticeIntro: {
    en: "Record what you are trying to say, then tap the matching card. The recording stays only on this device.",
    hi: "जो कहना चाहते हैं उसे रिकॉर्ड करें, फिर सही कार्ड दबाएँ। रिकॉर्डिंग केवल इसी डिवाइस पर रहती है।",
    pa: "ਜੋ ਕਹਿਣਾ ਚਾਹੁੰਦੇ ਹੋ ਉਹ ਰਿਕਾਰਡ ਕਰੋ, ਫਿਰ ਸਹੀ ਕਾਰਡ ਦਬਾਓ। ਰਿਕਾਰਡਿੰਗ ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਰਹਿੰਦੀ ਹੈ।",
  },
  awaazCaptureConsent: {
    en: "I agree to keep these practice recordings on this device for future personalisation. I can delete them anytime.",
    hi: "मैं भविष्य में निजी बनाने के लिए अभ्यास रिकॉर्डिंग इस डिवाइस पर रखने के लिए सहमत हूँ। इन्हें कभी भी मिटा सकता/सकती हूँ।",
    pa: "ਮੈਂ ਭਵਿੱਖ ਦੇ ਨਿੱਜੀਕਰਨ ਲਈ ਅਭਿਆਸ ਰਿਕਾਰਡਿੰਗਾਂ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਰੱਖਣ ਲਈ ਸਹਿਮਤ ਹਾਂ। ਮੈਂ ਇਹਨਾਂ ਨੂੰ ਕਦੇ ਵੀ ਮਿਟਾ ਸਕਦਾ/ਸਕਦੀ ਹਾਂ।",
  },
  awaazStartRecording: {
    en: "Start practice recording",
    hi: "अभ्यास रिकॉर्डिंग शुरू करें",
    pa: "ਅਭਿਆਸ ਰਿਕਾਰਡਿੰਗ ਸ਼ੁਰੂ ਕਰੋ",
  },
  awaazStopRecording: {
    en: "Stop recording",
    hi: "रिकॉर्डिंग रोकें",
    pa: "ਰਿਕਾਰਡਿੰਗ ਰੋਕੋ",
  },
  awaazChoosePhrase: {
    en: "Now tap the card that matches what you said.",
    hi: "अब वही कार्ड दबाएँ जो आपने कहा था।",
    pa: "ਹੁਣ ਉਹ ਕਾਰਡ ਦਬਾਓ ਜੋ ਤੁਸੀਂ ਕਿਹਾ ਸੀ।",
  },
  awaazDiscardRecording: {
    en: "Discard this recording",
    hi: "यह रिकॉर्डिंग मिटाएँ",
    pa: "ਇਹ ਰਿਕਾਰਡਿੰਗ ਮਿਟਾਓ",
  },
  awaazCaptureSaved: {
    en: "Practice pair saved on this device.",
    hi: "अभ्यास जोड़ी इस डिवाइस पर सहेजी गई।",
    pa: "ਅਭਿਆਸ ਜੋੜੀ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੰਭਾਲੀ ਗਈ।",
  },
  awaazCaptureFailed: {
    en: "The recording could not be paired. It is still ready—tap the same card to retry or discard it.",
    hi: "रिकॉर्डिंग जोड़ी नहीं जा सकी। यह अभी तैयार है—उसी कार्ड को फिर दबाएँ या इसे मिटाएँ।",
    pa: "ਰਿਕਾਰਡਿੰਗ ਜੋੜੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਇਹ ਹਾਲੇ ਤਿਆਰ ਹੈ—ਉਹੀ ਕਾਰਡ ਦੁਬਾਰਾ ਦਬਾਓ ਜਾਂ ਇਸ ਨੂੰ ਮਿਟਾਓ।",
  },
  awaazMicUnavailable: {
    en: "The microphone is not available. Check browser permission and try again.",
    hi: "माइक्रोफ़ोन उपलब्ध नहीं है। ब्राउज़र अनुमति जाँचकर फिर कोशिश करें।",
    pa: "ਮਾਈਕ੍ਰੋਫੋਨ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਇਜਾਜ਼ਤ ਜਾਂਚ ਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  awaazAutoStop: {
    en: "Automatically stop after my pause",
    hi: "मेरे विराम के बाद अपने आप रोकें",
    pa: "ਮੇਰੇ ਵਿਰਾਮ ਤੋਂ ਬਾਅਦ ਆਪਣੇ ਆਪ ਰੋਕੋ",
  },
  awaazPauseLabel: {
    en: "Wait through pauses before stopping",
    hi: "रोकने से पहले विराम का इंतज़ार",
    pa: "ਰੋਕਣ ਤੋਂ ਪਹਿਲਾਂ ਵਿਰਾਮ ਦੀ ਉਡੀਕ",
  },
  awaazSavePause: { en: "Save pause time", hi: "विराम समय सहेजें", pa: "ਵਿਰਾਮ ਸਮਾਂ ਸੰਭਾਲੋ" },
  awaazPauseSaved: { en: "Pause time saved.", hi: "विराम समय सहेजा गया।", pa: "ਵਿਰਾਮ ਸਮਾਂ ਸੰਭਾਲਿਆ ਗਿਆ।" },
  awaazLocalPairs: {
    en: "learning recordings stored on this device",
    hi: "सीखने की रिकॉर्डिंग इस डिवाइस पर सहेजी गईं",
    pa: "ਸਿੱਖਣ ਵਾਲੀਆਂ ਰਿਕਾਰਡਿੰਗਾਂ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੰਭਾਲੀਆਂ ਗਈਆਂ",
  },
  awaazDeleteRecordings: {
    en: "Delete all local recordings",
    hi: "सभी स्थानीय रिकॉर्डिंग मिटाएँ",
    pa: "ਸਾਰੀਆਂ ਲੋਕਲ ਰਿਕਾਰਡਿੰਗਾਂ ਮਿਟਾਓ",
  },
  awaazDeleteConfirm: {
    en: "Delete every Awaaz practice recording stored in this browser? This cannot be undone.",
    hi: "इस ब्राउज़र में सहेजी सभी आवाज़ अभ्यास रिकॉर्डिंग मिटाएँ? इसे वापस नहीं किया जा सकता।",
    pa: "ਇਸ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਸੰਭਾਲੀਆਂ ਸਾਰੀਆਂ ਆਵਾਜ਼ ਅਭਿਆਸ ਰਿਕਾਰਡਿੰਗਾਂ ਮਿਟਾਉਣੀਆਂ ਹਨ? ਇਹ ਵਾਪਸ ਨਹੀਂ ਹੋ ਸਕਦਾ।",
  },
  awaazDeleteDone: {
    en: "Local practice recordings deleted.",
    hi: "स्थानीय अभ्यास रिकॉर्डिंग मिटा दी गईं।",
    pa: "ਲੋਕਲ ਅਭਿਆਸ ਰਿਕਾਰਡਿੰਗਾਂ ਮਿਟਾ ਦਿੱਤੀਆਂ ਗਈਆਂ।",
  },
  awaazDeleteReceiptFailed: {
    en: "The recordings were deleted here, but the server receipt could not be updated. The audio is no longer on this device.",
    hi: "रिकॉर्डिंग यहाँ मिटा दी गईं, लेकिन सर्वर रसीद अपडेट नहीं हो सकी। ऑडियो अब इस डिवाइस पर नहीं है।",
    pa: "ਰਿਕਾਰਡਿੰਗਾਂ ਇੱਥੇ ਮਿਟਾ ਦਿੱਤੀਆਂ ਗਈਆਂ, ਪਰ ਸਰਵਰ ਰਸੀਦ ਅੱਪਡੇਟ ਨਹੀਂ ਹੋ ਸਕੀ। ਆਡੀਓ ਹੁਣ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ।",
  },
  awaazExportTitle: {
    en: "Export for an authorised training workflow",
    hi: "अधिकृत प्रशिक्षण प्रक्रिया के लिए निर्यात",
    pa: "ਅਧਿਕਾਰਤ ਟ੍ਰੇਨਿੰਗ ਪ੍ਰਕਿਰਿਆ ਲਈ ਐਕਸਪੋਰਟ",
  },
  awaazExportHelp: {
    en: "This verifies every WAV and downloads a local archive. Nothing is uploaded by NeuroTrace. The file contains patient voice and verified words; after download it is outside protected app storage and cannot be revoked here.",
    hi: "यह हर WAV की जाँच करके एक स्थानीय संग्रह डाउनलोड करता है। न्यूरोट्रेस कुछ अपलोड नहीं करता। फ़ाइल में रोगी की आवाज़ और सत्यापित शब्द होते हैं; डाउनलोड के बाद यह सुरक्षित ऐप स्टोरेज से बाहर होगी और यहाँ से वापस नहीं ली जा सकती।",
    pa: "ਇਹ ਹਰ WAV ਦੀ ਜਾਂਚ ਕਰਕੇ ਇੱਕ ਲੋਕਲ ਆਰਕਾਈਵ ਡਾਊਨਲੋਡ ਕਰਦਾ ਹੈ। ਨਿਊਰੋਟ੍ਰੇਸ ਕੁਝ ਅੱਪਲੋਡ ਨਹੀਂ ਕਰਦਾ। ਫਾਈਲ ਵਿੱਚ ਮਰੀਜ਼ ਦੀ ਆਵਾਜ਼ ਅਤੇ ਪੁਸ਼ਟੀ ਕੀਤੇ ਸ਼ਬਦ ਹੁੰਦੇ ਹਨ; ਡਾਊਨਲੋਡ ਤੋਂ ਬਾਅਦ ਇਹ ਸੁਰੱਖਿਅਤ ਐਪ ਸਟੋਰੇਜ ਤੋਂ ਬਾਹਰ ਹੋਵੇਗੀ ਅਤੇ ਇੱਥੋਂ ਵਾਪਸ ਨਹੀਂ ਲਈ ਜਾ ਸਕਦੀ।",
  },
  awaazPolicyLoggingTitle: {
    en: "Help improve which options appear first",
    hi: "कौन-से विकल्प पहले दिखें, इसे बेहतर बनाने में मदद करें",
    pa: "ਕਿਹੜੇ ਵਿਕਲਪ ਪਹਿਲਾਂ ਦਿਖਣ, ਇਸਨੂੰ ਬਿਹਤਰ ਬਣਾਉਣ ਵਿੱਚ ਮਦਦ ਕਰੋ",
  },
  awaazPolicyLoggingHelp: {
    en: "Only which option was tapped is recorded, as anonymous numbers. Your words, your recordings and your name are never part of it. Everything on this screen works exactly the same whether this is on or off.",
    hi: "केवल यह दर्ज होता है कि कौन-सा विकल्प चुना गया, बेनाम संख्याओं के रूप में। आपके शब्द, आपकी रिकॉर्डिंग और आपका नाम इसमें कभी शामिल नहीं होते। यह चालू हो या बंद, इस स्क्रीन पर सब कुछ बिल्कुल वैसा ही चलता है।",
    pa: "ਸਿਰਫ਼ ਇਹ ਦਰਜ ਹੁੰਦਾ ਹੈ ਕਿ ਕਿਹੜਾ ਵਿਕਲਪ ਚੁਣਿਆ ਗਿਆ, ਬੇਨਾਮ ਸੰਖਿਆਵਾਂ ਵਜੋਂ। ਤੁਹਾਡੇ ਸ਼ਬਦ, ਤੁਹਾਡੀਆਂ ਰਿਕਾਰਡਿੰਗਾਂ ਅਤੇ ਤੁਹਾਡਾ ਨਾਮ ਇਸ ਵਿੱਚ ਕਦੇ ਸ਼ਾਮਲ ਨਹੀਂ ਹੁੰਦੇ। ਇਹ ਚਾਲੂ ਹੋਵੇ ਜਾਂ ਬੰਦ, ਇਸ ਸਕਰੀਨ 'ਤੇ ਸਭ ਕੁਝ ਬਿਲਕੁਲ ਉਸੇ ਤਰ੍ਹਾਂ ਚੱਲਦਾ ਹੈ।",
  },
  awaazPolicyLoggingConsent: {
    en: "I agree to share anonymous numbers about which option was chosen. I can switch this off anytime.",
    hi: "मैं सहमत हूँ कि कौन-सा विकल्प चुना गया, इसकी बेनाम संख्याएँ साझा की जाएँ। मैं इसे कभी भी बंद कर सकता/सकती हूँ।",
    pa: "ਮੈਂ ਸਹਿਮਤ ਹਾਂ ਕਿ ਕਿਹੜਾ ਵਿਕਲਪ ਚੁਣਿਆ ਗਿਆ, ਇਸ ਦੀਆਂ ਬੇਨਾਮ ਸੰਖਿਆਵਾਂ ਸਾਂਝੀਆਂ ਕੀਤੀਆਂ ਜਾਣ। ਮੈਂ ਇਸਨੂੰ ਕਦੇ ਵੀ ਬੰਦ ਕਰ ਸਕਦਾ/ਸਕਦੀ ਹਾਂ।",
  },
  awaazExportConsent: {
    en: "I understand this sensitive voice archive leaves protected app storage when downloaded",
    hi: "मैं समझता/समझती हूँ कि डाउनलोड होने पर यह संवेदनशील आवाज़ संग्रह सुरक्षित ऐप स्टोरेज से बाहर चला जाएगा",
    pa: "ਮੈਂ ਸਮਝਦਾ/ਸਮਝਦੀ ਹਾਂ ਕਿ ਡਾਊਨਲੋਡ ਹੋਣ 'ਤੇ ਇਹ ਸੰਵੇਦਨਸ਼ੀਲ ਆਵਾਜ਼ ਆਰਕਾਈਵ ਸੁਰੱਖਿਅਤ ਐਪ ਸਟੋਰੇਜ ਤੋਂ ਬਾਹਰ ਚਲਾ ਜਾਵੇਗਾ",
  },
  awaazExportButton: {
    en: "Download verified archive",
    hi: "सत्यापित संग्रह डाउनलोड करें",
    pa: "ਜਾਂਚਿਆ ਆਰਕਾਈਵ ਡਾਊਨਲੋਡ ਕਰੋ",
  },
  awaazExporting: {
    en: "Verifying recordings…",
    hi: "रिकॉर्डिंग की जाँच हो रही है…",
    pa: "ਰਿਕਾਰਡਿੰਗਾਂ ਦੀ ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ…",
  },
  awaazExportDone: {
    en: "Archive downloaded. Store it securely; deleting recordings here cannot delete that file.",
    hi: "संग्रह डाउनलोड हो गया। इसे सुरक्षित रखें; यहाँ रिकॉर्डिंग मिटाने से वह फ़ाइल नहीं मिटेगी।",
    pa: "ਆਰਕਾਈਵ ਡਾਊਨਲੋਡ ਹੋ ਗਿਆ। ਇਸਨੂੰ ਸੁਰੱਖਿਅਤ ਰੱਖੋ; ਇੱਥੇ ਰਿਕਾਰਡਿੰਗਾਂ ਮਿਟਾਉਣ ਨਾਲ ਉਹ ਫਾਈਲ ਨਹੀਂ ਮਿਟੇਗੀ।",
  },
  awaazExportFailed: {
    en: "The archive was not created. A recording may have failed its integrity check; nothing was uploaded.",
    hi: "संग्रह नहीं बना। किसी रिकॉर्डिंग की सत्यापन जाँच विफल हो सकती है; कुछ भी अपलोड नहीं हुआ।",
    pa: "ਆਰਕਾਈਵ ਨਹੀਂ ਬਣਿਆ। ਕਿਸੇ ਰਿਕਾਰਡਿੰਗ ਦੀ ਜਾਂਚ ਅਸਫਲ ਹੋ ਸਕਦੀ ਹੈ; ਕੁਝ ਵੀ ਅੱਪਲੋਡ ਨਹੀਂ ਹੋਇਆ।",
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
  // ---- consent and erasure (Part 4, Part 5.4) ----
  privacyEyebrow: { en: "Privacy", hi: "निजता", pa: "ਨਿੱਜਤਾ" },
  privacyTitle: { en: "Consent and data", hi: "सहमति और डेटा", pa: "ਸਹਿਮਤੀ ਅਤੇ ਡਾਟਾ" },
  privacyIntro: {
    en: "Each of these is a separate decision. You can say yes to one and no to another, and you can change any of them at any time.",
    hi: "इनमें से हर एक अलग निर्णय है। आप किसी एक को हाँ और दूसरे को ना कह सकते हैं, और किसी को भी कभी भी बदल सकते हैं।",
    pa: "ਇਹਨਾਂ ਵਿੱਚੋਂ ਹਰ ਇੱਕ ਵੱਖਰਾ ਫ਼ੈਸਲਾ ਹੈ। ਤੁਸੀਂ ਕਿਸੇ ਇੱਕ ਨੂੰ ਹਾਂ ਅਤੇ ਦੂਜੇ ਨੂੰ ਨਾਂਹ ਕਹਿ ਸਕਦੇ ਹੋ, ਅਤੇ ਕਿਸੇ ਨੂੰ ਵੀ ਕਦੇ ਵੀ ਬਦਲ ਸਕਦੇ ਹੋ।",
  },
  privacyOwnerOnly: {
    en: "Only you can change these. A doctor or a family member cannot.",
    hi: "इन्हें केवल आप बदल सकते हैं। डॉक्टर या परिवार का सदस्य नहीं।",
    pa: "ਇਹਨਾਂ ਨੂੰ ਸਿਰਫ਼ ਤੁਸੀਂ ਬਦਲ ਸਕਦੇ ਹੋ। ਡਾਕਟਰ ਜਾਂ ਪਰਿਵਾਰ ਦਾ ਮੈਂਬਰ ਨਹੀਂ।",
  },
  consentGrantedOn: { en: "Agreed on {d}", hi: "{d} को सहमति दी", pa: "{d} ਨੂੰ ਸਹਿਮਤੀ ਦਿੱਤੀ" },
  consentWithdrawnOn: { en: "Withdrawn on {d}", hi: "{d} को वापस ली", pa: "{d} ਨੂੰ ਵਾਪਸ ਲਈ" },
  consentNeverAsked: {
    en: "Not agreed to. Nothing is being done under this.",
    hi: "सहमति नहीं दी गई। इसके तहत कुछ नहीं हो रहा।",
    pa: "ਸਹਿਮਤੀ ਨਹੀਂ ਦਿੱਤੀ ਗਈ। ਇਸ ਤਹਿਤ ਕੁਝ ਨਹੀਂ ਹੋ ਰਿਹਾ।",
  },
  consentStale: {
    en: "The wording changed since you agreed. Please read it again.",
    hi: "आपकी सहमति के बाद शब्द बदले हैं। कृपया दोबारा पढ़ें।",
    pa: "ਤੁਹਾਡੀ ਸਹਿਮਤੀ ਤੋਂ ਬਾਅਦ ਸ਼ਬਦ ਬਦਲੇ ਹਨ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਪੜ੍ਹੋ।",
  },
  consentEnforcedNow: {
    en: "Turning this off takes effect immediately.",
    hi: "इसे बंद करना तुरंत लागू होता है।",
    pa: "ਇਸਨੂੰ ਬੰਦ ਕਰਨਾ ਤੁਰੰਤ ਲਾਗੂ ਹੁੰਦਾ ਹੈ।",
  },
  consentRecordedOnly: {
    en: "This is recorded as your decision. To remove the data itself, use the section below.",
    hi: "यह आपके निर्णय के रूप में दर्ज है। डेटा हटाने के लिए नीचे का भाग देखें।",
    pa: "ਇਹ ਤੁਹਾਡੇ ਫ਼ੈਸਲੇ ਵਜੋਂ ਦਰਜ ਹੈ। ਡਾਟਾ ਹਟਾਉਣ ਲਈ ਹੇਠਲਾ ਭਾਗ ਦੇਖੋ।",
  },
  consentSaveFailed: {
    en: "That change was not saved. Nothing has been altered.",
    hi: "वह बदलाव सहेजा नहीं गया। कुछ भी नहीं बदला।",
    pa: "ਉਹ ਬਦਲਾਅ ਸੰਭਾਲਿਆ ਨਹੀਂ ਗਿਆ। ਕੁਝ ਵੀ ਨਹੀਂ ਬਦਲਿਆ।",
  },

  // The seven, in `models.py:ConsentType` order. Body copy says what actually happens,
  // not what the legal category is called.
  c1Title: { en: "Use NeuroTrace for follow-up", hi: "फ़ॉलो-अप के लिए NeuroTrace का उपयोग", pa: "ਫ਼ਾਲੋ-ਅੱਪ ਲਈ NeuroTrace ਦੀ ਵਰਤੋਂ" },
  c1Body: {
    en: "Doing the daily check-ins so changes after the stroke can be noticed early.",
    hi: "रोज़ाना जाँच करना ताकि स्ट्रोक के बाद के बदलाव जल्दी दिखें।",
    pa: "ਰੋਜ਼ਾਨਾ ਜਾਂਚ ਕਰਨਾ ਤਾਂ ਜੋ ਸਟ੍ਰੋਕ ਤੋਂ ਬਾਅਦ ਦੇ ਬਦਲਾਅ ਜਲਦੀ ਦਿਸਣ।",
  },
  c2Title: { en: "Store health information", hi: "स्वास्थ्य जानकारी संग्रहित करना", pa: "ਸਿਹਤ ਜਾਣਕਾਰੀ ਸੰਭਾਲਣਾ" },
  c2Body: {
    en: "Keeping the measurements from each check-in. Photos, video and audio never leave the phone — only numbers are stored.",
    hi: "हर जाँच के माप रखना। फ़ोटो, वीडियो और आवाज़ फ़ोन से बाहर नहीं जाते — केवल संख्याएँ रखी जाती हैं।",
    pa: "ਹਰ ਜਾਂਚ ਦੇ ਮਾਪ ਰੱਖਣਾ। ਫ਼ੋਟੋ, ਵੀਡੀਓ ਅਤੇ ਆਵਾਜ਼ ਫ਼ੋਨ ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਜਾਂਦੇ — ਸਿਰਫ਼ ਸੰਖਿਆਵਾਂ ਰੱਖੀਆਂ ਜਾਂਦੀਆਂ ਹਨ।",
  },
  c3Title: { en: "Share with the doctor", hi: "डॉक्टर के साथ साझा करना", pa: "ਡਾਕਟਰ ਨਾਲ ਸਾਂਝਾ ਕਰਨਾ" },
  c3Body: {
    en: "Letting the linked doctor see these measurements. Turn this off and they lose access at once, even though the link stays on record.",
    hi: "जुड़े डॉक्टर को ये माप देखने देना। इसे बंद करते ही उनकी पहुँच तुरंत बंद हो जाती है, भले ही रिकॉर्ड में जुड़ाव बना रहे।",
    pa: "ਜੁੜੇ ਡਾਕਟਰ ਨੂੰ ਇਹ ਮਾਪ ਦੇਖਣ ਦੇਣਾ। ਇਸਨੂੰ ਬੰਦ ਕਰਦੇ ਹੀ ਉਹਨਾਂ ਦੀ ਪਹੁੰਚ ਤੁਰੰਤ ਬੰਦ ਹੋ ਜਾਂਦੀ ਹੈ, ਭਾਵੇਂ ਰਿਕਾਰਡ ਵਿੱਚ ਜੁੜਾਅ ਬਣਿਆ ਰਹੇ।",
  },
  c4Title: { en: "Help improve the system", hi: "सिस्टम सुधारने में मदद", pa: "ਸਿਸਟਮ ਸੁਧਾਰਨ ਵਿੱਚ ਮਦਦ" },
  c4Body: {
    en: "Using these measurements in research to make the system work better for others. The check-ins work exactly the same if you say no.",
    hi: "इन मापों का शोध में उपयोग ताकि सिस्टम दूसरों के लिए बेहतर बने। ना कहने पर जाँचें बिल्कुल वैसी ही चलती हैं।",
    pa: "ਇਹਨਾਂ ਮਾਪਾਂ ਦੀ ਖੋਜ ਵਿੱਚ ਵਰਤੋਂ ਤਾਂ ਜੋ ਸਿਸਟਮ ਦੂਜਿਆਂ ਲਈ ਬਿਹਤਰ ਬਣੇ। ਨਾਂਹ ਕਹਿਣ 'ਤੇ ਜਾਂਚਾਂ ਬਿਲਕੁਲ ਉਸੇ ਤਰ੍ਹਾਂ ਚੱਲਦੀਆਂ ਹਨ।",
  },
  c5Title: { en: "Photo or story for publicity", hi: "प्रचार के लिए फ़ोटो या कहानी", pa: "ਪ੍ਰਚਾਰ ਲਈ ਫ਼ੋਟੋ ਜਾਂ ਕਹਾਣੀ" },
  c5Body: {
    en: "Using a photo or their story publicly. Nothing is used unless you turn this on.",
    hi: "फ़ोटो या उनकी कहानी सार्वजनिक रूप से उपयोग करना। जब तक आप इसे चालू न करें, कुछ उपयोग नहीं होता।",
    pa: "ਫ਼ੋਟੋ ਜਾਂ ਉਹਨਾਂ ਦੀ ਕਹਾਣੀ ਜਨਤਕ ਤੌਰ 'ਤੇ ਵਰਤਣਾ। ਜਦੋਂ ਤੱਕ ਤੁਸੀਂ ਇਸਨੂੰ ਚਾਲੂ ਨਾ ਕਰੋ, ਕੁਝ ਨਹੀਂ ਵਰਤਿਆ ਜਾਂਦਾ।",
  },
  c6Title: { en: "Consultation over video or phone", hi: "वीडियो या फ़ोन पर परामर्श", pa: "ਵੀਡੀਓ ਜਾਂ ਫ਼ੋਨ 'ਤੇ ਸਲਾਹ" },
  c6Body: {
    en: "Speaking to the doctor remotely instead of travelling, where that is offered.",
    hi: "जहाँ उपलब्ध हो, यात्रा के बजाय डॉक्टर से दूर से बात करना।",
    pa: "ਜਿੱਥੇ ਉਪਲਬਧ ਹੋਵੇ, ਸਫ਼ਰ ਦੀ ਬਜਾਏ ਡਾਕਟਰ ਨਾਲ ਦੂਰੋਂ ਗੱਲ ਕਰਨਾ।",
  },
  c7Title: { en: "Share with family", hi: "परिवार के साथ साझा करना", pa: "ਪਰਿਵਾਰ ਨਾਲ ਸਾਂਝਾ ਕਰਨਾ" },
  c7Body: {
    en: "Letting the family members you added see the full picture. Turn this off and they lose access at once.",
    hi: "आपके जोड़े परिवार के सदस्यों को पूरी जानकारी देखने देना। इसे बंद करते ही उनकी पहुँच तुरंत बंद हो जाती है।",
    pa: "ਤੁਹਾਡੇ ਜੋੜੇ ਪਰਿਵਾਰਕ ਮੈਂਬਰਾਂ ਨੂੰ ਪੂਰੀ ਜਾਣਕਾਰੀ ਦੇਖਣ ਦੇਣਾ। ਇਸਨੂੰ ਬੰਦ ਕਰਦੇ ਹੀ ਉਹਨਾਂ ਦੀ ਪਹੁੰਚ ਤੁਰੰਤ ਬੰਦ ਹੋ ਜਾਂਦੀ ਹੈ।",
  },

  // ---- erasure (Part 5.4) ----
  eraseTitle: { en: "Remove all data", hi: "सारा डेटा हटाएँ", pa: "ਸਾਰਾ ਡਾਟਾ ਹਟਾਓ" },
  eraseOpen: { en: "Remove all data…", hi: "सारा डेटा हटाएँ…", pa: "ਸਾਰਾ ਡਾਟਾ ਹਟਾਓ…" },
  eraseCancel: { en: "Keep the data", hi: "डेटा रखें", pa: "ਡਾਟਾ ਰੱਖੋ" },
  eraseWhatGoes: {
    en: "Deleted for good: every check-in, every measurement, the learned baseline, all trends, alerts and reports, and anything saved in Awaaz.",
    hi: "हमेशा के लिए हटेगा: हर जाँच, हर माप, सीखा गया आधार, सभी रुझान, अलर्ट और रिपोर्ट, और Awaaz में सहेजा गया सब कुछ।",
    pa: "ਹਮੇਸ਼ਾ ਲਈ ਹਟੇਗਾ: ਹਰ ਜਾਂਚ, ਹਰ ਮਾਪ, ਸਿੱਖਿਆ ਗਿਆ ਆਧਾਰ, ਸਾਰੇ ਰੁਝਾਨ, ਅਲਰਟ ਅਤੇ ਰਿਪੋਰਟਾਂ, ਅਤੇ Awaaz ਵਿੱਚ ਸੰਭਾਲਿਆ ਸਭ ਕੁਝ।",
  },
  eraseWhatStays: {
    en: "Kept: the record of who opened this person's data and when, and the history of these consent decisions. Both identify nobody on their own, and keeping them is what makes the removal itself checkable.",
    hi: "रखा जाएगा: किसने और कब इस व्यक्ति का डेटा खोला, और इन सहमतियों का इतिहास। दोनों अकेले किसी की पहचान नहीं करते, और इन्हें रखने से ही हटाने की जाँच संभव रहती है।",
    pa: "ਰੱਖਿਆ ਜਾਵੇਗਾ: ਕਿਸਨੇ ਅਤੇ ਕਦੋਂ ਇਸ ਵਿਅਕਤੀ ਦਾ ਡਾਟਾ ਖੋਲ੍ਹਿਆ, ਅਤੇ ਇਹਨਾਂ ਸਹਿਮਤੀਆਂ ਦਾ ਇਤਿਹਾਸ। ਦੋਵੇਂ ਇਕੱਲੇ ਕਿਸੇ ਦੀ ਪਛਾਣ ਨਹੀਂ ਕਰਦੇ, ਅਤੇ ਇਹਨਾਂ ਨੂੰ ਰੱਖਣ ਨਾਲ ਹੀ ਹਟਾਉਣ ਦੀ ਜਾਂਚ ਸੰਭਵ ਰਹਿੰਦੀ ਹੈ।",
  },
  eraseIrreversible: {
    en: "This cannot be undone, and the check-ins cannot be started again on this profile.",
    hi: "इसे पलटा नहीं जा सकता, और इस प्रोफ़ाइल पर जाँचें दोबारा शुरू नहीं हो सकतीं।",
    pa: "ਇਸਨੂੰ ਪਲਟਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ, ਅਤੇ ਇਸ ਪ੍ਰੋਫ਼ਾਈਲ 'ਤੇ ਜਾਂਚਾਂ ਦੁਬਾਰਾ ਸ਼ੁਰੂ ਨਹੀਂ ਹੋ ਸਕਦੀਆਂ।",
  },
  eraseReasonLabel: { en: "Why are you removing it?", hi: "आप इसे क्यों हटा रहे हैं?", pa: "ਤੁਸੀਂ ਇਸਨੂੰ ਕਿਉਂ ਹਟਾ ਰਹੇ ਹੋ?" },
  eraseUnderstand: {
    en: "I understand this cannot be undone.",
    hi: "मैं समझता/समझती हूँ कि इसे पलटा नहीं जा सकता।",
    pa: "ਮੈਂ ਸਮਝਦਾ/ਸਮਝਦੀ ਹਾਂ ਕਿ ਇਸਨੂੰ ਪਲਟਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।",
  },
  eraseConfirm: { en: "Remove it permanently", hi: "स्थायी रूप से हटाएँ", pa: "ਸਥਾਈ ਤੌਰ 'ਤੇ ਹਟਾਓ" },
  eraseDone: {
    en: "The data has been removed.",
    hi: "डेटा हटा दिया गया है।",
    pa: "ਡਾਟਾ ਹਟਾ ਦਿੱਤਾ ਗਿਆ ਹੈ।",
  },
  erasedBadge: { en: "Data removed", hi: "डेटा हटाया गया", pa: "ਡਾਟਾ ਹਟਾਇਆ ਗਿਆ" },
  erasedRosterNote: {
    en: "Removed on {d}. Nothing clinical remains; this entry stays only so the access record keeps its place.",
    hi: "{d} को हटाया गया। कोई नैदानिक जानकारी नहीं बची; यह प्रविष्टि केवल इसलिए है ताकि पहुँच का रिकॉर्ड बना रहे।",
    pa: "{d} ਨੂੰ ਹਟਾਇਆ ਗਿਆ। ਕੋਈ ਕਲੀਨਿਕਲ ਜਾਣਕਾਰੀ ਨਹੀਂ ਬਚੀ; ਇਹ ਐਂਟਰੀ ਸਿਰਫ਼ ਇਸ ਲਈ ਹੈ ਤਾਂ ਜੋ ਪਹੁੰਚ ਦਾ ਰਿਕਾਰਡ ਬਣਿਆ ਰਹੇ।",
  },
  privacyOpen: { en: "Consent and data", hi: "सहमति और डेटा", pa: "ਸਹਿਮਤੀ ਅਤੇ ਡਾਟਾ" },

  // ---- the doctor-in-the-loop baseline gate (Part 3.3/3.4) ----
  // The caregiver half. Two states that used to render as "progress 12/12" forever.
  baselinePendingTitle: {
    en: "Waiting for the doctor to confirm",
    hi: "डॉक्टर की पुष्टि का इंतज़ार",
    pa: "ਡਾਕਟਰ ਦੀ ਪੁਸ਼ਟੀ ਦੀ ਉਡੀਕ",
  },
  baselinePendingNote: {
    en: "Enough check-ins have been recorded. A doctor has to confirm what is normal for them before comparison starts, so nothing is being compared yet. Keep doing the check-ins.",
    hi: "पर्याप्त जाँचें दर्ज हो चुकी हैं। तुलना शुरू होने से पहले डॉक्टर को यह पुष्टि करनी होगी कि उनके लिए सामान्य क्या है, इसलिए अभी कोई तुलना नहीं हो रही। जाँचें करते रहें।",
    pa: "ਕਾਫ਼ੀ ਜਾਂਚਾਂ ਦਰਜ ਹੋ ਚੁੱਕੀਆਂ ਹਨ। ਤੁਲਨਾ ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਡਾਕਟਰ ਨੂੰ ਇਹ ਪੁਸ਼ਟੀ ਕਰਨੀ ਪਵੇਗੀ ਕਿ ਉਹਨਾਂ ਲਈ ਆਮ ਕੀ ਹੈ, ਇਸ ਲਈ ਹਾਲੇ ਕੋਈ ਤੁਲਨਾ ਨਹੀਂ ਹੋ ਰਹੀ। ਜਾਂਚਾਂ ਕਰਦੇ ਰਹੋ।",
  },
  baselineAbandonedTitle: {
    en: "This baseline was stopped",
    hi: "यह आधार रोक दिया गया",
    pa: "ਇਹ ਆਧਾਰ ਰੋਕ ਦਿੱਤਾ ਗਿਆ",
  },
  baselineAbandonedNote: {
    en: "A new one will be collected from the next check-ins. Nothing is being compared until it is complete.",
    hi: "अगली जाँचों से नया आधार बनाया जाएगा। पूरा होने तक कोई तुलना नहीं होगी।",
    pa: "ਅਗਲੀਆਂ ਜਾਂਚਾਂ ਤੋਂ ਨਵਾਂ ਆਧਾਰ ਬਣਾਇਆ ਜਾਵੇਗਾ। ਪੂਰਾ ਹੋਣ ਤੱਕ ਕੋਈ ਤੁਲਨਾ ਨਹੀਂ ਹੋਵੇਗੀ।",
  },
  // The clinician half — the decision itself.
  reviewEyebrow: { en: "Baseline review", hi: "आधार समीक्षा", pa: "ਆਧਾਰ ਸਮੀਖਿਆ" },
  baselineReviewTitle: {
    en: "This patient is waiting on you",
    hi: "यह मरीज़ आप पर निर्भर है",
    pa: "ਇਹ ਮਰੀਜ਼ ਤੁਹਾਡੇ 'ਤੇ ਨਿਰਭਰ ਹੈ",
  },
  reviewNotMonitored: {
    en: "Bands and alerts stay suppressed until you confirm. Until then this patient is not being monitored.",
    hi: "जब तक आप पुष्टि नहीं करते, बैंड और अलर्ट रुके रहेंगे। तब तक इस मरीज़ की निगरानी नहीं हो रही।",
    pa: "ਜਦੋਂ ਤੱਕ ਤੁਸੀਂ ਪੁਸ਼ਟੀ ਨਹੀਂ ਕਰਦੇ, ਬੈਂਡ ਅਤੇ ਅਲਰਟ ਰੁਕੇ ਰਹਿਣਗੇ। ਉਦੋਂ ਤੱਕ ਇਸ ਮਰੀਜ਼ ਦੀ ਨਿਗਰਾਨੀ ਨਹੀਂ ਹੋ ਰਹੀ।",
  },
  reviewBlockers: {
    en: "Not yet met",
    hi: "अभी पूरा नहीं",
    pa: "ਹਾਲੇ ਪੂਰਾ ਨਹੀਂ",
  },
  reviewColModule: { en: "Module", hi: "मॉड्यूल", pa: "ਮਾਡਿਊਲ" },
  reviewColCadence: { en: "How often", hi: "कितनी बार", pa: "ਕਿੰਨੀ ਵਾਰ" },
  reviewColSessions: { en: "Observations", hi: "अवलोकन", pa: "ਨਿਰੀਖਣ" },
  reviewColQuality: { en: "Capture quality", hi: "कैप्चर गुणवत्ता", pa: "ਕੈਪਚਰ ਗੁਣਵੱਤਾ" },
  reviewColState: { en: "State", hi: "स्थिति", pa: "ਸਥਿਤੀ" },
  reviewRejected: { en: "rejected", hi: "अस्वीकृत", pa: "ਰੱਦ" },
  reviewModuleReady: { en: "Enough repeats", hi: "पर्याप्त दोहराव", pa: "ਕਾਫ਼ੀ ਦੁਹਰਾਓ" },
  reviewModuleCollecting: { en: "Still collecting", hi: "अभी एकत्र हो रहा", pa: "ਹਾਲੇ ਇਕੱਠਾ ਹੋ ਰਿਹਾ" },
  reviewPrevious: { en: "Earlier decisions", hi: "पिछले निर्णय", pa: "ਪਿਛਲੇ ਫ਼ੈਸਲੇ" },
  reviewDecision: { en: "Your decision", hi: "आपका निर्णय", pa: "ਤੁਹਾਡਾ ਫ਼ੈਸਲਾ" },
  reviewConfirm: { en: "Confirm baseline", hi: "आधार पुष्टि करें", pa: "ਆਧਾਰ ਪੁਸ਼ਟੀ ਕਰੋ" },
  reviewExtend: { en: "Collect more", hi: "और एकत्र करें", pa: "ਹੋਰ ਇਕੱਠਾ ਕਰੋ" },
  reviewFlag: { en: "Flag a concern", hi: "चिंता दर्ज करें", pa: "ਚਿੰਤਾ ਦਰਜ ਕਰੋ" },
  reviewConfirmWarning: {
    en: "This locks the baseline and cannot be undone. Monitoring starts immediately, and every future comparison is made against these values.",
    hi: "इससे आधार लॉक हो जाएगा और इसे पलटा नहीं जा सकता। निगरानी तुरंत शुरू होगी, और आगे की हर तुलना इन्हीं मानों से होगी।",
    pa: "ਇਸ ਨਾਲ ਆਧਾਰ ਲਾਕ ਹੋ ਜਾਵੇਗਾ ਅਤੇ ਇਸਨੂੰ ਪਲਟਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ। ਨਿਗਰਾਨੀ ਤੁਰੰਤ ਸ਼ੁਰੂ ਹੋਵੇਗੀ, ਅਤੇ ਅੱਗੇ ਦੀ ਹਰ ਤੁਲਨਾ ਇਹਨਾਂ ਮੁੱਲਾਂ ਨਾਲ ਹੋਵੇਗੀ।",
  },
  reviewExtendHelp: {
    en: "The patient keeps checking in and the window grows. Say why this one is not representative.",
    hi: "मरीज़ जाँच करता रहेगा और अवधि बढ़ेगी। बताएँ कि यह अवधि प्रतिनिधि क्यों नहीं है।",
    pa: "ਮਰੀਜ਼ ਜਾਂਚ ਕਰਦਾ ਰਹੇਗਾ ਅਤੇ ਮਿਆਦ ਵਧੇਗੀ। ਦੱਸੋ ਕਿ ਇਹ ਮਿਆਦ ਪ੍ਰਤੀਨਿਧ ਕਿਉਂ ਨਹੀਂ ਹੈ।",
  },
  reviewFlagHelp: {
    en: "Nothing is locked. Record what needs a person to look at it.",
    hi: "कुछ भी लॉक नहीं होगा। दर्ज करें कि किस बात पर किसी को ध्यान देना चाहिए।",
    pa: "ਕੁਝ ਵੀ ਲਾਕ ਨਹੀਂ ਹੋਵੇਗਾ। ਦਰਜ ਕਰੋ ਕਿ ਕਿਸ ਗੱਲ 'ਤੇ ਕਿਸੇ ਨੂੰ ਧਿਆਨ ਦੇਣਾ ਚਾਹੀਦਾ ਹੈ।",
  },
  reviewNoteRequired: { en: "Reason (required)", hi: "कारण (आवश्यक)", pa: "ਕਾਰਨ (ਲਾਜ਼ਮੀ)" },
  reviewNoteOptional: { en: "Note (optional)", hi: "टिप्पणी (वैकल्पिक)", pa: "ਟਿੱਪਣੀ (ਵਿਕਲਪਿਕ)" },
  reviewNoteMissing: {
    en: "A reason is required for this decision.",
    hi: "इस निर्णय के लिए कारण आवश्यक है।",
    pa: "ਇਸ ਫ਼ੈਸਲੇ ਲਈ ਕਾਰਨ ਲਾਜ਼ਮੀ ਹੈ।",
  },
  reviewSubmit: { en: "Record decision", hi: "निर्णय दर्ज करें", pa: "ਫ਼ੈਸਲਾ ਦਰਜ ਕਰੋ" },
  // Roster badge, so a waiting patient is visible without opening every row.
  reviewAwaiting: { en: "Awaiting your review", hi: "आपकी समीक्षा बाकी", pa: "ਤੁਹਾਡੀ ਸਮੀਖਿਆ ਬਾਕੀ" },
  reviewAwaitingCount: {
    en: "Baselines awaiting you",
    hi: "आधार जो आप पर रुके हैं",
    pa: "ਆਧਾਰ ਜੋ ਤੁਹਾਡੇ 'ਤੇ ਰੁਕੇ ਹਨ",
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
