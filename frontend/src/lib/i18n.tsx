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

import type { Lang } from "./types";

const STRINGS = {
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
const LANG_KEY = "neurotrace.lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang | null) ?? "en",
  );

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(LANG_KEY, next);
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
