/**
 * Form fields for the sign-in and sign-up screens.
 *
 * `Field` owns the wiring a screen reader needs and a sighted user never notices: the
 * label points at the control, the hint and the error are announced with it
 * (`aria-describedby`), and an invalid control says so (`aria-invalid`). The control
 * itself is rendered by the caller through a render prop so this works for a text input,
 * a password input and a select without three components.
 *
 * Errors appear on BLUR, not on every keystroke — a person half-way through typing their
 * email has not made a mistake yet — and clear as soon as the value becomes valid.
 */
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";

import { Input, Label } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import { STRENGTH_KEY, passwordStrength } from "@/lib/authForm";
import { cn } from "@/lib/utils";

export interface FieldA11y {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  children: (a11y: FieldA11y) => ReactNode;
  /** Something that sits under the control and above the hint, e.g. a strength meter. */
  below?: ReactNode;
}

export function Field({ label, hint, error, optional, children, below }: FieldProps) {
  const { t } = useI18n();
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-[0.95rem]">{label}</Label>
        {optional && <span className="text-xs text-muted-foreground">{t("optionalHint")}</span>}
      </div>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) })}
      {below}
      {/* Polite, not assertive: the person is still in the form and an interruption mid-word
          is worse than a sentence a moment later. */}
      <p id={errorId} aria-live="polite" className={cn("text-sm text-destructive", !error && "hidden")}>
        {error}
      </p>
      {hint && !error && (
        <p id={hintId} className="text-sm text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * The auth screens' input: taller and larger-set than the app's default, because the
 * people signing in are often the same 55-75 cohort the patient surfaces are built for,
 * and the sign-in screen is not inside `.patient-scale`.
 */
export const AUTH_INPUT = "h-12 text-base";

interface PasswordInputProps extends InputHTMLAttributes<HTMLInputElement> {
  a11y: FieldA11y;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { a11y, className, ...props }, ref,
) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...a11y}
        {...props}
        ref={ref}
        type={shown ? "text" : "password"}
        className={cn(AUTH_INPUT, "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("hidePassword") : t("showPassword")}
        aria-pressed={shown}
        // Reachable by keyboard but AFTER the field, so tabbing through the form reads
        // email → password → toggle → submit rather than stopping on the eye first.
        className="focus-ring tactile absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-lg text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
});

/** Four bars and a word. Advice, never a gate — the minimum length is the rule. */
export function StrengthMeter({ password }: { password: string }) {
  const { t } = useI18n();
  const score = passwordStrength(password);
  if (score === 0) return null;
  const word = t(STRENGTH_KEY[score]);
  return (
    <div
      role="meter"
      aria-valuemin={1}
      aria-valuemax={4}
      aria-valuenow={score}
      aria-valuetext={word}
      aria-label={t("strengthLabel")}
      className="flex items-center gap-3"
    >
      <div className="flex flex-1 gap-1" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors duration-200 ease-out",
              step > score ? "bg-border" : score === 1 ? "bg-watch" : "bg-accent",
            )}
          />
        ))}
      </div>
      <span className={cn("text-xs", score === 1 ? "text-watch" : "text-muted-foreground")}>{word}</span>
    </div>
  );
}
