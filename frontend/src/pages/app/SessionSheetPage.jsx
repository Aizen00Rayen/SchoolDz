import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutGrid, Printer, Loader2 } from "lucide-react";
import { PageHeader, EmptyState, LoadingRows, groupOptionLabel } from "./_shared";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { api, extractError, openSessionSheetPdf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

function InfoField({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

/** "Session Sheet" — a printable, interactive grid covering a group's WHOLE
 * course planning (every scheduled session, not one month at a time): one
 * row per enrolled student, one box per session, colored if the student is
 * currently paid-up for the course (compute_course_payment_status on the
 * backend), ticked once that session's attendance is marked present/late.
 * This mirrors a paper ledger format some schools already use by hand —
 * see group_session_sheet / _build_session_sheet in the backend for the
 * data shape. Clicking a box marks attendance immediately via the same
 * endpoint the full Attendance page uses (POST /attendance/session/<id>),
 * so this is a second way to take attendance, not just a read-only
 * report. */
export default function SessionSheetPage() {
  const { t } = useI18n();
  const { canModify } = usePermission("attendance");
  const qc = useQueryClient();
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [printing, setPrinting] = useState(false);
  const [detailStudentId, setDetailStudentId] = useState(null);

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
    queryKey: ["session-sheet", selectedGroupIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      selectedGroupIds.forEach((id) => params.append("group_id", id));
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
    if (!sessionId || !canModify || markMut.isPending) return;
    const ticked = currentStatus === "present" || currentStatus === "late";
    markMut.mutate({ sessionId, studentId, nextStatus: ticked ? "absent" : "present" });
  };

  const { data: detailStudent, isLoading: detailLoading, isError: detailError } = useQuery({
    queryKey: ["student-detail", detailStudentId],
    queryFn: async () => (await api.get(`/students/${detailStudentId}`)).data,
    enabled: Boolean(detailStudentId),
  });
  const { data: detailParent } = useQuery({
    queryKey: ["parent-detail", detailStudent?.parent_id],
    queryFn: async () => (await api.get(`/parents/${detailStudent.parent_id}`)).data,
    enabled: Boolean(detailStudent?.parent_id),
  });

  const printSheet = async () => {
    setPrinting(true);
    try {
      await openSessionSheetPdf(selectedGroupIds);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setPrinting(false);
    }
  };

  const sheets = useMemo(() => data?.sheets || [], [data]);

  const detailPaid = useMemo(() => {
    for (const sheet of sheets) {
      const s = sheet.students.find((x) => x.id === detailStudentId);
      if (s) return s.paid;
    }
    return null;
  }, [sheets, detailStudentId]);

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
                        <th className="w-10 px-2 py-2.5 text-xs text-muted-foreground font-medium text-center">#</th>
                        <th className="text-start px-4 py-2.5 text-xs uppercase tracking-widest text-muted-foreground font-medium whitespace-nowrap">
                          {t("field.student")}
                        </th>
                        {sheet.sessions.map((s, idx) => (
                          <th
                            key={s.id || `slot-${idx}`}
                            className="px-2 py-2.5 text-[10px] font-mono text-muted-foreground text-center whitespace-nowrap"
                          >
                            {s.date || "—"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.students.map((student, rowIdx) => (
                        <tr
                          key={student.id}
                          className={`border-b last:border-0 hover:bg-muted/40 ${
                            (rowIdx + 1) % 5 === 0 ? "border-muted-foreground/30" : "border-border"
                          }`}
                        >
                          <td className="px-2 py-2.5 text-center text-xs font-mono text-muted-foreground">
                            {rowIdx + 1}
                          </td>
                          <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setDetailStudentId(student.id)}
                              data-testid={`session-sheet-student-${student.id}`}
                              className="flex items-center gap-2 text-start hover:underline decoration-dotted underline-offset-2"
                            >
                              {student.paid && (
                                <span
                                  className="w-1.5 h-4 rounded-full bg-[#b9c23e] flex-shrink-0"
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
                            </button>
                          </td>
                          {sheet.sessions.map((s, idx) => {
                            const boxStatus = student.boxes[idx];
                            const ticked = boxStatus === "present" || boxStatus === "late";
                            const hasSession = Boolean(s.id);
                            return (
                              <td key={s.id || `slot-${idx}`} className="px-2 py-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => toggleBox(s.id, student.id, boxStatus)}
                                  disabled={!canModify || !hasSession}
                                  data-testid={`session-sheet-box-${student.id}-${s.id || idx}`}
                                  className={`w-6 h-6 rounded border inline-flex items-center justify-center transition-colors ${
                                    student.paid ? "bg-[#d7e05a]/70 border-[#b9c23e]" : "bg-background border-border"
                                  } ${
                                    canModify && hasSession ? "cursor-pointer hover:border-accent" : "cursor-default"
                                  } ${!hasSession ? "opacity-60" : ""}`}
                                >
                                  {ticked && <span className="text-[#5c6b00] text-xs font-bold">✓</span>}
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

      <Dialog open={Boolean(detailStudentId)} onOpenChange={(o) => !o && setDetailStudentId(null)}>
        <DialogContent className="bg-card max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {detailStudent ? `${detailStudent.first_name} ${detailStudent.last_name}` : t("session_sheet.student_info")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("session_sheet.student_info")}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <LoadingRows rows={3} cols={2} />
          ) : detailError ? (
            <p className="text-sm text-muted-foreground">{t("crud.load_failed")}</p>
          ) : detailStudent ? (
            <div className="space-y-4">
              {detailPaid !== null && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    detailPaid ? "bg-[#d7e05a]/40 text-[#5c6b00]" : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {detailPaid ? t("session_sheet.paid") : t("attendance.unpaid")}
                </span>
              )}

              <div className="grid grid-cols-2 gap-3">
                <InfoField label={t("field.phone")} value={detailStudent.phone} />
                <InfoField label={t("field.email")} value={detailStudent.email} />
                <InfoField label={t("field.status")} value={t(`status.${detailStudent.status}`)} />
                <InfoField label={t("field.student_code")} value={detailStudent.student_code} />
                <InfoField
                  label={t("field.school_level")}
                  value={detailStudent.school_level ? t(`school_level.${detailStudent.school_level}`) : null}
                />
                <InfoField label={t("field.school_year")} value={detailStudent.school_year} />
                <InfoField label={t("field.specialty")} value={detailStudent.specialty} />
                <InfoField label={t("field.gender")} value={detailStudent.gender ? t(`gender.${detailStudent.gender}`) : null} />
                <InfoField label={t("field.blood_type")} value={detailStudent.blood_type} />
                <InfoField
                  label={t("field.insurance_status")}
                  value={detailStudent.insurance_status ? t(`insurance.${detailStudent.insurance_status}`) : null}
                />
                <InfoField label={t("field.address")} value={detailStudent.address} />
                <InfoField label={t("field.emergency_contact")} value={detailStudent.emergency_contact} />
              </div>

              {(detailStudent.health_condition || detailStudent.medical_notes) && (
                <div className="space-y-2 border-t border-border pt-3">
                  <InfoField label={t("field.health_condition")} value={detailStudent.health_condition} />
                  <InfoField label={t("field.medical_notes")} value={detailStudent.medical_notes} />
                </div>
              )}

              {detailParent && (
                <div className="space-y-2 border-t border-border pt-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t("field.parent")}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <InfoField label={t("field.name")} value={detailParent.name} />
                    <InfoField label={t("field.phone")} value={detailParent.phone} />
                  </div>
                </div>
              )}

              {detailStudent.notes && (
                <div className="space-y-1 border-t border-border pt-3">
                  <InfoField label={t("field.notes")} value={detailStudent.notes} />
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
