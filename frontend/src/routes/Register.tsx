/**
 * Create an account.
 *
 * TWO ROLES, NOT THREE. The server refuses `clinician` from this endpoint (a self-assigned
 * clinician could read every patient's name — see routers/auth.py), and the old select
 * offered it anyway, so a doctor filled in the form and was told no. The two self-service
 * roles are a radio group with a line each on what they mean; clinicians get a sentence
 * that says who sets them up.
 *
 * The password meter is advice. The rule is the server's — eight characters, not the
 * email, not a common password — and the same rule runs here first so nobody is told
 * after a round trip what they could have been told as they typed.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { AuthShell } from "@/components/auth/AuthShell";
import { AUTH_INPUT, Field, PasswordInput, StrengthMeter } from "@/components/auth/fields";
import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { authErrorKey, emailProblem, passwordProblem } from "@/lib/authForm";
import { useAuth } from "@/lib/auth";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useCoarsePointer } from "@/lib/motion";
import type { FieldMode } from "@/lib/neural";
import { useOnline } from "@/lib/offline";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type Phase = "idle" | "submitting" | "success";
type Focus = "name" | "email" | "password" | null;
type SelfServiceRole = Extract<Role, "caregiver" | "patient">;

const SETTLE_MS = 520;

const RoleOption = forwardRef<HTMLInputElement, {
  value: SelfServiceRole;
  current: SelfServiceRole;
  label: string;
  help: string;
  disabled?: boolean;
  onChange: (role: SelfServiceRole) => void;
}>(({ value, current, label, help, disabled, onChange }, ref) => {
  const checked = current === value;
  return (
    <label
      className={cn(
        "tactile flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors",
        checked ? "border-accent bg-secondary" : "border-border bg-card hover:border-accent/45",
        disabled && "cursor-default opacity-60",
      )}
    >
      <input
        ref={ref}
        type="radio"
        name="role"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--accent))] focus-ring"
      />
      <span className="flex flex-col">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{help}</span>
      </span>
    </label>
  );
});
RoleOption.displayName = "RoleOption";

export function Register() {
  const { t } = useI18n();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const coarse = useCoarsePointer();
  const online = useOnline();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SelfServiceRole>("caregiver");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [formError, setFormError] = useState<StringKey | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [focus, setFocus] = useState<Focus>(null);
  const [settledAt, setSettledAt] = useState<number>();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const settleTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const emailErr = touched.email ? emailProblem(email) : null;
  const passwordErr = touched.password ? passwordProblem(password, { signup: true, email }) : null;
  const busy = phase === "submitting";

  const mode: FieldMode = busy ? "busy"
    : phase === "success" ? "settled"
      : formError ? "error"
        : focus === "password" ? "structured"
          : focus ? "attentive"
            : "idle";

  const settle = useCallback(() => {
    setPhase("success");
    setSettledAt(Date.now());
    settleTimer.current = window.setTimeout(() => navigate("/", { replace: true }), SETTLE_MS);
  }, [navigate]);

  if (user && phase === "idle") return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setTouched({ email: true, password: true });
    if (emailProblem(email)) { emailRef.current?.focus(); return; }
    if (passwordProblem(password, { signup: true, email })) { passwordRef.current?.focus(); return; }

    setFormError(null);
    setPhase("submitting");
    try {
      await register({ email, password, role, full_name: fullName.trim() || undefined });
      settle();
    } catch (err) {
      setFormError(authErrorKey(err, "register"));
      setPhase("idle");
    }
  }

  const statusLine = phase === "submitting" ? t("creatingAccount") : phase === "success" ? t("signedIn") : "";

  return (
    <AuthShell title={t("registerTitle")} lead={t("registerLead")} mode={mode} settledAt={settledAt}>
      {!online && (
        <p role="status" className="mb-6 rounded-xl border border-border bg-secondary px-4 py-3 text-sm text-foreground">
          {t("offlineNotice")}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-busy={busy}>
        <FormError>{formError ? t(formError) : null}</FormError>

        <Field label={t("fullName")} optional>
          {(a11y) => (
            <Input
              {...a11y}
              autoComplete="name"
              autoFocus={!coarse}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              onFocus={() => setFocus("name")}
              onBlur={() => setFocus(null)}
              className={AUTH_INPUT}
              disabled={busy}
            />
          )}
        </Field>

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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocus("email")}
              onBlur={() => { setFocus(null); if (email) setTouched((s) => ({ ...s, email: true })); }}
              className={AUTH_INPUT}
              disabled={busy}
            />
          )}
        </Field>

        <Field
          label={t("password")}
          hint={t("passwordHint")}
          error={passwordErr ? t(passwordErr) : null}
          below={<StrengthMeter password={password} />}
        >
          {(a11y) => (
            <PasswordInput
              a11y={a11y}
              ref={passwordRef}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocus("password")}
              onBlur={() => { setFocus(null); if (password) setTouched((s) => ({ ...s, password: true })); }}
              disabled={busy}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2.5" disabled={busy}>
          <legend className="mb-1.5 text-[0.95rem] font-medium">{t("iAmA")}</legend>
          <RoleOption value="caregiver" current={role} onChange={setRole}
            label={t("roleCaregiver")} help={t("roleHelpCaregiver")} disabled={busy} />
          <RoleOption value="patient" current={role} onChange={setRole}
            label={t("rolePatient")} help={t("roleHelpPatient")} disabled={busy} />
          <p className="mt-1 text-sm text-muted-foreground">{t("roleClinicianNote")}</p>
        </fieldset>

        <Button type="submit" variant="accent" size="lg" className="mt-1 w-full text-base" disabled={busy || phase === "success"}>
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? t("creatingAccount") : phase === "success" ? t("signedIn") : t("signUp")}
        </Button>
        <p role="status" aria-live="polite" className="sr-only">{statusLine}</p>
      </form>

      <p className="mt-8 text-center text-[15px] text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link to="/login" className="focus-ring inline-flex items-center rounded px-1 font-medium text-accent hover:underline [@media(pointer:coarse)]:min-h-11">
          {t("signIn")}
        </Link>
      </p>
    </AuthShell>
  );
}
