import { Plane } from "lucide-react";
import CrudPanel from "./CrudPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./StudentsPage";
import { StudentPicker } from "./ParentsPage";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  title: "", destination: "", price: 0, trip_date: "", notes: "", student_ids: [],
};

export default function TripsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canEdit } = usePermission("trips");

  return (
    <CrudPanel
      moduleKey="trips"
      endpoint="/trips"
      title={t("menu.trips")}
      subtitle={t("subtitle.trips")}
      emptyIcon={Plane}
      defaultForm={DEFAULT_FORM}
      canEdit={canEdit}
      canCreate={canEdit}
      columns={[
        {
          key: "title", label: t("field.trip"),
          render: (r) => (
            <div>
              <div className="font-medium">{r.title}</div>
              <div className="text-[11px] text-muted-foreground">{r.destination}</div>
            </div>
          ),
        },
        { key: "trip_date", label: t("field.trip_date"), render: (r) => r.trip_date || <span className="text-muted-foreground">—</span> },
        {
          key: "price", label: t("field.price"),
          render: (r) => (
            <span className="font-mono font-semibold">
              {Math.round(r.price || 0).toLocaleString()} {tenant?.currency || "DZD"}
            </span>
          ),
        },
        { key: "students", label: t("field.enrolled"), render: (r) => <span className="font-mono">{(r.student_ids || []).length}</span> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.trip")} required>
            <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </Field>
          <Field label={t("field.destination")} required>
            <Input value={form.destination || ""} onChange={(e) => setForm({ ...form, destination: e.target.value })} required />
          </Field>
          <Field label={t("field.price")} required>
            <Input type="number" step="0.01" min="0" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} required />
          </Field>
          <Field label={t("field.trip_date")}>
            <Input type="date" value={form.trip_date || ""} onChange={(e) => setForm({ ...form, trip_date: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.notes")}>
              <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
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
