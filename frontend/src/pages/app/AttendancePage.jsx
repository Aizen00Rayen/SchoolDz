import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck, ExternalLink, FileText, Loader2, Printer, RotateCcw, Save, Search, Upload } from "lucide-react";

import { api, extractError, openPrivateFile, resolveFileUrl } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";
import { APPUI } from "@/constants/testIds";
import { PageHeader, EmptyState, groupOptionLabel } from "./_shared";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATUS_KEYS = [
  { key: "present", cls: "bg-success text-success-foreground" },
  { key: "late", cls: "bg-warning text-warning-foreground" },
  { key: "excused", cls: "bg-info text-info-foreground" },
  { key: "absent", cls: "bg-destructive text-destructive-foreground" },
];

/** Excuse document upload + recovery toggle for one excused student — only
 * usable once that student's mark has actually been saved (needs a real
 * Attendance id to upload/toggle against), which is why `record` can be
 * undefined right after picking "excused" but before hitting Save. */
function ExcuseCell({ record, canEdit, onChanged }) {
  const { t } = useI18n();
  const inputRef = useRef(null);

  const uploadMut = useMutation({
    mutationFn: (file) => {
      const body = new FormData();
      body.append("file", file);
      return api.post(`/attendance/${record.id}/excuse-document`, body).then((r) => r.data);
    },
    onSuccess: () => { toast.success(t("toast.updated")); onChanged(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const recoveryMut = useMutation({
    mutationFn: (recovery_status) => api.post(`/attendance/${record.id}/recovery`, { recovery_status }).then((r) => r.data),
    onSuccess: () => { toast.success(t("toast.updated")); onChanged(); },
    onError: (e) => toast.error(extractError(e)),
  });

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadMut.mutate(file);
  };

  if (!record?.id) {
    return <span className="text-[11px] text-muted-foreground">{t("attendance.save_before_excuse")}</span>;
  }

  const recovered = record.recovery_status === "recovered";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {record.excuse_document_url ? (
        <button
          type="button"
          onClick={() => openPrivateFile(record.excuse_document_url).catch((e) => toast.error(extractError(e)))}
          className="flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          <FileText className="w-3 h-3" /> {t("attendance.view_excuse")} <ExternalLink className="w-2.5 h-2.5" />
        </button>
      ) : null}
      {canEdit && (
        <>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={onFileSelect} />
          <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={uploadMut.isPending} onClick={() => inputRef.current?.click()}>
            {uploadMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3 me-1" />}
            {record.excuse_document_url ? t("actions.replace") : t("attendance.upload_excuse")}
          </Button>
          <Button
            type="button" variant="outline" size="sm"
            className={`h-6 px-2 text-[11px] ${recovered ? "text-success border-success/40" : "text-warning border-warning/40"}`}
            disabled={recoveryMut.isPending}
            onClick={() => recoveryMut.mutate(recovered ? "needs_recovery" : "recovered")}
          >
            {recoveryMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : recovered ? <CheckCircle2 className="w-3 h-3 me-1" /> : <RotateCcw className="w-3 h-3 me-1" />}
            {recovered ? t("attendance.recovered") : t("attendance.needs_recovery")}
          </Button>
        </>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const { t } = useI18n();
  const { canModify: canEdit } = usePermission("attendance");
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState("");
  const [marks, setMarks] = useState({}); // student_id -> status
  const [q, setQ] = useState("");

  const { data: sessions } = useQuery({
    queryKey: ["sessions-list-attendance"],
    queryFn: async () => (await api.get("/sessions")).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const { data: teachers } = useQuery({
    queryKey: ["teachers-list"],
    queryFn: async () => (await api.get("/teachers")).data,
  });
  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: async () => (await api.get("/students")).data,
  });
  const courseMap = useMemo(
    () => Object.fromEntries((courses?.items || []).map((c) => [c.id, c])),
    [courses],
  );
  const teacherMap = useMemo(
    () => Object.fromEntries((teachers?.items || []).map((tr) => [tr.id, tr])),
    [teachers],
  );

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
      toast.success(t("toast.attendance_saved"));
      qc.invalidateQueries({ queryKey: ["attendance", sessionId] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const attendanceByStudent = useMemo(
    () => Object.fromEntries((existing?.items || []).map((a) => [a.student_id, a])),
    [existing],
  );
  // Whether each student has paid enough for this session's course to
  // cover what they've attended so far (see compute_course_payment_status
  // on the backend) — missing means no present/excused attendance in this
  // course yet, so there's nothing to show.
  const paidStatus = existing?.paid_status || {};

  // Print becomes available once this session actually has saved attendance
  // to print — before that there's nothing on record to put on the roster.
  const hasSavedAttendance = (existing?.items || []).length > 0;
  const [printing, setPrinting] = useState(false);
  const printRoster = async () => {
    setPrinting(true);
    try {
      const res = await api.get(`/attendance/session/${sessionId}/print`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setPrinting(false);
    }
  };

  const enrolled = (selectedGroup?.student_ids || []).map((id) => studentMap[id]).filter(Boolean);
  const visibleEnrolled = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return enrolled;
    return enrolled.filter((s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(needle) ||
      (s.student_code || "").toLowerCase().includes(needle)
    );
  }, [enrolled, q]);

  return (
    <div>
      <PageHeader
        title={t("menu.attendance")}
        subtitle={t("subtitle.attendance")}
        actions={
          <div className="flex items-center gap-2">
            {hasSavedAttendance && (
              <Button
                variant="outline"
                onClick={printRoster}
                disabled={printing}
                data-testid="attendance-print"
              >
                {printing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Printer className="w-4 h-4 me-2" />}
                {t("attendance.print")}
              </Button>
            )}
            {canEdit && (
              <Button
                onClick={() => saveMut.mutate()}
                disabled={!sessionId || saveMut.isPending || Object.keys(marks).length === 0}
                data-testid={APPUI.attendanceSave}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <Save className="w-4 h-4 me-2" />
                {t("attendance.save")}
              </Button>
            )}
          </div>
        }
      />

      <div className="surface-card p-5 mb-6">
        <Label className="text-xs mb-2 block">{t("attendance.select_session")}</Label>
        <Select value={sessionId} onValueChange={setSessionId}>
          <SelectTrigger className="bg-background max-w-xl" data-testid="attendance-session-select">
            <SelectValue placeholder={t("attendance.pick_session_placeholder")} />
          </SelectTrigger>
          <SelectContent className="bg-popover max-h-96">
            {(sessions?.items || []).map((s) => {
              const g = (groups?.items || []).find((gg) => gg.id === s.group_id);
              const teacher = teacherMap[s.teacher_id || g?.teacher_id];
              const groupLabel = g ? groupOptionLabel(g, courseMap, t) : t("field.group");
              return (
                <SelectItem key={s.id} value={s.id}>
                  {new Date(s.start_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} — {groupLabel}
                  {teacher ? ` · ${teacher.first_name} ${teacher.last_name}` : ""}
                  {s.topic ? ` · ${s.topic}` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {!sessionId ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t("attendance.pick_session_title")}
          description={t("attendance.pick_session_desc")}
        />
      ) : enrolled.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={t("attendance.no_students_title")}
          description={t("attendance.no_students_desc")}
        />
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[160px] sm:max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("actions.search")}
                className="ps-9 h-9"
                data-testid="attendance-search-input"
              />
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {visibleEnrolled.length} / {enrolled.length} {t("field.students")}
            </div>
          </div>
          <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.student")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.code")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("field.mark")}</th>
                <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium">{t("attendance.excuse")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleEnrolled.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{s.first_name} {s.last_name}</span>
                      {paidStatus[s.id] !== undefined && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${
                            paidStatus[s.id] ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                          }`}
                          data-testid={`attendance-paid-${s.id}`}
                        >
                          {paidStatus[s.id] ? t("attendance.paid") : t("attendance.unpaid")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.student_code}</td>
                  <td className="px-4 py-2">
                    <div className="inline-flex rounded-lg border border-border overflow-hidden">
                      {STATUS_KEYS.map((st) => {
                        const active = marks[s.id] === st.key;
                        return (
                          <button
                            key={st.key}
                            data-testid={APPUI.attendanceMark(s.id, st.key)}
                            onClick={() => canEdit && setMarks((m) => ({ ...m, [s.id]: st.key }))}
                            disabled={!canEdit}
                            className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              active ? st.cls : "hover:bg-muted text-foreground"
                            }`}
                            type="button"
                          >
                            {t(`status.${st.key}`)}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {marks[s.id] === "excused" && (
                      <ExcuseCell
                        record={attendanceByStudent[s.id]}
                        canEdit={canEdit}
                        onChanged={() => qc.invalidateQueries({ queryKey: ["attendance", sessionId] })}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
