import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import MarketingNav from "./MarketingNav";
import { useI18n } from "@/lib/i18n";
import { MARKETING } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Users,
  CalendarCheck2,
  Wallet,
  BookOpen,
  Sparkles,
  ShieldCheck,
  Globe2,
  BarChart3,
  Palette,
  Check,
} from "lucide-react";

const FEATURES = [
  { icon: Users, key: "students",
    title: { fr: "Gestion des étudiants", en: "Student management", ar: "إدارة الطلاب" },
    desc: {
      fr: "Profils complets, QR codes, timeline, documents et cartes d'étudiants.",
      en: "Rich profiles, QR codes, timeline, documents and student ID cards.",
      ar: "ملفات كاملة، رموز QR، الجدول الزمني، الوثائق وبطاقات الطلاب.",
    },
  },
  { icon: CalendarCheck2, key: "attendance",
    title: { fr: "Présence & séances", en: "Sessions & attendance", ar: "الحضور والحصص" },
    desc: {
      fr: "Marquez la présence en un clic, détectez les conflits d'emploi du temps.",
      en: "One-click attendance, timetable conflict detection.",
      ar: "سجل الحضور بنقرة واحدة، اكتشف تعارضات الجدول.",
    },
  },
  { icon: Wallet, key: "payments",
    title: { fr: "Paiements & factures", en: "Payments & invoicing", ar: "المدفوعات والفواتير" },
    desc: {
      fr: "Frais d'inscription, mensualités, remises, échéancier, reçus imprimables.",
      en: "Registration fees, monthly plans, discounts, installments, printable receipts.",
      ar: "رسوم التسجيل، الأقساط الشهرية، الخصومات، وإصدار الفواتير.",
    },
  },
  { icon: BookOpen, key: "courses",
    title: { fr: "Cours & groupes", en: "Courses & groups", ar: "الدروس والمجموعات" },
    desc: {
      fr: "Chaque cours peut avoir plusieurs groupes, salles, enseignants et horaires.",
      en: "Every course can have multiple groups, rooms, teachers and schedules.",
      ar: "لكل دورة عدة مجموعات وقاعات ومعلمين وجداول.",
    },
  },
  { icon: BarChart3, key: "analytics",
    title: { fr: "Tableaux de bord", en: "Analytics dashboards", ar: "لوحات التحليل" },
    desc: {
      fr: "KPIs quotidiens, tendances de revenus, taux de présence et cohortes.",
      en: "Daily KPIs, revenue trends, attendance rates and cohorts.",
      ar: "مؤشرات يومية، اتجاهات الإيرادات، معدلات الحضور والمجموعات.",
    },
  },
  { icon: ShieldCheck, key: "security",
    title: { fr: "Isolation multi-tenant", en: "Multi-tenant isolation", ar: "عزل المستأجرين" },
    desc: {
      fr: "Chaque centre a son propre espace, ses utilisateurs et ses données isolées.",
      en: "Each center gets its own workspace, users and isolated data.",
      ar: "لكل مركز مساحته الخاصة وبيانات معزولة تماماً.",
    },
  },
  { icon: Palette, key: "branding",
    title: { fr: "Personnalisable", en: "Branded", ar: "قابل للتخصيص" },
    desc: {
      fr: "Logo, couleurs, monnaie, langue — adaptez SchoolDZ à votre identité.",
      en: "Logo, colors, currency, language — bend SchoolDZ to your identity.",
      ar: "الشعار، الألوان، العملة واللغة — خصص المنصة لهويتك.",
    },
  },
  { icon: Globe2, key: "multilang",
    title: { fr: "Multilingue & RTL", en: "Multilingual & RTL", ar: "متعدد اللغات و RTL" },
    desc: {
      fr: "Français, anglais, arabe — avec support RTL natif.",
      en: "French, English, Arabic — with native RTL support.",
      ar: "الفرنسية، الإنجليزية، العربية — مع دعم RTL أصلي.",
    },
  },
];

const CENTER_TYPES = [
  { fr: "Centres de soutien", en: "Tutoring centers", ar: "مراكز الدعم" },
  { fr: "Écoles de langues", en: "Language schools", ar: "مدارس اللغات" },
  { fr: "Académies de code", en: "Coding academies", ar: "أكاديميات البرمجة" },
  { fr: "Clubs de robotique", en: "Robotics clubs", ar: "نوادي الروبوتيك" },
  { fr: "Écoles de musique", en: "Music schools", ar: "مدارس الموسيقى" },
  { fr: "Colonies d'été", en: "Summer camps", ar: "المخيمات الصيفية" },
  { fr: "Écoles d'art", en: "Art schools", ar: "مدارس الفنون" },
  { fr: "Formation pro", en: "Pro training", ar: "التدريب المهني" },
];

export default function LandingPage() {
  const { t, lang } = useI18n();
  const heroFont = lang === "ar" ? "font-arabic" : "font-display";

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 grid-hero opacity-70 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6 pt-20 pb-24 md:pt-28 md:pb-32 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="lg:col-span-7"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground mb-6">
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                <span>{t("hero.badge")}</span>
              </div>

              <h1
                className={`${heroFont} text-5xl md:text-7xl font-black tracking-tighter leading-[0.95] mb-6`}
              >
                {t("hero.title.1")}
                <br />
                <span className="text-accent">{t("hero.title.2")}</span>
                <span className="text-foreground">.</span>
              </h1>

              <p className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed mb-8">
                {t("hero.subtitle")}
              </p>

              <div className="flex flex-wrap items-center gap-4 mb-10">
                <Link to="/register" data-testid={MARKETING.heroCtaPrimary}>
                  <Button
                    size="lg"
                    className="bg-accent hover:bg-accent/90 text-accent-foreground text-base font-semibold h-12 px-6 rounded-lg shadow-lg"
                  >
                    {t("hero.cta.primary")}
                    <ArrowRight className="ms-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/login" data-testid={MARKETING.heroCtaSecondary}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="text-base font-semibold h-12 px-6 rounded-lg"
                  >
                    {t("hero.cta.secondary")}
                  </Button>
                </Link>
              </div>

              <div className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-2.5 font-mono text-sm">
                <span className="text-muted-foreground">https://</span>
                <span className="font-semibold">{t("hero.subdomain")}</span>
              </div>
            </motion.div>

            {/* Hero card mock */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15 }}
              className="lg:col-span-5"
            >
              <HeroMock />
            </motion.div>
          </div>

          {/* Center types marquee */}
          <div className="mt-16 md:mt-24">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
              {lang === "fr"
                ? "Conçu pour"
                : lang === "ar"
                ? "مصمم لـ"
                : "Built for"}
            </p>
            <div className="flex flex-wrap gap-2">
              {CENTER_TYPES.map((c, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 rounded-full border border-border bg-card text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                >
                  {c[lang] || c.en}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {lang === "fr" ? "Fonctionnalités" : lang === "ar" ? "المميزات" : "Features"}
            </p>
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight leading-tight`}>
              {t("features.title")}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="surface-card p-6 group"
              >
                <div className="w-10 h-10 rounded-lg bg-accent/10 grid place-items-center mb-4 group-hover:bg-accent/20 transition-colors">
                  <f.icon className="w-5 h-5 text-accent" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2 tracking-tight">
                  {f.title[lang] || f.title.en}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {f.desc[lang] || f.desc.en}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Big CTA */}
      <section className="border-b border-border bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8">
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4`}>
              {lang === "fr"
                ? "Lancez votre espace en 90 secondes."
                : lang === "ar"
                ? "أطلق مساحتك في 90 ثانية."
                : "Launch your workspace in 90 seconds."}
            </h2>
            <p className="text-lg text-primary-foreground/70 max-w-2xl">
              {lang === "fr"
                ? "14 jours d'essai gratuits. Pas de carte bancaire. Migration guidée offerte."
                : lang === "ar"
                ? "14 يومًا تجريبيًا مجانيًا. بدون بطاقة بنكية. ترحيل مجاني."
                : "14-day free trial. No credit card. Free guided migration."}
            </p>
          </div>
          <div className="lg:col-span-4 flex lg:justify-end">
            <Link to="/register" data-testid="marketing-cta-bottom">
              <Button
                size="lg"
                className="bg-accent hover:bg-accent/90 text-accent-foreground h-12 px-6 text-base font-semibold"
              >
                {t("hero.cta.primary")}
                <ArrowRight className="ms-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Pricing preview */}
      <section id="pricing" className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {lang === "fr" ? "Tarifs" : lang === "ar" ? "الأسعار" : "Pricing"}
            </p>
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight`}>
              {t("pricing.title")}
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "Starter", price: "2 500", features: ["50 students", "3 users", "Email support"], accent: false },
              { name: "Pro", price: "6 900", features: ["500 students", "20 users", "Priority support", "Custom branding"], accent: true },
              { name: "Business", price: "14 900", features: ["Unlimited students", "Unlimited users", "24/7 support", "API access"], accent: false },
            ].map((p, i) => (
              <div
                key={p.name}
                className={`rounded-2xl p-8 border ${
                  p.accent
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border"
                }`}
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                  {p.accent && (
                    <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-full bg-accent text-accent-foreground">
                      Popular
                    </span>
                  )}
                </div>
                <div className="mb-6">
                  <span className="font-display text-5xl font-black tracking-tighter">
                    {p.price}
                  </span>
                  <span className={`ms-2 text-sm ${p.accent ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    DZD/mo
                  </span>
                </div>
                <ul className="space-y-3 mb-8">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className={p.accent ? "text-primary-foreground/90" : "text-foreground"}>
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link to="/register" data-testid={`pricing-plan-${p.name.toLowerCase()}`}>
                  <Button
                    className={`w-full h-11 font-semibold ${
                      p.accent
                        ? "bg-accent hover:bg-accent/90 text-accent-foreground"
                        : ""
                    }`}
                    variant={p.accent ? "default" : "outline"}
                  >
                    {t("hero.cta.primary")}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded grid place-items-center">
              <span className="font-display font-black text-primary-foreground text-[10px]">S</span>
            </div>
            <span className="font-display font-semibold text-foreground">schooldz</span>
            <span>© {new Date().getFullYear()} — {t("footer.rights")}</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroMock() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-accent/10 rounded-3xl blur-2xl -z-10" />
      <div className="surface-card p-5 md:p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <div className="w-2 h-2 rounded-full bg-yellow-400" />
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <div className="ms-2 text-[11px] font-mono text-muted-foreground">
            dteduc.schooldz.com
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { label: "Students", value: "324", accent: false },
            { label: "Revenue", value: "88K", accent: true },
            { label: "Attendance", value: "94%", accent: false },
          ].map((k) => (
            <div
              key={k.label}
              className={`rounded-lg p-3 border ${
                k.accent ? "bg-accent text-accent-foreground border-accent" : "bg-muted/50 border-border"
              }`}
            >
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                {k.label}
              </div>
              <div className="font-mono text-2xl font-semibold mt-1">{k.value}</div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {["Python for Beginners · Group A", "English A2 · Group B", "BAC Math · Group C"].map(
            (r, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg p-2.5 border border-border bg-card"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-8 rounded-full bg-accent" />
                  <div>
                    <div className="text-sm font-medium">{r}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      18:0{i} → 20:0{i}
                    </div>
                  </div>
                </div>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-600 font-medium">
                  Live
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
