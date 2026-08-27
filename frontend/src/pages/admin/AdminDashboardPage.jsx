import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowUpRight, Building2, CalendarClock, Crown, GraduationCap, Link2, LogOut, Moon, Sun, Tag,
  ShieldCheck, Trash2, Users, Wallet, PowerOff, Power, Pencil, Plus,
} from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusPill, isoToLocalInput, localInputToIso } from "@/pages/app/_shared";

const COUPON_PLANS = ["basic", "standard", "premium"];
const EMPTY_COUPON_FORM = {
  code: "", description: "", discount_type: "percent", discount_value: 10,
  applicable_plans: [], max_redemptions: "", starts_at: "", expires_at: "", active: true,
};

const DURATION_PRESETS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];
const EMPTY_TENANT_FORM = {
  name: "", slug: "", center_type: "tutoring",
  owner_mode: "new", owner_name: "", owner_email: "", owner_password: "", link_to_owner_email: "",
  plan: "premium", duration_days: 30,
};

// "" for owner_email means "set/keep this owner's principal school as-is" —
// the ownership dialog always requires an owner_email though (unlike the
// subscription dialog's "leave field blank to skip" convention), since
// linking without knowing which owner to link to is meaningless.
const EMPTY_OWNERSHIP_FORM = { owner_email: "", is_primary: false };

// "" for plan means "leave the tenant's current plan alone" — the endpoint
// treats an absent plan as no-change, so the admin can extend time without
// being forced to restate the tier.
const EMPTY_SUBSCRIPTION_FORM = {
  plan: "", billing_cycle: "", mode: "extend", extend_days: 30, expires_at: "",
};

const USER_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "director", label: "Director" },
  { value: "secretary", label: "Secretary" },
  { value: "accountant", label: "Accountant" },
  { value: "teacher", label: "Teacher" },
  { value: "parent", label: "Parent" },
  { value: "student", label: "Student" },
];

export default function AdminDashboardPage() {
  const { user, tenant, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();

  useEffect(() => {
    if (user && user.role !== "super_admin") {
      toast.error("Admin access only");
      nav("/", { replace: true });
    }
  }, [user, nav]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-platform"],
    queryFn: async () => (await api.get("/admin/platform-summary")).data,
    enabled: user?.role === "super_admin",
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) =>
      api.patch(`/admin/tenants/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/admin/tenants/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("Tenant deleted");
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  // Plan / subscription-duration control. Separate from statusMut above:
  // that one is a moderation switch (suspend/reactivate), this one is the
  // billing lever — change tier, add time, or set an exact end date.
  // `subOpen` is deliberately separate from `subTenant` rather than deriving
  // open={!!subTenant}: clearing the tenant on save would unmount the dialog's
  // content in the same tick the dialog starts closing, and Radix then never
  // gets to undo the `pointer-events: none` it puts on <body> for a modal —
  // leaving the whole page unclickable. Same shape as the tenant/coupon
  // dialogs above.
  const [subOpen, setSubOpen] = useState(false);
  const [subTenant, setSubTenant] = useState(null);
  const [subForm, setSubForm] = useState(EMPTY_SUBSCRIPTION_FORM);

  const openSubscription = (tt) => {
    setSubTenant(tt);
    setSubOpen(true);
    setSubForm({
      ...EMPTY_SUBSCRIPTION_FORM,
      plan: tt.plan || "",
      billing_cycle: tt.billing_cycle || "",
      expires_at: tt.plan_expires_at ? isoToLocalInput(tt.plan_expires_at) : "",
    });
  };

  const subscriptionMut = useMutation({
    mutationFn: ({ id, payload }) =>
      api.patch(`/admin/tenants/${id}/subscription`, payload).then((r) => r.data),
    onSuccess: (updated) => {
      toast.success(
        updated?.plan_expires_at
          ? `Subscription updated — expires ${new Date(updated.plan_expires_at).toLocaleDateString()}`
          : "Subscription updated",
      );
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
      setSubOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const submitSubscription = (e) => {
    e.preventDefault();
    const payload = {};
    if (subForm.plan && subForm.plan !== subTenant.plan) payload.plan = subForm.plan;
    if (subForm.billing_cycle && subForm.billing_cycle !== subTenant.billing_cycle) {
      payload.billing_cycle = subForm.billing_cycle;
    }
    if (subForm.mode === "extend") {
      const days = parseInt(subForm.extend_days, 10);
      if (days > 0) payload.extend_days = days;
    } else if (subForm.expires_at) {
      payload.expires_at = localInputToIso(subForm.expires_at);
    }
    if (Object.keys(payload).length === 0) {
      toast.error("Nothing to change");
      return;
    }
    subscriptionMut.mutate({ id: subTenant.id, payload });
  };

  const [tenantOpen, setTenantOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState(EMPTY_TENANT_FORM);

  const openNewTenant = () => {
    setTenantForm(EMPTY_TENANT_FORM);
    setTenantOpen(true);
  };

  const createTenantMut = useMutation({
    mutationFn: (payload) => api.post("/tenants", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("Workspace created");
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
      setTenantOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const submitTenant = (e) => {
    e.preventDefault();
    const { owner_mode, owner_name, owner_email, owner_password, link_to_owner_email, ...rest } = tenantForm;
    const payload = {
      ...rest,
      slug: tenantForm.slug.trim().toLowerCase(),
      duration_days: parseInt(tenantForm.duration_days, 10) || 30,
    };
    if (owner_mode === "link") {
      payload.link_to_owner_email = link_to_owner_email.trim().toLowerCase();
    } else {
      payload.owner_name = owner_name;
      payload.owner_email = owner_email;
      payload.owner_password = owner_password;
    }
    createTenantMut.mutate(payload);
  };

  // Ownership dialog — links a workspace (new or already-existing) to an
  // existing owner/director account and/or marks it as that owner's
  // principal school. Same open/tenant-separate-from-open shape as the
  // subscription dialog above, for the same Radix pointer-events reason.
  const [ownershipOpen, setOwnershipOpen] = useState(false);
  const [ownershipTenant, setOwnershipTenant] = useState(null);
  const [ownershipForm, setOwnershipForm] = useState(EMPTY_OWNERSHIP_FORM);

  const openOwnership = (tt) => {
    setOwnershipTenant(tt);
    setOwnershipOpen(true);
    setOwnershipForm({ owner_email: tt.owner_email || "", is_primary: !!tt.is_primary_school });
  };

  const ownershipMut = useMutation({
    mutationFn: ({ id, payload }) =>
      api.patch(`/admin/tenants/${id}/ownership`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("Ownership updated");
      qc.invalidateQueries({ queryKey: ["admin-platform"] });
      setOwnershipOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const submitOwnership = (e) => {
    e.preventDefault();
    const owner_email = ownershipForm.owner_email.trim().toLowerCase();
    if (!owner_email) {
      toast.error("Owner email is required");
      return;
    }
    ownershipMut.mutate({ id: ownershipTenant.id, payload: { owner_email, is_primary: ownershipForm.is_primary } });
  };

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get("/users")).data,
    enabled: user?.role === "super_admin",
  });

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", role: "secretary" });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, is_active }) =>
      api.patch(`/users/${id}`, { is_active }).then((r) => r.data),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const updateUserMut = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/users/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("User updated");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditingUser(null);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteUserMut = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("User removed");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const { data: couponsData, isLoading: couponsLoading } = useQuery({
    queryKey: ["admin-coupons"],
    queryFn: async () => (await api.get("/coupons")).data,
    enabled: user?.role === "super_admin",
  });

  const [couponOpen, setCouponOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState(null);
  const [couponForm, setCouponForm] = useState(EMPTY_COUPON_FORM);

  const openNewCoupon = () => {
    setEditingCoupon(null);
    setCouponForm(EMPTY_COUPON_FORM);
    setCouponOpen(true);
  };

  const openEditCoupon = (c) => {
    setEditingCoupon(c);
    setCouponForm({
      code: c.code, description: c.description || "", discount_type: c.discount_type,
      discount_value: c.discount_value, applicable_plans: c.applicable_plans || [],
      max_redemptions: c.max_redemptions ?? "", starts_at: isoToLocalInput(c.starts_at),
      expires_at: isoToLocalInput(c.expires_at), active: c.active,
    });
    setCouponOpen(true);
  };

  const saveCouponMut = useMutation({
    mutationFn: (payload) =>
      editingCoupon
        ? api.patch(`/coupons/${editingCoupon.id}`, payload).then((r) => r.data)
        : api.post("/coupons", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(editingCoupon ? "Coupon updated" : "Coupon created");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
      setCouponOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteCouponMut = useMutation({
    mutationFn: (id) => api.delete(`/coupons/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("Coupon deleted");
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const toggleCouponActiveMut = useMutation({
    mutationFn: ({ id, active }) => api.patch(`/coupons/${id}`, { active }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const submitCoupon = (e) => {
    e.preventDefault();
    const payload = {
      ...couponForm,
      code: couponForm.code.trim().toUpperCase(),
      discount_value: parseFloat(couponForm.discount_value) || 0,
      max_redemptions: couponForm.max_redemptions === "" ? null : parseInt(couponForm.max_redemptions, 10),
      starts_at: localInputToIso(couponForm.starts_at) || null,
      expires_at: localInputToIso(couponForm.expires_at) || null,
    };
    saveCouponMut.mutate(payload);
  };

  if (!user || user.role !== "super_admin") return null;

  const kpis = data?.kpis || {};
  const tenants = data?.tenants || [];
  const tenantNameById = Object.fromEntries(tenants.map((tt) => [tt.id, tt.name]));
  const platformUsers = (usersData?.items || []).filter((u) => u.role !== "super_admin");
  const coupons = couponsData?.items || [];

  const openEdit = (u) => {
    setEditingUser(u);
    setEditForm({ name: u.name || "", email: u.email || "", phone: u.phone || "", role: u.role || "secretary" });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="border-b border-border glass-nav sticky top-0 z-30">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 h-14">
          <Link to="/" className="flex items-center gap-2" data-testid="admin-logo-link">
            <div className="w-7 h-7 bg-accent rounded grid place-items-center">
              <ShieldCheck className="w-4 h-4 text-accent-foreground" />
            </div>
            <div>
              <div className="font-display font-bold text-sm leading-tight">
                scolaris <span className="text-accent">/ admin</span>
              </div>
              <div className="text-[10px] font-mono text-muted-foreground leading-tight">
                platform console
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggle} data-testid="admin-theme-toggle">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <span className="hidden md:inline-flex items-center gap-2 text-xs font-mono text-muted-foreground border border-border rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              {user.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                nav("/", { replace: true });
                setTimeout(() => {
                  logout();
                }, 50);
              }}
              data-testid="admin-logout-button"
              className="text-destructive border-destructive/30 hover:bg-destructive/10 whitespace-nowrap flex-shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 me-2" />
              {t("common.logout")}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {/* Page header */}
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent mb-2">
            Super admin
          </p>
          <h1 className="font-display text-4xl md:text-5xl font-black tracking-tighter mb-2">
            {t("admin.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("admin.subtitle")}
          </p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <KpiCard
            icon={Building2}
            label={t("admin.tenants.total")}
            value={kpis.tenants_total ?? 0}
            sub={`${kpis.tenants_active ?? 0} ${t("admin.tenants.active")} · ${kpis.tenants_pending_payment ?? 0} ${t("admin.tenants.pending")}`}
            accent
            testid="admin-kpi-tenants"
          />
          <KpiCard icon={Users} label={t("admin.users_total")} value={kpis.users_total ?? 0} testid="admin-kpi-users" />
          <KpiCard icon={GraduationCap} label={t("admin.students_total")} value={kpis.students_total ?? 0} testid="admin-kpi-students" />
          <KpiCard
            icon={Wallet}
            label={t("admin.revenue")}
            value={`${Math.round(kpis.platform_revenue ?? 0).toLocaleString()} DZD`}
            testid="admin-kpi-revenue"
          />
        </div>

        {/* Tenants table */}
        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-display font-semibold text-lg">{t("admin.tenants")}</h3>
              <p className="text-xs text-muted-foreground">
                {tenants.length} {tenants.length === 1 ? "workspace" : "workspaces"} on the platform
              </p>
            </div>
            <Button size="sm" onClick={openNewTenant} data-testid="admin-tenant-new" className="bg-accent hover:bg-accent/90 text-accent-foreground">
              <Plus className="w-3.5 h-3.5 me-1.5" /> New workspace
            </Button>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">{t("actions.loading")}</div>
          ) : tenants.length === 0 ? (
            <div className="p-12 text-center">
              <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <div className="text-sm text-muted-foreground">No tenants yet</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Workspace</Th>
                    <Th>Slug</Th>
                    <Th>Owner</Th>
                    <Th>Plan</Th>
                    <Th>Status</Th>
                    <Th>Expires</Th>
                    <Th>Users</Th>
                    <Th>Students</Th>
                    <Th>Created</Th>
                    <Th className="text-end">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((tt, i) => (
                    <motion.tr
                      key={tt.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      data-testid={`admin-tenant-row-${tt.id}`}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded bg-primary grid place-items-center flex-shrink-0">
                            <span className="font-display font-black text-primary-foreground text-xs">
                              {(tt.name || "S")[0].toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{tt.name}</div>
                            <div className="text-[10px] text-muted-foreground capitalize">
                              {tt.center_type}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{tt.slug}</td>
                      <td className="px-4 py-3">
                        {tt.owner_email ? (
                          <div className="flex items-center gap-1.5">
                            {tt.is_primary_school && (
                              <Crown className="w-3 h-3 text-accent flex-shrink-0" aria-label="Principal school" />
                            )}
                            <div className="min-w-0">
                              <div className="text-xs truncate max-w-[160px]">{tt.owner_email}</div>
                              {tt.linked_schools_count > 1 && (
                                <div className="text-[10px] text-muted-foreground">{tt.linked_schools_count} schools</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">
                          {tt.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={tt.status} /></td>
                      <td className="px-4 py-3 text-xs">
                        {tt.plan_expires_at ? (() => {
                          const days = Math.ceil(
                            (new Date(tt.plan_expires_at) - Date.now()) / 86400000,
                          );
                          const tone = days < 0
                            ? "text-destructive"
                            : days <= 7
                              ? "text-warning"
                              : "text-muted-foreground";
                          return (
                            <div>
                              <div className="font-mono">
                                {new Date(tt.plan_expires_at).toLocaleDateString()}
                              </div>
                              <div className={`text-[10px] ${tone}`}>
                                {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                              </div>
                            </div>
                          );
                        })() : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{tt.users_count ?? 0}</td>
                      <td className="px-4 py-3 font-mono text-xs">{tt.students_count ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(tt.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm" variant="outline"
                            onClick={() => openSubscription(tt)}
                            data-testid={`admin-subscription-${tt.id}`}
                            className="h-8 text-xs"
                          >
                            <CalendarClock className="w-3 h-3 me-1" />
                            Plan &amp; duration
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            onClick={() => openOwnership(tt)}
                            data-testid={`admin-ownership-${tt.id}`}
                            className="h-8 text-xs"
                          >
                            <Link2 className="w-3 h-3 me-1" />
                            Ownership
                          </Button>
                          {tt.status !== "suspended" ? (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => statusMut.mutate({ id: tt.id, status: "suspended" })}
                              data-testid={`admin-suspend-${tt.id}`}
                              className="h-8 text-xs text-warning border-warning/30 hover:bg-warning/10"
                            >
                              <PowerOff className="w-3 h-3 me-1" />
                              {t("admin.actions.suspend")}
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => statusMut.mutate({ id: tt.id, status: "active" })}
                              data-testid={`admin-activate-${tt.id}`}
                              className="h-8 text-xs text-success border-success/30 hover:bg-success/10"
                            >
                              <Power className="w-3 h-3 me-1" />
                              {t("admin.actions.activate")}
                            </Button>
                          )}
                          <Button
                            size="icon" variant="ghost"
                            onClick={async () => {
                              if (await confirm({
                                title: t("admin.confirm.delete"),
                                confirmLabel: t("admin.actions.delete") || "Delete",
                                destructive: true,
                              })) {
                                deleteMut.mutate(tt.id);
                              }
                            }}
                            data-testid={`admin-delete-${tt.id}`}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Users table */}
        <div className="surface-card overflow-hidden mt-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-display font-semibold text-lg">{t("admin.users.title")}</h3>
              <p className="text-xs text-muted-foreground">
                {platformUsers.length} {platformUsers.length === 1 ? "user" : "users"} across every workspace
              </p>
            </div>
          </div>

          {usersLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">{t("actions.loading")}</div>
          ) : platformUsers.length === 0 ? (
            <div className="p-12 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <div className="text-sm text-muted-foreground">No users yet</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Workspace</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th className="text-end">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {platformUsers.map((u, i) => (
                    <motion.tr
                      key={u.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                      data-testid={`admin-user-row-${u.id}`}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">{u.name}</td>
                      <td className="px-4 py-3 text-xs">{u.email}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {tenantNameById[u.tenant_id] || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{u.role}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={u.is_active === false ? "suspended" : "active"} />
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="inline-flex items-center gap-1">
                          {u.is_active === false ? (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => toggleActiveMut.mutate({ id: u.id, is_active: true })}
                              data-testid={`admin-user-activate-${u.id}`}
                              className="h-8 text-xs text-success border-success/30 hover:bg-success/10"
                            >
                              <Power className="w-3 h-3 me-1" />
                              {t("admin.actions.activate")}
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => toggleActiveMut.mutate({ id: u.id, is_active: false })}
                              data-testid={`admin-user-pause-${u.id}`}
                              className="h-8 text-xs text-warning border-warning/30 hover:bg-warning/10"
                            >
                              <PowerOff className="w-3 h-3 me-1" />
                              {t("admin.actions.pause")}
                            </Button>
                          )}
                          <Button
                            size="icon" variant="ghost"
                            onClick={() => openEdit(u)}
                            data-testid={`admin-user-edit-${u.id}`}
                            className="h-8 w-8"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            onClick={async () => {
                              if (await confirm({
                                title: t("admin.confirm.remove_user"),
                                confirmLabel: t("admin.actions.delete") || "Delete",
                                destructive: true,
                              })) {
                                deleteUserMut.mutate(u.id);
                              }
                            }}
                            data-testid={`admin-user-delete-${u.id}`}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Coupons */}
        <div className="surface-card overflow-hidden mt-8">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 className="font-display font-semibold text-lg">Coupons</h3>
              <p className="text-xs text-muted-foreground">
                {coupons.length} {coupons.length === 1 ? "coupon" : "coupons"} · redeemable at signup checkout
              </p>
            </div>
            <Button size="sm" onClick={openNewCoupon} data-testid="admin-coupon-new" className="bg-accent hover:bg-accent/90 text-accent-foreground">
              <Plus className="w-3.5 h-3.5 me-1.5" /> New coupon
            </Button>
          </div>

          {couponsLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">{t("actions.loading")}</div>
          ) : coupons.length === 0 ? (
            <div className="p-12 text-center">
              <Tag className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <div className="text-sm text-muted-foreground">No coupons yet</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Code</Th>
                    <Th>Discount</Th>
                    <Th>Plans</Th>
                    <Th>Redeemed</Th>
                    <Th>Window</Th>
                    <Th>Status</Th>
                    <Th className="text-end">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((c, i) => (
                    <motion.tr
                      key={c.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      data-testid={`admin-coupon-row-${c.id}`}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-medium">{c.code}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {c.discount_type === "percent" ? `${c.discount_value}%` : `${Number(c.discount_value).toLocaleString()} DZD`}
                      </td>
                      <td className="px-4 py-3">
                        {c.applicable_plans && c.applicable_plans.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {c.applicable_plans.map((p) => (
                              <span key={p} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted capitalize">{p}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">All plans</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {c.times_redeemed}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ""}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {c.starts_at || c.expires_at ? (
                          <>
                            {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : "…"}
                            {" → "}
                            {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "…"}
                          </>
                        ) : (
                          "Always"
                        )}
                      </td>
                      <td className="px-4 py-3"><StatusPill status={c.active ? "active" : "inactive"} /></td>
                      <td className="px-4 py-2 text-end">
                        <div className="inline-flex items-center gap-1">
                          {c.active ? (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => toggleCouponActiveMut.mutate({ id: c.id, active: false })}
                              className="h-8 text-xs text-warning border-warning/30 hover:bg-warning/10"
                            >
                              <PowerOff className="w-3 h-3 me-1" /> Disable
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => toggleCouponActiveMut.mutate({ id: c.id, active: true })}
                              className="h-8 text-xs text-success border-success/30 hover:bg-success/10"
                            >
                              <Power className="w-3 h-3 me-1" /> Enable
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" onClick={() => openEditCoupon(c)} className="h-8 w-8">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            onClick={async () => {
                              if (await confirm({ title: `Delete coupon ${c.code}?`, confirmLabel: "Delete", destructive: true })) {
                                deleteCouponMut.mutate(c.id);
                              }
                            }}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Edit user dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("admin.users.edit_title")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {editingUser?.email}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editingUser) return;
              updateUserMut.mutate({ id: editingUser.id, payload: editForm });
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="edit-name">Full name</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
                data-testid="admin-user-form-name"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  required
                  data-testid="admin-user-form-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  data-testid="admin-user-form-phone"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v })}>
                <SelectTrigger className="bg-background" data-testid="admin-user-form-role"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {USER_ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={updateUserMut.isPending}
                data-testid="admin-user-form-submit"
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* New workspace dialog — creates the tenant + owner account directly
          (bypasses Chargily entirely), optionally granting a plan for a
          duration you pick. The tenant's existing renew/upgrade flows work
          unmodified afterwards since this just populates the same
          plan/status/plan_expires_at fields Chargily checkouts would. */}
      <Dialog open={tenantOpen} onOpenChange={setTenantOpen}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New workspace</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Creates the workspace and owner account directly — no payment required.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitTenant} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tenant-name">Workspace name</Label>
                <Input
                  id="tenant-name"
                  value={tenantForm.name}
                  onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                  required
                  data-testid="admin-tenant-form-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-slug">Slug</Label>
                <Input
                  id="tenant-slug"
                  value={tenantForm.slug}
                  onChange={(e) => setTenantForm({ ...tenantForm, slug: e.target.value })}
                  placeholder="my-school"
                  required
                  data-testid="admin-tenant-form-slug"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Owner</Label>
              <div className="inline-flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setTenantForm({ ...tenantForm, owner_mode: "new" })}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    tenantForm.owner_mode === "new" ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  data-testid="admin-tenant-owner-mode-new"
                >
                  New owner account
                </button>
                <button
                  type="button"
                  onClick={() => setTenantForm({ ...tenantForm, owner_mode: "link" })}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    tenantForm.owner_mode === "link" ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  data-testid="admin-tenant-owner-mode-link"
                >
                  Link to existing owner
                </button>
              </div>
            </div>

            {tenantForm.owner_mode === "link" ? (
              <div className="space-y-2">
                <Label htmlFor="tenant-link-owner-email">Existing owner's email</Label>
                <Input
                  id="tenant-link-owner-email"
                  type="email"
                  value={tenantForm.link_to_owner_email}
                  onChange={(e) => setTenantForm({ ...tenantForm, link_to_owner_email: e.target.value })}
                  placeholder="owner@theirotherschool.com"
                  required
                  data-testid="admin-tenant-form-link-owner-email"
                />
                <p className="text-xs text-muted-foreground">
                  Must already be an owner/director account. This workspace joins their "my schools" list — their active workspace doesn't change until they switch to it themselves.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tenant-owner-name">Owner name</Label>
                    <Input
                      id="tenant-owner-name"
                      value={tenantForm.owner_name}
                      onChange={(e) => setTenantForm({ ...tenantForm, owner_name: e.target.value })}
                      required
                      data-testid="admin-tenant-form-owner-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-owner-email">Owner email</Label>
                    <Input
                      id="tenant-owner-email"
                      type="email"
                      value={tenantForm.owner_email}
                      onChange={(e) => setTenantForm({ ...tenantForm, owner_email: e.target.value })}
                      required
                      data-testid="admin-tenant-form-owner-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tenant-owner-password">Owner password</Label>
                  <Input
                    id="tenant-owner-password"
                    type="password"
                    minLength={8}
                    value={tenantForm.owner_password}
                    onChange={(e) => setTenantForm({ ...tenantForm, owner_password: e.target.value })}
                    placeholder="At least 8 characters"
                    required
                    data-testid="admin-tenant-form-owner-password"
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Plan</Label>
                <Select
                  value={tenantForm.plan}
                  onValueChange={(v) => setTenantForm({ ...tenantForm, plan: v })}
                >
                  <SelectTrigger className="bg-background" data-testid="admin-tenant-form-plan"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tenant-duration">Duration (days)</Label>
                <Input
                  id="tenant-duration"
                  type="number" min={1}
                  value={tenantForm.duration_days}
                  onChange={(e) => setTenantForm({ ...tenantForm, duration_days: e.target.value })}
                  data-testid="admin-tenant-form-duration"
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <Button
                  key={p.days} type="button" size="sm" variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setTenantForm({ ...tenantForm, duration_days: p.days })}
                >
                  {p.label}
                </Button>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setTenantOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createTenantMut.isPending}
                data-testid="admin-tenant-form-submit"
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {createTenantMut.isPending ? "Creating…" : "Create workspace"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ownership dialog — links a workspace to an existing owner/director
          account (creating the workspace-switcher membership if there isn't
          one yet) and/or marks it as that owner's principal school. */}
      <Dialog open={ownershipOpen} onOpenChange={setOwnershipOpen}>
        <DialogContent className="max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Ownership</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {ownershipTenant?.name} — link this workspace to an owner account and/or mark it as their principal school.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitOwnership} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ownership-email">Owner's email</Label>
              <Input
                id="ownership-email"
                type="email"
                value={ownershipForm.owner_email}
                onChange={(e) => setOwnershipForm({ ...ownershipForm, owner_email: e.target.value })}
                placeholder="owner@example.com"
                required
                data-testid="admin-ownership-form-email"
              />
              <p className="text-xs text-muted-foreground">
                Must be an existing owner/director account. If they don't already hold a membership on this workspace, one is created.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={ownershipForm.is_primary}
                onCheckedChange={(v) => setOwnershipForm({ ...ownershipForm, is_primary: !!v })}
                data-testid="admin-ownership-form-primary"
              />
              Set as this owner's principal school
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOwnershipOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={ownershipMut.isPending}
                data-testid="admin-ownership-form-submit"
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {ownershipMut.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Plan & subscription-duration dialog */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Plan &amp; duration</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {subTenant?.name} — currently{" "}
              <span className="font-medium capitalize">{subTenant?.plan || "no plan"}</span>
              {subTenant?.plan_expires_at
                ? `, expiring ${new Date(subTenant.plan_expires_at).toLocaleDateString()}`
                : ", no expiry set"}
            </DialogDescription>
          </DialogHeader>

          {subTenant && (
            <form onSubmit={submitSubscription} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Plan</Label>
                  <Select
                    value={subForm.plan || "__keep"}
                    onValueChange={(v) => setSubForm({ ...subForm, plan: v === "__keep" ? "" : v })}
                  >
                    <SelectTrigger className="bg-background" data-testid="admin-sub-plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="__keep">Keep current</SelectItem>
                      {COUPON_PLANS.map((pl) => (
                        <SelectItem key={pl} value={pl} className="capitalize">{pl}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Billing cycle</Label>
                  <Select
                    value={subForm.billing_cycle || "__keep"}
                    onValueChange={(v) => setSubForm({ ...subForm, billing_cycle: v === "__keep" ? "" : v })}
                  >
                    <SelectTrigger className="bg-background" data-testid="admin-sub-cycle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="__keep">Keep current</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Plain buttons rather than a Select: a two-option switch that
                  drives which field below is active should be visible at a
                  glance, not hidden behind a dropdown. */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Duration</Label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "extend", label: "Add time" },
                    { key: "absolute", label: "Set end date" },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setSubForm({ ...subForm, mode: m.key })}
                      data-testid={`admin-sub-mode-${m.key}`}
                      className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                        subForm.mode === m.key
                          ? "border-accent bg-accent text-accent-foreground"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {subForm.mode === "extend" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Days to add</Label>
                  <Input
                    type="number" min={1} max={3650}
                    value={subForm.extend_days}
                    onChange={(e) => setSubForm({ ...subForm, extend_days: e.target.value })}
                    data-testid="admin-sub-days"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {DURATION_PRESETS.map((pr) => (
                      <button
                        key={pr.days}
                        type="button"
                        onClick={() => setSubForm({ ...subForm, extend_days: pr.days })}
                        className="text-[11px] px-2 py-1 rounded-md border border-border hover:bg-muted transition-colors"
                      >
                        +{pr.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Added on top of the time remaining. If the subscription has already
                    lapsed, the new period starts today.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Expires on</Label>
                  <Input
                    type="datetime-local"
                    value={subForm.expires_at}
                    onChange={(e) => setSubForm({ ...subForm, expires_at: e.target.value })}
                    data-testid="admin-sub-expires"
                  />
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                A workspace locked out for non-payment is let back in automatically once
                its new expiry is in the future. A suspended one stays suspended.
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setSubOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={subscriptionMut.isPending}
                  data-testid="admin-sub-submit"
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  {subscriptionMut.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Create/edit coupon dialog */}
      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingCoupon ? "Edit coupon" : "New coupon"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Redeemable by any workspace at signup checkout.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCoupon} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="coupon-code">Code</Label>
                <Input
                  id="coupon-code"
                  value={couponForm.code}
                  onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value })}
                  placeholder="WELCOME20"
                  required
                  data-testid="admin-coupon-form-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="coupon-description">Description</Label>
                <Input
                  id="coupon-description"
                  value={couponForm.description}
                  onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })}
                  placeholder="Marketing campaign"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Discount type</Label>
                <Select
                  value={couponForm.discount_type}
                  onValueChange={(v) => setCouponForm({ ...couponForm, discount_type: v })}
                >
                  <SelectTrigger className="bg-background" data-testid="admin-coupon-form-discount-type"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="fixed">Fixed amount (DZD)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="coupon-value">
                  {couponForm.discount_type === "percent" ? "Percent (0-100)" : "Amount (DZD)"}
                </Label>
                <Input
                  id="coupon-value"
                  type="number" min={0} step="0.01"
                  value={couponForm.discount_value}
                  onChange={(e) => setCouponForm({ ...couponForm, discount_value: e.target.value })}
                  required
                  data-testid="admin-coupon-form-value"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Applicable plans (none checked = all plans)</Label>
              <div className="flex items-center gap-4">
                {COUPON_PLANS.map((p) => (
                  <label key={p} className="flex items-center gap-2 text-sm capitalize cursor-pointer">
                    <Checkbox
                      checked={couponForm.applicable_plans.includes(p)}
                      onCheckedChange={(checked) =>
                        setCouponForm({
                          ...couponForm,
                          applicable_plans: checked
                            ? [...couponForm.applicable_plans, p]
                            : couponForm.applicable_plans.filter((x) => x !== p),
                        })
                      }
                      data-testid={`admin-coupon-form-plan-${p}`}
                    />
                    {p}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="coupon-max">Max redemptions</Label>
                <Input
                  id="coupon-max"
                  type="number" min={1}
                  value={couponForm.max_redemptions}
                  onChange={(e) => setCouponForm({ ...couponForm, max_redemptions: e.target.value })}
                  placeholder="Unlimited"
                  data-testid="admin-coupon-form-max"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="coupon-starts">Starts</Label>
                <Input
                  id="coupon-starts"
                  type="datetime-local"
                  value={couponForm.starts_at}
                  onChange={(e) => setCouponForm({ ...couponForm, starts_at: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="coupon-expires">Expires</Label>
                <Input
                  id="coupon-expires"
                  type="datetime-local"
                  value={couponForm.expires_at}
                  onChange={(e) => setCouponForm({ ...couponForm, expires_at: e.target.value })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={couponForm.active}
                onCheckedChange={(checked) => setCouponForm({ ...couponForm, active: !!checked })}
                data-testid="admin-coupon-form-active"
              />
              Active
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCouponOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saveCouponMut.isPending}
                data-testid="admin-coupon-form-submit"
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-start px-4 py-2.5 font-medium text-[10px] uppercase tracking-widest text-muted-foreground ${className}`}>
      {children}
    </th>
  );
}

function KpiCard({ icon: Icon, label, value, sub, accent, testid }) {
  return (
    <motion.div
      data-testid={testid}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.3 }}
      className={`surface-card p-5 ${accent ? "bg-primary text-primary-foreground border-primary" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-lg grid place-items-center ${
          accent ? "bg-accent text-accent-foreground" : "bg-muted"
        }`}>
          <Icon className="w-4 h-4" />
        </div>
        <ArrowUpRight className={`w-4 h-4 ${accent ? "text-primary-foreground/60" : "text-muted-foreground"}`} />
      </div>
      <div className="mt-4">
        <div className={`text-xs uppercase tracking-widest font-bold ${accent ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
          {label}
        </div>
        <div className="font-mono text-3xl font-bold mt-1">{value}</div>
        {sub && (
          <div className={`text-[10px] mt-1 ${accent ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
            {sub}
          </div>
        )}
      </div>
    </motion.div>
  );
}
