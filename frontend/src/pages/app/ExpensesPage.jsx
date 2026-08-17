import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Receipt, Trash2 } from "lucide-react";

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
  title: "", amount: "", spent_at: new Date().toISOString().slice(0, 10),
  category_id: "", method: "cash", notes: "",
};

// Mirrors DEFAULT_EXPENSE_CATEGORIES in django-backend/api/models.py.
export const DEFAULT_EXPENSE_KEYS = [
  "rent", "salaries", "utilities", "supplies", "maintenance",
  "marketing", "transport", "taxes", "equipment", "other",
];

/** A predefined category carries a `key` the UI translates; a tenant-created
 * one carries free text. Accepts either the row ({key, name}) or the bare
 * label the reports endpoint returns — checking against the known key list
 * matters because t() falls back to echoing the key, so a custom category
 * named "Fuel" would otherwise render as "expense_category.Fuel". */
export function categoryLabel(category, t) {
  if (!category) return t("expense_category.uncategorized");
  const key = typeof category === "string" ? category : category.key;
  if (key && (DEFAULT_EXPENSE_KEYS.includes(key) || key === "uncategorized")) {
    return t(`expense_category.${key}`);
  }
  const name = typeof category === "string" ? category : category.name;
  return name || t("expense_category.uncategorized");
}

export default function ExpensesPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { canEdit } = usePermission("expenses");

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
    queryKey: ["expenses", filters],
    queryFn: () => api.get(`/expenses${params ? `?${params}` : ""}`).then((r) => r.data),
  });
  const { data: cats } = useQuery({
    queryKey: ["expense-categories"],
    queryFn: () => api.get("/expense-categories").then((r) => r.data),
  });

  const categories = cats?.items || [];
  const items = data?.items || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["finance-report"] });
  };

  const saveMut = useMutation({
    mutationFn: (payload) =>
      editing
        ? api.patch(`/expenses/${editing.id}`, payload).then((r) => r.data)
        : api.post("/expenses", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t(editing ? "toast.updated" : "toast.created"));
      invalidate();
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/expenses/${id}`),
    onSuccess: () => { toast.success(t("toast.deleted")); invalidate(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const addCatMut = useMutation({
    mutationFn: (name) => api.post("/expense-categories", { name }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.created"));
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      setCatOpen(false);
      setCatName("");
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteCatMut = useMutation({
    mutationFn: (id) => api.delete(`/expense-categories/${id}`),
    onSuccess: () => {
      toast.success(t("toast.deleted"));
      qc.invalidateQueries({ queryKey: ["expense-categories"] });
      invalidate();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setOpen(true); };
  const openEdit = (row) => {
    setEditing(row);
    setForm({
      title: row.title || "", amount: row.amount || "",
      spent_at: (row.spent_at || "").slice(0, 10),
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
        title={t("menu.expenses")}
        subtitle={t("subtitle.expenses")}
        actions={
          <>
            <ExportMenu resource="expenses" />
            {canEdit && (
              <Button variant="outline" onClick={() => setCatOpen(true)}>
                {t("expenses.add_category")}
              </Button>
            )}
            {canEdit && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground" data-testid="expenses-new">
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
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
        <Field label={t("field.category")}>
          <Select
            value={filters.category_id || "__all"}
            onValueChange={(v) => setFilters({ ...filters, category_id: v === "__all" ? "" : v })}
          >
            <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("logs.all_categories")}</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{categoryLabel(c, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end">
          <div className="w-full rounded-lg bg-muted/40 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("expenses.total")}</div>
            <div className="font-mono font-bold text-lg">
              {(data?.total_amount || 0).toLocaleString()} {currency}
            </div>
          </div>
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t("crud.no_items_yet", { module: t("menu.expenses") })}
            description={t("crud.create_first")}
            action={canEdit && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
              </Button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.spent_at", "field.title", "field.category", "field.amount", "field.method"].map((k) => (
                    <th key={k} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {t(k)}
                    </th>
                  ))}
                  {canEdit && <th className="w-24" />}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{row.spent_at}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.title}</div>
                      {row.notes && <div className="text-[11px] text-muted-foreground">{row.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {categoryLabel({ key: row.category_key, name: row.category_name }, t)}
                    </td>
                    <td className="px-4 py-3 font-mono">{Number(row.amount).toLocaleString()} {currency}</td>
                    <td className="px-4 py-3 text-xs">{t(`method.${row.method}`)}</td>
                    {canEdit && (
                      <td className="px-4 py-3 text-end whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>{t("actions.edit")}</Button>
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
              {editing ? t("actions.edit") : t("actions.new")} — {t("menu.expenses")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("crud.fill_details")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label={t("field.title")} required>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required data-testid="expense-title" />
              </Field>
            </div>
            <Field label={t("field.amount")} required>
              <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required data-testid="expense-amount" />
            </Field>
            <Field label={t("field.spent_at")} required>
              <Input type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} required />
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
                    <SelectItem key={c.id} value={c.id}>{categoryLabel(c, t)}</SelectItem>
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
            <DialogTitle className="font-display text-xl">{t("expenses.new_category")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (catName.trim()) addCatMut.mutate(catName.trim()); }}
            className="space-y-4"
          >
            <Field label={t("expenses.category_name")} required>
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} required data-testid="expense-category-name" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCatOpen(false)}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={addCatMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {t("actions.save")}
              </Button>
            </div>
          </form>

          <div className="border-t border-border pt-3 space-y-1 max-h-56 overflow-y-auto">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm px-1 py-1">
                <span>{categoryLabel(c, t)}</span>
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
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
