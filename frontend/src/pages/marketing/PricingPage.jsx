import MarketingNav from "./MarketingNav";
import PlanCards from "@/components/PlanCards";
import { useI18n } from "@/lib/i18n";

export default function PricingPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <div className="max-w-7xl mx-auto px-6 py-16 md:py-20">
        <div className="max-w-2xl mb-14 text-center mx-auto">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
            {t("nav.pricing")}
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-3">
            {t("pricing.title")}
          </h1>
          <p className="text-lg text-muted-foreground">{t("pricing.subtitle")}</p>
        </div>

        <PlanCards mode="marketing" t={t} />
      </div>
    </div>
  );
}
