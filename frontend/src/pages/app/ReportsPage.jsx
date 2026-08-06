import { useQuery } from "@tanstack/react-query";
import { FileBarChart2, TrendingUp, TrendingDown, Users, Wallet, TriangleAlert } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api } from "@/lib/api";
import { PageHeader } from "./_shared";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

export default function ReportsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: payments } = useQuery({
    queryKey: ["payments-list"],
    queryFn: async () => (await api.get("/payments")).data,
  });

  const stats = data?.kpis || {};
  const items = payments?.items || [];
  const paid = items.filter((p) => p.status === "paid").length;
  const pending = items.filter((p) => p.status === "pending").length;

  return (
    <div>
      <PageHeader title={t("menu.reports")} subtitle={t("reports.subtitle")} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card icon={Users} label={t("reports.active_students")} value={stats.students_total} />
        <Card icon={Wallet} label={t("reports.revenue_month")} value={`${(stats.revenue_month || 0).toLocaleString()} ${tenant?.currency || "DZD"}`} />
        <Card icon={TrendingUp} label={t("reports.paid_invoices")} value={paid} />
        <Card icon={TrendingDown} label={t("reports.outstanding")} value={`${(stats.outstanding || 0).toLocaleString()} ${tenant?.currency || "DZD"}`} />
      </div>

      <div className="surface-card p-5">
        <h3 className="font-display font-semibold text-lg mb-4">{t("reports.revenue_by_month")}</h3>
        <div className="h-72 min-h-[280px]">
          {data?.revenue_trend && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.revenue_trend}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="revenue" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="surface-card p-5 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg">{t("dashboard.at_risk")}</h3>
          <TriangleAlert className="w-4 h-4 text-warning" />
        </div>
        {(data?.at_risk_students || []).length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">{t("dashboard.no_at_risk")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.full_name")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.attendance_rate")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.overdue_amount")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.reasons")}</th>
                </tr>
              </thead>
              <tbody>
                {data.at_risk_students.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{s.first_name} {s.last_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.attendance_rate != null ? `${s.attendance_rate}%` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.overdue_amount ? `${s.overdue_amount.toLocaleString()} ${tenant?.currency || "DZD"}` : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {s.reasons.includes("low_attendance") && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/10 text-warning">
                            {t("dashboard.reason_low_attendance")}
                          </span>
                        )}
                        {s.reasons.includes("overdue_payment") && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive">
                            {t("dashboard.reason_overdue")}
                          </span>
                        )}
                      </div>
                    </td>
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

function Card({ icon: Icon, label, value }) {
  return (
    <div className="surface-card p-5">
      <Icon className="w-4 h-4 text-muted-foreground mb-3" />
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
      <div className="font-mono text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
