import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { AlertTriangle, Wallet, FileDown, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Field } from "./StudentsPage";
import { StudentSearchSelect, courseOptionLabel, tripOptionLabel, bookOptionLabel, paymentItemTitle, paymentKindLabel } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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

const EMPTY_ITEM = { item_type: "course", kind: "monthly", course_id: "", trip_id: "", book_id: "", amount: 0 };

// Default to the full price (100% combined) — nothing waived unless the
// secretary actively edits one of the two share fields down.
const DEFAULT_FORM = {
  student_id: "", items: [{ ...EMPTY_ITEM }],
  teacher_percentage: 0, school_percentage: 100,
  method: "cash", status: "paid", reference: "", notes: "",
};

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

/** A bill's line-item titles, joined — "Test Course + Museum Trip". Reads
 * straight off the API's nested items (course_title/trip_title/book_title
 * come pre-resolved server-side), no local course/trip/book lookups needed. */
function billItemsSummary(payment) {
  const items = payment.items || [];
  if (items.length === 0) return "—";
  return items.map(paymentItemTitle).join(" + ");
}

function itemAmount(item) {
  return parseFloat(item.amount) || 0;
}

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
  const { data: books } = useQuery({
    queryKey: ["books-list"],
    queryFn: async () => (await api.get("/books")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
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
  const [detailStudentId, setDetailStudentId] = useState(null);
  const crudRef = useRef(null);
  const stuMap = Object.fromEntries((students?.items || []).map((s) => [s.id, s]));
  const teacherMap = Object.fromEntries((teachers?.items || []).map((t) => [t.id, t]));
  const balanceMap = Object.fromEntries((balances?.items || []).map((b) => [b.student_id, b]));

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["payments-student-summary", detailStudentId],
    queryFn: async () => (await api.get("/payments/student-summary", { params: { student_id: detailStudentId } })).data,
    enabled: Boolean(detailStudentId),
  });

  const subtotalOf = (items) => (items || []).reduce((sum, it) => sum + itemAmount(it), 0);

  // Best-effort default for the teacher-% field: if the bill's course item
  // matches a group this student is already enrolled in, suggest that
  // group's teacher's standing percentage. Returns null when it can't be
  // resolved (no matching group/teacher) — the field is always editable
  // either way.
  const suggestTeacherPct = (studentId, courseId) => {
    if (!studentId || !courseId) return null;
    const group = (groups?.items || []).find(
      (g) => g.course_id === courseId && (g.student_ids || []).includes(studentId)
    );
    const teacher = group ? teacherMap[group.teacher_id] : null;
    return teacher ? parseFloat(teacher.payment_percentage) || 0 : null;
  };

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
      ref={crudRef}
      moduleKey="payments"
      endpoint="/payments"
      title={t("menu.payments")}
      subtitle={t("subtitle.payments")}
      emptyIcon={Wallet}
      defaultForm={DEFAULT_FORM}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      // Items are set once at creation and aren't editable afterward (see
      // PaymentViewSet.create's docstring) — editing a row just needs its
      // items available to render read-only, not converted into the
      // create-form's editing shape.
      prepareEditForm={(row) => ({ ...row })}
      // The item rows carry frontend-only bookkeeping (item_type) and, on
      // create, only the one FK relevant to their type — cleanPayload's
      // shallow strip doesn't reach inside the items array, so build the
      // exact wire shape here instead of leaving stray empty-string FKs
      // (e.g. trip_id: "" on a course item) that would fail validation.
      preparePayload={(form) => {
        const { items: rawItems, ...rest } = form;
        // `discount` is derived, never typed directly — recompute it from
        // teacher_percentage/school_percentage whenever either is actually
        // set (a fresh bill always has both; see DEFAULT_FORM). A legacy
        // bill from before this feature has both null — leave its stored
        // discount untouched rather than silently zeroing it out just
        // because someone re-saved its method/status.
        const hasPercentages = !form.id || rest.teacher_percentage != null || rest.school_percentage != null;
        if (hasPercentages) {
          const subtotal = subtotalOf(rawItems);
          const teacherPct = parseFloat(rest.teacher_percentage ?? 0) || 0;
          const schoolPct = parseFloat(rest.school_percentage ?? 100) || 0;
          rest.teacher_percentage = teacherPct;
          rest.school_percentage = schoolPct;
          rest.discount = Math.round(Math.max(0, subtotal * (1 - (teacherPct + schoolPct) / 100)) * 100) / 100;
        }
        // Editing: items are read-only server-side and immutable in this
        // UI (see the isEditing branch below) — nothing to send for them.
        if (form.id) return rest;
        const items = (rawItems || []).map((it) => {
          const out = { kind: it.item_type === "book" ? "book" : it.kind, amount: itemAmount(it) };
          if (it.item_type === "course" && it.course_id) out.course_id = it.course_id;
          if (it.item_type === "trip" && it.trip_id) out.trip_id = it.trip_id;
          if (it.item_type === "book" && it.book_id) out.book_id = it.book_id;
          return out;
        });
        return { ...rest, items };
      }}
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
                <div className="text-[11px] text-muted-foreground capitalize">{paymentKindLabel(r, t)}</div>
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
              <button
                type="button"
                className={`font-medium hover:underline text-start ${b ? BALANCE_CLS[b.status] : ""}`}
                title={tooltip}
                onClick={() => setDetailStudentId(r.student_id)}
                data-testid={`payments-student-detail-${r.student_id}`}
              >
                {s.first_name} {s.last_name}
              </button>
            );
          },
        },
        {
          key: "course", label: t("field.course"),
          render: (r) => <span className="text-sm">{billItemsSummary(r)}</span>,
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
        const isEditing = Boolean(form.id);
        const items = form.items || [];
        const subtotal = subtotalOf(items);
        const teacherPct = parseFloat(form.teacher_percentage ?? 0) || 0;
        const schoolPct = parseFloat(form.school_percentage ?? 100) || 0;
        const discount = Math.max(0, subtotal * (1 - (teacherPct + schoolPct) / 100));
        const total = Math.max(0, subtotal - discount);
        const currency = tenant?.currency || "DZD";

        const updateItem = (idx, patch) => {
          setForm({ ...form, items: items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
        };
        const setItemType = (idx, item_type) => {
          // Fresh object per type switch — no leftover course_id/trip_id/
          // book_id from a previous type sticking around unseen.
          updateItem(idx, { ...EMPTY_ITEM, item_type });
        };
        const addItem = () => setForm({ ...form, items: [...items, { ...EMPTY_ITEM }] });
        const removeItem = (idx) => setForm({ ...form, items: items.filter((_, i) => i !== idx) });

        return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("field.student")} required>
              {isEditing ? (
                // Who a bill belongs to isn't editable after creation —
                // its items/balance accounting is tied to this student.
                <div className="flex items-center h-10 px-3 rounded-lg border border-border bg-muted/40 text-sm font-medium">
                  {(() => {
                    const s = stuMap[form.student_id];
                    return s ? `${s.first_name} ${s.last_name}` : form.student_id;
                  })()}
                </div>
              ) : (
                <StudentSearchSelect value={form.student_id} onChange={(id) => setForm({ ...form, student_id: id })} />
              )}
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
          </div>

          <div>
            <Label className="text-xs font-medium mb-1.5 block">{t("payments.items")}</Label>
            <div className="space-y-2">
              {isEditing ? (
                // Immutable once billed — see preparePayload's comment.
                // Show what's on the invoice, not an editable cart.
                <div className="rounded-lg border border-border divide-y divide-border">
                  {items.map((item, idx) => (
                    <div key={item.id || idx} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span>{paymentItemTitle(item)}</span>
                      <span className="font-mono">{Math.round(itemAmount(item)).toLocaleString()} {currency}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {items.map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-border p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="inline-flex rounded-md border border-border overflow-hidden">
                          {["course", "trip", "book"].map((t2) => (
                            <button
                              key={t2}
                              type="button"
                              onClick={() => setItemType(idx, t2)}
                              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                                item.item_type === t2 ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                              }`}
                              data-testid={`payments-item-${idx}-type-${t2}`}
                            >
                              {t(`payments.for_${t2}`)}
                            </button>
                          ))}
                        </div>
                        {items.length > 1 && (
                          <Button
                            type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                            onClick={() => removeItem(idx)}
                            data-testid={`payments-item-${idx}-remove`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {item.item_type === "trip" ? (
                          <Field label={t("field.trip")}>
                            <Select
                              value={item.trip_id || ""}
                              onValueChange={(v) => {
                                const trip = (trips?.items || []).find((tr) => tr.id === v);
                                updateItem(idx, { trip_id: v, amount: trip ? parseFloat(trip.price) : item.amount });
                              }}
                            >
                              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent className="bg-popover">
                                {(trips?.items || []).map((tr) => (
                                  <SelectItem key={tr.id} value={tr.id}>{tripOptionLabel(tr)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        ) : item.item_type === "book" ? (
                          <Field label={t("field.book")}>
                            <Select
                              value={item.book_id || ""}
                              onValueChange={(v) => {
                                const book = (books?.items || []).find((b) => b.id === v);
                                updateItem(idx, { book_id: v, amount: book ? parseFloat(book.price) : item.amount });
                              }}
                            >
                              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent className="bg-popover">
                                {(books?.items || []).map((b) => (
                                  <SelectItem key={b.id} value={b.id} disabled={b.in_stock_count === 0}>
                                    {bookOptionLabel(b)} {b.in_stock_count === 0 ? `(${t("books.out_of_stock")})` : `(${b.in_stock_count})`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        ) : (
                          <Field label={t("field.course")}>
                            <Select
                              value={item.course_id || ""}
                              onValueChange={(v) => {
                                const patch = { items: items.map((it, i) => (i === idx ? { ...it, course_id: v } : it)) };
                                // Only auto-suggest once, before the secretary has
                                // touched either share field — never overwrite an
                                // in-progress manual edit.
                                if (form.teacher_percentage === DEFAULT_FORM.teacher_percentage && form.school_percentage === DEFAULT_FORM.school_percentage) {
                                  const suggested = suggestTeacherPct(form.student_id, v);
                                  if (suggested != null) {
                                    patch.teacher_percentage = suggested;
                                    patch.school_percentage = Math.max(0, 100 - suggested);
                                  }
                                }
                                setForm({ ...form, ...patch });
                              }}
                            >
                              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent className="bg-popover">
                                {(courses?.items || []).map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{courseOptionLabel(c, t)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                        )}

                        {item.item_type !== "book" && (
                          <Field label={t("field.kind")}>
                            <Select value={item.kind || "monthly"} onValueChange={(v) => updateItem(idx, { kind: v })}>
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
                        )}

                        <Field label={t("field.amount")} required>
                          <Input
                            type="number" value={item.amount || 0}
                            onChange={(e) => updateItem(idx, { amount: parseFloat(e.target.value) || 0 })}
                            required
                            data-testid={`payments-item-${idx}-amount`}
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="payments-add-item">
                    <Plus className="w-3.5 h-3.5 me-1.5" /> {t("payments.add_item")}
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("payments.teacher_percentage")}>
              <Input
                type="number" min="0" max="100" value={teacherPct}
                onChange={(e) => setForm({ ...form, teacher_percentage: parseFloat(e.target.value) || 0 })}
                data-testid="payments-teacher-percentage"
              />
            </Field>
            <Field label={t("payments.school_percentage")}>
              <Input
                type="number" min="0" max="100" value={schoolPct}
                onChange={(e) => setForm({ ...form, school_percentage: parseFloat(e.target.value) || 0 })}
                data-testid="payments-school-percentage"
              />
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

          <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("payments.subtotal")}</span>
              <span className="font-mono">{Math.round(subtotal).toLocaleString()} {currency}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>{t("field.discount")}</span>
                <span className="font-mono">&minus;{Math.round(discount).toLocaleString()} {currency}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold pt-1 border-t border-border">
              <span>{t("payments.total")}</span>
              <span className="font-mono">{Math.round(total).toLocaleString()} {currency}</span>
            </div>
          </div>
        </div>
        );
      }}
      />

      <Dialog open={Boolean(detailStudentId)} onOpenChange={(o) => !o && setDetailStudentId(null)}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {detail?.student_name || t("payments.detail_title")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("payments.detail_title")}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                <InfoRow label={t("payments.total_paid")} value={`${Math.round(detail.balance.paid).toLocaleString()} ${tenant?.currency || "DZD"}`} />
                <InfoRow label={t("payments.total_cost")} value={`${Math.round(detail.balance.cost).toLocaleString()} ${tenant?.currency || "DZD"}`} />
                <div className={`flex justify-between text-sm font-semibold pt-1 border-t border-border ${BALANCE_CLS[detail.balance.status] || ""}`}>
                  <span>{t("payments.balance_label")} — {t(`payments.balance_${detail.balance.status}`)}</span>
                  <span className="font-mono">{Math.round(detail.balance.balance).toLocaleString()} {tenant?.currency || "DZD"}</span>
                </div>
              </div>

              <div>
                <Label className="text-xs font-medium mb-1.5 block">{t("payments.enrolled_courses")}</Label>
                {detail.courses.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t("payments.no_courses")}</div>
                ) : (
                  <div className="rounded-lg border border-border divide-y divide-border">
                    {detail.courses.map((c) => (
                      <div key={c.group_id} className="px-3 py-2 text-sm flex items-center justify-between">
                        <span>{c.course_title}</span>
                        <span className="text-xs text-muted-foreground">{c.group_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canAdd && (
                <Button
                  type="button"
                  className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  onClick={() => {
                    crudRef.current?.openCreateWith({ student_id: detailStudentId });
                    setDetailStudentId(null);
                  }}
                  data-testid="payments-detail-record-payment"
                >
                  <Wallet className="w-4 h-4 me-2" /> {t("payments.record_payment")}
                </Button>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
