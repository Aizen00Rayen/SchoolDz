import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Archive, Folder, ChevronRight, BookOpen, Users, CalendarClock, Coins, HandCoins,
  TrendingUp, RotateCcw, ArrowLeft, Search, CheckCircle2, XCircle, AlertCircle, Clock,
  FileText, ShieldCheck, DoorOpen, Printer, GraduationCap, Phone, Wallet
} from "lucide-react";
import { api, extractError, resolveFileUrl } from "@/lib/api";
import { PageHeader, StatusPill } from "./_shared";
import { formatStudentGrade } from "./ReportsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/lib/confirm";
import { usePermission } from "@/lib/permissions";

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

function getSharedArchiveStyles(isRtl) {
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
    .text-purple { color: #7c3aed; }
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

function generateCourseDossierHtml({ courseDossier, selectedYear, tenant, user, currency, t, dir }) {
  const isRtl = dir === "rtl";
  const c = courseDossier.course || {};
  const teachers = courseDossier.teachers || [];
  const students = courseDossier.students || [];
  const sessions = courseDossier.sessions || [];
  const groups = courseDossier.groups || [];

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const refCode = `ARC-${selectedYear || 2026}-${c.id ? c.id.slice(0, 8).toUpperCase() : "CRS"}`;

  const schoolName = tenant?.name || "Scolaris Academy";
  const schoolLogo = tenant?.logo_url ? resolveFileUrl(tenant.logo_url) : null;
  const schoolPhone = tenant?.phone || "";
  const schoolAddress = tenant?.address || "";

  const teachersRows = teachers.length === 0
    ? `<tr><td colspan="4" class="text-center" style="color: #94a3b8; padding: 10px;">${escapeHtml(t("common.no_data", "لا يوجد أساتذة مسندون"))}</td></tr>`
    : teachers.map(tch => `
      <tr>
        <td><strong>${escapeHtml(tch.name)}</strong></td>
        <td class="font-mono" style="color: #64748b;">${escapeHtml(tch.phone || "—")}</td>
        <td class="text-center font-mono"><strong>${tch.payment_percentage || 0}%</strong></td>
        <td class="text-end font-mono text-blue" style="font-weight: 700;">${Number(tch.earned || 0).toLocaleString()} ${currency}</td>
      </tr>
    `).join("");

  const studentsRows = students.length === 0
    ? `<tr><td colspan="8" class="text-center" style="color: #94a3b8; padding: 12px;">${escapeHtml(t("archive.no_students_enrolled", "لم يتم تسجيل أي تلميذ في هذه الدورة"))}</td></tr>`
    : students.map(stu => {
      const att = stu.attendance || { present: 0, absent: 0, excused: 0, total: 0 };
      const rate = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
      const gradeStr = formatStudentGrade(stu, t);
      let statusBadge = `<span class="chip chip-muted">${escapeHtml(t(`status.${stu.payment_status}`, stu.payment_status || "—"))}</span>`;
      if (stu.payment_status === "paid") statusBadge = `<span class="badge-present">${escapeHtml(t("status.paid", "مدفوع"))}</span>`;
      else if (stu.payment_status === "partial") statusBadge = `<span class="badge-late">${escapeHtml(t("status.partial", "جزئي"))}</span>`;
      else if (stu.payment_status === "pending") statusBadge = `<span class="badge-absent">${escapeHtml(t("status.pending", "معلق"))}</span>`;
      else if (stu.payment_status === "pardoned") statusBadge = `<span class="chip chip-emerald">${escapeHtml(t("status.pardoned", "معفى"))}</span>`;
      else if (stu.payment_status === "not_billed") statusBadge = `<span class="chip chip-muted">${escapeHtml(t("status.not_billed", "غير مفوتر"))}</span>`;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(stu.name)}</strong>
            ${stu.code ? `<span class="chip chip-muted font-mono" style="font-size: 8px; margin-inline-start: 4px;">#${escapeHtml(stu.code)}</span>` : ""}
            ${gradeStr ? `<div style="font-size: 8.5px; color: #b45309; margin-top: 1px;">${escapeHtml(gradeStr)}</div>` : ""}
          </td>
          <td class="font-mono" style="color: #64748b;">${escapeHtml(stu.phone || stu.parent_phone || "—")}</td>
          <td class="text-center font-mono text-emerald"><strong>${att.present}</strong></td>
          <td class="text-center font-mono text-destructive"><strong>${att.absent}</strong></td>
          <td class="text-center font-mono text-amber"><strong>${att.excused}</strong></td>
          <td class="text-center font-mono font-bold" style="color: ${rate >= 75 ? '#059669' : rate >= 50 ? '#d97706' : '#e11d48'};">${rate}%</td>
          <td class="text-end font-mono" style="font-weight: 700;">${Number(stu.paid_amount || 0).toLocaleString()} ${currency}</td>
          <td class="text-center">${statusBadge}</td>
        </tr>
      `;
    }).join("");

  const sessionsRows = sessions.length === 0
    ? `<tr><td colspan="5" class="text-center" style="color: #94a3b8; padding: 10px;">${escapeHtml(t("archive.no_sessions_held", "لم يتم عقد أي حصص لهذه الدورة"))}</td></tr>`
    : sessions.slice(0, 40).map(s => `
      <tr>
        <td class="font-mono" style="color: #64748b;">${formatPrintDate(s.start_at)}</td>
        <td><strong>${escapeHtml(s.group_name)}</strong></td>
        <td style="color: #475569;">${escapeHtml(s.teacher_name || "—")}</td>
        <td style="color: #475569;">${escapeHtml(s.room_name || "—")}</td>
        <td class="text-end"><span class="chip chip-muted">${escapeHtml(t(`status.${s.status}`, s.status || "conducted"))}</span></td>
      </tr>
    `).join("");

  return `<!DOCTYPE html>
<html dir="${isRtl ? "rtl" : "ltr"}" lang="${isRtl ? "ar" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(c.title)} - ${escapeHtml(t("archive.course_dossier", "تقرير وسجل الدورة المؤرشفة"))}</title>
  <style>
    ${getSharedArchiveStyles(isRtl)}
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
      <h2>${escapeHtml(t("archive.course_dossier_title", "تقرير الأرشيف الشامل وسجل التسيير النهائي للدورة"))}</h2>
      <p><strong>${escapeHtml(c.title)}</strong> &middot; ${escapeHtml(t("status.archived", "مؤرشفة"))} ${selectedYear}</p>
    </div>

    <!-- Course Overview Profile -->
    <div class="profile-card">
      <div>
        <div class="profile-name" style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${c.color || '#0f172a'};"></span>
          <span>${escapeHtml(c.title)}</span>
        </div>
        <div class="profile-chips">
          <span class="chip chip-amber">${selectedYear}</span>
          ${c.category ? `<span class="chip chip-muted">${escapeHtml(c.category)}</span>` : ""}
          <span class="chip chip-blue">${groups.length} ${escapeHtml(t("menu.groups", "أفواج"))}</span>
          <span class="chip chip-emerald">${Number(c.price || 0).toLocaleString()} ${currency}</span>
        </div>
      </div>
      <div style="font-size: 9.5px; color: #475569; text-align: ${isRtl ? 'left' : 'right'};">
        <div>${escapeHtml(t("archive.total_sessions", "الحصص المقدمة"))}: <strong>${courseDossier.total_sessions || 0}</strong></div>
        <div>${escapeHtml(t("archive.total_students", "إجمالي التلاميذ"))}: <strong>${courseDossier.total_students || 0}</strong></div>
      </div>
    </div>

    <!-- 4 KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("archive.total_revenue", "مداخيل الدورة"))}</div>
        <div class="kpi-val text-emerald">${Number(courseDossier.total_revenue || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("archive.teacher_earnings", "مستحقات الأساتذة"))}</div>
        <div class="kpi-val text-blue">${Number(courseDossier.teacher_earnings || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("archive.net_profit", "صافي ربح المدرسة"))}</div>
        <div class="kpi-val text-purple">${Number(courseDossier.net_profit || 0).toLocaleString()} ${currency}</div>
      </div>
      <div class="kpi-item">
        <div class="kpi-title">${escapeHtml(t("archive.total_students", "إجمالي التلاميذ"))}</div>
        <div class="kpi-val">${courseDossier.total_students || 0}</div>
      </div>
    </div>

    <!-- Section 1: Teachers -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("archive.instructors", "الأساتذة ومستحقاتهم من الدورة"))}</span>
        <span class="section-count">${teachers.length} ${escapeHtml(t("menu.teachers", "أساتذة"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("field.teacher", "الأستاذ"))}</th>
            <th>${escapeHtml(t("field.phone", "الهاتف"))}</th>
            <th class="text-center">${escapeHtml(t("field.percentage", "النسبة"))}</th>
            <th class="text-end">${escapeHtml(t("archive.teacher_earnings", "مستحقات الأستاذ من الدورة"))}</th>
          </tr>
        </thead>
        <tbody>
          ${teachersRows}
        </tbody>
      </table>
    </div>

    <!-- Section 2: Enrolled Students & Attendance & Payments -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("archive.enrolled_students_title", "التلاميذ المسجلون، الحضور، والمدفوعات"))}</span>
        <span class="section-count">${students.length} ${escapeHtml(t("menu.students", "تلاميذ"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("field.student_name", "التلميذ والمستوى"))}</th>
            <th>${escapeHtml(t("field.phone", "الهاتف"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.present", "حاضر"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.absent", "غائب"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.excused", "مبرر"))}</th>
            <th class="text-center">${escapeHtml(t("attendance.presence_rate", "نسبة الحضور"))}</th>
            <th class="text-end">${escapeHtml(t("payments.paid_now", "المدفوع"))}</th>
            <th class="text-center">${escapeHtml(t("field.status", "الحالة"))}</th>
          </tr>
        </thead>
        <tbody>
          ${studentsRows}
        </tbody>
      </table>
    </div>

    <!-- Section 3: Conducted Sessions Log -->
    <div class="section-block">
      <div class="section-head">
        <span>${escapeHtml(t("archive.sessions_conducted", "الحصص المقدمة في الدورة"))}</span>
        <span class="section-count">${sessions.length} ${escapeHtml(t("menu.sessions", "حصص"))}</span>
      </div>
      <table class="report-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("field.date", "التاريخ"))}</th>
            <th>${escapeHtml(t("field.group", "الفوج"))}</th>
            <th>${escapeHtml(t("field.teacher", "الأستاذ"))}</th>
            <th>${escapeHtml(t("field.room", "القاعة"))}</th>
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
        <div class="sig-label">${escapeHtml(t("reports.teacher_signature", "توقيع الأستاذ(ة) المشرف(ة)"))}</div>
        <div class="sig-sub">${escapeHtml(t("reports.signature_mention", "قرئ وصودق عليه"))}</div>
      </div>
      <div class="sig-card">
        <div class="sig-label">${escapeHtml(t("reports.admin_stamp", "توقيع وختم إدارة المؤسسة"))}</div>
        <div class="sig-sub">${escapeHtml(schoolName)}</div>
      </div>
    </div>

    <!-- Footer Notice -->
    <div class="footer-notice">
      ${escapeHtml(t("reports.official_notice", "وثيقة أرشيف رسمية صادرة آلياً عن نظام إدارة المدرسة Scolaris — يرجى الاحتفاظ بها كإثبات رسمي"))}
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

export default function ArchivePage() {
  const { t, dir } = useI18n();
  const { tenant, user } = useAuth();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { canModify } = usePermission("courses");

  // Navigation levels:
  // selectedYear: null (root level) | number (e.g. 2026)
  // currentFolder: null (year level) | 'courses'
  // selectedCourseId: null | string
  const [selectedYear, setSelectedYear] = useState(null);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [courseSearch, setCourseSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const currency = tenant?.currency || "DZD";
  const money = (v) => `${Number(v || 0).toLocaleString()} ${currency}`;

  // Fetch archive overview (years and counts)
  const { data: overview } = useQuery({
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
  const { data: courseDossier, isLoading: dossierLoading, error: dossierError, refetch: refetchDossier } = useQuery({
    queryKey: ["archived-course-detail", selectedCourseId],
    queryFn: async () => (await api.get(`/courses/${selectedCourseId}/archive-details`)).data,
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
      await api.post(`/courses/${courseId}/unarchive`);
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

  const handlePrintCourseReport = () => {
    if (!courseDossier) {
      toast.error(t("actions.loading"));
      return;
    }
    const html = generateCourseDossierHtml({
      courseDossier,
      selectedYear,
      tenant,
      user,
      currency,
      t,
      dir,
    });
    openPrintDossier(html, `Course-Archive-${courseDossier.course?.title || selectedCourseId}`);
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

  const filteredStudents = useMemo(() => {
    const raw = courseDossier?.students || [];
    if (!studentSearch.trim()) return raw;
    const q = studentSearch.toLowerCase().trim();
    return raw.filter((s) => {
      const name = (s.name || "").toLowerCase();
      const code = (s.code || "").toLowerCase();
      const phone = (s.phone || s.parent_phone || "").toLowerCase();
      return name.includes(q) || code.includes(q) || phone.includes(q);
    });
  }, [courseDossier?.students, studentSearch]);

  return (
    <div>
      <PageHeader
        title={t("menu.archive", "الأرشيف")}
        subtitle={t("archive.subtitle", "أرشيف السنوات والدورات المنتهية مع كامل السجلات المالية والأكاديمية")}
      />

      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 p-2.5 rounded-lg bg-muted/40 border border-border no-print">
        <button
          onClick={() => { setSelectedYear(null); setCurrentFolder(null); setSelectedCourseId(null); }}
          className={`hover:text-foreground font-medium flex items-center gap-1.5 transition-colors ${!selectedYear ? "text-foreground font-semibold" : ""}`}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{t("menu.archive", "الأرشيف")}</span>
        </button>

        {selectedYear && (
          <>
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 ${dir === "rtl" ? "rotate-180" : ""}`} />
            <button
              onClick={() => { setCurrentFolder(null); setSelectedCourseId(null); }}
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
            <button
              onClick={() => setSelectedCourseId(null)}
              className={`hover:text-foreground font-medium flex items-center gap-1.5 transition-colors ${selectedYear && currentFolder && !selectedCourseId ? "text-foreground font-semibold" : ""}`}
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-500" />
              <span>{t("menu.courses", "الدورات")}</span>
            </button>
          </>
        )}

        {selectedCourseId && courseDossier?.course && (
          <>
            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/60 ${dir === "rtl" ? "rotate-180" : ""}`} />
            <span className="text-foreground font-semibold truncate max-w-[200px]">
              {courseDossier.course.title}
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

      {/* Level 2: Archived Courses inside Year > Courses (Listing View) */}
      {selectedYear && currentFolder === "courses" && !selectedCourseId && (
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
                      {t("archive.view_dossier", "عرض التقرير والسجل الشامل")}
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

      {/* Level 3: Full Course Comprehensive Archive Report View */}
      {selectedYear && currentFolder === "courses" && selectedCourseId && (
        <div className="space-y-6">
          {/* Action & Return Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-accent/10 border border-accent/20 no-print">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCourseId(null)}
                className="h-8 px-2 text-xs"
              >
                <ArrowLeft className={`w-3.5 h-3.5 me-1.5 ${dir === "rtl" ? "rotate-180" : ""}`} />
                {t("archive.back_to_courses", "الرجوع لقائمة الدورات")}
              </Button>
              <span className="text-xs text-muted-foreground">|</span>
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" />
                <span>{t("archive.course_dossier", "تقرير وسجل الدورة المؤرشفة الشامل")}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintCourseReport}
                className="h-8 text-xs"
              >
                <Printer className="w-3.5 h-3.5 me-1.5" />
                {t("actions.print", "طباعة تقرير الدورة")}
              </Button>

              {canModify && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restoring}
                  onClick={() => handleRestore(selectedCourseId, courseDossier?.course?.title || "")}
                  className="h-8 text-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5 me-1.5" />
                  {t("archive.restore_action", "استعادة الدورة")}
                </Button>
              )}
            </div>
          </div>

          {dossierLoading ? (
            <div className="py-20 text-center text-sm text-muted-foreground">{t("actions.loading")}</div>
          ) : courseDossier ? (
            <div className="space-y-6">
              {/* Course Overview Card */}
              <div className="surface-card p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: courseDossier.course?.color || "#0A0A0B" }} />
                      <h3 className="font-display font-bold text-xl text-foreground">
                        {courseDossier.course?.title}
                      </h3>
                      <Badge variant="outline" className="text-xs font-mono border-amber-500/40 text-amber-600 dark:text-amber-400">
                        {t("status.archived", "مؤرشفة")} &middot; {selectedYear}
                      </Badge>
                      <StatusPill status="archived" />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {courseDossier.course?.category && (
                        <span className="bg-muted px-2 py-0.5 rounded font-medium text-foreground">
                          {courseDossier.course.category}
                        </span>
                      )}
                      <span>
                        {t("field.pricing")}: <strong className="font-mono text-foreground">{money(courseDossier.course?.price)}</strong>
                      </span>
                    </div>

                    {courseDossier.course?.description && (
                      <p className="text-xs text-muted-foreground pt-1 max-w-2xl">
                        {courseDossier.course.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end text-xs text-muted-foreground space-y-1">
                    <div>
                      {t("menu.groups")}: <strong className="font-mono text-foreground">{(courseDossier.groups || []).length}</strong>
                    </div>
                    <div>
                      {t("archive.total_sessions", "الحصص المقدمة")}: <strong className="font-mono text-foreground">{courseDossier.total_sessions || 0}</strong>
                    </div>
                  </div>
                </div>

                {/* Groups pills */}
                {(courseDossier.groups || []).length > 0 && (
                  <div className="pt-2 border-t border-border/60 flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-muted-foreground font-medium">{t("menu.groups")}:</span>
                    {courseDossier.groups.map((g) => (
                      <Badge key={g.id} variant="secondary" className="text-[11px] font-medium">
                        {g.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* 4 Financial & Operational KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-center gap-1">
                    <Coins className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>{t("archive.total_revenue", "مداخيل الدورة")}</span>
                  </div>
                  <div className="font-mono text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {money(courseDossier.total_revenue)}
                  </div>
                </div>

                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-center gap-1">
                    <HandCoins className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{t("archive.teacher_earnings", "مستحقات الأساتذة")}</span>
                  </div>
                  <div className="font-mono text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {money(courseDossier.teacher_earnings)}
                  </div>
                </div>

                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-center gap-1">
                    <TrendingUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span>{t("archive.net_profit", "صافي ربح المدرسة")}</span>
                  </div>
                  <div className="font-mono text-xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                    {money(courseDossier.net_profit)}
                  </div>
                </div>

                <div className="surface-card p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center justify-center gap-1">
                    <Users className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{t("archive.total_students", "إجمالي التلاميذ")}</span>
                  </div>
                  <div className="font-mono text-xl font-bold text-foreground mt-1">
                    {courseDossier.total_students || 0}
                  </div>
                </div>
              </div>

              {/* Section 1: Teachers & Accrued Earnings */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-500" />
                    <span>{t("archive.instructors", "الأساتذة ومستحقاتهم من الدورة")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {(courseDossier.teachers || []).length} {t("menu.teachers")}
                  </span>
                </div>

                {(courseDossier.teachers || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
                    {t("common.no_data", "لا يوجد أساتذة مسندون")}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {courseDossier.teachers.map((tch) => (
                      <div key={tch.id} className="p-3.5 rounded-lg border border-border bg-card/60 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-sm text-foreground">{tch.name}</div>
                            {tch.phone && <div className="text-xs text-muted-foreground font-mono">{tch.phone}</div>}
                          </div>
                          <Badge variant="outline" className="text-xs font-mono bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                            {tch.payment_percentage}%
                          </Badge>
                        </div>
                        <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{t("archive.teacher_earnings", "المستحقات")}:</span>
                          <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            {money(tch.earned)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 2: Enrolled Students, Attendance & Course Fees */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-emerald-500" />
                    <span>{t("archive.enrolled_students_title", "التلاميذ المسجلون، الحضور، والمدفوعات")}</span>
                  </h4>

                  <div className="w-full sm:w-64 relative">
                    <Search className="w-3.5 h-3.5 absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t("actions.search", "بحث بالاسم أو الكود...")}
                      value={studentSearch}
                      onChange={(e) => setStudentSearch(e.target.value)}
                      className="h-8 text-xs ps-8 bg-background"
                    />
                  </div>
                </div>

                {filteredStudents.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
                    {studentSearch ? t("common.no_results", "لا توجد نتائج مطابقة") : t("archive.no_students_enrolled", "لم يتم تسجيل أي تلميذ في هذه الدورة")}
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
                        <tr>
                          <th className="text-start px-3 py-2 font-medium">{t("field.student_name", "التلميذ")}</th>
                          <th className="text-start px-3 py-2 font-medium">{t("field.phone", "الهاتف")}</th>
                          <th className="text-center px-2 py-2 font-medium text-emerald-600 dark:text-emerald-400">{t("attendance.present", "حاضر")}</th>
                          <th className="text-center px-2 py-2 font-medium text-destructive">{t("attendance.absent", "غائب")}</th>
                          <th className="text-center px-2 py-2 font-medium text-amber-600 dark:text-amber-400">{t("attendance.excused", "مبرر")}</th>
                          <th className="text-center px-2 py-2 font-medium">{t("attendance.presence_rate", "نسبة الحضور")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("payments.paid_now", "المدفوع")}</th>
                          <th className="text-end px-3 py-2 font-medium">{t("field.status", "الحالة")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredStudents.map((stu) => {
                          const att = stu.attendance || { present: 0, absent: 0, excused: 0, total: 0 };
                          const rate = att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
                          const gradeStr = formatStudentGrade(stu, t);
                          return (
                            <tr key={stu.id} className="hover:bg-muted/20">
                              <td className="px-3 py-2.5">
                                <div className="font-semibold text-foreground">{stu.name}</div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  {stu.code && <span className="text-[10px] text-muted-foreground font-mono">#{stu.code}</span>}
                                  {gradeStr && (
                                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                                      &middot; {gradeStr}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 font-mono text-muted-foreground">
                                {stu.phone || stu.parent_phone || "—"}
                              </td>
                              <td className="px-2 py-2.5 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                {att.present}
                              </td>
                              <td className="px-2 py-2.5 text-center font-mono font-bold text-destructive">
                                {att.absent}
                              </td>
                              <td className="px-2 py-2.5 text-center font-mono font-bold text-amber-600 dark:text-amber-400">
                                {att.excused}
                              </td>
                              <td className="px-2 py-2.5 text-center font-mono font-bold">
                                <span className={rate >= 75 ? "text-emerald-600 dark:text-emerald-400" : rate >= 50 ? "text-amber-600 dark:text-amber-400" : "text-destructive"}>
                                  {rate}%
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-end font-mono font-bold text-foreground">
                                {money(stu.paid_amount)}
                              </td>
                              <td className="px-3 py-2.5 text-end">
                                <StatusPill status={stu.payment_status || "paid"} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Section 3: Conducted Sessions Log */}
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-semibold text-base flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-accent" />
                    <span>{t("archive.sessions_conducted", "الحصص المقدمة في الدورة")}</span>
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono">
                    {(courseDossier.sessions || []).length} {t("menu.sessions")}
                  </span>
                </div>

                {(courseDossier.sessions || []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
                    {t("archive.no_sessions_held", "لم يتم عقد أي حصص لهذه الدورة")}
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto">
                    <table className="w-full text-xs min-w-[600px]">
                      <thead className="bg-muted/50 border-b border-border sticky top-0">
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
          ) : (
            <div className="surface-card p-8 text-center space-y-4 max-w-md mx-auto my-8 border-destructive/30">
              <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-base text-foreground mb-1">
                  {t("archive.load_error", "حدث خطأ أثناء تحميل بيانات الدورة المؤرشفة")}
                </h4>
                <p className="text-xs text-muted-foreground">
                  {dossierError ? extractError(dossierError) : t("errors.unknown", "يرجى المحاولة مرة أخرى")}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedCourseId(null)}>
                  {t("actions.back", "رجوع")}
                </Button>
                <Button size="sm" onClick={() => refetchDossier()}>
                  <RotateCcw className="w-3.5 h-3.5 me-1.5" />
                  {t("actions.retry", "إعادة المحاولة")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
