import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  first_name: "", last_name: "", email: "", phone: "", subjects: [],
  hourly_rate: 0, monthly_salary: 0, status: "active",
};

/** Multi-select for a teacher's subjects, sourced from the center's courses.
 * Any legacy free-form subjects not matching a course are still shown (and
 * kept checked) so editing an existing teacher never silently drops them. */
function SubjectPicker({ selected, onChange }) {
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
        <div className="text-xs text-muted-foreground p-2">Loading subjects…</div>
      ) : options.length === 0 ? (
        <div className="text-xs text-muted-foreground p-2">No courses yet — add courses first to pick subjects.</div>
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
  return (
    <CrudPanel
      moduleKey="teachers"
      endpoint="/teachers"
      title={t("menu.teachers")}
      subtitle="Instructors, rates, availability and workload."
      emptyIcon={Users}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "name", label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] text-muted-foreground">{(r.subjects || []).join(", ")}</div>
            </div>
          ),
        },
        { key: "email", label: "Email", render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "hourly_rate", label: "Rate/hr", render: (r) => <span className="font-mono">{r.hourly_rate?.toLocaleString?.() ?? "—"}</span> },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First name" required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
          </Field>
          <Field label="Last name" required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Subjects">
              <SubjectPicker
                selected={form.subjects}
                onChange={(subjects) => setForm({ ...form, subjects })}
              />
            </Field>
          </div>
          <Field label="Status">
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Hourly rate">
            <Input type="number" value={form.hourly_rate || 0} onChange={(e) => setForm({ ...form, hourly_rate: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Monthly salary">
            <Input type="number" value={form.monthly_salary || 0} onChange={(e) => setForm({ ...form, monthly_salary: parseFloat(e.target.value) || 0 })} />
          </Field>
        </div>
      )}
    />
  );
}
