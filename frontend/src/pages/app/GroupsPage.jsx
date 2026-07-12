import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field } from "./StudentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const DEFAULT_FORM = {
  course_id: "", name: "", teacher_id: "", room: "", capacity: 20,
  schedule: "", status: "active",
};

export default function GroupsPage() {
  const { t } = useI18n();
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
  });

  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));
  const teacherMap = Object.fromEntries((teachers?.items || []).map((t) => [t.id, t]));

  return (
    <CrudPanel
      moduleKey="groups"
      endpoint="/groups"
      title={t("menu.groups")}
      subtitle="Class groups linked to courses and teachers."
      emptyIcon={Layers}
      defaultForm={DEFAULT_FORM}
      columns={[
        {
          key: "name", label: "Group",
          render: (r) => (
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {courseMap[r.course_id]?.title || "—"}
              </div>
            </div>
          ),
        },
        {
          key: "teacher", label: "Teacher",
          render: (r) => {
            const t = teacherMap[r.teacher_id];
            return t ? `${t.first_name} ${t.last_name}` : <span className="text-muted-foreground">—</span>;
          },
        },
        { key: "room", label: "Room" },
        { key: "capacity", label: "Capacity" },
        { key: "students", label: "Enrolled", render: (r) => <span className="font-mono">{(r.student_ids || []).length}</span> },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Course" required>
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Group name" required>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Group A" />
          </Field>
          <Field label="Teacher">
            <Select value={form.teacher_id || ""} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="Assign teacher" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(teachers?.items || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Room">
            <Input value={form.room || ""} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Room 101" />
          </Field>
          <Field label="Capacity">
            <Input type="number" value={form.capacity || 20} onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Status">
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Schedule">
              <Input value={form.schedule || ""} onChange={(e) => setForm({ ...form, schedule: e.target.value })} placeholder="Mon, Wed 18:00-20:00" />
            </Field>
          </div>
        </div>
      )}
    />
  );
}
