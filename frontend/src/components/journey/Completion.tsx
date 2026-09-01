/**
 * The end — "That's everything for today."
 *
 * Neutral by rule, not by taste: no score, no band, no praise, no criticism. Bands go
 * to the caregiver dashboard after aggregation, never to the person who just performed
 * (lib/taskFlow.ts, FORBIDDEN_AT_CONFIRM; every string here is in its lexicon check).
 * The FAST card follows, as it does on every dashboard — the warning signs a family
 * must know are shown every day, independent of anything computed.
 */
import { Check, WifiOff } from "lucide-react";
import { useEffect } from "react";

import { FastCard } from "@/components/FastCard";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { speak } from "@/lib/speech-synthesis";
import type { FastCard as FastCardData } from "@/lib/types";

import { Light } from "./Light";

interface Props {
  practice: boolean;
  queuedOffline: boolean;
  fast: FastCardData | null;
  onFinish: () => void;
}

export function Completion({ practice, queuedOffline, fast, onFinish }: Props) {
  const { t, lang } = useI18n();

  useEffect(() => {
    speak(`${t("doneTitle")} ${t("doneBody")}`, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center gap-6 py-6 text-center">
      <Light state="done" size="md" disabled label={t("doneTitle")}>
        <Check className="h-14 w-14" aria-hidden />
      </Light>
      <div className="flex flex-col gap-2">
        <h2 id="scene-title" tabIndex={-1} className="text-title-1 focus:outline-none">
          {t("doneTitle")}
        </h2>
        <p className="text-xl text-muted-foreground">{t("doneBody")}</p>
        {practice && <p className="text-lg">{t("practiceDone")}</p>}
      </div>
      {queuedOffline && (
        <p className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-base">
          <WifiOff className="h-5 w-5" aria-hidden /> {t("offline")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("onDevice")}</p>
      {fast && <FastCard card={fast} className="w-full text-left" />}
      <Button size="touch" variant="accent" className="max-w-sm" onClick={onFinish}>
        {t("finish")}
      </Button>
    </div>
  );
}

export default Completion;
