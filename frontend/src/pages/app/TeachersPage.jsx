import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, InviteButton, ExportMenu } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  first_name: "", last_name: "", email: "", phone: "", subjects: [],
  hourly_rate: 0, monthly_salary: 0, status: "active",
};

/** Multi-select for a teacher's subjects, sourced from the center's courses.
 * Any legacy free-form subjects not matching a course are still shown (and
 * kept checked) so editing an existing teacher never silently drops them. */
function SubjectPicker({ selected, onChange }) {
  const { t } = useI18n();
  const { data: courses, isLoading } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const selectedSubjects = selected || [];

  // Union of course titles + any already-selected subjects that aren't courses.
  const courseTitles = (courses?.items || []).map((c) => c.title).filter(Boolean);
  const options = Array.from(new Set([...courseTitles, ...selectedSubjects]));

  const toggle = (subject, checked) => {
    onChange(checked
      ? [...selectedSubjects, subject]
      : selectedSubjects.filter((s) => s !== subject));
  };

  return (
    <div className="border border-border rounded-lg max-h-48 overflow-y-auto p-2 space-y-1 bg-background">
      {isLoading ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.loading_subjects")}</div>
      ) : options.length === 0 ? (
        <div className="text-xs text-muted-foreground p-2">{t("picker.no_courses")}</div>
      ) : (
        options.map((subject) => (
          <label key={subject} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/60 cursor-pointer text-sm">
            <Checkbox
              checked={selectedSubjects.includes(subject)}
              onCheckedChange={(checked) => toggle(subject, !!checked)}
            />
            <span>{subject}</span>
          </label>
        ))
      )}
    </div>
  );
}

export default function TeachersPage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("teachers");
  return (
    <CrudPanel
      moduleKey="teachers"
      endpoint="/teachers"
      title={t("menu.teachers")}
      subtitle={t("subtitle.teachers")}
      emptyIcon={Users}
      defaultForm={DEFAULT_FORM}
      canEdit={canEdit}
      canCreate={canEdit}
      extraActions={<ExportMenu resource="teachers" />}
      columns={[
        {
          key: "name", label: t("field.full_name"),
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] text-muted-foreground">{(r.subjects || []).join(", ")}</div>
            </div>
          ),
        },
        { key: "email", label: t("field.email"), render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: t("field.phone"), render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "hourly_rate", label: t("field.rate_hr"), render: (r) => <span className="font-mono">{r.hourly_rate?.toLocaleString?.() ?? "—"}</span> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
        {
          key: "portal", label: t("field.portal"),
          render: (r) => <InviteButton person={r} endpoint="/teachers" invalidateKey="teachers" />,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.first_name")} required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          </Field>
          <Field label={t("field.last_name")} required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          </Field>
          <Field label={t("field.email")}>
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label={t("field.phone")}>
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.subjects")}>
              <SubjectPicker
                selected={form.subjects}
                onChange={(subjects) => setForm({ ...form, subjects })}
              />
            </Field>
          </div>
          <Field label={t("field.status")}>
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.hourly_rate")}>
            <Input type="number" value={form.hourly_rate || 0} onChange={(e) => setForm({ ...form, hourly_rate: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label={t("field.monthly_salary")}>
            <Input type="number" value={form.monthly_salary || 0} onChange={(e) => setForm({ ...form, monthly_salary: parseFloat(e.target.value) || 0 })} />
          </Field>
        </div>
      )}
    />
  );
}
