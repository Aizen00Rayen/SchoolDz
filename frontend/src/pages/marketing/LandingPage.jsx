import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  motion, useMotionValue, useSpring, useTransform, useScroll, animate,
  useMotionValueEvent, useInView,
} from "framer-motion";
import {
  ArrowRight, Users, CalendarCheck2, Wallet, BookOpen,
  BarChart3, Check, Star, Cpu,
  Zap, Layers, GraduationCap,
} from "lucide-react";

import MarketingNav from "./MarketingNav";
import { useI18n } from "@/lib/i18n";
import { MARKETING } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { StickyFeatureCards } from "@/components/ui/sticky-scroll-cards-section";
import PlanCards from "@/components/PlanCards";
import { Logo } from "@/components/Logo";

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
        style={{ background: "radial-gradient(circle, hsl(var(--primary)) 0%, transparent 70%)" }}
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
 * Animated brand logo reveal (used in hero)
 * ----------------------------------------------------------- */
const HERO_CYCLE_MS = 4400; // reveal (~1.6s) + hold + a quick fade, then loops

function HeroLogoAnimation() {
  // Stagger index per node, in the order they appear in the SVG below.
  const nodeDelay = (i) => `${0.05 + i * 0.05}s`;

  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setCycle((c) => c + 1), HERO_CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto aspect-[3/2] bg-transparent relative flex justify-center items-center logo-animation-box p-6 select-none group">
      {/* Dynamic ambient background glow */}
      <div className="absolute -inset-10 bg-gradient-to-tr from-accent/10 via-transparent to-transparent rounded-full blur-3xl opacity-40 pointer-events-none group-hover:opacity-75 transition-opacity duration-700" />

      <style>{`
        .logo-animation-box {
          perspective: 1000px;
        }

        /* Shifts the icon left, in sync with the wordmark reveal, so the
           mark and "scolaris" don't sit on top of each other at rest. */
        .hero-logo-mark {
          animation: heroShiftLeft 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 1s forwards;
        }

        /* Holds the fully-revealed mark, then fades out right before the
           whole sequence remounts and replays — the loop that keeps this
           animation going instead of settling into a static end state. */
        .hero-cycle-fade {
          animation: heroCycleFade 0.5s ease-in 3.6s forwards;
        }

        /* Standard Nodes (Circles & Square) */
        .hero-node {
          fill: currentColor;
          opacity: 0;
          transform-origin: center;
          transform-box: fill-box;
          animation: heroPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
          transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), fill 0.3s ease;
        }
        .logo-animation-box:hover .hero-node {
          fill: hsl(var(--foreground) / 0.8);
          transform: scale(1.08);
        }

        /* Top Right Accent Node */
        .hero-accent-node {
          fill: currentColor;
          opacity: 0;
          transform-origin: center;
          transform-box: fill-box;
          filter: url(#accent-glow);
          animation:
            heroPopIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards,
            heroTurnAccent 0.4s ease 0.65s forwards;
          transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.3s ease;
        }
        .logo-animation-box:hover .hero-accent-node {
          transform: scale(1.22);
          filter: url(#accent-glow-intense);
        }

        /* Idle "live" pulse ring — starts once the reveal settles */
        .hero-accent-ping {
          fill: none;
          stroke: hsl(var(--accent));
          stroke-width: 2;
          opacity: 0;
          transform-origin: center;
          transform-box: fill-box;
          animation: heroLivePulse 2.4s cubic-bezier(0.2, 0.8, 0.2, 1) 1.8s infinite;
        }

        /* Connecting Lines */
        .hero-line {
          stroke: currentColor;
          stroke-opacity: 0.18;
          stroke-width: 6;
          stroke-linecap: round;
          stroke-linejoin: round;
          fill: none;
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          opacity: 0;
          animation:
            heroShowLine 0.01s linear forwards,
            heroDrawLine 0.5s ease-in-out forwards,
            heroHighlightLine 0.4s ease 1s forwards;
          transition: stroke-opacity 0.3s ease, stroke-width 0.3s ease;
        }
        .logo-animation-box:hover .hero-line {
          stroke-opacity: 0.38;
          stroke-width: 7;
        }

        /* Typography */
        .hero-logo-text {
          fill: currentColor;
          font-family: "Cabinet Grotesk", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 88px;
          font-weight: 800;
          letter-spacing: -3px;
          opacity: 0;
          animation: heroRevealText 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) 1s forwards;
          transition: fill 0.3s ease, transform 0.3s ease;
        }
        .logo-animation-box:hover .hero-logo-text {
          fill: hsl(var(--accent));
          transform: scale(1.02);
        }

        /* --- Keyframes --- */
        @keyframes heroPopIn {
          0% { opacity: 0; transform: scale(0); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes heroShowLine {
          to { opacity: 1; }
        }
        @keyframes heroDrawLine {
          to { stroke-dashoffset: 0; }
        }
        @keyframes heroTurnAccent {
          to { fill: hsl(var(--accent)); }
        }
        @keyframes heroHighlightLine {
          to { stroke-opacity: 0.35; }
        }
        @keyframes heroRevealText {
          0% { opacity: 0; transform: translateX(16px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes heroShiftLeft {
          to { transform: translateX(-160px); }
        }
        @keyframes heroCycleFade {
          to { opacity: 0; }
        }
        @keyframes heroLivePulse {
          0% { opacity: 0.6; transform: scale(1); }
          100% { opacity: 0; transform: scale(2.2); }
        }

        @media (prefers-reduced-motion: reduce) {
          .hero-node, .hero-accent-node, .hero-line, .hero-logo-text {
            animation: none !important;
            opacity: 1 !important;
            stroke-dashoffset: 0 !important;
            stroke-opacity: 0.35 !important;
          }
          .hero-accent-node { fill: hsl(var(--accent)) !important; }
          .hero-accent-ping { animation: none !important; opacity: 0 !important; }
          .hero-logo-mark { animation: none !important; transform: translateX(-160px) !important; }
          .hero-cycle-fade { animation: none !important; }
        }
      `}</style>
      <div key={cycle} className="hero-cycle-fade w-full max-w-[800px] pointer-events-none">
        <svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto text-foreground">
          <defs>
            <filter id="accent-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="hsl(var(--accent))" floodOpacity="0.35" />
            </filter>
            <filter id="accent-glow-intense" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="hsl(var(--accent))" floodOpacity="0.7" />
            </filter>
          </defs>
          {/* Logo Mark Elements */}
          <g className="hero-logo-mark">
            {/* Lines (drawn behind the nodes), staggered */}
            <path className="hero-line" pathLength="100" style={{ animationDelay: "0.3s" }} d="M240 40 L360 40 L360 160 L240 160 Z" />
            <path className="hero-line" pathLength="100" style={{ animationDelay: "0.35s" }} d="M300 40 L300 160" />
            <path className="hero-line" pathLength="100" style={{ animationDelay: "0.4s" }} d="M240 100 L360 100" />
            <path className="hero-line" pathLength="100" style={{ animationDelay: "0.45s" }} d="M240 40 L360 160" />
            <path className="hero-line" pathLength="100" style={{ animationDelay: "0.5s" }} d="M240 160 L360 40" />

            {/* Nodes, staggered pop-in */}
            <rect className="hero-node" style={{ animationDelay: nodeDelay(0) }} x="282" y="82" width="36" height="36" />

            <circle className="hero-node" style={{ animationDelay: nodeDelay(1) }} cx="240" cy="40" r="14" /> {/* Top Left */}
            <circle className="hero-node" style={{ animationDelay: nodeDelay(2) }} cx="300" cy="40" r="14" /> {/* Top Center */}
            <circle className="hero-accent-node" style={{ animationDelay: `${nodeDelay(3)}, 0.65s` }} cx="360" cy="40" r="14" /> {/* Top Right (Accent) */}

            <circle className="hero-node" style={{ animationDelay: nodeDelay(4) }} cx="240" cy="100" r="14" /> {/* Middle Left */}
            <circle className="hero-node" style={{ animationDelay: nodeDelay(5) }} cx="360" cy="100" r="14" /> {/* Middle Right */}

            <circle className="hero-node" style={{ animationDelay: nodeDelay(6) }} cx="240" cy="160" r="14" /> {/* Bottom Left */}
            <circle className="hero-node" style={{ animationDelay: nodeDelay(7) }} cx="300" cy="160" r="14" /> {/* Bottom Center */}
            <circle className="hero-node" style={{ animationDelay: nodeDelay(8) }} cx="360" cy="160" r="14" /> {/* Bottom Right */}

            {/* Idle "live" ping ring around the accent node */}
            <circle className="hero-accent-ping" cx="360" cy="40" r="14" />
          </g>

          {/* Brand Name Typography */}
          <text className="hero-logo-text" x="250" y="130">scolaris</text>
        </svg>
      </div>
    </div>
  );
}

/* -----------------------------------------------------------
 * Live-feeling dashboard preview card (used in hero)
 * ----------------------------------------------------------- */
function DashboardPreview({ lang }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const sessions = [
    { k: "en", name: "Python for Beginners · Group A", time: "18:00 → 20:00", tag: "Live", color: "bg-success" },
    { k: "fr", name: "Anglais A2 · Groupe B", time: "17:00 → 19:00", tag: "Next", color: "bg-info" },
    { k: "ar", name: "Advanced Math · Group C", time: "19:00 → 21:00", tag: "Soon", color: "bg-warning" },
  ];
  useEffect(() => {
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % sessions.length), 2200);
    return () => clearInterval(t);
  }, [sessions.length]);

  return (
    <TiltCard>
      <div className="relative">
        {/* Reflection glow */}
        <div className="absolute -inset-6 bg-gradient-to-tr from-accent/20 via-primary/10 to-primary/5 rounded-[2rem] blur-2xl -z-10" />

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
              https://myschool.scolaris.com
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
                    { label: "Revenue", value: "8.8M DZD", sub: "+18%", accent: true },
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
                    <div className="text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded-full">
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
                            ? "bg-success/10 text-success"
                            : s.tag === "Next"
                            ? "bg-info/10 text-info"
                            : "bg-warning/10 text-warning"
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
            <div className="w-7 h-7 rounded-full bg-success/20 grid place-items-center">
              <Wallet className="w-3.5 h-3.5 text-success" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Paid
            </div>
          </div>
          <div className="font-mono text-lg font-bold">124,000 DZD</div>
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
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
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
 * Sticky-stacking feature cards
 * ----------------------------------------------------------- */
function stickyFeatureItems(t) {
  return [
    {
      title: t("feature.students.title"),
      description: t("feature.students.desc"),
      icon: GraduationCap,
      imageUrl: "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1200&auto=format&fit=crop",
      className: "bg-primary/10 border-primary/20",
    },
    {
      title: t("feature.attendance.title"),
      description: t("feature.attendance.desc"),
      icon: CalendarCheck2,
      imageUrl: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?q=80&w=1200&auto=format&fit=crop",
      className: "bg-info/10 border-info/20",
    },
    {
      title: t("feature.payments.title"),
      description: t("feature.payments.desc"),
      icon: Wallet,
      imageUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?q=80&w=1200&auto=format&fit=crop",
      className: "bg-accent/10 border-accent/20",
    },
    {
      title: t("feature.analytics.title"),
      description: t("feature.analytics.desc"),
      icon: BarChart3,
      imageUrl: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1200&auto=format&fit=crop",
      className: "bg-warning/10 border-warning/20",
    },
  ];
}

/* -----------------------------------------------------------
 * Landing page
 * ----------------------------------------------------------- */
export default function LandingPage() {
  const { t, lang } = useI18n();
  const location = useLocation();
  const heroFont = lang === "ar" ? "font-arabic" : "font-display";
  const centerTypes = [
    t("type.tutoring"), t("type.language"), t("type.coding"), t("type.robotics"),
    t("type.music"), t("type.art"), t("type.camp"), t("type.pro"),
  ];

  // Nav links to in-page sections (e.g. "Features") arrive as /#features from
  // other routes — the browser only auto-scrolls a #hash on same-document
  // navigation, not on a route change into this page, so it needs a nudge.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash]);

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
              {/* Word-by-word reveal */}
              <h1 className={`${heroFont} text-4xl md:text-6xl lg:text-[4.75rem] font-black tracking-tighter leading-[0.95] mb-6`}>
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
                <Button
                  size="lg"
                  className="bg-accent hover:bg-accent/90 text-accent-foreground text-base font-semibold h-12 px-6 rounded-lg shadow-[0_10px_30px_-10px_hsl(var(--accent))] group"
                  asChild
                >
                  <Link to="/register" data-testid={MARKETING.heroCtaPrimary}>
                    {t("hero.cta.primary")}
                    <ArrowRight className="ms-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="text-base font-semibold h-12 px-6 rounded-lg backdrop-blur bg-background/60"
                  asChild
                >
                  <Link to="/login" data-testid={MARKETING.heroCtaSecondary}>
                    {t("hero.cta.secondary")}
                  </Link>
                </Button>
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

            {/* Right — Animated brand logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.6, ease: "easeOut" }}
              className="lg:col-span-6 relative flex justify-center items-center"
            >
              <HeroLogoAnimation />
            </motion.div>
          </div>

          {/* Centered Dashboard Preview below the hero grid */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
            className="mt-16 flex justify-center max-w-4xl mx-auto w-full relative px-6 md:px-0"
          >
            <DashboardPreview lang={lang} />
          </motion.div>
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

      {/* ============================ FEATURES ============================ */}
      <section id="features" className="border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-2xl mb-14">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-3">
              {t("nav.features")}
            </p>
            <h2 className={`${heroFont} text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-3`}>
              {t("features.title")}
            </h2>
            <p className="text-lg text-muted-foreground">{t("features.subtitle")}</p>
          </div>
          <StickyFeatureCards features={stickyFeatureItems(t)} />
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

          <PlanCards mode="marketing" t={t} />
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
              <Button
                size="lg"
                className="bg-accent hover:bg-accent/90 text-accent-foreground h-14 px-8 text-base font-semibold rounded-lg shadow-[0_20px_50px_-10px_hsl(var(--accent))]"
                asChild
              >
                <Link to="/register" data-testid="marketing-cta-bottom">
                  {t("hero.cta.primary")}
                  <ArrowRight className="ms-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ Footer ============================ */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="inline-flex mb-3">
              <Logo size={22} textClassName="text-base" />
            </Link>
            <p className="text-xs text-muted-foreground max-w-[220px]">
              Multi-tenant cloud ERP for modern education centers.
            </p>
          </div>

          {[
            {
              title: t("footer.product"),
              links: [
                { label: t("nav.features"), to: "/#features" },
                { label: t("nav.pricing"), to: "/pricing" },
                { label: "Changelog" },
                { label: "Roadmap" },
              ],
            },
            {
              title: t("footer.company"),
              links: [
                { label: t("nav.about"), to: "/about" },
                { label: "Blog" },
                { label: t("nav.contact") },
                { label: "Careers" },
              ],
            },
            { title: t("footer.resources"), links: [{ label: "Docs", to: "/about" }, { label: "API" }, { label: "Status" }, { label: "Community" }] },
          ].map((col) => (
            <div key={col.title}>
              <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">
                {col.title}
              </div>
              <ul className="space-y-2 text-sm">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.to ? (
                      <Link to={l.to} className="text-foreground/80 hover:text-foreground transition-colors">
                        {l.label}
                      </Link>
                    ) : (
                      <a href="#" className="text-foreground/80 hover:text-foreground transition-colors">
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-border">
          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>© {new Date().getFullYear()} Scolaris — {t("footer.rights")}</div>
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
