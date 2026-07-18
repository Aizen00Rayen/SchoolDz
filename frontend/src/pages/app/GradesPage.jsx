import { useQuery } from "@tanstack/react-query";
import CrudPanel from "./CrudPanel";
import { Award } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  student_id: "", course_id: "", title: "", score: 0, max_score: 100,
  date: new Date().toISOString().slice(0, 10), notes: "",
};

export default function GradesPage() {
  const { t } = useI18n();
  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const stuMap = Object.fromEntries((students?.items || []).map((s) => [s.id, s]));
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));

  return (
    <CrudPanel
      moduleKey="grades"
      endpoint="/grades"
      title={t("menu.grades")}
      subtitle="Exam and quiz scores per student."
      emptyIcon={Award}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "student", label: "Student",
          render: (r) => {
            const s = stuMap[r.student_id];
            return s ? `${s.first_name} ${s.last_name}` : "—";
          },
        },
        { key: "title", label: "Title", render: (r) => <span className="font-medium">{r.title}</span> },
        {
          key: "course", label: "Course",
          render: (r) => courseMap[r.course_id]?.title || <span className="text-muted-foreground">—</span>,
        },
        {
          key: "score", label: "Score",
          render: (r) => <span className="font-mono">{r.score} / {r.max_score}</span>,
        },
        { key: "date", label: "Date", render: (r) => <span className="font-mono text-xs">{(r.date || "").slice(0, 10)}</span> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Student" required>
            <Select value={form.student_id || ""} onValueChange={(v) => setForm({ ...form, student_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="Select student" /></SelectTrigger>
              <SelectContent className="bg-popover max-h-72">
                {(students?.items || []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.first_name} {s.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Course">
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
            <Field label="Title" required>
              <Input value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })} required placeholder="Midterm exam" />
            </Field>
          </div>
          <Field label="Score" required>
            <Input type="number" value={form.score ?? 0} onChange={(e) => setForm({ ...form, score: parseFloat(e.target.value) || 0 })} required />
          </Field>
          <Field label="Max score">
            <Input type="number" value={form.max_score ?? 100} onChange={(e) => setForm({ ...form, max_score: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={(form.date || "").slice(0, 10)} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </Field>
        </div>
      )}
    />
  );
}
