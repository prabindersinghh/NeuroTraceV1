import { Activity } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Role } from "@/lib/types";

export function Register() {
  const { t } = useI18n();
  const { user, register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("caregiver");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({ email, password, role, full_name: fullName || undefined });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-lg font-semibold tracking-tight text-primary">{t("appName")}</p>
        </div>
        <LanguageToggle />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t("signUp")}</CardTitle>
          <CardDescription>{t("tagline")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormError>{error}</FormError>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">{t("fullName")}</Label>
              <Input id="name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="role">{t("iAmA")}</Label>
              <Select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="caregiver">{t("roleCaregiver")}</option>
                <option value="patient">{t("rolePatient")}</option>
                <option value="clinician">{t("roleClinician")}</option>
              </Select>
            </div>

            <Button type="submit" variant="accent" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {t("signUp")}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <Link to="/login" className="font-medium text-accent hover:underline focus-ring rounded">
              {t("signIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
