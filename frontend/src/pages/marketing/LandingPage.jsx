import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  motion, useMotionValue, useSpring, useTransform, useScroll, animate,
  useMotionValueEvent, useInView,
} from "framer-motion";
import {
  ArrowRight, Users, CalendarCheck2, Wallet, BookOpen, Sparkles,
  ShieldCheck, Globe2, BarChart3, Palette, Check, Star, Cpu, Rocket,
  Zap, Layers, GraduationCap, ArrowUpRight,
} from "lucide-react";

import MarketingNav from "./MarketingNav";
import { useI18n } from "@/lib/i18n";
import { MARKETING } from "@/constants/testIds";
import { Button } from "@/components/ui/button";

/* -----------------------------------------------------------
 * Interactive mouse-follow spotlight background
 * ----------------------------------------------------------- */
function SpotlightBackground() {
  const ref = useRef(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 60, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 60, damping: 20 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      mouseX.set(e.clientX - r.left);
      mouseY.set(e.clientY - r.top);
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [mouseX, mouseY]);

  const background = useTransform(
    [springX, springY],
    ([x, y]) => `radial-gradient(600px circle at ${x}px ${y}px, hsl(var(--accent) / 0.18), transparent 60%)`,
  );

  return (
    <div ref={ref} className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 grid-hero opacity-70" />
      <motion.div className="absolute inset-0" style={{ background }} />
      {/* Aurora orbs */}
      <motion.div
        className="absolute top-1/4 -left-24 w-[420px] h-[420px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)" }}
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-0 right-0 w-[520px] h-[520px] rounded-full blur-3xl opacity-25"
        style={{ background: "radial-gradient(circle, #3B82F6 0%, transparent 70%)" }}
        animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }}
      />
    </div>
  );
}

/* -----------------------------------------------------------
 * 3D tilt wrapper for hero dashboard
 * ----------------------------------------------------------- */
function TiltCard({ children }) {
  const ref = useRef(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 200, damping: 20 });
  const sry = useSpring(ry, { stiffness: 200, damping: 20 });

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    ry.set(x * 12);
    rx.set(-y * 12);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        rotateX: srx,
        rotateY: sry,
        transformStyle: "preserve-3d",
        perspective: 1000,
      }}
      className="will-change-transform"
    >
      {children}
    </motion.div>
  );
}

/* -----------------------------------------------------------
 * Animated count-up
 * ----------------------------------------------------------- */
function CountUp({ to, suffix = "", duration = 1.6 }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  const inView = useInView(ref, { once: true, margin: "-50px" });

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, to, duration]);

  const display = to >= 1000 ? Math.round(value).toLocaleString() : value.toFixed(to % 1 === 0 ? 0 : 1);
  return (
    <span ref={ref} className="tabular-nums">
      {display}
      {suffix}
    </span>
  );
}

/* -----------------------------------------------------------
 * Live-feeling dashboard preview card (used in hero)
 * ----------------------------------------------------------- */
function DashboardPreview({ lang }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const sessions = [
    { k: "en", name: "Python for Beginners · Group A", time: "18:00 → 20:00", tag: "Live", color: "bg-emerald-500" },
    { k: "fr", name: "Anglais A2 · Groupe B", time: "17:00 → 19:00", tag: "Next", color: "bg-blue-500" },
    { k: "ar", name: "Advanced Math · Group C", time: "19:00 → 21:00", tag: "Soon", color: "bg-amber-500" },
  ];
  useEffect(() => {
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % sessions.length), 2200);
    return () => clearInterval(t);
  }, [sessions.length]);

  return (
    <TiltCard>
      <div className="relative">
        {/* Reflection glow */}
        <div className="absolute -inset-6 bg-gradient-to-tr from-accent/20 via-blue-500/10 to-purple-500/10 rounded-[2rem] blur-2xl -z-10" />

        <div
          className="relative rounded-2xl border border-border bg-card shadow-[0_30px_60px_-20px_rgba(0,0,0,0.3)] overflow-hidden"
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Window chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <div className="ms-3 text-[11px] font-mono text-muted-foreground truncate">
              https://myschool.schooldz.com
            </div>
            <div className="ms-auto flex items-center gap-1">
              <span className="kbd">⌘</span>
              <span className="kbd">K</span>
            </div>
          </div>

          <div className="p-5">
            {/* Sidebar mini + content */}
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3 space-y-1.5">
                {[
                  { l: "Dashboard", a: true, i: BarChart3 },
                  { l: "Students", i: GraduationCap },
                  { l: "Courses", i: BookOpen },
                  { l: "Payments", i: Wallet },
                  { l: "Reports", i: Layers },
                ].map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] ${
                      r.a
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground"
                    }`}
                  >
                    <r.i className="w-3 h-3" /> {r.l}
                  </div>
                ))}
              </div>

              <div className="col-span-9 space-y-3">
                {/* KPI row */}
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { label: "Students", value: 324, sub: "+12" },
                    { label: "Revenue", value: "$88K", sub: "+18%", accent: true },
                    { label: "Attendance", value: "94%", sub: "▲" },
                  ].map((k, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 + i * 0.1, duration: 0.4 }}
                      className={`rounded-lg p-3 border ${
                        k.accent ? "bg-accent text-accent-foreground border-accent" : "bg-muted/40 border-border"
                      }`}
                    >
                      <div className={`text-[9px] font-bold uppercase tracking-widest ${
                        k.accent ? "text-accent-foreground/70" : "text-muted-foreground"
                      }`}>
                        {k.label}
                      </div>
                      <div className="font-mono text-lg font-bold mt-0.5">{k.value}</div>
                      <div className={`text-[9px] mt-0.5 ${k.accent ? "text-accent-foreground/70" : "text-muted-foreground"}`}>
                        {k.sub}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Mini chart */}
                <div className="rounded-lg p-3 border border-border bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      Revenue trend
                    </div>
                    <div className="text-[10px] font-mono text-emerald-600 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                      +12.4%
                    </div>
                  </div>
                  <svg viewBox="0 0 200 50" className="w-full h-10">
                    <defs>
                      <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.5" />
                        <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <motion.path
                      d="M 0 40 L 25 35 L 50 38 L 75 30 L 100 25 L 125 20 L 150 15 L 175 10 L 200 5 L 200 50 L 0 50 Z"
                      fill="url(#chart-grad)"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 1.8, delay: 0.8 }}
                    />
                    <motion.path
                      d="M 0 40 L 25 35 L 50 38 L 75 30 L 100 25 L 125 20 L 150 15 L 175 10 L 200 5"
                      fill="none"
                      stroke="hsl(var(--accent))"
                      strokeWidth="1.5"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.8, delay: 0.8 }}
                    />
                  </svg>
                </div>

                {/* Sessions list — with rotating highlight */}
                <div className="space-y-1.5">
                  {sessions.map((s, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        scale: activeIdx === i ? 1.02 : 1,
                        borderColor: activeIdx === i ? "hsl(var(--accent))" : "hsl(var(--border))",
                      }}
                      transition={{ duration: 0.4 }}
                      className="flex items-center gap-2.5 p-2 rounded-md border border-border bg-card"
                    >
                      <div className={`w-1 h-6 rounded-full ${s.color}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-medium truncate">{s.name}</div>
                        <div className="text-[9px] font-mono text-muted-foreground">{s.time}</div>
                      </div>
                      <motion.span
                        animate={{ opacity: activeIdx === i ? 1 : 0.5 }}
                        className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${
                          s.tag === "Live"
                            ? "bg-emerald-500/10 text-emerald-600"
                            : s.tag === "Next"
                            ? "bg-blue-500/10 text-blue-600"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {s.tag}
                      </motion.span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating micro-cards */}
        <motion.div
          className="absolute -bottom-6 -left-6 rounded-xl border border-border bg-card p-3 shadow-xl w-44"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
          style={{ transform: "translateZ(50px)" }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-7 h-7 rounded-full bg-emerald-500/20 grid place-items-center">
              <Wallet className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Paid
            </div>
          </div>
          <div className="font-mono text-lg font-bold">$1,240</div>
          <div className="text-[9px] text-muted-foreground">INV-000042 · just now</div>
        </motion.div>

        <motion.div
          className="absolute -top-4 -right-4 rounded-xl border border-border bg-card p-2.5 shadow-xl"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3 }}
          style={{ transform: "translateZ(50px)" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <div className="text-[10px] font-mono">3 sessions live</div>
          </div>
        </motion.div>
      </div>
    </TiltCard>
  );
}

/* -----------------------------------------------------------
 * Marquee row
 * ----------------------------------------------------------- */
function CenterTypesMarquee({ types }) {
  return (
    <div className="relative overflow-hidden border-y border-border py-6 bg-card/40">
      <div className="flex gap-6 animate-marquee whitespace-nowrap">
        {[...types, ...types].map((c, i) => (
          <div key={i} className="flex items-center gap-3 text-lg font-display font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-accent" />
            {c}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
 * Bento feature grid
 * ----------------------------------------------------------- */
function BentoGrid({ t, lang }) {
  const items = [
    {
      key: "students", icon: GraduationCap, span: "md:col-span-4 md:row-span-2",
      title: t("feature.students.title"), desc: t("feature.students.desc"),
      accent: true,
    },
    {
      key: "attendance", icon: CalendarCheck2, span: "md:col-span-4",
      title: t("feature.attendance.title"), desc: t("feature.attendance.desc"),
    },
    {
      key: "payments", icon: Wallet, span: "md:col-span-4",
      title: t("feature.payments.title"), desc: t("feature.payments.desc"),
    },
    {
      key: "courses", icon: BookOpen, span: "md:col-span-4",
      title: t("feature.courses.title"), desc: t("feature.courses.desc"),
    },
    {
      key: "analytics", icon: BarChart3, span: "md:col-span-4",
      title: t("feature.analytics.title"), desc: t("feature.analytics.desc"),
    },
    {
      key: "security", icon: ShieldCheck, span: "md:col-span-4",
      title: t("feature.security.title"), desc: t("feature.security.desc"),
    },
    {
      key: "branding", icon: Palette, span: "md:col-span-6",
      title: t("feature.branding.title"), desc: t("feature.branding.desc"),
    },
    {
      key: "multilang", icon: Globe2, span: "md:col-span-6",
      title: t("feature.multilang.title"), desc: t("feature.multilang.desc"),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 auto-rows-[minmax(180px,auto)]">
      {items.map((it, i) => (
        <motion.div
          key={it.key}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5, delay: i * 0.05 }}
          whileHover={{ y: -4 }}
          className={`${it.span} group relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${
            it.accent
              ? "bg-primary text-primary-foreground border-primary shadow-xl"
              : "bg-card border-border hover:border-foreground/30 hover:shadow-lg"
          }`}
        >
          {/* Ambient hover ring */}
          <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none ${
            it.accent ? "" : "bg-gradient-to-br from-accent/5 to-transparent"
          }`} />

          <div className={`w-11 h-11 rounded-xl grid place-items-center mb-4 ${
            it.accent ? "bg-accent text-accent-foreground" : "bg-accent/10 text-accent"
          }`}>
            <it.icon className="w-5 h-5" />
          </div>

          <h3 className="font-display text-xl font-semibold mb-2 tracking-tight">
            {it.title}
          </h3>
          <p className={`text-sm leading-relaxed ${
            it.accent ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}>
            {it.desc}
          </p>

          {it.accent && (
            <div className="absolute bottom-6 end-6 opacity-40">
              <Sparkles className="w-16 h-16" />
            </div>
          )}
          <ArrowUpRight className={`absolute top-6 end-6 w-4 h-4 opacity-30 group-hover:opacity-70 transition-opacity ${
            it.accent ? "text-primary-foreground" : "text-foreground"
          }`} />
        </motion.div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------
 * Landing page
 * ----------------------------------------------------------- */
export default function LandingPage() {
  const { t, lang } = useI18n();
  const heroFont = lang === "ar" ? "font-arabic" : "font-display";
  const centerTypes = [
    t("type.tutoring"), t("type.language"), t("type.coding"), t("type.robotics"),
    t("type.music"), t("type.art"), t("type.camp"), t("type.pro"),
  ];

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <MarketingNav />

      {/* ============================ HERO ============================ */}
      <section className="relative border-b border-border">
        <SpotlightBackground />

        <div className="max-w-7xl mx-auto px-6 pt-16 pb-24 md:pt-24 md:pb-32 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left */}
            <div className="lg:col-span-6">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground mb-6"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent" />
                </span>
                {t("hero.badge")}
              </motion.div>

              {/* Word-by-word reveal */}
              <h1 className={`${heroFont} text-5xl md:text-7xl lg:text-[5.5rem] font-black tracking-tighter leading-[0.95] mb-6`}>
                <WordReveal text={t("hero.title.1")} />
                <br />
                <WordReveal text={t("hero.title.2")} className="text-accent" delay={0.15} />
                <br />
                <WordReveal text={t("hero.title.3")} delay={0.3} />
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-accent"
                >
                  .
                </motion.span>
              </h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed mb-8"
              >
                {t("hero.subtitle")}
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.4 }}
                className="flex flex-wrap items-center gap-3 mb-8"
              >
                <Link to="/register" data-testid={MARKETING.heroCtaPrimary}>
                  <Button
                    size="lg"
                    className="bg-accent hover:bg-accent/90 text-accent-foreground text-base font-semibold h-12 px-6 rounded-lg shadow-[0_10px_30px_-10px_hsl(var(--accent))] group"
                  >
                    {t("hero.cta.primary")}
                    <ArrowRight className="ms-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
                <Link to="/login" data-testid={MARKETING.heroCtaSecondary}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="text-base font-semibold h-12 px-6 rounded-lg backdrop-blur bg-background/60"
                  >
                    {t("hero.cta.secondary")}
                  </Button>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9 }}
                className="text-xs font-mono text-muted-foreground flex items-center gap-2"
              >
                <Zap className="w-3.5 h-3.5 text-accent" />
                {t("hero.trust")}
              </motion.div>
            </div>

            {/* Right — 3D dashboard preview */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
              className="lg:col-span-6 relative"
            >
              <DashboardPreview lang={lang} />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ============================ Marquee ============================ */}
      <CenterTypesMarquee types={centerTypes} />

      {/* ============================ STATS ============================ */}
      <section className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {t("stats.title")}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: 1200, suffix: "+", label: t("stats.centers") },
              { value: 45, suffix: "K", label: t("stats.students") },
              { value: 99.9, suffix: "%", label: t("stats.uptime") },
              { value: 3, suffix: "", label: t("stats.langs") },
            ].map((s, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="text-center"
              >
                <div className="font-display font-black text-5xl md:text-6xl tracking-tighter">
                  <CountUp to={s.value} suffix={s.suffix} />
                </div>
                <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground mt-2">
                  {s.label}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FEATURES / BENTO ============================ */}
      <section id="features" className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {t("nav.features")}
            </p>
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-3`}>
              {t("features.title")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("features.subtitle")}</p>
          </div>
          <BentoGrid t={t} lang={lang} />
        </div>
      </section>

      {/* ============================ Preview banner ============================ */}
      <section id="preview" className="relative border-b border-border bg-primary text-primary-foreground overflow-hidden">
        <div className="absolute inset-0 grid-hero opacity-20" />
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
                <Cpu className="w-3.5 h-3.5 inline me-2" />
                Product
              </p>
              <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4`}>
                {t("preview.title")}
              </h2>
              <p className="text-primary-foreground/70 text-lg leading-relaxed mb-6">
                {t("preview.subtitle")}
              </p>
              <ul className="space-y-2.5">
                {[
                  "⌘K global search",
                  "Real-time KPIs",
                  "Attendance in 1 click",
                  "Invoice PDF export",
                  "Custom branding",
                ].map((f, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Check className="w-4 h-4 text-accent flex-shrink-0" />
                    {f}
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="lg:col-span-7">
              <DashboardPreview lang={lang} />
            </div>
          </div>
        </div>
      </section>

      {/* ============================ PRICING ============================ */}
      <section id="pricing" className="border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14 text-center mx-auto">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {t("nav.pricing")}
            </p>
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight mb-3`}>
              {t("pricing.title")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("pricing.subtitle")}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "Starter", price: "29", features: ["50 students", "3 users", "Email support", "Core modules"] },
              { name: "Pro", price: "79", features: ["500 students", "20 users", "Priority support", "Custom branding", "API access"], popular: true },
              { name: "Business", price: "199", features: ["Unlimited students", "Unlimited users", "24/7 support", "White-label", "SLA + SSO"] },
            ].map((p, i) => (
              <motion.div
                key={p.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                whileHover={{ y: -6 }}
                className={`rounded-2xl p-8 border transition-shadow duration-300 hover:shadow-xl ${
                  p.popular
                    ? "bg-primary text-primary-foreground border-primary relative"
                    : "bg-card border-border"
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-3 start-6 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-accent text-accent-foreground">
                    {t("pricing.popular")}
                  </div>
                )}
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                  {p.popular && <Rocket className="w-5 h-5 text-accent" />}
                </div>
                <div className="mb-6">
                  <span className="font-display text-5xl font-black tracking-tighter">
                    ${p.price}
                  </span>
                  <span className={`ms-2 text-sm ${p.popular ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                    {t("pricing.perMonth")}
                  </span>
                </div>
                <ul className="space-y-3 mb-8">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-accent flex-shrink-0" />
                      <span className={p.popular ? "text-primary-foreground/90" : "text-foreground"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/register" data-testid={`pricing-plan-${p.name.toLowerCase()}`}>
                  <Button
                    className={`w-full h-11 font-semibold ${
                      p.popular
                        ? "bg-accent hover:bg-accent/90 text-accent-foreground"
                        : ""
                    }`}
                    variant={p.popular ? "default" : "outline"}
                  >
                    {t("pricing.cta")}
                  </Button>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ Big CTA ============================ */}
      <section className="relative border-b border-border bg-primary text-primary-foreground overflow-hidden">
        <div className="absolute inset-0 grid-hero opacity-30" />
        <motion.div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl opacity-40"
          style={{ background: "radial-gradient(circle, hsl(var(--accent)) 0%, transparent 70%)" }}
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="max-w-7xl mx-auto px-6 py-24 md:py-32 relative">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8">
              <h2 className={`${heroFont} text-4xl md:text-6xl font-bold tracking-tighter leading-[1.05] mb-4`}>
                {t("cta.title")}
              </h2>
              <p className="text-lg text-primary-foreground/70 max-w-2xl">
                {t("cta.subtitle")}
              </p>
            </div>
            <div className="lg:col-span-4 flex lg:justify-end">
              <Link to="/register" data-testid="marketing-cta-bottom">
                <Button
                  size="lg"
                  className="bg-accent hover:bg-accent/90 text-accent-foreground h-14 px-8 text-base font-semibold rounded-lg shadow-[0_20px_50px_-10px_hsl(var(--accent))]"
                >
                  {t("hero.cta.primary")}
                  <ArrowRight className="ms-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ Footer ============================ */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 bg-primary rounded grid place-items-center">
                <span className="font-display font-black text-primary-foreground text-[10px]">S</span>
              </div>
              <span className="font-display font-bold">schooldz</span>
            </Link>
            <p className="text-xs text-muted-foreground max-w-[220px]">
              Multi-tenant cloud ERP for modern education centers.
            </p>
          </div>

          {[
            { title: t("footer.product"), links: [t("nav.features"), t("nav.pricing"), "Changelog", "Roadmap"] },
            { title: t("footer.company"), links: [t("nav.about"), "Blog", t("nav.contact"), "Careers"] },
            { title: t("footer.resources"), links: ["Docs", "API", "Status", "Community"] },
          ].map((col) => (
            <div key={col.title}>
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                {col.title}
              </div>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="text-foreground/80 hover:text-foreground transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border">
          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>© {new Date().getFullYear()} SchoolDZ — {t("footer.rights")}</div>
            <div className="flex items-center gap-4">
              <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="#" className="hover:text-foreground transition-colors">Terms</a>
              <a href="#" className="hover:text-foreground transition-colors">Security</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* -----------------------------------------------------------
 * Word-by-word reveal helper
 * ----------------------------------------------------------- */
function WordReveal({ text, className = "", delay = 0 }) {
  const words = String(text || "").split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden align-bottom">
          <motion.span
            className="inline-block"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.5, delay: delay + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            {w}
            {i < words.length - 1 && "\u00A0"}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
