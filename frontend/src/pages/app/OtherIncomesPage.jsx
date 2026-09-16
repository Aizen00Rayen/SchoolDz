import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Coins, Trash2, Info } from "lucide-react";

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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, EmptyState, LoadingRows, Field, ExportMenu } from "./_shared";

const EMPTY_FORM = {
  title: "", amount: "", received_at: new Date().toISOString().slice(0, 10),
  category_id: "", method: "cash", notes: "",
};

// Mirrors DEFAULT_OTHER_INCOME_CATEGORIES in django-backend/api/models.py.
export const DEFAULT_OTHER_INCOME_KEYS = [
  "printing", "canteen", "supplies", "room_rental",
  "badges", "registration_fees", "other",
];

export function otherIncomeCategoryLabel(category, t) {
  if (!category) return t("other_income_category.uncategorized");
  const key = typeof category === "string" ? category : category.key;
  if (key && (DEFAULT_OTHER_INCOME_KEYS.includes(key) || key === "uncategorized")) {
    return t(`other_income_category.${key}`);
  }
  const name = typeof category === "string" ? category : category.name;
  return name || t("other_income_category.uncategorized");
}

export default function OtherIncomesPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canAdd, canModify, canDelete } = usePermission("other_incomes");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [filters, setFilters] = useState({ from: "", to: "", category_id: "" });

  const params = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v)
  ).toString();

  const { data, isLoading } = useQuery({
    queryKey: ["other-incomes", filters],
    queryFn: () => api.get(`/other-incomes${params ? `?${params}` : ""}`).then((r) => r.data),
  });
  const { data: cats } = useQuery({
    queryKey: ["other-income-categories"],
    queryFn: () => api.get("/other-income-categories").then((r) => r.data),
  });

  const categories = cats?.items || [];
  const items = data?.items || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["other-incomes"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["finance-report"] });
  };

  const saveMut = useMutation({
    mutationFn: (payload) =>
      editing
        ? api.patch(`/other-incomes/${editing.id}`, payload).then((r) => r.data)
        : api.post("/other-incomes", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t(editing ? "toast.updated" : "toast.created"));
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/other-incomes/${id}`),
    onSuccess: () => { toast.success(t("toast.deleted")); invalidate(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const addCatMut = useMutation({
    mutationFn: (name) => api.post("/other-income-categories", { name }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.created"));
      qc.invalidateQueries({ queryKey: ["other-income-categories"] });
      setCatOpen(false);
      setCatName("");
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteCatMut = useMutation({
    mutationFn: (id) => api.delete(`/other-income-categories/${id}`),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      qc.invalidateQueries({ queryKey: ["other-income-categories"] });
      invalidate();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      title: row.title || "", amount: row.amount || "",
      received_at: (row.received_at || "").slice(0, 10),
      category_id: row.category_id || "", method: row.method || "cash",
      notes: row.notes || "",
    });
    setOpen(true);
  };

  const submit = (e) => {
    e.preventDefault();
    saveMut.mutate({
      ...form,
      amount: parseFloat(form.amount) || 0,
      category_id: form.category_id || null,
    });
  };

  const currency = tenant?.currency || "DZD";

  return (
    <div>
      <PageHeader
        title={t("menu.other_incomes")}
        subtitle={t("subtitle.other_incomes")}
        actions={
          <>
            <ExportMenu resource="other-incomes" />
            {(canAdd || canDelete) && (
              <Button variant="outline" onClick={() => setCatOpen(true)}>
                {t("other_incomes.add_category")}
              </Button>
            )}
            {canAdd && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground" data-testid="other-incomes-new">
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg p-3">
        <Info className="w-4 h-4 text-accent shrink-0" />
        <span>{t("other_incomes.school_revenue_note")}</span>
      </div>

      <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <Field label={t("reports.from")}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label={t("reports.to")}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
        <Field label={t("field.category")}>
          <Select
            value={filters.category_id || "__all"}
            onValueChange={(v) => setFilters({ ...filters, category_id: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("logs.all_categories")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{otherIncomeCategoryLabel(c, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end">
          <div className="w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400 font-semibold">{t("other_incomes.total")}</div>
            <div className="font-mono font-bold text-lg text-emerald-600 dark:text-emerald-400">
              +{(data?.total_amount || 0).toLocaleString()} {currency}
            </div>
          </div>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Coins}
            title={t("crud.no_items_yet", { module: t("menu.other_incomes") })}
            description={t("crud.create_first")}
            action={canAdd && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
              </Button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.received_at", "field.title", "field.category", "field.amount", "field.method"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                  {(canModify || canDelete) && <th className="w-24" />}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{row.received_at}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.title}</div>
                      {row.notes && <div className="text-[11px] text-muted-foreground">{row.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {otherIncomeCategoryLabel({ key: row.category_key, name: row.category_name }, t)}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      +{Number(row.amount).toLocaleString()} {currency}
                    </td>
                    <td className="px-4 py-3 text-xs">{t(`method.${row.method}`)}</td>
                    {(canModify || canDelete) && (
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        {canModify && (
                          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>{t("actions.edit")}</Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost" size="sm" className="text-destructive"
                            onClick={async () => {
                              if (await confirm({ title: t("confirm.delete_record"), destructive: true })) {
                                deleteMut.mutate(row.id);
                              }
                            }}
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
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editing ? t("actions.edit") : t("actions.new")} — {t("menu.other_incomes")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("crud.fill_details")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label={t("field.title")} required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="other-income-title" />
              </Field>
            </div>
            <Field label={t("field.amount")} required>
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="other-income-amount" />
            </Field>
            <Field label={t("field.received_at")} required>
              <Input type="date" value={form.received_at} onChange={(e) => setForm({ ...form, received_at: e.target.value })} required />
            </Field>
            <Field label={t("field.category")}>
              <Select
                value={form.category_id || "__none"}
                onValueChange={(v) => setForm({ ...form, category_id: v === "__none" ? "" : v })}
              >
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="__none">—</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{otherIncomeCategoryLabel(c, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("field.method")}>
              <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  {["cash", "card", "bank_transfer", "cheque", "other"].map((m) => (
                    <SelectItem key={m} value={m}>{t(`method.${m}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label={t("field.notes")}>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </Field>
            </div>
            <div className="md:col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={saveMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("other_incomes.new_category")}</DialogTitle>
          </DialogHeader>
          {canAdd && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (catName.trim()) addCatMut.mutate(catName.trim()); }}
            className="space-y-4"
          >
            <Field label={t("other_incomes.category_name")} required>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} required data-testid="other-income-category-name" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCatOpen(false)}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={addCatMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("actions.save")}
              </Button>
            </div>
          </form>
          )}

          <div className="border-t border-border pt-3 space-y-1 max-h-56 overflow-y-auto">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm px-1 py-1">
                <span>{otherIncomeCategoryLabel(c, t)}</span>
                {canDelete && (
                  <Button
                    variant="ghost" size="sm" className="text-destructive h-7"
                    onClick={async () => {
                      if (await confirm({ title: t("confirm.delete_record"), destructive: true })) {
                        deleteCatMut.mutate(c.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
