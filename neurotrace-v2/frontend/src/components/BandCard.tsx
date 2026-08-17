import { AlertTriangle, CheckCircle2, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Band } from "@/lib/types";
import { cn } from "@/lib/utils";

export const BAND_STYLE: Record<Band, { ring: string; bg: string; text: string; chart: string }> = {
  STABLE: { ring: "border-stable/35", bg: "bg-stable-soft", text: "text-stable", chart: "hsl(152 60% 32%)" },
  WATCH: { ring: "border-watch/40", bg: "bg-watch-soft", text: "text-watch", chart: "hsl(35 92% 42%)" },
  ALERT: { ring: "border-alert/40", bg: "bg-alert-soft", text: "text-alert", chart: "hsl(0 72% 45%)" },
};

const ICON = { STABLE: CheckCircle2, WATCH: Eye, ALERT: AlertTriangle };

export function BandCard({
  band,
  score,
  explanation,
  baselineDay,
}: {
  band: Band;
  score: number;
  explanation: string | null;
  baselineDay: boolean;
}) {
  const { t } = useI18n();
  const style = BAND_STYLE[band];
  const Icon = ICON[band];
  const label = band === "STABLE" ? t("bandStable") : band === "WATCH" ? t("bandWatch") : t("bandAlert");

  return (
    <section
      className={cn("rounded-2xl border-2 p-6", style.ring, style.bg)}
      aria-label={t("status")}
    >
      <div className="flex flex-wrap items-center gap-4">
        <Icon className={cn("h-12 w-12 shrink-0", style.text)} aria-hidden />
        <div className="flex-1">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">{t("status")}</p>
          <p className={cn("text-4xl font-bold tracking-tight", style.text)}>{label}</p>
        </div>
        {!baselineDay && (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">{t("score")}</p>
            <p className="text-3xl font-semibold tabular-nums">{score.toFixed(0)}</p>
          </div>
        )}
      </div>

      {explanation && (
        <p className="mt-5 border-t border-current/10 pt-4 text-lg leading-relaxed text-foreground">
          {explanation}
        </p>
      )}
    </section>
  );
}
