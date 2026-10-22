import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { CalendarClock, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, RecurringDialog, RoomSelect, groupOptionLabel, isoToLocalInput, localInputToIso } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { formatDate, formatTime } from "@/lib/format";
import { DateInput } from "@/components/DateInput";

const DEFAULT_DURATION_MIN = 90;

/** A new session starts at the next round hour and lasts 1h30 by default —
 * not "now" to "now", which had to be fixed by hand every time. */
const defaultForm = () => {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  return {
    group_id: "", teacher_id: "", room_id: "", start_at: start.toISOString(), end_at: end.toISOString(),
    topic: "", status: "scheduled",
  };
};


/** Combined date + start/end time range picker for a session. form.start_at/
 * end_at always hold real UTC ISO strings (freshly defaulted, or loaded
 * from the API when editing) — converted to/from naive local values only
 * at the edges, right where the <input> fields read and write them, so the
 * displayed date/time always matches the user's own clock. */
function SessionRangePicker({ form, setForm }) {
  const { t } = useI18n();
  const startLocal = isoToLocalInput(form.start_at);
  const endLocal = isoToLocalInput(form.end_at);
  const date = startLocal.slice(0, 10);
  const startTime = startLocal.slice(11, 16);
  const endTime = endLocal.slice(11, 16);

  const onDate = (newDate) => {
    setForm({
      ...form,
      start_at: localInputToIso(`${newDate}T${startTime || "00:00"}`),
      end_at: localInputToIso(`${newDate}T${endTime || "00:00"}`),
    });
  };
  // Moving the start keeps the session's length, so the end follows along.
  const onStartTime = (newTime) => {
    if (!newTime) return;
    const oldStart = new Date(form.start_at).getTime();
    const oldEnd = new Date(form.end_at).getTime();
    const duration = oldEnd > oldStart ? oldEnd - oldStart : DEFAULT_DURATION_MIN * 60000;
    const startIso = localInputToIso(`${date}T${newTime}`);
    setForm({ ...form, start_at: startIso, end_at: new Date(new Date(startIso).getTime() + duration).toISOString() });
  };
  const onEndTime = (newTime) => {
    setForm({ ...form, end_at: localInputToIso(`${date}T${newTime}`) });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:col-span-2">
      <Field label={t("field.date")} required>
        <DateInput value={date} onChange={(e) => onDate(e.target.value)} required />
      </Field>
      <Field label={t("field.start_time")} required>
        <Input type="time" value={startTime} onChange={(e) => onStartTime(e.target.value)} required />
      </Field>
      <Field label={t("field.end_time")} required>
        <Input type="time" value={endTime} onChange={(e) => onEndTime(e.target.value)} required />
      </Field>
    </div>
  );
}

export default function SessionsPage() {
  const { t } = useI18n();
  const { tenant } = useAuth();
  const { canAdd, canModify, canDelete } = usePermission("sessions");
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const groupMap = Object.fromEntries((groups?.items || []).map((g) => [g.id, g]));
  const teacherMap = Object.fromEntries((teachers?.items || []).map((t) => [t.id, t]));
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));
  const [statusFilter, setStatusFilter] = useState("all");

  return (
    <CrudPanel
      moduleKey="sessions"
      endpoint="/sessions"
      title={t("menu.sessions")}
      subtitle={t("subtitle.sessions")}
      emptyIcon={CalendarClock}
      defaultForm={defaultForm}
      canEdit={canModify}
      canDelete={canDelete}
      canCreate={canAdd}
      extraActions={canAdd && tenant?.plan === "premium" ? <RecurringDialog groups={groups} /> : null}
      extraParams={statusFilter !== "all" ? { status: statusFilter } : undefined}
      filterBar={(
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-background h-9 w-44" data-testid="sessions-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="all">{t("sessions.filter_all")}</SelectItem>
            <SelectItem value="scheduled">{t("status.scheduled")}</SelectItem>
            <SelectItem value="completed">{t("status.completed")}</SelectItem>
            <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      columns={[
        {
          key: "series", label: "",
          render: (r) => r.series_id ? <Repeat className="w-3.5 h-3.5 text-muted-foreground" title={t("sessions.recurring_series")} /> : null,
        },
        {
          key: "when", label: t("field.when"),
          render: (r) => (
            <div className="font-mono text-xs">
              <div>{formatDate(r.start_at, "short")}</div>
              <div className="text-muted-foreground">
                {formatTime(r.start_at)} → {formatTime(r.end_at)}
              </div>
            </div>
          ),
        },
        {
          key: "group", label: t("field.group"),
          render: (r) => {
            const g = groupMap[r.group_id];
            return g ? groupOptionLabel(g, courseMap, t) : "—";
          },
        },
        { key: "topic", label: t("field.topic"), render: (r) => r.topic || <span className="text-muted-foreground">—</span> },
        { key: "room", label: t("field.room"), render: (r) => r.room_name || r.room || <span className="text-muted-foreground">—</span> },
        {
          key: "teacher", label: t("field.teacher"),
          render: (r) => {
            const t = teacherMap[r.teacher_id];
            return t ? `${t.first_name} ${t.last_name}` : "—";
          },
        },
        { key: "status", label: t("field.status"), render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label={t("field.group")} required>
            <Select value={form.group_id || ""} onValueChange={(v) => {
              const g = groupMap[v];
              setForm({ ...form, group_id: v, teacher_id: g?.teacher_id || form.teacher_id, room_id: g?.room_id || form.room_id });
            }}>
              <SelectTrigger className="bg-background"><SelectValue placeholder={t("sessions.select_group")} /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(groups?.items || []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{groupOptionLabel(g, courseMap, t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("field.teacher")}>
            <Select value={form.teacher_id || ""} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(teachers?.items || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <SessionRangePicker form={form} setForm={setForm} />
          <Field label={t("field.room")}>
            <RoomSelect value={form.room_id} onChange={(v) => setForm({ ...form, room_id: v })} />
          </Field>
          <Field label={t("field.status")}>
            <Select value={form.status || "scheduled"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="scheduled">{t("status.scheduled")}</SelectItem>
                <SelectItem value="completed">{t("status.completed")}</SelectItem>
                <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label={t("field.topic")}>
              <Input value={form.topic || ""} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Lesson 3 — Present perfect" />
            </Field>
          </div>
        </div>
      )}
    />
  );
}
