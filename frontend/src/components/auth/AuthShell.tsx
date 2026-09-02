/**
 * The frame around sign-in and sign-up.
 *
 * COMPOSITION. On a large screen the form sits left in a fixed-width column and the
 * neural field sits right inside a quiet panel with the product's three trust lines —
 * the ones that are TRUE of this codebase (on-device extraction, the three-gate alert
 * rule, three spoken languages), not marketing. On a phone the form is the page; the
 * field becomes a short band above the title and disappears on a short viewport so the
 * keyboard never pushes the submit button off-screen.
 *
 * ONE FIELD, NOT TWO. The band and the panel are never mounted together: a `display:none`
 * canvas still builds its geometry and registers its observers. The breakpoint is read
 * with `matchMedia`, the same way `lib/motion` reads the pointer type.
 *
 * WHY THE PANEL IS CALM. D-038: the sign-in screen is a signed-out surface but it is one
 * a patient with vertigo uses every morning. So there is no parallax on touch, no motion
 * under reduced motion, and the palette is the product's own blue on white — no gradient,
 * no shadow, nothing that competes with the form.
 */
import { Languages, ShieldCheck, Waypoints } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { LogoMark } from "@/components/brand/Logo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useI18n } from "@/lib/i18n";
import type { FieldMode } from "@/lib/neural";
import { NeuralField } from "./NeuralField";

interface AuthShellProps {
  title: string;
  lead?: string;
  mode: FieldMode;
  settledAt?: number;
  children: ReactNode;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function AuthShell({ title, lead, mode, settledAt, children }: AuthShellProps) {
  const { t } = useI18n();
  const large = useMediaQuery("(min-width: 1024px)");
  // A phone held sideways, or a laptop with the keyboard open: no room for a picture.
  const tall = useMediaQuery("(min-height: 640px)");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        {t("skipToContent")}
      </a>

      <header className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link to="/" className="focus-ring flex items-center gap-2.5 rounded-lg" aria-label={t("backToSite")}>
          <LogoMark className="h-9 w-9 shrink-0 text-primary" />
          <span className="flex flex-col leading-none">
            <span className="text-title-3 text-primary">{t("appName")}</span>
            <span className="mt-1.5 text-label text-muted-foreground">{t("signInEyebrow")}</span>
          </span>
        </Link>
        <LanguageToggle />
      </header>

      <div className="mx-auto grid w-full max-w-[1680px] flex-1 gap-10 px-5 pb-16 pt-4 sm:px-8 sm:pt-8 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-16 lg:pt-10 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] xl:gap-24">
        <main id="main" className="w-full max-w-[30rem] xl:max-w-[32rem]">
          {!large && tall && (
            <div className="mb-6 h-32 sm:h-40">
              <NeuralField mode={mode} settledAt={settledAt} className="h-full w-full" />
            </div>
          )}
          <h1 className="text-title-1 sm:text-[2.25rem]">{title}</h1>
          {lead && <p className="mt-2 text-base leading-relaxed text-muted-foreground">{lead}</p>}
          <div className="mt-8">{children}</div>
        </main>

        {large && (
          <aside className="sticky top-8 hidden lg:block" aria-label={t("authEyebrow")}>
            <div className="flex flex-col rounded-2xl border border-border bg-secondary/60 p-8 lg:min-h-[calc(100vh-8.5rem)] xl:p-10">
              <p className="text-label text-muted-foreground">{t("authEyebrow")}</p>
              <h2 className="mt-4 max-w-[22ch] text-title-fluid">{t("authHeadline")}</h2>
              <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">{t("authLead")}</p>

              <div className="mt-6 min-h-[16rem] w-full flex-1">
                <NeuralField mode={mode} settledAt={settledAt} className="h-full w-full" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t("fieldCaption")}</p>

              <ul className="mt-8 grid gap-4 border-t border-border pt-6 text-sm leading-relaxed text-foreground">
                <li className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <span>{t("trustOnDevice")}</span>
                </li>
                <li className="flex gap-3">
                  <Waypoints className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <span>{t("trustAlert")}</span>
                </li>
                <li className="flex gap-3">
                  <Languages className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <span>{t("trustLangs")}</span>
                </li>
              </ul>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
