import CrudPanel, { StatusPill } from "./CrudPanel";
import { Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  first_name: "", last_name: "", email: "", phone: "", subjects: [],
  hourly_rate: 0, monthly_salary: 0, status: "active",
};

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
          <Field label="Subjects (comma separated)">
            <Input
              value={(form.subjects || []).join(", ")}
              onChange={(e) => setForm({ ...form, subjects: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="Math, Physics"
            />
          </Field>
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
