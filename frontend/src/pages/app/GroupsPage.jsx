import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "./StudentsPage";
import { StudentPicker } from "./ParentsPage";
import { RoomSelect, SchoolLevelCell, courseOptionLabel } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { SCHOOL_LEVELS, SCHOOL_LEVEL_YEAR_COUNT } from "@/lib/schoolLevels";

const DEFAULT_FORM = {
  course_id: "", name: "", teacher_id: "", room_id: "", capacity: 20,
  schedule: "", status: "active", student_ids: [],
};

export default function GroupsPage() {
  const { t } = useI18n();
  const { canAdd, canModify, canDelete } = usePermission("groups");
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

  // A big school ends up with dozens of groups — level/year narrows the
  // course list down to what's actually relevant, then course pins it to
  // one exact group set. Picking a level resets year+course since a course
  // that matched before might not anymore; picking a year resets course
  // the same way.
  const [levelFilter, setLevelFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");

  const filterableCourses = useMemo(() => {
    return (courses?.items || []).filter((c) => {
      if (levelFilter && c.school_level !== levelFilter) return false;
      if (yearFilter && String(c.school_year) !== yearFilter) return false;
      return true;
    });
  }, [courses, levelFilter, yearFilter]);

  const extraParams = {};
  if (courseFilter) extraParams.course_id = courseFilter;
  if (levelFilter) extraParams.school_level = levelFilter;
  if (yearFilter) extraParams.school_year = yearFilter;

  return (
    <CrudPanel
      moduleKey="groups"
      endpoint="/groups"
      title={t("menu.groups")}
      subtitle={t("subtitle.groups")}
      emptyIcon={Layers}
      defaultForm={DEFAULT_FORM}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      extraParams={extraParams}
      filterBar={(
        <div className="flex items-center gap-1.5">
          <Select
            value={levelFilter || "__all"}
            onValueChange={(v) => {
              const next = v === "__all" ? "" : v;
              setLevelFilter(next);
              setYearFilter("");
              setCourseFilter("");
            }}
          >
            <SelectTrigger className="bg-background h-9 w-auto min-w-[130px]" data-testid="groups-filter-level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("groups.all_levels")}</SelectItem>
              {SCHOOL_LEVELS.map((lvl) => (
                <SelectItem key={lvl} value={lvl}>{t(`school_level.${lvl}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={yearFilter || "__all"}
            onValueChange={(v) => {
              const next = v === "__all" ? "" : v;
              setYearFilter(next);
              setCourseFilter("");
            }}
            disabled={!levelFilter}
          >
            <SelectTrigger className="bg-background h-9 w-auto min-w-[110px]" data-testid="groups-filter-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("groups.all_years")}</SelectItem>
              {Array.from({ length: SCHOOL_LEVEL_YEAR_COUNT[levelFilter] || 0 }, (_, i) => i + 1).map((y) => (
                <SelectItem key={y} value={String(y)}>{t("common.year_n", { n: y })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={courseFilter || "__all"} onValueChange={(v) => setCourseFilter(v === "__all" ? "" : v)}>
            <SelectTrigger className="bg-background h-9 w-auto min-w-[160px]" data-testid="groups-filter-course">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="__all">{t("groups.all_courses")}</SelectItem>
              {filterableCourses.map((c) => (
                <SelectItem key={c.id} value={c.id}>{courseOptionLabel(c, t)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      columns={[
        {
          key: "name", label: t("field.group"),
          render: (r) => (
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {courseMap[r.course_id]?.title || "—"}
              </div>
              {courseMap[r.course_id]?.school_level && (
                <div className="mt-0.5"><SchoolLevelCell row={courseMap[r.course_id]} /></div>
              )}
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
        { key: "room", label: t("field.room"), render: (r) => r.room_name || r.room || <span className="text-muted-foreground">—</span> },
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
                  <SelectItem key={c.id} value={c.id}>{courseOptionLabel(c, t)}</SelectItem>
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
            <RoomSelect value={form.room_id} onChange={(v) => setForm({ ...form, room_id: v })} />
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
              max={parseInt(form.capacity, 10) || 0}
            />
          </div>
        </div>
      )}
    />
  );
}
