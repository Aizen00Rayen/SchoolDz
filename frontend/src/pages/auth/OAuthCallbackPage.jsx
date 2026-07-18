import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { extractError, setAccessToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const ERROR_MESSAGES = {
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "This sign-in link expired. Please try again.",
  google_token_exchange_failed: "Could not verify your Google account. Please try again.",
  no_id_token: "Google did not return account details. Please try again.",
  invalid_token: "Could not verify your Google account. Please try again.",
  google_unreachable: "Could not reach Google. Please try again.",
  email_not_verified: "Your Google email is not verified.",
  account_disabled: "This account has been disabled. Contact your workspace admin.",
  slug_taken: "That workspace URL was taken while you were signing in. Please try again.",
};

export default function OAuthCallbackPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { t } = useI18n();
  const { loginWithGoogleCode, user } = useAuth();
  const [status, setStatus] = useState("working");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const error = params.get("error");
    const code = params.get("code");

    if (error === "no_account") {
      const email = params.get("email") || "";
      nav(`/register?email=${encodeURIComponent(email)}`, { replace: true });
      return;
    }
    if (error) {
      setStatus("error");
      setMessage(ERROR_MESSAGES[error] || "Sign-in failed. Please try again.");
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Missing sign-in code.");
      return;
    }

    // Clear any stale token before the exchange — prevents old/wiped tokens
    // from interfering with the fresh one we're about to receive
    setAccessToken(null);

    loginWithGoogleCode(code)
      .then(() => nav("/app", { replace: true }))
      .catch((e) => {
        setStatus("error");
        setMessage(extractError(e));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user) return null;

  if (status === "working") {
    return (
      <AuthLayout title={t("auth.submit.login")}>
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Signing you in…
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.submit.login")}>
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-sm text-destructive" data-testid="oauth-callback-error">{message}</p>
        <Link to="/login">
          <Button variant="outline">{t("auth.submit.login")}</Button>
        </Link>
      </div>
    </AuthLayout>
  );
}
