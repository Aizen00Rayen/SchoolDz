import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import AuthLayout from "./AuthLayout";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { AUTH } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractError } from "@/lib/api";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login, user } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("owner@dteduc.schooldz.com");
  const [password, setPassword] = useState("owner123");
  const [tenantSlug, setTenantSlug] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) {
    nav("/app", { replace: true });
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
      subtitle="Access your workspace"
      footer={
        <>
          {t("auth.no_account")}{" "}
          <Link to="/register" className="font-semibold text-foreground hover:text-accent" data-testid="auth-goto-register">
            {t("nav.signup")}
          </Link>
        </>
      }
    >
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
          <Label htmlFor="slug">{t("auth.tenant_slug")} <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            id="slug"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            data-testid={AUTH.loginTenantSlug}
            className="h-11 font-mono"
            placeholder="dteduc"
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

        <div className="text-xs text-center text-muted-foreground font-mono pt-2">
          Demo: owner@dteduc.schooldz.com / owner123
        </div>
      </form>
    </AuthLayout>
  );
}
