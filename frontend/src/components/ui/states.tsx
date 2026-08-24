import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin", className)} aria-hidden />;
}

/**
 * Held back for a beat on purpose.
 *
 * Most of what this covers now is a lazily-imported route chunk, which on any reasonable
 * connection resolves in well under 200 ms. Painting a spinner for 80 ms and removing it
 * again reads as a stutter, not as speed — the smoothest possible loading state for a fast
 * load is no loading state at all. Slower than that and the spinner fades in properly.
 */
export function LoadingState({ label, delay = 200 }: { label?: string; delay?: number }) {
  const { t } = useI18n();
  const [show, setShow] = useState(delay === 0);
  useEffect(() => {
    if (delay === 0) return;
    const id = window.setTimeout(() => setShow(true), delay);
    return () => window.clearTimeout(id);
  }, [delay]);
  return (
    <div
      className="flex items-center justify-center gap-3 py-16 text-muted-foreground transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
      role="status"
      aria-busy="true"
    >
      <Spinner />
      <span>{label ?? t("loading")}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden />
      <p className="max-w-md text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-muted-foreground">
      {children}
    </div>
  );
}
