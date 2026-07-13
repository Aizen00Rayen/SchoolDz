import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AuthLayout from "./AuthLayout";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AUTH } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE, extractError } from "@/lib/api";
import { useServerConfig } from "@/lib/config";
import { Loader2 } from "lucide-react";
import GoogleAuthButton from "./GoogleAuthButton";

export default function LoginPage() {
  const { login, user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const { data: serverConfig } = useServerConfig();
  const googleEnabled = !!serverConfig?.google_oauth_enabled;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav("/app", { replace: true });
  }, [user, nav]);

  if (user) {
    return null;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(email.trim(), password, tenantSlug.trim() || null);
      toast.success("Welcome back!");
      const dest = loc.state?.from || "/app";
      nav(dest, { replace: true });
    } catch (err) {
      toast.error(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t("auth.submit.login")}
      subtitle={t("auth.access_workspace")}
      footer={
        <>
          {t("auth.no_account")}{" "}
          <Link to="/register" className="font-semibold text-foreground hover:text-accent" data-testid="auth-goto-register">
            {t("nav.signup")}
          </Link>
        </>
      }
    >
      {googleEnabled && (
        <>
          <GoogleAuthButton
            href={`${API_BASE}/auth/google/start?intent=login`}
            label={t("auth.continue_with_google")}
            testId={AUTH.loginGoogle}
          />

          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("auth.or")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            data-testid={AUTH.loginEmail}
            className="h-11"
            placeholder="you@school.com"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground hover:text-accent"
              data-testid="auth-goto-forgot"
            >
              {t("auth.forgot")}
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            data-testid={AUTH.loginPassword}
            className="h-11"
            placeholder="••••••••"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">{t("auth.tenant_slug")} <span className="text-muted-foreground font-normal">({t("auth.optional")})</span></Label>
          <Input
            id="slug"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            data-testid={AUTH.loginTenantSlug}
            className="h-11 font-mono"
            placeholder="my-school"
          />
        </div>

        <Button
          type="submit"
          disabled={busy}
          data-testid={AUTH.loginSubmit}
          className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("auth.submit.login")}
        </Button>
      </form>
    </AuthLayout>
  );
}
