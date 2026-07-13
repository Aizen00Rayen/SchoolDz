import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ArrowLeft } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { extractError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const ADMIN_TESTIDS = {
  email: "admin-login-email-input",
  password: "admin-login-password-input",
  submit: "admin-login-submit-button",
};

export default function AdminLoginPage() {
  const { login, user, logout } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role === "super_admin") nav("/admin", { replace: true });
  }, [user, nav]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email.trim(), password, null);
      if (u.role !== "super_admin") {
        await logout();
        toast.error("This login is reserved for platform administrators.");
        return;
      }
      toast.success("Welcome, admin.", { position: "bottom-right" });
      nav("/admin", { replace: true });
    } catch (err) {
      toast.error(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-primary text-primary-foreground relative overflow-hidden">
      {/* animated background */}
      <div className="absolute inset-0 grid-hero opacity-20" />
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full blur-3xl opacity-30"
           style={{ background: "radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)" }} />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full blur-3xl opacity-20"
           style={{ background: "radial-gradient(circle, #3B82F6 0%, transparent 70%)" }} />

      <div className="relative min-h-screen flex flex-col">
        <div className="p-6">
          <Link to="/" className="inline-flex items-center gap-2 text-xs text-primary-foreground/70 hover:text-primary-foreground transition-colors" data-testid="admin-back-home">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to schooldz.com
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 pb-16">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest mb-6">
                <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                Platform admin
              </div>
              <h1 className="font-display text-4xl md:text-5xl font-black tracking-tighter mb-3">
                {t("admin.login.title")}
              </h1>
              <p className="text-primary-foreground/70 text-sm">
                {t("admin.login.subtitle")}
              </p>
            </div>

            <div className="rounded-2xl border border-primary-foreground/10 bg-primary-foreground/5 backdrop-blur p-6">
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-primary-foreground/80">{t("auth.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    data-testid={ADMIN_TESTIDS.email}
                    className="h-11 bg-primary-foreground/5 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40"
                    placeholder="admin@schooldz.com"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-primary-foreground/80">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    data-testid={ADMIN_TESTIDS.password}
                    className="h-11 bg-primary-foreground/5 border-primary-foreground/20 text-primary-foreground placeholder:text-primary-foreground/40"
                    placeholder="••••••••"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={busy}
                  data-testid={ADMIN_TESTIDS.submit}
                  className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Access admin console"}
                </Button>
              </form>
            </div>

            <div className="text-center mt-6 text-xs text-primary-foreground/40 font-mono">
              This is a restricted area. Access is monitored.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
