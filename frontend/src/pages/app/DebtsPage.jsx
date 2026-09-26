import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleDollarSign, Trash2, Banknote, Users, AlertTriangle, Phone, Search, X, CheckCircle2 } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { usePermission } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, EmptyState, LoadingRows, Field } from "./_shared";

export default function DebtsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canDelete, canModify: canModifyDebts } = usePermission("debts");
  const { canAdd: canAddPayments, canModify: canModifyPayments } = usePermission("payments");
  const canPay = canModifyDebts || canAddPayments || canModifyPayments;

  const confirm = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const currency = tenant?.currency || "DZD";

  // Settle Debt Modal State
  const [payRow, setPayRow] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState("cash");
  const [payNotes, setPayNotes] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["payments-balances"],
    queryFn: async () => (await api.get("/payments/balances")).data,
  });

  const waiveMut = useMutation({
    mutationFn: (studentId) => api.delete(`/debts/${studentId}/waive`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      qc.invalidateQueries({ queryKey: ["payments-balances"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const payMut = useMutation({
    mutationFn: ({ studentId, payload }) => api.post(`/debts/${studentId}/pay`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("debts.pay_success"));
      qc.invalidateQueries({ queryKey: ["payments-balances"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["finance-report"] });
      setPayRow(null);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openPayModal = (row) => {
    const owed = Math.round(Math.abs(row.balance));
    setPayRow(row);
    setPayAmount(String(owed));
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod("cash");
    setPayNotes("");
  };

  const handlePaySubmit = (e) => {
    e.preventDefault();
    if (!payRow) return;
    const amountNum = parseFloat(payAmount);
    if (!amountNum || amountNum <= 0) {
      toast.error(t("validation.required") || "المبلغ مطلوب");
      return;
    }
    payMut.mutate({
      studentId: payRow.student_id,
      payload: {
        amount: amountNum,
        paid_at: payDate,
        method: payMethod,
        notes: payNotes,
      },
    });
  };

  const deleteDebt = async (row) => {
    const ok = await confirm({
      title: t("debts.confirm_delete_title"),
      description: t("debts.confirm_delete_description", {
        name: row.student_name,
        amount: `${Math.round(Math.abs(row.balance)).toLocaleString()} ${currency}`,
      }),
      confirmLabel: t("actions.delete"),
      destructive: true,
    });
    if (ok) waiveMut.mutate(row.student_id);
  };

  const debtors = useMemo(() => (data?.items || []).filter((r) => r.status === "owes"), [data]);
  const filtered = useMemo(() => {
    if (!q.trim()) return debtors;
    const term = q.trim().toLowerCase();
    return debtors.filter((r) =>
      (r.student_name || "").toLowerCase().includes(term) ||
      (r.parent_name || "").toLowerCase().includes(term) ||
      (r.student_phone || "").includes(term) ||
      (r.parent_phone || "").includes(term)
    );
  }, [debtors, q]);

  const totalOwed = useMemo(() => debtors.reduce((sum, r) => sum + Math.abs(r.balance), 0), [debtors]);
  const avgOwed = debtors.length > 0 ? Math.round(totalOwed / debtors.length) : 0;

  const totalPayRowOwed = payRow ? Math.round(Math.abs(payRow.balance)) : 0;
  const parsedPayAmount = parseFloat(payAmount) || 0;
  const remainingAfterPay = Math.max(0, totalPayRowOwed - parsedPayAmount);

  return (
    <div>
      <PageHeader title={t("menu.debts")} subtitle={t("subtitle.debts")} />

      {/* Top Financial KPI Metric Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
        <div className="surface-card p-4 sm:p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 grid place-items-center flex-shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("debts.students_count", "المدينون")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-foreground">
              {debtors.length}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3 border-destructive/20 bg-destructive/5">
          <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive grid place-items-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-destructive/90">
              {t("debts.total_owed", "مجموع الديون")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-destructive truncate">
              {Math.round(totalOwed).toLocaleString()} {currency}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground grid place-items-center flex-shrink-0">
            <Banknote className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("debts.avg_debt", "متوسط الدين")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-foreground truncate">
              {avgOwed.toLocaleString()} {currency}
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="surface-card p-3 sm:p-4 mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("debts.search_placeholder", "البحث باسم التلميذ، ولي الأمر، أو رقم الهاتف...")}
            className="ps-9 pe-9 h-9 text-xs sm:text-sm"
            data-testid="debts-search-input"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Badge variant="outline" className="font-mono text-xs hidden sm:inline-flex">
          {filtered.length} {t("common.results", "سجل")}
        </Badge>
      </div>

      {/* Main Container */}
      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-6"><LoadingRows /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            title={t(debtors.length === 0 ? "debts.none_title" : "debts.no_match_title")}
            description={t(debtors.length === 0 ? "debts.none_description" : "debts.no_match_description")}
          />
        ) : (
          <>
            {/* Mobile Cards View (md:hidden) */}
            <div className="md:hidden divide-y divide-border">
              {filtered.map((row) => {
                const contactName = row.parent_name || row.student_name;
                const contactPhone = row.parent_phone || row.student_phone;
                const debtAmt = Math.round(Math.abs(row.balance));
                return (
                  <div key={row.student_id} className="p-4 space-y-3 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-foreground">{row.student_name}</div>
                        {contactName !== row.student_name && (
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {t("field.parent")}: {contactName}
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="font-mono font-bold text-xs bg-destructive/10 text-destructive border-destructive/30 px-2 py-0.5">
                        {debtAmt.toLocaleString()} {currency}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg">
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase">{t("field.amount_paid")}</span>
                        <span className="font-mono font-medium">{Math.round(row.paid).toLocaleString()} {currency}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px] uppercase">{t("debts.owed")}</span>
                        <span className="font-mono font-bold text-destructive">{debtAmt.toLocaleString()} {currency}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {contactPhone ? (
                        <a
                          href={`tel:${contactPhone}`}
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-mono bg-muted/60 hover:bg-muted px-2.5 py-1.5 rounded-md transition-colors"
                          dir="ltr"
                        >
                          <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span>{contactPhone}</span>
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}

                      <div className="flex items-center gap-1.5 ms-auto">
                        {canPay && (
                          <Button
                            size="sm"
                            onClick={() => openPayModal(row)}
                            className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Banknote className="w-3.5 h-3.5" />
                            <span>{t("debts.pay_action")}</span>
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteDebt(row)}
                            disabled={waiveMut.isPending}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            title={t("actions.delete")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
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
                    {["field.student", "debts.contact", "field.amount_paid", "debts.owed"].map((k) => (
                      <th key={k} className="text-start px-4 py-3 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                        {t(k)}
                      </th>
                    ))}
                    {(canPay || canDelete) && <th className="px-4 py-3 text-end" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((row) => {
                    const contactName = row.parent_name || row.student_name;
                    const contactPhone = row.parent_phone || row.student_phone;
                    return (
                      <tr key={row.student_id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3.5 font-medium">{row.student_name}</td>
                        <td className="px-4 py-3.5 text-xs">
                          {contactPhone ? (
                            <div>
                              <div className="font-medium text-foreground">{contactName}</div>
                              <a
                                href={`tel:${contactPhone}`}
                                className="text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1 mt-0.5"
                                dir="ltr"
                              >
                                <Phone className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                                <span>{contactPhone}</span>
                              </a>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {Math.round(row.paid).toLocaleString()} {currency}
                        </td>
                        <td className="px-4 py-3.5 font-mono font-bold text-destructive">
                          {Math.round(Math.abs(row.balance)).toLocaleString()} {currency}
                        </td>
                        {(canPay || canDelete) && (
                          <td className="px-4 py-3.5 text-end">
                            <div className="flex items-center justify-end gap-1.5">
                              {canPay && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openPayModal(row)}
                                  className="h-8 gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800"
                                  data-testid={`debts-pay-${row.student_id}`}
                                >
                                  <Banknote className="w-3.5 h-3.5" />
                                  <span>{t("debts.pay_action")}</span>
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteDebt(row)}
                                  disabled={waiveMut.isPending}
                                  className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                  title={t("actions.delete")}
                                  data-testid={`debts-delete-${row.student_id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Settle Debt Modal */}
      <Dialog open={!!payRow} onOpenChange={(open) => !open && setPayRow(null)}>
        {payRow && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="font-display text-lg">
                {t("debts.pay_title")}
              </DialogTitle>
              <DialogDescription>
                {payRow.student_name} — {t("debts.owed")}:{" "}
                <span className="font-semibold text-destructive font-mono">
                  {totalPayRowOwed.toLocaleString()} {currency}
                </span>
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handlePaySubmit} className="space-y-4 pt-2">
              {/* Live Settlement Breakdown Widget */}
              <div className="bg-muted/40 p-3 rounded-lg border border-border/60 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("debts.owed", "الدين الإجمالي")}:</span>
                  <span className="font-mono font-bold text-destructive">{totalPayRowOwed.toLocaleString()} {currency}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("debts.paying_now", "المبلغ المدفوع الآن")}:</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">-{parsedPayAmount.toLocaleString()} {currency}</span>
                </div>
                <div className="pt-1.5 border-t border-border/80 flex items-center justify-between font-medium">
                  <span>{t("debts.remaining_debt", "المتبقي بعد الدفع")}:</span>
                  <span className={`font-mono font-bold ${remainingAfterPay === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {remainingAfterPay.toLocaleString()} {currency}
                    {remainingAfterPay === 0 && (
                      <span className="ms-1.5 text-[10px] font-sans font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                        {t("debts.settled_full", "تسوية كاملة")}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <Field label={t("debts.pay_amount")} required>
                <div className="relative">
                  <Input
                    type="number"
                    step="any"
                    min="0.01"
                    max={totalPayRowOwed}
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0"
                    required
                    className="font-mono text-base pe-24"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPayAmount(String(totalPayRowOwed))}
                    className="absolute end-1 top-1/2 -translate-y-1/2 h-7 px-2 text-[11px] font-semibold text-accent hover:bg-accent/10"
                  >
                    {t("debts.pay_all", "تسديد الكل")}
                  </Button>
                </div>
              </Field>

              <Field label={t("debts.pay_date")} required>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  required
                />
                <span className="text-[11px] text-muted-foreground mt-0.5 block">
                  {t("debts.pay_date_hint")}
                </span>
              </Field>

              <Field label={t("field.payment_method")}>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    {["cash", "card", "bank_transfer", "cheque", "other"].map((m) => (
                      <SelectItem key={m} value={m}>
                        {t(`method.${m}`) || m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label={t("field.notes")}>
                <Input
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder={t("field.notes")}
                />
              </Field>

              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPayRow(null)}
                >
                  {t("actions.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={payMut.isPending || !parsedPayAmount}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                >
                  <Banknote className="w-4 h-4" />
                  <span>{payMut.isPending ? t("actions.saving") : t("debts.pay_action")}</span>
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
