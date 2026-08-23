/**
 * Session settings — intensity and aphasia mode, on the caregiver dashboard.
 *
 * THE WARNING IS THE POINT. Changing intensity is not a preference toggle: it moves every
 * remaining task's position on the fatigue curve, and every locked baseline encodes its
 * task's old position. The change is legitimate — a tired patient should be offered less —
 * but it must happen KNOWINGLY, so the consequence is printed beside the control, not in
 * a help page. The engine records intensity on every result and treats a change as a
 * confounder; this card is the human end of that same honesty.
 *
 * Stepping DOWN is offered automatically after repeated abandonment. Stepping UP is only
 * ever manual, from here.
 */
import { useCallback, useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Patient } from "@/lib/types";

const INTENSITIES = ["FULL", "STANDARD", "LIGHT"] as const;

const COPY = {
  title: { en: "Session settings", hi: "सेशन सेटिंग", pa: "ਸੈਸ਼ਨ ਸੈਟਿੰਗ" },
  intensity: { en: "Daily check-in length", hi: "दैनिक जाँच की लंबाई", pa: "ਰੋਜ਼ਾਨਾ ਜਾਂਚ ਦੀ ਲੰਬਾਈ" },
  full: { en: "Full · ~12 min", hi: "पूरी · ~12 मिनट", pa: "ਪੂਰੀ · ~12 ਮਿੰਟ" },
  standard: { en: "Standard · ~9 min", hi: "मानक · ~9 मिनट", pa: "ਮਿਆਰੀ · ~9 ਮਿੰਟ" },
  light: { en: "Light · ~6 min", hi: "हल्की · ~6 मिनट", pa: "ਹਲਕੀ · ~6 ਮਿੰਟ" },
  warning: {
    en: "Changing this moves where each task falls in the session. Scores around the change are read more cautiously for a while — that is expected, not a fault.",
    hi: "इसे बदलने से हर काम का क्रम बदल जाता है। बदलाव के आसपास के स्कोर कुछ समय अधिक सावधानी से पढ़े जाते हैं — यह सामान्य है, ख़राबी नहीं।",
    pa: "ਇਸਨੂੰ ਬਦਲਣ ਨਾਲ ਹਰ ਕੰਮ ਦਾ ਕ੍ਰਮ ਬਦਲ ਜਾਂਦਾ ਹੈ। ਬਦਲਾਅ ਦੇ ਆਸ-ਪਾਸ ਦੇ ਸਕੋਰ ਕੁਝ ਸਮਾਂ ਵੱਧ ਸਾਵਧਾਨੀ ਨਾਲ ਪੜ੍ਹੇ ਜਾਂਦੇ ਹਨ — ਇਹ ਆਮ ਹੈ, ਖ਼ਰਾਬੀ ਨਹੀਂ।",
  },
  aphasia: {
    en: "Aphasia mode — bigger words on screen, everything spoken aloud",
    hi: "अफ़ेज़िया मोड — स्क्रीन पर बड़े शब्द, सब कुछ बोलकर",
    pa: "ਅਫ਼ੇਜ਼ੀਆ ਮੋਡ — ਸਕ੍ਰੀਨ 'ਤੇ ਵੱਡੇ ਸ਼ਬਦ, ਸਭ ਕੁਝ ਬੋਲ ਕੇ",
  },
  saved: { en: "Saved", hi: "सहेजा गया", pa: "ਸੰਭਾਲਿਆ ਗਿਆ" },
} as const;

export function SessionSettings({ patientId, className }: { patientId: string; className?: string }) {
  const { lang } = useI18n();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    api.getPatient(patientId).then((p) => live && setPatient(p)).catch(() => undefined);
    return () => { live = false; };
  }, [patientId]);

  const save = useCallback(async (payload: { intensity?: string; aphasia_mode?: boolean }) => {
    const updated = await api.updatePatient(patientId, payload).catch(() => null);
    if (updated) {
      setPatient(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }, [patientId]);

  if (!patient) return null;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{COPY.title[lang]}</CardTitle>
        {saved && <span className="text-sm text-stable">{COPY.saved[lang]}</span>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">{COPY.intensity[lang]}</p>
          <div className="grid grid-cols-3 gap-2">
            {INTENSITIES.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => void save({ intensity: level })}
                className={[
                  "min-h-12 rounded-xl border-2 px-2 text-sm",
                  patient.intensity === level
                    ? "border-accent bg-accent/10 font-semibold"
                    : "border-line",
                ].join(" ")}
              >
                {COPY[level.toLowerCase() as "full" | "standard" | "light"][lang]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {COPY.warning[lang]}
          </p>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0"
            checked={patient.aphasia_mode}
            onChange={(e) => void save({ aphasia_mode: e.target.checked })}
          />
          <span>{COPY.aphasia[lang]}</span>
        </label>
      </CardContent>
    </Card>
  );
}

export default SessionSettings;
