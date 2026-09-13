import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Calendar, CheckCircle2, ClipboardCheck, Clock, ExternalLink, FileText,
  Loader2, Printer, RotateCcw, Save, Search, Upload,
} from "lucide-react";

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

  // Filters for session selection
  const [periodFilter, setPeriodFilter] = useState("all");
  const [statusTimingFilter, setStatusTimingFilter] = useState("all"); // 'all' | 'done' | 'upcoming'
  const [groupFilter, setGroupFilter] = useState("");
  const [initialChecked, setInitialChecked] = useState(false);

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

  const now = useMemo(() => new Date(), []);

  const isSessionDone = useMemo(
    () => (s) => {
      if (s.status === "completed") return true;
      if (s.status === "cancelled") return false;
      const end = s.end_at ? new Date(s.end_at) : (s.start_at ? new Date(s.start_at) : null);
      return end ? end <= now : false;
    },
    [now],
  );

  const isSessionUpcoming = useMemo(
    () => (s) => {
      if (s.status === "completed") return false;
      const end = s.end_at ? new Date(s.end_at) : (s.start_at ? new Date(s.start_at) : null);
      return end ? end > now : true;
    },
    [now],
  );

  const matchesPeriod = useMemo(
    () => (s, period) => {
      if (period === "all") return true;
      if (!s.start_at) return false;
      const d = new Date(s.start_at);

      if (period === "today") {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }

      if (period === "week") {
        const startOfWeek = new Date(now);
        const day = now.getDay();
        const diff = (day === 0 ? -6 : 1) - day;
        startOfWeek.setDate(now.getDate() + diff);
        startOfWeek.setHours(0, 0, 0, 0);

        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return d >= startOfWeek && d <= endOfWeek;
      }

      if (period === "month") {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      }

      return true;
    },
    [now],
  );

  const allSessions = useMemo(() => sessions?.items || [], [sessions]);

  // Default to "today" if today has sessions scheduled
  useEffect(() => {
    if (!initialChecked && allSessions.length > 0) {
      const hasToday = allSessions.some((s) => matchesPeriod(s, "today"));
      if (hasToday) {
        setPeriodFilter("today");
      }
      setInitialChecked(true);
    }
  }, [allSessions, initialChecked, matchesPeriod]);

  // Counts for period pills
  const periodCounts = useMemo(() => {
    let today = 0;
    let week = 0;
    let month = 0;
    allSessions.forEach((s) => {
      if (statusTimingFilter === "done" && !isSessionDone(s)) return;
      if (statusTimingFilter === "upcoming" && !isSessionUpcoming(s)) return;
      if (groupFilter && s.group_id !== groupFilter) return;

      if (matchesPeriod(s, "today")) today++;
      if (matchesPeriod(s, "week")) week++;
      if (matchesPeriod(s, "month")) month++;
    });
    const all = allSessions.filter((s) => {
      if (statusTimingFilter === "done" && !isSessionDone(s)) return false;
      if (statusTimingFilter === "upcoming" && !isSessionUpcoming(s)) return false;
      if (groupFilter && s.group_id !== groupFilter) return false;
      return true;
    }).length;
    return { today, week, month, all };
  }, [allSessions, statusTimingFilter, groupFilter, isSessionDone, isSessionUpcoming, matchesPeriod]);

  // Counts for status pills
  const statusCounts = useMemo(() => {
    let done = 0;
    let upcoming = 0;
    allSessions.forEach((s) => {
      if (!matchesPeriod(s, periodFilter)) return;
      if (groupFilter && s.group_id !== groupFilter) return;

      if (isSessionDone(s)) done++;
      if (isSessionUpcoming(s)) upcoming++;
    });
    const all = allSessions.filter(
      (s) => matchesPeriod(s, periodFilter) && (!groupFilter || s.group_id === groupFilter)
    ).length;
    return { done, upcoming, all };
  }, [allSessions, periodFilter, groupFilter, isSessionDone, isSessionUpcoming, matchesPeriod]);

  const filteredSessions = useMemo(() => {
    return allSessions
      .filter((s) => {
        if (!matchesPeriod(s, periodFilter)) return false;
        if (statusTimingFilter === "done" && !isSessionDone(s)) return false;
        if (statusTimingFilter === "upcoming" && !isSessionUpcoming(s)) return false;
        if (groupFilter && s.group_id !== groupFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(b.start_at || 0) - new Date(a.start_at || 0));
  }, [allSessions, periodFilter, statusTimingFilter, groupFilter, isSessionDone, isSessionUpcoming, matchesPeriod]);

  // Keep currently selected session available even if active filters exclude it
  const displaySessions = useMemo(() => {
    if (sessionId && !filteredSessions.some((s) => s.id === sessionId)) {
      const current = allSessions.find((s) => s.id === sessionId);
      if (current) return [current, ...filteredSessions];
    }
    return filteredSessions;
  }, [filteredSessions, sessionId, allSessions]);

  const resetFilters = () => {
    setPeriodFilter("all");
    setStatusTimingFilter("all");
    setGroupFilter("");
  };

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

      <div className="surface-card p-5 mb-6 space-y-4 shadow-sm border border-border/70">
        {/* Filters Row: Time Period + Timing/Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3.5">
          {/* Period filter buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-accent" />
              {t("attendance.filter_period")} :
            </span>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 shrink-0">
              {[
                { key: "today", label: t("attendance.period_today"), count: periodCounts.today },
                { key: "week", label: t("attendance.period_week"), count: periodCounts.week },
                { key: "month", label: t("attendance.period_month"), count: periodCounts.month },
                { key: "all", label: t("attendance.period_all"), count: periodCounts.all },
              ].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPeriodFilter(p.key)}
                  data-testid={`attendance-filter-period-${p.key}`}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    periodFilter === p.key
                      ? "bg-background text-foreground shadow-sm font-semibold border border-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p.label}
                  {p.count > 0 && (
                    <span className="ms-1 px-1.5 py-0.2 rounded-full text-[10px] bg-muted font-normal text-muted-foreground">
                      {p.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Status/Timing filter buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-accent" />
              {t("attendance.filter_status")} :
            </span>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-muted/40 shrink-0">
              {[
                { key: "all", label: t("attendance.status_all"), count: statusCounts.all },
                { key: "done", label: t("attendance.status_done"), count: statusCounts.done },
                { key: "upcoming", label: t("attendance.status_upcoming"), count: statusCounts.upcoming },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStatusTimingFilter(s.key)}
                  data-testid={`attendance-filter-status-${s.key}`}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    statusTimingFilter === s.key
                      ? "bg-background text-foreground shadow-sm font-semibold border border-border/60"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                  {s.count > 0 && (
                    <span className="ms-1 px-1.5 py-0.2 rounded-full text-[10px] bg-muted font-normal text-muted-foreground">
                      {s.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Group Filter and Session Picker */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end pt-0.5">
          <div>
            <Label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              {t("field.group")}
            </Label>
            <Select
              value={groupFilter || "__all"}
              onValueChange={(v) => setGroupFilter(v === "__all" ? "" : v)}
            >
              <SelectTrigger className="bg-background h-9 text-xs">
                <SelectValue placeholder={t("reports.all_groups")} />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-80">
                <SelectItem value="__all">{t("reports.all_groups")}</SelectItem>
                {(groups?.items || []).map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {groupOptionLabel(g, courseMap, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("attendance.select_session")} ({filteredSessions.length})
              </Label>
              {(periodFilter !== "all" || statusTimingFilter !== "all" || groupFilter) && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[11px] text-muted-foreground hover:text-accent flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t("attendance.reset_filters")}
                </button>
              )}
            </div>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger className="bg-background h-9" data-testid="attendance-session-select">
                <SelectValue
                  placeholder={
                    filteredSessions.length === 0
                      ? t("attendance.no_filtered_sessions")
                      : t("attendance.pick_session_placeholder")
                  }
                />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-96">
                {displaySessions.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    <p>{t("attendance.no_filtered_sessions")}</p>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="mt-2 text-xs text-accent underline hover:no-underline"
                    >
                      {t("attendance.reset_filters")}
                    </button>
                  </div>
                ) : (
                  displaySessions.map((s) => {
                    const g = (groups?.items || []).find((gg) => gg.id === s.group_id);
                    const teacher = teacherMap[s.teacher_id || g?.teacher_id];
                    const groupLabel = g ? groupOptionLabel(g, courseMap, t) : t("field.group");
                    const done = isSessionDone(s);
                    const isOutsideFilter = !filteredSessions.some((x) => x.id === s.id);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="font-medium">
                          {new Date(s.start_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        {" — "}
                        {groupLabel}
                        {teacher ? ` · ${teacher.first_name} ${teacher.last_name}` : ""}
                        {s.topic ? ` · ${s.topic}` : ""}
                        <span
                          className={`ms-2 px-1.5 py-0.5 rounded text-[10px] font-normal ${
                            done ? "bg-muted text-muted-foreground" : "bg-accent/15 text-accent"
                          }`}
                        >
                          {done ? t("attendance.status_done") : t("attendance.status_upcoming")}
                        </span>
                        {isOutsideFilter && (
                          <span className="ms-1.5 text-[10px] text-muted-foreground italic">
                            (sélectionnée)
                          </span>
                        )}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
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
