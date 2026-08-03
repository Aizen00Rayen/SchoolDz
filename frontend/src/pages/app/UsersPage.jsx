import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Users, Trash2, Pencil, Search } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { PERMISSION_MODULES, isFullAccessRole } from "@/lib/permissions";
import { PageHeader, EmptyState } from "./_shared";
import { Field } from "./StudentsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ROLE_VALUES = ["owner", "director", "secretary", "accountant", "teacher", "parent"];
const LEVELS = ["hidden", "view", "edit"];

// Sensible starting point when a role is first picked — the owner can then
// customize every row before saving. Only secretary/accountant/teacher are
// ever limited; owner/director always have full access (see isFullAccessRole).
const ROLE_PRESETS = {
  secretary: {
    students: "edit", parents: "edit", teachers: "edit", courses: "edit", groups: "edit",
    sessions: "edit", attendance: "edit", grades: "edit", messages: "edit", payments: "view",
  },
  accountant: {
    students: "view", courses: "view", payments: "edit",
    teachers: "hidden", parents: "hidden", groups: "hidden", sessions: "hidden",
    attendance: "hidden", grades: "hidden", messages: "hidden",
  },
  teacher: {
    students: "view", groups: "view", sessions: "view", attendance: "edit", grades: "edit",
    teachers: "hidden", parents: "hidden", courses: "hidden", payments: "hidden", messages: "hidden",
  },
};
const EMPTY_PERMISSIONS = Object.fromEntries(PERMISSION_MODULES.map((m) => [m, "hidden"]));

const DEFAULT_FORM = { name: "", email: "", password: "", role: "secretary", phone: "", permissions: ROLE_PRESETS.secretary };

function PermissionMatrix({ permissions, onChange }) {
  const { t } = useI18n();
  return (
    <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
      {PERMISSION_MODULES.map((moduleKey) => (
        <div key={moduleKey} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-sm font-medium">{t(`menu.${moduleKey}`)}</span>
          <div className="inline-flex rounded-md border border-border overflow-hidden flex-shrink-0">
            {LEVELS.map((level) => {
              const active = (permissions[moduleKey] || "hidden") === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => onChange((prev) => ({ ...prev, [moduleKey]: level }))}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? "bg-accent text-accent-foreground" : "bg-background hover:bg-muted text-muted-foreground"
                  }`}
                  data-testid={`users-permission-${moduleKey}-${level}`}
                >
                  {t(`permissions.${level}`)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["users-list", q],
    queryFn: async () => (await api.get("/users", { params: q ? { q } : {} })).data,
  });

  const openCreate = () => {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      name: u.name, email: u.email, password: "", role: u.role, phone: u.phone || "",
      permissions: { ...EMPTY_PERMISSIONS, ...(u.permissions || {}) },
    });
    setOpen(true);
  };

  const onRoleChange = (role) => {
    setForm((f) => ({ ...f, role, permissions: ROLE_PRESETS[role] ? { ...EMPTY_PERMISSIONS, ...ROLE_PRESETS[role] } : f.permissions }));
  };

  const createMut = useMutation({
    mutationFn: (payload) => api.post("/users", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.user_created"));
      qc.invalidateQueries({ queryKey: ["users-list"] });
      setOpen(false);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => api.patch(`/users/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.settings_saved"));
      qc.invalidateQueries({ queryKey: ["users-list"] });
      setOpen(false);
      setEditing(null);
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success(t("toast.user_deleted"));
      qc.invalidateQueries({ queryKey: ["users-list"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const onSubmit = (e) => {
    e.preventDefault();
    const permissions = isFullAccessRole(form.role) ? {} : form.permissions;
    if (editing) {
      updateMut.mutate({ id: editing.id, payload: { name: form.name, email: form.email, role: form.role, phone: form.phone, permissions } });
    } else {
      createMut.mutate({ ...form, permissions });
    }
  };

  const items = data?.items || [];
  const busy = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <PageHeader
        title={t("menu.users")}
        subtitle={t("subtitle.users")}
        actions={
          <Button
            onClick={openCreate}
            data-testid="users-create-button"
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            <Plus className="w-4 h-4 me-2" /> {t("actions.new")}
          </Button>
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
            data-testid="users-search-input"
          />
        </div>
        <div className="text-xs text-muted-foreground font-mono">
          {data?.total ?? 0} {t("menu.users")}
        </div>
      </div>

      {items.length === 0 && !isLoading ? (
        <EmptyState icon={Users} title={t("users.no_members_title")} description={t("users.no_members_desc")} />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.name")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.email")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.role")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.phone")}</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/40" data-testid={`users-row-${u.id}`}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{t(`role.${u.role}`)}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.phone || "—"}</td>
                  <td className="px-4 py-2 text-end">
                    <div className="flex items-center justify-end gap-1">
                      {u.role !== "super_admin" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openEdit(u)}
                          className="h-8 w-8"
                          data-testid={`users-edit-${u.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (await confirm({ title: t("confirm.delete_user"), destructive: true })) {
                            deleteMut.mutate(u.id);
                          }
                        }}
                        className="h-8 w-8 text-destructive"
                        data-testid={`users-delete-${u.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-card max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{editing ? t("users.edit_member") : t("users.add_member")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("users.grant_access")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label={t("field.full_name")} required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="users-form-name" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("field.email")} required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="users-form-email" />
              </Field>
              {editing ? (
                <Field label={t("field.phone")}>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
              ) : (
                <Field label={t("field.password")} required>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} data-testid="users-form-password" />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("field.role")}>
                <Select value={form.role} onValueChange={onRoleChange}>
                  <SelectTrigger className="bg-background" data-testid="users-form-role"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {ROLE_VALUES.map((v) => (
                      <SelectItem key={v} value={v}>{t(`role.${v}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {!editing && (
                <Field label={t("field.phone")}>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
              )}
            </div>

            {form.role !== "parent" && (
              <div>
                <Field label={t("permissions.title")}>
                  <p className="text-xs text-muted-foreground mb-2">{t("permissions.desc")}</p>
                  {isFullAccessRole(form.role) ? (
                    <p className="text-xs text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
                      {t("permissions.full_access")}
                    </p>
                  ) : (
                    <PermissionMatrix
                      permissions={form.permissions}
                      onChange={(updater) => setForm((f) => ({ ...f, permissions: updater(f.permissions) }))}
                    />
                  )}
                </Field>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={busy}
                data-testid="users-form-submit"
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
