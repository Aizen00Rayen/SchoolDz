import CrudPanel from "./CrudPanel";
import { UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  name: "", email: "", phone: "", address: "", occupation: "", relationship: "father",
  emergency_contact: "",
};

export default function ParentsPage() {
  const { t } = useI18n();
  return (
    <CrudPanel
      moduleKey="parents"
      endpoint="/parents"
      title={t("menu.parents")}
      subtitle="Parents and guardians linked to your students."
      emptyIcon={UserRound}
      defaultForm={DEFAULT_FORM}
      columns={[
        { key: "name", label: "Name", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "phone", label: "Phone", render: (r) => <span className="font-mono text-xs">{r.phone || "—"}</span> },
        { key: "email", label: "Email", render: (r) => r.email || <span className="text-muted-foreground">—</span> },
        { key: "relationship", label: "Relationship", render: (r) => <span className="capitalize text-xs">{r.relationship || "—"}</span> },
        { key: "occupation", label: "Occupation" },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full name" required>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Relationship">
            <Select value={form.relationship || "father"} onValueChange={(v) => setForm({ ...form, relationship: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="father">Father</SelectItem>
                <SelectItem value="mother">Mother</SelectItem>
                <SelectItem value="guardian">Guardian</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Occupation">
            <Input value={form.occupation || ""} onChange={(e) => setForm({ ...form, occupation: e.target.value })} />
          </Field>
          <Field label="Emergency contact">
            <Input value={form.emergency_contact || ""} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
        </div>
      )}
    />
  );
}
