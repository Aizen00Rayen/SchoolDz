import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, Facebook, Filter, Instagram, Linkedin, Loader2, MapPin, Music2,
  Phone, Search, Sparkles, Twitter, X, ZoomIn, Youtube,
} from "lucide-react";

import { api, extractError, resolveFileUrl, safeExternalUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SCHOOL_LEVELS } from "@/lib/schoolLevels";
import { Field } from "@/pages/app/_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DEFAULT_FORM = {
  guardian_name: "", guardian_email: "", guardian_phone: "", password: "",
  student_first_name: "", student_last_name: "", group_id: "",
};

const DEFAULT_FILTERS = { level: "all", year: "all", specialty: "all", q: "" };
const PAGE_SIZE = 9;

const SOCIAL_ICONS = {
  facebook: Facebook, instagram: Instagram, twitter: Twitter,
  youtube: Youtube, linkedin: Linkedin, tiktok: Music2,
};

const SCHOOL_LEVEL_AR = { primary: "ابتدائي", middle: "متوسط", high: "ثانوي" };
const SPECIALTY_AR = {
  common_science: "جذع مشترك علوم وتكنولوجيا",
  common_arts: "جذع مشترك آداب وفلسفة",
  science_exp: "علوم تجريبية",
  math: "رياضيات",
  tech_math: "تقني رياضي",
  management_econ: "تسيير واقتصاد",
  arts_philo: "آداب وفلسفة",
  foreign_lang: "لغات أجنبية",
};
const YEAR_ORDINALS_AR = ["الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة"];

/** "ثانوي · الثانية · علوم تجريبية" — same level/year/specialty a course was
 * set up for, shown on its public enrollment card so parents can tell which
 * class it targets before picking it. */
function courseLevelLabel(c) {
  if (!c?.school_level) return null;
  const parts = [SCHOOL_LEVEL_AR[c.school_level] || c.school_level];
  if (c.school_year) parts.push(YEAR_ORDINALS_AR[c.school_year - 1] || `السنة ${c.school_year}`);
  if (c.specialty) parts.push(SPECIALTY_AR[c.specialty] || c.specialty);
  return parts.join(" · ");
}

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
};

/** Eyebrow + big font-display heading, in the tenant's own accent color —
 * matches the marketing landing page's section-header convention, just
 * driven by per-school branding instead of the platform theme. */
function SectionHeading({ eyebrow, title, accent, center }) {
  return (
    <motion.div {...fadeUp} className={`mb-6 ${center ? "text-center" : ""}`}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] mb-2" style={{ color: accent }}>
        {eyebrow}
      </p>
      <h2 className="font-display text-3xl md:text-4xl font-bold tracking-tight">{title}</h2>
    </motion.div>
  );
}

/** Full-screen image lightbox with prev/next — reuses the shared Dialog
 * primitive (Esc/click-outside/close button already wired up there) rather
 * than hand-rolling an overlay. */
function GalleryLightbox({ photos, index, onClose, onNav }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") onNav(1);
      if (e.key === "ArrowLeft") onNav(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNav]);

  if (index == null) return null;
  const photo = photos[index];

  return (
    <Dialog open={index != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl bg-transparent border-none shadow-none p-0">
        <DialogTitle className="sr-only">{photo.caption || "Photo preview"}</DialogTitle>
        <AnimatePresence mode="wait">
          <motion.div
            key={photo.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            <img src={resolveFileUrl(photo.image_url)} alt={photo.caption || ""} className="w-full max-h-[80vh] object-contain rounded-xl" />
            {photo.caption && (
              <p className="text-center text-white/80 text-sm mt-3">{photo.caption}</p>
            )}
          </motion.div>
        </AnimatePresence>
        {photos.length > 1 && (
          <>
            <Button
              type="button" size="icon" variant="secondary"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full"
              onClick={() => onNav(-1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button" size="icon" variant="secondary"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
              onClick={() => onNav(1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One course tile in the catalog grid — deliberately compact (a school
 * with 20-30 open courses used to render as one endless stacked list) and
 * fully clickable, opening the enrollment dialog rather than expanding an
 * inline form that would push everything below it down the page. */
function CourseCard({ course: c, accent, currency, onSelect, index }) {
  const totalSeats = c.groups.reduce((s, g) => s + g.seats_left, 0);
  const scarce = c.groups.some((g) => g.seats_left_is_low);
  const allFull = totalSeats === 0;
  const levelLabel = courseLevelLabel(c);

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(c)}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: Math.min(index, 6) * 0.05 }}
      className="group text-start rounded-2xl border border-border bg-card overflow-hidden flex flex-col transition-all hover:shadow-xl hover:-translate-y-1"
    >
      <div className="relative h-32 overflow-hidden">
        {c.image_url ? (
          <img
            src={resolveFileUrl(c.image_url)}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full transition-transform duration-500 group-hover:scale-105"
            style={{ background: `linear-gradient(135deg, ${c.color || accent}, ${accent})` }}
          />
        )}
        {(scarce || allFull) && (
          <span
            className={`absolute top-2 start-2 text-[10px] font-bold px-2 py-1 rounded-full ${
              allFull ? "bg-black/70 text-white" : "text-white"
            }`}
            style={allFull ? undefined : { backgroundColor: accent }}
          >
            {allFull ? "مكتمل" : `تبقى ${totalSeats}!`}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        {levelLabel && (
          <p className="text-[11px] font-bold mb-1 truncate" style={{ color: accent }}>{levelLabel}</p>
        )}
        <h3 className="font-semibold mb-1 line-clamp-1">{c.title}</h3>
        {c.description && <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">{c.description}</p>}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground">
            {c.pricing_type === "per_session" ? "لكل حصة" : c.pricing_type === "per_month" ? "شهرياً" : `${c.sessions_count || ""} حصة`}
          </span>
          <span className="font-mono font-bold text-sm">
            {Number(c.price).toLocaleString()} {currency}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

export default function EnrollPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { loginWithToken } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // The public enrollment page is shown to parents who have never touched
  // the app, so it must never inherit whatever dark/light preference the
  // school's own staff happen to have left in this browser's localStorage
  // (that's what made this page render with a black background for some
  // schools). Removing the .dark class isn't enough on its own — ThemeProvider
  // wraps the whole app and re-applies that class from an effect of its own,
  // which (being the ancestor) fires *after* a child page's effect on mount
  // and would silently put it right back. Setting the light values as inline
  // custom properties instead — the same technique useTenantBranding uses for
  // per-school colors — always wins over the class-based rule regardless of
  // effect order, and also reaches Radix's Dialog/Select content, which
  // portals to document.body outside this page's own DOM subtree.
  useEffect(() => {
    const root = document.documentElement;
    const lightTokens = {
      "--background": "0 0% 98%", "--foreground": "240 5% 4%",
      "--card": "0 0% 100%", "--card-foreground": "240 5% 4%",
      "--popover": "0 0% 100%", "--popover-foreground": "240 5% 4%",
      "--secondary": "240 5% 96%", "--secondary-foreground": "240 5% 4%",
      "--muted": "240 5% 96%", "--muted-foreground": "240 4% 46%",
      "--border": "240 6% 90%", "--input": "240 6% 90%",
    };
    for (const [k, v] of Object.entries(lightTokens)) root.style.setProperty(k, v);
    return () => { for (const k of Object.keys(lightTokens)) root.style.removeProperty(k); };
  }, []);

  const { data: school, isLoading, isError } = useQuery({
    queryKey: ["public-school", slug],
    queryFn: async () => (await api.get(`/public/schools/${slug}`)).data,
    retry: false,
  });

  const courses = school?.courses || [];
  const teachers = school?.teachers || [];
  const gallery = school?.gallery || [];
  const socialEntries = Object.entries(school?.social_links || {}).filter(([, url]) => safeExternalUrl(url));
  const hasLocation = school?.address || school?.phone || school?.map_url || socialEntries.length > 0;
  const selectedCourse = courses.find((c) => c.id === selectedCourseId);
  const accent = school?.accent_color || "#E53935";
  const primary = school?.primary_color || "#0A0A0B";
  const currency = school?.currency || "";
  const mapEmbedSrc = school?.address ? `https://www.google.com/maps?q=${encodeURIComponent(school.address)}&output=embed` : null;

  // Filter options are derived from the school's actual course catalog
  // (not the full theoretical school-system taxonomy), so a dropdown never
  // offers a level/specialty that would just filter down to zero results.
  const levelsAvailable = SCHOOL_LEVELS.filter((lvl) => courses.some((c) => c.school_level === lvl));
  const yearsAvailable = filters.level === "all" ? [] : [...new Set(
    courses.filter((c) => c.school_level === filters.level && c.school_year).map((c) => c.school_year)
  )].sort((a, b) => a - b);
  const specialtiesAvailable = filters.level === "high" ? [...new Set(
    courses
      .filter((c) => c.school_level === "high" && (filters.year === "all" || String(c.school_year) === filters.year) && c.specialty)
      .map((c) => c.specialty)
  )] : [];
  const hasFilterableCourses = levelsAvailable.length > 0;

  const filteredCourses = courses.filter((c) => {
    if (filters.level !== "all" && c.school_level !== filters.level) return false;
    if (filters.year !== "all" && String(c.school_year) !== filters.year) return false;
    if (filters.specialty !== "all" && c.specialty !== filters.specialty) return false;
    if (filters.q.trim() && !c.title.toLowerCase().includes(filters.q.trim().toLowerCase())) return false;
    return true;
  });
  const visibleCourses = filteredCourses.slice(0, visibleCount);
  const hasMore = filteredCourses.length > visibleCourses.length;
  const filtersActive = filters.level !== "all" || filters.year !== "all" || filters.specialty !== "all" || filters.q.trim();

  const updateFilters = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setVisibleCount(PAGE_SIZE);
  };

  const openEnroll = (course) => {
    setSelectedCourseId(course.id);
    setForm((f) => ({ ...f, group_id: "" }));
    setEnrollOpen(true);
  };

  // Derived rather than synced into state via an effect: a course with only
  // one open group shouldn't need an extra click on a dropdown that already
  // shows its one option. An explicit user choice (form.group_id) always
  // wins; this is purely the fallback when nothing's been picked yet.
  const effectiveGroupId = form.group_id || selectedCourse?.groups.find((g) => g.seats_left > 0)?.id || "";

  const enrollMut = useMutation({
    mutationFn: (payload) => api.post(`/public/schools/${slug}/enroll`, payload).then((r) => r.data),
    onSuccess: async (data) => {
      setEnrollOpen(false);
      // Log in first — the parent portal landing page needs an authenticated session.
      await loginWithToken(data.access_token, data.user);
      toast.success(`تم تسجيل ${data.student.first_name} بنجاح!`);
      nav("/portal", { replace: true });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!effectiveGroupId) {
      toast.error("اختر مجموعة الدورة أولاً.");
      return;
    }
    enrollMut.mutate({ ...form, group_id: effectiveGroupId });
  };

  if (isLoading) {
    return (
      <div dir="rtl" className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !school) {
    return (
      <div dir="rtl" className="min-h-screen grid place-items-center bg-background text-center px-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">المدرسة غير موجودة</h1>
          <p className="text-muted-foreground">تحقق من الرابط الذي تم تزويدك به.</p>
        </div>
      </div>
    );
  }

  const scrollToCourses = () => document.getElementById("courses")?.scrollIntoView({ behavior: "smooth" });
  const navLightbox = (delta) => setLightboxIndex((i) => (i == null ? i : (i + delta + gallery.length) % gallery.length));

  return (
    <div dir="rtl" className="min-h-screen bg-background overflow-x-hidden">
      <style>{`
        @keyframes enrollBlobFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.08); }
          66% { transform: translate(-20px, 15px) scale(0.96); }
        }
        .enroll-blob { animation: enrollBlobFloat 14s ease-in-out infinite; }
      `}</style>

      {/* Hero — centered, colorful, animated */}
      {school.hero_image_url ? (
        <div className="relative h-80 md:h-[26rem] overflow-hidden">
          <img src={resolveFileUrl(school.hero_image_url)} alt="" className="absolute inset-0 w-full h-full object-cover scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/20" />
          <div className="relative h-full max-w-5xl mx-auto px-6 flex flex-col items-center justify-center text-center">
            <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {school.logo_url && (
                <img src={resolveFileUrl(school.logo_url)} alt={school.name} className="w-20 h-20 rounded-2xl object-cover mx-auto mb-4 border-2 border-white/80 shadow-2xl" />
              )}
              <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight text-white">{school.name}</h1>
            </motion.div>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden border-b border-border" style={{ backgroundColor: `${accent}08` }}>
          <div
            className="enroll-blob absolute -top-24 -start-24 w-80 h-80 rounded-full blur-3xl opacity-25 pointer-events-none"
            style={{ backgroundColor: accent }}
          />
          <div
            className="enroll-blob absolute -bottom-24 -end-24 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{ backgroundColor: primary, animationDelay: "-7s" }}
          />
          <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-20 flex flex-col items-center text-center">
            <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              {school.logo_url ? (
                <img src={resolveFileUrl(school.logo_url)} alt={school.name} className="w-20 h-20 rounded-2xl object-cover mx-auto mb-4 shadow-xl" />
              ) : (
                <div
                  className="w-20 h-20 rounded-2xl grid place-items-center mx-auto mb-4 text-white font-bold text-3xl shadow-xl"
                  style={{ backgroundColor: primary }}
                >
                  {school.name?.[0]?.toUpperCase()}
                </div>
              )}
              <span
                className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full mb-4"
                style={{ color: accent, backgroundColor: `${accent}1a` }}
              >
                <Sparkles className="w-3 h-3" /> التسجيل مفتوح
              </span>
              <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">{school.name}</h1>
              {courses.length > 0 && (
                <Button
                  onClick={scrollToCourses}
                  className="mt-6 text-white shadow-lg hover:shadow-xl transition-shadow"
                  style={{ backgroundColor: accent }}
                >
                  تصفح الدورات المتاحة
                </Button>
              )}
            </motion.div>
          </div>
        </div>
      )}

      {/* About */}
      {school.enrollment_description && (
        <motion.div {...fadeUp} className="max-w-5xl mx-auto px-6 pt-12 text-center">
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">{school.enrollment_description}</p>
        </motion.div>
      )}

      {/* Gallery — hover zoom + click-to-enlarge lightbox */}
      {gallery.length > 0 && (
        <div className="max-w-5xl mx-auto px-6 pt-14">
          <SectionHeading eyebrow="معرض الصور" title="لمحة من الداخل" accent={accent} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {gallery.map((p, i) => (
              <motion.button
                key={p.id}
                type="button"
                onClick={() => setLightboxIndex(i)}
                initial={{ opacity: 0, scale: 0.94 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="relative rounded-xl overflow-hidden group cursor-zoom-in"
              >
                <img
                  src={resolveFileUrl(p.image_url)}
                  alt={p.caption || ""}
                  className="w-full h-32 md:h-36 object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <GalleryLightbox photos={gallery} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onNav={navLightbox} />

      {/* Teachers */}
      {teachers.length > 0 && (
        <div className="max-w-5xl mx-auto px-6 pt-14">
          <SectionHeading eyebrow="تعرف على الفريق" title="تعلم مع الأفضل" accent={accent} />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {teachers.map((tch, i) => (
              <motion.div
                key={tch.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="text-center"
              >
                {tch.photo_url ? (
                  <img
                    src={resolveFileUrl(tch.photo_url)}
                    alt=""
                    className="w-24 h-24 rounded-full object-cover mx-auto mb-3 ring-4 transition-transform hover:scale-105"
                    style={{ "--tw-ring-color": `${accent}33` }}
                  />
                ) : (
                  <div
                    className="w-24 h-24 rounded-full bg-muted grid place-items-center mx-auto mb-3 font-bold text-lg text-muted-foreground ring-4 transition-transform hover:scale-105"
                    style={{ "--tw-ring-color": `${accent}33` }}
                  >
                    {tch.first_name?.[0]}{tch.last_name?.[0]}
                  </div>
                )}
                <div className="text-sm font-semibold">{tch.first_name} {tch.last_name}</div>
                {tch.subjects?.length > 0 && (
                  <div className="text-xs text-muted-foreground">{tch.subjects.join(", ")}</div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Location, contact, social — with a real embedded map */}
      {hasLocation && (
        <div className="max-w-5xl mx-auto px-6 pt-14">
          <SectionHeading eyebrow="موقعنا" title="زورونا أو تواصلوا معنا" accent={accent} />
          <motion.div {...fadeUp} className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-4">
              {school.address && (
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                    <MapPin className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{school.address}</div>
                    {safeExternalUrl(school.map_url) && (
                      <a href={safeExternalUrl(school.map_url)} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: accent }}>
                        احصل على الاتجاهات
                      </a>
                    )}
                  </div>
                </div>
              )}
              {school.phone && (
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                    <Phone className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium">{school.phone}</span>
                </div>
              )}
              {socialEntries.length > 0 && (
                <div className="flex items-center gap-2 pt-2">
                  {socialEntries.map(([platform, url]) => {
                    const Icon = SOCIAL_ICONS[platform];
                    return (
                      <a
                        key={platform} href={safeExternalUrl(url)} target="_blank" rel="noreferrer" aria-label={platform}
                        className="w-9 h-9 rounded-full grid place-items-center transition-transform hover:scale-110"
                        style={{ backgroundColor: `${accent}1a`, color: accent }}
                      >
                        {Icon ? <Icon className="w-4 h-4" /> : <span className="text-xs font-bold uppercase">{platform[0]}</span>}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>

            {mapEmbedSrc && (
              <div className="rounded-xl overflow-hidden border border-border h-64">
                <iframe
                  title="موقع المدرسة"
                  src={mapEmbedSrc}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* Course catalog — filterable grid instead of one long stacked list,
          so a school with 20-30 open courses stays a short, scannable page. */}
      {courses.length > 0 && (
        <div id="courses" className="pt-14 pb-16" style={{ backgroundColor: `${accent}06` }}>
          <div className="max-w-5xl mx-auto px-6">
            <SectionHeading eyebrow="التسجيل" title="اختر الدورة المناسبة" accent={accent} center />

            {(hasFilterableCourses || courses.length > PAGE_SIZE) && (
              <motion.div {...fadeUp} className="surface-card p-4 mb-8 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  <Filter className="w-3.5 h-3.5" /> تصفية النتائج
                </div>
                <div className="flex flex-wrap gap-2">
                  {courses.length > PAGE_SIZE && (
                    <div className="relative flex-1 min-w-[160px]">
                      <Search className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        value={filters.q}
                        onChange={(e) => updateFilters({ q: e.target.value })}
                        placeholder="ابحث عن دورة…"
                        className="bg-background pe-9 h-9"
                      />
                    </div>
                  )}
                  {hasFilterableCourses && (
                    <Select value={filters.level} onValueChange={(v) => updateFilters({ level: v, year: "all", specialty: "all" })}>
                      <SelectTrigger className="bg-background h-9 w-auto min-w-[110px]"><SelectValue placeholder="المرحلة" /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="all">كل المراحل</SelectItem>
                        {levelsAvailable.map((lvl) => (
                          <SelectItem key={lvl} value={lvl}>{SCHOOL_LEVEL_AR[lvl]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {yearsAvailable.length > 0 && (
                    <Select value={filters.year} onValueChange={(v) => updateFilters({ year: v, specialty: "all" })}>
                      <SelectTrigger className="bg-background h-9 w-auto min-w-[110px]"><SelectValue placeholder="السنة" /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="all">كل السنوات</SelectItem>
                        {yearsAvailable.map((y) => (
                          <SelectItem key={y} value={String(y)}>السنة {YEAR_ORDINALS_AR[y - 1] || y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {specialtiesAvailable.length > 0 && (
                    <Select value={filters.specialty} onValueChange={(v) => updateFilters({ specialty: v })}>
                      <SelectTrigger className="bg-background h-9 w-auto min-w-[140px]"><SelectValue placeholder="الشعبة" /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="all">كل الشعب</SelectItem>
                        {specialtiesAvailable.map((sp) => (
                          <SelectItem key={sp} value={sp}>{SPECIALTY_AR[sp] || sp}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {filtersActive && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => updateFilters(DEFAULT_FILTERS)} className="h-9 text-xs">
                      <X className="w-3.5 h-3.5 me-1" /> إلغاء التصفية
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {filteredCourses.length} من أصل {courses.length} دورة
                </p>
              </motion.div>
            )}

            {filteredCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">لا توجد دورات مطابقة لهذا البحث.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleCourses.map((c, i) => (
                    <CourseCard key={c.id} course={c} accent={accent} currency={currency} onSelect={openEnroll} index={i} />
                  ))}
                </div>
                {hasMore && (
                  <div className="flex justify-center mt-6">
                    <Button type="button" variant="outline" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      عرض المزيد ({filteredCourses.length - visibleCourses.length} أخرى)
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Enrollment dialog — opened from a course card, so the catalog above
          stays a compact grid instead of an inline form pushing it around. */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="max-w-lg bg-card max-h-[88vh] overflow-y-auto" dir="rtl">
          {selectedCourse && (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">{selectedCourse.title}</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {courseLevelLabel(selectedCourse) ? `${courseLevelLabel(selectedCourse)} — ` : ""}
                  املأ البيانات أدناه لتسجيل طفلك في هذه الدورة.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmit} className="space-y-4">
                <Field label="المجموعة" required>
                  <Select value={effectiveGroupId} onValueChange={(v) => setForm((f) => ({ ...f, group_id: v }))}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="اختر مجموعة" /></SelectTrigger>
                    <SelectContent className="bg-popover">
                      {selectedCourse.groups.map((g) => (
                        <SelectItem key={g.id} value={g.id} disabled={g.seats_left === 0}>
                          {g.name}{g.schedule ? ` · ${g.schedule}` : ""}
                          {g.seats_left === 0 ? " — مكتمل" : g.seats_left_is_low ? ` — تبقى ${g.seats_left} فقط!` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="الاسم الأول للطالب" required>
                    <Input value={form.student_first_name} onChange={(e) => setForm((f) => ({ ...f, student_first_name: e.target.value }))} required />
                  </Field>
                  <Field label="لقب الطالب" required>
                    <Input value={form.student_last_name} onChange={(e) => setForm((f) => ({ ...f, student_last_name: e.target.value }))} required />
                  </Field>
                </div>

                <Field label="اسمك (ولي الأمر)" required>
                  <Input value={form.guardian_name} onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))} required />
                </Field>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="البريد الإلكتروني" required>
                    <Input type="email" value={form.guardian_email} onChange={(e) => setForm((f) => ({ ...f, guardian_email: e.target.value }))} required dir="ltr" />
                  </Field>
                  <Field label="الهاتف" required>
                    <Input value={form.guardian_phone} onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))} required dir="ltr" />
                  </Field>
                </div>

                <Field label="اختر كلمة مرور" required>
                  <Input
                    type="password" minLength={8} value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required placeholder="8 أحرف على الأقل" dir="ltr"
                  />
                </Field>
                <p className="text-xs text-muted-foreground -mt-2">
                  ستكون هذه بيانات دخولك إلى بوابة الأولياء، حيث يمكنك متابعة الحضور والنتائج والمدفوعات. الدفع يتم لاحقًا في مكتب المدرسة.
                </p>

                <Button type="submit" className="w-full h-11" disabled={enrollMut.isPending} style={{ backgroundColor: accent }}>
                  {enrollMut.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <><Check className="w-4 h-4 me-2" /> تسجيل</>
                  )}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      {courses.length === 0 && (
        <div className="max-w-5xl mx-auto px-6 py-14 text-center">
          <p className="text-sm text-muted-foreground">لا توجد دورات مفتوحة للتسجيل حالياً — يرجى التواصل مع المدرسة مباشرة.</p>
        </div>
      )}
    </div>
  );
}
