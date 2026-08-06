import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, Loader2, RefreshCw, ArrowUpCircle, Copy, ExternalLink } from "lucide-react";
import { PageHeader } from "./_shared";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { api, extractError, resolveFileUrl } from "@/lib/api";
import { Field } from "./StudentsPage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const PLAN_ORDER = ["basic", "standard", "premium"];

function formatMoney(amount, currency = "dzd") {
  if (amount == null) return "—";
  return `${amount.toLocaleString()} ${currency.toUpperCase()}`;
}

export default function SettingsPage() {
  const { tenant, user, refreshTenant } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [form, setForm] = useState(tenant || {});
  const fileInputRef = useRef(null);

  const [renewOpen, setRenewOpen] = useState(false);
  const [renewCycle, setRenewCycle] = useState(tenant?.billing_cycle || "monthly");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradePlan, setUpgradePlan] = useState("");

  const higherPlans = PLAN_ORDER.slice(PLAN_ORDER.indexOf(tenant?.plan) + 1);
  const enrollUrl = `${window.location.origin}/enroll/${tenant?.slug || ""}`;

  const renewQuoteQuery = useQuery({
    queryKey: ["billing-renew-quote", renewCycle],
    queryFn: () => api.get(`/billing/renew/quote?billing_cycle=${renewCycle}`).then((r) => r.data),
    enabled: renewOpen,
  });

  const upgradeQuoteQuery = useQuery({
    queryKey: ["billing-upgrade-quote", upgradePlan],
    queryFn: () => api.get(`/billing/upgrade/quote?plan=${upgradePlan}`).then((r) => r.data),
    enabled: upgradeOpen && !!upgradePlan,
  });

  const renewMut = useMutation({
    mutationFn: () => api.post("/billing/renew", { billing_cycle: renewCycle }).then((r) => r.data),
    onSuccess: (data) => {
      if (data.checkout_url) window.location.href = data.checkout_url;
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const upgradeMut = useMutation({
    mutationFn: () => api.post("/billing/upgrade", { plan: upgradePlan }).then((r) => r.data),
    onSuccess: async (data) => {
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else if (data.applied_immediately) {
        toast.success(t("toast.plan_upgraded"));
        await refreshTenant();
        setUpgradeOpen(false);
      }
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openUpgrade = () => {
    setUpgradePlan(higherPlans[0] || "");
    setUpgradeOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => api.patch(`/tenants/${tenant.id}`, form).then((r) => r.data),
    onSuccess: async () => {
      toast.success(t("toast.settings_saved"));
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
      toast.success(t("toast.logo_updated"));
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
      toast.error(t("settings.logo_type_error"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t("settings.logo_size_error"));
      return;
    }
    uploadLogoMut.mutate(file);
  };

  if (!tenant) return null;
  const canEdit = user?.role === "owner" || user?.role === "director" || user?.role === "super_admin";

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("menu.settings")} subtitle={t("settings.subtitle")} />

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">{t("common.workspace")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.name")}>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canEdit} data-testid="settings-name-input" />
          </Field>
          <Field label={t("field.slug")}>
            <Input value={form.slug || ""} disabled className="font-mono" />
          </Field>
          <Field label={t("field.language")}>
            <Select value={form.language || "fr"} onValueChange={(v) => setForm({ ...form, language: v })} disabled={!canEdit}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="fr">Français</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.currency")}>
            <Input value={form.currency || "DZD"} onChange={(e) => setForm({ ...form, currency: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label={t("field.timezone")}>
            <Input value={form.timezone || "Africa/Algiers"} onChange={(e) => setForm({ ...form, timezone: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label={t("field.center_type")}>
            <Input value={form.center_type || "tutoring"} onChange={(e) => setForm({ ...form, center_type: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label={t("field.invoice_prefix")}>
            <Input value={form.invoice_prefix || "INV-"} onChange={(e) => setForm({ ...form, invoice_prefix: e.target.value })} disabled={!canEdit} />
          </Field>
          <Field label={t("field.student_prefix")}>
            <Input value={form.student_prefix || "STU-"} onChange={(e) => setForm({ ...form, student_prefix: e.target.value })} disabled={!canEdit} />
          </Field>
        </div>
      </div>

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-4">{t("settings.branding")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t("field.primary_color")}>
            <Input type="color" value={form.primary_color || "#0A0A0B"} onChange={(e) => setForm({ ...form, primary_color: e.target.value })} disabled={!canEdit} className="h-11" />
          </Field>
          <Field label={t("field.accent_color")}>
            <Input type="color" value={form.accent_color || "#E53935"} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} disabled={!canEdit} className="h-11" />
          </Field>
          <Field label={t("field.logo")}>
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
                {form.logo_url ? t("settings.replace_logo") : t("settings.upload_logo")}
              </Button>
            </div>
          </Field>
        </div>
      </div>

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-1">{t("settings.public_enrollment")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t("settings.public_enrollment_desc")}
        </p>
        <div className="flex items-center gap-2">
          <Input readOnly value={enrollUrl} className="font-mono text-xs bg-muted/40" />
          <Button
            type="button" variant="outline" size="icon"
            onClick={() => { navigator.clipboard.writeText(enrollUrl); toast.success(t("settings.link_copied")); }}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button type="button" variant="outline" size="icon" asChild>
            <a href={enrollUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
          </Button>
        </div>
        {tenant.plan === "premium" && (
          <p className="text-xs text-muted-foreground mt-3">
            {t("settings.website_builder_hint")}
          </p>
        )}
      </div>

      <div className="surface-card p-6">
        <h3 className="font-display font-semibold text-lg mb-2">{t("settings.subscription")}</h3>
        <p className="text-sm text-muted-foreground mb-1">
          {t("settings.plan_label")}: <span className="capitalize font-medium">{tenant.plan ? t(`plan.${tenant.plan}`) : "—"}</span> · {t("settings.status_label")}:{" "}
          <span className="capitalize font-medium">{t(`status.${tenant.status}`)}</span>
        </p>
        {tenant.plan_expires_at && (
          <p className="text-sm text-muted-foreground mb-4">
            {t(tenant.status === "active" ? "settings.renews_on" : "settings.expired_on", { date: new Date(tenant.plan_expires_at).toLocaleDateString() })}
            {tenant.billing_cycle && <span className="capitalize"> · {t(`cycle.${tenant.billing_cycle}`)}</span>}
          </p>
        )}
        <div className="text-xs font-mono text-muted-foreground mb-4">
          {t("settings.students_users_count", {
            students: tenant.max_students ?? t("settings.unlimited"),
            users: tenant.max_users ?? t("settings.unlimited"),
          })}
        </div>

        {canEdit && tenant.status === "active" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenewOpen(true)} data-testid="settings-renew-button">
              <RefreshCw className="w-3.5 h-3.5 me-2" />
              {t("settings.extend_duration")}
            </Button>
            {higherPlans.length > 0 && (
              <Button variant="outline" size="sm" onClick={openUpgrade} data-testid="settings-upgrade-button">
                <ArrowUpCircle className="w-3.5 h-3.5 me-2" />
                {t("calendar.upgrade_plan")}
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.extend_subscription_title")}</DialogTitle>
            <DialogDescription>
              {t("settings.extend_subscription_desc", { plan: tenant.plan ? t(`plan.${tenant.plan}`) : "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field label={t("field.billing_cycle")}>
              <Select value={renewCycle} onValueChange={setRenewCycle}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="monthly">{t("cycle.monthly")}</SelectItem>
                  <SelectItem value="annual">{t("cycle.annual")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="text-sm text-muted-foreground">
              {t("settings.amount_due")}{" "}
              <span className="font-semibold text-foreground">
                {renewQuoteQuery.isLoading
                  ? "…"
                  : formatMoney(renewQuoteQuery.data?.amount, renewQuoteQuery.data?.currency)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>{t("actions.cancel")}</Button>
            <Button
              onClick={() => renewMut.mutate()}
              disabled={renewMut.isPending || renewQuoteQuery.isLoading}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              data-testid="settings-renew-confirm"
            >
              {renewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("settings.pay_extend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.upgrade_plan_title")}</DialogTitle>
            <DialogDescription>
              {t("settings.upgrade_plan_desc")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field label={t("field.new_plan")}>
              <Select value={upgradePlan} onValueChange={setUpgradePlan}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {higherPlans.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{t(`plan.${p}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="text-sm text-muted-foreground">
              {t("settings.amount_due_now")}{" "}
              <span className="font-semibold text-foreground">
                {upgradeQuoteQuery.isLoading
                  ? "…"
                  : formatMoney(upgradeQuoteQuery.data?.amount, upgradeQuoteQuery.data?.currency)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>{t("actions.cancel")}</Button>
            <Button
              onClick={() => upgradeMut.mutate()}
              disabled={upgradeMut.isPending || upgradeQuoteQuery.isLoading || !upgradePlan}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              data-testid="settings-upgrade-confirm"
            >
              {upgradeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("settings.pay_upgrade")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canEdit && (
        <div className="flex justify-end pt-6">
          <Button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            data-testid="settings-save-button"
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {saveMut.isPending ? t("settings.saving") : t("actions.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
