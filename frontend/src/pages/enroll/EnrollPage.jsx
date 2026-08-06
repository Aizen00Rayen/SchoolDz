import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, ChevronLeft, ChevronRight, Facebook, Instagram, Linkedin, Loader2, MapPin, Music2,
  Phone, Sparkles, Twitter, Users, X, ZoomIn, Youtube,
} from "lucide-react";

import { api, extractError, resolveFileUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Field } from "@/pages/app/_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DEFAULT_FORM = {
  guardian_name: "", guardian_email: "", guardian_phone: "", password: "",
  student_first_name: "", student_last_name: "", group_id: "", payment_method: "office",
};

const SOCIAL_ICONS = {
  facebook: Facebook, instagram: Instagram, twitter: Twitter,
  youtube: Youtube, linkedin: Linkedin, tiktok: Music2,
};

const fadeUp = {
  initial: { opacity: 0, y: 28 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] },
};

/** Eyebrow + big font-display heading, in the tenant's own accent color —
 * matches the marketing landing page's section-header convention, just
 * driven by per-school branding instead of the platform theme. */
function SectionHeading({ eyebrow, title, accent }) {
  return (
    <motion.div {...fadeUp} className="mb-6">
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

export default function EnrollPage() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { loginWithToken } = useAuth();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const { data: school, isLoading, isError } = useQuery({
    queryKey: ["public-school", slug],
    queryFn: async () => (await api.get(`/public/schools/${slug}`)).data,
    retry: false,
  });

  const courses = school?.courses || [];
  const teachers = school?.teachers || [];
  const gallery = school?.gallery || [];
  const socialEntries = Object.entries(school?.social_links || {}).filter(([, url]) => url);
  const hasLocation = school?.address || school?.phone || school?.map_url || socialEntries.length > 0;
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) || courses[0];
  const accent = school?.accent_color || "#E53935";
  const primary = school?.primary_color || "#0A0A0B";
  const mapEmbedSrc = school?.address ? `https://www.google.com/maps?q=${encodeURIComponent(school.address)}&output=embed` : null;

  // Derived rather than synced into state via an effect: a course with only
  // one open group shouldn't need an extra click on a dropdown that already
  // shows its one option. An explicit user choice (form.group_id) always
  // wins; this is purely the fallback when nothing's been picked yet.
  const effectiveGroupId = form.group_id || selectedCourse?.groups.find((g) => g.seats_left > 0)?.id || "";

  const enrollMut = useMutation({
    mutationFn: (payload) => api.post(`/public/schools/${slug}/enroll`, payload).then((r) => r.data),
    onSuccess: async (data) => {
      if (data.payment_error) toast.warning(data.payment_error);
      // Log in first in both cases — the success/failure pages after a
      // Chargily redirect require an authenticated parent portal session.
      await loginWithToken(data.access_token, data.user);
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      toast.success(`${data.student.first_name} is enrolled!`);
      nav("/portal", { replace: true });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    if (!effectiveGroupId) {
      toast.error("Choose a course group first.");
      return;
    }
    enrollMut.mutate({ ...form, group_id: effectiveGroupId });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !school) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-center px-6">
        <div>
          <h1 className="text-2xl font-bold mb-2">School not found</h1>
          <p className="text-muted-foreground">Double-check the link you were given.</p>
        </div>
      </div>
    );
  }

  const scrollToEnroll = () => document.getElementById("enroll")?.scrollIntoView({ behavior: "smooth" });
  const navLightbox = (delta) => setLightboxIndex((i) => (i == null ? i : (i + delta + gallery.length) % gallery.length));

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
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
        <div className="relative overflow-hidden border-b border-border">
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
                <Sparkles className="w-3 h-3" /> Enrollment open
              </span>
              <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight">{school.name}</h1>
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
          <SectionHeading eyebrow="Gallery" title="A look inside" accent={accent} />
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
          <SectionHeading eyebrow="Meet the team" title="Learn from the best" accent={accent} />
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
          <SectionHeading eyebrow="Find us" title="Visit or reach out" accent={accent} />
          <motion.div {...fadeUp} className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-4">
              {school.address && (
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-lg grid place-items-center flex-shrink-0" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                    <MapPin className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-sm font-medium">{school.address}</div>
                    {school.map_url && (
                      <a href={school.map_url} target="_blank" rel="noreferrer" className="text-xs hover:underline" style={{ color: accent }}>
                        Get directions
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
                        key={platform} href={url} target="_blank" rel="noreferrer" aria-label={platform}
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
                  title="School location"
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

      {/* Enroll now CTA */}
      {courses.length > 0 && (
        <div className="max-w-5xl mx-auto px-6 pt-14 flex justify-center">
          <motion.div {...fadeUp}>
            <Button
              onClick={scrollToEnroll}
              className="text-white shadow-lg hover:shadow-xl transition-shadow"
              style={{ backgroundColor: accent }}
            >
              Enroll now
            </Button>
          </motion.div>
        </div>
      )}

      <div id="enroll" className="max-w-5xl mx-auto px-6 py-14 grid grid-cols-1 lg:grid-cols-5 gap-10">
        {/* Course picker */}
        <motion.div {...fadeUp} className="lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Choose a course
          </h2>
          {courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses are open for enrollment right now — please contact the school directly.</p>
          ) : (
            <div className="space-y-3">
              {courses.map((c) => {
                const totalSeats = c.groups.reduce((s, g) => s + g.seats_left, 0);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setSelectedCourseId(c.id); setForm((f) => ({ ...f, group_id: "" })); }}
                    className={`w-full text-start rounded-xl border p-4 transition-all overflow-hidden hover:shadow-md ${
                      selectedCourse?.id === c.id ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/20"
                    }`}
                  >
                    {c.image_url && (
                      <img src={resolveFileUrl(c.image_url)} alt="" className="w-full h-28 object-cover rounded-lg mb-3 -mt-1" />
                    )}
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                      <span className="font-semibold">{c.title}</span>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground mb-2">{c.description}</p>}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{c.duration_weeks} weeks</span>
                      <span className="font-mono font-semibold text-foreground">
                        {Number(c.price).toLocaleString()} {school.currency}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                      <Users className="w-3 h-3" />
                      {totalSeats > 0 ? `${totalSeats} seat${totalSeats > 1 ? "s" : ""} left` : "Full"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Enrollment form */}
        <motion.div {...fadeUp} className="lg:col-span-3">
          {selectedCourse && (
            <form onSubmit={onSubmit} className="space-y-5 surface-card p-6">
              <Field label="Group" required>
                <Select value={effectiveGroupId} onValueChange={(v) => setForm((f) => ({ ...f, group_id: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Pick a group" /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {selectedCourse.groups.map((g) => (
                      <SelectItem key={g.id} value={g.id} disabled={g.seats_left === 0}>
                        {g.name}{g.schedule ? ` · ${g.schedule}` : ""} — {g.seats_left === 0 ? "Full" : `${g.seats_left} left`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Student first name" required>
                  <Input value={form.student_first_name} onChange={(e) => setForm((f) => ({ ...f, student_first_name: e.target.value }))} required />
                </Field>
                <Field label="Student last name" required>
                  <Input value={form.student_last_name} onChange={(e) => setForm((f) => ({ ...f, student_last_name: e.target.value }))} required />
                </Field>
              </div>

              <Field label="Your name (parent/guardian)" required>
                <Input value={form.guardian_name} onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))} required />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Email" required>
                  <Input type="email" value={form.guardian_email} onChange={(e) => setForm((f) => ({ ...f, guardian_email: e.target.value }))} required />
                </Field>
                <Field label="Phone">
                  <Input value={form.guardian_phone} onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))} />
                </Field>
              </div>

              <Field label="Choose a password" required>
                <Input
                  type="password" minLength={8} value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required placeholder="At least 8 characters"
                />
              </Field>
              <p className="text-xs text-muted-foreground -mt-3">
                This becomes your login for the parent portal, where you'll see attendance, grades, and payments.
              </p>

              <Field label="How would you like to pay?" required>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm ${form.payment_method === "online" ? "border-foreground" : "border-border"}`}>
                    <input type="radio" name="payment_method" checked={form.payment_method === "online"} onChange={() => setForm((f) => ({ ...f, payment_method: "online" }))} />
                    Pay online now
                  </label>
                  <label className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer text-sm ${form.payment_method === "office" ? "border-foreground" : "border-border"}`}>
                    <input type="radio" name="payment_method" checked={form.payment_method === "office"} onChange={() => setForm((f) => ({ ...f, payment_method: "office" }))} />
                    Pay at the office
                  </label>
                </div>
              </Field>

              <Button type="submit" className="w-full h-11" disabled={enrollMut.isPending} style={{ backgroundColor: accent }}>
                {enrollMut.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : form.payment_method === "online" ? (
                  <>Continue to payment</>
                ) : (
                  <><Check className="w-4 h-4 me-2" /> Enroll</>
                )}
              </Button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
