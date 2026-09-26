import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Download, FileDown, TrendingUp, TrendingDown, Receipt, Wallet, TriangleAlert, HandCoins, Loader2, ShieldCheck, Coins,
  Search, ArrowLeft, Printer, UserRound, GraduationCap, X, CheckCircle2, Clock, CalendarDays, BookOpen, Layers, Phone, CalendarClock
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, downloadFrom, extractError, openFinanceReportPdf, resolveFileUrl } from "@/lib/api";
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

export function formatStudentGrade(s, t) {
  if (!s) return "";
  const parts = [];
  if (s.school_level) {
    const lvlKey = `school_level.${s.school_level}`;
    parts.push(typeof t === "function" ? t(lvlKey) : s.school_level);
  }
  if (s.school_year) {
    parts.push(typeof t === "function" ? t("common.year_n", { n: s.school_year }) : `السنة ${s.school_year}`);
  }
  if (s.specialty) {
    const spKey = `specialty.${s.specialty}`;
    parts.push(typeof t === "function" ? t(spKey) : s.specialty);
  }
  return parts.join(" · ");
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrintDate(d) {
  if (!d) return "—";
  try {
    return String(d).slice(0, 16).replace("T", " ");
  } catch {
    return String(d);
  }
}

function getSharedDossierStyles(isRtl) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap');
    @page {
      size: A4 portrait;
      margin: 12mm 14mm 12mm 14mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: 'Cairo', 'IBM Plex Sans Arabic', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.45;
      direction: ${isRtl ? "rtl" : "ltr"};
    }
    .report-wrap {
      max-width: 100%;
      margin: 0 auto;
    }
    .school-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 2px solid #0f172a;
      margin-bottom: 12px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .school-logo {
      width: 58px;
      height: 58px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
    }
    .school-logo-fallback {
      width: 54px;
      height: 54px;
      border-radius: 8px;
      background: #0f172a;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 800;
    }
    .school-info h1 {
      margin: 0 0 2px 0;
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }
    .school-info p {
      margin: 0;
      font-size: 9.5px;
      color: #64748b;
    }
    .header-meta {
      text-align: ${isRtl ? "left" : "right"};
    }
    .doc-badge {
      display: inline-block;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 9.5px;
      color: #0f172a;
      margin-bottom: 3px;
      font-family: monospace, sans-serif;
    }
    .doc-date {
      font-size: 9.5px;
      color: #64748b;
      font-family: monospace, sans-serif;
    }
    .title-banner {
      text-align: center;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 12px;
    }
    .title-banner h2 {
      margin: 0;
      font-size: 14.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .title-banner p {
      margin: 2px 0 0 0;
      font-size: 9px;
      color: #64748b;
    }
    .profile-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 9px 12px;
      margin-bottom: 12px;
    }
    .profile-name {
      font-size: 13.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .profile-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      margin-top: 3px;
    }
    .chip {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 700;
      border: 1px solid transparent;
    }
    .chip-emerald { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
    .chip-blue { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
    .chip-amber { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    .chip-muted { background: #f1f5f9; color: #334155; border-color: #cbd5e1; }
    .profile-contact {
      text-align: ${isRtl ? "left" : "right"};
      font-size: 9.5px;
      color: #475569;
      line-height: 1.5;
    }
    .profile-contact strong {
      font-family: monospace, sans-serif;
      color: #0f172a;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .kpi-item {
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      border-radius: 6px;
      padding: 7px;
      text-align: center;
    }
    .kpi-title {
      font-size: 8.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
    }
    .kpi-val {
      font-size: 13.5px;
      font-weight: 800;
      font-family: monospace, sans-serif;
      margin-top: 2px;
    }
    .text-emerald { color: #059669; }
    .text-amber { color: #d97706; }
    .text-blue { color: #2563eb; }
    .text-destructive { color: #e11d48; }
    .section-block {
      margin-bottom: 12px;
      page-break-inside: auto;
    }
    .section-head {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      margin: 0 0 5px 0;
      padding-bottom: 3px;
      border-bottom: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-count {
      font-size: 9px;
      color: #64748b;
      font-family: monospace, sans-serif;
      font-weight: 600;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
    }
    .report-table th {
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 700;
      padding: 5px 6px;
      border: 1px solid #cbd5e1;
      text-align: ${isRtl ? "right" : "left"};
    }
    .report-table th.text-center, .report-table td.text-center { text-align: center; }
    .report-table th.text-end, .report-table td.text-end { text-align: ${isRtl ? "left" : "right"}; }
    .report-table td {
      padding: 5px 6px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .report-table tr:nth-child(even) td {
      background: #fbfcfe;
    }
    .report-table tr {
      page-break-inside: avoid;
    }
    .badge-present { background: #dcfce7; color: #15803d; padding: 2px 4px; border-radius: 3px; font-weight: 700; font-size: 8.5px; }
    .badge-absent { background: #fee2e2; color: #b91c1c; padding: 2px 4px; border-radius: 3px; font-weight: 700; font-size: 8.5px; }
    .badge-late { background: #fef3c7; color: #b45309; padding: 2px 4px; border-radius: 3px; font-weight: 700; font-size: 8.5px; }
    .badge-excused { background: #e0e7ff; color: #3730a3; padding: 2px 4px; border-radius: 3px; font-weight: 700; font-size: 8.5px; }
    .signatures-row {
      margin-top: 18px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      page-break-inside: avoid;
    }
    .sig-card {
      border: 1px dashed #94a3b8;
      border-radius: 6px;
      padding: 9px;
      min-height: 75px;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .sig-label {
      font-size: 10px;
      font-weight: 700;
      color: #1e293b;
    }
    .sig-sub {
      font-size: 8.5px;
      color: #94a3b8;
    }
    .footer-notice {
      margin-top: 12px;
      border-top: 1px solid #f1f5f9;
      padding-top: 5px;
      text-align: center;
      font-size: 8px;
      color: #94a3b8;
    }
  `;
}

function generateStudentDossierHtml({ studentReport, tenant, user, currency, t, dir }) {
  const isRtl = dir === "rtl";
  const s = studentReport.student || {};
  const f = studentReport.financial_summary || {};
  const courses = studentReport.courses || [];
  const invoices = studentReport.invoices || [];
  const sessions = studentReport.sessions_history || [];

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const refCode = `STU-${s.code || s.student_code || (s.id ? s.id.slice(0, 8).toUpperCase() : "DOC")}`;

  const schoolName = tenant?.name || "Scolaris Academy";
  const schoolLogo = tenant?.logo_url ? resolveFileUrl(tenant.logo_url) : null;
  const schoolPhone = tenant?.phone || "";
  const schoolAddress = tenant?.address || "";
  const gradeStr = formatStudentGrade(s, t);

  const balanceNum = Number(f.balance || 0);
  let balanceHtml = `<span class="kpi-val font-mono">${balanceNum.toLocaleString()} ${currency}</span>`;
  if (f.balance_status === "owes") {
    balanceHtml = `<span class="kpi-val font-mono text-destructive">${balanceNum.toLocaleString()} ${currency}</span><div style="font-size: 8.5px; color: #e11d48; font-weight: 700;">${escapeHtml(t("debts.owes", "مستحق عليه"))}</div>`;
  } else if (f.balance_status === "overpaid") {
    balanceHtml = `<span class="kpi-val font-mono text-emerald">+${balanceNum.toLocaleString()} ${currency}</span><div style="font-size: 8.5px; color: #059669; font-weight: 700;">${escapeHtml(t("debts.overpaid", "رصيد دائن"))}</div>`;
  } else {
    balanceHtml = `<span class="kpi-val font-mono">${balanceNum.toLocaleString()} ${currency}</span><div style="font-size: 8.5px; color: #64748b; font-weight: 600;">${escapeHtml(t("debts.settled", "حساب خالص"))}</div>`;
  }

  const coursesRows = courses.length === 0
    ? `<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("payments.no_courses", "لا توجد دورات مسجلة"))}</td></tr>`
    : courses.map(c => `
      <tr>
        <td><strong>${escapeHtml(c.course_title)}</strong><div style="font-size: 8.5px; color: #64748b;">${escapeHtml(c.group_name)}</div></td>
        <td style="color: #475569;">${escapeHtml(c.teacher_name || "—")}</td>
        <td class="text-end font-mono">${Number(c.cost_per_session || 0).toLocaleString()} ${currency}</td>
        <td class="text-center font-mono"><strong>${c.sessions_covered || 0}</strong></td>
        <td class="text-center font-mono text-emerald"><strong>${c.sessions_attended || 0}</strong></td>
        <td class="text-center font-mono text-destructive"><strong>${c.sessions_absent || 0}</strong></td>
        <td class="text-center font-mono text-blue"><strong>${c.sessions_remaining || 0}</strong></td>
        <td class="text-end font-mono" style="font-weight: 700; color: #7c3aed;">${Number(c.credit_remaining || 0).toLocaleString()} ${currency}</td>
      </tr>
    `).join("");

  const invoicesRows = invoices.length === 0
    ? `<tr><td colspan="7" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("reports.no_transactions", "لا توجد وصولات مسجلة"))}</td></tr>`
    : invoices.map(inv => {
      const itemsText = inv.items && inv.items.length > 0
        ? inv.items.map(it => `${escapeHtml(it.title)} (${Number(it.net_amount).toLocaleString()} ${currency})`).join(" · ")
        : escapeHtml(inv.notes || "—");
      let statusBadge = `<span class="chip chip-muted">${escapeHtml(inv.status || "—")}</span>`;
      if (inv.status === "paid") statusBadge = `<span class="badge-present">${escapeHtml(t("status.paid", "مدفوع"))}</span>`;
      else if (inv.status === "partial") statusBadge = `<span class="badge-late">${escapeHtml(t("status.partial", "جزئي"))}</span>`;
      else if (inv.status === "pending") statusBadge = `<span class="badge-absent">${escapeHtml(t("status.pending", "معلق"))}</span>`;

      return `
        <tr>
          <td class="font-mono"><strong>${escapeHtml(inv.invoice_number || inv.id?.slice(0, 8))}</strong></td>
          <td class="font-mono" style="color: #64748b;">${formatPrintDate(inv.paid_at || inv.created_at)}</td>
          <td>${itemsText}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center" style="text-transform: capitalize; color: #475569;">${escapeHtml(inv.method || "cash")}</td>
          <td class="text-end font-mono text-emerald" style="font-weight: 700;">${Number(inv.paid_amount || 0).toLocaleString()} ${currency}</td>
          <td class="text-end font-mono" style="color: ${inv.pending_amount > 0 ? '#d97706' : '#94a3b8'}; font-weight: ${inv.pending_amount > 0 ? '700' : 'normal'};">
            ${inv.pending_amount > 0 ? `${Number(inv.pending_amount).toLocaleString()} ${currency}` : "—"}
          </td>
        </tr>
      `;
    }).join("");

  const sessionsRows = sessions.length === 0
    ? `<tr><td colspan="5" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("attendance.no_records", "لا توجد سجلات حضور مسجلة"))}</td></tr>`
    : sessions.slice(0, 35).map(sn => {
      let stBadge = `<span class="chip chip-muted">${escapeHtml(sn.status || "—")}</span>`;
      if (sn.status === "present") stBadge = `<span class="badge-present">${escapeHtml(t("attendance.present", "حاضر"))}</span>`;
      else if (sn.status === "absent") stBadge = `<span class="badge-absent">${escapeHtml(t("attendance.absent", "غائب"))}</span>`;
      else if (sn.status === "late") stBadge = `<span class="badge-late">${escapeHtml(t("attendance.late", "متأخر"))}</span>`;
      else if (sn.status === "excused") stBadge = `<span class="badge-excused">${escapeHtml(t("attendance.excused", "مبرر"))}</span>`;

      return `
        <tr>
          <td class="font-mono" style="color: #64748b;">${formatPrintDate(sn.date)}</td>
          <td><strong>${escapeHtml(sn.course_title)}</strong></td>
          <td style="color: #475569;">${escapeHtml(sn.group_name)}</td>
          <td style="color: #475569;">${escapeHtml(sn.teacher_name || "—")}</td>
          <td class="text-end">${stBadge}</td>
        </tr>
      `;
    }).join("");

  return `<!DOCTYPE html>
<html dir="${isRtl ? "rtl" : "ltr"}" lang="${isRtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(s.name)} - ${escapeHtml(t("reports.student_all_time_report", "تقرير التلميذ الشامل"))}</title>
  <style>
    ${getSharedDossierStyles(isRtl)}
  </style>
</head>
<body>
  <div class="report-wrap">
    <!-- School Header -->
    <header class="school-header">
      <div class="header-brand">
        ${schoolLogo
          ? `<img src="${schoolLogo}" alt="Logo" class="school-logo" />`
          : `<div class="school-logo-fallback">${escapeHtml(schoolName[0]?.toUpperCase() || "S")}</div>`
        }
        <div class="school-info">
          <h1>${escapeHtml(schoolName)}</h1>
          ${schoolAddress ? `<p>${escapeHtml(schoolAddress)}</p>` : ""}
          ${schoolPhone ? `<p>${escapeHtml(t("field.phone", "الهاتف"))}: ${escapeHtml(schoolPhone)}</p>` : ""}
        </div>
      </div>
      <div class="header-meta">
        <div class="doc-badge">${escapeHtml(refCode)}</div>
        <div class="doc-date">${escapeHtml(t("reports.date", "تاريخ الإصدار"))}: ${dateStr}</div>
      </div>
    </header>

    <!-- Document Title -->
    <div class="title-banner">
      <h2>${escapeHtml(t("reports.student_dossier_title", "كشف الحساب والمسار الدراسي الشامل للتلميذ"))}</h2>
      <p>${escapeHtml(t("reports.student_dossier_subtitle", "وثيقة إدارية ومالية رسمية تشمل كافة العمليات والحصص منذ التسجيل"))}</p>
    </div>

    <!-- Student Profile -->
    <div class="profile-card">
      <div>
        <div class="profile-name">${escapeHtml(s.name)}</div>
        <div class="profile-chips">
          <span class="chip chip-emerald">${escapeHtml(t("menu.students", "تلميذ"))}</span>
          ${s.code ? `<span class="chip chip-muted font-mono">#${escapeHtml(s.code)}</span>` : ""}
          ${gradeStr ? `<span class="chip chip-amber">${escapeHtml(gradeStr)}</span>` : ""}
          ${s.status ? `<span class="chip chip-muted">${escapeHtml(t(`status.${s.status}`, s.status))}</span>` : ""}
        </div>
      </div>
      <div class="profile-contact">
        ${s.phone ? `<div>${escapeHtml(t("field.phone", "الهاتف"))}: <strong>${escapeHtml(s.phone)}</strong></div>` : ""}
        ${s.parent_phone ? `<div>${escapeHtml(t("field.parent_phone", "ولي الأمر"))}: <strong>${escapeHtml(s.parent_phone)}</strong></div>` : ""}
      </div>
    </div>

    <!-- Financial KPIs -->
    <div class="kpi-grid">
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("payments.total_paid", "إجمالي المدفوعات"))}</div>
        <div class="kpi-val text-emerald">${Number(f.total_paid || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("debts.total_debt", "مجموع الديون المتبقية"))}</div>
        <div class="kpi-val text-amber">${Number(f.total_debt || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("payments.total_cost", "التكلفة الإجمالية"))}</div>
        <div class="kpi-val">${Number(f.total_cost || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("payments.balance_label", "الرصيد المتبقي"))}</div>
        ${balanceHtml}
      </div>
    </div>

    <!-- Section 1: Courses & Deductions -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("payments.enrolled_courses", "الدورات المسجلة والحصص المقتطعة"))}</span>
        <span class="section-count">${courses.length} ${escapeHtml(t("menu.courses", "دورات"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("field.course_title", "الدورة والفوج"))}</th>
            <th>${escapeHtml(t("field.teacher", "الأستاذ"))}</th>
            <th class="text-end">${escapeHtml(t("field.pricing", "سعر الحصة"))}</th>
            <th class="text-center">${escapeHtml(t("payments.sessions_covered", "مدفوعة"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.present", "حاضر"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.absent", "غائب"))}</th>
            <th class="text-center">${escapeHtml(t("payments.sessions_remaining", "متبقية"))}</th>
            <th class="text-end">${escapeHtml(t("payments.credit_remaining", "الرصيد المتبقي"))}</th>
          </tr>
        </thead>
        <tbody>
          ${coursesRows}
        </tbody>
      </table>
    </div>

    <!-- Section 2: Invoices & Receipts -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("reports.payments_history", "سجل الوصولات والمدفوعات"))}</span>
        <span class="section-count">${invoices.length} ${escapeHtml(t("menu.payments", "عمليات"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("payments.invoice_number", "رقم الوصل"))}</th>
            <th>${escapeHtml(t("reports.date", "التاريخ"))}</th>
            <th>${escapeHtml(t("payments.items_label", "البيان / المواد"))}</th>
            <th class="text-center">${escapeHtml(t("field.status", "الحالة"))}</th>
            <th class="text-center">${escapeHtml(t("field.payment_method", "طريقة الدفع"))}</th>
            <th class="text-end">${escapeHtml(t("payments.paid_now", "المدفوع"))}</th>
            <th class="text-end">${escapeHtml(t("payments.pending_debt", "المتبقي"))}</th>
          </tr>
        </thead>
        <tbody>
          ${invoicesRows}
        </tbody>
      </table>
    </div>

    <!-- Section 3: Attendance History -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("attendance.history", "سجل حضور الحصص"))}</span>
        <span class="section-count">${sessions.length} ${escapeHtml(t("menu.sessions", "حصص"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("reports.date", "التاريخ"))}</th>
            <th>${escapeHtml(t("field.course_title", "الدورة"))}</th>
            <th>${escapeHtml(t("field.group", "الفوج"))}</th>
            <th>${escapeHtml(t("field.teacher", "الأستاذ"))}</th>
            <th class="text-end">${escapeHtml(t("field.status", "الحالة"))}</th>
          </tr>
        </thead>
        <tbody>
          ${sessionsRows}
        </tbody>
      </table>
    </div>

    <!-- Signatures & Stamp -->
    <div class="signatures-row">
      <div class="sig-card">
        <div class="sig-label">${escapeHtml(t("reports.guardian_signature", "توقيع ولي الأمر / المعني"))}</div>
        <div class="sig-sub">${escapeHtml(t("reports.signature_mention", "قرئ وصودق عليه"))}</div>
      </div>
      <div class="sig-card">
        <div class="sig-label">${escapeHtml(t("reports.admin_stamp", "توقيع وختم إدارة المؤسسة"))}</div>
        <div class="sig-sub">${escapeHtml(schoolName)}</div>
      </div>
    </div>

    <!-- Footer Notice -->
    <div class="footer-notice">
      ${escapeHtml(t("reports.official_notice", "وثيقة رسمية صادرة آلياً عن نظام إدارة المدرسة Scolaris — يرجى الاحتفاظ بها كإثبات رسمي"))}
    </div>
  </div>

  <script>
    window.addEventListener('afterprint', () => {
      window.close();
    });
  </script>
</body>
</html>`;
}

function generateTeacherDossierHtml({ teacherReport, tenant, user, currency, t, dir }) {
  const isRtl = dir === "rtl";
  const tch = teacherReport.teacher || {};
  const f = teacherReport.financial_summary || {};
  const groups = teacherReport.groups || [];
  const sessions = teacherReport.sessions || [];
  const payouts = teacherReport.payouts || [];

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const refCode = `TCH-${tch.id ? tch.id.slice(0, 8).toUpperCase() : "DOC"}`;

  const schoolName = tenant?.name || "Scolaris Academy";
  const schoolLogo = tenant?.logo_url ? resolveFileUrl(tenant.logo_url) : null;
  const schoolPhone = tenant?.phone || "";
  const schoolAddress = tenant?.address || "";

  const balanceDue = Number(f.balance_due || 0);

  const groupsRows = groups.length === 0
    ? `<tr><td colspan="5" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("common.no_data", "لا توجد أفواج مسندة"))}</td></tr>`
    : groups.map(g => `
      <tr>
        <td><strong>${escapeHtml(g.name)}</strong></td>
        <td style="color: #475569;">${escapeHtml(g.course_title)}</td>
        <td class="text-center font-mono">${g.students_count || 0}</td>
        <td class="text-center font-mono">${g.sessions_count || 0}</td>
        <td class="text-end"><span class="chip chip-muted">${escapeHtml(t(`status.${g.status}`, g.status || "active"))}</span></td>
      </tr>
    `).join("");

  const sessionsRows = sessions.length === 0
    ? `<tr><td colspan="7" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("attendance.no_records", "لا توجد حصص مسجلة"))}</td></tr>`
    : sessions.slice(0, 40).map(sn => `
      <tr>
        <td class="font-mono" style="color: #64748b;">${formatPrintDate(sn.start_at)}</td>
        <td><strong>${escapeHtml(sn.group_name)}</strong></td>
        <td style="color: #475569;">${escapeHtml(sn.course_title)}</td>
        <td style="color: #475569;">${escapeHtml(sn.room_name || "—")}</td>
        <td class="text-center font-mono text-emerald"><strong>${sn.present_count || 0}</strong></td>
        <td class="text-center font-mono text-destructive"><strong>${sn.absent_count || 0}</strong></td>
        <td class="text-end"><span class="chip chip-muted">${escapeHtml(t(`status.${sn.status}`, sn.status || "conducted"))}</span></td>
      </tr>
    `).join("");

  const payoutsRows = payouts.length === 0
    ? `<tr><td colspan="4" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("reports.no_transactions", "لا توجد دفعات مسجلة"))}</td></tr>`
    : payouts.map(p => `
      <tr>
        <td class="font-mono" style="color: #64748b;">${formatPrintDate(p.payment_date || p.created_at)}</td>
        <td style="text-transform: capitalize; color: #475569;">${escapeHtml(p.method || "cash")}</td>
        <td style="color: #475569;">${escapeHtml(p.notes || "—")}</td>
        <td class="text-end font-mono text-emerald" style="font-weight: 700;">${Number(p.amount || 0).toLocaleString()} ${currency}</td>
      </tr>
    `).join("");

  return `<!DOCTYPE html>
<html dir="${isRtl ? "rtl" : "ltr"}" lang="${isRtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(tch.name)} - ${escapeHtml(t("reports.teacher_all_time_report", "تقرير الأستاذ الشامل"))}</title>
  <style>
    ${getSharedDossierStyles(isRtl)}
  </style>
</head>
<body>
  <div class="report-wrap">
    <!-- School Header -->
    <header class="school-header">
      <div class="header-brand">
        ${schoolLogo
          ? `<img src="${schoolLogo}" alt="Logo" class="school-logo" />`
          : `<div class="school-logo-fallback">${escapeHtml(schoolName[0]?.toUpperCase() || "S")}</div>`
        }
        <div class="school-info">
          <h1>${escapeHtml(schoolName)}</h1>
          ${schoolAddress ? `<p>${escapeHtml(schoolAddress)}</p>` : ""}
          ${schoolPhone ? `<p>${escapeHtml(t("field.phone", "الهاتف"))}: ${escapeHtml(schoolPhone)}</p>` : ""}
        </div>
      </div>
      <div class="header-meta">
        <div class="doc-badge">${escapeHtml(refCode)}</div>
        <div class="doc-date">${escapeHtml(t("reports.date", "تاريخ الإصدار"))}: ${dateStr}</div>
      </div>
    </header>

    <!-- Document Title -->
    <div class="title-banner">
      <h2>${escapeHtml(t("reports.teacher_dossier_title", "كشف المستحقات والنشاط التعليمي للأستاذ"))}</h2>
      <p>${escapeHtml(t("reports.teacher_dossier_subtitle", "بيان إداري ومالي شامل للحصص والأفواج والمستحقات المسددة والمتبقية"))}</p>
    </div>

    <!-- Teacher Profile -->
    <div class="profile-card">
      <div>
        <div class="profile-name">${escapeHtml(tch.name)}</div>
        <div class="profile-chips">
          <span class="chip chip-blue">${escapeHtml(t("menu.teachers", "أستاذ"))}</span>
          ${tch.subject ? `<span class="chip chip-muted">${escapeHtml(tch.subject)}</span>` : ""}
          <span class="chip chip-emerald">${escapeHtml(t("field.percentage", "النسبة"))}: ${tch.payment_percentage || 0}%</span>
          ${tch.status ? `<span class="chip chip-muted">${escapeHtml(t(`status.${tch.status}`, tch.status))}</span>` : ""}
        </div>
      </div>
      <div class="profile-contact">
        ${tch.phone ? `<div>${escapeHtml(t("field.phone", "الهاتف"))}: <strong>${escapeHtml(tch.phone)}</strong></div>` : ""}
      </div>
    </div>

    <!-- Financial KPIs -->
    <div class="kpi-grid">
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("reports.revenue_generated", "مداخيل الحصص الإجمالية"))}</div>
        <div class="kpi-val">${Number(f.total_revenue_generated || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("reports.teacher_earned", "مستحقات الأستاذ المحتسبة"))}</div>
        <div class="kpi-val text-blue">${Number(f.total_earned || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("reports.total_paid_out", "الدفعات المستلمة"))}</div>
        <div class="kpi-val text-emerald">${Number(f.total_paid_out || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("reports.balance_due", "المتبقي للأستاذ"))}</div>
        <div class="kpi-val ${balanceDue > 0 ? "text-amber" : "text-emerald"}">${balanceDue.toLocaleString()} ${currency}</div>
      </div>
    </div>

    <!-- Section 1: Groups Taught -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("menu.groups", "الأفواج والدورات المسندة للأستاذ"))}</span>
        <span class="section-count">${groups.length} ${escapeHtml(t("menu.groups", "أفواج"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("field.group_name", "اسم الفوج"))}</th>
            <th>${escapeHtml(t("field.course_title", "الدورة"))}</th>
            <th class="text-center">${escapeHtml(t("menu.students", "عدد التلاميذ"))}</th>
            <th class="text-center">${escapeHtml(t("menu.sessions", "الحصص المقدمة"))}</th>
            <th class="text-end">${escapeHtml(t("field.status", "الحالة"))}</th>
          </tr>
        </thead>
        <tbody>
          ${groupsRows}
        </tbody>
      </table>
    </div>

    <!-- Section 2: Conducted Sessions -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("reports.conducted_sessions", "سجل الحصص المقدمة"))}</span>
        <span class="section-count">${sessions.length} ${escapeHtml(t("menu.sessions", "حصص"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("reports.date", "التاريخ"))}</th>
            <th>${escapeHtml(t("field.group", "الفوج"))}</th>
            <th>${escapeHtml(t("field.course_title", "الدورة"))}</th>
            <th>${escapeHtml(t("field.room", "القاعة"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.present", "حاضر"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.absent", "غائب"))}</th>
            <th class="text-end">${escapeHtml(t("field.status", "الحالة"))}</th>
          </tr>
        </thead>
        <tbody>
          ${sessionsRows}
        </tbody>
      </table>
    </div>

    <!-- Section 3: Payouts History -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("reports.payouts_history", "سجل الدفعات والمستحقات المسددة"))}</span>
        <span class="section-count">${payouts.length} ${escapeHtml(t("menu.payments", "دفعات"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("reports.date", "التاريخ"))}</th>
            <th>${escapeHtml(t("field.payment_method", "طريقة الدفع"))}</th>
            <th>${escapeHtml(t("field.notes", "ملاحظات"))}</th>
            <th class="text-end">${escapeHtml(t("field.amount", "المبلغ المستلم"))}</th>
          </tr>
        </thead>
        <tbody>
          ${payoutsRows}
        </tbody>
      </table>
    </div>

    <!-- Signatures & Stamp -->
    <div class="signatures-row">
      <div class="sig-card">
        <div class="sig-label">${escapeHtml(t("reports.teacher_signature", "توقيع واستلام الأستاذ(ة)"))}</div>
        <div class="sig-sub">${escapeHtml(t("reports.signature_mention", "قرئ وصودق عليه"))}</div>
      </div>
      <div class="sig-card">
        <div class="sig-label">${escapeHtml(t("reports.admin_stamp", "توقيع وختم إدارة المؤسسة"))}</div>
        <div class="sig-sub">${escapeHtml(schoolName)}</div>
      </div>
    </div>

    <!-- Footer Notice -->
    <div class="footer-notice">
      ${escapeHtml(t("reports.official_notice", "وثيقة رسمية صادرة آلياً عن نظام إدارة المدرسة Scolaris — يرجى الاحتفاظ بها كإثبات رسمي"))}
    </div>
  </div>

  <script>
    window.addEventListener('afterprint', () => {
      window.close();
    });
  </script>
</body>
</html>`;
}

function openPrintDossier(htmlContent, title) {
  try {
    let iframe = document.getElementById("print-dossier-iframe");
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "print-dossier-iframe";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);
    }
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        console.warn("Iframe print failed, falling back to window.open", err);
        const printWin = window.open("", "_blank");
        if (printWin) {
          printWin.document.open();
          printWin.document.write(htmlContent);
          printWin.document.close();
          setTimeout(() => {
            printWin.focus();
            printWin.print();
          }, 350);
        } else {
          window.print();
        }
      }
    }, 350);
  } catch (e) {
    console.error("Print error:", e);
    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(htmlContent);
      printWin.document.close();
      setTimeout(() => {
        printWin.focus();
        printWin.print();
      }, 350);
    } else {
      window.print();
    }
  }
}

export default function ReportsPage() {
  const { t, dir } = useI18n();
  const { tenant, user } = useAuth();
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

  // Query students from standard /students endpoint
  const { data: studentsResponse, isFetching: studentsLoading } = useQuery({
    queryKey: ["reports-students-search", searchQuery],
    queryFn: async () => {
      try {
        const res = await api.get("/students", {
          params: { q: searchQuery.trim(), limit: 40 }
        });
        return res.data?.items || [];
      } catch (e) {
        return [];
      }
    },
    enabled: isSearchFocused || Boolean(searchQuery.trim().length > 0),
  });

  const summonedStudents = useMemo(() => {
    return (studentsResponse || []).map((s) => ({
      id: s.id,
      name: `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.name || s.student_code,
      first_name: s.first_name,
      last_name: s.last_name,
      first_name_latin: s.first_name_latin,
      last_name_latin: s.last_name_latin,
      code: s.student_code,
      phone: s.phone,
      school_level: s.school_level,
      school_year: s.school_year,
      specialty: s.specialty,
      status: s.status,
    }));
  }, [studentsResponse]);

  const summonedTeachers = useMemo(() => {
    const raw = teachers?.items || (Array.isArray(teachers) ? teachers : []);
    if (!searchQuery.trim()) {
      return raw.slice(0, 30).map((t) => ({
        id: t.id,
        name: `${t.first_name || ""} ${t.last_name || ""}`.trim() || t.name,
        subject: t.subject,
        phone: t.phone,
        status: t.status,
      }));
    }
    const q = searchQuery.toLowerCase().trim();
    return raw
      .filter((t) => {
        const name = `${t.first_name || ""} ${t.last_name || ""}`.toLowerCase();
        const subject = (t.subject || "").toLowerCase();
        const phone = (t.phone || "").toLowerCase();
        return name.includes(q) || subject.includes(q) || phone.includes(q);
      })
      .slice(0, 30)
      .map((t) => ({
        id: t.id,
        name: `${t.first_name || ""} ${t.last_name || ""}`.trim() || t.name,
        subject: t.subject,
        phone: t.phone,
        status: t.status,
      }));
  }, [teachers, searchQuery]);

  const searchLoading = studentsLoading;

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

  const handlePrintReport = () => {
    try {
      if (selectedStudentId && studentReport) {
        const html = generateStudentDossierHtml({
          studentReport,
          tenant,
          user,
          currency,
          t,
          dir,
        });
        openPrintDossier(html, `Student-Report-${studentReport.student?.name || selectedStudentId}`);
      } else if (selectedTeacherId && teacherReport) {
        const html = generateTeacherDossierHtml({
          teacherReport,
          tenant,
          user,
          currency,
          t,
          dir,
        });
        openPrintDossier(html, `Teacher-Report-${teacherReport.teacher?.name || selectedTeacherId}`);
      } else {
        window.print();
      }
    } catch (e) {
      console.error("Print error:", e);
      window.print();
    }
  };

  return (
    <div>
      <PageHeader
        title={t("menu.reports")}
        subtitle={t("reports.subtitle")}
        actions={
          <div className="flex items-center gap-2 no-print">
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
              <Button variant="outline" onClick={handlePrintReport} data-testid="reports-print-btn">
                <Printer className="w-4 h-4 me-2" /> {t("actions.print", "طباعة التقرير")}
              </Button>
            )}
          </div>
        }
      />

      {/* Global Student & Teacher Search Bar */}
      <div ref={searchContainerRef} className="surface-card p-3 mb-6 relative z-30 no-print">
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
                  if (summonedStudents.length > 0) {
                    handleSelectStudent(summonedStudents[0].id);
                  } else if (summonedTeachers.length > 0) {
                    handleSelectTeacher(summonedTeachers[0].id);
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
        {isSearchFocused && (
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
                  <div className="px-3.5 py-2 bg-muted/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      {t("menu.students", "التلاميذ")}
                    </span>
                    <span className="font-mono bg-background/80 px-1.5 py-0.2 rounded border border-border/50">
                      {summonedStudents.length}
                    </span>
                  </div>
                  {summonedStudents.length === 0 ? (
                    <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
                      {searchQuery ? t("common.no_results", "لا توجد نتائج مطابقة") : t("reports.no_students_found", "لا يوجد تلاميذ")}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      {summonedStudents.map((s) => {
                        const gradeText = formatStudentGrade(s, t);
                        return (
                          <div
                            key={s.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectStudent(s.id);
                            }}
                            className="px-3.5 py-2.5 hover:bg-muted/50 cursor-pointer flex items-center justify-between gap-3 transition-colors border-b border-border/40 last:border-0"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
                                <span>{s.name}</span>
                                {(s.first_name_latin || s.last_name_latin) && (
                                  <span className="text-[11px] text-muted-foreground font-normal">
                                    ({[s.first_name_latin, s.last_name_latin].filter(Boolean).join(" ")})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap">
                                {gradeText && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25">
                                    <GraduationCap className="w-3 h-3 flex-shrink-0" />
                                    {gradeText}
                                  </span>
                                )}
                                {s.code && (
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    #{s.code}
                                  </span>
                                )}
                                {s.phone && (
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    {s.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline" className="text-[11px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 flex-shrink-0 px-2.5 py-0.5">
                              <GraduationCap className="w-3.5 h-3.5 me-1" />
                              {t("menu.students", "تلميذ")}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Teachers Section */}
                <div>
                  <div className="px-3.5 py-2 bg-muted/60 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <UserRound className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      {t("menu.teachers", "الأساتذة")}
                    </span>
                    <span className="font-mono bg-background/80 px-1.5 py-0.2 rounded border border-border/50">
                      {summonedTeachers.length}
                    </span>
                  </div>
                  {summonedTeachers.length === 0 ? (
                    <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
                      {searchQuery ? t("common.no_results", "لا توجد نتائج مطابقة") : t("reports.no_teachers_found", "لا يوجد أساتذة")}
                    </div>
                  ) : (
                    <div className="max-h-56 overflow-y-auto">
                      {summonedTeachers.map((tch) => (
                        <div
                          key={tch.id}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            handleSelectTeacher(tch.id);
                          }}
                          className="px-3.5 py-2.5 hover:bg-muted/50 cursor-pointer flex items-center justify-between gap-3 transition-colors border-b border-border/40 last:border-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-foreground">
                              {tch.name}
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {tch.subject && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 dark:text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/25">
                                  <BookOpen className="w-3 h-3 flex-shrink-0" />
                                  {tch.subject}
                                </span>
                              )}
                              {tch.phone && (
                                <span className="text-[11px] text-muted-foreground font-mono">
                                  {tch.phone}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-[11px] font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 flex-shrink-0 px-2.5 py-0.5">
                            <UserRound className="w-3.5 h-3.5 me-1" />
                            {t("menu.teachers", "أستاذ")}
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
          <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20 no-print">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-xl text-foreground">{studentReport.student.name}</h3>
                      <Badge variant="outline" className="text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                        <GraduationCap className="w-3.5 h-3.5 me-1" />
                        {t("menu.students", "تلميذ")}
                      </Badge>
                      <StatusPill status={studentReport.student.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                      {studentReport.student.code && (
                        <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">#{studentReport.student.code}</span>
                      )}
                      {formatStudentGrade(studentReport.student, t) && (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25">
                          <GraduationCap className="w-3.5 h-3.5 flex-shrink-0" />
                          {formatStudentGrade(studentReport.student, t)}
                        </span>
                      )}
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
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 no-print">
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-xl text-foreground">{teacherReport.teacher.name}</h3>
                      <Badge variant="outline" className="text-xs font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30">
                        <UserRound className="w-3.5 h-3.5 me-1" />
                        {t("menu.teachers", "أستاذ")}
                      </Badge>
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
