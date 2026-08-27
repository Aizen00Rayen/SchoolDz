import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { AlertTriangle, Wallet, FileDown, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Field } from "./StudentsPage";
import { StudentSearchSelect, courseOptionLabel, tripOptionLabel } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError, openInvoicePdf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";

const downloadInvoice = (paymentId) => openInvoicePdf(paymentId).catch((e) => toast.error(extractError(e)));

const BALANCE_CLS = {
  owes: "text-destructive",
  overpaid: "text-info",
  settled: "",
};

const DEFAULT_FORM = {
  student_id: "", payment_for: "course", course_id: "", trip_id: "", kind: "monthly",
  amount: 0, discount: 0, method: "cash", status: "paid", reference: "", notes: "",
};

export default function PaymentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canAdd, canModify, canDelete } = usePermission("payments");
  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const { data: trips } = useQuery({
    queryKey: ["trips-list"],
    queryFn: async () => (await api.get("/trips")).data,
  });
  const { data: overdue } = useQuery({
    queryKey: ["payments-overdue"],
    queryFn: async () => (await api.get("/payments/overdue")).data,
  });
  const { data: balances } = useQuery({
    queryKey: ["payments-balances"],
    queryFn: async () => (await api.get("/payments/balances")).data,
  });
  const [balanceFilter, setBalanceFilter] = useState("all");
  const stuMap = Object.fromEntries((students?.items || []).map((s) => [s.id, s]));
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));
  const tripMap = Object.fromEntries((trips?.items || []).map((tr) => [tr.id, tr]));
  const balanceMap = Object.fromEntries((balances?.items || []).map((b) => [b.student_id, b]));

  return (
    <div>
      {overdue?.total > 0 && (
        <div className="surface-card p-4 mb-4 flex items-center gap-3 border-warning/30 bg-warning/5">
          <div className="w-9 h-9 rounded-lg bg-warning/10 grid place-items-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-warning" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {t("payments.overdue_count", { count: overdue.total })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("payments.overdue_amount", { amount: Math.round(overdue.total_owed).toLocaleString(), currency: tenant?.currency || "DZD" })}
            </div>
          </div>
        </div>
      )}
      <CrudPanel
      moduleKey="payments"
      endpoint="/payments"
      title={t("menu.payments")}
      subtitle={t("subtitle.payments")}
      emptyIcon={Wallet}
      defaultForm={DEFAULT_FORM}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      extraParams={balanceFilter !== "all" ? { balance_status: balanceFilter } : undefined}
      filterBar={(
        <div className="flex items-center gap-1.5">
          <Select value={balanceFilter} onValueChange={setBalanceFilter}>
            <SelectTrigger className="bg-background h-9 w-44" data-testid="payments-balance-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="all">{t("payments.balance_all")}</SelectItem>
              <SelectItem value="owes">{t("payments.balance_owes")}</SelectItem>
              <SelectItem value="overpaid">{t("payments.balance_overpaid")}</SelectItem>
              <SelectItem value="settled">{t("payments.balance_settled")}</SelectItem>
            </SelectContent>
          </Select>
          <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" title={t("payments.balance_explainer")} />
        </div>
      )}
      columns={[
        {
          key: "invoice_number", label: t("field.invoice"),
          render: (r) => (
            <div className="flex items-center gap-2">
              <div>
                <div className="font-mono text-xs">{r.invoice_number}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{t(`kind.${r.kind}`)}</div>
              </div>
              <Button
                type="button" variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0"
                onClick={() => downloadInvoice(r.id)}
                title={t("payments.download_invoice")}
                data-testid={`payments-invoice-download-${r.id}`}
              >
                <FileDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          ),
        },
        {
          key: "student", label: t("field.student"),
          render: (r) => {
            const s = stuMap[r.student_id];
            const b = balanceMap[r.student_id];
            if (!s) return "—";
            // The color reflects the student's overall running balance —
            // total paid vs the real cost of every session actually attended
            // — not the status of this one invoice. A student can have every
            // past payment marked "paid" and still show as owing, simply
            // because they attended a session more recently than their last
            // payment. Spell that out in the tooltip so it doesn't read as
            // a contradiction with the "Paid" pill sitting right next to it.
            const currency = tenant?.currency || "DZD";
            const tooltip = b
              ? t("payments.balance_tooltip", {
                  status: t(`payments.balance_${b.status}`),
                  paid: `${Math.round(b.paid).toLocaleString()} ${currency}`,
                  cost: `${Math.round(b.cost).toLocaleString()} ${currency}`,
                })
              : undefined;
            return (
              <span className={`font-medium ${b ? BALANCE_CLS[b.status] : ""}`} title={tooltip}>
                {s.first_name} {s.last_name}
              </span>
            );
          },
        },
        {
          key: "course", label: t("field.course"),
          render: (r) => {
            if (r.trip_id) {
              const trip = tripMap[r.trip_id];
              return trip ? tripOptionLabel(trip) : <span className="text-muted-foreground">—</span>;
            }
            const c = courseMap[r.course_id];
            return c ? courseOptionLabel(c, t) : <span className="text-muted-foreground">—</span>;
          },
        },
        {
          key: "amount", label: t("field.amount"),
          render: (r) => (
            <span className="font-mono font-semibold">
              {Math.round(r.amount).toLocaleString()} {tenant?.currency || "DZD"}
            </span>
          ),
        },
        { key: "method", label: t("field.method"), render: (r) => <span className="capitalize text-xs">{t(`method.${r.method}`)}</span> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => {
        const forType = form.payment_for || (form.trip_id ? "trip" : "course");
        return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.student")} required>
            <StudentSearchSelect value={form.student_id} onChange={(id) => setForm({ ...form, student_id: id })} />
          </Field>
          <div>
            <Label className="text-xs font-medium mb-1.5 block">{t("payments.for")}</Label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_for: "course", trip_id: "" })}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  forType === "course" ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                }`}
                data-testid="payments-for-course"
              >
                {t("payments.for_course")}
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, payment_for: "trip", course_id: "" })}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  forType === "trip" ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                }`}
                data-testid="payments-for-trip"
              >
                {t("payments.for_trip")}
              </button>
            </div>
          </div>
          {forType === "trip" ? (
            <Field label={t("field.trip")}>
              <Select value={form.trip_id || ""} onValueChange={(v) => setForm({ ...form, trip_id: v })}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {(trips?.items || []).map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>{tripOptionLabel(tr)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field label={t("field.course")}>
              <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {(courses?.items || []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{courseOptionLabel(c, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label={t("field.kind")}>
            <Select value={form.kind || "monthly"} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="registration">{t("kind.registration")}</SelectItem>
                <SelectItem value="monthly">{t("kind.monthly")}</SelectItem>
                <SelectItem value="course">{t("kind.course")}</SelectItem>
                <SelectItem value="per_session">{t("kind.per_session")}</SelectItem>
                <SelectItem value="trip">{t("kind.trip")}</SelectItem>
                <SelectItem value="other">{t("kind.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.method")}>
            <Select value={form.method || "cash"} onValueChange={(v) => setForm({ ...form, method: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="cash">{t("method.cash")}</SelectItem>
                <SelectItem value="card">{t("method.card")}</SelectItem>
                <SelectItem value="bank_transfer">{t("method.bank_transfer")}</SelectItem>
                <SelectItem value="cheque">{t("method.cheque")}</SelectItem>
                <SelectItem value="other">{t("method.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.amount")} required>
            <Input type="number" value={form.amount || 0} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
          </Field>
          <Field label={t("field.discount")}>
            <Input type="number" value={form.discount || 0} onChange={(e) => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label={t("field.status")}>
            <Select value={form.status || "paid"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="paid">{t("status.paid")}</SelectItem>
                <SelectItem value="pending">{t("status.pending")}</SelectItem>
                <SelectItem value="partial">{t("status.partial")}</SelectItem>
                <SelectItem value="refunded">{t("status.refunded")}</SelectItem>
                <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.reference")}>
            <Input value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="TXN-1234" />
          </Field>
        </div>
        );
      }}
      />
    </div>
  );
}
