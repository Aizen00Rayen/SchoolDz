import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive, Folder, ChevronRight, BookOpen, Users, CalendarClock, Coins, HandCoins,
  TrendingUp, RotateCcw, ArrowLeft, Search, CheckCircle2, XCircle, AlertCircle, Clock,
  FileText, ShieldCheck, DoorOpen
} from "lucide-react";
import { api, extractError } from "@/lib/api";
import { PageHeader, StatusPill } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { usePermission } from "@/lib/permissions";

export default function ArchivePage() {
  const { t, dir } = useI18n();
  const { tenant } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { canModify } = usePermission("courses");

  // Navigation levels:
  // selectedYear: null (root level) | number (e.g. 2026)
  // currentFolder: null (year level) | 'courses'
  const [selectedYear, setSelectedYear] = useState(null);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [courseSearch, setCourseSearch] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const currency = tenant?.currency || "DZD";

  // Fetch archive overview (years and counts)
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["archive-overview"],
    queryFn: async () => (await api.get("/archive/overview")).data,
  });

  // Fetch archived courses when inside a year & courses folder
  const { data: archivedCoursesData, isLoading: coursesLoading } = useQuery({
    queryKey: ["archived-courses", selectedYear],
    queryFn: async () => (await api.get(`/courses?status=archived&year=${selectedYear}`)).data,
    enabled: Boolean(selectedYear && currentFolder === "courses"),
  });

  // Fetch detailed dossier for a selected archived course
  const { data: courseDossier, isLoading: dossierLoading } = useQuery({
    queryKey: ["archived-course-detail", selectedCourseId],
    queryFn: async () => (await api.get(`/courses/${selectedCourseId}/archive-details/`)).data,
    enabled: Boolean(selectedCourseId),
  });

  const handleRestore = async (courseId, courseTitle) => {
    const ok = await confirm({
      title: t("archive.restore_title", "استعادة الدورة من الأرشيف"),
      description: t("archive.restore_desc", `هل تريد استعادة الدورة "${courseTitle}" إلى قائمة الدورات النشطة؟`),
      confirmLabel: t("archive.restore_action", "استعادة"),
    });
    if (!ok) return;

    setRestoring(true);
    try {
      await api.post(`/courses/${courseId}/unarchive/`);
      toast.success(t("archive.restore_success", "تمت استعادة الدورة بنجاح إلى قائمة الدورات النشطة"));
      qc.invalidateQueries({ queryKey: ["archived-courses"] });
      qc.invalidateQueries({ queryKey: ["archive-overview"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      setSelectedCourseId(null);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setRestoring(false);
    }
  };

  const years = overview?.years || [2026];
  const counts = overview?.counts || {};

  const filteredCourses = (archivedCoursesData?.items || []).filter((c) => {
    if (!courseSearch) return true;
    const q = courseSearch.toLowerCase();
    return (
      (c.title || "").toLowerCase().includes(q) ||
      (c.category || "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title={t("menu.archive", "الأرشيف")}
        subtitle={t("archive.subtitle", "أرشيف السنوات والدورات المنتهية مع كامل السجلات المالية والأكاديمية")}
      />

      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 p-2.5 rounded-lg bg-muted/40 border border-border">
        <button
          onClick={() => { setSelectedYear(null); setCurrentFolder(null); }}
          className={`hover:text-foreground font-medium flex items-center gap-1.5 transition-colors ${!selectedYear ? "text-foreground font-semibold" : ""}`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{t("menu.archive", "الأرشيف")}</span>
        </button>

        {selectedYear && (
          <>
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 ${dir === "rtl" ? "rotate-180" : ""}`} />
            <button
              onClick={() => setCurrentFolder(null)}
              className={`hover:text-foreground font-medium flex items-center gap-1.5 transition-colors ${selectedYear && !currentFolder ? "text-foreground font-semibold" : ""}`}
            >
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              <span>{selectedYear}</span>
            </button>
          </>
        )}

        {selectedYear && currentFolder && (
          <>
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 ${dir === "rtl" ? "rotate-180" : ""}`} />
            <span className="text-foreground font-semibold flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-500" />
              <span>{t("menu.courses", "الدورات")}</span>
            </span>
          </>
        )}
      </div>

      {/* Level 0: Year Folders */}
      {!selectedYear && (
        <div>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {t("archive.select_year", "سنوات الأرشيف")}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {years.map((year) => {
              const cCount = counts[year] || 0;
              return (
                <div
                  key={year}
                  onClick={() => setSelectedYear(year)}
                  className="surface-card p-5 cursor-pointer hover:border-accent hover:shadow-md transition-all group flex items-start gap-4"
                >
                  <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-amber-600 dark:text-amber-400 group-hover:scale-105 transition-transform flex-shrink-0">
                    <Folder className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-bold text-lg text-foreground group-hover:text-accent transition-colors">
                      {year}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {cCount} {t("archive.archived_courses_count", "دورات مؤرشفة")}
                    </div>
                    <div className="mt-3 flex items-center gap-1 text-[11px] text-accent font-medium">
                      <span>{t("archive.open_folder", "فتح المجلد")}</span>
                      <ChevronRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Level 1: Folders inside the Year (e.g. "Courses") */}
      {selectedYear && !currentFolder && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedYear(null)}
                className="h-8 px-2 text-xs"
              >
                <ArrowLeft className={`w-3.5 h-3.5 me-1 ${dir === "rtl" ? "rotate-180" : ""}`} />
                {t("actions.back", "رجوع")}
              </Button>
              <h3 className="font-display font-bold text-base">{t("archive.folders_for", "محتويات سنة")} {selectedYear}</h3>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {/* Courses Folder */}
            <div
              onClick={() => setCurrentFolder("courses")}
              className="surface-card p-5 cursor-pointer hover:border-accent hover:shadow-md transition-all group flex items-start gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-blue-600 dark:text-blue-400 group-hover:scale-105 transition-transform flex-shrink-0">
                <BookOpen className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display font-bold text-base text-foreground group-hover:text-accent transition-colors">
                  {t("menu.courses", "الدورات")}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {counts[selectedYear] || 0} {t("archive.archived_courses_count", "دورات مؤرشفة")}
                </div>
                <div className="mt-3 flex items-center gap-1 text-[11px] text-accent font-medium">
                  <span>{t("archive.view_courses", "عرض الدورات")}</span>
                  <ChevronRight className={`w-3 h-3 ${dir === "rtl" ? "rotate-180" : ""}`} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Level 2: Archived Courses inside Year > Courses */}
      {selectedYear && currentFolder === "courses" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentFolder(null)}
                className="h-8 px-2 text-xs"
              >
                <ArrowLeft className={`w-3.5 h-3.5 me-1 ${dir === "rtl" ? "rotate-180" : ""}`} />
                {t("actions.back", "رجوع")}
              </Button>
              <h3 className="font-display font-bold text-base">
                {t("archive.courses_of_year", "دورات سنة")} {selectedYear}
              </h3>
              <Badge variant="outline" className="text-xs font-mono ms-1">
                {filteredCourses.length}
              </Badge>
            </div>

            <div className="w-full sm:w-64 relative">
              <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t("archive.search_courses_placeholder", "بحث في الدورات المؤرشفة...")}
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
                className="h-8 text-xs ps-8 bg-background"
              />
            </div>
          </div>

          {coursesLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : filteredCourses.length === 0 ? (
            <div className="surface-card p-12 text-center border-dashed">
              <Archive className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <div className="font-medium text-foreground text-sm">{t("archive.empty_courses_title", "لا توجد دورات مؤرشفة")}</div>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {t("archive.empty_courses_desc", "عند انتهاء أي دورة يمكنك الضغط على زر الأرشفة في صفحة الدورات لنقلها إلى هذا المجلد مع كامل سجلاتها المالية والأكاديمية.")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCourses.map((c) => (
                <div
                  key={c.id}
                  className="surface-card p-4 hover:border-accent hover:shadow transition-all space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color || "#0A0A0B" }} />
                        <h4 className="font-semibold text-sm line-clamp-1">{c.title}</h4>
                      </div>
                      <Badge variant="secondary" className="text-[10px] uppercase font-mono">
                        {selectedYear}
                      </Badge>
                    </div>

                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {c.description || c.category || "—"}
                    </div>

                    <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("field.price")}:</span>
                      <span className="font-mono font-semibold">
                        {Number(c.price || 0).toLocaleString()} {currency}
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedCourseId(c.id)}
                      className="w-full text-xs h-8"
                    >
                      <FileText className="w-3.5 h-3.5 me-1.5" />
                      {t("archive.view_dossier", "عرض السجل والتفاصيل")}
                    </Button>

                    {canModify && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRestore(c.id, c.title)}
                        title={t("archive.restore_action", "استعادة")}
                        className="h-8 w-8 text-muted-foreground hover:text-accent flex-shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Comprehensive Archived Course Dossier Dialog */}
      <Dialog open={Boolean(selectedCourseId)} onOpenChange={(o) => !o && setSelectedCourseId(null)}>
        <DialogContent className="bg-card max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="font-display text-xl flex items-center gap-2">
                <span>{courseDossier?.course?.title || t("archive.course_dossier", "سجل الدورة المؤرشفة")}</span>
                <Badge variant="outline" className="text-xs font-mono border-amber-500/40 text-amber-600 dark:text-amber-400">
                  {t("status.archived", "مؤرشفة")} &middot; {selectedYear}
                </Badge>
              </DialogTitle>
              {canModify && selectedCourseId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restoring}
                  onClick={() => handleRestore(selectedCourseId, courseDossier?.course?.title || "")}
                  className="text-xs h-8"
                >
                  <RotateCcw className="w-3.5 h-3.5 me-1" />
                  {t("archive.restore_action", "استعادة الدورة")}
                </Button>
              )}
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("archive.dossier_description", "تقرير تفصيلي شامل عن الأساتذة، الطلاب المسجلين ونسب الحضور، المداخيل ومستحقات الأستاذ")}
            </DialogDescription>
          </DialogHeader>

          {dossierLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : courseDossier ? (
            <div className="space-y-6 pt-2">
              {/* Financial Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <Coins className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>{t("archive.total_revenue", "مداخيل الدورة")}</span>
                  </div>
                  <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                    {Number(courseDossier.total_revenue || 0).toLocaleString()} {currency}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <HandCoins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{t("archive.teacher_earnings", "مستحقات الأستاذ")}</span>
                  </div>
                  <div className="text-base font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
                    {Number(courseDossier.teacher_earnings || 0).toLocaleString()} {currency}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>{t("archive.net_profit", "صافي ربح المدرسة")}</span>
                  </div>
                  <div className="text-base font-bold font-mono text-purple-600 dark:text-purple-400 mt-1">
                    {Number(courseDossier.net_profit || 0).toLocaleString()} {currency}
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-muted/60 border border-border text-center">
                  <div className="text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{t("archive.total_students", "إجمالي التلاميذ")}</span>
                  </div>
                  <div className="text-base font-bold font-mono text-foreground mt-1">
                    {courseDossier.total_students || 0}
                  </div>
                </div>
              </div>

              {/* Teachers Section */}
              <div className="p-4 rounded-lg bg-muted/30 border border-border space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t("archive.instructors", "الأساتذة المشرفون على الدورة")}
                </div>
                {(courseDossier.teachers || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground">—</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {courseDossier.teachers.map((tch) => (
                      <div key={tch.id} className="p-2.5 rounded-md bg-card border border-border text-xs flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-foreground">{tch.name}</div>
                          {tch.phone && <div className="text-muted-foreground font-mono text-[11px]">{tch.phone}</div>}
                        </div>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {tch.payment_percentage}%
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Enrolled Students & Attendance Breakdown */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-accent" />
                    <span>{t("archive.enrolled_students_title", "التلاميذ المسجلون وسجل الحضور")}</span>
                  </h4>
                  <span className="text-xs font-mono text-muted-foreground">
                    {courseDossier.total_students} {t("menu.students")}
                  </span>
                </div>

                {(courseDossier.students || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground p-4 text-center border rounded-lg">
                    {t("archive.no_students_enrolled", "لم يتم تسجيل أي تلميذ في هذه الدورة")}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("field.student_name")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.phone")}</th>
                          <th className="text-center px-2 py-2 font-medium text-emerald-600 dark:text-emerald-400">{t("attendance.present", "حاضر")}</th>
                          <th className="text-center px-2 py-2 font-medium text-destructive">{t("attendance.absent", "غائب")}</th>
                          <th className="text-center px-2 py-2 font-medium text-amber-600 dark:text-amber-400">{t("attendance.excused", "مبرر")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("attendance.presence_rate", "نسبة الحضور")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {courseDossier.students.map((stu) => {
                          const att = stu.attendance || { present: 0, absent: 0, excused: 0, total: 0 };
                          const rate = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
                          return (
                            <tr key={stu.id} className="hover:bg-muted/20">
                              <td className="px-3 py-2">
                                <div className="font-medium text-foreground">{stu.name}</div>
                                {stu.code && <div className="text-[10px] text-muted-foreground font-mono">{stu.code}</div>}
                              </td>
                              <td className="px-3 py-2 font-mono text-muted-foreground">
                                {stu.phone || stu.parent_phone || "—"}
                              </td>
                              <td className="px-2 py-2 text-center font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                {att.present}
                              </td>
                              <td className="px-2 py-2 text-center font-mono font-semibold text-destructive">
                                {att.absent}
                              </td>
                              <td className="px-2 py-2 text-center font-mono font-semibold text-amber-600 dark:text-amber-400">
                                {att.excused}
                              </td>
                              <td className="px-3 py-2 text-end font-mono font-semibold">
                                <span className={rate >= 75 ? "text-emerald-600 dark:text-emerald-400" : rate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}>
                                  {rate}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Sessions Conducted */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4 text-accent" />
                    <span>{t("archive.sessions_conducted", "الحصص المقدمة")}</span>
                  </h4>
                  <span className="text-xs font-mono text-muted-foreground">
                    {courseDossier.total_sessions} {t("menu.sessions")}
                  </span>
                </div>

                {(courseDossier.sessions || []).length === 0 ? (
                  <div className="text-xs text-muted-foreground p-4 text-center border rounded-lg">
                    {t("archive.no_sessions_held", "لم يتم عقد أي حصص لهذه الدورة")}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("field.date")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.group")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.teacher")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.room")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.status")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {courseDossier.sessions.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {s.start_at ? s.start_at.slice(0, 16).replace("T", " ") : "—"}
                            </td>
                            <td className="px-3 py-2 font-medium">{s.group_name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.teacher_name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.room_name}</td>
                            <td className="px-3 py-2 text-end">
                              <StatusPill status={s.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
