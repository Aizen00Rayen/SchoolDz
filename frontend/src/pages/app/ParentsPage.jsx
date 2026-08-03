import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import CrudPanel from "./CrudPanel";
import { Copy, Send, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  name: "", email: "", phone: "", address: "", occupation: "", relationship: "father",
  emergency_contact: "", student_ids: [],
};

function InviteButton({ guardian, canInvite }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState(null);

  const inviteMut = useMutation({
    mutationFn: () => api.post(`/parents/${guardian.id}/invite`).then((r) => r.data),
    onSuccess: (data) => {
      setInviteUrl(data.invite_url);
      qc.invalidateQueries({ queryKey: ["parents"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  if (!canInvite) {
    return (
      <Button size="sm" variant="outline" disabled title={t("invite.available_plans")}>
        <Send className="w-3.5 h-3.5 me-1.5" /> {t("invite.invite")}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm" variant="outline"
        disabled={!guardian.email || inviteMut.isPending}
        onClick={() => inviteMut.mutate()}
        title={!guardian.email ? t("invite.add_email_first") : undefined}
      >
        <Send className="w-3.5 h-3.5 me-1.5" /> {guardian.user_id ? t("invite.reinvite") : t("invite.invite")}
      </Button>
      <Dialog open={!!inviteUrl} onOpenChange={(open) => !open && setInviteUrl(null)}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{t("invite.link_ready")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("invite.share_hint", { name: guardian.name })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={inviteUrl || ""} className="font-mono text-xs" />
            <Button
              type="button" size="icon" variant="outline"
              onClick={() => { navigator.clipboard.writeText(inviteUrl); toast.success(t("toast.copied")); }}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function StudentPicker({ selected, onChange }) {
  const { t } = useI18n();
  const { data: students, isLoading } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const items = students?.items || [];
  const ids = selected || [];

  const toggle = (studentId, checked) => {
    onChange(checked ? [...ids, studentId] : ids.filter((id) => id !== studentId));
  };

  return (
    <div className="border border-border rounded-lg max-h-48 overflow-y-auto p-2 space-y-1 bg-background">
      {isLoading ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.loading_students")}</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.no_students")}</div>
      ) : (
        items.map((s) => (
          <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-sm">
            <Checkbox
              checked={ids.includes(s.id)}
              onCheckedChange={(checked) => toggle(s.id, !!checked)}
            />
            <span>{s.first_name} {s.last_name}</span>
            <span className="text-[11px] font-mono text-muted-foreground ms-auto">{s.student_code}</span>
          </label>
        ))
      )}
    </div>
  );
}

export default function ParentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const canInvite = tenant?.plan && tenant.plan !== "basic";
  return (
    <CrudPanel
      moduleKey="parents"
      endpoint="/parents"
      title={t("menu.parents")}
      subtitle={t("subtitle.parents")}
      emptyIcon={UserRound}
      defaultForm={DEFAULT_FORM}
      columns={[
        { key: "name", label: t("field.full_name"), render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "relationship", label: t("field.relationship"), render: (r) => <span className="capitalize text-xs">{r.relationship ? t(`relationship.${r.relationship}`) : "—"}</span> },
        {
          key: "portal", label: t("field.portal"),
          render: (r) => <InviteButton guardian={r} canInvite={canInvite} />,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.full_name")} required>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label={t("field.relationship")}>
            <Select value={form.relationship || "father"} onValueChange={(v) => setForm({ ...form, relationship: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="father">{t("relationship.father")}</SelectItem>
                <SelectItem value="mother">{t("relationship.mother")}</SelectItem>
                <SelectItem value="guardian">{t("relationship.guardian")}</SelectItem>
                <SelectItem value="other">{t("relationship.other")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label={t("field.email")}>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("field.occupation")}>
            <Input value={form.occupation || ""} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
          </Field>
          <Field label={t("field.emergency_contact")}>
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.address")}>
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs font-medium mb-1.5 block">{t("field.students")}</Label>
            <StudentPicker
              selected={form.student_ids}
              onChange={(ids) => setForm({ ...form, student_ids: ids })}
            />
          </div>
        </div>
      )}
    />
  );
}
