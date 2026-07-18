import { Link } from "react-router-dom";
import {
  GraduationCap, CalendarCheck2, Wallet, BookOpen, BarChart3, ShieldCheck,
  Palette, Globe2, UserRound, Repeat, Award, Upload, ArrowRight,
} from "lucide-react";
import MarketingNav from "./MarketingNav";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const FEATURES = [
  { key: "students", icon: GraduationCap },
  { key: "attendance", icon: CalendarCheck2 },
  { key: "payments", icon: Wallet },
  { key: "courses", icon: BookOpen },
  { key: "analytics", icon: BarChart3 },
  { key: "grades", icon: Award },
  { key: "calendar", icon: Repeat },
  { key: "parent_portal", icon: UserRound },
  { key: "import", icon: Upload },
  { key: "security", icon: ShieldCheck },
  { key: "branding", icon: Palette },
  { key: "multilang", icon: Globe2 },
];

export default function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />
      <div className="max-w-6xl mx-auto px-6 py-16 md:py-20">
        <div className="max-w-2xl mb-14 text-center mx-auto">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
            {t("nav.about")}
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
            {t("about.title")}
          </h1>
          <p className="text-lg text-muted-foreground">{t("about.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ key, icon: Icon }) => (
            <div key={key} className="surface-card p-6">
              <div className="w-10 h-10 rounded-lg bg-accent/10 grid place-items-center mb-4">
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <h3 className="font-display font-semibold text-lg mb-1.5">
                {t(`feature.${key}.title`)}
              </h3>
              <p className="text-sm text-muted-foreground">{t(`feature.${key}.desc`)}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <Button size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground h-12 px-8 text-base font-semibold rounded-lg" asChild>
            <Link to="/register">
              {t("hero.cta.primary")}
              <ArrowRight className="ms-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
