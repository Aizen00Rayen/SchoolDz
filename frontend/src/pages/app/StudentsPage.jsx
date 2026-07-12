import CrudPanel, { StatusPill } from "./CrudPanel";
import { GraduationCap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  first_name: "",
  last_name: "",
  gender: "male",
  birth_date: "",
  email: "",
  phone: "",
  address: "",
  emergency_contact: "",
  medical_notes: "",
  status: "active",
  notes: "",
};

export default function StudentsPage() {
  const { t } = useI18n();
  return (
    <CrudPanel
      moduleKey="students"
      endpoint="/students"
      title={t("menu.students")}
      subtitle="Manage learners, profiles, and enrollment status."
      emptyIcon={GraduationCap}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "name", label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{r.student_code}</div>
            </div>
          ),
        },
        { key: "email", label: "Email", render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "phone", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "gender", label: "Gender", render: (r) => <span className="capitalize text-xs">{r.gender || "—"}</span> },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="First name" required>
            <Input value={form.first_name || ""} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required data-testid="student-form-firstname" />
          </Field>
          <Field label="Last name" required>
            <Input value={form.last_name || ""} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required data-testid="student-form-lastname" />
          </Field>
          <Field label="Gender">
            <Select value={form.gender || "male"} onValueChange={(v) => setForm({ ...form, gender: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Birth date">
            <Input type="date" value={(form.birth_date || "").slice(0, 10)} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="student-form-email" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Emergency contact">
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="graduated">Graduated</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
        </div>
      )}
    />
  );
}

function Field({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
    </div>
  );
}
export { Field };
