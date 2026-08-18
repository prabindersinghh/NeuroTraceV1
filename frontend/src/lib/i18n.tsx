/** Minimal EN/HI dictionary. The patient flow and the caregiver summary are both bilingual. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Lang = "en" | "hi";

const STRINGS = {
  // --- shell ---
  appName: { en: "NeuroTrace", hi: "न्यूरोट्रेस" },
  tagline: {
    en: "45 seconds a day. Catches change before it becomes an emergency.",
    hi: "रोज़ 45 सेकंड। बदलाव को आपात स्थिति बनने से पहले पकड़ता है।",
  },
  signOut: { en: "Sign out", hi: "साइन आउट" },
  loading: { en: "Loading…", hi: "लोड हो रहा है…" },
  retry: { en: "Try again", hi: "फिर कोशिश करें" },
  back: { en: "Back", hi: "वापस" },

  // --- auth ---
  signIn: { en: "Sign in", hi: "साइन इन करें" },
  signUp: { en: "Create account", hi: "खाता बनाएँ" },
  email: { en: "Email", hi: "ईमेल" },
  password: { en: "Password", hi: "पासवर्ड" },
  fullName: { en: "Your name", hi: "आपका नाम" },
  iAmA: { en: "I am a", hi: "मैं हूँ" },
  rolePatient: { en: "Patient", hi: "मरीज़" },
  roleCaregiver: { en: "Caregiver", hi: "देखभालकर्ता" },
  roleClinician: { en: "Clinician", hi: "चिकित्सक" },
  noAccount: { en: "No account yet?", hi: "अभी खाता नहीं है?" },
  haveAccount: { en: "Already have an account?", hi: "पहले से खाता है?" },
  passwordHint: { en: "At least 8 characters", hi: "कम से कम 8 अक्षर" },
  tryDemo: { en: "Open the demo", hi: "डेमो खोलें" },
  demoHint: {
    en: "Loads Ramesh, 67 — ten days of history ending in an alert.",
    hi: "रमेश, 67 — दस दिन का इतिहास, अंत में अलर्ट।",
  },

  // --- caregiver home ---
  yourPatients: { en: "Your patients", hi: "आपके मरीज़" },
  addPatient: { en: "Add patient", hi: "मरीज़ जोड़ें" },
  patientName: { en: "Name", hi: "नाम" },
  age: { en: "Age", hi: "उम्र" },
  sex: { en: "Sex", hi: "लिंग" },
  language: { en: "Preferred language", hi: "पसंदीदा भाषा" },
  save: { en: "Save", hi: "सहेजें" },
  cancel: { en: "Cancel", hi: "रद्द करें" },
  noPatients: { en: "No patients yet. Add one to begin.", hi: "अभी कोई मरीज़ नहीं। शुरू करने के लिए एक जोड़ें।" },
  openDashboard: { en: "Dashboard", hi: "डैशबोर्ड" },
  startCheckin: { en: "Start check-in", hi: "जाँच शुरू करें" },
  buildingBaseline: { en: "Building baseline", hi: "आधार बन रहा है" },

  // --- check-in ---
  checkinTitle: { en: "Daily check-in", hi: "रोज़ाना जाँच" },
  stepOf: { en: "Step", hi: "चरण" },
  of: { en: "of", hi: "में से" },
  begin: { en: "Begin", hi: "शुरू करें" },
  next: { en: "Next", hi: "आगे" },

  speakTitle: { en: "Read this out loud", hi: "इसे ज़ोर से पढ़ें" },
  speakSentence: {
    en: "The quick brown fox jumps over the lazy dog near the river bank.",
    hi: "आज मौसम बहुत अच्छा है और मैं अपने परिवार के साथ बाहर घूमने जा रहा हूँ।",
  },
  startRecording: { en: "Start recording", hi: "रिकॉर्डिंग शुरू करें" },
  stopRecording: { en: "Stop", hi: "रोकें" },
  recording: { en: "Recording…", hi: "रिकॉर्ड हो रहा है…" },

  faceTitle: { en: "Look at the camera", hi: "कैमरे की ओर देखें" },
  faceInstruction: { en: "Smile, then blink twice.", hi: "मुस्कुराएँ, फिर दो बार पलक झपकाएँ।" },
  startCamera: { en: "Start camera", hi: "कैमरा शुरू करें" },

  tapTitle: { en: "Tap when the circle turns blue", hi: "जब घेरा नीला हो, तब दबाएँ" },
  tapInstruction: { en: "As fast as you can. 12 times.", hi: "जितनी जल्दी हो सके। 12 बार।" },
  tapWait: { en: "Wait…", hi: "रुकिए…" },
  tapNow: { en: "TAP", hi: "दबाएँ" },
  tapTooSoon: { en: "Too soon — wait for blue", hi: "बहुत जल्दी — नीले का इंतज़ार करें" },
  trial: { en: "Tap", hi: "टैप" },

  uploading: { en: "Sending…", hi: "भेजा जा रहा है…" },
  allDone: { en: "All done ✓", hi: "हो गया ✓" },
  allDoneBody: {
    en: "Thank you. Your check-in has been recorded.",
    hi: "धन्यवाद। आपकी जाँच दर्ज हो गई है।",
  },
  doneAgain: { en: "Finish", hi: "समाप्त" },

  permissionDenied: {
    en: "We could not access your microphone or camera. Please allow it in your browser and try again.",
    hi: "हम आपका माइक्रोफ़ोन या कैमरा नहीं खोल पाए। कृपया ब्राउज़र में अनुमति दें और फिर कोशिश करें।",
  },
  unsupportedBrowser: {
    en: "This browser cannot record audio or video. Please use Chrome or Safari.",
    hi: "यह ब्राउज़र रिकॉर्ड नहीं कर सकता। कृपया Chrome या Safari का उपयोग करें।",
  },
  skipStep: { en: "Skip this step", hi: "यह चरण छोड़ें" },

  // --- dashboard ---
  status: { en: "Status", hi: "स्थिति" },
  todaySummary: { en: "Today's summary", hi: "आज का सार" },
  bandStable: { en: "Stable", hi: "स्थिर" },
  bandWatch: { en: "Watch", hi: "निगरानी" },
  bandAlert: { en: "Alert", hi: "अलर्ट" },
  voiceTrend: { en: "Voice", hi: "आवाज़" },
  faceTrend: { en: "Face", hi: "चेहरा" },
  reactionTrend: { en: "Reaction", hi: "प्रतिक्रिया" },
  deviationAxis: { en: "Deviation from baseline", hi: "आधार से विचलन" },
  alertLine: { en: "Alert threshold", hi: "अलर्ट सीमा" },
  normalBand: { en: "Normal range", hi: "सामान्य दायरा" },
  history: { en: "History", hi: "इतिहास" },
  alertLog: { en: "Alerts", hi: "अलर्ट" },
  noAlerts: { en: "No alerts. That is good news.", hi: "कोई अलर्ट नहीं। यह अच्छी ख़बर है।" },
  noData: { en: "No check-ins yet.", hi: "अभी कोई जाँच नहीं।" },
  whatsappSent: { en: "WhatsApp sent", hi: "व्हाट्सएप भेजा गया" },
  date: { en: "Date", hi: "तारीख़" },
  score: { en: "Score", hi: "स्कोर" },
  explanation: { en: "Explanation", hi: "व्याख्या" },
  baselineProgress: { en: "Baseline", hi: "आधार" },
  daysRecorded: { en: "days recorded", hi: "दिन दर्ज" },
  baselineNote: {
    en: "NeuroTrace is still learning this patient's normal. Scoring starts once the baseline is complete.",
    hi: "न्यूरोट्रेस अभी इस मरीज़ का सामान्य स्तर सीख रहा है। आधार पूरा होने पर स्कोरिंग शुरू होगी।",
  },
  readOnly: { en: "Read-only view", hi: "केवल पढ़ने के लिए" },
} as const;

export type StringKey = keyof typeof STRINGS;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: StringKey) => string;
  toggle: () => void;
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
      toggle: () => setLang(lang === "en" ? "hi" : "en"),
      t: (key: StringKey) => STRINGS[key][lang],
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
