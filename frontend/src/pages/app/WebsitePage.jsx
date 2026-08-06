import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Copy, ExternalLink, Globe, ImagePlus, Loader2, Plus, Trash2,
} from "lucide-react";

import { PageHeader, EmptyState, Field } from "./_shared";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { api, extractError, resolveFileUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const SOCIAL_PLATFORMS = ["facebook", "instagram", "twitter", "youtube", "linkedin", "tiktok"];

/** Small preview box + hidden file input + upload button, reused for the
 * hero image and every gallery/course/teacher photo slot. Owns its own
 * input ref so many instances can coexist on one page. */
function ImageUploadSlot({ url, onUpload, uploading, label, rounded = "rounded-lg" }) {
  const inputRef = useRef(null);
  const { t } = useI18n();

  const onSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error(t("settings.logo_type_error"));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t("settings.logo_size_error"));
      return;
    }
    onUpload(file);
  };

  return (
    <div className="flex items-center gap-3">
      <div className={`w-14 h-14 border border-border bg-muted grid place-items-center overflow-hidden flex-shrink-0 ${rounded}`}>
        {url ? (
          <img src={resolveFileUrl(url)} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onSelect} />
      <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (label || t("website.upload_photo"))}
      </Button>
    </div>
  );
}

export default function WebsitePage() {
  const { tenant, user, refreshTenant } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(tenant || {});

  const isPremium = tenant?.plan === "premium";
  const canEdit = user?.role === "owner" || user?.role === "director" || user?.role === "super_admin";
  const siteUrl = `${window.location.origin}/enroll/${tenant?.slug || ""}`;

  const { data: gallery } = useQuery({
    queryKey: ["website-gallery"],
    queryFn: async () => (await api.get(`/tenants/${tenant.id}/gallery`)).data,
    enabled: isPremium,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
    enabled: isPremium,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
    enabled: isPremium,
  });

  const saveMut = useMutation({
    mutationFn: async () => api.patch(`/tenants/${tenant.id}`, form).then((r) => r.data),
    onSuccess: async () => {
      toast.success(t("toast.settings_saved"));
      await refreshTenant();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const uploadHeroMut = useMutation({
    mutationFn: async (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/tenants/${tenant.id}/hero-image`, body).then((r) => r.data);
    },
    onSuccess: async (updated) => {
      setForm((f) => ({ ...f, hero_image_url: updated.hero_image_url }));
      await refreshTenant();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const uploadGalleryMut = useMutation({
    mutationFn: async (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/tenants/${tenant.id}/gallery`, body).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-gallery"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteGalleryMut = useMutation({
    mutationFn: (photoId) => api.delete(`/tenants/${tenant.id}/gallery/${photoId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-gallery"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const reorderGalleryMut = useMutation({
    mutationFn: ({ photoId, swapWithId }) =>
      api.patch(`/tenants/${tenant.id}/gallery/${photoId}`, { swap_with_id: swapWithId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["website-gallery"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const toggleCourseMut = useMutation({
    mutationFn: ({ id, show_on_enrollment }) => api.patch(`/courses/${id}`, { show_on_enrollment }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses-list"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const uploadCoursePhotoMut = useMutation({
    mutationFn: ({ id, file }) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/courses/${id}/photo`, body).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["courses-list"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const toggleTeacherMut = useMutation({
    mutationFn: ({ id, show_on_website }) => api.patch(`/teachers/${id}`, { show_on_website }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers-list"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  const uploadTeacherPhotoMut = useMutation({
    mutationFn: ({ id, file }) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/teachers/${id}/photo`, body).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers-list"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  if (!tenant) return null;

  if (!isPremium) {
    return (
      <div>
        <PageHeader title={t("menu.website")} subtitle={t("subtitle.website")} />
        <EmptyState
          icon={Globe}
          title={t("website.premium_feature_title")}
          description={t("website.premium_feature_desc")}
          action={
            <a href="/app/settings">
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("calendar.upgrade_plan")}
              </Button>
            </a>
          }
        />
      </div>
    );
  }

  const galleryItems = gallery?.items || [];
  const courseItems = courses?.items || [];
  const teacherItems = teachers?.items || [];

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t("menu.website")}
        subtitle={t("subtitle.website")}
        actions={
          <>
            <Button type="button" variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(siteUrl); toast.success(t("settings.link_copied")); }}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <a href={siteUrl} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline">
                <ExternalLink className="w-3.5 h-3.5 me-2" /> {t("website.preview")}
              </Button>
            </a>
          </>
        }
      />

      {/* About */}
      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">{t("website.about")}</h3>
        <div className="mb-4">
          <Field label={t("website.hero_image")}>
            <ImageUploadSlot
              url={form.hero_image_url}
              uploading={uploadHeroMut.isPending}
              onUpload={(file) => uploadHeroMut.mutate(file)}
              rounded="rounded-xl"
            />
          </Field>
        </div>
        <Field label={t("field.description_enrollment")}>
          <Textarea
            value={form.enrollment_description || ""}
            onChange={(e) => setForm({ ...form, enrollment_description: e.target.value })}
            disabled={!canEdit}
            rows={3}
            placeholder={t("settings.enrollment_welcome_placeholder")}
          />
        </Field>
      </div>

      {/* Location & contact */}
      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">{t("website.location")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label={t("website.address")}>
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} disabled={!canEdit} />
            </Field>
          </div>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label={t("website.map_url")}>
            <Input value={form.map_url || ""} onChange={(e) => setForm({ ...form, map_url: e.target.value })} disabled={!canEdit} placeholder="https://maps.google.com/…" />
          </Field>
        </div>
      </div>

      {/* Social media */}
      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">{t("website.social_media")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SOCIAL_PLATFORMS.map((platform) => (
            <Field key={platform} label={t(`website.social.${platform}`)}>
              <Input
                value={form.social_links?.[platform] || ""}
                onChange={(e) => setForm({ ...form, social_links: { ...form.social_links, [platform]: e.target.value } })}
                disabled={!canEdit}
                placeholder={`https://${platform}.com/…`}
              />
            </Field>
          ))}
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end pt-2 pb-6">
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
            {saveMut.isPending ? t("settings.saving") : t("actions.save")}
          </Button>
        </div>
      )}

      {/* Gallery */}
      <div className="surface-card p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg">{t("website.gallery")}</h3>
          <ImageUploadSlot
            url={null}
            uploading={uploadGalleryMut.isPending}
            onUpload={(file) => uploadGalleryMut.mutate(file)}
            label={<><Plus className="w-3.5 h-3.5 me-1.5" /> {t("website.add_photo")}</>}
          />
        </div>
        {galleryItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">{t("website.no_photos")}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {galleryItems.map((p, i) => (
              <div key={p.id} className="relative rounded-lg overflow-hidden border border-border group">
                <img src={resolveFileUrl(p.image_url)} alt={p.caption || ""} className="w-full h-28 object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                  {i > 0 && (
                    <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => reorderGalleryMut.mutate({ photoId: p.id, swapWithId: galleryItems[i - 1].id })}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {i < galleryItems.length - 1 && (
                    <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => reorderGalleryMut.mutate({ photoId: p.id, swapWithId: galleryItems[i + 1].id })}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="destructive" className="h-7 w-7" onClick={() => deleteGalleryMut.mutate(p.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Courses */}
      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-1">{t("website.courses")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t("website.courses_desc")}</p>
        <div className="space-y-3">
          {courseItems.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <ImageUploadSlot
                url={c.image_url}
                uploading={uploadCoursePhotoMut.isPending}
                onUpload={(file) => uploadCoursePhotoMut.mutate({ id: c.id, file })}
                label={t("website.upload_photo")}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.title}</div>
              </div>
              <Switch
                checked={!!c.show_on_enrollment}
                onCheckedChange={(v) => toggleCourseMut.mutate({ id: c.id, show_on_enrollment: v })}
              />
            </div>
          ))}
          {courseItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t("website.no_courses")}</p>}
        </div>
      </div>

      {/* Teachers */}
      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-1">{t("website.teachers")}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t("website.teachers_desc")}</p>
        <div className="space-y-3">
          {teacherItems.map((tch) => (
            <div key={tch.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <ImageUploadSlot
                url={tch.photo_url}
                uploading={uploadTeacherPhotoMut.isPending}
                onUpload={(file) => uploadTeacherPhotoMut.mutate({ id: tch.id, file })}
                label={t("website.upload_photo")}
                rounded="rounded-full"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{tch.first_name} {tch.last_name}</div>
              </div>
              <Switch
                checked={!!tch.show_on_website}
                onCheckedChange={(v) => toggleTeacherMut.mutate({ id: tch.id, show_on_website: v })}
              />
            </div>
          ))}
          {teacherItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">{t("website.no_teachers")}</p>}
        </div>
      </div>
    </div>
  );
}
