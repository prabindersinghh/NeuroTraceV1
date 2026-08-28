import { Activity, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Button } from "./ui/button";
import { LanguageToggle } from "./LanguageToggle";
import { SyncStatus } from "./ui/SyncStatus";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 focus-ring rounded-lg">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold tracking-tight text-primary">{t("appName")}</span>
          </Link>

          <div className="flex items-center gap-3">
            <LanguageToggle />
            {user && (
              <>
                <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    logout();
                    navigate("/login", { replace: true });
                  }}
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  {/*
                    * `sr-only sm:not-sr-only`, not `hidden sm:inline`. The icon is
                    * aria-hidden, so with the label `hidden` below the sm breakpoint this
                    * button had NO accessible name on exactly the phone form factor the
                    * product targets — announced as just "button", next to the language
                    * control, for its only destructive action. The rendered layout is
                    * identical at every width; only the accessibility tree changes.
                    */}
                  <span className="sr-only sm:not-sr-only">{t("signOut")}</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Renders nothing when online with an empty queue — see SyncStatus. */}
      <SyncStatus />

      <main className="container py-8">{children}</main>
    </div>
  );
}
