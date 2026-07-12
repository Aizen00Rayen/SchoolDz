import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardCheck, Save } from "lucide-react";

import { api, extractError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { APPUI } from "@/constants/testIds";
import { PageHeader, EmptyState } from "./_shared";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATUSES = [
  { key: "present", label: "Present", cls: "bg-emerald-500 text-white" },
  { key: "late", label: "Late", cls: "bg-amber-500 text-white" },
  { key: "excused", label: "Excused", cls: "bg-blue-500 text-white" },
  { key: "absent", label: "Absent", cls: "bg-red-500 text-white" },
];

export default function AttendancePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [marks, setMarks] = useState({}); // student_id -> status

  const { data: sessions } = useQuery({
    queryKey: ["sessions-list-attendance"],
    queryFn: async () => (await api.get("/sessions")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });

  const selectedSession = useMemo(
    () => (sessions?.items || []).find((s) => s.id === sessionId),
    [sessions, sessionId],
  );
  const selectedGroup = useMemo(
    () => (groups?.items || []).find((g) => g.id === selectedSession?.group_id),
    [groups, selectedSession],
  );
  const studentMap = useMemo(
    () => Object.fromEntries((students?.items || []).map((s) => [s.id, s])),
    [students],
  );

  const { data: existing } = useQuery({
    queryKey: ["attendance", sessionId],
    queryFn: async () => (await api.get(`/attendance/session/${sessionId}`)).data,
    enabled: !!sessionId,
  });

  useEffect(() => {
    if (existing?.items) {
      const m = {};
      for (const a of existing.items) m[a.student_id] = a.status;
      setMarks(m);
    } else {
      setMarks({});
    }
  }, [existing, sessionId]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        marks: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })),
      };
      return api.post(`/attendance/session/${sessionId}`, payload).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success("Attendance saved");
      qc.invalidateQueries({ queryKey: ["attendance", sessionId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const enrolled = (selectedGroup?.student_ids || []).map((id) => studentMap[id]).filter(Boolean);

  return (
    <div>
      <PageHeader
        title={t("menu.attendance")}
        subtitle="Fast one-click marking for every session."
        actions={
          <Button
            onClick={() => saveMut.mutate()}
            disabled={!sessionId || saveMut.isPending || Object.keys(marks).length === 0}
            data-testid={APPUI.attendanceSave}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            <Save className="w-4 h-4 me-2" />
            Save attendance
          </Button>
        }
      />

      <div className="surface-card p-5 mb-6">
        <Label className="text-xs mb-2 block">Select session</Label>
        <Select value={sessionId} onValueChange={setSessionId}>
          <SelectTrigger className="bg-background max-w-xl" data-testid="attendance-session-select">
            <SelectValue placeholder="Pick a session" />
          </SelectTrigger>
          <SelectContent className="bg-popover max-h-96">
            {(sessions?.items || []).map((s) => {
              const g = (groups?.items || []).find((gg) => gg.id === s.group_id);
              return (
                <SelectItem key={s.id} value={s.id}>
                  {new Date(s.start_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} — {g?.name || "Group"} · {s.topic || "—"}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {!sessionId ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Pick a session"
          description="Choose a session above to start marking attendance."
        />
      ) : enrolled.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No students enrolled"
          description="Add students to this group first."
        />
      ) : (
        <div className="surface-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Student</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Code</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">Mark</th>
              </tr>
            </thead>
            <tbody>
              {enrolled.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium">{s.first_name} {s.last_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.student_code}</td>
                  <td className="px-4 py-2">
                    <div className="inline-flex rounded-lg border border-border overflow-hidden">
                      {STATUSES.map((st) => {
                        const active = marks[s.id] === st.key;
                        return (
                          <button
                            key={st.key}
                            data-testid={APPUI.attendanceMark(s.id, st.key)}
                            onClick={() => setMarks((m) => ({ ...m, [s.id]: st.key }))}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                              active ? st.cls : "hover:bg-muted text-foreground"
                            }`}
                            type="button"
                          >
                            {st.label}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
