import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calendar, Download, History, Package, Plus, Trash2, Wallet } from "lucide-react";

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
import { PageHeader, EmptyState, LoadingRows, Field, groupOptionLabel } from "./_shared";

const EMPTY_PAYOUT = {
  teacher_id: "", amount: "", paid_at: new Date().toISOString().slice(0, 10),
  period_start: "", period_end: "", notes: "",
};

export default function TeacherPaymentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const { canAdd, canModify: canEditPercentage } = usePermission("teacher_payments");

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
  const currency = tenant?.currency || "DZD";

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

      <div className="surface-card p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label={t("reports.from")}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t("reports.to")}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
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
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{t("tp.present_count")}</div>
          <div className="font-mono font-bold text-lg">{totals.present_count ?? 0}</div>
        </div>
        {[
          ["tp.earned", totals.earned],
          ["tp.paid_out", totals.paid_out],
          ["tp.balance", totals.balance],
        ].map(([key, value]) => (
          <div key={key} className="surface-card p-4">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{t(key)}</div>
            <div className="font-mono font-bold text-lg">{money(value)}</div>
          </div>
        ))}
      </div>

      <div className="surface-card overflow-hidden mb-6">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Wallet} title={t("menu.teacher_payments")} description={t("tp.set_percentage")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["menu.teachers", "tp.percentage", "tp.present_count", "tp.book_percentage", "tp.book_earned", "tp.standalone_earned", "tp.earned", "tp.paid_out", "tp.balance"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                  <th className="text-end px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                    {t("tp.history")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.teacher_id}
                    onClick={() => setSelectedHistoryTeacher(r)}
                    className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1.5 text-start font-semibold text-primary">
                        <span>{r.teacher_name}</span>
                        <History className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                      {!canEditPercentage ? (
                        `${r.percentage}%`
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min="0" max="100" step="1"
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
                    <td className="px-4 py-3 font-mono text-xs">{r.present_count}</td>
                    <td className="px-4 py-3 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                      {!canEditPercentage ? (
                        `${r.book_percentage}%`
                      ) : (
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min="0" max="100" step="1"
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
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{money(r.book_earned)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{money(r.standalone_earned)}</td>
                    <td className="px-4 py-3 font-mono">{money(r.earned)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{money(r.paid_out)}</td>
                    <td className={`px-4 py-3 font-mono font-semibold ${r.balance > 0 ? "text-destructive" : ""}`}>
                      {money(r.balance)}
                    </td>
                    <td className="px-4 py-3 text-end" onClick={(e) => e.stopPropagation()}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                    <td className="px-4 py-3 font-mono text-xs">{p.paid_at}</td>
                    <td className="px-4 py-3">{p.teacher_name}</td>
                    <td className="px-4 py-3 font-mono">{money(p.amount)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.period_start || p.period_end ? `${p.period_start || "…"} → ${p.period_end || "…"}` : "—"}
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
              <Input type="date" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} required />
            </Field>
            <Field label={t("reports.from")}>
              <Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} />
            </Field>
            <Field label={t("reports.to")}>
              <Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} />
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

function TeacherHistoryDialog({ teacher, initialFilters, onClose, currency }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canModify, canDelete } = usePermission("teacher_payments");
  const { canDelete: canDeleteSessions, canModify: canModifySessions } = usePermission("sessions");
  const { canDelete: canDeletePayments, canModify: canModifyPayments } = usePermission("payments");
  const canRemove = canModify || canDelete || canDeleteSessions || canModifySessions || canDeletePayments || canModifyPayments;

  const teacherId = teacher?.teacher_id || teacher?.id;

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
      return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      return iso;
    }
  };

  const formatDate = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString();
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
                <History className="w-5 h-5 text-primary" />
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
              <Input
                type="date"
                value={dateFilters.from}
                onChange={(e) => setDateFilters((prev) => ({ ...prev, from: e.target.value }))}
                className="h-8 text-xs w-32"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={dateFilters.to}
                onChange={(e) => setDateFilters((prev) => ({ ...prev, to: e.target.value }))}
                className="h-8 text-xs w-32"
              />
              {(dateFilters.from || dateFilters.to) && (
                <Button
                  variant="ghost"
                  size="sm"
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
            <div className="font-mono font-bold text-base text-primary mt-1">
              {money(totals.total_earned)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {t("tp.paid_out")}: {money(totals.paid_out)}
            </div>
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
                <thead className="bg-muted/50 sticky top-0 border-b z-10">
                  <tr>
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
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                        {formatDateTime(s.start_at)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{s.course_title}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{s.group_name}</td>
                      <td className="px-3 py-2.5 font-mono font-semibold">{s.present_count}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{money(s.price_per_session)}</td>
                      <td className="px-3 py-2.5 font-mono">{s.teacher_percentage}%</td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-primary">{money(s.earned)}</td>
                      {canRemove && (
                        <td className="px-3 py-2.5 text-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleRemoveSession(s)}
                            disabled={removeSessionMut.isPending}
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
                <thead className="bg-muted/50 sticky top-0 border-b z-10">
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
                      <td className="px-3 py-2.5 font-mono font-semibold text-primary">{money(p.earned)}</td>
                      {canRemove && (
                        <td className="px-3 py-2.5 text-end">
                          <Button
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
