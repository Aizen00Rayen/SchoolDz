import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowUpRight, Building2, GraduationCap, LogOut, Moon, Sun, Tag,
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
  owner_name: "", owner_email: "", owner_password: "",
  plan: "premium", duration_days: 30,
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
    createTenantMut.mutate({
      ...tenantForm,
      slug: tenantForm.slug.trim().toLowerCase(),
      duration_days: parseInt(tenantForm.duration_days, 10) || 30,
    });
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
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <Th>Workspace</Th>
                    <Th>Slug</Th>
                    <Th>Plan</Th>
                    <Th>Status</Th>
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">
                          {tt.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3"><StatusPill status={tt.status} /></td>
                      <td className="px-4 py-3 font-mono text-xs">{tt.users_count ?? 0}</td>
                      <td className="px-4 py-3 font-mono text-xs">{tt.students_count ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(tt.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="inline-flex items-center gap-1">
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
              <table className="w-full text-sm">
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
              <table className="w-full text-sm">
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
