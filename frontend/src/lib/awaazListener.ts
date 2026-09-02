import type { Lang } from "./types";

interface ListenerCopy {
  expiredTitle: string;
  expiredBody: string;
  connectionFailed: string;
  connecting: string;
  retry: string;
  updatesPaused: string;
  listeningWith: string;
  howToHelp: string;
  whatTheySaid: string;
  nothingYet: string;
  expiresIn: (minutes: number) => string;
  privacy: string;
}

export const LISTENER_COPY: Record<Lang, ListenerCopy> = {
  en: {
    expiredTitle: "This link has expired",
    expiredBody: "Listener links last a short time on purpose. Ask for a new one.",
    connectionFailed: "Could not connect. Check the connection and try again.",
    connecting: "Connecting…",
    retry: "Try again",
    updatesPaused: "Updates are paused while this connection recovers. The last confirmed text is still shown.",
    listeningWith: "You are listening with",
    howToHelp: "HOW TO HELP",
    whatTheySaid: "What they have said",
    nothingYet: "Nothing yet. Give them time — waiting is the help.",
    expiresIn: (minutes) => `This link expires in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    privacy: "You are seeing only what they chose to say. No health information, no history, and no recording — theirs or yours.",
  },
  hi: {
    expiredTitle: "यह लिंक समाप्त हो गया है",
    expiredBody: "सुनने वाले लिंक जानबूझकर थोड़े समय के लिए ही चलते हैं। नया लिंक माँगें।",
    connectionFailed: "कनेक्ट नहीं हो सका। कनेक्शन जाँचें और फिर कोशिश करें।",
    connecting: "कनेक्ट हो रहा है…",
    retry: "फिर कोशिश करें",
    updatesPaused: "कनेक्शन ठीक होने तक अपडेट रुके हैं। आखिरी पुष्ट संदेश अभी भी दिख रहा है।",
    listeningWith: "आप सुन रहे हैं",
    howToHelp: "मदद कैसे करें",
    whatTheySaid: "उन्होंने क्या कहा है",
    nothingYet: "अभी कुछ नहीं। उन्हें समय दें — इंतज़ार करना ही मदद है।",
    expiresIn: (minutes) => `यह लिंक लगभग ${minutes} मिनट में समाप्त हो जाएगा।`,
    privacy: "आप केवल वही देख रहे हैं जिसे उन्होंने कहने के लिए चुना है। कोई स्वास्थ्य जानकारी, कोई इतिहास और कोई रिकॉर्डिंग नहीं — न उनकी, न आपकी।",
  },
  pa: {
    expiredTitle: "ਇਸ ਲਿੰਕ ਦੀ ਮਿਆਦ ਖ਼ਤਮ ਹੋ ਗਈ ਹੈ",
    expiredBody: "ਸੁਣਨ ਵਾਲੇ ਲਿੰਕ ਜਾਣ-ਬੁੱਝ ਕੇ ਥੋੜ੍ਹੇ ਸਮੇਂ ਲਈ ਹੀ ਚੱਲਦੇ ਹਨ। ਨਵਾਂ ਲਿੰਕ ਮੰਗੋ।",
    connectionFailed: "ਕਨੈਕਟ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
    connecting: "ਕਨੈਕਟ ਹੋ ਰਿਹਾ ਹੈ…",
    retry: "ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
    updatesPaused: "ਕਨੈਕਸ਼ਨ ਠੀਕ ਹੋਣ ਤੱਕ ਅੱਪਡੇਟ ਰੁਕੇ ਹਨ। ਆਖ਼ਰੀ ਪੁਸ਼ਟੀ ਕੀਤਾ ਸੁਨੇਹਾ ਹਾਲੇ ਵੀ ਦਿਖ ਰਿਹਾ ਹੈ।",
    listeningWith: "ਤੁਸੀਂ ਸੁਣ ਰਹੇ ਹੋ",
    howToHelp: "ਮਦਦ ਕਿਵੇਂ ਕਰਨੀ ਹੈ",
    whatTheySaid: "ਉਹਨਾਂ ਨੇ ਕੀ ਕਿਹਾ ਹੈ",
    nothingYet: "ਹਾਲੇ ਕੁਝ ਨਹੀਂ। ਉਹਨਾਂ ਨੂੰ ਸਮਾਂ ਦਿਓ — ਉਡੀਕ ਕਰਨਾ ਹੀ ਮਦਦ ਹੈ।",
    expiresIn: (minutes) => `ਇਸ ਲਿੰਕ ਦੀ ਮਿਆਦ ਲਗਭਗ ${minutes} ਮਿੰਟ ਵਿੱਚ ਖ਼ਤਮ ਹੋ ਜਾਵੇਗੀ।`,
    privacy: "ਤੁਸੀਂ ਸਿਰਫ਼ ਉਹੀ ਦੇਖ ਰਹੇ ਹੋ ਜੋ ਉਹਨਾਂ ਨੇ ਕਹਿਣ ਲਈ ਚੁਣਿਆ ਹੈ। ਕੋਈ ਸਿਹਤ ਜਾਣਕਾਰੀ, ਕੋਈ ਪੁਰਾਣਾ ਰਿਕਾਰਡ ਅਤੇ ਕੋਈ ਰਿਕਾਰਡਿੰਗ ਨਹੀਂ — ਨਾ ਉਹਨਾਂ ਦੀ, ਨਾ ਤੁਹਾਡੀ।",
  },
};

export function normaliseListenerLanguage(value: string | null | undefined): Lang {
  return value === "hi" || value === "pa" ? value : "en";
}

export function listenerSharePath(token: string, lang: Lang): string {
  return `/listen/${encodeURIComponent(token)}?lang=${lang}`;
}
