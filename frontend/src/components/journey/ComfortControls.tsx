/**
 * Three switches the patient can reach themselves: read aloud, less movement, bigger
 * text. Shown on the welcome screen and again while paused — the two places someone
 * is not in the middle of a measured task.
 *
 * Toggle buttons with `aria-pressed`, not checkboxes: a 64px button is the tremor-safe
 * target this surface uses everywhere else, and "pressed" is exactly the state.
 */
import { Type, Volume2, VolumeX, Waves } from "lucide-react";

import { usePrefs } from "@/lib/prefs";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ComfortControls({ className }: { className?: string }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = usePrefs();

  const items = [
    {
      key: "voice" as const, label: t("comfortVoice"), on: prefs.voice,
      Icon: prefs.voice ? Volume2 : VolumeX,
    },
    { key: "lowMotion" as const, label: t("comfortMotion"), on: prefs.lowMotion, Icon: Waves },
    { key: "largeText" as const, label: t("comfortText"), on: prefs.largeText, Icon: Type },
  ];

  return (
    <fieldset className={cn("flex flex-col gap-2", className)}>
      <legend className="mb-2 text-label text-muted-foreground">{t("comfortTitle")}</legend>
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ key, label, on, Icon }) => (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => setPrefs({ [key]: !on })}
            className={cn(
              "focus-ring tactile flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-3 text-base leading-tight",
              on ? "border-accent bg-accent/10 font-medium text-foreground" : "border-line text-muted-foreground",
            )}
          >
            <Icon className="h-6 w-6" aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default ComfortControls;
