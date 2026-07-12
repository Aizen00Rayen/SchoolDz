import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2 } from "lucide-react";
import { PageHeader } from "./_shared";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { api, extractError, resolveFileUrl } from "@/lib/api";
import { Field } from "./StudentsPage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function SettingsPage() {
  const { tenant, user, refreshTenant } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(tenant || {});
  const fileInputRef = useRef(null);

  const saveMut = useMutation({
    mutationFn: async () => api.patch(`/tenants/${tenant.id}`, form).then((r) => r.data),
    onSuccess: async () => {
      toast.success("Settings saved");
      await refreshTenant();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const uploadLogoMut = useMutation({
    mutationFn: async (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/tenants/${tenant.id}/logo`, body).then((r) => r.data);
    },
    onSuccess: async (updated) => {
      toast.success("Logo updated");
      setForm((f) => ({ ...f, logo_url: updated.logo_url }));
      await refreshTenant();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onLogoSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPEG, WEBP or GIF images are allowed");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be under 3MB");
      return;
    }
    uploadLogoMut.mutate(file);
  };

  if (!tenant) return null;
  const canEdit = user?.role === "owner" || user?.role === "director" || user?.role === "super_admin";

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("menu.settings")} subtitle="Configure your workspace, branding and preferences." />

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">Workspace</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Name">
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} data-testid="settings-name-input" />
          </Field>
          <Field label="Slug">
            <Input value={form.slug || ""} disabled className="font-mono" />
          </Field>
          <Field label="Language">
            <Select value={form.language || "fr"} onValueChange={(v) => setForm({ ...form, language: v })} disabled={!canEdit}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Currency">
            <Input value={form.currency || "DZD"} onChange={(e) => setForm({ ...form, currency: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label="Timezone">
            <Input value={form.timezone || "Africa/Algiers"} onChange={(e) => setForm({ ...form, timezone: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label="Center type">
            <Input value={form.center_type || "tutoring"} onChange={(e) => setForm({ ...form, center_type: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label="Invoice prefix">
            <Input value={form.invoice_prefix || "INV-"} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label="Student prefix">
            <Input value={form.student_prefix || "STU-"} onChange={(e) => setForm({ ...form, student_prefix: e.target.value })} disabled={!canEdit} />
          </Field>
        </div>
      </div>

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">Branding</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Primary color">
            <Input type="color" value={form.primary_color || "#0A0A0B"} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} disabled={!canEdit} className="h-11" />
          </Field>
          <Field label="Accent color">
            <Input type="color" value={form.accent_color || "#E53935"} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} disabled={!canEdit} className="h-11" />
          </Field>
          <Field label="Logo">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-lg border border-border bg-muted grid place-items-center overflow-hidden flex-shrink-0">
                {form.logo_url ? (
                  <img src={resolveFileUrl(form.logo_url)} alt="Logo" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onLogoSelect}
                data-testid="settings-logo-input"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canEdit || uploadLogoMut.isPending}
                onClick={() => fileInputRef.current?.click()}
                data-testid="settings-logo-upload-button"
              >
                {uploadLogoMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 me-2 animate-spin" />
                ) : (
                  <ImagePlus className="w-3.5 h-3.5 me-2" />
                )}
                {form.logo_url ? "Replace logo" : "Upload logo"}
              </Button>
            </div>
          </Field>
        </div>
      </div>

      <div className="surface-card p-6">
        <h3 className="font-display font-semibold text-lg mb-2">Subscription</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Plan: <span className="capitalize font-medium">{tenant.plan}</span> · Status:{" "}
          <span className="capitalize font-medium">{tenant.status}</span>
        </p>
        <div className="text-xs font-mono text-muted-foreground">
          {tenant.max_students} students · {tenant.max_users} users
        </div>
      </div>

      {canEdit && (
        <div className="flex justify-end pt-6">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            data-testid="settings-save-button"
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {saveMut.isPending ? "Saving…" : t("actions.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
