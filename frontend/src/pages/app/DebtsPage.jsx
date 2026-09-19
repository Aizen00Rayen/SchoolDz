import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleDollarSign, Trash2, Banknote } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { usePermission } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
      toast.error(t("validation.required", "المبلغ مطلوب"));
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

  const debtors = (data?.items || []).filter((r) => r.status === "owes");
  const filtered = q.trim()
    ? debtors.filter((r) => r.student_name.toLowerCase().includes(q.trim().toLowerCase()))
    : debtors;
  const totalOwed = debtors.reduce((sum, r) => sum + Math.abs(r.balance), 0);

  const totalPayRowOwed = payRow ? Math.round(Math.abs(payRow.balance)) : 0;
  const parsedPayAmount = parseFloat(payAmount) || 0;
  const remainingAfterPay = Math.max(0, totalPayRowOwed - parsedPayAmount);

  return (
    <div>
      <PageHeader title={t("menu.debts")} subtitle={t("subtitle.debts")} />

      <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("actions.search")}
          className="h-9"
          data-testid="debts-search-input"
        />
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-end sm:text-start">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("debts.students_count")}</div>
          <div className="font-mono font-bold text-lg">{debtors.length}</div>
        </div>
        <div className="rounded-lg bg-destructive/10 px-3 py-2 text-end sm:text-start">
          <div className="text-[10px] uppercase tracking-widest text-destructive/80">{t("debts.total_owed")}</div>
          <div className="font-mono font-bold text-lg text-destructive">
            {Math.round(totalOwed).toLocaleString()} {currency}
          </div>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CircleDollarSign}
            title={t(debtors.length === 0 ? "debts.none_title" : "debts.no_match_title")}
            description={t(debtors.length === 0 ? "debts.none_description" : "debts.no_match_description")}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.student", "debts.contact", "field.amount_paid", "debts.owed"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                  {(canPay || canDelete) && <th className="px-4 py-2.5 text-end" />}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const contactName = row.parent_name || row.student_name;
                  const contactPhone = row.parent_phone || row.student_phone;
                  return (
                    <tr key={row.student_id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-medium">{row.student_name}</td>
                      <td className="px-4 py-3 text-xs">
                        {contactPhone ? (
                          <div>
                            <div>{contactName}</div>
                            <div className="text-muted-foreground font-mono">{contactPhone}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {Math.round(row.paid).toLocaleString()} {currency}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-destructive">
                        {Math.round(Math.abs(row.balance)).toLocaleString()} {currency}
                      </td>
                      {(canPay || canDelete) && (
                        <td className="px-4 py-3 text-end">
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
                                aria-label={t("actions.delete")}
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
              <Field label={t("debts.pay_amount")} required>
                <Input
                  type="number"
                  step="any"
                  min="0.01"
                  max={totalPayRowOwed}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0"
                  required
                  className="font-mono text-base"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                  <button
                    type="button"
                    onClick={() => setPayAmount(String(totalPayRowOwed))}
                    className="text-accent underline hover:opacity-80"
                  >
                    {t("debts.owed")}: {totalPayRowOwed.toLocaleString()} {currency}
                  </button>
                  {parsedPayAmount > 0 && parsedPayAmount < totalPayRowOwed && (
                    <span className="text-warning font-medium">
                      {t("debts.remaining_debt")}: {remainingAfterPay.toLocaleString()} {currency}
                    </span>
                  )}
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
                        {t(`method.${m}`, m)}
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
