import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "./StudentsPage";
import { StudentPicker } from "./ParentsPage";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

const DEFAULT_FORM = {
  course_id: "", name: "", teacher_id: "", room: "", capacity: 20,
  schedule: "", status: "active", student_ids: [],
};

export default function GroupsPage() {
  const { t } = useI18n();
  const { canEdit } = usePermission("groups");
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
      subtitle={t("subtitle.groups")}
      emptyIcon={Layers}
      defaultForm={DEFAULT_FORM}
      canEdit={canEdit}
      canCreate={canEdit}
      columns={[
        {
          key: "name", label: t("field.group"),
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
          key: "teacher", label: t("field.teacher"),
          render: (r) => {
            const t = teacherMap[r.teacher_id];
            return t ? `${t.first_name} ${t.last_name}` : <span className="text-muted-foreground">—</span>;
          },
        },
        { key: "room", label: t("field.room") },
        { key: "capacity", label: t("field.capacity") },
        { key: "students", label: t("field.enrolled"), render: (r) => <span className="font-mono">{(r.student_ids || []).length}</span> },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.course")} required>
            <Select value={form.course_id || ""} onValueChange={(v) => setForm({ ...form, course_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder={t("groups.select_course")} /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.group_name")} required>
            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Group A" />
          </Field>
          <Field label={t("field.teacher")}>
            <Select value={form.teacher_id || ""} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder={t("groups.assign_teacher")} /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(teachers?.items || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.room")}>
            <Input value={form.room || ""} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Room 101" />
          </Field>
          <Field label={t("field.capacity")}>
            <Input type="number" value={form.capacity || 20} onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label={t("field.status")}>
            <Select value={form.status || "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="active">{t("status.active")}</SelectItem>
                <SelectItem value="completed">{t("status.completed")}</SelectItem>
                <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
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
