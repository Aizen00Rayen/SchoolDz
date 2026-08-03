import { useQuery } from "@tanstack/react-query";
import CrudPanel, { StatusPill } from "./CrudPanel";
import { CalendarClock, Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, RecurringDialog } from "./_shared";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

const nowLocalIso = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const DEFAULT_FORM = {
  group_id: "", teacher_id: "", room: "", start_at: nowLocalIso(), end_at: nowLocalIso(),
  topic: "", status: "scheduled",
};

/** Combined date + start/end time range picker for a session.
 * Keeps start_at/end_at as local ISO datetime strings ("YYYY-MM-DDTHH:mm")
 * so the payload shape sent to the API is unchanged. */
function SessionRangePicker({ form, setForm }) {
  const { t } = useI18n();
  const date = (form.start_at || "").slice(0, 10);
  const startTime = (form.start_at || "").slice(11, 16);
  const endTime = (form.end_at || "").slice(11, 16);

  const onDate = (newDate) => {
    setForm({
      ...form,
      start_at: `${newDate}T${startTime || "00:00"}`,
      end_at: `${newDate}T${endTime || "00:00"}`,
    });
  };
  const onStartTime = (newTime) => {
    setForm({ ...form, start_at: `${date}T${newTime}` });
  };
  const onEndTime = (newTime) => {
    setForm({ ...form, end_at: `${date}T${newTime}` });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:col-span-2">
      <Field label={t("field.date")} required>
        <Input type="date" value={date} onChange={(e) => onDate(e.target.value)} required />
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
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
  });
  const groupMap = Object.fromEntries((groups?.items || []).map((g) => [g.id, g]));
  const teacherMap = Object.fromEntries((teachers?.items || []).map((t) => [t.id, t]));

  return (
    <CrudPanel
      moduleKey="sessions"
      endpoint="/sessions"
      title={t("menu.sessions")}
      subtitle={t("subtitle.sessions")}
      emptyIcon={CalendarClock}
      defaultForm={DEFAULT_FORM}
      extraActions={tenant?.plan === "premium" ? <RecurringDialog groups={groups} /> : null}
      columns={[
        {
          key: "series", label: "",
          render: (r) => r.series_id ? <Repeat className="w-3.5 h-3.5 text-muted-foreground" title={t("sessions.recurring_series")} /> : null,
        },
        {
          key: "when", label: t("field.when"),
          render: (r) => (
            <div className="font-mono text-xs">
              <div>{new Date(r.start_at).toLocaleDateString()}</div>
              <div className="text-muted-foreground">
                {new Date(r.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} → {new Date(r.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ),
        },
        {
          key: "group", label: t("field.group"),
          render: (r) => groupMap[r.group_id]?.name || "—",
        },
        { key: "topic", label: t("field.topic"), render: (r) => r.topic || <span className="text-muted-foreground">—</span> },
        { key: "room", label: t("field.room") },
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
              setForm({ ...form, group_id: v, teacher_id: g?.teacher_id || form.teacher_id, room: g?.room || form.room });
            }}>
              <SelectTrigger className="bg-background"><SelectValue placeholder={t("sessions.select_group")} /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(groups?.items || []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
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
            <Input value={form.room || ""} onChange={(e) => setForm({ ...form, room: e.target.value })} />
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
