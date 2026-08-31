import { Languages } from "lucide-react";

import { LANG_NAMES, LANGS, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** EN / HI / PA. Punjabi is a first-class option, not a fallback. */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-1", className)}
      role="group"
      aria-label={t("languageLabel")}
    >
      <Languages className="ml-1 mr-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            "rounded-md px-2 py-1 text-sm font-medium transition-colors focus-ring",
            lang === code
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary",
          )}
        >
          {LANG_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
