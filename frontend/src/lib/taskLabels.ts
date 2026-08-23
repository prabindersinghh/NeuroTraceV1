/**
 * Per-task instructions in all three languages.
 *
 * The server's plan carries `label_en` as the canonical wording; these translations are
 * keyed by TASK, not by position, so a protocol reorder cannot silently attach the wrong
 * instruction to a step. English falls back to the server string — if the two ever
 * diverge, the server wins for `en` and this table only supplies hi/pa.
 */
import type { Lang } from "./types";

const LABELS: Record<string, { hi: string; pa: string }> = {
  simple_and_choice_rt: {
    hi: "जैसे ही गोला दिखे, तुरंत छुएँ।",
    pa: "ਜਿਵੇਂ ਹੀ ਗੋਲਾ ਦਿਖੇ, ਤੁਰੰਤ ਛੂਹੋ।",
  },
  word_encoding: {
    hi: "ये पाँच शब्द याद रखिए।",
    pa: "ਇਹ ਪੰਜ ਸ਼ਬਦ ਯਾਦ ਰੱਖੋ।",
  },
  sustained_ddk_sentence: {
    hi: "साँस लेकर जितनी देर हो सके 'आआआ' कहिए।",
    pa: "ਸਾਹ ਲੈ ਕੇ ਜਿੰਨੀ ਦੇਰ ਹੋ ਸਕੇ 'ਆਆਆ' ਕਹੋ।",
  },
  facial_battery: {
    hi: "जितना चौड़ा हो सके, मुस्कुराइए।",
    pa: "ਜਿੰਨਾ ਚੌੜਾ ਹੋ ਸਕੇ, ਮੁਸਕਰਾਓ।",
  },
  tongue_palate: {
    hi: "जीभ सीधी बाहर निकालिए।",
    pa: "ਜੀਭ ਸਿੱਧੀ ਬਾਹਰ ਕੱਢੋ।",
  },
  horizontal_saccades: {
    hi: "सिर स्थिर रखें। बिंदु जहाँ कूदे, वहीं देखें।",
    pa: "ਸਿਰ ਸਥਿਰ ਰੱਖੋ। ਬਿੰਦੂ ਜਿੱਥੇ ਟੱਪੇ, ਉੱਥੇ ਦੇਖੋ।",
  },
  vertical_saccades: {
    hi: "बिंदु जहाँ कूदे, वहीं देखें।",
    pa: "ਬਿੰਦੂ ਜਿੱਥੇ ਟੱਪੇ, ਉੱਥੇ ਦੇਖੋ।",
  },
  smooth_pursuit: {
    hi: "आँखों से बिंदु का पीछा करें। सिर न हिलाएँ।",
    pa: "ਅੱਖਾਂ ਨਾਲ ਬਿੰਦੂ ਦਾ ਪਿੱਛਾ ਕਰੋ। ਸਿਰ ਨਾ ਹਿਲਾਓ।",
  },
  gaze_holding: {
    hi: "नज़र बिंदु पर टिकाए रखें।",
    pa: "ਨਜ਼ਰ ਬਿੰਦੂ 'ਤੇ ਟਿਕਾਈ ਰੱਖੋ।",
  },
  svv_static_and_dynamic: {
    hi: "रेखा को तब तक घुमाएँ जब तक वह आपको बिल्कुल सीधी न लगे।",
    pa: "ਰੇਖਾ ਨੂੰ ਉਦੋਂ ਤੱਕ ਘੁਮਾਓ ਜਦੋਂ ਤੱਕ ਉਹ ਤੁਹਾਨੂੰ ਬਿਲਕੁਲ ਸਿੱਧੀ ਨਾ ਲੱਗੇ।",
  },
  romberg_eyes_open: {
    hi: "पैर मिलाकर खड़े हों, बाहें बगल में।",
    pa: "ਪੈਰ ਮਿਲਾ ਕੇ ਖੜ੍ਹੇ ਹੋਵੋ, ਬਾਹਾਂ ਪਾਸੇ।",
  },
  romberg_eyes_closed: {
    hi: "अब आँखें बंद करें। कोई पास खड़ा रहे।",
    pa: "ਹੁਣ ਅੱਖਾਂ ਬੰਦ ਕਰੋ। ਕੋਈ ਕੋਲ ਖੜ੍ਹਾ ਰਹੇ।",
  },
  tandem_stance: {
    hi: "एक पैर ठीक दूसरे के आगे रखें, एड़ी से पंजा मिलाकर।",
    pa: "ਇੱਕ ਪੈਰ ਠੀਕ ਦੂਜੇ ਦੇ ਅੱਗੇ ਰੱਖੋ, ਅੱਡੀ ਨਾਲ ਪੰਜਾ ਮਿਲਾ ਕੇ।",
  },
  pronator_drift: {
    hi: "दोनों बाहें सीधी आगे, हथेलियाँ ऊपर, फिर आँखें बंद करें।",
    pa: "ਦੋਵੇਂ ਬਾਹਾਂ ਸਿੱਧੀਆਂ ਅੱਗੇ, ਹਥੇਲੀਆਂ ਉੱਪਰ, ਫਿਰ ਅੱਖਾਂ ਬੰਦ ਕਰੋ।",
  },
  finger_tapping: {
    hi: "दोनों गोलों को बारी-बारी, जितनी तेज़ हो सके, छुएँ।",
    pa: "ਦੋਵੇਂ ਗੋਲਿਆਂ ਨੂੰ ਵਾਰੀ-ਵਾਰੀ, ਜਿੰਨੀ ਤੇਜ਼ ਹੋ ਸਕੇ, ਛੂਹੋ।",
  },
  finger_to_nose: {
    hi: "स्क्रीन का बिंदु छुएँ, फिर अपनी नाक। दोहराएँ।",
    pa: "ਸਕ੍ਰੀਨ ਦਾ ਬਿੰਦੂ ਛੂਹੋ, ਫਿਰ ਆਪਣਾ ਨੱਕ। ਦੁਹਰਾਓ।",
  },
  rapid_alternating: {
    hi: "हाथ को पलटें और सीधा करें, जितनी तेज़ हो सके।",
    pa: "ਹੱਥ ਨੂੰ ਉਲਟਾਓ ਅਤੇ ਸਿੱਧਾ ਕਰੋ, ਜਿੰਨੀ ਤੇਜ਼ ਹੋ ਸਕੇ।",
  },
  delayed_recall: {
    hi: "वे पाँच शब्द क्या थे?",
    pa: "ਉਹ ਪੰਜ ਸ਼ਬਦ ਕੀ ਸਨ?",
  },
  phq2: {
    hi: "आपके मन के बारे में दो छोटे सवाल।",
    pa: "ਤੁਹਾਡੇ ਮਨ ਬਾਰੇ ਦੋ ਛੋਟੇ ਸਵਾਲ।",
  },
  medication_confirm: {
    hi: "क्या आज दवाइयाँ ली गईं?",
    pa: "ਕੀ ਅੱਜ ਦਵਾਈਆਂ ਲਈਆਂ ਗਈਆਂ?",
  },
  ppg_rhythm: {
    hi: "उँगली से कैमरा ढकें। हाथ को आराम दें।",
    pa: "ਉਂਗਲੀ ਨਾਲ ਕੈਮਰਾ ਢੱਕੋ। ਹੱਥ ਨੂੰ ਆਰਾਮ ਦਿਓ।",
  },
};

export function taskLabel(task: string, serverEn: string, lang: Lang): string {
  if (lang === "en") return serverEn;
  return LABELS[task]?.[lang] ?? serverEn;
}
