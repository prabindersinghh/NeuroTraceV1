/**
 * Onboarding — done by the CAREGIVER, not the patient (SPEC v4 Part 2).
 *
 * The patient's first interaction with this product must not be a chore. Someone who has
 * recently lost speech or the use of a hand does not need a seven-step setup wizard as an
 * introduction; they need the first thing they do in the app to be short and to work. So
 * consent, profile, disclosure and calibration are the caregiver's job, and the patient
 * appears at step 6 for a practice session that is not scored.
 *
 * STEP 3 IS A SAFETY CONTROL, NOT LEGAL DECORATION.
 *
 * The scope disclosure cannot be skipped, cannot be tapped through, and requires the
 * caregiver to acknowledge each line individually. That is deliberate friction in the one
 * place friction saves someone: a family who believes this app watches for strokes will
 * wait and check the phone during an emergency instead of calling an ambulance. The product
 * detects change over days. It cannot see an acute event. If a family misunderstands that,
 * every other thing we built is worse than useless.
 */
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { Button } from "../components/ui/button";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Each must be acknowledged separately. A single "I agree" gets tapped unread. */
const SCOPE_LIMITS = {
  en: [
    "This is not a medical device. It does not diagnose anything.",
    "It CANNOT detect a stroke that is happening now.",
    "For sudden weakness, drooping, or slurred speech — call 108 immediately. Do not open this app first.",
    "It watches for slow changes over days, and can be wrong.",
    "Nothing here replaces their doctor.",
  ],
  hi: [
    "यह कोई मेडिकल डिवाइस नहीं है। यह किसी बीमारी की पहचान नहीं करता।",
    "यह अभी हो रहे स्ट्रोक को नहीं पकड़ सकता।",
    "अचानक कमज़ोरी, चेहरा लटकना या बोली लड़खड़ाना — तुरंत 108 पर फ़ोन कीजिए। पहले यह ऐप मत खोलिए।",
    "यह कई दिनों में होने वाले धीमे बदलाव देखता है, और ग़लत भी हो सकता है।",
    "यह उनके डॉक्टर की जगह नहीं ले सकता।",
  ],
  pa: [
    "ਇਹ ਕੋਈ ਮੈਡੀਕਲ ਡਿਵਾਈਸ ਨਹੀਂ ਹੈ। ਇਹ ਕਿਸੇ ਬਿਮਾਰੀ ਦੀ ਪਛਾਣ ਨਹੀਂ ਕਰਦਾ।",
    "ਇਹ ਹੁਣ ਹੋ ਰਹੇ ਸਟ੍ਰੋਕ ਨੂੰ ਨਹੀਂ ਫੜ ਸਕਦਾ।",
    "ਅਚਾਨਕ ਕਮਜ਼ੋਰੀ, ਚਿਹਰਾ ਲਟਕਣਾ ਜਾਂ ਬੋਲੀ ਲੜਖੜਾਉਣਾ — ਤੁਰੰਤ 108 'ਤੇ ਫ਼ੋਨ ਕਰੋ। ਪਹਿਲਾਂ ਇਹ ਐਪ ਨਾ ਖੋਲ੍ਹੋ।",
    "ਇਹ ਕਈ ਦਿਨਾਂ ਵਿੱਚ ਹੋਣ ਵਾਲੀਆਂ ਹੌਲੀ ਤਬਦੀਲੀਆਂ ਦੇਖਦਾ ਹੈ, ਅਤੇ ਗ਼ਲਤ ਵੀ ਹੋ ਸਕਦਾ ਹੈ।",
    "ਇਹ ਉਹਨਾਂ ਦੇ ਡਾਕਟਰ ਦੀ ਥਾਂ ਨਹੀਂ ਲੈ ਸਕਦਾ।",
  ],
} as const;

/** Versioned: a material change to what we collect requires re-consent. */
export const CONSENT_VERSION = "2026-08-v4";

const CONSENT_POINTS = {
  en: [
    "Recordings of their face and voice are turned into numbers ON THE PHONE and then deleted. No video or audio is ever sent anywhere.",
    "We store those numbers, the scores we calculate, and what you tell us.",
    "You can delete everything, permanently, at any time.",
  ],
  hi: [
    "उनके चेहरे और आवाज़ की रिकॉर्डिंग फ़ोन पर ही संख्याओं में बदल दी जाती है और फिर मिटा दी जाती है। कोई वीडियो या ऑडियो कहीं नहीं भेजा जाता।",
    "हम वे संख्याएँ, निकाले गए स्कोर, और आपकी दी जानकारी रखते हैं।",
    "आप कभी भी सब कुछ हमेशा के लिए मिटा सकते हैं।",
  ],
  pa: [
    "ਉਹਨਾਂ ਦੇ ਚਿਹਰੇ ਅਤੇ ਆਵਾਜ਼ ਦੀ ਰਿਕਾਰਡਿੰਗ ਫ਼ੋਨ 'ਤੇ ਹੀ ਨੰਬਰਾਂ ਵਿੱਚ ਬਦਲ ਦਿੱਤੀ ਜਾਂਦੀ ਹੈ ਅਤੇ ਫਿਰ ਮਿਟਾ ਦਿੱਤੀ ਜਾਂਦੀ ਹੈ। ਕੋਈ ਵੀਡੀਓ ਜਾਂ ਆਡੀਓ ਕਿਤੇ ਨਹੀਂ ਭੇਜਿਆ ਜਾਂਦਾ।",
    "ਅਸੀਂ ਉਹ ਨੰਬਰ, ਕੱਢੇ ਗਏ ਸਕੋਰ, ਅਤੇ ਤੁਹਾਡੀ ਦਿੱਤੀ ਜਾਣਕਾਰੀ ਰੱਖਦੇ ਹਾਂ।",
    "ਤੁਸੀਂ ਕਦੇ ਵੀ ਸਭ ਕੁਝ ਹਮੇਸ਼ਾ ਲਈ ਮਿਟਾ ਸਕਦੇ ਹੋ।",
  ],
} as const;

const TITLES = {
  1: { en: "Your account and consent", hi: "आपका खाता और सहमति", pa: "ਤੁਹਾਡਾ ਖਾਤਾ ਅਤੇ ਸਹਿਮਤੀ" },
  2: { en: "About them", hi: "उनके बारे में", pa: "ਉਹਨਾਂ ਬਾਰੇ" },
  3: { en: "What this app cannot do", hi: "यह ऐप क्या नहीं कर सकता", pa: "ਇਹ ਐਪ ਕੀ ਨਹੀਂ ਕਰ ਸਕਦਾ" },
  4: { en: "Setting up the camera", hi: "कैमरा सेट करना", pa: "ਕੈਮਰਾ ਸੈੱਟ ਕਰਨਾ" },
  5: { en: "Where to put the phone", hi: "फ़ोन कहाँ रखें", pa: "ਫ਼ੋਨ ਕਿੱਥੇ ਰੱਖੋ" },
  6: { en: "A practice run together", hi: "साथ में अभ्यास", pa: "ਇਕੱਠੇ ਅਭਿਆਸ" },
  7: { en: "Learning what is normal for him", hi: "उनका सामान्य क्या है, यह सीखना", pa: "ਉਹਨਾਂ ਦਾ ਆਮ ਕੀ ਹੈ, ਇਹ ਸਿੱਖਣਾ" },
} as const;

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { lang } = useI18n();
  const [step, setStep] = useState<Step>(1);
  const [consented, setConsented] = useState(false);
  // One box per limit. The gate opens only when every one is ticked.
  const [limitsAcked, setLimitsAcked] = useState<boolean[]>(
    () => SCOPE_LIMITS.en.map(() => false),
  );

  const allLimitsAcked = limitsAcked.every(Boolean);

  function next() {
    if (step === 7) return onDone();
    setStep((s) => (s + 1) as Step);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-5 p-5">
      <header className="space-y-2">
        <div className="flex gap-1" aria-label={`step ${step} of 7`}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span
              key={n}
              className={[
                "h-1.5 flex-1 rounded-full",
                n <= step ? "bg-accent" : "bg-muted",
              ].join(" ")}
            />
          ))}
        </div>
        <h1 className="text-2xl font-semibold">{TITLES[step][lang]}</h1>
      </header>

      <div className="flex-1 space-y-4">
        {step === 1 && (
          <>
            <ul className="space-y-3">
              {CONSENT_POINTS[lang].map((p) => (
                <li key={p} className="text-lg leading-snug">
                  {p}
                </li>
              ))}
            </ul>
            <label className="flex items-start gap-3 rounded-lg border p-4 text-lg">
              <input
                type="checkbox"
                className="mt-1 h-6 w-6 shrink-0"
                checked={consented}
                onChange={(e) => setConsented(e.target.checked)}
              />
              <span>
                {{ en: "I have read and agree", hi: "मैंने पढ़ लिया और सहमत हूँ",
                   pa: "ਮੈਂ ਪੜ੍ਹ ਲਿਆ ਅਤੇ ਸਹਿਮਤ ਹਾਂ" }[lang]}
              </span>
            </label>
            <p className="text-xs text-muted-foreground">Consent version {CONSENT_VERSION}</p>
          </>
        )}

        {step === 2 && (
          <p className="text-lg">
            {{ en: "Age, languages, when the stroke was, which side. We check eligibility here — if it was less than three months ago, or if a doctor has diagnosed Parkinson's, we will explain why this app is not suitable rather than just refusing.",
               hi: "उम्र, भाषाएँ, स्ट्रोक कब हुआ, किस तरफ़। हम यहीं पात्रता जाँचते हैं — अगर तीन महीने से कम हुआ है, या डॉक्टर ने पार्किंसंस बताया है, तो हम सिर्फ़ मना नहीं करेंगे, कारण बताएँगे।",
               pa: "ਉਮਰ, ਭਾਸ਼ਾਵਾਂ, ਸਟ੍ਰੋਕ ਕਦੋਂ ਹੋਇਆ, ਕਿਸ ਪਾਸੇ। ਅਸੀਂ ਇੱਥੇ ਹੀ ਯੋਗਤਾ ਜਾਂਚਦੇ ਹਾਂ — ਜੇ ਤਿੰਨ ਮਹੀਨੇ ਤੋਂ ਘੱਟ ਹੋਇਆ ਹੈ, ਜਾਂ ਡਾਕਟਰ ਨੇ ਪਾਰਕਿੰਸਨ ਦੱਸਿਆ ਹੈ, ਤਾਂ ਅਸੀਂ ਸਿਰਫ਼ ਮਨ੍ਹਾ ਨਹੀਂ ਕਰਾਂਗੇ, ਕਾਰਨ ਦੱਸਾਂਗੇ।" }[lang]}
          </p>
        )}

        {/* STEP 3 — the safety control. Every line ticked individually. */}
        {step === 3 && (
          <ul className="space-y-3">
            {SCOPE_LIMITS[lang].map((limit, i) => (
              <li key={limit}>
                <label className="flex items-start gap-3 rounded-lg border p-4 text-lg leading-snug">
                  <input
                    type="checkbox"
                    className="mt-1 h-6 w-6 shrink-0"
                    checked={limitsAcked[i]}
                    onChange={(e) =>
                      setLimitsAcked((prev) => {
                        const nx = [...prev];
                        nx[i] = e.target.checked;
                        return nx;
                      })
                    }
                  />
                  <span>{limit}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {step === 4 && (
          <p className="text-lg">
            {{ en: "We measure their height for the balance tests, check how fast the camera records, take a test photo for lighting, check the microphone, and learn their face and voice so we know it is them.",
               hi: "संतुलन जाँच के लिए हम उनकी लंबाई लेते हैं, कैमरे की गति जाँचते हैं, रोशनी के लिए एक टेस्ट फ़ोटो लेते हैं, माइक जाँचते हैं, और उनका चेहरा व आवाज़ पहचानना सीखते हैं।",
               pa: "ਸੰਤੁਲਨ ਜਾਂਚ ਲਈ ਅਸੀਂ ਉਹਨਾਂ ਦੀ ਲੰਬਾਈ ਲੈਂਦੇ ਹਾਂ, ਕੈਮਰੇ ਦੀ ਰਫ਼ਤਾਰ ਜਾਂਚਦੇ ਹਾਂ, ਰੌਸ਼ਨੀ ਲਈ ਇੱਕ ਟੈਸਟ ਫ਼ੋਟੋ ਲੈਂਦੇ ਹਾਂ, ਮਾਈਕ ਜਾਂਚਦੇ ਹਾਂ, ਅਤੇ ਉਹਨਾਂ ਦਾ ਚਿਹਰਾ ਤੇ ਆਵਾਜ਼ ਪਛਾਣਨਾ ਸਿੱਖਦੇ ਹਾਂ।" }[lang]}
          </p>
        )}

        {step === 5 && (
          <ul className="space-y-3 text-lg">
            {(
              { en: ["Phone at chest height", "About one and a half metres away",
                     "His whole body in the picture", "Light in front of him, not behind",
                     "A chair or wall within reach"],
                hi: ["फ़ोन छाती की ऊँचाई पर", "करीब डेढ़ मीटर दूर", "पूरा शरीर तस्वीर में",
                     "रोशनी सामने से, पीछे से नहीं", "पास में कुर्सी या दीवार"],
                pa: ["ਫ਼ੋਨ ਛਾਤੀ ਦੀ ਉਚਾਈ 'ਤੇ", "ਲਗਭਗ ਡੇਢ ਮੀਟਰ ਦੂਰ", "ਪੂਰਾ ਸਰੀਰ ਤਸਵੀਰ ਵਿੱਚ",
                     "ਰੌਸ਼ਨੀ ਸਾਹਮਣੇ ਤੋਂ, ਪਿੱਛੋਂ ਨਹੀਂ", "ਕੋਲ ਕੁਰਸੀ ਜਾਂ ਕੰਧ"] }
            )[lang].map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden className="text-accent">•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}

        {step === 6 && (
          <p className="text-lg">
            {{ en: "Do this one together. Every task shows a short video first. Nothing is scored — this is only so he knows what to expect.",
               hi: "यह साथ मिलकर कीजिए। हर काम से पहले एक छोटा वीडियो दिखेगा। कुछ भी गिना नहीं जाएगा — यह सिर्फ़ अभ्यास है।",
               pa: "ਇਹ ਇਕੱਠੇ ਕਰੋ। ਹਰ ਕੰਮ ਤੋਂ ਪਹਿਲਾਂ ਇੱਕ ਛੋਟਾ ਵੀਡੀਓ ਦਿਖੇਗਾ। ਕੁਝ ਵੀ ਗਿਣਿਆ ਨਹੀਂ ਜਾਵੇਗਾ — ਇਹ ਸਿਰਫ਼ ਅਭਿਆਸ ਹੈ।" }[lang]}
          </p>
        )}

        {step === 7 && (
          <p className="text-lg">
            {{ en: "For the next two to three weeks we are learning what is normal FOR HIM. We will not show scores or warnings during this time, because we do not yet know what normal looks like for him — and a warning based on a guess is worse than none.",
               hi: "अगले दो-तीन हफ़्ते हम सीखेंगे कि उनके लिए सामान्य क्या है। इस दौरान हम कोई स्कोर या चेतावनी नहीं दिखाएँगे, क्योंकि हमें अभी उनका सामान्य पता नहीं — और अंदाज़े पर दी चेतावनी न देने से बुरी है।",
               pa: "ਅਗਲੇ ਦੋ-ਤਿੰਨ ਹਫ਼ਤੇ ਅਸੀਂ ਸਿੱਖਾਂਗੇ ਕਿ ਉਹਨਾਂ ਲਈ ਆਮ ਕੀ ਹੈ। ਇਸ ਦੌਰਾਨ ਅਸੀਂ ਕੋਈ ਸਕੋਰ ਜਾਂ ਚੇਤਾਵਨੀ ਨਹੀਂ ਦਿਖਾਵਾਂਗੇ, ਕਿਉਂਕਿ ਸਾਨੂੰ ਹਾਲੇ ਉਹਨਾਂ ਦਾ ਆਮ ਪਤਾ ਨਹੀਂ।" }[lang]}
          </p>
        )}
      </div>

      <Button
        className="min-h-16 w-full text-lg"
        disabled={(step === 1 && !consented) || (step === 3 && !allLimitsAcked)}
        onClick={next}
      >
        {step === 7
          ? { en: "Start", hi: "शुरू करें", pa: "ਸ਼ੁਰੂ ਕਰੋ" }[lang]
          : { en: "Continue", hi: "आगे", pa: "ਅੱਗੇ" }[lang]}
      </Button>

      {step === 3 && !allLimitsAcked && (
        <p className="text-center text-sm text-muted-foreground">
          {{ en: "Please tick each line. These matter.",
             hi: "कृपया हर पंक्ति पर निशान लगाइए। ये ज़रूरी हैं।",
             pa: "ਕਿਰਪਾ ਕਰਕੇ ਹਰ ਲਾਈਨ 'ਤੇ ਨਿਸ਼ਾਨ ਲਗਾਓ। ਇਹ ਜ਼ਰੂਰੀ ਹਨ।" }[lang]}
        </p>
      )}
    </div>
  );
}
