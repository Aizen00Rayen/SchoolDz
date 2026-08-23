import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Plus, Wallet } from "lucide-react";

import { api, extractError, downloadFrom } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission, isFullAccessRole } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  const { tenant, user } = useAuth();
  const qc = useQueryClient();
  const { canEdit } = usePermission("teacher_payments");
  // Percentages decide real payouts, so — unlike the rest of this page —
  // only the workspace owner/director may change them, never a secretary or
  // accountant even if they've been granted "edit" on Teacher payments.
  const canEditPercentage = isFullAccessRole(user?.role);

  const [filters, setFilters] = useState({ from: "", to: "", teacher_id: "", group_id: "" });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_PAYOUT);
  // Draft values for the always-visible percentage inputs, keyed by teacher
  // id — only holds an entry while a field has been touched and not yet
  // saved, so unedited rows always reflect the server value.
  const [pctDrafts, setPctDrafts] = useState({});

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
            {canEdit && (
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
                  {["menu.teachers", "tp.percentage", "tp.present_count", "tp.earned", "tp.paid_out", "tp.balance"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.teacher_id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-medium">{r.teacher_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">
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
                    <td className="px-4 py-3 font-mono">{money(r.earned)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{money(r.paid_out)}</td>
                    <td className={`px-4 py-3 font-mono font-semibold ${r.balance > 0 ? "text-destructive" : ""}`}>
                      {money(r.balance)}
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
    </div>
  );
}
