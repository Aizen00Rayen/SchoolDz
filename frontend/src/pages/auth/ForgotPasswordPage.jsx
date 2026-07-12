import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import AuthLayout from "./AuthLayout";
import { api, extractError } from "@/lib/api";
import { AUTH } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.post("/auth/forgot-password", { email });
      setSent(data);
      toast.success("If this email exists, a reset link was generated.");
    } catch (err) {
      toast.error(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a reset link."
      footer={
        <Link to="/login" className="font-semibold text-foreground hover:text-accent" data-testid="auth-back-to-login">
          ← {t("auth.submit.login")}
        </Link>
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
            data-testid={AUTH.forgotEmail}
            className="h-11"
            placeholder="you@school.com"
          />
        </div>
        <Button
          type="submit"
          disabled={busy}
          data-testid={AUTH.forgotSubmit}
          className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
        </Button>

        {sent?.dev_token && (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-xs font-mono break-all">
            <div className="text-muted-foreground mb-1">Dev-mode reset token:</div>
            <div>{sent.dev_token}</div>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
