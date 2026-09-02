/**
 * Sign in.
 *
 * THE FORM IS THE PRODUCT; the field beside it is a response to the form. Focus, a
 * request in flight, a failure and a success each set one `mode` on the shell, and the
 * neural field ramps toward it. Nothing here waits on the picture.
 *
 * VALIDATION shows on blur, clears on fix, and on submit focuses the first problem.
 * ERRORS from the server are mapped to a string key by status (`authErrorKey`), never
 * displayed as the server's text — see lib/authForm.ts for why.
 *
 * AFTER SUCCESS the provider already holds the user, so `<Navigate>` would fire on the
 * next render; the screen holds the "Signed in" state for one short beat (the field's
 * convergence pulse) and then navigates itself. That is a transition, not a delay — the
 * request is finished and the token is stored before the beat starts.
 */
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/auth/AuthShell";
import { AUTH_INPUT, Field, PasswordInput } from "@/components/auth/fields";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { authErrorKey, emailProblem, passwordProblem, safeReturnPath } from "@/lib/authForm";
import { useAuth } from "@/lib/auth";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useCoarsePointer } from "@/lib/motion";
import type { FieldMode } from "@/lib/neural";
import { useOnline } from "@/lib/offline";

type Phase = "idle" | "submitting" | "demo" | "success";
type Focus = "email" | "password" | null;

/** How long the "Signed in" beat lasts before the route changes. */
const SETTLE_MS = 520;

export function Login() {
  const { t } = useI18n();
  const { user, expired, clearExpired, login, loginDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const coarse = useCoarsePointer();
  const online = useOnline();

  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [formError, setFormError] = useState<StringKey | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [focus, setFocus] = useState<Focus>(null);
  const [settledAt, setSettledAt] = useState<number>();
  const [destination, setDestination] = useState(from);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const settleTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const emailErr = touched.email ? emailProblem(email) : null;
  const passwordErr = touched.password ? passwordProblem(password) : null;
  const busy = phase === "submitting" || phase === "demo";

  const mode: FieldMode = busy ? "busy"
    : phase === "success" ? "settled"
      : formError ? "error"
        : focus === "password" ? "structured"
          : focus === "email" ? "attentive"
            : "idle";

  const settle = useCallback((to: string) => {
    setPhase("success");
    setSettledAt(Date.now());
    setDestination(to);
    settleTimer.current = window.setTimeout(() => navigate(to, { replace: true }), SETTLE_MS);
  }, [navigate]);

  // Already signed in and not mid-transition: nothing to do here.
  if (user && phase === "idle") return <Navigate to={destination} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTouched({ email: true, password: true });
    const problems = { email: emailProblem(email), password: passwordProblem(password) };
    if (problems.email) { emailRef.current?.focus(); return; }
    if (problems.password) { passwordRef.current?.focus(); return; }

    setFormError(null);
    setPhase("submitting");
    try {
      await login(email, password);
      clearExpired();
      settle(from);
    } catch (err) {
      setFormError(authErrorKey(err, "login"));
      setPhase("idle");
      // The password is the likeliest thing wrong, and it has been cleared by nothing —
      // leave it so a typo can be seen with the eye toggle rather than retyped blind.
      // Deferred a tick: the input is still `disabled` until React commits the phase
      // change, and a disabled input refuses focus.
      window.setTimeout(() => passwordRef.current?.focus(), 0);
    }
  }

  async function onDemo() {
    if (busy) return;
    setFormError(null);
    setPhase("demo");
    try {
      const patientId = await loginDemo();
      clearExpired();
      settle(`/dashboard/${patientId}`);
    } catch (err) {
      setFormError(authErrorKey(err, "demo"));
      setPhase("idle");
    }
  }

  const statusLine = phase === "submitting" ? t("signingIn")
    : phase === "demo" ? t("loadingDemo")
      : phase === "success" ? t("signedIn")
        : "";

  return (
    <AuthShell title={t("signInTitle")} lead={t("tagline")} mode={mode} settledAt={settledAt}>
      {expired && (
        <div role="status" className="mb-6 rounded-xl border border-watch/40 bg-watch-soft px-4 py-3">
          <p className="font-medium text-foreground">{t("sessionExpiredTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("sessionExpiredBody")}</p>
        </div>
      )}
      {!online && (
        <p role="status" className="mb-6 rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground">
          {t("offlineNotice")}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-busy={busy}>
        <FormError>{formError ? t(formError) : null}</FormError>

        <Field label={t("email")} error={emailErr ? t(emailErr) : null}>
          {(a11y) => (
            <Input
              {...a11y}
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              // A phone raises its keyboard on autofocus and covers the form; a desktop
              // wants the cursor already in the field.
              autoFocus={!coarse}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocus("email")}
              onBlur={() => { setFocus(null); if (email) setTouched((s) => ({ ...s, email: true })); }}
              className={AUTH_INPUT}
              disabled={busy}
            />
          )}
        </Field>

        <Field label={t("password")} error={passwordErr ? t(passwordErr) : null}>
          {(a11y) => (
            <PasswordInput
              a11y={a11y}
              ref={passwordRef}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocus("password")}
              onBlur={() => { setFocus(null); if (password) setTouched((s) => ({ ...s, password: true })); }}
              disabled={busy}
            />
          )}
        </Field>

        <Button type="submit" variant="accent" size="lg" className="mt-1 w-full text-base" disabled={busy || phase === "success"}>
          {phase === "submitting" && <Spinner className="h-4 w-4" />}
          {phase === "submitting" ? t("signingIn") : phase === "success" ? t("signedIn") : t("signIn")}
        </Button>

        {/* One live region for every state change, so a screen reader hears "Signing in…"
            and then "Signed in" without the button having to be re-read. */}
        <p role="status" aria-live="polite" className="sr-only">{statusLine}</p>
      </form>

      <div className="my-7 flex items-center gap-3 text-label text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("orDivider")}
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button variant="outline" size="lg" className="w-full text-base" onClick={onDemo} disabled={busy || phase === "success"}>
        {phase === "demo" ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" aria-hidden />}
        {phase === "demo" ? t("loadingDemo") : t("tryDemo")}
      </Button>
      <p className="mt-2 text-center text-sm text-muted-foreground">{t("demoHint")}</p>

      <p className="mt-8 text-center text-[15px] text-muted-foreground">
        {t("noAccount")}{" "}
        <Link to="/register" className="focus-ring inline-flex items-center rounded px-1 font-medium text-accent hover:underline [@media(pointer:coarse)]:min-h-11">
          {t("signUp")}
        </Link>
      </p>
    </AuthShell>
  );
}
