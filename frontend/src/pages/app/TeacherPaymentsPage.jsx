import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, ChevronDown, ChevronRight, Download, History, Package, Plus, Trash2, Wallet, Users, HandCoins, CheckCircle2, Banknote, AlertCircle } from "lucide-react";

import { api, extractError, downloadFrom } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";
import { useConfirm } from "@/lib/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, EmptyState, LoadingRows, Field, groupOptionLabel, FilterPanel, MobileFab } from "./_shared";
import { currencyLabel, formatDate, formatNumber } from "@/lib/format";
import { formatDate as fmtDate, formatTime as fmtTime } from "@/lib/format";
import { DateInput } from "@/components/DateInput";
import { Amount } from "@/components/Amount";

const EMPTY_PAYOUT = {
  teacher_id: "", amount: "", paid_at: new Date().toISOString().slice(0, 10),
  period_start: "", period_end: "", notes: "",
};

export default function TeacherPaymentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const { canAdd, canModify: canEditPercentage } = usePermission("teacher_payments");
  const canPay = canAdd;

  const [filters, setFilters] = useState({ from: "", to: "", teacher_id: "", group_id: "" });
  const [open, setOpen] = useState(false);
  const [selectedHistoryTeacher, setSelectedHistoryTeacher] = useState(null);
  const [form, setForm] = useState(EMPTY_PAYOUT);
  // Draft values for the always-visible percentage inputs, keyed by teacher
  // id — only holds an entry while a field has been touched and not yet
  // saved, so unedited rows always reflect the server value.
  const [pctDrafts, setPctDrafts] = useState({});
  const [bookPctDrafts, setBookPctDrafts] = useState({});

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["teacher-payments", filters],
    queryFn: () => api.get(`/teacher-payments/summary${query ? `?${query}` : ""}`).then((r) => r.data),
  });
  const { data: payouts } = useQuery({
    queryKey: ["teacher-payouts", filters],
    queryFn: () => api.get(`/teacher-payouts${query ? `?${query}` : ""}`).then((r) => r.data),
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers"],
    queryFn: () => api.get("/teachers").then((r) => r.data),
  });
  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: () => api.get("/groups").then((r) => r.data),
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: () => api.get("/courses").then((r) => r.data),
  });
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));

  const rows = data?.items || [];
  const totals = data?.totals || {};
  const currency = currencyLabel(tenant?.currency);

  const payoutMut = useMutation({
    mutationFn: (payload) => api.post("/teacher-payouts", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.created"));
      qc.invalidateQueries({ queryKey: ["teacher-payments"] });
      qc.invalidateQueries({ queryKey: ["teacher-payouts"] });
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const percentageMut = useMutation({
    mutationFn: ({ teacherId, value }) => api.patch(`/teachers/${teacherId}`, { payment_percentage: value }).then((r) => r.data),
    onSuccess: (_, { teacherId }) => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["teacher-payments"] });
      setPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
    },
    onError: (e, { teacherId }) => {
      toast.error(extractError(e));
      setPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
    },
  });

  const savePercentage = (teacherId, currentServerValue, draftValue) => {
    let value = parseFloat(draftValue);
    if (Number.isNaN(value)) {
      setPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
      return;
    }
    value = Math.min(100, Math.max(0, value));
    if (value === currentServerValue) {
      setPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
      return;
    }
    percentageMut.mutate({ teacherId, value });
  };

  const bookPercentageMut = useMutation({
    mutationFn: ({ teacherId, value }) => api.patch(`/teachers/${teacherId}`, { book_percentage: value }).then((r) => r.data),
    onSuccess: (_, { teacherId }) => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["teacher-payments"] });
      setBookPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
    },
    onError: (e, { teacherId }) => {
      toast.error(extractError(e));
      setBookPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
    },
  });

  const saveBookPercentage = (teacherId, currentServerValue, draftValue) => {
    let value = parseFloat(draftValue);
    if (Number.isNaN(value)) {
      setBookPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
      return;
    }
    value = Math.min(100, Math.max(0, value));
    if (value === currentServerValue) {
      setBookPctDrafts((prev) => { const next = { ...prev }; delete next[teacherId]; return next; });
      return;
    }
    bookPercentageMut.mutate({ teacherId, value });
  };

  const submit = (e) => {
    e.preventDefault();
    payoutMut.mutate({
      ...form,
      amount: parseFloat(form.amount) || 0,
      period_start: form.period_start || null,
      period_end: form.period_end || null,
    });
  };

  const money = (v) => `${Number(v || 0).toLocaleString()} ${currency}`;
  // "Sessions 1,800 + Books 80 + Packages 0 − Waivers 0 − Discounts 1,000"
  const deductionsOf = (r) => (r.waivers_deducted || 0) + (r.reductions_deducted || 0);
  const breakdownOf = (r) => [
    `${t("tp.sessions_tab")} ${money(r.session_earned)}`,
    `+ ${t("tp.book_earned")} ${money(r.book_earned)}`,
    `+ ${t("tp.standalone_earned")} ${money(r.standalone_earned)}`,
    `− ${t("tp.waivers")} ${money(r.waivers_deducted)}`,
    `− ${t("tp.discounts")} ${money(r.reductions_deducted)}`,
    `= ${money(r.earned)}`,
  ].join("\n");
  const EarnedCell = ({ r }) => (
    <span title={breakdownOf(r)} className="inline-flex flex-col cursor-help">
      <span>{money(r.earned)}</span>
      {deductionsOf(r) > 0 && (
        <span className="text-[10px] font-normal text-destructive">
          {t("tp.deductions")}: −{money(deductionsOf(r))}
        </span>
      )}
    </span>
  );

  return (
    <div>
      <PageHeader
        title={t("menu.teacher_payments")}
        subtitle={t("subtitle.teacher_payments")}
        actions={
          <>
            <Button variant="outline" onClick={() => downloadFrom(`/teacher-payments/summary?${query}`, "xlsx", "teacher-payments")}>
              <Download className="w-4 h-4 me-2" /> {t("export.excel")}
            </Button>
            {canAdd && (
              <Button
                onClick={() => { setForm(EMPTY_PAYOUT); setOpen(true); }}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
                data-testid="teacher-payout-new"
              >
                <Plus className="w-4 h-4 me-2" /> {t("tp.record_payout")}
              </Button>
            )}
          </>
        }
      />
      {canAdd && <MobileFab onClick={() => { setForm(EMPTY_PAYOUT); setOpen(true); }} label={t("tp.record_payout")} testId={"teacher-payout-fab"} />}

      <FilterPanel className="grid grid-cols-1 md:grid-cols-4 gap-3" activeCount={Object.values(filters).filter(Boolean).length}>
        <Field label={t("reports.from")}>
          <DateInput value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t("reports.to")}>
          <DateInput value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
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
        <Field label={t("menu.groups")}>
          <Select
            value={filters.group_id || "__all"}
            onValueChange={(v) => setFilters({ ...filters, group_id: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("reports.all_groups")}</SelectItem>
              {(groups?.items || []).map((g) => (
                <SelectItem key={g.id} value={g.id}>{groupOptionLabel(g, courseMap, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FilterPanel>

      {/* Top Financial KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        <div className="surface-card p-4 sm:p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground grid place-items-center flex-shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("tp.present_count", "الحضور الإجمالي")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-foreground">
              {totals.present_count ?? 0}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3 border-emerald-500/20 bg-emerald-500/5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center flex-shrink-0">
            <HandCoins className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300">
              {t("tp.earned", "المستحقات")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-emerald-600 dark:text-emerald-400 leading-tight">
              <Amount value={totals.earned} currency={currency} />
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3 border-blue-500/20 bg-blue-500/5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300">
              {t("tp.paid_out", "المسدد")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-blue-600 dark:text-blue-400 leading-tight">
              <Amount value={totals.paid_out} currency={currency} />
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3 border-amber-500/20 bg-amber-500/5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center flex-shrink-0">
            <Wallet className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300">
              {t("tp.balance", "الرصيد المتبقي")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-amber-600 dark:text-amber-400 leading-tight">
              <Amount value={totals.balance} currency={currency} />
            </div>
          </div>
        </div>
      </div>

      {/* Teachers Settlements Container */}
      <div className="surface-card overflow-hidden mb-6">
        {isLoading ? (
          <div className="p-6"><LoadingRows /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Wallet} title={t("menu.teacher_payments")} description={t("tp.set_percentage")} />
        ) : (
          <>
            {/* Mobile Cards Stack (md:hidden) */}
            <div className="md:hidden divide-y divide-border">
              {rows.map((r) => {
                const bal = Number(r.balance || 0);
                return (
                  <div key={r.teacher_id} className="p-4 space-y-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-base text-foreground">{r.teacher_name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                          <span>{t("tp.present_count")}: <strong className="font-mono text-foreground">{r.present_count}</strong>{r.pardoned_count > 0 && <span className="ms-1 text-violet-600 dark:text-violet-400">(+{r.pardoned_count} {t("tp.pardoned")})</span>}</span>
                          <span>&bull;</span>
                          <span>{t("tp.percentage")}: <strong className="font-mono text-foreground">{r.percentage}%</strong></span>
                        </div>
                      </div>
                      <Badge variant="outline" className={`font-mono font-bold text-xs px-2.5 py-1 ${bal > 0 ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"}`}>
                        {money(r.balance)}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg text-center">
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase">{t("tp.earned")}</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400"><EarnedCell r={r} /></span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase">{t("tp.paid_out")}</span>
                        <span className="font-mono font-medium text-foreground">{money(r.paid_out)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase">{t("tp.balance")}</span>
                        <span className={`font-mono font-bold ${bal > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                          {money(r.balance)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedHistoryTeacher(r)}
                        className="h-8 text-xs gap-1.5 flex-1"
                      >
                        <History className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{t("tp.history", "السجل")}</span>
                      </Button>

                      {canPay && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setForm({ ...EMPTY_PAYOUT, teacher_id: r.teacher_id, amount: bal > 0 ? String(bal) : "" });
                            setOpen(true);
                          }}
                          className="h-8 text-xs gap-1.5 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <Banknote className="w-3.5 h-3.5" />
                          <span>{t("tp.record_payout", "تسجيل دفعة")}</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table View (hidden md:block) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    {["menu.teachers", "tp.percentage", "tp.present_count", "tp.book_percentage", "tp.book_earned", "tp.standalone_earned", "tp.earned", "tp.paid_out", "tp.balance"].map((k) => (
                      <th key={k} className="text-start px-4 py-3 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                        {t(k)}
                      </th>
                    ))}
                    <th className="text-end px-4 py-3 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("tp.history")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr
                      key={r.teacher_id}
                      onClick={() => setSelectedHistoryTeacher(r)}
                      className="hover:bg-muted/50 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3.5 font-medium text-foreground">
                        <div className="flex items-center gap-2 text-start font-semibold text-foreground">
                          <span>{r.teacher_name}</span>
                          <History className="w-3.5 h-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                        {!canEditPercentage ? (
                          `${r.percentage}%`
                        ) : (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number" min="0" max="100" step="any"
                              className="h-8 w-20 font-mono text-xs"
                              value={pctDrafts[r.teacher_id] ?? r.percentage}
                              onChange={(e) => setPctDrafts((prev) => ({ ...prev, [r.teacher_id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.target.blur();
                              }}
                              onBlur={(e) => savePercentage(r.teacher_id, r.percentage, e.target.value)}
                              data-testid={`tp-percentage-input-${r.teacher_id}`}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs font-semibold">
                        {r.present_count}
                        {r.pardoned_count > 0 && (
                          <span className="block text-[10px] font-normal text-violet-600 dark:text-violet-400" title={t("tp.pardoned_hint")}>
                            +{r.pardoned_count} {t("tp.pardoned")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                        {!canEditPercentage ? (
                          `${r.book_percentage}%`
                        ) : (
                          <div className="flex items-center gap-1">
                            <Input
                              type="number" min="0" max="100" step="any"
                              className="h-8 w-20 font-mono text-xs"
                              value={bookPctDrafts[r.teacher_id] ?? r.book_percentage}
                              onChange={(e) => setBookPctDrafts((prev) => ({ ...prev, [r.teacher_id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.target.blur();
                              }}
                              onBlur={(e) => saveBookPercentage(r.teacher_id, r.book_percentage, e.target.value)}
                              data-testid={`tp-book-percentage-input-${r.teacher_id}`}
                            />
                            <span className="text-muted-foreground">%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{money(r.book_earned)}</td>
                      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{money(r.standalone_earned)}</td>
                      <td className="px-4 py-3.5 font-mono font-bold text-emerald-600 dark:text-emerald-400"><EarnedCell r={r} /></td>
                      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{money(r.paid_out)}</td>
                      <td className={`px-4 py-3.5 font-mono font-bold ${r.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                        {money(r.balance)}
                      </td>
                      <td className="px-4 py-3.5 text-end" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {canPay && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const bal = Number(r.balance || 0);
                                setForm({ ...EMPTY_PAYOUT, teacher_id: r.teacher_id, amount: bal > 0 ? String(bal) : "" });
                                setOpen(true);
                              }}
                              className="h-7 px-2.5 text-xs inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              <span>{t("tp.record_payout", "تسجيل دفعة")}</span>
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedHistoryTeacher(r)}
                            className="h-7 px-2.5 text-xs inline-flex items-center gap-1"
                            title={t("tp.view_history")}
                          >
                            <History className="w-3.5 h-3.5 text-muted-foreground" />
                            <span>{t("tp.history")}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <h3 className="font-display font-semibold text-lg mb-2">{t("tp.payouts")}</h3>
      <div className="surface-card overflow-hidden">
        {(payouts?.items || []).length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t("crud.no_items_yet", { module: t("tp.payouts") })}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.paid_at", "menu.teachers", "field.amount", "field.period", "field.notes"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(payouts?.items || []).map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{fmtDate(p.paid_at, "short")}</td>
                    <td className="px-4 py-3">{p.teacher_name}</td>
                    <td className="px-4 py-3 font-mono">{money(p.amount)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.period_start || p.period_end ? `${p.period_start ? fmtDate(p.period_start, "short") : "…"} → ${p.period_end ? fmtDate(p.period_end, "short") : "…"}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("tp.record_payout")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{t("crud.fill_details")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label={t("menu.teachers")} required>
                <Select value={form.teacher_id} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {(teachers?.items || []).map((x) => (
                      <SelectItem key={x.id} value={x.id}>{x.first_name} {x.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={t("field.amount")} required>
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="payout-amount" />
            </Field>
            <Field label={t("field.paid_at")} required>
              <DateInput value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} required />
            </Field>
            <Field label={t("reports.from")}>
              <DateInput value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </Field>
            <Field label={t("reports.to")}>
              <DateInput value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <Field label={t("field.notes")}>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </Field>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={!form.teacher_id || payoutMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {selectedHistoryTeacher && (
        <TeacherHistoryDialog
          teacher={selectedHistoryTeacher}
          initialFilters={filters}
          onClose={() => setSelectedHistoryTeacher(null)}
          currency={currency}
        />
      )}
    </div>
  );
}

/** The students who attended one session, with what each means for the
 * teacher: counted, pardoned (no pay) and whether they have paid. Loaded
 * only when the row is opened. */
function SessionStudentsPanel({ teacherId, sessionId, query, currency, colSpan }) {
  const { t } = useI18n();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teacher-session-students", teacherId, sessionId, query],
    queryFn: () =>
      api.get(`/teacher-payments/${teacherId}/sessions/${sessionId}/students${query ? `?${query}` : ""}`).then((r) => r.data),
  });
  const money = (v) => `${formatNumber(v)} ${currency}`;
  const counts = data?.counts || {};

  const paymentBadge = (r) => {
    if (r.pardoned) {
      return (
        <span className="px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium whitespace-nowrap">
          {t(r.pardon_types.includes("both") ? "tp.pardoned_both" : "tp.pardoned_teacher")}
        </span>
      );
    }
    if (r.school_pardon) {
      return (
        <span className="px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium whitespace-nowrap" title={t("tp.school_pardon_hint")}>
          {t("tp.pardoned_school")}
        </span>
      );
    }
    if (r.paid === true) {
      return <span className="px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">{t("attendance.paid")}</span>;
    }
    if (r.paid === false) {
      return <span className="px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">{t("attendance.unpaid")}</span>;
    }
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <tr className="bg-muted/20">
      <td colSpan={colSpan} className="px-3 py-3" data-testid="tp-session-students">
        {isLoading ? (
          <LoadingRows />
        ) : isError ? (
          <div className="text-destructive text-xs">{extractError(error)}</div>
        ) : (data?.students || []).length === 0 ? (
          <div className="text-muted-foreground text-xs">{t("tp.no_students_attended")}</div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-muted font-medium">{t("tp.counted")}: {counts.counted}</span>
              {counts.pardoned > 0 && <span className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium">{t("tp.pardoned")}: {counts.pardoned}</span>}
              {counts.school_pardon > 0 && <span className="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium">{t("tp.pardoned_school")}: {counts.school_pardon}</span>}
              <span className="px-2 py-0.5 rounded-full bg-success/10 text-success font-medium">{t("attendance.paid")}: {counts.paid}</span>
              <span className="px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">{t("attendance.unpaid")}: {counts.unpaid}</span>
            </div>
            <div className="rounded-md border bg-background overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-start px-3 py-1.5 font-medium text-muted-foreground">{t("field.student")}</th>
                    <th className="text-start px-3 py-1.5 font-medium text-muted-foreground">{t("field.code")}</th>
                    <th className="text-start px-3 py-1.5 font-medium text-muted-foreground">{t("field.status")}</th>
                    <th className="text-start px-3 py-1.5 font-medium text-muted-foreground">{t("tp.payment")}</th>
                    <th className="text-end px-3 py-1.5 font-medium text-muted-foreground">{t("tp.teacher_pay")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.students.map((r) => (
                    <tr key={r.student_id} className={r.pardoned ? "bg-violet-500/5" : ""} data-testid={`tp-student-${r.student_id}`}>
                      <td className={`px-3 py-1.5 font-medium ${r.pardoned ? "line-through decoration-violet-400/60 text-muted-foreground" : ""}`}>{r.name}</td>
                      <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.student_code || "—"}</td>
                      <td className="px-3 py-1.5">{t(`status.${r.attendance}`)}</td>
                      <td className="px-3 py-1.5">{paymentBadge(r)}</td>
                      <td className={`px-3 py-1.5 text-end font-mono font-semibold ${r.pardoned ? "text-muted-foreground" : ""}`} dir="ltr">
                        {money(r.earned)}
                        {r.partly_pardoned && <span className="block text-[10px] font-normal text-violet-600 dark:text-violet-400">{t("tp.partly_pardoned")}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/30 border-t">
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 font-medium">{t("tp.session_total")}</td>
                    <td className="px-3 py-1.5 text-end font-mono font-bold" dir="ltr">{money(data.total_earned)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}

function TeacherHistoryDialog({ teacher, initialFilters, onClose, currency }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canModify, canDelete } = usePermission("teacher_payments");
  const { canDelete: canDeleteSessions, canModify: canModifySessions } = usePermission("sessions");
  const { canDelete: canDeletePayments, canModify: canModifyPayments } = usePermission("payments");
  const canRemove = canModify || canDelete || canDeleteSessions || canModifySessions || canDeletePayments || canModifyPayments;

  const teacherId = teacher?.teacher_id || teacher?.id;
  const [openSessionId, setOpenSessionId] = useState(null);

  const [dateFilters, setDateFilters] = useState({
    from: initialFilters?.from || "",
    to: initialFilters?.to || "",
  });

  const query = new URLSearchParams(
    Object.entries(dateFilters).filter(([, v]) => v)
  ).toString();

  const { data: history, isLoading, isError, error } = useQuery({
    queryKey: ["teacher-history", teacherId, dateFilters],
    queryFn: () =>
      api
        .get(`/teacher-payments/${teacherId}/history${query ? `?${query}` : ""}`)
        .then((r) => r.data),
    enabled: !!teacherId,
  });

  const removeSessionMut = useMutation({
    mutationFn: (sessionId) =>
      api.delete(`/teacher-payments/sessions/${sessionId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("tp.session_removed"));
      qc.invalidateQueries({ queryKey: ["teacher-history", teacherId] });
      qc.invalidateQueries({ queryKey: ["teacher-payments"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const removePackageMut = useMutation({
    mutationFn: (itemId) =>
      api.delete(`/teacher-payments/package-items/${itemId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("tp.package_removed"));
      qc.invalidateQueries({ queryKey: ["teacher-history", teacherId] });
      qc.invalidateQueries({ queryKey: ["teacher-payments"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const handleRemoveSession = async (session) => {
    const ok = await confirm({
      title: t("actions.delete"),
      description: t("tp.remove_session_confirm"),
      destructive: true,
      confirmLabel: t("actions.delete"),
      cancelLabel: t("actions.cancel"),
    });
    if (!ok) return;
    removeSessionMut.mutate(session.id);
  };

  const handleRemovePackage = async (item) => {
    const ok = await confirm({
      title: t("actions.delete"),
      description: t("tp.remove_package_confirm"),
      destructive: true,
      confirmLabel: t("actions.delete"),
      cancelLabel: t("actions.cancel"),
    });
    if (!ok) return;
    removePackageMut.mutate(item.id);
  };

  const money = (v) => `${Number(v || 0).toLocaleString()} ${currency}`;

  const formatDateTime = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return `${fmtDate(d, "short")} ${fmtTime(d)}`;
    } catch {
      return iso;
    }
  };

  const formatDate = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return fmtDate(d, "short");
    } catch {
      return iso;
    }
  };

  const totals = history?.totals || {};
  const sessions = history?.sessions || [];
  const packages = history?.packages || [];

  return (
    <Dialog open={!!teacher} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card max-w-5xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pe-6">
            <div>
              <DialogTitle className="font-display text-xl flex items-center gap-2">
                <History className="w-5 h-5 text-muted-foreground" />
                <span>{history?.teacher?.name || teacher?.teacher_name}</span>
                <Badge variant="secondary" className="font-mono text-xs font-normal">
                  {history?.teacher?.payment_percentage ?? teacher?.percentage}%
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                {t("tp.teacher_history_desc")}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <DateInput
                value={dateFilters.from}
                onChange={(e) => setDateFilters((prev) => ({ ...prev, from: e.target.value }))}
                className="h-8 text-xs w-32"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <DateInput
                value={dateFilters.to}
                onChange={(e) => setDateFilters((prev) => ({ ...prev, to: e.target.value }))}
                className="h-8 text-xs w-32"
              />
              {(dateFilters.from || dateFilters.to) && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("a11y.clear")}
                  title={t("a11y.clear")}
                  onClick={() => setDateFilters({ from: "", to: "" })}
                  className="h-8 px-2 text-xs"
                >
                  ✕
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-3">
          <div className="bg-muted/30 border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {t("tp.sessions_tab")}
            </div>
            <div className="font-mono font-bold text-base mt-1">
              {money(totals.sessions_earned)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {totals.sessions_count ?? 0} {t("tp.sessions_tab").toLowerCase()}
            </div>
          </div>

          <div className="bg-muted/30 border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1">
              <Package className="w-3.5 h-3.5" />
              {t("tp.packages_tab")}
            </div>
            <div className="font-mono font-bold text-base mt-1">
              {money(totals.packages_earned)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {totals.packages_count ?? 0} {t("course.kind_package_badge").toLowerCase()}
            </div>
          </div>

          <div className="bg-muted/30 border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t("tp.earned")}
            </div>
            <div className="font-mono font-bold text-base text-foreground mt-1">
              {money(totals.total_earned)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("tp.paid_out")}: {money(totals.paid_out)}
            </div>
            {/* Teacher waivers are already left out of the sessions above
                (pardoned students aren't counted), so only discounts are
                shown as a deduction here. */}
            {(totals.reductions_deducted || 0) > 0 && (
              <div className="text-[11px] text-destructive">
                {t("tp.discounts")}: −{money(totals.reductions_deducted)}
              </div>
            )}
            {(totals.pardoned_count || 0) > 0 && (
              <div className="text-[11px] text-violet-600 dark:text-violet-400">
                {totals.pardoned_count} {t("tp.pardoned")}
              </div>
            )}
          </div>

          <div className="bg-muted/30 border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t("tp.balance")}
            </div>
            <div className={`font-mono font-bold text-base mt-1 ${totals.balance > 0 ? "text-destructive" : ""}`}>
              {money(totals.balance)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {totals.balance > 0 ? t("reports.outstanding") : t("reports.collected")}
            </div>
          </div>
        </div>

        <Tabs defaultValue="sessions" className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <TabsList className="grid grid-cols-2 w-full max-w-xs mb-2">
            <TabsTrigger value="sessions" className="text-xs">
              {t("tp.sessions_tab")} ({sessions.length})
            </TabsTrigger>
            <TabsTrigger value="packages" className="text-xs">
              {t("tp.packages_tab")} ({packages.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="flex-1 min-h-0 overflow-y-auto border rounded-lg p-0">
            {isError ? (
              <div className="p-8 text-center text-sm text-destructive font-medium">
                {extractError(error)}
              </div>
            ) : isLoading ? (
              <div className="p-4"><LoadingRows /></div>
            ) : sessions.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("tp.no_sessions")}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0 border-b z-10">
                  <tr>
                    <th className="w-6 px-1 py-2"></th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.date")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("menu.courses")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("menu.groups")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("tp.present_count")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.price")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("tp.percentage")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("tp.earned")}</th>
                    {canRemove && <th className="text-end px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {sessions.map((s) => {
                    const isOpen = openSessionId === s.id;
                    return (
                    <Fragment key={s.id}>
                    <tr
                      className={`hover:bg-muted/30 transition-colors cursor-pointer ${isOpen ? "bg-muted/30" : ""}`}
                      onClick={() => setOpenSessionId(isOpen ? null : s.id)}
                      data-testid={`tp-session-row-${s.id}`}
                    >
                      <td className="px-1 py-2.5 text-muted-foreground">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={t("tp.show_students")}
                          title={t("tp.show_students")}
                          onClick={(e) => { e.stopPropagation(); setOpenSessionId(isOpen ? null : s.id); }}
                          className="h-6 w-6 grid place-items-center rounded hover:bg-muted"
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                        {formatDateTime(s.start_at)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{s.course_title}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{s.group_name}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold">
                        {s.present_count}
                        {s.pardoned_count > 0 && (
                          <span className="ms-1.5 text-[10px] font-normal text-violet-600 dark:text-violet-400" title={t("tp.pardoned_hint")}>
                            +{s.pardoned_count} {t("tp.pardoned")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{money(s.price_per_session)}</td>
                      <td className="px-3 py-2.5 font-mono">{s.teacher_percentage}%</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-foreground">{money(s.earned)}</td>
                      {canRemove && (
                        <td className="px-3 py-2.5 text-end">
                          <Button aria-label={t("actions.delete")}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => { e.stopPropagation(); handleRemoveSession(s); }}
                            disabled={removeSessionMut.isPending}
                            title={t("actions.delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                    {isOpen && (
                      <SessionStudentsPanel
                        teacherId={teacherId} sessionId={s.id} query={query} currency={currency}
                        colSpan={canRemove ? 9 : 8}
                      />
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TabsContent>

          <TabsContent value="packages" className="flex-1 min-h-0 overflow-y-auto border rounded-lg p-0">
            {isError ? (
              <div className="p-8 text-center text-sm text-destructive font-medium">
                {extractError(error)}
              </div>
            ) : isLoading ? (
              <div className="p-4"><LoadingRows /></div>
            ) : packages.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("tp.no_packages")}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0 border-b z-10">
                  <tr>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.date")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("menu.courses")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("menu.students")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.invoice")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.status")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("field.amount")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("tp.percentage")}</th>
                    <th className="text-start px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground">{t("tp.earned")}</th>
                    {canRemove && <th className="text-end px-3 py-2 font-medium uppercase tracking-wider text-muted-foreground"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {packages.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{p.course_title}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{p.student_name}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{p.invoice_number}</td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={p.status === "paid" ? "secondary" : "outline"}
                          className="text-[10px] uppercase font-mono"
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{money(p.amount)}</td>
                      <td className="px-3 py-2.5 font-mono">{p.teacher_percentage}%</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-foreground">{money(p.earned)}</td>
                      {canRemove && (
                        <td className="px-3 py-2.5 text-end">
                          <Button aria-label={t("actions.delete")}
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemovePackage(p)}
                            disabled={removePackageMut.isPending}
                            title={t("actions.delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
