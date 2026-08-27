import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Library, PackagePlus, Eye, Search } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";
import CrudPanel from "./CrudPanel";
import { Field } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const DEFAULT_FORM = { title: "", description: "", price: 0 };

function RestockDialog({ book, onClose }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(10);

  const restockMut = useMutation({
    mutationFn: () => api.post(`/books/${book.id}/restock`, { quantity }).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.updated"));
      qc.invalidateQueries({ queryKey: ["books"] });
      onClose();
    },
    onError: (e) => toast.error(extractError(e)),
  });

  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {t("books.restock_title", { title: book?.title })}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); restockMut.mutate(); }}
          className="space-y-4"
        >
          <Field label={t("books.quantity")} required>
            <Input
              type="number" min="1" max="1000" value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              required autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("actions.cancel")}</Button>
            <Button type="submit" disabled={restockMut.isPending} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {t("actions.restock")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopiesDialog({ book, onClose }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["book-copies", book?.id, q],
    queryFn: async () => (await api.get(`/books/${book.id}/copies`, { params: q ? { q } : {} })).data,
    enabled: !!book,
  });

  const items = data?.items || [];

  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {t("books.copies_title", { title: book?.title })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("books.in_stock")}: {book?.in_stock_count ?? 0} · {t("books.sold")}: {book?.sold_count ?? 0}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t("books.search_copy_code")}
            className="ps-9 h-9"
          />
        </div>

        {isLoading ? null : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("books.no_copies")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  {["field.copy_code", "field.status", "books.sold_to", "books.sold_by", "books.sold_at"].map((k) => (
                    <th key={k} className="text-start px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground font-medium">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{c.copy_code}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === "sold" ? "bg-muted text-muted-foreground" : "bg-success/10 text-success"}`}>
                        {t(c.status === "sold" ? "books.status_sold" : "books.status_in_stock")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{c.buyer_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-xs">{c.sold_by_name || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {c.sold_at ? new Date(c.sold_at).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function BooksPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canAdd, canModify, canDelete } = usePermission("books");
  const [restocking, setRestocking] = useState(null);
  const [viewingCopies, setViewingCopies] = useState(null);

  return (
    <>
      <CrudPanel
        moduleKey="books"
        endpoint="/books"
        title={t("menu.books")}
        subtitle={t("subtitle.books")}
        emptyIcon={Library}
        defaultForm={DEFAULT_FORM}
        canEdit={canModify}
        canDelete={canDelete}
        canCreate={canAdd}
        columns={[
          {
            key: "title", label: t("field.title"),
            render: (r) => (
              <div>
                <div className="font-medium">{r.title}</div>
                {r.description && <div className="text-[11px] text-muted-foreground truncate max-w-xs">{r.description}</div>}
              </div>
            ),
          },
          {
            key: "price", label: t("field.price"),
            render: (r) => (
              <span className="font-mono font-semibold">
                {Math.round(r.price || 0).toLocaleString()} {tenant?.currency || "DZD"}
              </span>
            ),
          },
          {
            key: "stock", label: t("field.stock"),
            render: (r) => (
              <span className={`font-mono ${r.in_stock_count > 0 ? "" : "text-destructive"}`}>{r.in_stock_count}</span>
            ),
          },
          { key: "sold", label: t("books.sold"), render: (r) => <span className="font-mono text-muted-foreground">{r.sold_count}</span> },
        ]}
        renderRowActions={(row) => (
          <>
            <Button
              size="icon" variant="ghost" className="h-10 w-10 md:h-8 md:w-8"
              aria-label={t("books.view_copies")} title={t("books.view_copies")}
              onClick={() => setViewingCopies(row)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            {canAdd && (
              <Button
                size="icon" variant="ghost" className="h-10 w-10 md:h-8 md:w-8"
                aria-label={t("actions.restock")} title={t("actions.restock")}
                onClick={() => setRestocking(row)}
              >
                <PackagePlus className="w-3.5 h-3.5" />
              </Button>
            )}
          </>
        )}
        renderForm={(form, setForm) => (
          <div className="grid grid-cols-1 gap-4">
            <Field label={t("field.title")} required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
            <Field label={t("field.price")} required>
              <Input type="number" step="0.01" min="0" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} required />
            </Field>
            <Field label={t("field.description")}>
              <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </Field>
          </div>
        )}
      />

      <RestockDialog book={restocking} onClose={() => setRestocking(null)} />
      <CopiesDialog book={viewingCopies} onClose={() => setViewingCopies(null)} />
    </>
  );
}
