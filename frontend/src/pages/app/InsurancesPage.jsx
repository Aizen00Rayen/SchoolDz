import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ShieldCheck, Trash2, Edit2, Info, Search, Calendar, User, Phone, Layers } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm";
import { usePermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, EmptyState, LoadingRows, Field, ExportMenu, StudentSearchSelect } from "./_shared";

const EMPTY_FORM = {
  student_id: "",
  amount: "",
  paid_at: new Date().toISOString().slice(0, 10),
  academic_year: "",
  notes: "",
};

export default function InsurancesPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canAdd, canModify, canDelete } = usePermission("insurances");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [filters, setFilters] = useState({ from: "", to: "", q: "" });

  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v)
  ).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["insurances", filters],
    queryFn: () => api.get(`/insurances${params ? `?${params}` : ""}`).then((r) => r.data),
  });

  const items = data?.items || [];
  const currency = tenant?.currency || "DZD";

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["insurances"] });
    qc.invalidateQueries({ queryKey: ["finance-report"] });
    qc.invalidateQueries({ queryKey: ["students"] });
  };

  const saveMut = useMutation({
    mutationFn: (payload) =>
      editing
        ? api.patch(`/insurances/${editing.id}`, payload).then((r) => r.data)
        : api.post("/insurances", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t(editing ? "insurances.updated_success" : "insurances.created_success"));
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/insurances/${id}`),
    onSuccess: () => {
      toast.success(t("insurances.deleted_success"));
      invalidate();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      student_id: row.student_id || "",
      amount: row.amount || "",
      paid_at: (row.paid_at || "").slice(0, 10),
      academic_year: row.academic_year || "",
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.student_id) {
      toast.error(t("crud.fill_details"));
      return;
    }
    saveMut.mutate({
      ...form,
      amount: parseFloat(form.amount) || 0,
    });
  };

  return (
    <div>
      <PageHeader
        title={t("menu.insurances")}
        subtitle={t("subtitle.insurances")}
        actions={
          <>
            <ExportMenu resource="insurances" />
            {canAdd && (
              <Button
                onClick={openCreate}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
                data-testid="insurances-new"
              >
                <Plus className="w-4 h-4 me-2" /> {t("insurances.record_insurance")}
              </Button>
            )}
          </>
        }
      />

      {/* Info notice about insurance cashflow */}
      <div className="mb-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5 flex items-start gap-3 text-xs text-foreground">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          {t("insurances.not_revenue_note")}
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
        <div className="surface-card p-4 sm:p-5 flex items-center gap-3 border-blue-500/20 bg-blue-500/5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-blue-600/90 dark:text-blue-400/90">
              {t("insurances.total_collected")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-blue-600 dark:text-blue-400 truncate" dir="ltr">
              {(data?.total_amount || 0).toLocaleString()} {currency}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground grid place-items-center flex-shrink-0">
            <User className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("insurances.count")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-foreground">
              {data?.total_count || items.length}
            </div>
          </div>
        </div>

        <div className="surface-card p-4 sm:p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground grid place-items-center flex-shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t("debts.avg_debt", "متوسط التأمين")}
            </div>
            <div className="font-mono font-bold text-xl sm:text-2xl text-foreground truncate" dir="ltr">
              {(items.length > 0 ? Math.round((data?.total_amount || 0) / items.length) : 0).toLocaleString()} {currency}
            </div>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t("crud.search")}>
          <div className="relative">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t("insurances.student")}
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
        </Field>
        <Field label={t("reports.from")}>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </Field>
        <Field label={t("reports.to")}>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </Field>
      </div>

      {/* Table & Mobile Cards */}
      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={t("insurances.no_items")}
            description={t("subtitle.insurances")}
            action={canAdd && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="w-4 h-4 me-2" /> {t("insurances.record_insurance")}
              </Button>
            )}
          />
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.paid_at")}
                    </th>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.student")}
                    </th>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.parent_name")}
                    </th>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.amount")}
                    </th>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.academic_year")}
                    </th>
                    <th className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t("insurances.notes")}
                    </th>
                    {(canModify || canDelete) && <th className="w-24 px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-foreground" dir="ltr">
                        {row.paid_at}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          {row.student_name || "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <div>{row.parent_name || "—"}</div>
                        {row.parent_phone && (
                          <a
                            href={`tel:${row.parent_phone}`}
                            className="font-mono text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                            dir="ltr"
                          >
                            <Phone className="w-3 h-3" />
                            {row.parent_phone}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground" dir="ltr">
                        {Number(row.amount).toLocaleString()} {currency}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {row.academic_year ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                            {row.academic_year}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                        {row.notes || "—"}
                      </td>
                      {(canModify || canDelete) && (
                        <td className="px-4 py-3 text-end whitespace-nowrap">
                          {canModify && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(row)}
                              title={t("actions.edit")}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={async () => {
                                if (await confirm({
                                  title: t("insurances.delete_confirm"),
                                  destructive: true,
                                })) {
                                  deleteMut.mutate(row.id);
                                }
                              }}
                              title={t("actions.delete")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards Stack View */}
            <div className="md:hidden divide-y divide-border">
              {items.map((row) => (
                <div key={row.id} className="p-4 space-y-2.5 hover:bg-muted/20 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-muted-foreground" dir="ltr">
                      {row.paid_at}
                    </span>
                    {row.academic_year && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-muted text-foreground font-mono">
                        {row.academic_year}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0" />
                      <span>{row.student_name || "—"}</span>
                    </div>
                    {(row.parent_name || row.parent_phone) && (
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        {row.parent_name && <span>{row.parent_name}</span>}
                        {row.parent_name && row.parent_phone && <span>•</span>}
                        {row.parent_phone && (
                          <a
                            href={`tel:${row.parent_phone}`}
                            className="text-primary font-mono hover:underline inline-flex items-center gap-1"
                            dir="ltr"
                          >
                            <Phone className="w-3 h-3" />
                            {row.parent_phone}
                          </a>
                        )}
                      </div>
                    )}
                    {row.notes && (
                      <div className="text-xs text-muted-foreground mt-1 leading-relaxed bg-muted/40 p-2 rounded">
                        {row.notes}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="font-mono font-bold text-base text-foreground" dir="ltr">
                      {Number(row.amount).toLocaleString()} {currency}
                    </span>

                    {(canModify || canDelete) && (
                      <div className="flex items-center gap-1">
                        {canModify && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs px-2.5"
                            onClick={() => openEdit(row)}
                          >
                            <Edit2 className="w-3.5 h-3.5 me-1" />
                            {t("actions.edit")}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={async () => {
                              if (await confirm({
                                title: t("insurances.delete_confirm"),
                                destructive: true,
                              })) {
                                deleteMut.mutate(row.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl text-foreground">
              {editing ? t("insurances.edit_insurance") : t("insurances.record_insurance")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("crud.fill_details")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label={t("insurances.student")} required>
                {editing ? (
                  <div className="px-3 py-2 rounded-md bg-muted/40 border border-input text-sm text-foreground font-medium flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    {editing.student_name || "—"}
                  </div>
                ) : (
                  <StudentSearchSelect
                    value={form.student_id}
                    onChange={(id) => setForm({ ...form, student_id: id })}
                    placeholder={t("insurances.student")}
                  />
                )}
              </Field>
            </div>

            <Field label={t("insurances.amount")} required>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                data-testid="insurance-amount"
              />
            </Field>

            <Field label={t("insurances.paid_at")} required>
              <Input
                type="date"
                value={form.paid_at}
                onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
                required
              />
            </Field>

            <div className="md:col-span-2">
              <Field label={t("insurances.academic_year")}>
                <Input
                  value={form.academic_year}
                  onChange={(e) => setForm({ ...form, academic_year: e.target.value })}
                  placeholder={t("insurances.academic_year_placeholder")}
                />
              </Field>
            </div>

            <div className="md:col-span-2">
              <Field label={t("insurances.notes")}>
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="..."
                />
              </Field>
            </div>

            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saveMut.isPending}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {saveMut.isPending ? t("actions.saving") : t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
