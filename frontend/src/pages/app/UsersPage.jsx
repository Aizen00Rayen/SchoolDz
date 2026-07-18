import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Users, Trash2, Search } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { PageHeader, EmptyState } from "./_shared";
import { Field } from "./StudentsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "director", label: "Director" },
  { value: "secretary", label: "Secretary" },
  { value: "accountant", label: "Accountant" },
  { value: "teacher", label: "Teacher" },
  { value: "parent", label: "Parent" },
];

export default function UsersPage() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "secretary", phone: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["users-list", q],
    queryFn: async () => (await api.get("/users", { params: q ? { q } : {} })).data,
  });

  const createMut = useMutation({
    mutationFn: (payload) => api.post("/users", payload).then((r) => r.data),
    onSuccess: () => {
      toast.success("User created");
      qc.invalidateQueries({ queryKey: ["users-list"] });
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "secretary", phone: "" });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["users-list"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const items = data?.items || [];

  return (
    <div>
      <PageHeader
        title={t("menu.users")}
        subtitle="Team members, roles and permissions."
        actions={
          <Button
            onClick={() => setOpen(true)}
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
          {data?.total ?? 0} users
        </div>
      </div>

      {items.length === 0 && !isLoading ? (
        <EmptyState icon={Users} title="No team members yet" description="Invite colleagues to help run your center." />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Name</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Email</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Role</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Phone</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/40" data-testid={`users-row-${u.id}`}>
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{u.phone || "—"}</td>
                  <td className="px-4 py-2 text-end">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={async () => {
                        if (await confirm({ title: "Delete this user?", destructive: true })) {
                          deleteMut.mutate(u.id);
                        }
                      }}
                      className="h-8 w-8 text-destructive"
                      data-testid={`users-delete-${u.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Add team member</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Grant a colleague access with a specific role.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate(form);
            }}
            className="space-y-4"
          >
            <Field label="Full name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="users-form-name" />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Email" required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="users-form-email" />
              </Field>
              <Field label="Password" required>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} data-testid="users-form-password" />
              </Field>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Role">
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger className="bg-background" data-testid="users-form-role"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover">
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={createMut.isPending}
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
