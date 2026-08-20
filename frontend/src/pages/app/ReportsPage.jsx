import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download, TrendingUp, TrendingDown, Receipt, Wallet, TriangleAlert, HandCoins,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, downloadFrom } from "@/lib/api";
import { PageHeader, Field, StatusPill } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { categoryLabel } from "./ExpensesPage";

export default function ReportsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const [filters, setFilters] = useState({ from: "", to: "", group_id: "", teacher_id: "" });

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: finance } = useQuery({
    queryKey: ["finance-report", filters],
    queryFn: async () => (await api.get(`/reports/finance${query ? `?${query}` : ""}`)).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => (await api.get("/teachers")).data,
  });

  const currency = tenant?.currency || "DZD";
  const money = (v) => `${Number(v || 0).toLocaleString()} ${currency}`;
  const byCategory = Object.entries(finance?.expenses_by_category || {});

  return (
    <div>
      <PageHeader
        title={t("menu.reports")}
        subtitle={t("reports.subtitle")}
        actions={
          <Button variant="outline" onClick={() => downloadFrom(`/reports/finance?${query}`, "xlsx", "financial-report")}>
            <Download className="w-4 h-4 me-2" /> {t("export.excel")}
          </Button>
        }
      />

      <div className="surface-card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label={t("reports.from")}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} data-testid="reports-from" />
        </Field>
        <Field label={t("reports.to")}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} data-testid="reports-to" />
        </Field>
        <Field label={t("menu.groups")}>
          <Select
            value={filters.group_id || "__all"}
            onValueChange={(v) => setFilters({ ...filters, group_id: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("reports.all_groups")}</SelectItem>
              {(groups?.items || []).map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("menu.teachers")}>
          <Select
            value={filters.teacher_id || "__all"}
            onValueChange={(v) => setFilters({ ...filters, teacher_id: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("reports.all_teachers")}</SelectItem>
              {(teachers?.items || []).map((x) => (
                <SelectItem key={x.id} value={x.id}>{x.first_name} {x.last_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <Card icon={Wallet} label={t("reports.collected")} value={money(finance?.collected)} />
        <Card icon={TrendingDown} label={t("reports.outstanding")} value={money(finance?.outstanding)} />
        <Card icon={Receipt} label={t("reports.expenses")} value={money(finance?.expenses)} />
        <Card icon={HandCoins} label={t("reports.teacher_earnings")} value={money(finance?.teacher_earnings)} />
        <Card icon={TrendingUp} label={t("reports.net")} value={money(finance?.net)} />
      </div>

      {finance?.expenses_scoped_out && (
        <p className="text-xs text-muted-foreground mb-6 -mt-3">{t("reports.expenses_scoped_out")}</p>
      )}

      <div className="surface-card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-lg">{t("reports.transactions")}</h3>
          <span className="text-xs font-mono text-muted-foreground">
            {(finance?.transactions || []).length}
          </span>
        </div>
        {!finance?.transactions || finance.transactions.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">{t("reports.no_transactions")}</div>
        ) : (
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border sticky top-0 bg-card">
                <tr>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("reports.date")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("reports.description")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.kind")}</th>
                  <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.status")}</th>
                  <th className="text-end px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {finance.transactions.map((tx, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tx.date || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{tx.description}</div>
                      {tx.reference && <div className="text-[11px] font-mono text-muted-foreground">{tx.reference}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs capitalize">
                      {tx.type === "expense" ? categoryLabel(tx.kind, t) : t(`kind.${tx.kind}`)}
                    </td>
                    <td className="px-3 py-2">
                      {tx.status ? <StatusPill status={tx.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className={`px-3 py-2 text-end font-mono font-semibold ${tx.type === "expense" ? "text-destructive" : "text-success"}`}>
                      {tx.type === "expense" ? "−" : "+"}{money(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {byCategory.length > 0 && (
        <div className="surface-card p-5 mb-6">
          <h3 className="font-display font-semibold text-lg mb-4">{t("reports.by_category")}</h3>
          <div className="space-y-2">
            {byCategory.sort((a, b) => b[1] - a[1]).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span>{categoryLabel(key, t)}</span>
                <span className="font-mono">{money(value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
