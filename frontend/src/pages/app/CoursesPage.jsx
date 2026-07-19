import CrudPanel, { StatusPill } from "./CrudPanel";
import { BookOpen, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

const DEFAULT_FORM = {
  title: "", description: "", category: "", duration_weeks: 12, price: 0,
  max_students: 20, color: "#0A0A0B", status: "active", show_on_enrollment: false,
};

export default function CoursesPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  return (
    <CrudPanel
      moduleKey="courses"
      endpoint="/courses"
      title={t("menu.courses")}
      subtitle="Learning programs offered by your center."
      emptyIcon={BookOpen}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "title", label: "Course",
          render: (r) => (
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color || "#0A0A0B" }} />
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-[11px] text-muted-foreground">{r.category || "—"}</div>
              </div>
            </div>
          ),
        },
        { key: "duration_weeks", label: "Duration", render: (r) => `${r.duration_weeks || 0}w` },
        {
          key: "price", label: "Price",
          render: (r) => (
            <span className="font-mono">
              {r.price?.toLocaleString?.() || 0} {tenant?.currency || "DZD"}
            </span>
          ),
        },
        { key: "max_students", label: "Capacity" },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
        {
          key: "show_on_enrollment", label: "Public",
          render: (r) => r.show_on_enrollment ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-success"><Globe className="w-3 h-3" /> Listed</span>
          ) : <span className="text-[11px] text-muted-foreground">—</span>,
        },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Field label="Title" required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </Field>
          </div>
          <Field label="Category">
            <Input value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Languages, Coding..." />
          </Field>
          <Field label="Status">
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Duration (weeks)">
            <Input type="number" value={form.duration_weeks || 12} onChange={(e) => setForm({ ...form, duration_weeks: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Price">
            <Input type="number" value={form.price || 0} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Max students">
            <Input type="number" value={form.max_students || 20} onChange={(e) => setForm({ ...form, max_students: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Color">
            <Input type="color" value={form.color || "#0A0A0B"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <Textarea value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2.5 rounded-lg border border-border p-3 cursor-pointer">
              <Checkbox
                checked={!!form.show_on_enrollment}
                onCheckedChange={(v) => setForm({ ...form, show_on_enrollment: !!v })}
              />
              <div>
                <div className="text-sm font-medium">Show on public enrollment page</div>
                <div className="text-xs text-muted-foreground">Parents will be able to see this course and self-enroll their child, with its active groups shown as available seats.</div>
              </div>
            </label>
          </div>
        </div>
      )}
    />
  );
}
