import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import AuthLayout from "./AuthLayout";
import { api, extractError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      toast.success("Password set — you can now log in");
      nav("/login", { replace: true });
    } catch (err) {
      toast.error(extractError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invalid link" subtitle="This reset link is missing its token.">
        <Link to="/forgot-password" className="font-semibold text-foreground hover:text-accent">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set your password"
      subtitle="Choose a password to activate your account."
      footer={
        <Link to="/login" className="font-semibold text-foreground hover:text-accent">
          ← {t("auth.submit.login")}
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="h-11"
            placeholder="••••••••"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-11"
            placeholder="••••••••"
          />
        </div>
        <Button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
