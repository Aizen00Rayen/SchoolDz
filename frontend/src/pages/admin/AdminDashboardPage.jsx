import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowUpRight, Building2, GraduationCap, LogOut, Moon, Sun,
  ShieldCheck, Trash2, Users, Wallet, PowerOff, Power,
} from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/pages/app/_shared";

export default function AdminDashboardPage() {
  const { user, tenant, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();

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

  if (!user || user.role !== "super_admin") return null;

  const kpis = data?.kpis || {};
  const tenants = data?.tenants || [];

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
                schooldz <span className="text-accent">/ admin</span>
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
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {user.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
                nav("/", { replace: true });
              }}
              data-testid="admin-logout-button"
              className="text-red-600 border-red-500/30 hover:bg-red-500/10"
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
            sub={`${kpis.tenants_active ?? 0} ${t("admin.tenants.active")} · ${kpis.tenants_trial ?? 0} ${t("admin.tenants.trial")}`}
            accent
            testid="admin-kpi-tenants"
          />
          <KpiCard icon={Users} label={t("admin.users_total")} value={kpis.users_total ?? 0} testid="admin-kpi-users" />
          <KpiCard icon={GraduationCap} label={t("admin.students_total")} value={kpis.students_total ?? 0} testid="admin-kpi-students" />
          <KpiCard
            icon={Wallet}
            label={t("admin.revenue")}
            value={`$${Math.round(kpis.platform_revenue ?? 0).toLocaleString()}`}
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
                              className="h-8 text-xs text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                            >
                              <PowerOff className="w-3 h-3 me-1" />
                              {t("admin.actions.suspend")}
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              onClick={() => statusMut.mutate({ id: tt.id, status: "active" })}
                              data-testid={`admin-activate-${tt.id}`}
                              className="h-8 text-xs text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
                            >
                              <Power className="w-3 h-3 me-1" />
                              {t("admin.actions.activate")}
                            </Button>
                          )}
                          <Button
                            size="icon" variant="ghost"
                            onClick={() => {
                              if (window.confirm(t("admin.confirm.delete"))) {
                                deleteMut.mutate(tt.id);
                              }
                            }}
                            data-testid={`admin-delete-${tt.id}`}
                            className="h-8 w-8 text-red-600 hover:bg-red-500/10"
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
