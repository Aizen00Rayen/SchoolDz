import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, AreaChart, Area, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { motion } from "framer-motion";
import {
  ArrowUpRight, GraduationCap, Wallet, Users, ClipboardCheck, Clock, BookOpen,
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
  { key: "attendance_pct", tKey: "kpi.attendance", icon: ClipboardCheck, tone: "default", format: "percent" },
  { key: "sessions_today", tKey: "kpi.sessions_today", icon: Clock, tone: "default" },
];

function formatValue(k, v, currency) {
  if (k.format === "currency") return `${Math.round(v).toLocaleString()} ${currency || "DZD"}`;
  if (k.format === "percent") return `${v}%`;
  return v?.toLocaleString?.() ?? v;
}

export default function DashboardPage() {
  const { t } = useI18n();
  const { tenant, user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });

  const kpis = data?.kpis || {};

  return (
    <div>
      <PageHeader
        title={`${t("dashboard.title")} — ${tenant?.name || ""}`}
        subtitle={`${t("dashboard.today")} · ${new Date().toLocaleDateString(undefined, {
          weekday: "long", year: "numeric", month: "long", day: "numeric",
        })}`}
        actions={
          <span className="text-xs px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground font-mono">
            {user?.email}
          </span>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {KPI_CONFIG.map((k, i) => (
          <motion.div
            key={k.key}
            data-testid={APPUI.dashboardKpi(k.key)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={`surface-card p-5 ${k.tone === "accent" ? "bg-primary text-primary-foreground border-primary" : ""}`}
          >
            <div className="flex items-start justify-between">
              <div className={`w-9 h-9 rounded-lg grid place-items-center ${
                k.tone === "accent" ? "bg-accent text-accent-foreground" : "bg-muted"
              }`}>
                <k.icon className="w-4 h-4" />
              </div>
              <ArrowUpRight className={`w-4 h-4 ${k.tone === "accent" ? "text-primary-foreground/60" : "text-muted-foreground"}`} />
            </div>
            <div className="mt-4">
              <div className={`text-xs uppercase tracking-widest font-bold ${
                k.tone === "accent" ? "text-primary-foreground/70" : "text-muted-foreground"
              }`}>
                {t(k.tKey)}
              </div>
              <div className="font-mono text-3xl font-bold mt-1">
                {isLoading ? <Skeleton className="h-8 w-24" /> : formatValue(k, kpis[k.key], tenant?.currency)}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Revenue chart + Today's sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="lg:col-span-2 surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-semibold text-lg">{t("dashboard.revenue_trend")}</h3>
              <p className="text-xs text-muted-foreground">{t("dashboard.last6m")}</p>
            </div>
            <div className="text-xs font-mono px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-600">
              +12.4%
            </div>
          </div>
          <div className="h-64 min-h-[280px]">
            {data?.revenue_trend && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.revenue_trend}>
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
                  />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--accent))"
                        strokeWidth={2} fill="url(#rev)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-lg">{t("dashboard.today_sessions")}</h3>
            <span className="text-xs font-mono text-muted-foreground">
              {data?.today_sessions?.length || 0}
            </span>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(data?.today_sessions || []).slice(0, 6).map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors">
                <div className="w-1.5 h-10 rounded-full bg-accent flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{s.topic || "Session"}</div>
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

      {/* Recent students + payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-lg">{t("dashboard.recent_students")}</h3>
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

        <div className="surface-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-lg">{t("dashboard.recent_payments")}</h3>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            {(data?.recent_payments || []).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <div className="text-sm font-medium">{p.invoice_number}</div>
                  <div className="text-[11px] font-mono text-muted-foreground capitalize">{p.kind}</div>
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
      </div>
    </div>
  );
}
