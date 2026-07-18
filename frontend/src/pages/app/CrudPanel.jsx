import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pencil } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { APPUI } from "@/constants/testIds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "./_shared";

/** Remove empty strings from payload so Optional[EmailStr] etc. validate. */
function cleanPayload(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "" || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Generic CRUD panel for a scoped module.
 * Props:
 *  - moduleKey: e.g. 'students'
 *  - endpoint: '/students'
 *  - title, subtitle
 *  - columns: [{ key, label, render?, sortable? }]
 *  - defaultForm: {}
 *  - renderForm: (form, setForm) => JSX
 *  - emptyIcon: Icon
 *  - normalize?: (row) => row (client-side)
 */
export default function CrudPanel({
  moduleKey, endpoint, title, subtitle, columns, defaultForm, renderForm,
  emptyIcon: EmptyIcon, canEdit = true, canCreate = true, extraActions,
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(defaultForm || {});

  const { data, isLoading } = useQuery({
    queryKey: [moduleKey, q],
    queryFn: async () => (await api.get(endpoint, { params: q ? { q } : {} })).data,
  });

  const createMut = useMutation({
    mutationFn: (payload) => api.post(endpoint, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("Created");
      qc.invalidateQueries({ queryKey: [moduleKey] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      setOpen(false);
      setForm(defaultForm || {});
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`${endpoint}/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: [moduleKey] });
      setOpen(false);
      setEditing(null);
      setForm(defaultForm || {});
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`${endpoint}/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: [moduleKey] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm || {});
    setOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({ ...defaultForm, ...row });
    setOpen(true);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const clean = cleanPayload(form);
    if (editing) updateMut.mutate({ id: editing.id, payload: clean });
    else createMut.mutate(clean);
  };

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {extraActions}
            {canCreate && (
              <Button
                onClick={openCreate}
                data-testid={APPUI.createNew(moduleKey)}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("actions.search")}
            className="ps-9 h-9"
            data-testid={`${moduleKey}-search-input`}
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {data?.total ?? 0} {moduleKey}
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={EmptyIcon}
            title={`No ${moduleKey} yet`}
            description="Create your first record to get started."
            action={canCreate && (
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
                  {columns.map((c) => (
                    <th key={c.key} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                  {canEdit && <th className="w-24"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={APPUI.row(moduleKey, row.id)}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        {c.render ? c.render(row) : row[c.key] ?? "—"}
                      </td>
                    ))}
                    {canEdit && (
                      <td className="px-4 py-2 text-end">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon" variant="ghost"
                            onClick={() => openEdit(row)}
                            data-testid={APPUI.rowAction(moduleKey, row.id, "edit")}
                            className="h-8 w-8"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon" variant="ghost"
                            onClick={async () => {
                              if (await confirm({ title: "Delete this record?", destructive: true })) {
                                deleteMut.mutate(row.id);
                              }
                            }}
                            data-testid={APPUI.rowAction(moduleKey, row.id, "delete")}
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
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
        <DialogContent className="max-w-2xl bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editing ? `${t("actions.edit")} ${moduleKey}` : `${t("actions.new")} ${moduleKey}`}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Fill in the details below and click Save.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            {renderForm(form, setForm)}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button" variant="outline"
                onClick={() => setOpen(false)}
                data-testid={APPUI.formCancel(moduleKey)}
              >
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createMut.isPending || updateMut.isPending}
                data-testid={APPUI.formSubmit(moduleKey)}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {t("actions.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { StatusPill };
