import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, GaugeCircle, GraduationCap, Users, Wallet } from "lucide-react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { PageHeader, EmptyState, LoadingRows } from "./_shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const KPI_CONFIG = [
  { key: "schools_total", tKey: "master.schools", icon: Building2 },
  { key: "students_total", tKey: "kpi.students", icon: GraduationCap },
  { key: "teachers_total", tKey: "master.teachers", icon: Users },
  { key: "revenue_total", tKey: "master.revenue", icon: Wallet, format: "currency" },
];

export default function MasterDashboardPage() {
  const { t } = useI18n();
  const { tenant, myTenants } = useAuth();
  const [filters, setFilters] = useState({ from: "", to: "" });
  const [selectedIds, setSelectedIds] = useState(null); // null = all

  const activeIds = selectedIds ?? myTenants.map((s) => s.id);
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  activeIds.forEach((id) => params.append("tenant_id", id));

  const { data, isLoading } = useQuery({
    queryKey: ["master-dashboard", filters, activeIds],
    queryFn: async () => (await api.get(`/owner/master-dashboard?${params.toString()}`)).data,
    enabled: myTenants.length > 1,
  });

  const currency = tenant?.currency || "DZD";
  const kpis = data?.kpis || {};
  const schools = data?.schools || [];

  const toggleSchool = (id) => {
    setSelectedIds((prev) => {
      const base = prev ?? myTenants.map((s) => s.id);
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  };

  if (myTenants.length < 2) {
    return (
      <div>
        <PageHeader title={t("workspace.master_dashboard")} />
        <EmptyState
          icon={GaugeCircle}
          title={t("master.needs_second_school_title")}
          description={t("master.needs_second_school_desc")}
          action={
            <Link to="/app/dashboard" className="text-sm font-medium text-accent hover:underline">
              {t("master.back_to_dashboard")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("workspace.master_dashboard")} subtitle={t("master.subtitle")} />

      <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-medium mb-1.5 block">{t("reports.from")}</Label>
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">{t("reports.to")}</Label>
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
        </div>
        <div>
          <Label className="text-xs font-medium mb-1.5 block">{t("master.schools")}</Label>
          <div className="flex flex-wrap gap-3">
            {myTenants.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={activeIds.includes(s.id)} onCheckedChange={() => toggleSchool(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {KPI_CONFIG.map((k, i) => (
          <motion.div
            key={k.key}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="surface-card p-4 sm:p-5"
          >
            <div className="w-9 h-9 rounded-lg grid place-items-center bg-muted flex-shrink-0">
              <k.icon className="w-4 h-4" />
            </div>
            <div className="mt-4">
              <div className="text-[10px] sm:text-xs uppercase tracking-widest font-bold text-muted-foreground">
                {t(k.tKey)}
              </div>
              <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-bold mt-1 truncate">
                {isLoading
                  ? "—"
                  : k.format === "currency"
                    ? `${Math.round(kpis[k.key] || 0).toLocaleString()} ${currency}`
                    : (kpis[k.key] ?? 0).toLocaleString()}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : schools.length === 0 ? (
          <EmptyState icon={Building2} title={t("master.no_schools_selected")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.school_name_col", "field.plan", "field.status", "field.students", "master.teachers", "master.revenue"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-xs capitalize">{s.plan ? t(`plan.${s.plan}`) : "—"}</td>
                    <td className="px-4 py-3 text-xs capitalize">{s.status ? t(`status.${s.status}`) : "—"}</td>
                    <td className="px-4 py-3 font-mono">{s.students_count}</td>
                    <td className="px-4 py-3 font-mono">{s.teachers_count}</td>
                    <td className="px-4 py-3 font-mono font-semibold">{Math.round(s.revenue || 0).toLocaleString()} {currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
