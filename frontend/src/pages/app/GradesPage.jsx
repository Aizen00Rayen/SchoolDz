import { useQuery } from "@tanstack/react-query";
import CrudPanel from "./CrudPanel";
import { Award } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import { StudentSearchSelect } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { DateInput } from "@/components/DateInput";
import { formatDate } from "@/lib/format";

const DEFAULT_FORM = {
  student_id: "", course_id: "", title: "", score: 0, max_score: 100,
  date: new Date().toISOString().slice(0, 10), notes: "",
};

export default function GradesPage() {
  const { t } = useI18n();
  const { canAdd, canModify, canDelete } = usePermission("grades");
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));

  return (
    <CrudPanel
      moduleKey="grades"
      endpoint="/grades"
      title={t("menu.grades")}
      subtitle={t("subtitle.grades")}
      emptyIcon={Award}
      defaultForm={DEFAULT_FORM}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      columns={[
        {
          key: "student", label: t("field.student"),
          render: (r) => {
            return r.student_name || "—";
          },
        },
        { key: "title", label: t("field.exam_subject"), render: (r) => <span className="font-medium">{r.title}</span> },
        {
          key: "course", label: t("field.course"),
          render: (r) => courseMap[r.course_id]?.title || <span className="text-muted-foreground">—</span>,
        },
        {
          key: "score", label: t("field.score"),
          render: (r) => <span className="font-mono">{r.score} / {r.max_score}</span>,
        },
        { key: "date", label: t("field.date"), render: (r) => <span className="font-mono text-xs">{formatDate(r.date, "short")}</span> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.student")} required>
            <StudentSearchSelect value={form.student_id} onChange={(id) => setForm({ ...form, student_id: id })} />
          </Field>
          <Field label={t("field.course")}>
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.exam_subject")} required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Midterm exam" />
            </Field>
          </div>
          <Field label={t("field.score")} required>
            <Input type="number" value={form.score ?? 0} onChange={(e) => setForm({ ...form, score: parseFloat(e.target.value) || 0 })} required />
          </Field>
          <Field label={t("field.max_score")}>
            <Input type="number" value={form.max_score ?? 100} onChange={(e) => setForm({ ...form, max_score: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label={t("field.date")} required>
            <DateInput value={(form.date || "").slice(0, 10)} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
        </div>
      )}
    />
  );
}
