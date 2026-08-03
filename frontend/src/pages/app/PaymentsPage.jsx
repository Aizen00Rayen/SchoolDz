import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { AlertTriangle, Wallet, FileDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError, openInvoicePdf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";

const downloadInvoice = (paymentId) => openInvoicePdf(paymentId).catch((e) => toast.error(extractError(e)));

const DEFAULT_FORM = {
  student_id: "", course_id: "", kind: "monthly",
  amount: 0, discount: 0, method: "cash", status: "paid", reference: "", notes: "",
};

export default function PaymentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canEdit } = usePermission("payments");
  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const { data: overdue } = useQuery({
    queryKey: ["payments-overdue"],
    queryFn: async () => (await api.get("/payments/overdue")).data,
  });
  const stuMap = Object.fromEntries((students?.items || []).map((s) => [s.id, s]));
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));

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
      canEdit={canEdit}
      canCreate={canEdit}
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
            return s ? `${s.first_name} ${s.last_name}` : "—";
          },
        },
        {
          key: "course", label: t("field.course"),
          render: (r) => courseMap[r.course_id]?.title || <span className="text-muted-foreground">—</span>,
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
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.student")} required>
            <Select value={form.student_id || ""} onValueChange={(v) => setForm({ ...form, student_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder={t("placeholder.select_student")} /></SelectTrigger>
              <SelectContent className="bg-popover max-h-72">
                {(students?.items || []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.course")}>
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.kind")}>
            <Select value={form.kind || "monthly"} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="registration">{t("kind.registration")}</SelectItem>
                <SelectItem value="monthly">{t("kind.monthly")}</SelectItem>
                <SelectItem value="course">{t("kind.course")}</SelectItem>
                <SelectItem value="installment">{t("kind.installment")}</SelectItem>
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
      )}
      />
    </div>
  );
}
