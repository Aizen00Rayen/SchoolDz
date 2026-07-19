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
        toast.success("Plan upgraded");
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

      <div className="surface-card p-6 mb-4">
        <h3 className="font-display font-semibold text-lg mb-1">Public enrollment page</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Share this link so parents can browse your courses and enroll their kids themselves — pick which courses show up from the Courses page.
        </p>
        <div className="flex items-center gap-2 mb-4">
          <Input readOnly value={enrollUrl} className="font-mono text-xs bg-muted/40" />
          <Button
            type="button" variant="outline" size="icon"
            onClick={() => { navigator.clipboard.writeText(enrollUrl); toast.success("Link copied"); }}
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button type="button" variant="outline" size="icon" asChild>
            <a href={enrollUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a>
          </Button>
        </div>
        <Field label="Description shown on the page">
          <Textarea
            value={form.enrollment_description || ""}
            onChange={(e) => setForm({ ...form, enrollment_description: e.target.value })}
            disabled={!canEdit}
            rows={3}
            placeholder="A short welcome message for prospective parents."
          />
        </Field>
      </div>

      <div className="surface-card p-6">
        <h3 className="font-display font-semibold text-lg mb-2">Subscription</h3>
        <p className="text-sm text-muted-foreground mb-1">
          Plan: <span className="capitalize font-medium">{tenant.plan || "—"}</span> · Status:{" "}
          <span className="capitalize font-medium">{tenant.status}</span>
        </p>
        {tenant.plan_expires_at && (
          <p className="text-sm text-muted-foreground mb-4">
            {tenant.status === "active" ? "Renews / expires" : "Expired"} on{" "}
            <span className="font-medium">{new Date(tenant.plan_expires_at).toLocaleDateString()}</span>
            {tenant.billing_cycle && <span className="capitalize"> · {tenant.billing_cycle}</span>}
          </p>
        )}
        <div className="text-xs font-mono text-muted-foreground mb-4">
          {tenant.max_students ?? "Unlimited"} students · {tenant.max_users ?? "Unlimited"} users
        </div>

        {canEdit && tenant.status === "active" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenewOpen(true)} data-testid="settings-renew-button">
              <RefreshCw className="w-3.5 h-3.5 me-2" />
              Extend duration
            </Button>
            {higherPlans.length > 0 && (
              <Button variant="outline" size="sm" onClick={openUpgrade} data-testid="settings-upgrade-button">
                <ArrowUpCircle className="w-3.5 h-3.5 me-2" />
                Upgrade plan
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend your subscription</DialogTitle>
            <DialogDescription>
              Add another billing period to your <span className="capitalize font-medium">{tenant.plan}</span> plan.
              If you renew before it expires, the new period is added on top of your current expiry — no time is lost.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field label="Billing cycle">
              <Select value={renewCycle} onValueChange={setRenewCycle}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <div className="text-sm text-muted-foreground">
              Amount due:{" "}
              <span className="font-semibold text-foreground">
                {renewQuoteQuery.isLoading
                  ? "…"
                  : formatMoney(renewQuoteQuery.data?.amount, renewQuoteQuery.data?.currency)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewOpen(false)}>Cancel</Button>
            <Button
              onClick={() => renewMut.mutate()}
              disabled={renewMut.isPending || renewQuoteQuery.isLoading}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              data-testid="settings-renew-confirm"
            >
              {renewMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Pay & extend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade your plan</DialogTitle>
            <DialogDescription>
              You'll only pay the prorated difference for the time left in your current period — your renewal date
              doesn't change.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field label="New plan">
              <Select value={upgradePlan} onValueChange={setUpgradePlan}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {higherPlans.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="text-sm text-muted-foreground">
              Amount due now:{" "}
              <span className="font-semibold text-foreground">
                {upgradeQuoteQuery.isLoading
                  ? "…"
                  : formatMoney(upgradeQuoteQuery.data?.amount, upgradeQuoteQuery.data?.currency)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)}>Cancel</Button>
            <Button
              onClick={() => upgradeMut.mutate()}
              disabled={upgradeMut.isPending || upgradeQuoteQuery.isLoading || !upgradePlan}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              data-testid="settings-upgrade-confirm"
            >
              {upgradeMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Pay & upgrade"}
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
            {saveMut.isPending ? "Saving…" : t("actions.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
