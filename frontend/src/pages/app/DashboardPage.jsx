import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Tooltip, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { motion } from "framer-motion";
import {
  ArrowUpRight, ArrowDownRight, GraduationCap, Wallet, Receipt, TrendingUp, TrendingDown,
  Users, ClipboardCheck, Clock, TriangleAlert, HandCoins, PiggyBank,
} from "lucide-react";

import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { APPUI } from "@/constants/testIds";
import { PageHeader, StatusPill } from "./_shared";
import { Skeleton } from "@/components/ui/skeleton";

const KPI_CONFIG = [
  { key: "students_total", tKey: "kpi.students", icon: GraduationCap, tone: "default" },
  { key: "revenue_month", tKey: "kpi.revenue_month", icon: Wallet, tone: "accent", format: "currency" },
  { key: "expenses_month", tKey: "kpi.expenses_month", icon: Receipt, tone: "default", format: "currency" },
  { key: "attendance_pct", tKey: "kpi.attendance", icon: ClipboardCheck, tone: "default", format: "percent" },
  { key: "sessions_today", tKey: "kpi.sessions_today", icon: Clock, tone: "default" },
];

function formatValue(k, v, currency) {
  if (k.format === "currency") return `${Math.round(v || 0).toLocaleString()} ${currency || "DZD"}`;
  if (k.format === "percent") return `${v}%`;
  return v?.toLocaleString?.() ?? v;
}

function money(v, currency) {
  return `${Math.round(v || 0).toLocaleString()} ${currency || "DZD"}`;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { tenant, user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });

  const kpis = data?.kpis || {};
  const alerts = data?.financial_alerts || {};
  const currency = tenant?.currency || "DZD";
  const netProfit = kpis.net_profit_month || 0;
  const isWinning = netProfit >= 0;

  // Real month-over-month change on net profit, replacing what used to be a
  // hardcoded badge — last two points of the 6-month trend.
  const trendPoints = data?.revenue_trend || [];
  const prevProfit = trendPoints.length >= 2 ? trendPoints[trendPoints.length - 2].profit : null;
  const curProfit = trendPoints.length >= 1 ? trendPoints[trendPoints.length - 1].profit : null;
  const profitChangePct = prevProfit && Math.abs(prevProfit) > 0.01 && curProfit != null
    ? Math.round(((curProfit - prevProfit) / Math.abs(prevProfit)) * 1000) / 10
    : null;

  return (
    <div>
      <PageHeader
        title={`${t("dashboard.title")} — ${tenant?.name || ""}`}
        subtitle={`${t("dashboard.today")} · ${new Date().toLocaleDateString(undefined, {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })}`}
        actions={
          <span className="hidden sm:inline-block max-w-full truncate text-xs px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground font-mono">
            {user?.email}
          </span>
        }
      />

      {/* Net profit hero — the single "are we winning or losing" answer */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        data-testid={APPUI.dashboardKpi("net_profit_month")}
        className={`surface-card p-4 sm:p-5 mb-4 flex items-center gap-3 sm:gap-4 ${
          isWinning ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"
        }`}
      >
        <div className={`w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 ${
          isWinning ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
        }`}>
          {isWinning ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
            {t("dashboard.net_profit_month")}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`font-mono text-xl sm:text-2xl font-bold ${isWinning ? "text-success" : "text-destructive"}`}>
              {isLoading ? <Skeleton className="h-7 w-32 inline-block" /> : money(netProfit, currency)}
            </span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isWinning ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
              {isWinning ? t("dashboard.winning") : t("dashboard.losing")}
            </span>
            {profitChangePct != null && (
              <span className="text-xs font-mono text-muted-foreground flex items-center gap-0.5">
                {profitChangePct >= 0 ? <ArrowUpRight className="w-3 h-3 text-success" /> : <ArrowDownRight className="w-3 h-3 text-destructive" />}
                {Math.abs(profitChangePct)}% {t("dashboard.vs_last_month")}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {money(kpis.revenue_month, currency)} {t("dashboard.revenue_label")} − {money(kpis.expenses_month, currency)} {t("dashboard.expenses_label")}
          </div>
        </div>
      </motion.div>

      {/* KPI grid. On phones each card is a compact horizontal row — five
          full-height stacked blocks would push the charts a whole screen down. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {KPI_CONFIG.map((k, i) => (
          <motion.div
            key={k.key}
            data-testid={APPUI.dashboardKpi(k.key)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`surface-card p-4 sm:p-5 flex items-center gap-3 sm:block ${k.tone === "accent" ? "bg-primary text-primary-foreground border-primary" : ""}`}
          >
            <div className="flex items-start justify-between flex-shrink-0 sm:w-auto">
              <div className={`w-9 h-9 rounded-lg grid place-items-center flex-shrink-0 ${
                k.tone === "accent" ? "bg-accent text-accent-foreground" : "bg-muted"
              }`}>
                <k.icon className="w-4 h-4" />
              </div>
              <ArrowUpRight className={`hidden sm:block w-4 h-4 ${k.tone === "accent" ? "text-primary-foreground/60" : "text-muted-foreground"}`} />
            </div>
            <div className="sm:mt-4 min-w-0 flex-1">
              <div className={`text-[10px] sm:text-xs uppercase tracking-widest font-bold ${
                k.tone === "accent" ? "text-primary-foreground/70" : "text-muted-foreground"
              }`}>
                {t(k.tKey)}
              </div>
              <div className="font-mono text-xl sm:text-2xl lg:text-3xl font-bold sm:mt-1 truncate">
                {isLoading ? <Skeleton className="h-8 w-24" /> : formatValue(k, kpis[k.key], tenant?.currency)}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Revenue chart + Today's sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="lg:col-span-2 surface-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold text-base sm:text-lg">{t("dashboard.revenue_trend")}</h3>
              <p className="text-xs text-muted-foreground">{t("dashboard.last6m")}</p>
            </div>
            {profitChangePct != null && (
              <div className={`text-xs font-mono px-2 py-1 rounded-full ${profitChangePct >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {profitChangePct >= 0 ? "+" : ""}{profitChangePct}%
              </div>
            )}
          </div>
          <div className="h-[240px] sm:h-[280px]">
            {data?.revenue_trend && (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.revenue_trend}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                    formatter={(value, name) => [money(value, currency), t(`dashboard.${name}`)]}
                  />
                  <Legend
                    formatter={(name) => t(`dashboard.${name}`)}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--accent))"
                        strokeWidth={2} fill="url(#rev)" name="revenue" />
                  <Line type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))"
                        strokeWidth={2} dot={false} name="expenses" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-base sm:text-lg">{t("dashboard.today_sessions")}</h3>
            <span className="text-xs font-mono text-muted-foreground">
              {data?.today_sessions?.length || 0}
            </span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(data?.today_sessions || []).slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors">
                <div className="w-1.5 h-10 rounded-full bg-accent flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{s.topic || t("menu.sessions")}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">
                    {new Date(s.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" → "}
                    {new Date(s.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <StatusPill status={s.status} />
              </div>
            ))}
            {(!data?.today_sessions || data.today_sessions.length === 0) && !isLoading && (
              <div className="text-sm text-muted-foreground text-center py-8">{t("dashboard.no_sessions_today")}</div>
            )}
          </div>
        </div>
      </div>

      {/* Money owed — receivables (students owe the school) vs payables
          (the school owes teachers/overpaid families) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <Link to="/app/payments" className="surface-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:border-warning/40 transition-colors">
          <div className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 bg-warning/10 text-warning">
            <HandCoins className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
              {t("dashboard.receivables")}
            </div>
            <div className="font-mono text-xl font-bold">
              {isLoading ? <Skeleton className="h-6 w-28" /> : money(kpis.receivables_total, currency)}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("dashboard.students_owing_count", { count: alerts.students_owing_count || 0 })}
            </div>
          </div>
        </Link>
        <Link to="/app/teacher-payments" className="surface-card p-4 sm:p-5 flex items-center gap-3 sm:gap-4 hover:border-info/40 transition-colors">
          <div className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0 bg-info/10 text-info">
            <PiggyBank className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest font-bold text-muted-foreground">
              {t("dashboard.payables")}
            </div>
            <div className="font-mono text-xl font-bold">
              {isLoading ? <Skeleton className="h-6 w-28" /> : money(kpis.payables_total, currency)}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("dashboard.payables_breakdown", {
                teachers: money(kpis.teacher_payouts_due, currency),
                overpaid: money(kpis.overpaid_students_total, currency),
              })}
            </div>
          </div>
        </Link>
      </div>

      {/* Recent students + payments + at-risk */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="surface-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-base sm:text-lg">{t("dashboard.recent_students")}</h3>
            <Users className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            {(data?.recent_students || []).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <div className="text-sm font-medium">{s.first_name} {s.last_name}</div>
                  <div className="text-[11px] font-mono text-muted-foreground">{s.student_code}</div>
                </div>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-base sm:text-lg">{t("dashboard.recent_payments")}</h3>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            {(data?.recent_payments || []).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <div className="text-sm font-medium">{p.invoice_number}</div>
                  <div className="text-[11px] font-mono text-muted-foreground capitalize">{t(`kind.${p.kind}`)}</div>
                </div>
                <div className="text-end">
                  <div className="text-sm font-mono font-semibold">
                    {Math.round(p.amount).toLocaleString()} {tenant?.currency || "DZD"}
                  </div>
                  <StatusPill status={p.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-base sm:text-lg">{t("dashboard.at_risk")}</h3>
            <TriangleAlert className="w-4 h-4 text-warning" />
          </div>
          <div className="space-y-1">
            {(data?.at_risk_students || []).slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-border last:border-0 gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.first_name} {s.last_name}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
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
                </div>
              </div>
            ))}
            {(!data?.at_risk_students || data.at_risk_students.length === 0) && !isLoading && (
              <div className="text-sm text-muted-foreground text-center py-8">{t("dashboard.no_at_risk")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
