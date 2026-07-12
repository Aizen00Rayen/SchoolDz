import { useQuery } from "@tanstack/react-query";
import { FileBarChart2, TrendingUp, TrendingDown, Users, Wallet } from "lucide-react";
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
      <PageHeader title={t("menu.reports")} subtitle="Financial and operational insights." />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card icon={Users} label="Active students" value={stats.students_total} />
        <Card icon={Wallet} label="Revenue this month" value={`${(stats.revenue_month || 0).toLocaleString()} ${tenant?.currency || ""}`} />
        <Card icon={TrendingUp} label="Paid invoices" value={paid} />
        <Card icon={TrendingDown} label="Outstanding" value={`${(stats.outstanding || 0).toLocaleString()} ${tenant?.currency || ""}`} />
      </div>

      <div className="surface-card p-5">
        <h3 className="font-display font-semibold text-lg mb-4">Revenue by month</h3>
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
