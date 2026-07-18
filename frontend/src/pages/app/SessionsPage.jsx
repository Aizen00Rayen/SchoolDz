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
      subtitle="Individual class meetings — with topic and status."
      emptyIcon={CalendarClock}
      defaultForm={DEFAULT_FORM}
      extraActions={tenant?.plan === "premium" ? <RecurringDialog groups={groups} /> : null}
      columns={[
        {
          key: "series", label: "",
          render: (r) => r.series_id ? <Repeat className="w-3.5 h-3.5 text-muted-foreground" title="Part of a recurring series" /> : null,
        },
        {
          key: "when", label: "When",
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
          key: "group", label: "Group",
          render: (r) => groupMap[r.group_id]?.name || "—",
        },
        { key: "topic", label: "Topic", render: (r) => r.topic || <span className="text-muted-foreground">—</span> },
        { key: "room", label: "Room" },
        {
          key: "teacher", label: "Teacher",
          render: (r) => {
            const t = teacherMap[r.teacher_id];
            return t ? `${t.first_name} ${t.last_name}` : "—";
          },
        },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
      ]}
      renderForm={(form, setForm) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Group" required>
            <Select value={form.group_id || ""} onValueChange={(v) => {
              const g = groupMap[v];
              setForm({ ...form, group_id: v, teacher_id: g?.teacher_id || form.teacher_id, room: g?.room || form.room });
            }}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="Select group" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(groups?.items || []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Teacher">
            <Select value={form.teacher_id || ""} onValueChange={(v) => setForm({ ...form, teacher_id: v })}>
              <SelectTrigger className="bg-background"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(teachers?.items || []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.first_name} {t.last_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Start" required>
            <Input type="datetime-local" value={form.start_at?.slice(0, 16) || ""} onChange={(e) => setForm({ ...form, start_at: e.target.value })} required />
          </Field>
          <Field label="End" required>
            <Input type="datetime-local" value={form.end_at?.slice(0, 16) || ""} onChange={(e) => setForm({ ...form, end_at: e.target.value })} required />
          </Field>
          <Field label="Room">
            <Input value={form.room || ""} onChange={(e) => setForm({ ...form, room: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status || "scheduled"} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Topic">
              <Input value={form.topic || ""} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="Lesson 3 — Present perfect" />
            </Field>
          </div>
        </div>
      )}
    />
  );
}
