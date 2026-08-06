import { useState } from "react";
import { toast } from "sonner";
import { LogOut, Tag } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { api, extractError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PlanCards from "@/components/PlanCards";

/**
 * Shown right after registration instead of the dashboard — there is no free
 * trial, so a tenant must complete a Chargily checkout before AppShell (see
 * RequireActiveTenant in App.js) will let them through.
 */
export default function BillingGatePage() {
  const { tenant, user, logout } = useAuth();
  const { t } = useI18n();
  const [busyPlan, setBusyPlan] = useState(null);
  const [couponCode, setCouponCode] = useState("");

  const onSelectPlan = async (plan, billingCycle) => {
    setBusyPlan(plan);
    try {
      const { data } = await api.post("/billing/checkout", {
        plan,
        billing_cycle: billingCycle,
        ...(couponCode.trim() ? { coupon_code: couponCode.trim() } : {}),
      });
      window.location.href = data.checkout_url;
    } catch (err) {
      toast.error(extractError(err));
      setBusyPlan(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-nav sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-14">
          <div>
            <div className="font-display font-bold text-sm leading-tight">
              scolaris <span className="text-accent">/ billing</span>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground leading-tight">
              {tenant?.name}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await logout();
            }}
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            data-testid="billing-gate-logout"
          >
            <LogOut className="w-3.5 h-3.5 me-2" />
            {t("common.logout")}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="max-w-2xl mb-12 text-center mx-auto">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
            {t("nav.pricing")}
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Choose a plan to activate {tenant?.name}
          </h1>
          <p className="text-muted-foreground">
            Signed in as {user?.email}. Pick a plan below to complete setup — payment is required before you can access your workspace.
          </p>
        </div>

        <div className="max-w-xs mx-auto mb-8">
          <div className="relative">
            <Tag className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              placeholder={t("billing.coupon_placeholder")}
              className="ps-9 text-center font-mono uppercase"
              data-testid="billing-coupon-input"
            />
          </div>
        </div>

        <PlanCards mode="checkout" onSelectPlan={onSelectPlan} busyPlan={busyPlan} t={t} />
      </main>
    </div>
  );
}
