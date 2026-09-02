import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Trash2, Pencil, AlertTriangle } from "lucide-react";

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
 *  - prepareEditForm?: (row) => row — lets a page derive extra client-only
 *    form fields from the row before it's spread over defaultForm (e.g. a
 *    frontend-only "which tab is this" field the API never returns, which
 *    would otherwise always fall back to defaultForm's value on edit).
 *  - preparePayload?: (form) => payload — lets a page transform its form
 *    state into the exact shape the API expects right before submit (e.g.
 *    dropping unused fields on a per-row basis inside a nested array,
 *    which cleanPayload's shallow strip doesn't reach).
 */
export default function CrudPanel({
  moduleKey, endpoint, title, subtitle, columns, defaultForm, renderForm,
  emptyIcon: EmptyIcon, canEdit = true, canDelete = true, canCreate = true, extraActions,
  rowClassName, renderRowActions, extraParams, filterBar, prepareEditForm, preparePayload,
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(defaultForm || {});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [moduleKey, q, extraParams],
    queryFn: async () => (await api.get(endpoint, { params: { ...(q ? { q } : {}), ...(extraParams || {}) } })).data,
  });

  const createMut = useMutation({
    mutationFn: (payload) => api.post(endpoint, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.created"));
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
      toast.success(t("toast.updated"));
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
      toast.success(t("toast.deleted"));
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
    setForm({ ...defaultForm, ...(prepareEditForm ? prepareEditForm(row) : row) });
    setOpen(true);
  };

  /** A PC-connected barcode/QR scanner acts as a keyboard — it types the
   * scanned payload into whichever field has focus, then sends Enter. That
   * happens fast enough that the debounced search query behind `items`
   * often hasn't resolved yet by the time Enter fires, so this re-queries
   * directly with the current `q` rather than trusting `items` to be
   * fresh. Opens straight to the edit form when the scan (or a manually
   * typed exact search) resolves to exactly one record — e.g. scanning a
   * student's ID card badge to pull up their record instantly. */
  const onSearchKeyDown = async (e) => {
    if (e.key !== "Enter" || !canEdit || !q.trim()) return;
    e.preventDefault();
    try {
      const { data } = await api.get(endpoint, { params: { q, ...(extraParams || {}) } });
      const found = data?.items || [];
      if (found.length === 1) openEdit(found[0]);
    } catch (_e) {
      // Leave the on-screen list/search state as-is — the query above is
      // just a convenience shortcut, not the source of truth.
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const clean = cleanPayload(preparePayload ? preparePayload(form) : form);
    if (editing) updateMut.mutate({ id: editing.id, payload: clean });
    else createMut.mutate(clean);
  };

  const items = data?.items || [];

  /** Edit/delete (plus any page-specific actions) for one record — rendered
   * identically in the desktop table row and the phone card. A plain function,
   * not a component, so it doesn't remount its buttons on every render. */
  const rowActions = (row) => (
    <div className="flex items-center justify-end gap-1 flex-shrink-0">
      {renderRowActions?.(row)}
      {canEdit && (
        <Button
          size="icon" variant="ghost"
          onClick={() => openEdit(row)}
          data-testid={APPUI.rowAction(moduleKey, row.id, "edit")}
          className="h-10 w-10 md:h-8 md:w-8"
          aria-label={t("actions.edit")}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      )}
      {canDelete && (
        <Button
          size="icon" variant="ghost"
          onClick={async () => {
            if (await confirm({ title: t("confirm.delete_record"), destructive: true })) {
              deleteMut.mutate(row.id);
            }
          }}
          data-testid={APPUI.rowAction(moduleKey, row.id, "delete")}
          className="h-10 w-10 md:h-8 md:w-8 text-destructive hover:bg-destructive/10"
          aria-label={t("actions.delete")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );

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

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={t("actions.search")}
            className="ps-9 h-9"
            data-testid={`${moduleKey}-search-input`}
          />
        </div>
        {filterBar}
        <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
          {data?.total ?? 0} {t(`menu.${moduleKey}`)}
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        {isLoading ? (
          <div className="p-4"><LoadingRows /></div>
        ) : isError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("crud.load_failed")}
            description={extractError(error)}
            action={
              <Button variant="outline" onClick={() => refetch()}>
                {t("actions.retry")}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={EmptyIcon}
            title={t("crud.no_items_yet", { module: t(`menu.${moduleKey}`) })}
            description={t("crud.create_first")}
            action={canCreate && (
              <Button onClick={openCreate} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
              </Button>
            )}
          />
        ) : (
          <>
          {/* Phones: one stacked card per record. A 6-to-10 column table can
              only be read on a 375px screen by scrolling sideways through it,
              which hides the row actions and the record you started on. */}
          <div className="md:hidden divide-y divide-border">
            {items.map((row) => (
              <div
                key={row.id}
                data-testid={APPUI.row(moduleKey, row.id)}
                className={`p-4 ${rowClassName ? rowClassName(row) : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 font-medium text-sm">
                    {columns[0].render ? columns[0].render(row) : row[columns[0].key] ?? "—"}
                  </div>
                  {(canEdit || canDelete || renderRowActions) && rowActions(row)}
                </div>
                {columns.length > 1 && (
                  <dl className="mt-3 grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                    {columns.slice(1).map((c) => (
                      <Fragment key={c.key}>
                        <dt className="text-muted-foreground uppercase tracking-wide text-[10px] pt-0.5">
                          {c.label}
                        </dt>
                        <dd className="min-w-0 break-words">
                          {c.render ? c.render(row) : row[c.key] ?? "—"}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="text-start px-4 py-2.5 font-medium text-xs uppercase tracking-widest text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                  {(canEdit || canDelete || renderRowActions) && <th className="w-24"></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={APPUI.row(moduleKey, row.id)}
                    className={`border-b border-border last:border-0 hover:bg-muted/40 transition-colors ${rowClassName ? rowClassName(row) : ""}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-3">
                        {c.render ? c.render(row) : row[c.key] ?? "—"}
                      </td>
                    ))}
                    {(canEdit || canDelete || renderRowActions) && (
                      <td className="px-4 py-2 text-end">
                        {rowActions(row)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editing
                ? t("crud.edit_module", { module: t(`menu.${moduleKey}`) })
                : t("crud.new_module", { module: t(`menu.${moduleKey}`) })}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("crud.fill_details")}
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
