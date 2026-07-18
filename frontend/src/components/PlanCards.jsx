import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Rocket, Loader2 } from "lucide-react";
import { api, extractError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const FEATURES = {
  basic: ["50 students", "3 users", "Email support", "Core modules"],
  standard: ["500 students", "20 users", "Priority support", "Custom branding", "API access", "Parent portal"],
  premium: ["Unlimited students", "Unlimited users", "24/7 support", "White-label", "SLA + SSO", "Parent portal", "Calendar & planner"],
};
const POPULAR_KEY = "standard";

/**
 * Shared pricing grid with a monthly/annual toggle, used by both the public
 * marketing pricing section (mode="marketing", CTA links to /register) and
 * the post-signup billing gate (mode="checkout", CTA starts a real Chargily
 * payment). Prices always come from GET /api/v1/plans — never hardcoded here
 * — so the two can never drift out of sync with what the backend will charge.
 */
export default function PlanCards({ mode = "marketing", onSelectPlan, busyPlan, t }) {
  const [plans, setPlans] = useState(null);
  const [cycle, setCycle] = useState("monthly");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/plans")
      .then(({ data }) => setPlans(data.plans))
      .catch((e) => setError(extractError(e)));
  }, []);

  if (error) {
    return <p className="text-center text-sm text-destructive">{error}</p>;
  }
  if (!plans) {
    return <p className="text-center text-sm text-muted-foreground">Loading plans…</p>;
  }

  const label = (key, fallback) => (t ? t(key) : fallback);

  return (
    <div>
      <div className="flex items-center justify-center gap-3 mb-10">
        <span className={`text-sm font-medium ${cycle === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>
          {label("pricing.monthly", "Monthly")}
        </span>
        <Switch
          checked={cycle === "annual"}
          onCheckedChange={(checked) => setCycle(checked ? "annual" : "monthly")}
          data-testid="pricing-cycle-toggle"
        />
        <span className={`text-sm font-medium ${cycle === "annual" ? "text-foreground" : "text-muted-foreground"}`}>
          {label("pricing.annual", "Annual")}
        </span>
        <span className="text-xs font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-accent/10 text-accent">
          {label("pricing.saveUpTo", "Save up to 25%")}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p, i) => {
          const popular = p.key === POPULAR_KEY;
          const price = cycle === "annual" ? p.annual : p.monthly;
          const isBusy = busyPlan === p.key;

          return (
            <motion.div
              key={p.key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              whileHover={{ y: -6 }}
              className={`rounded-2xl p-8 border transition-shadow duration-300 hover:shadow-xl ${
                popular ? "bg-primary text-primary-foreground border-primary relative" : "bg-card border-border"
              }`}
            >
              {popular && (
                <div className="absolute -top-3 start-6 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                  {label("pricing.popular", "Popular")}
                </div>
              )}
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                {popular && <Rocket className="w-5 h-5 text-accent" />}
              </div>
              <div className="mb-6">
                <span className="font-display text-5xl font-black tracking-tighter">
                  {price.toLocaleString()}
                </span>
                <span className={`ms-2 text-sm font-semibold ${popular ? "text-primary-foreground/80" : "text-foreground/80"}`}>
                  DZD
                </span>
                <span className={`ms-1 text-sm ${popular ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                  {cycle === "annual" ? label("pricing.perYear", "/ year") : label("pricing.perMonth", "/ month")}
                </span>
                {cycle === "annual" && (
                  <div className={`text-xs mt-1 ${popular ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {label("pricing.annualDiscount", "{pct}% off the monthly price").replace("{pct}", p.annual_discount_pct)}
                  </div>
                )}
              </div>
              <ul className="space-y-3 mb-8">
                {(FEATURES[p.key] || []).map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Check className="w-4 h-4 text-accent flex-shrink-0" />
                    <span className={popular ? "text-primary-foreground/90" : "text-foreground"}>{f}</span>
                  </li>
                ))}
              </ul>

              {mode === "checkout" ? (
                <Button
                  className={`w-full h-11 font-semibold ${popular ? "bg-accent hover:bg-accent/90 text-accent-foreground" : ""}`}
                  variant={popular ? "default" : "outline"}
                  disabled={!!busyPlan}
                  onClick={() => onSelectPlan?.(p.key, cycle)}
                  data-testid={`billing-plan-${p.key}`}
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : label("pricing.cta", "Get started")}
                </Button>
              ) : (
                <Link to="/register" data-testid={`pricing-plan-${p.key}`}>
                  <Button
                    className={`w-full h-11 font-semibold ${popular ? "bg-accent hover:bg-accent/90 text-accent-foreground" : ""}`}
                    variant={popular ? "default" : "outline"}
                  >
                    {label("pricing.cta", "Get started")}
                  </Button>
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
