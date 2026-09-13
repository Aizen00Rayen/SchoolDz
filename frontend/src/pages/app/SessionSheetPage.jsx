import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutGrid, Printer, Loader2, Wallet, Search, X, RotateCcw, ListFilter, Users } from "lucide-react";
import { PageHeader, EmptyState, LoadingRows, groupOptionLabel } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { api, extractError, openSessionSheetPdf } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { usePermission } from "@/lib/permissions";

// Course.pricing_type -> the PaymentItem "kind" that best represents a
// quick one-off payment for that course, matching the choices PaymentsPage
// itself offers (see EMPTY_ITEM there).
const KIND_BY_PRICING_TYPE = {
  per_session: "per_session",
  per_month: "monthly",
  fixed_sessions: "course",
};

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
  const { canAdd: canAddPayments } = usePermission("payments");
  const qc = useQueryClient();
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [courseFilter, setCourseFilter] = useState("");
  const [teacherFilter, setTeacherFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [detailStudentId, setDetailStudentId] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");

  const closeDetail = () => {
    setDetailStudentId(null);
    setPayOpen(false);
  };

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

  const courseMap = useMemo(
    () => Object.fromEntries((courses?.items || []).map((c) => [c.id, c])),
    [courses],
  );
  const teacherMap = useMemo(
    () => Object.fromEntries((teachers?.items || []).map((tch) => [tch.id, tch])),
    [teachers],
  );

  const filteredGroups = useMemo(() => {
    return (groups?.items || []).filter((g) => {
      if (courseFilter && String(g.course_id) !== String(courseFilter)) return false;
      if (teacherFilter && String(g.teacher_id) !== String(teacherFilter)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const gName = (g.name || "").toLowerCase();
        const course = courseMap[g.course_id];
        const cTitle = (course?.title || "").toLowerCase();
        const teacher = teacherMap[g.teacher_id];
        const tName = teacher ? `${teacher.first_name} ${teacher.last_name}`.toLowerCase() : "";
        if (!gName.includes(q) && !cTitle.includes(q) && !tName.includes(q)) return false;
      }
      return true;
    });
  }, [groups, courseFilter, teacherFilter, searchQuery, courseMap, teacherMap]);

  // Keep active tab in sync with selection
  useEffect(() => {
    if (selectedGroupIds.length > 0) {
      const matches =
        activeTab === "all" ||
        selectedGroupIds.some((id) => String(id) === String(activeTab));
      if (!matches) {
        setActiveTab(String(selectedGroupIds[0]));
      }
    } else {
      setActiveTab("all");
    }
  }, [selectedGroupIds, activeTab]);

  const toggleGroup = (id) => {
    setSelectedGroupIds((prev) => {
      const exists = prev.includes(id);
      const next = exists ? prev.filter((x) => x !== id) : [...prev, id];
      if (!exists && activeTab !== "all") {
        setActiveTab(String(id));
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedGroupIds([]);
    setActiveTab("all");
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

  const printSheet = async (idsToPrint) => {
    const targetIds =
      idsToPrint ||
      (activeTab === "all" ? selectedGroupIds : [Number(activeTab) || activeTab]);
    if (!targetIds || targetIds.length === 0) return;
    setPrinting(true);
    try {
      await openSessionSheetPdf(targetIds);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setPrinting(false);
    }
  };

  const sheets = useMemo(() => data?.sheets || [], [data]);

  // The sheet (group) the currently-open student was clicked from — gives
  // us the course context (id/price/pricing_type) for the quick-pay form
  // without a second fetch. A student in several selected groups just uses
  // whichever sheet they were actually clicked from.
  const detailSheet = useMemo(
    () => sheets.find((sheet) => sheet.students.some((x) => x.id === detailStudentId)) || null,
    [sheets, detailStudentId],
  );
  const detailPaid = useMemo(() => {
    const s = detailSheet?.students.find((x) => x.id === detailStudentId);
    return s ? s.paid : null;
  }, [detailSheet, detailStudentId]);

  const payMut = useMutation({
    mutationFn: (payload) => api.post("/payments", payload),
    onSuccess: () => {
      toast.success(t("session_sheet.payment_recorded"));
      qc.invalidateQueries({ queryKey: ["session-sheet"] });
      qc.invalidateQueries({ queryKey: ["payments-balances"] });
      setPayOpen(false);
      setPayAmount("");
    },
    onError: (e) => toast.error(extractError(e)),
  });

  const submitPayment = () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0 || !detailSheet?.course_id) return;
    payMut.mutate({
      student_id: detailStudentId,
      method: payMethod,
      status: "paid",
      discount: 0,
      items: [
        {
          kind: KIND_BY_PRICING_TYPE[detailSheet.course_pricing_type] || "other",
          course_id: detailSheet.course_id,
          amount,
        },
      ],
    });
  };

  const renderSheetCard = (sheet) => {
    if (!sheet) return null;
    return (
      <div key={sheet.group_id} className="surface-card overflow-hidden">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">{t("field.group")}: </span>
            <span className="font-semibold text-foreground">{sheet.group_name}</span>
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
          <div className="ms-auto text-xs text-muted-foreground font-mono">
            {sheet.students.length} {t("field.student").toLowerCase()}s · {sheet.sessions.length} séances
          </div>
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
                        onClick={() => {
                          setDetailStudentId(student.id);
                          setPayOpen(false);
                          setPayAmount("");
                        }}
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
    );
  };

  return (
    <div>
      <PageHeader
        title={t("menu.session_sheet")}
        subtitle={t("subtitle.session_sheet")}
        actions={
          selectedGroupIds.length > 0 ? (
            <div className="flex items-center gap-2">
              {selectedGroupIds.length > 1 && (
                <Button
                  variant="outline"
                  onClick={() => printSheet(selectedGroupIds)}
                  disabled={printing}
                  data-testid="session-sheet-print-all"
                >
                  {printing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Printer className="w-4 h-4 me-2" />}
                  {t("session_sheet.print_all", { count: selectedGroupIds.length })}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  printSheet(
                    activeTab === "all"
                      ? selectedGroupIds
                      : [Number(activeTab) || activeTab]
                  )
                }
                disabled={printing}
                data-testid="session-sheet-print"
              >
                {printing ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <Printer className="w-4 h-4 me-2" />}
                {selectedGroupIds.length > 1 && activeTab !== "all"
                  ? t("session_sheet.print_current")
                  : t("session_sheet.print")}
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Modern Filter Card */}
      <div className="surface-card p-4 mb-5 space-y-3.5 border border-border/80 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          {/* Course filter */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              {t("field.course")}
            </Label>
            <Select
              value={courseFilter || "__all"}
              onValueChange={(v) => {
                setCourseFilter(v === "__all" ? "" : v);
              }}
            >
              <SelectTrigger className="bg-background h-9">
                <SelectValue placeholder={t("groups.all_courses")} />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-80">
                <SelectItem value="__all">{t("groups.all_courses")}</SelectItem>
                {(courses?.items || []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.title}
                    {c.school_level ? ` (${t(`school_level.${c.school_level}`)})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Teacher filter */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              {t("field.teacher")}
            </Label>
            <Select
              value={teacherFilter || "__all"}
              onValueChange={(v) => {
                setTeacherFilter(v === "__all" ? "" : v);
              }}
            >
              <SelectTrigger className="bg-background h-9">
                <SelectValue placeholder={t("reports.all_teachers")} />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-80">
                <SelectItem value="__all">{t("reports.all_teachers")}</SelectItem>
                {(teachers?.items || []).map((tch) => (
                  <SelectItem key={tch.id} value={String(tch.id)}>
                    {tch.first_name} {tch.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search filter */}
          <div>
            <Label className="text-xs font-medium mb-1.5 block text-muted-foreground">
              {t("actions.search")}
            </Label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-3 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder={t("session_sheet.search_groups")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-background pl-8 h-9 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Group Selector Dropdown + Multi-Select trigger */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-medium text-muted-foreground">
                {t("field.group")}
              </Label>
              {selectedGroupIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  {t("session_sheet.clear_selection")}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={
                  selectedGroupIds.length === 1
                    ? String(selectedGroupIds[0])
                    : selectedGroupIds.length > 1
                    ? "__multiple"
                    : ""
                }
                onValueChange={(val) => {
                  if (val === "__all_filtered") {
                    const allFilteredIds = filteredGroups.map((g) => g.id);
                    setSelectedGroupIds(allFilteredIds);
                    if (allFilteredIds.length > 0) setActiveTab(String(allFilteredIds[0]));
                  } else if (val && val !== "__multiple") {
                    const numId = Number(val) || val;
                    setSelectedGroupIds([numId]);
                    setActiveTab(String(numId));
                  }
                }}
              >
                <SelectTrigger className="bg-background h-9 flex-1 text-xs" data-testid="session-sheet-group-select">
                  <SelectValue placeholder={t("session_sheet.select_group_placeholder")} />
                </SelectTrigger>
                <SelectContent className="bg-popover max-h-80">
                  {filteredGroups.length > 1 && (
                    <SelectItem value="__all_filtered" className="font-semibold text-accent">
                      ✓ {t("session_sheet.all_filtered_groups")} ({filteredGroups.length})
                    </SelectItem>
                  )}
                  {filteredGroups.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground text-center">
                      {t("search.no_results")}
                    </div>
                  ) : (
                    filteredGroups.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)} data-testid={`session-sheet-group-${g.id}`}>
                        {groupOptionLabel(g, courseMap, t)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              {/* Multi-Select popover for picking multiple specific groups */}
              <Popover open={multiSelectOpen} onOpenChange={setMultiSelectOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedGroupIds.length > 1 ? "secondary" : "outline"}
                    size="sm"
                    className="h-9 px-2.5 flex-shrink-0 text-xs"
                    title={t("session_sheet.multi_select")}
                  >
                    <ListFilter className="w-3.5 h-3.5 me-1" />
                    {selectedGroupIds.length > 1 ? selectedGroupIds.length : ""}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3 bg-popover shadow-lg" align="end">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                    <span className="text-xs font-semibold">
                      {t("session_sheet.select_groups")} ({filteredGroups.length})
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const allFilteredIds = filteredGroups.map((g) => g.id);
                          setSelectedGroupIds(allFilteredIds);
                          if (allFilteredIds.length > 0) setActiveTab(String(allFilteredIds[0]));
                        }}
                        className="text-xs text-accent hover:underline"
                      >
                        {t("reports.all_groups")}
                      </button>
                      <span className="text-muted-foreground text-xs">•</span>
                      <button
                        type="button"
                        onClick={() => setSelectedGroupIds([])}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        {t("session_sheet.clear_selection")}
                      </button>
                    </div>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1 py-1">
                    {filteredGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-2">{t("search.no_results")}</p>
                    ) : (
                      filteredGroups.map((g) => {
                        const isChecked = selectedGroupIds.includes(g.id);
                        return (
                          <div
                            key={g.id}
                            onClick={() => toggleGroup(g.id)}
                            data-testid={`session-sheet-group-check-${g.id}`}
                            className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer text-xs transition-colors ${
                              isChecked ? "bg-accent/15 text-accent-foreground font-medium" : "hover:bg-muted"
                            }`}
                          >
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleGroup(g.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="truncate flex-1">{groupOptionLabel(g, courseMap, t)}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Selected groups badges */}
        {selectedGroupIds.length > 0 && (
          <div className="pt-2 border-t border-border/50 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground me-1 font-medium flex items-center gap-1">
              <Users className="w-3 h-3" />
              {selectedGroupIds.length === 1
                ? "1 groupe sélectionné :"
                : `${selectedGroupIds.length} groupes sélectionnés :`}
            </span>
            {selectedGroupIds.map((id) => {
              const g = (groups?.items || []).find((x) => x.id === id);
              if (!g) return null;
              const isCurrentTab = String(activeTab) === String(id);
              return (
                <Badge
                  key={id}
                  variant={isCurrentTab ? "default" : "secondary"}
                  className="flex items-center gap-1.5 py-0.5 px-2 cursor-pointer text-[11px] transition-all hover:opacity-90"
                  onClick={() => setActiveTab(String(id))}
                >
                  <span>{g.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroup(id);
                    }}
                    className="hover:bg-black/20 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
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
      ) : sheets.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={t("crud.no_data")}
          description={t("session_sheet.no_sessions")}
        />
      ) : sheets.length === 1 ? (
        renderSheetCard(sheets[0])
      ) : (
        <div className="space-y-4">
          {/* Group Tabs when multiple groups are selected */}
          <div className="flex items-center justify-between flex-wrap gap-2 pb-1 border-b border-border">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
              {sheets.map((sheet) => {
                const isActive = activeTab === String(sheet.group_id);
                return (
                  <button
                    key={sheet.group_id}
                    type="button"
                    onClick={() => setActiveTab(String(sheet.group_id))}
                    className={`px-3.5 py-1.5 text-xs rounded-lg font-medium whitespace-nowrap transition-all border ${
                      isActive
                        ? "bg-accent text-accent-foreground border-accent shadow-sm"
                        : "bg-background text-muted-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {sheet.group_name}
                    <span className="ms-1.5 opacity-70 text-[11px]">
                      ({sheet.students.length})
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={`px-3.5 py-1.5 text-xs rounded-lg font-medium whitespace-nowrap transition-all border ${
                  activeTab === "all"
                    ? "bg-accent text-accent-foreground border-accent shadow-sm"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {t("session_sheet.all_tabs")} ({sheets.length})
              </button>
            </div>
          </div>

          {activeTab === "all" ? (
            <div className="space-y-6">
              {sheets.map((sheet) => renderSheetCard(sheet))}
            </div>
          ) : (
            renderSheetCard(
              sheets.find((s) => String(s.group_id) === String(activeTab)) || sheets[0]
            )
          )}
        </div>
      )}

      <Dialog open={Boolean(detailStudentId)} onOpenChange={(o) => !o && closeDetail()}>
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
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      detailPaid ? "bg-[#d7e05a]/40 text-[#5c6b00]" : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    {detailPaid ? t("session_sheet.paid") : t("attendance.unpaid")}
                  </span>
                  {!detailPaid && canAddPayments && detailSheet?.course_id && !payOpen && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      data-testid="session-sheet-make-payment"
                      onClick={() => {
                        setPayAmount(detailSheet.course_price || "");
                        setPayOpen(true);
                      }}
                    >
                      <Wallet className="w-3.5 h-3.5 me-1.5" />
                      {t("session_sheet.make_payment")}
                    </Button>
                  )}
                </div>
              )}

              {payOpen && (
                <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/30">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 block">
                        {t("field.amount")}
                      </label>
                      <Input
                        type="number"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        data-testid="session-sheet-pay-amount"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 block">
                        {t("field.method")}
                      </label>
                      <Select value={payMethod} onValueChange={setPayMethod}>
                        <SelectTrigger className="bg-background" data-testid="session-sheet-pay-method">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover">
                          <SelectItem value="cash">{t("method.cash")}</SelectItem>
                          <SelectItem value="card">{t("method.card")}</SelectItem>
                          <SelectItem value="bank_transfer">{t("method.bank_transfer")}</SelectItem>
                          <SelectItem value="cheque">{t("method.cheque")}</SelectItem>
                          <SelectItem value="other">{t("method.other")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPayOpen(false)}>
                      {t("actions.cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitPayment}
                      disabled={payMut.isPending || !parseFloat(payAmount)}
                      data-testid="session-sheet-pay-confirm"
                    >
                      {payMut.isPending && <Loader2 className="w-3.5 h-3.5 me-1.5 animate-spin" />}
                      {t("session_sheet.confirm_payment")}
                    </Button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <InfoField label={t("field.phone")} value={detailStudent.phone} />
                <InfoField label={t("field.email")} value={detailStudent.email} />
                <InfoField
                  label={t("field.status")}
                  value={detailStudent.status ? t(`status.${detailStudent.status.toLowerCase()}`) : null}
                />
                <InfoField label={t("field.student_code")} value={detailStudent.student_code} />
                <InfoField
                  label={t("field.school_level")}
                  value={detailStudent.school_level ? t(`school_level.${detailStudent.school_level.toLowerCase()}`) : null}
                />
                <InfoField label={t("field.school_year")} value={detailStudent.school_year} />
                <InfoField label={t("field.specialty")} value={detailStudent.specialty} />
                <InfoField
                  label={t("field.gender")}
                  value={detailStudent.gender ? t(`gender.${detailStudent.gender.toLowerCase()}`) : null}
                />
                <InfoField label={t("field.blood_type")} value={detailStudent.blood_type} />
                <InfoField
                  label={t("field.insurance_status")}
                  value={detailStudent.insurance_status ? t(`insurance.${detailStudent.insurance_status.toLowerCase()}`) : null}
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
