import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2, Percent } from "lucide-react";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { AlertTriangle, Wallet, FileDown, Info, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Field } from "./StudentsPage";
import { StudentSearchSelect, courseOptionLabel, groupOptionLabel, tripOptionLabel, bookOptionLabel, paymentItemTitle, paymentKindLabel } from "./_shared";
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

// teacher_percentage/school_percentage live per-item (a bill can cover two
// courses taught by two different teachers) — null until a group resolves
// one, matching "nothing waived" (the item's full amount, no discount) the
// same way DEFAULT_FORM used to mean at the bill level.
const EMPTY_ITEM = {
  item_type: "course", kind: "monthly", course_id: "", group_id: "", trip_id: "", book_id: "", amount: 0,
  teacher_percentage: null, school_percentage: null,
  status: "paid", pardon_type: "both", pay_later: false, due_date: "",
  reduction: 0, reduction_target: "total",
};

const DEFAULT_FORM = {
  student_id: "", items: [{ ...EMPTY_ITEM }],
  method: "cash", status: "paid", pardon_type: null, notes: "",
  reduction: "", reduction_target: "total",
  paid_at: new Date().toISOString().slice(0, 10),
  due_date: "",
};

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

function subtotalOf(items) {
  return items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
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

/** How much of one item's own amount is waived — mirrors the backend's
 * _payment_item_discount exactly (see views.py), so the live preview here
 * always matches what the server will actually charge.
 * When status is 'pardoned' or item has pardon_type:
 *   - 'both': 100% waived (discount = amount, pays 0 DZD).
 *   - 'school': school part waived (discount = amount * school_pct/100, student pays teacher_pct).
 *   - 'teacher': teacher part waived (discount = amount * teacher_pct/100, student pays school_pct).
 */
function itemDiscount(item) {
  if (item.status === "cancelled") return 0;
  const amt = itemAmount(item);
  const red = parseFloat(item.reduction) || 0;
  if (item.status === "pardoned" || item.status === "pardonned" || (item.pardon_type && item.pay_later)) {
    const pType = item.pardon_type || "both";
    if (pType === "both") {
      return amt;
    }
    let teacherPct = parseFloat(item.teacher_percentage) || 0;
    let schoolPct = item.school_percentage != null && item.school_percentage !== ""
      ? parseFloat(item.school_percentage)
      : 0;
    if (teacherPct === 0 && schoolPct === 0) {
      teacherPct = 50;
      schoolPct = 50;
    } else if (teacherPct === 0) {
      teacherPct = Math.max(0, 100 - schoolPct);
    } else if (schoolPct === 0) {
      schoolPct = Math.max(0, 100 - teacherPct);
    }
    if (pType === "school") {
      return Math.min(amt, Math.round((amt * (schoolPct / 100) + red) * 100) / 100);
    }
    if (pType === "teacher") {
      return Math.min(amt, Math.round((amt * (teacherPct / 100) + red) * 100) / 100);
    }
    return amt;
  }
  let disc = 0;
  if (item.item_type === "course") {
    const teacherPct = item.teacher_percentage;
    const schoolPct = item.school_percentage;
    if (teacherPct != null && teacherPct !== "" && schoolPct != null && schoolPct !== "") {
      disc = Math.max(0, amt * (1 - (parseFloat(teacherPct) + parseFloat(schoolPct)) / 100));
    }
  }
  return Math.min(amt, disc + red);
}

/** An existing item off the API has no `item_type` (that's a frontend-only
 * concept for which fields to show) — recover it from whichever FK is set,
 * so an edited bill's items render with the same item cards create() uses. */
function deriveItemType(item) {
  if (item.book_id) return "book";
  if (item.trip_id) return "trip";
  return "course";
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
    queryKey: ["payments", "overdue"],
    queryFn: async () => (await api.get("/payments/overdue")).data,
  });
  const { data: balances } = useQuery({
    queryKey: ["payments", "balances"],
    queryFn: async () => (await api.get("/payments/balances")).data,
  });
  const [balanceFilter, setBalanceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePeriod, setDatePeriod] = useState("all");
  const [customDates, setCustomDates] = useState({ from: "", to: "" });
  const [detailStudentId, setDetailStudentId] = useState(null);
  const crudRef = useRef(null);
  const stuMap = Object.fromEntries((students?.items || []).map((s) => [s.id, s]));
  const teacherMap = Object.fromEntries((teachers?.items || []).map((t) => [t.id, t]));
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));
  const balanceMap = Object.fromEntries((balances?.items || []).map((b) => [b.student_id, b]));

  const extraParams = useMemo(() => {
    const params = {};
    if (balanceFilter !== "all") {
      params.balance_status = balanceFilter;
    }
    if (statusFilter !== "all") {
      params.status = statusFilter;
    }

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (datePeriod === "day") {
      const today = fmt(now);
      params.period = "day";
      params.from = today;
      params.to = today;
    } else if (datePeriod === "week") {
      const dayOfWeek = (now.getDay() + 6) % 7;
      const start = new Date(now);
      start.setDate(now.getDate() - dayOfWeek);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      params.period = "week";
      params.from = fmt(start);
      params.to = fmt(end);
    } else if (datePeriod === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      params.period = "month";
      params.from = fmt(start);
      params.to = fmt(end);
    } else if (datePeriod === "custom") {
      if (customDates.from) params.from = customDates.from;
      if (customDates.to) params.to = customDates.to;
    }
    return Object.keys(params).length > 0 ? params : undefined;
  }, [balanceFilter, statusFilter, datePeriod, customDates]);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["payments-student-summary", detailStudentId],
    queryFn: async () => (await api.get("/payments/student-summary", { params: { student_id: detailStudentId } })).data,
    enabled: Boolean(detailStudentId),
  });

  const subtotalOf = (items) => (items || []).reduce((sum, it) => sum + itemAmount(it), 0);

  // Groups teaching a given course — resolved from the course itself, not
  // from whether this particular student already happens to be enrolled, so
  // a brand-new registration gets the same automatic percentage a returning
  // student's payment does.
  const groupsForCourse = (courseId) => (groups?.items || []).filter((g) => g.course_id === courseId);

  // A group's teacher's standing percentage (from the Teacher Payments
  // page), as the {teacher_percentage, school_percentage} pair to prefill an
  // item with. Returns nulls when the group has no assigned teacher.
  const pctFromGroup = (group) => {
    const teacher = group ? teacherMap[group.teacher_id] : null;
    if (!teacher) return { teacher_percentage: null, school_percentage: null };
    const pct = parseFloat(teacher.payment_percentage) || 0;
    return { teacher_percentage: pct, school_percentage: Math.round(Math.max(0, 100 - pct) * 100) / 100 };
  };

  const pctFromCourse = (courseId) => {
    const candidates = groupsForCourse(courseId);
    if (candidates.length === 1) return pctFromGroup(candidates[0]);
    if (candidates.length > 1) {
      const teacherIds = new Set(candidates.map((g) => g.teacher_id).filter(Boolean));
      if (teacherIds.size === 1) {
        const teacher = teacherMap[[...teacherIds][0]];
        if (teacher) {
          const pct = parseFloat(teacher.payment_percentage) || 0;
          return { teacher_percentage: pct, school_percentage: Math.round(Math.max(0, 100 - pct) * 100) / 100 };
        }
      }
    }
    return { teacher_percentage: null, school_percentage: null };
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
      // A saved item has no `item_type` (that's frontend-only bookkeeping
      // for which fields to show) — recover it so an edited bill's items
      // render with the same editable cards create() uses.
      prepareEditForm={(row) => ({
        ...row,
        pardon_type: row.pardon_type || null,
        reduction: row.reduction != null && parseFloat(row.reduction) > 0 ? String(row.reduction) : "",
        reduction_target: row.reduction_target || "total",
        paid_at: row.paid_at ? row.paid_at.slice(0, 10) : "",
        due_date: row.due_date ? row.due_date.slice(0, 10) : "",
        items: (row.items || []).map((it) => {
          const isPendingPardon = it.status === "pending" && Boolean(it.pardon_type);
          return {
            ...it,
            item_type: deriveItemType(it),
            status: isPendingPardon ? "pardoned" : (it.status || row.status || "paid"),
            pardon_type: it.pardon_type || row.pardon_type || "both",
            pay_later: isPendingPardon,
            due_date: it.due_date ? it.due_date.slice(0, 10) : "",
          };
        }),
      })}
      // The item rows carry frontend-only bookkeeping (item_type) and, on
      // create, only the one FK relevant to their type — cleanPayload's
      // shallow strip doesn't reach inside the items array, so build the
      // exact wire shape here instead of leaving stray empty-string FKs
      // (e.g. trip_id: "" on a course item) that would fail validation.
      // `discount` is never sent — the server derives it from each item's
      // own teacher_percentage/school_percentage (see PaymentViewSet's
      // _payment_item_discount), the same math itemDiscount() previews here.
      // Sending items on an edit replaces the bill's whole item list
      // server-side (see PaymentViewSet.update) — how a bill billed under
      // an earlier price/percentage rule gets corrected in place.
      preparePayload={(form) => {
        const { items: rawItems, reduction, reduction_target, ...rest } = form;
        const reductionVal = Math.max(0, parseFloat(reduction) || 0);
        const reductionTarget = reduction_target || "total";

        const items = (rawItems || []).map((it) => {
          let itemStatus = it.status || form.status || "paid";
          if (it.pay_later && (it.status === "pardoned" || it.status === "pardonned")) {
            itemStatus = "pending";
          }
          const out = {
            kind: it.item_type === "book" ? "book" : it.kind,
            amount: itemAmount(it),
            status: itemStatus,
          };
          if (it.due_date) out.due_date = it.due_date;
          if (it.pardon_type && (it.status === "pardoned" || it.status === "pardonned" || it.pay_later)) {
            out.pardon_type = it.pardon_type || "both";
          }
          if (it.item_type === "course" && it.course_id) {
            out.course_id = it.course_id;
            if (it.group_id) out.group_id = it.group_id;
            if (it.teacher_percentage != null && it.teacher_percentage !== "") {
              out.teacher_percentage = parseFloat(it.teacher_percentage);
            }
            if (it.school_percentage != null && it.school_percentage !== "") {
              out.school_percentage = parseFloat(it.school_percentage);
            }
            if ((out.pardon_type === "school" || out.pardon_type === "teacher") && out.teacher_percentage == null && out.school_percentage == null) {
              out.teacher_percentage = 50;
              out.school_percentage = 50;
            } else if (out.teacher_percentage != null && out.school_percentage == null) {
              out.school_percentage = Math.round(Math.max(0, 100 - out.teacher_percentage) * 100) / 100;
            } else if (out.school_percentage != null && out.teacher_percentage == null) {
              out.teacher_percentage = Math.round(Math.max(0, 100 - out.school_percentage) * 100) / 100;
            }
          }
          if (it.item_type === "trip" && it.trip_id) out.trip_id = it.trip_id;
          if (it.item_type === "book" && it.book_id) out.book_id = it.book_id;
          return out;
        });
        const firstPardon = items.find((it) => it.pardon_type);
        if (firstPardon) {
          rest.pardon_type = firstPardon.pardon_type;
        } else if (rest.status === "pardoned") {
          rest.pardon_type = rest.pardon_type || "both";
        }

        const allItemsPending = items.length > 0 && items.every((it) => it.status === "pending");
        const anyItemPending = items.some((it) => it.status === "pending");
        if (allItemsPending) {
          rest.status = "pending";
          rest.paid_at = null;
        } else if (anyItemPending && rest.status !== "pending") {
          rest.status = "partial";
        }
        const pendingItemWithDue = items.find((it) => it.status === "pending" && it.due_date);
        if (pendingItemWithDue && !rest.due_date) {
          rest.due_date = pendingItemWithDue.due_date;
        }

        return {
          ...rest,
          reduction: reductionVal,
          reduction_target: reductionTarget,
          items,
        };
      }}
      onBeforeSubmit={(form) => {
        if (!form.student_id) {
          toast.error("يرجى اختيار التلميذ أولاً");
          return false;
        }
        if (!form.items || form.items.length === 0) {
          toast.error("يرجى إضافة عنصر واحد على الأقل للدفع");
          return false;
        }
        return true;
      }}
      extraParams={extraParams}
      filterBar={(
        <div className="flex flex-wrap items-center gap-2">
          {/* Day / Week / Month / Custom date period buttons */}
          <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 shrink-0">
            {[
              { key: "all", label: t("payments.period_all") },
              { key: "day", label: t("payments.period_day") },
              { key: "week", label: t("payments.period_week") },
              { key: "month", label: t("payments.period_month") },
              { key: "custom", label: t("payments.period_custom") },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setDatePeriod(p.key)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                  datePeriod === p.key
                    ? "bg-background text-foreground shadow-sm font-semibold border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`payments-period-${p.key}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {datePeriod === "custom" && (
            <div className="flex items-center gap-1.5 shrink-0">
              <Input
                type="date"
                value={customDates.from}
                onChange={(e) => setCustomDates((prev) => ({ ...prev, from: e.target.value }))}
                className="h-9 w-32 text-xs bg-background"
                placeholder={t("reports.from")}
                data-testid="payments-custom-from"
              />
              <span className="text-muted-foreground text-xs">&ndash;</span>
              <Input
                type="date"
                value={customDates.to}
                onChange={(e) => setCustomDates((prev) => ({ ...prev, to: e.target.value }))}
                className="h-9 w-32 text-xs bg-background"
                placeholder={t("reports.to")}
                data-testid="payments-custom-to"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 shrink-0">
            <Select value={balanceFilter} onValueChange={setBalanceFilter}>
              <SelectTrigger className="bg-background h-9 w-40" data-testid="payments-balance-filter">
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

          <div className="flex items-center gap-1.5 shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-background h-9 w-36" data-testid="payments-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="all">{t("payments.status_all")}</SelectItem>
                <SelectItem value="paid">{t("status.paid")}</SelectItem>
                <SelectItem value="pending">{t("status.pending")}</SelectItem>
                <SelectItem value="partial">{t("status.partial")}</SelectItem>
                <SelectItem value="pardoned">{t("status.pardoned")}</SelectItem>
                <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
                <SelectItem value="refunded">{t("status.refunded")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
          key: "date",
          label: t("field.date"),
          render: (r) => {
            const dateVal = r.paid_at || r.due_date || r.created_at;
            if (!dateVal) return <span className="text-muted-foreground text-xs">—</span>;
            const dateStr = dateVal.slice(0, 10);
            const isPaid = r.status === "paid" || (r.status === "partial" && r.paid_at);
            const isPending = r.status === "pending";
            const isOverdue = isPending && r.due_date && new Date(r.due_date) < new Date();

            let tagTone = "bg-muted/70 text-foreground border-border";
            let subLabel = null;

            if (r.paid_at) {
              tagTone = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25";
              try {
                const d = new Date(r.paid_at);
                const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                if (time && time !== "Invalid Date") {
                  subLabel = (
                    <span className="text-[10px] text-muted-foreground font-mono ps-1">
                      {time}
                    </span>
                  );
                }
              } catch (_) {}
            } else if (r.due_date) {
              if (isOverdue) {
                tagTone = "bg-destructive/10 text-destructive border-destructive/25";
                subLabel = (
                  <span className="text-[10px] font-semibold text-destructive ps-1">
                    {t("payments.overdue")}
                  </span>
                );
              } else {
                tagTone = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25";
                subLabel = (
                  <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 ps-1">
                    {t("payments.due")}: {r.due_date}
                  </span>
                );
              }
            }

            return (
              <div className="flex flex-col gap-0.5 items-start">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${tagTone}`}
                  data-testid={`payments-date-tag-${r.id}`}
                >
                  <Calendar className="w-3 h-3 shrink-0 opacity-75" />
                  {dateStr}
                </span>
                {subLabel}
              </div>
            );
          },
        },
        {
          key: "student", label: t("field.student"),
          render: (r) => {
            const s = stuMap[r.student_id];
            const b = balanceMap[r.student_id];
            const studentName = s ? `${s.first_name} ${s.last_name}` : (r.student_name || "—");
            if (!s && !r.student_name) return "—";
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
                {studentName}
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
          // Net of discount — same amount − discount every balance/revenue
          // calculation in the app already treats as what this bill is
          // actually worth (see compute_student_balances's `paid`). Showing
          // the raw gross amount here made a fully (or partly) waived item
          // look unchanged after editing its percentages — the discount was
          // saved correctly, it just never showed up in this column.
          render: (r) => {
            const net = Math.max(0, parseFloat(r.amount) - parseFloat(r.discount || 0));
            const hasDiscount = parseFloat(r.discount || 0) > 0;
            return (
              <div className="flex flex-col leading-tight">
                <span className="font-mono font-semibold">
                  {Math.round(net).toLocaleString()} {tenant?.currency || "DZD"}
                </span>
                {hasDiscount && (
                  <span className="font-mono text-[11px] text-muted-foreground line-through">
                    {Math.round(r.amount).toLocaleString()} {tenant?.currency || "DZD"}
                  </span>
                )}
              </div>
            );
          },
        },
        { key: "method", label: t("field.method"), render: (r) => <span className="capitalize text-xs">{t(`method.${r.method}`)}</span> },
        {
          key: "status", label: t("field.status"), render: (r) => {
            const hasPardon = r.status === "pardoned" || (r.items || []).some((it) => it.status === "pardoned");
            const pType = r.pardon_type || (r.items || []).find((it) => it.status === "pardoned")?.pardon_type;
            return (
              <div className="flex flex-col gap-0.5 items-start">
                <StatusPill status={r.status} />
                {hasPardon && pType && (
                  <span className="text-[10px] font-semibold text-purple-700 dark:text-purple-300">
                    ({t(`payments.pardon_${pType}_short`)})
                  </span>
                )}
              </div>
            );
          },
        },
      ]}
      renderForm={(form, setForm) => {
        const isEditing = Boolean(form.id);
        const items = form.items || [];
        const nonCancelledItems = items.filter((it) => it.status !== "cancelled");
        const subtotal = subtotalOf(nonCancelledItems);
        const pardonDiscount = nonCancelledItems.reduce((sum, it) => sum + itemDiscount(it), 0);
        const reductionVal = Math.max(0, parseFloat(form.reduction) || 0);
        const totalDiscount = Math.min(subtotal, pardonDiscount + reductionVal);
        const total = Math.max(0, subtotal - totalDiscount);
        const currency = tenant?.currency || "DZD";

        const effectiveStatus = (it) => (it.pay_later && (it.status === "pardoned" || it.status === "pardonned")) ? "pending" : (it.status || "paid");
        const paidItems = items.filter((it) => effectiveStatus(it) === "paid" || (effectiveStatus(it) === "pardoned" && !it.pay_later));
        const pendingItems = items.filter((it) => effectiveStatus(it) === "pending");
        const isMixed = !isEditing && paidItems.length > 0 && pendingItems.length > 0;
        const allPending = !isEditing && items.length > 0 && items.every((it) => effectiveStatus(it) === "pending");
        const paidNetTotal = paidItems.reduce((sum, it) => sum + Math.max(0, itemAmount(it) - itemDiscount(it)), 0);
        const pendingNetTotal = pendingItems.reduce((sum, it) => sum + Math.max(0, itemAmount(it) - itemDiscount(it)), 0);

        let baseTeacherCut = 0;
        let baseSchoolCut = 0;
        for (const it of nonCancelledItems) {
          const amt = itemAmount(it);
          const pType = (it.status === "pardoned" || it.status === "pardonned" || (it.pardon_type && it.pay_later))
            ? (it.pardon_type || "both")
            : null;
          let tPct = parseFloat(it.teacher_percentage) || 0;
          let sPct = it.school_percentage != null && it.school_percentage !== ""
            ? parseFloat(it.school_percentage)
            : 0;
          if (tPct === 0 && sPct === 0) {
            tPct = 50;
            sPct = 50;
          } else if (tPct === 0) {
            tPct = Math.max(0, 100 - sPct);
          } else if (sPct === 0) {
            sPct = Math.max(0, 100 - tPct);
          }

          let itemTeacher = Math.round(amt * (tPct / 100) * 100) / 100;
          let itemSchool = Math.round(amt * (sPct / 100) * 100) / 100;

          if (pType === "both") {
            itemTeacher = 0;
            itemSchool = 0;
          } else if (pType === "school") {
            itemSchool = 0;
          } else if (pType === "teacher") {
            itemTeacher = 0;
          }
          baseTeacherCut += itemTeacher;
          baseSchoolCut += itemSchool;
        }

        const reductionTarget = form.reduction_target || "total";
        let schoolShareNet = baseSchoolCut;
        let teacherShareNet = baseTeacherCut;
        if (reductionVal > 0) {
          if (reductionTarget === "school") {
            schoolShareNet = Math.max(0, baseSchoolCut - reductionVal);
          } else if (reductionTarget === "teacher") {
            teacherShareNet = Math.max(0, baseTeacherCut - reductionVal);
          } else {
            const sumCuts = baseTeacherCut + baseSchoolCut;
            if (sumCuts > 0) {
              const teacherDeduction = Math.round(reductionVal * (baseTeacherCut / sumCuts) * 100) / 100;
              const schoolDeduction = Math.round((reductionVal - teacherDeduction) * 100) / 100;
              teacherShareNet = Math.max(0, baseTeacherCut - teacherDeduction);
              schoolShareNet = Math.max(0, baseSchoolCut - schoolDeduction);
            } else {
              schoolShareNet = 0;
              teacherShareNet = 0;
            }
          }
        }

        const updateItem = (idx, patch) => {
          setForm({ ...form, items: items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) });
        };
        const setItemType = (idx, item_type) => {
          // Fresh object per type switch — no leftover course_id/trip_id/
          // book_id from a previous type sticking around unseen.
          updateItem(idx, { ...EMPTY_ITEM, status: items[idx]?.status || "paid", item_type });
        };
        const addItem = () => setForm({
          ...form,
          items: [...items, { ...EMPTY_ITEM, status: form.status === "pending" ? "pending" : "paid" }],
        });
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
              <>
                  {items.map((item, idx) => (
                    <div key={item.id || idx} className="rounded-lg border border-border p-3 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
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

                        <div className="flex items-center gap-2">
                          <div className="inline-flex flex-wrap rounded-md border border-border p-0.5 bg-muted/40 gap-0.5">
                            {[
                              { key: "paid", label: t("status.paid"), activeCls: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border-emerald-500/30" },
                              { key: "pending", label: t("status.pending"), activeCls: "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold border-amber-500/30" },
                              { key: "partial", label: t("status.partial"), activeCls: "bg-blue-500/20 text-blue-700 dark:text-blue-300 font-semibold border-blue-500/30" },
                              { key: "pardoned", label: t("status.pardoned"), activeCls: "bg-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold border-purple-500/30" },
                              { key: "cancelled", label: t("status.cancelled"), activeCls: "bg-rose-500/20 text-rose-700 dark:text-rose-300 font-semibold border-rose-500/30" },
                            ].map((st) => {
                              const isCur = (item.status || "paid") === st.key;
                              return (
                                <button
                                  key={st.key}
                                  type="button"
                                  onClick={() => {
                                    const patch = { status: st.key };
                                    if (st.key === "pardoned") {
                                      patch.pardon_type = item.pardon_type || "both";
                                    }
                                    if (!item.amount || parseFloat(item.amount) === 0) {
                                      if (item.item_type === "course" && item.course_id) {
                                        const course = courseMap[item.course_id];
                                        if (course) patch.amount = parseFloat(course.price) || 0;
                                        Object.assign(patch, pctFromCourse(item.course_id));
                                      } else if (item.item_type === "trip" && item.trip_id) {
                                        const trip = (trips?.items || []).find((tr) => tr.id === item.trip_id);
                                        if (trip) patch.amount = parseFloat(trip.price) || 0;
                                      } else if (item.item_type === "book" && item.book_id) {
                                        const book = (books?.items || []).find((bk) => bk.id === item.book_id);
                                        if (book) patch.amount = parseFloat(book.price) || 0;
                                      }
                                    }
                                    updateItem(idx, patch);
                                  }}
                                  className={`px-2 py-0.5 text-xs rounded font-medium transition-all border ${
                                    isCur
                                      ? `${st.activeCls} shadow-xs`
                                      : "border-transparent text-muted-foreground hover:text-foreground"
                                  }`}
                                  data-testid={`payments-item-${idx}-status-${st.key}`}
                                >
                                  {st.label}
                                </button>
                              );
                            })}
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
                      </div>

                      {item.status === "pending" && (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/25 text-xs">
                          <span className="text-amber-700 dark:text-amber-300 font-medium">
                            {t("payments.item_pending_hint")}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{t("payments.due")}:</span>
                            <Input
                              type="date"
                              value={item.due_date || ""}
                              onChange={(e) => updateItem(idx, { due_date: e.target.value })}
                              className="h-7 w-36 text-xs bg-background"
                              placeholder={t("field.due_date")}
                              data-testid={`payments-item-${idx}-due-date`}
                            />
                          </div>
                        </div>
                      )}

                      {item.status === "partial" && (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-md bg-blue-500/10 border border-blue-500/25 text-xs">
                          <span className="text-blue-700 dark:text-blue-300 font-medium">
                            {t("payments.item_partial_hint")}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">{t("payments.due")}:</span>
                            <Input
                              type="date"
                              value={item.due_date || ""}
                              onChange={(e) => updateItem(idx, { due_date: e.target.value })}
                              className="h-7 w-36 text-xs bg-background"
                              placeholder={t("field.due_date")}
                              data-testid={`payments-item-${idx}-due-date`}
                            />
                          </div>
                        </div>
                      )}

                      {(item.status === "pardoned" || item.status === "pardonned") && (
                        <div className="p-2.5 rounded-md bg-purple-500/10 border border-purple-500/25 text-xs space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-purple-900 dark:text-purple-200">
                              {t("payments.pardon_type")}
                            </span>
                            {(() => {
                              const amt = itemAmount(item);
                              const disc = itemDiscount(item);
                              const studentPays = Math.max(0, amt - disc);
                              return (
                                <span className="font-medium text-purple-950 dark:text-purple-100 bg-purple-500/20 px-2 py-0.5 rounded">
                                  {t("payments.student_pays")}: <strong className="font-bold">{studentPays.toLocaleString()} DZD</strong>
                                  {disc > 0 && <span className="ms-1 text-[11px] opacity-75">(-{disc.toLocaleString()} DZD)</span>}
                                </span>
                              );
                            })()}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                            {[
                              { key: "both", label: t("payments.pardon_both_short"), title: t("payments.pardon_both") },
                              { key: "school", label: t("payments.pardon_school_short"), title: t("payments.pardon_school") },
                              { key: "teacher", label: t("payments.pardon_teacher_short"), title: t("payments.pardon_teacher") },
                            ].map((pt) => {
                              const isSel = (item.pardon_type || "both") === pt.key;
                              return (
                                <button
                                  key={pt.key}
                                  type="button"
                                  title={pt.title}
                                  onClick={() => {
                                    const patch = { pardon_type: pt.key };
                                    if ((pt.key === "school" || pt.key === "teacher") && item.teacher_percentage == null && item.school_percentage == null) {
                                      patch.teacher_percentage = 50;
                                      patch.school_percentage = 50;
                                    }
                                    updateItem(idx, patch);
                                  }}
                                  className={`px-2 py-1.5 text-xs rounded font-medium transition-all text-center border ${
                                    isSel
                                      ? "bg-purple-600 text-white dark:bg-purple-500 border-purple-600 shadow-xs font-semibold"
                                      : "bg-background/80 hover:bg-background border-border text-foreground hover:border-purple-300 dark:hover:border-purple-600"
                                  }`}
                                  data-testid={`payments-item-${idx}-pardon-type-${pt.key}`}
                                >
                                  {pt.label}
                                </button>
                              );
                            })}
                          </div>

                          {(item.pardon_type === "school" || item.pardon_type === "teacher") && (
                            <div className="pt-2 border-t border-purple-500/20 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(item.pay_later)}
                                    onChange={(e) => updateItem(idx, { pay_later: e.target.checked })}
                                    className="rounded border-purple-400 text-purple-600 focus:ring-purple-500 w-4 h-4 cursor-pointer"
                                    data-testid={`payments-item-${idx}-pay-later`}
                                  />
                                  <span className="font-semibold text-purple-950 dark:text-purple-100">
                                    {t("payments.pay_later")}
                                  </span>
                                </label>
                                {item.pay_later && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-muted-foreground">{t("payments.due")}:</span>
                                    <Input
                                      type="date"
                                      value={item.due_date || ""}
                                      onChange={(e) => updateItem(idx, { due_date: e.target.value })}
                                      className="h-7 w-36 text-xs bg-background"
                                      data-testid={`payments-item-${idx}-pardon-due-date`}
                                    />
                                  </div>
                                )}
                              </div>
                              {item.pay_later && (
                                <p className="text-[11px] text-purple-700 dark:text-purple-300">
                                  {t("payments.pay_later_hint")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {item.status === "cancelled" && (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-rose-500/10 border border-rose-500/25 text-xs text-rose-700 dark:text-rose-300 font-medium">
                          <span>{t("status.cancelled")}</span>
                        </div>
                      )}

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
                                // Resolve straight from the course's own
                                // group(s) — not from whether this student
                                // already happens to be enrolled — so a
                                // brand-new registration gets the right
                                // teacher's % automatically too, same as a
                                // returning student's payment does.
                                const candidates = groupsForCourse(v);
                                const course = courseMap[v];
                                const patch = {
                                  course_id: v, group_id: "", teacher_percentage: null, school_percentage: null,
                                  // The course's own price, same as it's set on the Courses
                                  // page — not hand-typed, and only reducible via the
                                  // teacher/school % split below, never edited directly.
                                  amount: course ? parseFloat(course.price) || 0 : 0,
                                };
                                if (candidates.length === 1) {
                                  patch.group_id = candidates[0].id;
                                }
                                Object.assign(patch, pctFromCourse(v));
                                updateItem(idx, patch);
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

                      {item.item_type === "course" && item.course_id && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-border">
                          {groupsForCourse(item.course_id).length > 1 && (
                            <div className="md:col-span-2">
                              <Field label={t("field.group")}>
                                <Select
                                  value={item.group_id || ""}
                                  onValueChange={(v) => {
                                    const group = groupsForCourse(item.course_id).find((g) => g.id === v);
                                    updateItem(idx, { group_id: v, ...pctFromGroup(group) });
                                  }}
                                >
                                  <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
                                  <SelectContent className="bg-popover">
                                    {groupsForCourse(item.course_id).map((g) => {
                                      // Which group gets picked here is what decides the
                                      // resolved teacher %, so — unlike groupOptionLabel's
                                      // other call sites — the teacher's own name is the
                                      // one thing worth surfacing in this specific picker.
                                      const teacher = teacherMap[g.teacher_id];
                                      const teacherName = teacher ? `${teacher.first_name} ${teacher.last_name}` : null;
                                      return (
                                        <SelectItem key={g.id} value={g.id}>
                                          {groupOptionLabel(g, courseMap, t)}{teacherName ? ` (${teacherName})` : ""}
                                        </SelectItem>
                                      );
                                    })}
                                  </SelectContent>
                                </Select>
                              </Field>
                            </div>
                          )}
                          <Field label={t("payments.teacher_percentage")}>
                            <Input
                              type="number" min="0" max="100" step="any" placeholder="—"
                              value={item.teacher_percentage ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "") {
                                  updateItem(idx, { teacher_percentage: null });
                                } else {
                                  const num = parseFloat(val);
                                  const patch = { teacher_percentage: val };
                                  if (!isNaN(num) && num >= 0 && num <= 100) {
                                    patch.school_percentage = Math.round((100 - num) * 100) / 100;
                                  }
                                  updateItem(idx, patch);
                                }
                              }}
                              data-testid={`payments-item-${idx}-teacher-percentage`}
                            />
                          </Field>
                          <Field label={t("payments.school_percentage")}>
                            <Input
                              type="number" min="0" max="100" step="any" placeholder="—"
                              value={item.school_percentage ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "") {
                                  updateItem(idx, { school_percentage: null });
                                } else {
                                  const num = parseFloat(val);
                                  const patch = { school_percentage: val };
                                  if (!isNaN(num) && num >= 0 && num <= 100) {
                                    patch.teacher_percentage = Math.round((100 - num) * 100) / 100;
                                  }
                                  updateItem(idx, patch);
                                }
                              }}
                              data-testid={`payments-item-${idx}-school-percentage`}
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addItem} data-testid="payments-add-item">
                    <Plus className="w-3.5 h-3.5 me-1.5" /> {t("payments.add_item")}
                  </Button>
              </>
            </div>
          </div>

          {/* Reduction card */}
          <div className="rounded-lg border border-border bg-card p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-accent-foreground" />
                {t("payments.reduction")}
              </Label>
              {reductionVal > 0 && (
                <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                  &minus;{reductionVal.toLocaleString()} {currency}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("payments.reduction_amount")}>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={form.reduction ?? ""}
                    onChange={(e) => setForm({ ...form, reduction: e.target.value })}
                    className="bg-background pe-12 font-mono"
                    data-testid="payments-reduction-input"
                  />
                  <span className="absolute end-3 top-2.5 text-xs text-muted-foreground pointer-events-none">
                    {currency}
                  </span>
                </div>
              </Field>

              <Field label={t("payments.reduction_target")}>
                <Select
                  value={form.reduction_target || "total"}
                  onValueChange={(v) => setForm({ ...form, reduction_target: v })}
                >
                  <SelectTrigger className="bg-background" data-testid="payments-reduction-target-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="total">{t("payments.reduction_target_total")}</SelectItem>
                    <SelectItem value="school">{t("payments.reduction_target_school")}</SelectItem>
                    <SelectItem value="teacher">{t("payments.reduction_target_teacher")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {reductionVal > 0 && (
              <div className="text-[11px] rounded bg-muted/60 p-2 text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                <span>{t(`payments.reduction_hint_${reductionTarget}`)}</span>
                <div className="flex items-center gap-3 font-mono text-xs">
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    {t("payments.school_net")}: {Math.round(schoolShareNet).toLocaleString()} {currency}
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {t("payments.teacher_net")}: {Math.round(teacherShareNet).toLocaleString()} {currency}
                  </span>
                </div>
              </div>
            )}
          </div>

          {isEditing ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t("field.status")}>
                  <Select value={form.status || "paid"} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-popover">
                      <SelectItem value="paid">{t("status.paid")}</SelectItem>
                      <SelectItem value="pending">{t("status.pending")}</SelectItem>
                      <SelectItem value="partial">{t("status.partial")}</SelectItem>
                      <SelectItem value="pardoned">{t("status.pardoned")}</SelectItem>
                      <SelectItem value="refunded">{t("status.refunded")}</SelectItem>
                      <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {(form.status === "paid" || form.status === "partial" || form.status === "pardoned" || form.status === "refunded" || form.status === "cancelled") ? (
                  <Field label={t("field.paid_at")}>
                    <Input
                      type="date"
                      value={form.paid_at || ""}
                      onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
                      data-testid="payments-form-paid-at"
                    />
                  </Field>
                ) : (
                  <Field label={t("field.due_date")}>
                    <Input
                      type="date"
                      value={form.due_date || ""}
                      onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                      data-testid="payments-form-due-date"
                    />
                  </Field>
                )}
              </div>

              {form.status === "pardoned" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label={t("payments.pardon_type")}>
                    <Select
                      value={form.pardon_type || "both"}
                      onValueChange={(v) => {
                        const updatedItems = (form.items || []).map((it) =>
                          it.status === "pardoned" || it.status === "pardonned"
                            ? { ...it, pardon_type: v }
                            : it
                        );
                        setForm({ ...form, pardon_type: v, items: updatedItems });
                      }}
                    >
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="both">{t("payments.pardon_both")}</SelectItem>
                        <SelectItem value="school">{t("payments.pardon_school")}</SelectItem>
                        <SelectItem value="teacher">{t("payments.pardon_teacher")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}

              {form.status === "partial" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label={t("field.due_date")}>
                    <Input
                      type="date"
                      value={form.due_date || ""}
                      onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                      data-testid="payments-form-partial-due-date"
                    />
                  </Field>
                </div>
              )}

              {form.status === "partial" && (
                <p className="text-xs text-muted-foreground -mt-2">{t("payments.partial_hint")}</p>
              )}
            </>
          ) : isMixed ? (
            <>
              <div className="rounded-lg bg-info/10 border border-info/30 p-3 text-xs text-info-foreground flex items-start gap-2.5">
                <Info className="w-4 h-4 shrink-0 text-info mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-foreground">{t("payments.mixed_billing_notice")}</div>
                  <div className="text-muted-foreground">
                    {t("payments.paid_now")}: <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">{Math.round(paidNetTotal).toLocaleString()} {currency}</span> &middot; {t("payments.pending_debt")}: <span className="font-mono font-medium text-amber-700 dark:text-amber-400">{Math.round(pendingNetTotal).toLocaleString()} {currency}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t("field.paid_at")}>
                  <Input
                    type="date"
                    value={form.paid_at || ""}
                    onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
                    data-testid="payments-form-paid-at"
                  />
                </Field>
                <Field label={t("payments.item_due_date")}>
                  <Input
                    type="date"
                    value={form.due_date || ""}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    data-testid="payments-form-due-date"
                  />
                </Field>
              </div>
            </>
          ) : allPending ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("field.due_date")}>
                <Input
                  type="date"
                  value={form.due_date || ""}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  data-testid="payments-form-due-date"
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("field.paid_at")}>
                <Input
                  type="date"
                  value={form.paid_at || ""}
                  onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
                  data-testid="payments-form-paid-at"
                />
              </Field>
            </div>
          )}

          <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>{t("payments.subtotal")}</span>
              <span className="font-mono">{Math.round(subtotal).toLocaleString()} {currency}</span>
            </div>
            {pardonDiscount > 0 && (
              <div className="flex justify-between text-purple-700 dark:text-purple-400 text-xs font-medium">
                <span>{t("field.discount")} ({t("status.pardoned")})</span>
                <span className="font-mono">&minus;{Math.round(pardonDiscount).toLocaleString()} {currency}</span>
              </div>
            )}
            {reductionVal > 0 && (
              <div className="flex justify-between text-amber-700 dark:text-amber-400 text-xs font-medium">
                <span>{t("payments.reduction")} ({t(`payments.reduction_target_${reductionTarget}`)})</span>
                <span className="font-mono">&minus;{Math.round(reductionVal).toLocaleString()} {currency}</span>
              </div>
            )}
            {isMixed && (
              <>
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-medium pt-1 border-t border-border/60">
                  <span>{t("payments.paid_now")} ({paidItems.length})</span>
                  <span className="font-mono">{Math.round(paidNetTotal).toLocaleString()} {currency}</span>
                </div>
                <div className="flex justify-between text-amber-700 dark:text-amber-400 font-medium">
                  <span>{t("payments.pending_debt")} ({pendingItems.length})</span>
                  <span className="font-mono">{Math.round(pendingNetTotal).toLocaleString()} {currency}</span>
                </div>
              </>
            )}
            <div className="flex justify-between font-semibold pt-1 border-t border-border">
              <span>{t("payments.total")}</span>
              <span className="font-mono text-base">{Math.round(total).toLocaleString()} {currency}</span>
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
                {/* Both net of any teacher/school %-discount — the discount
                   is forgiven straight off cost (see compute_student_balances),
                   not treated as cash collected — so these two numbers are
                   exactly what Balance below is computed from (paid − cost),
                   and they reconcile with it at a glance. */}
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
