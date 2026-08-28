import { Activity, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError, Input, Label } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { api, setStoredUser, setTokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export function Login() {
  const { t } = useI18n();
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDemo() {
    setError(null);
    setDemoBusy(true);
    try {
      const seeded = await api.seedDemo();
      const res = await api.login({ email: seeded.email, password: seeded.password });
      setTokens(res.tokens);
      setStoredUser(res.user);
      navigate(`/dashboard/${seeded.patient_id}`, { replace: true });
      window.location.reload(); // pick up the new session in AuthProvider
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the demo");
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="flex w-full max-w-md items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Activity className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-primary">{t("appName")}</p>
          </div>
        </div>
        <LanguageToggle />
      </div>

      <main className="w-full max-w-md">
        <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-xl">{t("signIn")}</CardTitle>
          <CardDescription>{t("tagline")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <FormError>{error}</FormError>

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
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button type="submit" variant="accent" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {t("signIn")}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button variant="outline" className="w-full" onClick={onDemo} disabled={demoBusy}>
            {demoBusy ? <Spinner className="h-4 w-4" /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {t("tryDemo")}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">{t("demoHint")}</p>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link to="/register" className="font-medium text-accent hover:underline focus-ring rounded">
              {t("signUp")}
            </Link>
          </p>
        </CardContent>
      </Card>
      </main>
    </div>
  );
}
