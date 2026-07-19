import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { api, extractError } from "@/lib/api";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 15; // ~30s, matches BillingSuccessPage's reasoning

export default function EnrollSuccessPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [status, setStatus] = useState("checking"); // checking | paid | pending | error
  const [message, setMessage] = useState("");
  const attempts = useRef(0);
  const checkoutId = params.get("checkout");

  useEffect(() => {
    if (!checkoutId) {
      setStatus("error");
      setMessage("Missing checkout reference.");
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get(`/portal/payment-checkout/${checkoutId}`);
        if (cancelled) return;
        if (data.status === "paid") {
          setStatus("paid");
          setTimeout(() => nav("/portal", { replace: true }), 1500);
          return;
        }
        if (data.status === "failed" || data.status === "expired") {
          setStatus("error");
          setMessage("This payment did not complete.");
          return;
        }
        attempts.current += 1;
        if (attempts.current >= MAX_ATTEMPTS) {
          setStatus("pending");
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setMessage(extractError(err));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutId]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        {status === "checking" && (
          <>
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-accent" />
            <p className="text-sm text-muted-foreground">Confirming your payment…</p>
          </>
        )}
        {status === "paid" && (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-success" />
            <p className="font-semibold mb-1">Payment confirmed — you're enrolled!</p>
            <p className="text-sm text-muted-foreground">Taking you to your parent portal…</p>
          </>
        )}
        {status === "pending" && (
          <>
            <Loader2 className="w-8 h-8 mx-auto mb-4 text-warning" />
            <p className="font-semibold mb-1">Still processing</p>
            <p className="text-sm text-muted-foreground mb-4">
              Your enrollment is saved either way — refresh this page in a moment to confirm payment, or check your parent portal.
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
              <Link to="/portal"><Button>Go to portal</Button></Link>
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <AlertTriangle className="w-10 h-10 mx-auto mb-4 text-destructive" />
            <p className="font-semibold mb-1">Something went wrong</p>
            <p className="text-sm text-muted-foreground mb-4">
              {message} Your enrollment itself was still saved — you can pay from your parent portal instead.
            </p>
            <Link to="/portal"><Button variant="outline">Go to portal</Button></Link>
          </>
        )}
      </div>
    </div>
  );
}
