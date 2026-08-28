import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutGrid, Printer, Loader2 } from "lucide-react";
import { PageHeader, EmptyState, LoadingRows, groupOptionLabel } from "./_shared";
import { Button } from "@/components/ui/button";
import { api, extractError, openSessionSheetPdf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "Session Sheet" — a printable, interactive per-group monthly grid: one
 * row per enrolled student, one box per session actually scheduled that
 * month, colored if the student is currently paid-up for the course
 * (compute_course_payment_status on the backend), ticked once that
 * session's attendance is marked present/late. This mirrors a paper ledger
 * format some schools already use by hand — see group_session_sheet /
 * _build_session_sheet in the backend for the data shape. Clicking a box
 * marks attendance immediately via the same endpoint the full Attendance
 * page uses (POST /attendance/session/<id>), so this is a second way to
 * take attendance, not just a read-only report. */
export default function SessionSheetPage() {
  const { t } = useI18n();
  const { canModify } = usePermission("attendance");
  const qc = useQueryClient();
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [month, setMonth] = useState(currentMonthValue());
  const [printing, setPrinting] = useState(false);

  const { data: groups } = useQuery({
    queryKey: ["groups-list"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const courseMap = useMemo(
    () => Object.fromEntries((courses?.items || []).map((c) => [c.id, c])),
    [courses],
  );

  const toggleGroup = (id) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["session-sheet", selectedGroupIds, month],
    queryFn: async () => {
      const params = new URLSearchParams();
      selectedGroupIds.forEach((id) => params.append("group_id", id));
      params.set("month", month);
      return (await api.get(`/groups/session-sheet?${params.toString()}`)).data;
    },
    enabled: selectedGroupIds.length > 0,
  });

  const markMut = useMutation({
    mutationFn: ({ sessionId, studentId, nextStatus }) =>
      api.post(`/attendance/session/${sessionId}`, { marks: [{ student_id: studentId, status: nextStatus }] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session-sheet"] }),
    onError: (e) => toast.error(extractError(e)),
  });

  // Binary tick/blank, matching the paper — late/excused stay editable only
  // from the full Attendance page, which already handles that nuance.
  const toggleBox = (sessionId, studentId, currentStatus) => {
    if (!canModify || markMut.isPending) return;
    const ticked = currentStatus === "present" || currentStatus === "late";
    markMut.mutate({ sessionId, studentId, nextStatus: ticked ? "absent" : "present" });
  };

  const printSheet = async () => {
    setPrinting(true);
    try {
      await openSessionSheetPdf(selectedGroupIds, month);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setPrinting(false);
    }
  };

  const sheets = data?.sheets || [];

  return (
    <div>
      <PageHeader
        title={t("menu.session_sheet")}
        subtitle={t("subtitle.session_sheet")}
        actions={
          selectedGroupIds.length > 0 ? (
            <Button variant="outline" onClick={printSheet} disabled={printing} data-testid="session-sheet-print">
              {printing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Printer className="w-4 h-4 me-2" />}
              {t("session_sheet.print")}
            </Button>
          ) : undefined
        }
      />

      <div className="surface-card p-4 mb-4 space-y-3">
        <div>
          <label className="text-xs font-medium mb-1.5 block text-muted-foreground">
            {t("session_sheet.select_groups")}
          </label>
          <div className="flex flex-wrap gap-2">
            {(groups?.items || []).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroup(g.id)}
                data-testid={`session-sheet-group-${g.id}`}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  selectedGroupIds.includes(g.id)
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-background hover:bg-muted"
                }`}
              >
                {groupOptionLabel(g, courseMap, t)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="session-sheet-month">
            {t("session_sheet.select_month")}
          </label>
          <input
            id="session-sheet-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
            data-testid="session-sheet-month"
          />
        </div>
      </div>

      {selectedGroupIds.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={t("session_sheet.pick_groups_title")}
          description={t("session_sheet.pick_groups_desc")}
        />
      ) : isError ? (
        <EmptyState
          icon={LayoutGrid}
          title={t("crud.load_failed")}
          description={extractError(error)}
          action={<Button variant="outline" onClick={() => refetch()}>{t("actions.retry")}</Button>}
        />
      ) : isLoading ? (
        <div className="surface-card p-4"><LoadingRows /></div>
      ) : (
        <div className="space-y-6">
          {sheets.map((sheet) => (
            <div key={sheet.group_id} className="surface-card overflow-hidden">
              <div className="p-4 border-b border-border flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <div>
                  <span className="text-muted-foreground">{t("field.group")}: </span>
                  <span className="font-medium">{sheet.group_name}</span>
                </div>
                {sheet.teacher_name && (
                  <div>
                    <span className="text-muted-foreground">{t("field.teacher")}: </span>
                    <span className="font-medium">{sheet.teacher_name}</span>
                  </div>
                )}
                {sheet.course_title && (
                  <div>
                    <span className="text-muted-foreground">{t("field.course")}: </span>
                    <span className="font-medium">{sheet.course_title}</span>
                  </div>
                )}
              </div>

              {sheet.sessions.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">{t("session_sheet.no_sessions")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b border-border">
                      <tr>
                        <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium whitespace-nowrap">
                          {t("field.student")}
                        </th>
                        {sheet.sessions.map((s) => (
                          <th
                            key={s.id}
                            className="px-2 py-2.5 text-[10px] font-mono text-muted-foreground text-center whitespace-nowrap"
                          >
                            {s.date}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.students.map((student) => (
                        <tr key={student.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              {student.paid && (
                                <span
                                  className="w-1.5 h-4 rounded-full bg-success flex-shrink-0"
                                  title={t("session_sheet.paid")}
                                />
                              )}
                              <div>
                                {student.first_name} {student.last_name}
                                {student.phone && (
                                  <div className="text-[11px] font-mono text-muted-foreground font-normal">
                                    {student.phone}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          {sheet.sessions.map((s, idx) => {
                            const boxStatus = student.boxes[idx];
                            const ticked = boxStatus === "present" || boxStatus === "late";
                            return (
                              <td key={s.id} className="px-2 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleBox(s.id, student.id, boxStatus)}
                                  disabled={!canModify}
                                  data-testid={`session-sheet-box-${student.id}-${s.id}`}
                                  className={`w-6 h-6 rounded border inline-flex items-center justify-center transition-colors ${
                                    student.paid ? "bg-success/10 border-success/40" : "bg-background border-border"
                                  } ${canModify ? "cursor-pointer hover:border-accent" : "cursor-default"}`}
                                >
                                  {ticked && <span className="text-success text-xs font-bold">✓</span>}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
