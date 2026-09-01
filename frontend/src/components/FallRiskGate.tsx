/**
 * Fall-risk gate — shown before BLOCK C (standing balance), every session.
 *
 * The next four tasks deliberately destabilise an elderly stroke survivor: feet together,
 * then eyes closed, then heel-to-toe, then arms out with eyes closed. Each removes one of
 * the systems a person uses to stay upright. That is the point of the tests, and it is also
 * exactly why they are the most dangerous moments in the whole protocol.
 *
 * TWO DESIGN DECISIONS THAT LOOK LIKE FRICTION AND ARE NOT
 *
 * Not dismissible by tapping through. A single "OK" gets tapped without reading by the
 * third session — that is not a criticism of caregivers, it is what any human does with a
 * dialog they have seen before. So the confirm is a deliberate act with a checkbox, and it
 * reappears every session rather than being remembered.
 *
 * Skipping is a first-class option, not a failure. If nobody is home to stand beside them,
 * the correct action is to skip the balance block — not to do it alone. An interface that
 * makes skipping feel like non-compliance will get the tests done unsupervised, which is
 * the outcome the gate exists to prevent.
 */
import { useState } from "react";

import { useI18n } from "../lib/i18n";
import { Button } from "./ui/button";

const COPY = {
  title: {
    en: "The next tests involve standing",
    hi: "अगली जाँचों में खड़ा होना है",
    pa: "ਅਗਲੀਆਂ ਜਾਂਚਾਂ ਵਿੱਚ ਖੜ੍ਹਾ ਹੋਣਾ ਹੈ",
  },
  points: {
    en: [
      "Someone must stand beside them.",
      "Do this near a wall or a sturdy chair.",
      "If they feel dizzy, stop immediately.",
    ],
    hi: [
      "किसी को उनके पास खड़ा होना चाहिए।",
      "यह दीवार या मज़बूत कुर्सी के पास कीजिए।",
      "चक्कर आए तो तुरंत रोक दीजिए।",
    ],
    pa: [
      "ਕਿਸੇ ਨੂੰ ਉਹਨਾਂ ਦੇ ਕੋਲ ਖੜ੍ਹਾ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।",
      "ਇਹ ਕੰਧ ਜਾਂ ਮਜ਼ਬੂਤ ਕੁਰਸੀ ਦੇ ਕੋਲ ਕਰੋ।",
      "ਚੱਕਰ ਆਵੇ ਤਾਂ ਤੁਰੰਤ ਰੋਕ ਦਿਓ।",
    ],
  },
  confirm: {
    en: "I am standing beside them now",
    hi: "मैं अभी उनके पास खड़ा/खड़ी हूँ",
    pa: "ਮੈਂ ਹੁਣ ਉਹਨਾਂ ਦੇ ਕੋਲ ਖੜ੍ਹਾ/ਖੜ੍ਹੀ ਹਾਂ",
  },
  start: { en: "Start balance tests", hi: "संतुलन जाँच शुरू करें", pa: "ਸੰਤੁਲਨ ਜਾਂਚ ਸ਼ੁਰੂ ਕਰੋ" },
  skip: {
    en: "Skip these — nobody is here to help",
    hi: "इन्हें छोड़ें — अभी कोई मदद के लिए नहीं है",
    pa: "ਇਹ ਛੱਡੋ — ਹੁਣ ਕੋਈ ਮਦਦ ਲਈ ਨਹੀਂ ਹੈ",
  },
  skip_ok: {
    en: "That is the right choice. We will note it and carry on.",
    hi: "यही सही है। हम इसे दर्ज कर के आगे बढ़ेंगे।",
    pa: "ਇਹੀ ਸਹੀ ਹੈ। ਅਸੀਂ ਇਸਨੂੰ ਦਰਜ ਕਰਕੇ ਅੱਗੇ ਵਧਾਂਗੇ।",
  },
} as const;

export function FallRiskGate({
  onProceed,
  onSkip,
}: {
  onProceed: () => void;
  onSkip: (reason: string) => void;
}) {
  const { lang, t } = useI18n();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    // Rendered inside the journey shell (the path stays visible), but still an alert
    // dialog: nothing else on the page is actionable until this is answered.
    <div
      className="flex flex-1 flex-col justify-center gap-6 py-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="scene-title"
    >
      <p className="text-label text-muted-foreground">{t("chStanding")}</p>
      <h2 id="scene-title" tabIndex={-1} className="text-title-1 focus:outline-none">
        {COPY.title[lang]}
      </h2>

      <ul className="space-y-3">
        {COPY.points[lang].map((p) => (
          <li key={p} className="flex gap-3 text-lg leading-snug">
            <span aria-hidden className="text-accent">
              •
            </span>
            <span>{p}</span>
          </li>
        ))}
      </ul>

      {/* A deliberate act, not a tap-through. Reappears every session — a dialog seen
          before is a dialog not read. */}
      <label className="flex items-start gap-3 rounded-xl border-2 border-line p-4 text-lg">
        <input
          type="checkbox"
          className="mt-1 h-6 w-6 shrink-0"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>{COPY.confirm[lang]}</span>
      </label>

      <Button size="touch" variant="accent" disabled={!acknowledged} onClick={onProceed}>
        {COPY.start[lang]}
      </Button>

      {/* Skipping is a first-class option. Styled as a real choice, not a way out. */}
      <button
        type="button"
        onClick={() => onSkip("no_supervisor_present")}
        className="focus-ring tactile min-h-14 w-full rounded-xl border-2 border-line px-4 text-lg text-foreground"
      >
        {COPY.skip[lang]}
      </button>
      <p className="text-center text-sm text-muted-foreground">{COPY.skip_ok[lang]}</p>
    </div>
  );
}

export default FallRiskGate;
