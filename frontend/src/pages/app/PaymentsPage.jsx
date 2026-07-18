import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { AlertTriangle, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

const DEFAULT_FORM = {
  student_id: "", course_id: "", kind: "monthly",
  amount: 0, discount: 0, method: "cash", status: "paid", reference: "", notes: "",
};

export default function PaymentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
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
              {overdue.total} overdue payment{overdue.total > 1 ? "s" : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {Math.round(overdue.total_owed).toLocaleString()} {tenant?.currency || "DZD"} outstanding past due date
            </div>
          </div>
        </div>
      )}
      <CrudPanel
      moduleKey="payments"
      endpoint="/payments"
      title={t("menu.payments")}
      subtitle="Invoices, receipts, and outstanding balances."
      emptyIcon={Wallet}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "invoice_number", label: "Invoice",
          render: (r) => (
            <div>
              <div className="font-mono text-xs">{r.invoice_number}</div>
              <div className="text-[11px] text-muted-foreground capitalize">{r.kind}</div>
            </div>
          ),
        },
        {
          key: "student", label: "Student",
          render: (r) => {
            const s = stuMap[r.student_id];
            return s ? `${s.first_name} ${s.last_name}` : "—";
          },
        },
        {
          key: "course", label: "Course",
          render: (r) => courseMap[r.course_id]?.title || <span className="text-muted-foreground">—</span>,
        },
        {
          key: "amount", label: "Amount",
          render: (r) => (
            <span className="font-mono font-semibold">
              {Math.round(r.amount).toLocaleString()} {tenant?.currency || "DZD"}
            </span>
          ),
        },
        { key: "method", label: "Method", render: (r) => <span className="capitalize text-xs">{r.method}</span> },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Student" required>
            <Select value={form.student_id || ""} onValueChange={(v) => setForm({ ...form, student_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="Select student" /></SelectTrigger>
              <SelectContent className="bg-popover max-h-72">
                {(students?.items || []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Course">
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kind">
            <Select value={form.kind || "monthly"} onValueChange={(v) => setForm({ ...form, kind: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="registration">Registration</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="course">Course</SelectItem>
                <SelectItem value="installment">Installment</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Method">
            <Select value={form.method || "cash"} onValueChange={(v) => setForm({ ...form, method: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount" required>
            <Input type="number" value={form.amount || 0} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
          </Field>
          <Field label="Discount">
            <Input type="number" value={form.discount || 0} onChange={(e) => setForm({ ...form, discount: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Status">
            <Select value={form.status || "paid"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="refunded">Refunded</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={form.reference || ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="TXN-1234" />
          </Field>
        </div>
      )}
      />
    </div>
  );
}
