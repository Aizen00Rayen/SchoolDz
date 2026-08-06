import { useQuery } from "@tanstack/react-query";
import CrudPanel from "./CrudPanel";
import { UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, InviteButton, ExportMenu } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  name: "", email: "", phone: "", address: "", occupation: "", relationship: "father",
  emergency_contact: "", student_ids: [],
};

/** `max` (optional) caps how many students can be checked — used by
 * GroupsPage to keep enrollment from exceeding the group's capacity field.
 * Selecting fewer is always fine; once at max, unchecked rows just disable
 * until something is unchecked again. Omit `max` for unlimited pickers
 * (e.g. linking a guardian's own children, which has no such ceiling). */
export function StudentPicker({ selected, onChange, max }) {
  const { t } = useI18n();
  const { data: students, isLoading } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const items = students?.items || [];
  const ids = selected || [];
  const hasMax = typeof max === "number" && !Number.isNaN(max);
  const atMax = hasMax && ids.length >= max;

  const toggle = (studentId, checked) => {
    if (checked && atMax) return;
    onChange(checked ? [...ids, studentId] : ids.filter((id) => id !== studentId));
  };

  return (
    <div>
      {hasMax && (
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground">{t("picker.selected_count", { count: ids.length, max })}</span>
          {atMax && <span className="text-warning font-medium">{t("picker.max_reached")}</span>}
        </div>
      )}
      <div className="border border-border rounded-lg max-h-48 overflow-y-auto p-2 space-y-1 bg-background">
        {isLoading ? (
          <div className="text-xs text-muted-foreground p-2">{t("picker.loading_students")}</div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2">{t("picker.no_students")}</div>
        ) : (
          items.map((s) => {
            const checked = ids.includes(s.id);
            const disabled = !checked && atMax;
            return (
              <label
                key={s.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
                  disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/60 cursor-pointer"
                }`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(c) => toggle(s.id, !!c)}
                />
                <span>{s.first_name} {s.last_name}</span>
                <span className="text-[11px] font-mono text-muted-foreground ms-auto">{s.student_code}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function ParentsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const canInvite = tenant?.plan && tenant.plan !== "basic";
  const { canEdit } = usePermission("parents");
  return (
    <CrudPanel
      moduleKey="parents"
      endpoint="/parents"
      canEdit={canEdit}
      canCreate={canEdit}
      title={t("menu.parents")}
      subtitle={t("subtitle.parents")}
      emptyIcon={UserRound}
      defaultForm={DEFAULT_FORM}
      extraActions={<ExportMenu resource="parents" />}
      columns={[
        { key: "name", label: t("field.full_name"), render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "relationship", label: t("field.relationship"), render: (r) => <span className="capitalize text-xs">{r.relationship ? t(`relationship.${r.relationship}`) : "—"}</span> },
        {
          key: "portal", label: t("field.portal"),
          render: (r) => <InviteButton person={r} endpoint="/parents" invalidateKey="parents" canInvite={canInvite} />,
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
