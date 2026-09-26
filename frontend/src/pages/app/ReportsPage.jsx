import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Download, FileDown, TrendingUp, TrendingDown, Receipt, Wallet, TriangleAlert, HandCoins, Loader2, ShieldCheck, Coins,
  Search, ArrowLeft, Printer, UserRound, GraduationCap, X, CheckCircle2, Clock, CalendarDays, BookOpen, Layers, Phone
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, downloadFrom, extractError, openFinanceReportPdf } from "@/lib/api";
import { PageHeader, Field, StatusPill, groupOptionLabel } from "./_shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { categoryLabel } from "./ExpensesPage";
import { otherIncomeCategoryLabel } from "./OtherIncomesPage";

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const BALANCE_CLS = {
  settled: "text-muted-foreground",
  owes: "text-destructive font-bold",
  overpaid: "text-success font-bold",
};

export default function ReportsPage() {
  const { t, dir } = useI18n();
  const { tenant } = useAuth();
  const [filters, setFilters] = useState({ from: "", to: "", group_id: "", teacher_id: "" });
  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfMonth, setPdfMonth] = useState(currentMonthValue());
  const [pdfDownloading, setPdfDownloading] = useState(false);

  // Search state for all-time student and teacher reports
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [selectedTeacherId, setSelectedTeacherId] = useState(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef(null);

  useEffect(() => {
    const handleDocClick = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, []);

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();

  // General report queries
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
  });
  const { data: finance } = useQuery({
    queryKey: ["finance-report", filters],
    queryFn: async () => (await api.get(`/reports/finance${query ? `?${query}` : ""}`)).data,
  });
  const { data: groups } = useQuery({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-list"],
    queryFn: async () => (await api.get("/courses")).data,
  });
  const courseMap = Object.fromEntries((courses?.items || []).map((c) => [c.id, c]));
  const { data: teachers } = useQuery({
    queryKey: ["teachers"],
    queryFn: async () => (await api.get("/teachers")).data,
  });

  // Autocomplete search query
  const { data: searchResults, isFetching: searchLoading } = useQuery({
    queryKey: ["reports-search", searchQuery],
    queryFn: async () => (await api.get(`/reports/search?q=${encodeURIComponent(searchQuery)}`)).data,
    enabled: Boolean(searchQuery.trim().length >= 1),
  });

  // Comprehensive Student Report query
  const { data: studentReport, isLoading: studentReportLoading } = useQuery({
    queryKey: ["reports-student", selectedStudentId],
    queryFn: async () => (await api.get(`/reports/student/${selectedStudentId}`)).data,
    enabled: Boolean(selectedStudentId),
  });

  // Comprehensive Teacher Report query
  const { data: teacherReport, isLoading: teacherReportLoading } = useQuery({
    queryKey: ["reports-teacher", selectedTeacherId],
    queryFn: async () => (await api.get(`/reports/teacher/${selectedTeacherId}`)).data,
    enabled: Boolean(selectedTeacherId),
  });

  const currency = tenant?.currency || "DZD";
  const money = (v) => `${Number(v || 0).toLocaleString()} ${currency}`;
  const byCategory = Object.entries(finance?.expenses_by_category || {});

  const downloadPdf = async () => {
    setPdfDownloading(true);
    try {
      const extra = {};
      if (filters.group_id) extra.group_id = filters.group_id;
      if (filters.teacher_id) extra.teacher_id = filters.teacher_id;
      await openFinanceReportPdf(pdfMonth, extra);
      setPdfDialogOpen(false);
    } catch (e) {
      toast.error(extractError(e));
    } finally {
      setPdfDownloading(false);
    }
  };

  const handleSelectStudent = (id) => {
    setSelectedStudentId(id);
    setSelectedTeacherId(null);
    setIsSearchFocused(false);
    setSearchQuery("");
  };

  const handleSelectTeacher = (id) => {
    setSelectedTeacherId(id);
    setSelectedStudentId(null);
    setIsSearchFocused(false);
    setSearchQuery("");
  };

  const handleClearSelection = () => {
    setSelectedStudentId(null);
    setSelectedTeacherId(null);
    setSearchQuery("");
  };

  return (
    <div>
      <PageHeader
        title={t("menu.reports")}
        subtitle={t("reports.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {!selectedStudentId && !selectedTeacherId ? (
              <>
                <Button variant="outline" onClick={() => setPdfDialogOpen(true)} data-testid="reports-export-pdf">
                  <FileDown className="w-4 h-4 me-2" /> {t("export.pdf")}
                </Button>
                <Button variant="outline" onClick={() => downloadFrom(`/reports/finance?${query}`, "xlsx", "financial-report")}>
                  <Download className="w-4 h-4 me-2" /> {t("export.excel")}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="w-4 h-4 me-2" /> {t("actions.print", "طباعة التقرير")}
              </Button>
            )}
          </div>
        }
      />

      {/* Global Student & Teacher Search Bar */}
      <div ref={searchContainerRef} className="surface-card p-3 mb-6 relative z-30">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchFocused(true);
              }}
              onFocus={() => setIsSearchFocused(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setIsSearchFocused(true);
                  if (searchResults?.students?.length > 0) {
                    handleSelectStudent(searchResults.students[0].id);
                  } else if (searchResults?.teachers?.length > 0) {
                    handleSelectTeacher(searchResults.teachers[0].id);
                  }
                }
              }}
              placeholder={t("reports.search_bar_placeholder", "ابحث عن تلميذ أو أستاذ لعرض التقرير الشامل لجميع الأوقات...")}
              className="ps-9 pe-9 text-xs sm:text-sm bg-background h-10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="default"
            className="h-10 px-4 text-xs font-medium"
            onClick={() => setIsSearchFocused(true)}
          >
            <Search className="w-4 h-4 me-1.5" />
            {t("actions.search", "بحث")}
          </Button>
        </div>

        {/* Autocomplete Dropdown */}
        {isSearchFocused && searchQuery.trim().length >= 1 && (
          <div className="absolute start-0 end-0 top-full mt-1.5 z-50 bg-popover border border-border rounded-lg shadow-xl overflow-hidden divide-y divide-border">
            {searchLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin inline-block me-1.5" />
                {t("actions.loading")}
              </div>
            ) : (
              <>
                {/* Students Section */}
                <div>
                  <div className="px-3 py-1.5 bg-muted/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-accent" />
                      {t("menu.students", "التلاميذ")}
                    </span>
                    <span className="font-mono">{searchResults?.students?.length || 0}</span>
                  </div>
                  {(searchResults?.students || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">{t("common.no_results", "لا توجد نتائج")}</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {searchResults.students.map((s) => (
                        <div
                          key={s.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectStudent(s.id);
                          }}
                          className="px-3 py-2 text-xs hover:bg-muted/50 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-foreground">{s.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                              {s.code || s.phone || "—"} {s.school_level ? `· ${s.school_level}` : ""}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {t("menu.students")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Teachers Section */}
                <div>
                  <div className="px-3 py-1.5 bg-muted/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <UserRound className="w-3.5 h-3.5 text-blue-500" />
                      {t("menu.teachers", "الأساتذة")}
                    </span>
                    <span className="font-mono">{searchResults?.teachers?.length || 0}</span>
                  </div>
                  {(searchResults?.teachers || []).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground">{t("common.no_results", "لا توجد نتائج")}</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {searchResults.teachers.map((tch) => (
                        <div
                          key={tch.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectTeacher(tch.id);
                          }}
                          className="px-3 py-2 text-xs hover:bg-muted/50 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div>
                            <div className="font-semibold text-foreground">{tch.name}</div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {tch.subject || "—"} {tch.phone ? `· ${tch.phone}` : ""}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono border-blue-500/40 text-blue-600 dark:text-blue-400">
                            {t("menu.teachers")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* RENDER VIEW 1: STUDENT ALL-TIME REPORT */}
      {selectedStudentId ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="h-8 px-2 text-xs"
              >
                <ArrowLeft className={`w-3.5 h-3.5 me-1.5 ${dir === "rtl" ? "rotate-180" : ""}`} />
                {t("reports.back_to_general", "الرجوع للتقرير العام")}
              </Button>
              <span className="text-xs text-muted-foreground">|</span>
              <span className="text-xs font-semibold text-foreground">
                {t("reports.student_all_time_report", "تقرير التلميذ الشامل لجميع الأوقات")}
              </span>
            </div>
          </div>

          {studentReportLoading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : studentReport ? (
            <div className="space-y-6">
              {/* Student Profile Card */}
              <div className="surface-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-bold text-xl text-foreground">{studentReport.student.name}</h3>
                      <StatusPill status={studentReport.student.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {studentReport.student.code && (
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{studentReport.student.code}</span>
                      )}
                      {studentReport.student.school_level && <span>{studentReport.student.school_level}</span>}
                      {studentReport.student.school_year && <span>السنة {studentReport.student.school_year}</span>}
                      {studentReport.student.specialty && <span>{studentReport.student.specialty}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col items-end text-xs text-muted-foreground space-y-1">
                    {studentReport.student.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-mono">{studentReport.student.phone}</span>
                      </div>
                    )}
                    {studentReport.student.parent_phone && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px]">{t("field.parent_phone", "ولي الأمر")}:</span>
                        <span className="font-mono">{studentReport.student.parent_phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Financial Summary Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("payments.total_paid")}</div>
                  <div className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {money(studentReport.financial_summary.total_paid)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("debts.total_debt", "مجموع الديون")}</div>
                  <div className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {money(studentReport.financial_summary.total_debt)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("payments.total_cost")}</div>
                  <div className="font-mono text-xl font-bold text-foreground mt-1">
                    {money(studentReport.financial_summary.total_cost)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("payments.balance_label")}</div>
                  <div className={`font-mono text-xl font-bold mt-1 ${BALANCE_CLS[studentReport.financial_summary.balance_status] || ""}`}>
                    {money(studentReport.financial_summary.balance)}
                  </div>
                </div>
              </div>

              {/* Section 1: Enrolled Courses & Session Deductions */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-accent" />
                    <span>{t("payments.enrolled_courses", "الدورات المسجلة والحصص المقتطعة")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {studentReport.courses.length} {t("menu.courses")}
                  </span>
                </div>

                {studentReport.courses.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("payments.no_courses")}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead className="bg-muted/50 border-b border-border">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("field.course_title")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.teacher")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.pricing")}</th>
                          <th className="text-center px-2 py-2 font-medium">{t("payments.sessions_covered", "حصص مدفوعة")}</th>
                          <th className="text-center px-2 py-2 font-medium text-emerald-600 dark:text-emerald-400">{t("attendance.present", "حاضر")}</th>
                          <th className="text-center px-2 py-2 font-medium text-destructive">{t("attendance.absent", "غائب")}</th>
                          <th className="text-center px-2 py-2 font-medium text-blue-600 dark:text-blue-400">{t("payments.sessions_remaining", "حصص متبقية")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("payments.credit_remaining", "الرصيد المتبقي")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {studentReport.courses.map((c) => (
                          <tr key={c.group_id} className="hover:bg-muted/20">
                            <td className="px-3 py-2.5 font-medium">
                              <div>{c.course_title}</div>
                              <div className="text-[10px] text-muted-foreground">{c.group_name}</div>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{c.teacher_name}</td>
                            <td className="px-3 py-2.5 text-end font-mono">
                              {Number(c.cost_per_session || 0).toLocaleString()} {currency}
                            </td>
                            <td className="px-2 py-2.5 text-center font-bold font-mono">{c.sessions_covered}</td>
                            <td className="px-2 py-2.5 text-center font-bold font-mono text-emerald-600 dark:text-emerald-400">{c.sessions_attended}</td>
                            <td className="px-2 py-2.5 text-center font-bold font-mono text-destructive">{c.sessions_absent}</td>
                            <td className="px-2 py-2.5 text-center font-bold font-mono text-blue-600 dark:text-blue-400">{c.sessions_remaining}</td>
                            <td className="px-3 py-2.5 text-end font-mono font-bold text-purple-600 dark:text-purple-400">
                              {Number(c.credit_remaining || 0).toLocaleString()} {currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 2: Invoices & Payments History */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>{t("reports.payments_history", "سجل المدفوعات والوصولات بالكامل")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {studentReport.invoices.length} {t("menu.payments")}
                  </span>
                </div>

                {studentReport.invoices.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("reports.no_transactions")}</div>
                ) : (
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs min-w-[650px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("payments.invoice_number")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("reports.date")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("payments.items_label", "العناصر")}</th>
                          <th className="text-center px-2 py-2 font-medium">{t("field.status")}</th>
                          <th className="text-center px-2 py-2 font-medium">{t("field.payment_method")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("payments.paid_now", "المدفوع")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("payments.pending_debt", "المتبقي")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {studentReport.invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono font-medium">{inv.invoice_number || inv.id.slice(0, 8)}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {inv.paid_at ? inv.paid_at.slice(0, 10) : (inv.created_at ? inv.created_at.slice(0, 10) : "—")}
                            </td>
                            <td className="px-3 py-2">
                              {inv.items && inv.items.length > 0 ? (
                                <div className="space-y-0.5">
                                  {inv.items.map((it) => (
                                    <div key={it.id} className="text-[11px]">
                                      <span className="font-medium">{it.title}</span>
                                      <span className="text-muted-foreground font-mono ms-1">({Number(it.net_amount).toLocaleString()} {currency})</span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">{inv.notes || "—"}</span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <StatusPill status={inv.status} />
                            </td>
                            <td className="px-2 py-2 text-center text-muted-foreground capitalize">{inv.method || "cash"}</td>
                            <td className="px-3 py-2 text-end font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                              {money(inv.paid_amount)}
                            </td>
                            <td className="px-3 py-2 text-end font-mono text-amber-600 dark:text-amber-400 font-semibold">
                              {inv.pending_amount > 0 ? money(inv.pending_amount) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 3: Sessions Attendance History */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-blue-500" />
                    <span>{t("attendance.history", "سجل حضور الحصص")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {studentReport.sessions_history.length} {t("menu.sessions")}
                  </span>
                </div>

                {studentReport.sessions_history.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("attendance.no_records", "لا توجد سجلات حضور مسجلة")}</div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("reports.date")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.course_title")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.group")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.teacher")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.status")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {studentReport.sessions_history.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {s.date ? s.date.slice(0, 16).replace("T", " ") : "—"}
                            </td>
                            <td className="px-3 py-2 font-medium">{s.course_title}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.group_name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.teacher_name}</td>
                            <td className="px-3 py-2 text-end">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                s.status === "present" || s.status === "late"
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                  : s.status === "absent"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              }`}>
                                {t(`attendance.${s.status}`, s.status)}
                              </span>
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
        </div>
      ) : null}

      {/* RENDER VIEW 2: TEACHER ALL-TIME REPORT */}
      {selectedTeacherId ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="h-8 px-2 text-xs"
              >
                <ArrowLeft className={`w-3.5 h-3.5 me-1.5 ${dir === "rtl" ? "rotate-180" : ""}`} />
                {t("reports.back_to_general", "الرجوع للتقرير العام")}
              </Button>
              <span className="text-xs text-muted-foreground">|</span>
              <span className="text-xs font-semibold text-foreground">
                {t("reports.teacher_all_time_report", "تقرير الأستاذ الشامل لجميع الأوقات")}
              </span>
            </div>
          </div>

          {teacherReportLoading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : teacherReport ? (
            <div className="space-y-6">
              {/* Teacher Profile Card */}
              <div className="surface-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-bold text-xl text-foreground">{teacherReport.teacher.name}</h3>
                      <StatusPill status={teacherReport.teacher.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {teacherReport.teacher.subject && (
                        <span className="font-medium text-foreground bg-muted px-2 py-0.5 rounded">{teacherReport.teacher.subject}</span>
                      )}
                      <span>
                        {t("field.percentage", "نسبة الأستاذ")}: <strong className="font-mono text-foreground">{teacherReport.teacher.payment_percentage}%</strong>
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground font-mono">
                    {teacherReport.teacher.phone && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{teacherReport.teacher.phone}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Financial Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("reports.revenue_generated", "مداخيل الحصص")}</div>
                  <div className="font-mono text-xl font-bold text-foreground mt-1">
                    {money(teacherReport.financial_summary.total_revenue_generated)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("reports.teacher_earned", "مستحقات الأستاذ المحتسبة")}</div>
                  <div className="font-mono text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {money(teacherReport.financial_summary.total_earned)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("reports.total_paid_out", "الدفعات المستلمة")}</div>
                  <div className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {money(teacherReport.financial_summary.total_paid_out)}
                  </div>
                </div>
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">{t("reports.balance_due", "المتبقي للأستاذ")}</div>
                  <div className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {money(teacherReport.financial_summary.balance_due)}
                  </div>
                </div>
              </div>

              {/* Section 1: Groups Taught */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <Layers className="w-4 h-4 text-accent" />
                    <span>{t("menu.groups", "الأفواج والدورات المسندة للأستاذ")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {teacherReport.groups.length} {t("menu.groups")}
                  </span>
                </div>

                {teacherReport.groups.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("common.no_data", "لا توجد أفواج مسندة")}</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {teacherReport.groups.map((g) => (
                      <div key={g.id} className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sm">{g.name}</div>
                            <div className="text-xs text-muted-foreground">{g.course_title}</div>
                          </div>
                          <StatusPill status={g.status} />
                        </div>
                        <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                          <span>{g.students_count} {t("menu.students")}</span>
                          <span>{g.sessions_count} {t("menu.sessions")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: Conducted Sessions Log */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-blue-500" />
                    <span>{t("reports.conducted_sessions", "سجل الحصص المقدمة")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {teacherReport.sessions.length} {t("menu.sessions")}
                  </span>
                </div>

                {teacherReport.sessions.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("attendance.no_records", "لا توجد حصص")}</div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("reports.date")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.group")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.course_title")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.room")}</th>
                          <th className="text-center px-2 py-2 font-medium text-emerald-600 dark:text-emerald-400">{t("attendance.present", "حاضر")}</th>
                          <th className="text-center px-2 py-2 font-medium text-destructive">{t("attendance.absent", "غائب")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.status")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {teacherReport.sessions.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-muted-foreground">
                              {s.start_at ? s.start_at.slice(0, 16).replace("T", " ") : "—"}
                            </td>
                            <td className="px-3 py-2 font-medium">{s.group_name}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.course_title}</td>
                            <td className="px-3 py-2 text-muted-foreground">{s.room_name}</td>
                            <td className="px-2 py-2 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">{s.present_count}</td>
                            <td className="px-2 py-2 text-center font-mono font-bold text-destructive">{s.absent_count}</td>
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

              {/* Section 3: Teacher Payouts History */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <HandCoins className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>{t("reports.payouts_history", "سجل الدفعات والمستحقات المسددة للأستاذ")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {teacherReport.payouts.length} {t("menu.payments")}
                  </span>
                </div>

                {teacherReport.payouts.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">{t("reports.no_transactions", "لا توجد دفعات مسجلة")}</div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-xs min-w-[500px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("reports.date")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.payment_method")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.notes")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.amount")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {teacherReport.payouts.map((p) => (
                          <tr key={p.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2 font-mono text-muted-foreground">{p.payment_date || p.created_at?.slice(0, 10) || "—"}</td>
                            <td className="px-3 py-2 capitalize">{p.method || "cash"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{p.notes || "—"}</td>
                            <td className="px-3 py-2 text-end font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {money(p.amount)}
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
        </div>
      ) : null}

      {/* RENDER VIEW 3: DEFAULT GENERAL FINANCIAL REPORT (When neither student nor teacher is selected) */}
      {!selectedStudentId && !selectedTeacherId ? (
        <>
          <div className="surface-card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t("reports.from")}>
              <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} data-testid="reports-from" />
            </Field>
            <Field label={t("reports.to")}>
              <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} data-testid="reports-to" />
            </Field>
            <Field label={t("menu.groups")}>
              <Select
                value={filters.group_id || "__all"}
                onValueChange={(v) => setFilters({ ...filters, group_id: v === "__all" ? "" : v })}
              >
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="__all">{t("reports.all_groups")}</SelectItem>
                  {(groups?.items || []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>{groupOptionLabel(g, courseMap, t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("menu.teachers")}>
              <Select
                value={filters.teacher_id || "__all"}
                onValueChange={(v) => setFilters({ ...filters, teacher_id: v === "__all" ? "" : v })}
              >
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="__all">{t("reports.all_teachers")}</SelectItem>
                  {(teachers?.items || []).map((x) => (
                    <SelectItem key={x.id} value={x.id}>{x.first_name} {x.last_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
            <Card icon={Wallet} label={t("reports.collected")} value={money(finance?.collected)} />
            <Card icon={ShieldCheck} label={t("reports.insurances_entered")} value={money(finance?.insurances)} />
            <Card icon={Coins} label={t("reports.other_incomes")} value={money(finance?.other_income)} />
            <Card icon={Receipt} label={t("reports.expenses")} value={money(finance?.expenses)} />
            <Card icon={HandCoins} label={t("reports.teacher_earnings")} value={money(finance?.teacher_earnings)} />
            <Card icon={TrendingUp} label={t("reports.net")} value={money(finance?.net)} />
          </div>

          {finance?.expenses_scoped_out && (
            <p className="text-xs text-muted-foreground mb-6 -mt-3">{t("reports.expenses_scoped_out")}</p>
          )}

          <div className="surface-card p-4 sm:p-5 mb-6">
            <div className="flex items-center justify-between mb-4 gap-2">
              <h3 className="font-display font-semibold text-base sm:text-lg">{t("reports.transactions")}</h3>
              <span className="text-xs font-mono text-muted-foreground">
                {(finance?.transactions || []).length}
              </span>
            </div>
            {!finance?.transactions || finance.transactions.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("reports.no_transactions")}</div>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-border sticky top-0 bg-card">
                    <tr>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("reports.date")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("reports.description")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.kind")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.status")}</th>
                      <th className="text-end px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.transactions.map((tx, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{tx.date || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{tx.description}</div>
                          {tx.reference && <div className="text-[11px] font-mono text-muted-foreground">{tx.reference}</div>}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">
                          {tx.type === "expense" ? categoryLabel(tx.kind, t) : tx.type === "other_income" ? otherIncomeCategoryLabel(tx.kind, t) : tx.type === "insurance" ? t("menu.insurances") : t(`kind.${tx.kind}`)}
                        </td>
                        <td className="px-3 py-2">
                          {tx.status ? <StatusPill status={tx.status} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-end font-mono font-semibold ${tx.type === "expense" ? "text-destructive" : "text-success"}`}>
                          {tx.type === "expense" ? "−" : "+"}{money(tx.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {byCategory.length > 0 && (
            <div className="surface-card p-5 mb-6">
              <h3 className="font-display font-semibold text-lg mb-4">{t("reports.by_category")}</h3>
              <div className="space-y-2">
                {byCategory.sort((a, b) => b[1] - a[1]).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span>{categoryLabel(key, t)}</span>
                    <span className="font-mono">{money(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="surface-card p-5">
            <h3 className="font-display font-semibold text-lg mb-4">{t("reports.revenue_by_month")}</h3>
            <div className="h-72 min-h-[280px]">
              {data?.revenue_trend && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.revenue_trend}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="revenue" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="surface-card p-5 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-lg">{t("dashboard.at_risk")}</h3>
              <TriangleAlert className="w-4 h-4 text-warning" />
            </div>
            {(data?.at_risk_students || []).length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">{t("dashboard.no_at_risk")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("field.full_name")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.attendance_rate")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.overdue_amount")}</th>
                      <th className="text-start px-3 py-2 font-medium text-[10px] uppercase tracking-widest text-muted-foreground">{t("dashboard.reasons")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.at_risk_students.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 font-mono">
                          {s.attendance_rate !== null ? `${Math.round(s.attendance_rate * 100)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-destructive">
                          {s.overdue_amount > 0 ? money(s.overdue_amount) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {s.reasons?.join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* PDF Export Dialog */}
      <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle className="font-display">{t("reports.export_pdf_title")}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("reports.select_month_desc")}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="month"
            value={pdfMonth}
            onChange={(e) => setPdfMonth(e.target.value)}
            data-testid="reports-pdf-month"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setPdfDialogOpen(false)}>{t("actions.cancel")}</Button>
            <Button onClick={downloadPdf} disabled={pdfDownloading || !pdfMonth} data-testid="reports-pdf-download">
              {pdfDownloading ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : <FileDown className="w-4 h-4 me-2" />}
              {t("reports.download")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Card({ icon: Icon, label, value }) {
  return (
    <div className="surface-card p-5">
      <Icon className="w-4 h-4 text-muted-foreground mb-3" />
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
      <div className="font-mono text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
