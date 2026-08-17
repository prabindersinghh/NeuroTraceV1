import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div
      className={cn("inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1", className)}
      role="group"
      aria-label="Language"
    >
      <Languages className="ml-1 h-4 w-4 text-muted-foreground" aria-hidden />
      {(["en", "hi"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm font-medium transition-colors focus-ring",
            lang === code ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
          )}
        >
          {code === "en" ? "EN" : "हिं"}
        </button>
      ))}
    </div>
  );
}
