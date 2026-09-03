import { LogOut, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { forgetAwaazPatient, useAwaazTarget } from "@/lib/awaazTarget";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "./ui/button";
import { LogoMark } from "./brand/Logo";
import { LanguageToggle } from "./LanguageToggle";
import { SyncStatus } from "./ui/SyncStatus";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  // Null on a screen where no patient is known yet; the control is then not rendered
  // rather than pointing at a URL that would 404. See lib/awaazTarget.ts.
  const awaazTarget = useAwaazTarget();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur">
        <div className="container flex h-16 items-center justify-between gap-4">
          {/* The real mark, not a generic activity glyph. See components/brand/Logo.tsx —
              inline SVG because INV-11 forbids a tracked image, and because a geometric
              mark holds its shape at header size. */}
          {/* THE BRAND YIELDS FIRST. At 320px the container leaves 288px and the controls
              alone need 156px of min-content, so something has to give — and this header
              overflowed by 25px at that width before anything was added to it. Every
              control to the right is a tap target or a safety affordance; the wordmark is
              the only thing here that can lose characters without costing a function. So
              it truncates and the mark, drawn to hold its shape at ~16px, always stays.
              `min-w-0` is what makes that possible: a flex item will not shrink below its
              min-content width without it, which is why the row grew instead. */}
          <Link to="/" className="flex min-w-0 items-center gap-2.5 focus-ring rounded-lg">
            <LogoMark className="h-8 w-8 shrink-0 text-primary" />
            <span className="truncate text-title-3 text-primary">{t("appName")}</span>
          </Link>

          {/* `shrink-0`, not `min-w-0`: these are tap targets and a destructive action, so
              they must keep their full size at every width. The brand beside them absorbs
              the squeeze instead. `gap-2 sm:gap-3` buys back the width the fourth control
              costs on a phone. */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* THE SECOND DAILY SURFACE, and for a patient with aphasia the more
                important one — so it sits in the chrome at every width rather than
                behind a menu or on one screen's body. Accent-tinted to read as a
                destination, not another header utility. The label is five characters in
                all three languages, so it stays visible on a phone instead of becoming
                an icon nobody recognises. */}
            {user && awaazTarget && (
              <Link
                to={`/awaaz/${awaazTarget}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "shrink-0 border-accent/40 px-2.5 text-accent sm:px-3",
                )}
              >
                <MessageSquareText className="h-4 w-4 sm:mr-1.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">{t("awaazOpen")}</span>
              </Link>
            )}
            <LanguageToggle />
            {user && (
              <>
                <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    // A handset in this population is often shared, and the remembered
                    // id is what the next person's header would link at.
                    forgetAwaazPatient();
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
